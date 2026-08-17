/**
 * Static analysis behind `tests/unit/test-isolation-guard.unit.test.js`.
 *
 * Jest parallelises test FILES against ONE Firestore/Auth emulator project, so a
 * suite that wipes a whole collection deletes documents a sibling worker seeded
 * moments ago (SHY-0171). This module answers, for a given test source: what
 * does it wipe, what does it use, does it claim its own emulator project, and
 * does it reach a real emulator at all.
 *
 * Two design rules, both learned the hard way.
 *
 * **It parses, it does not pattern-match.** A text scan gets all of the
 * following wrong, and each was a real finding against an earlier version:
 *   - a docblock *describing* the rule reads as a violation of it;
 *   - `"a // b"` inside a string literal looks like a trailing comment;
 *   - a regex literal `/https?:\/\//` looks like a comment;
 *   - `for (const c of SOME_NAME) clearCollection(db, c)` is invisible unless
 *     the constant's name happens to sit on a hardcoded whitelist;
 *   - `users/${uid}/backpack/${id}` hides `backpack` behind a `/`.
 *
 * **It refuses to guess.** Every wipe target it cannot resolve statically —
 * a member expression, a spread-built array, a loop variable with no enclosing
 * `for…of`, an ambiguous same-named constant — is reported in `unresolved`
 * rather than silently contributing nothing. The guard fails on a non-empty
 * `unresolved` list. A detector that quietly sees nothing is worse than no
 * detector: it launders absence of evidence into evidence of absence.
 */

const { parse } = require('@babel/parser');

const WIPE_FNS = new Set(['clearCollection', 'clearCollectionGroup']);
const TOKEN_RESOLVERS = /verifyIdToken|mintRealUser|createCustomToken|mintTokenWithoutUserDoc/;
const FIREBASE_MODULE = /src\/utils\/firebase$/;
/** Doubling the Admin SDK itself doubles everything `src/utils/firebase` exposes. */
const ADMIN_SDK = /^firebase-admin(\/|$)/;
/** Any production module: it reaches Firestore transitively even if the test does not. */
const PRODUCTION_MODULE = /(^|\/)src\//;

const parseSource = (source) =>
  parse(source, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  });

const SKIP_KEYS = new Set(['loc', 'leadingComments', 'trailingComments', 'innerComments']);

/**
 * Iterative depth-first walk. `visit(node, ancestors)` receives the node and the
 * chain of nodes above it, innermost last — that chain is what makes scope-aware
 * resolution possible. Iterative rather than recursive so a pathologically deep
 * AST cannot overflow the stack.
 */
function walk(root, visit) {
  const stack = [{ node: root, ancestors: [] }];
  while (stack.length > 0) {
    const { node, ancestors } = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (const child of node) stack.push({ node: child, ancestors });
      continue;
    }
    const isNode = typeof node.type === 'string';
    if (isNode) visit(node, ancestors);
    const childAncestors = isNode ? [...ancestors, node] : ancestors;
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      stack.push({ node: node[key], ancestors: childAncestors });
    }
  }
}

const isRequireOf = (node, matcher) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'Identifier' &&
  node.callee.name === 'require' &&
  node.arguments[0]?.type === 'StringLiteral' &&
  matcher.test(node.arguments[0].value);

/**
 * `jest.mock` (hoisted, whole-file) and `jest.doMock` (scoped, used with
 * `resetModules`) both replace the module with a double. Missing `doMock`
 * misclassified `tests/utils/loggerInstance.test.js` as a real-emulator suite.
 */
const isJestDoubleOf = (node, matcher) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  node.callee.object.type === 'Identifier' &&
  node.callee.object.name === 'jest' &&
  node.callee.property.type === 'Identifier' &&
  (node.callee.property.name === 'mock' || node.callee.property.name === 'doMock') &&
  node.arguments[0]?.type === 'StringLiteral' &&
  matcher.test(node.arguments[0].value);

