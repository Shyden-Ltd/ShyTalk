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

/**
 * `const NAME = ['a', 'b']` declarations, name → values. A name declared more
 * than once is recorded as ambiguous: without full scope analysis we cannot say
 * which one a use refers to, so we decline to pick.
 */
function stringArrayConstants(ast) {
  const consts = new Map();
  const ambiguous = new Set();
  walk(ast.program, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    if (node.id.type !== 'Identifier' || node.init?.type !== 'ArrayExpression') return;
    if (consts.has(node.id.name)) ambiguous.add(node.id.name);
    consts.set(node.id.name, node.init.elements);
  });
  return { consts, ambiguous };
}

/**
 * `const NAME = 'users'` declarations, name → value. Same ambiguity rule as the
 * array constants: a name declared twice is unknowable, so we decline to pick.
 */
function stringConstants(ast) {
  const consts = new Map();
  const ambiguous = new Set();
  walk(ast.program, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    if (node.id.type !== 'Identifier' || node.init?.type !== 'StringLiteral') return;
    if (consts.has(node.id.name)) ambiguous.add(node.id.name);
    consts.set(node.id.name, node.init.value);
  });
  return { consts, ambiguous };
}

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

/**
 * Does this node bind `name` in a way the analyzer cannot see through?
 *
 * Only FUNCTION and CATCH parameters qualify. A `const NAME = …` declaration is
 * not a shadow — it is precisely what `stringConstants`/`stringArrayConstants`
 * resolve, and duplicates among them are caught by their `ambiguous` sets.
 */
function bindsName(node, name) {
  const patternBinds = (pattern) => {
    if (!pattern) return false;
    if (pattern.type === 'Identifier') return pattern.name === name;
    if (pattern.type === 'AssignmentPattern') return patternBinds(pattern.left);
    if (pattern.type === 'RestElement') return patternBinds(pattern.argument);
    if (pattern.type === 'ArrayPattern') return pattern.elements.some(patternBinds);
    if (pattern.type === 'ObjectPattern') {
      return pattern.properties.some((p) =>
        p.type === 'RestElement' ? patternBinds(p.argument) : patternBinds(p.value),
      );
    }
    return false;
  };

  if (FUNCTION_TYPES.has(node.type)) return node.params.some(patternBinds);
  if (node.type === 'CatchClause') return patternBinds(node.param);
  return false;
}

/**
 * Resolve `name` at a wipe call site by walking its ancestors innermost-out.
 *
 * Returns the enclosing `for (const <name> of X)` — but ONLY if nothing binds
 * `name` more tightly first. A callback parameter that reuses the loop
 * variable's name (`for (const c of WIPED) list.forEach((c) => clear(db, c))`)
 * refers to the callback's `c`, not the loop's; resolving it to the loop's array
 * would be a SILENT WRONG ANSWER — the one outcome this analyzer must never
 * produce. Report the shadowing instead and let the guard fail loudly.
 */
function resolveLoopVariable(ancestors, name) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];
    if (node.type === 'ForOfStatement') {
      const decl = node.left.type === 'VariableDeclaration' ? node.left.declarations[0] : null;
      if (decl?.id.type === 'Identifier' && decl.id.name === name) return { loop: node };
    }
    if (bindsName(node, name)) return { shadowedBy: node.type };
  }
  return {};
}

/**
 * Collections a file wipes wholesale, plus everything it could not resolve.
 * The loop variable is resolved from the wipe call's OWN enclosing `for…of`,
 * so two loops reusing one variable name cannot shadow each other.
 */
function wipedCollectionsFromAst(ast) {
  const { consts, ambiguous } = stringArrayConstants(ast);
  const { consts: strings, ambiguous: ambiguousStrings } = stringConstants(ast);
  const wipes = new Set();
  const unresolved = [];

  walk(ast.program, (node, ancestors) => {
    if (node.type !== 'CallExpression') return;
    if (node.callee.type !== 'Identifier' || !WIPE_FNS.has(node.callee.name)) return;

    const target = node.arguments[1];
    const describe = (why) => unresolved.push(`${node.callee.name}(db, …): ${why}`);

    if (!target) return describe('no collection argument');

    if (target.type === 'StringLiteral') {
      wipes.add(target.value);
      return;
    }
    if (target.type !== 'Identifier') {
      return describe(`target is a ${target.type}, which cannot be resolved statically`);
    }

    const { loop, shadowedBy } = resolveLoopVariable(ancestors, target.name);
    if (shadowedBy) {
      return describe(
        `'${target.name}' is shadowed by a ${shadowedBy} binding; its source is unknowable`,
      );
    }
    if (!loop) {
      // Not a loop variable: it may be a plain `const SEG_EVENTS = 'segregationEvents'`.
      if (ambiguousStrings.has(target.name)) {
        return describe(`'${target.name}' is declared more than once; which one is unknowable`);
      }
      const value = strings.get(target.name);
      if (value === undefined) {
        return describe(`'${target.name}' is neither a loop variable nor a string constant`);
      }
      wipes.add(value);
      return;
    }

    if (loop.right.type === 'ArrayExpression') {
      const values = stringValues(loop.right.elements);
      if (!values) return describe(`inline array for '${target.name}' is not all string literals`);
      for (const value of values) wipes.add(value);
      return;
    }
    if (loop.right.type !== 'Identifier') {
      return describe(`'${target.name}' iterates a ${loop.right.type}`);
    }
    if (ambiguous.has(loop.right.name)) {
      return describe(`'${loop.right.name}' is declared more than once; which one is unknowable`);
    }
    const elements = consts.get(loop.right.name);
    if (!elements) return describe(`'${loop.right.name}' is not a literal array constant`);
    const values = stringValues(elements);
    if (!values) return describe(`'${loop.right.name}' is built from spreads or expressions`);
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
function analyze(file, source) {
  const ast = parseSource(source);
  const { wipes, unresolved } = wipedCollectionsFromAst(ast);
  const doubled = doublesFirebaseFromAst(ast);
  return {
    file,
    namespaced: isNamespacedFromAst(ast),
    wipes,
    unresolvedWipes: unresolved,
    segments: referencedSegmentsFromAst(ast),
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
  resolvesIdTokens: fromSource(resolvesIdTokensFromAst),
  touchesRealEmulator: fromSource(touchesRealEmulatorFromAst),
  wipedCollections: fromSource(wipedCollectionsFromAst),
  wipesDefaultAuthProject: fromSource(wipesDefaultAuthProjectFromAst),
};