/** Every element is a plain string, or the array is not statically knowable. */
function stringValues(elements) {
  const values = [];
  for (const element of elements) {
    if (element?.type !== 'StringLiteral') return null; // spread, call, hole, …
    values.push(element.value);
  }
  return values;
}

const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
  'ObjectMethod',
  'ClassMethod',
]);

/** Does `pattern` bind `name`? Handles destructuring, defaults and rest. */
function patternBinds(pattern, name) {
  if (!pattern) return false;
  if (pattern.type === 'Identifier') return pattern.name === name;
  if (pattern.type === 'AssignmentPattern') return patternBinds(pattern.left, name);
  if (pattern.type === 'RestElement') return patternBinds(pattern.argument, name);
  if (pattern.type === 'ArrayPattern') return pattern.elements.some((e) => patternBinds(e, name));
  if (pattern.type === 'ObjectPattern') {
    return pattern.properties.some((prop) =>
      prop.type === 'RestElement'
        ? patternBinds(prop.argument, name)
        : patternBinds(prop.value, name),
    );
  }
  return false;
}

/**
 * The block-scoped (`const`/`let`) declarator for `name` directly inside this
 * block, if any. `var` is deliberately excluded — it is function-scoped, and is
 * handled by `functionScopedVarBinds` at the enclosing function instead.
 */
function blockDeclarationOf(node, name) {
  if (node.type !== 'BlockStatement' && node.type !== 'Program') return null;
  for (const statement of node.body) {
    if (statement.type === 'VariableDeclaration' && statement.kind !== 'var') {
      for (const declarator of statement.declarations) {
        if (patternBinds(declarator.id, name)) return declarator;
      }
    }
    if (
      (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') &&
      statement.id?.name === name
    ) {
      // A function or class cannot name a Firestore collection. Report rather
      // than let an outer same-named constant be wrongly attributed.
      return { init: statement };
    }
  }
  return null;
}

/**
 * Does a `var` anywhere inside this function (but not inside a NESTED function)
 * bind `name`? `var` hoists to the whole function body, so
 *
 *     function setup() {
 *       if (cond) { var SEG = 'other'; }
 *       clearCollection(db, SEG);          // 'other' or undefined — never the outer const
 *     }
 *
 * shadows an outer `const SEG` for the entire body, including lines above the
 * declaration. Its value at the wipe call depends on `cond`, so report it.
 *
 * The repo bans `var` (`no-var: error`), so this cannot fire today. It exists so
 * that relaxing that lint rule cannot silently reintroduce a wrong answer.
 */
function functionScopedVarBinds(functionNode, name) {
  const body = functionNode.type === 'Program' ? functionNode : functionNode.body;
  if (!body || typeof body !== 'object') return false;
  let found = false;
  const visit = (node) => {
    if (found || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (FUNCTION_TYPES.has(node.type)) return; // a nested function has its own var scope
    if (node.type === 'VariableDeclaration' && node.kind === 'var') {
      if (node.declarations.some((d) => patternBinds(d.id, name))) found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      visit(node[key]);
    }
  };
  visit(body);
  return found;
}

/**
 * Resolve `name` at a wipe call site: walk its ancestors innermost-out and let
 * the NEAREST binding decide. Anything else is a silent wrong answer.
 *
 * Three binders matter, and which one is nearest is the whole question:
 *   - the `for (const name of X)` we want to expand;
 *   - a function or catch PARAMETER, whose value we cannot see → report;
 *   - a `const`/`let` declaration, which may be the string constant we want.
 *
 * `for (const c of WIPED) other.forEach((c) => clear(db, c))` clears the
 * callback's `c`; `for (const c of WIPED) { const c = 'x'; clear(db, c) }`
 * clears `'x'`. Matching on name alone confidently reports WIPED for both.
 */
function resolveBinding(ancestors, name) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];

    if (node.type === 'ForOfStatement') {
      const decl = node.left.type === 'VariableDeclaration' ? node.left.declarations[0] : null;
      if (decl && patternBinds(decl.id, name)) {
        if (decl.id.type !== 'Identifier') return { shadowedBy: `${decl.id.type} loop binding` };
        return { loop: node };
      }
    }
    if (FUNCTION_TYPES.has(node.type)) {
      const index = node.params.findIndex((p) => patternBinds(p, name));
      if (index !== -1) {
        // Carry WHICH function and WHICH slot, so a caller can check that every
        // call site passes a string literal there rather than assume it.
        return {
          shadowedBy: `${node.type} parameter`,
          parameterOf: { fn: node, index, fnAncestors: ancestors.slice(0, i) },
        };
      }
    }
    if (node.type === 'CatchClause' && patternBinds(node.param, name)) {
      return { shadowedBy: 'CatchClause parameter' };
    }
    if (
      (FUNCTION_TYPES.has(node.type) || node.type === 'Program') &&
      functionScopedVarBinds(node, name)
    ) {
      return { shadowedBy: 'hoisted var declaration' };
    }
    const declarator = blockDeclarationOf(node, name);
    if (declarator) return { declarator };
  }
  return {};
}

/**
 * Collections a file wipes wholesale, plus everything it could not resolve.
 * The loop variable is resolved from the wipe call's OWN enclosing `for…of`,
 * so two loops reusing one variable name cannot shadow each other.
 */
function wipedCollectionsFromAst(ast) {
  const wipes = new Set();
  const unresolved = [];

  walk(ast.program, (node, ancestors) => {
    if (node.type !== 'CallExpression') return;
    const { callee } = node;
    const calleeName =
      callee.type === 'Identifier'
        ? callee.name
        : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
          ? callee.property.name
          : null;
    if (!calleeName || !WIPE_FNS.has(calleeName)) return;

    const target = node.arguments[1];
    const describe = (why) => unresolved.push(`${calleeName}(db, …): ${why}`);

    if (!target) return describe('no collection argument');
    if (target.type === 'StringLiteral') return void wipes.add(target.value);
    if (target.type !== 'Identifier') {
      return describe(`target is a ${target.type}, which cannot be resolved statically`);
    }

    const { loop, shadowedBy, declarator } = resolveBinding(ancestors, target.name);

    if (shadowedBy) {
      return describe(`'${target.name}' is shadowed by a ${shadowedBy}; its source is unknowable`);
    }
    if (declarator) {
      // Nearest binding is a declaration — a plain `const SEG = 'segregationEvents'`?
      if (declarator.init?.type !== 'StringLiteral') {
        return describe(`'${target.name}' is declared, but not as a string literal`);
      }
      return void wipes.add(declarator.init.value);
    }
    if (!loop) return describe(`'${target.name}' is neither a loop variable nor a string constant`);

    // Resolve the loop's iterable through the SAME ancestor chain, so a
    // block-scoped array constant binds ahead of a file-level one of the name.
    const iterable = loop.right;
    if (iterable.type === 'ArrayExpression') {
      const values = stringValues(iterable.elements);
      if (!values) return describe(`inline array for '${target.name}' is not all string literals`);
      for (const value of values) wipes.add(value);
      return;
    }
    if (iterable.type !== 'Identifier') {
      return describe(`'${target.name}' iterates a ${iterable.type}`);
    }

    const source = resolveBinding(ancestors, iterable.name);
    if (source.shadowedBy) {
      return describe(`'${iterable.name}' is shadowed by a ${source.shadowedBy}`);
    }
    if (!source.declarator) return describe(`'${iterable.name}' is not a declared array constant`);
    if (source.declarator.init?.type !== 'ArrayExpression') {
      return describe(`'${iterable.name}' is not a literal array constant`);
    }
    const values = stringValues(source.declarator.init.elements);
    if (!values) return describe(`'${iterable.name}' is built from spreads or expressions`);
    for (const value of values) wipes.add(value);
  });

  return { wipes, unresolved };
}

/**
 * Every `/`-delimited segment of every string and template literal.
 * `users/${uid}/backpack/${id}` contributes `users` and `backpack`, so a
 * subcollection is not hidden by its position in a path.
 *
 * This deliberately OVER-approximates, exactly as `touchesRealEmulator` does: a
 * route path `'/api/users'` or a URL counts as a use of `users`.
 *
 * Be honest about what a false positive costs. It does NOT land on the file that
 * triggered it. `findWipeCollisions` pairs the new file against whichever
 * EXISTING non-namespaced wiper clears that collection, so an unrelated PR can
 * be blocked by a guard failure whose fix lives in a file its author never
 * touched — with the violation message naming both files. That is the price of
 * never missing a real collision, which costs a silent, scheduling-dependent
 * flake that takes a day to find. Err toward flagging, and keep the message
 * explicit enough that the reader knows where to go.
 */
function referencedSegmentsFromAst(ast) {
  const segments = new Set();
  const addAll = (value) => {
    for (const part of String(value).split('/')) if (part) segments.add(part);
  };
  walk(ast.program, (node) => {
    if (node.type === 'StringLiteral') addAll(node.value);
    else if (node.type === 'TemplateElement') addAll(node.value.cooked ?? '');
  });
  return segments;
}

const FIRESTORE_PATH_FNS = new Set(['doc', 'collection', 'collectionGroup']);

/**
 * The module specifier behind `const { X } = require('./mod')`, or null.
 * Only relative requires: a package's constants are not this repo's collections.
 */
function relativeRequireSpecifier(declarator) {
  const init = declarator?.init;
  if (init?.type !== 'CallExpression') return null;
  if (init.callee.type !== 'Identifier' || init.callee.name !== 'require') return null;
  const spec = init.arguments[0];
  if (spec?.type !== 'StringLiteral' || !spec.value.startsWith('.')) return null;
  return spec.value;
}

/** A top-level `const NAME = '<literal>'` exported by a module's source, or null. */
function exportedStringConstant(moduleSource, name) {
  let ast;
  try {
    ast = parseSource(moduleSource);
  } catch {
    return null;
  }
  for (const statement of ast.program.body) {
    if (statement.type !== 'VariableDeclaration') continue;
    for (const declarator of statement.declarations) {
      if (declarator.id.type === 'Identifier' && declarator.id.name === name) {
        return declarator.init?.type === 'StringLiteral' ? declarator.init.value : null;
      }
    }
  }
  return null;
}

/** The name a function is known by: `function f(){}` or `const f = (…) => {}`. */
function functionName(fn, ancestors) {
  if (fn.id?.type === 'Identifier') return fn.id.name;
  const parent = ancestors[ancestors.length - 1];
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier')
    return parent.id.name;
  return null;
}

/**
 * A parameter in a collection-name slot is only readable if EVERY call site in
 * this file passes something readable there — a literal, or a template whose own
 * collection slots resolve. That is what puts the name in front of the blanket
 * literal scan. Trusting the assumption instead of checking it is how the victim
 * side went blind in the first place (reviewer R15-I2).
 */
function everyCallSitePassesAReadablePath(ctx, fnName, paramIndex) {
  if (ctx.functionsInProgress.has(fnName)) return false; // recursive helper
  ctx.functionsInProgress.add(fnName);
  try {
    let sawCall = false;
    let allReadable = true;
    walk(ctx.ast.program, (node, ancestors) => {
      if (node.type !== 'CallExpression') return;
      if (node.callee.type !== 'Identifier' || node.callee.name !== fnName) return;
      sawCall = true;
      const arg = node.arguments[paramIndex];
      if (!arg || !pathIsReadable(arg, ancestors, ctx).readable) allReadable = false;
    });
    return sawCall && allReadable;
  } finally {
    ctx.functionsInProgress.delete(fnName);
  }
}

/** An in-file array of string literals: its names are scanned by `referencedSegments`. */
function arrayOfStringLiterals(node, ancestors) {
  if (node.type === 'ArrayExpression') return stringValues(node.elements) !== null;
  if (node.type !== 'Identifier') return false;
  const { declarator } = resolveBinding(ancestors, node.name);
  if (declarator?.init?.type !== 'ArrayExpression') return false;
  return stringValues(declarator.init.elements) !== null;
}

/**
 * Can the analyzer see the collection name this Firestore path names?
 *
 * "Readable" means the name appears somewhere in this file as a string literal,
 * so `referencedSegments` counts the file as a user of that collection. It does
 * NOT mean we compute the name here — the blanket literal scan already does.
 *
 * Readable: a literal; a template with literal name text before its first
 * interpolation; an identifier bound to a local string constant, to such a
 * template, to a function/catch PARAMETER (its arguments are literals at in-file
 * call sites), or to a `for…of` over an in-file array of string literals.
 *
 * Everything else — an imported constant, an undeclared name, a concatenation, a
 * call result — is UNREADABLE. Say so. Do not quietly return nothing: an
 * under-counted victim lets a sibling's wholesale wipe pass unreported, and that
 * is the one direction `findWipeCollisions` cannot tolerate.
 */
function pathIsReadable(node, ancestors, ctx) {
  if (!node) return { readable: false, why: 'no path argument' };

  if (node.type === 'StringLiteral') return { readable: true };

  if (node.type === 'TemplateLiteral') {
    // A Firestore path alternates collection/document: `rooms/r1/messages/m1`.
    // Only EVEN 0-based segments name a collection, so only interpolations that
    // land on one need reading — `users/${uid}` hides nothing, `${SUBCOL}` in
    // `users/${uid}/${SUBCOL}/${id}` hides a collection name (reviewer R15-I1).
    let segment = 0;
    for (let i = 0; i < node.quasis.length; i++) {
      let text = node.quasis[i].value.cooked ?? '';
      // A leading '/' is not an empty first segment; Firestore paths are relative.
      if (i === 0 && text.startsWith('/')) text = text.slice(1);
      segment += text.split('/').length - 1;

      const expression = node.expressions[i];
      if (!expression) break;
      if (segment % 2 !== 0) continue; // a document-id slot names no collection

      if (expression.type !== 'Identifier') {
        return { readable: false, why: `a collection segment is a ${expression.type}` };
      }
      const result = pathIsReadable(expression, ancestors, ctx);
      if (!result.readable) return result;
    }
    return { readable: true };
  }

  if (node.type === 'Identifier') {
    // `const A = `${A}`` is a TDZ crash at runtime, but Babel parses it happily.
    // Guard the cycle rather than let the guard die of a RangeError (R15-I4).
    if (ctx.seen.has(node.name)) {
      return { readable: false, why: `'${node.name}' is defined in terms of itself` };
    }
    ctx.seen.add(node.name);
    try {
      return identifierIsReadable(node, ancestors, ctx);
    } finally {
      ctx.seen.delete(node.name);
    }
  }

  return { readable: false, why: `the path is a ${node.type}` };
}

function identifierIsReadable(node, ancestors, ctx) {
  const { declarator, shadowedBy, loop, parameterOf } = resolveBinding(ancestors, node.name);

  if (shadowedBy?.endsWith('parameter')) {
    if (!parameterOf)
      return { readable: false, why: `'${node.name}' is a parameter of nothing nameable` };
    const { fn, index, fnAncestors } = parameterOf;
    const name = functionName(fn, fnAncestors);
    if (name && everyCallSitePassesAReadablePath(ctx, name, index)) return { readable: true };
    return {
      readable: false,
      why: `'${node.name}' is a parameter whose call sites do not all pass a string literal`,
    };
  }

  if (loop) {
    if (arrayOfStringLiterals(loop.right, ancestors)) return { readable: true };
    return { readable: false, why: `'${node.name}' iterates names this file never spells out` };
  }

  const init = declarator?.init;
  if (init?.type === 'StringLiteral') return { readable: true };
  if (init?.type === 'TemplateLiteral') return pathIsReadable(init, ancestors, ctx);

  // `const { SAFETY_AUDIT_COLLECTION } = require('../../src/safety/safety-audit')`
  // names a collection whose literal lives in ANOTHER file. Follow the require:
  // the name must reach `segments`, or this file silently stops counting as a
  // user of that collection and a sibling's wipe of it goes unreported.
  const specifier = relativeRequireSpecifier(declarator);
  if (specifier && ctx.readModule) {
    const moduleSource = ctx.readModule(specifier);
    const value = moduleSource && exportedStringConstant(moduleSource, node.name);
    if (value) {
      ctx.importedNames.add(value);
      return { readable: true };
    }
    return {
      readable: false,
      why: `'${node.name}' is imported from '${specifier}' but is not a string constant there`,
    };
  }
  return { readable: false, why: `'${node.name}' is not a local string constant` };
}

/** `db` itself, or a call chained off it (`db.collection(x).doc(y)`). */
function isFirestoreChain(node) {
  if (node.type === 'Identifier') return node.name === 'db';
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false;
  return isFirestoreChain(node.callee.object);
}

function firestorePathsFromAst(ast, readModule) {
  const unresolved = [];
  const importedNames = new Set();
  const ctx = { ast, readModule, importedNames, seen: new Set(), functionsInProgress: new Set() };

  walk(ast.program, (node, ancestors) => {
    if (node.type !== 'CallExpression') return;
    const { callee } = node;
    if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return;
    if (!FIRESTORE_PATH_FNS.has(callee.property.name)) return;
    if (!isFirestoreChain(callee.object)) return;

    // Only `db.<fn>(…)` takes a full path. Chained off a reference,
    // `.collection(name)` takes a bare collection name — still a name we must be
    // able to read — while `.doc(id)` takes a DOCUMENT id, which names nothing.
    const onRoot = callee.object.type === 'Identifier';
    if (!onRoot && callee.property.name === 'doc') return;

    const { readable, why } = pathIsReadable(node.arguments[0], ancestors, ctx);
    if (readable) return;
    unresolved.push(
      `db.${callee.property.name}(…): ${why}, so this file cannot be counted as a user ` +
        'of the collection it names',
    );
  });
  return { unresolved, importedNames };
}

const unresolvedSegmentsFromAst = (ast, readModule) =>
  firestorePathsFromAst(ast, readModule).unresolved;

/** An ASSIGNMENT claims the namespace. Merely naming the variable does not. */
function isNamespacedFromAst(ast) {
  let found = false;
  walk(ast.program, (node) => {
    if (node.type !== 'AssignmentExpression') return;
    const { left } = node;
    if (
      left.type === 'MemberExpression' &&
      left.property.type === 'Identifier' &&
      left.property.name === 'FIRESTORE_TEST_NAMESPACE'
    ) {
      found = true;
    }
  });
  return found;
}

/** Is the Admin SDK replaced by a double anywhere in this file? */
function doublesFirebaseFromAst(ast) {
  let doubled = false;
  walk(ast.program, (node) => {
    if (isJestDoubleOf(node, FIREBASE_MODULE) || isJestDoubleOf(node, ADMIN_SDK)) doubled = true;
  });
  return doubled;
}

/**
 * A suite reaches a real emulator when it exercises production code without
 * doubling the Admin SDK. Two deliberate choices:
 *
 * - Filename is never consulted. A real-emulator suite named `*.unit.test.js`
 *   must not escape the invariant by naming convention alone.
 * - ANY production `src/` require counts, not just `src/utils/firebase`. A suite
 *   that seeds through HTTP routes (supertest → app → Firestore) never requires
 *   firebase itself, yet its documents are just as destroyable by a sibling's
 *   wholesale wipe. Over-approximating the victim set errs toward flagging.
 *
 * A wiper always needs a real `db`, so it always lands in this set too — and the
 * guard separately asserts that no doubling file wipes, closing the loophole
 * where a wiper hides behind a double.
 */
function touchesRealEmulatorFromAst(ast, doubled = doublesFirebaseFromAst(ast)) {
  let usesProductionCode = false;
  walk(ast.program, (node) => {
    if (isRequireOf(node, FIREBASE_MODULE) || isRequireOf(node, PRODUCTION_MODULE)) {
      usesProductionCode = true;
    }
  });
  return usesProductionCode && !doubled;
}

/** Does the suite resolve ID tokens? Such a suite can never be namespaced. */
function resolvesIdTokensFromAst(ast) {
  let found = false;
  walk(ast.program, (node) => {
    if (node.type === 'Identifier' && TOKEN_RESOLVERS.test(node.name)) found = true;
    else if (node.type === 'MemberExpression' && node.property.type === 'Identifier') {
      if (TOKEN_RESOLVERS.test(node.property.name)) found = true;
    }
  });
  return found;
}

/** Wiping the DEFAULT project's Auth accounts deletes every sibling's users. */
function wipesDefaultAuthProjectFromAst(ast) {
  let found = false;
  const check = (value) => {
    if (/projects\/demo-shytalk\/accounts/.test(String(value))) found = true;
  };
  walk(ast.program, (node) => {
    if (node.type === 'StringLiteral') check(node.value);
    else if (node.type === 'TemplateElement') check(node.value.cooked ?? '');
  });
  return found;
}

/** All facts for one file. Parsed ONCE. */
function analyze(file, source, readModule) {
  const ast = parseSource(source);
  const { wipes, unresolved } = wipedCollectionsFromAst(ast);
  const doubled = doublesFirebaseFromAst(ast);
  const paths = firestorePathsFromAst(ast, readModule);
  const segments = referencedSegmentsFromAst(ast);
  for (const name of paths.importedNames) segments.add(name);
  return {
    file,
    namespaced: isNamespacedFromAst(ast),
    wipes,
    unresolvedWipes: unresolved,
    segments,
    unresolvedSegments: paths.unresolved,
    doublesFirebase: doubled,
    touchesEmulator: touchesRealEmulatorFromAst(ast, doubled),
    resolvesTokens: resolvesIdTokensFromAst(ast),
    wipesDefaultAuthProject: wipesDefaultAuthProjectFromAst(ast),
  };
}

/**
 * Human-readable violations: a non-namespaced emulator suite wiping a collection
 * another non-namespaced emulator suite depends on.
 */
function findWipeCollisions(analyses) {
  const emulator = analyses.filter((a) => a.touchesEmulator);
  const violations = [];
  for (const a of emulator) {
    if (a.namespaced) continue;
    for (const collection of [...a.wipes].sort()) {
      const collaterals = emulator
        .filter((o) => o.file !== a.file && !o.namespaced && o.segments.has(collection))
        .map((o) => o.file);
      if (collaterals.length > 0) {
        violations.push(
          `${a.file} wipes '${collection}', also used by ${collaterals.length} other file(s): ` +
            `${collaterals.slice(0, 3).join(', ')}${collaterals.length > 3 ? ', …' : ''}`,
        );
      }
    }
  }
  return violations;
}

// Source-taking wrappers, for callers holding a string rather than an AST.
const fromSource = (fn) => (source) => fn(parseSource(source));

module.exports = {
  analyze,
  findWipeCollisions,
  doublesFirebase: fromSource(doublesFirebaseFromAst),
  isNamespaced: fromSource(isNamespacedFromAst),
  referencedSegments: fromSource(referencedSegmentsFromAst),
  unresolvedSegments: (source, readModule) =>
    unresolvedSegmentsFromAst(parseSource(source), readModule),
  resolvesIdTokens: fromSource(resolvesIdTokensFromAst),
  touchesRealEmulator: fromSource(touchesRealEmulatorFromAst),
  wipedCollections: fromSource(wipedCollectionsFromAst),
  wipesDefaultAuthProject: fromSource(wipesDefaultAuthProjectFromAst),
};
