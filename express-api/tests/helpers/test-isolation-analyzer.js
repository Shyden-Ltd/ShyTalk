/**
 * Static analysis behind `tests/unit/test-isolation-guard.unit.test.js`.
 *
 * Jest parallelises test FILES against ONE Firestore/Auth emulator project, so a
 * suite that wipes a whole collection deletes documents a sibling worker seeded
 * moments ago (SHY-0171). This module answers, for a given test source: what
 * does it wipe, what does it use, does it claim its own emulator project, and
 * does it reach a real emulator at all.
 *
 * It parses with `@babel/parser` rather than matching regexes against raw text.
 * That is not fastidiousness — a text scan gets the following wrong, and each
 * one was a real finding against the first version of this guard:
 *   - a docblock *describing* the rule reads as a violation of it;
 *   - `"a // b"` inside a string literal looks like a trailing comment;
 *   - a regex literal `/https?:\/\//` looks like a comment;
 *   - `for (const c of SOME_OTHER_NAME) clearCollection(db, c)` is invisible
 *     unless the constant's name happens to be on a hardcoded whitelist;
 *   - `users/${uid}/backpack/${id}` hides `backpack` behind a `/`, so a
 *     quote-anchored "does this file use collection X" check never sees it.
 * The AST has none of these ambiguities.
 */

const { parse } = require('@babel/parser');

const WIPE_FNS = new Set(['clearCollection', 'clearCollectionGroup']);
const TOKEN_RESOLVERS = /verifyIdToken|mintRealUser|createCustomToken|mintTokenWithoutUserDoc/;
const FIREBASE_MODULE = /src\/utils\/firebase$/;
/** Any production module: it reaches Firestore transitively even if the test does not. */
const PRODUCTION_MODULE = /(^|\/)src\//;

function parseSource(source) {
  return parse(source, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  });
}

/** Depth-first walk over every AST node, ignoring `loc`/`comments` noise. */
function walk(node, visit) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    walk(node[key], visit);
  }
}

const isRequireOf = (node, matcher) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'Identifier' &&
  node.callee.name === 'require' &&
  node.arguments[0]?.type === 'StringLiteral' &&
  matcher.test(node.arguments[0].value);

const isJestMockOf = (node, matcher) =>
  node.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  node.callee.object.type === 'Identifier' &&
  node.callee.object.name === 'jest' &&
  node.callee.property.type === 'Identifier' &&
  node.callee.property.name === 'mock' &&
  node.arguments[0]?.type === 'StringLiteral' &&
  matcher.test(node.arguments[0].value);

/** Every `const NAME = ['a', 'b']` in the file, as name → string values. */
function stringArrayConstants(ast) {
  const consts = new Map();
  walk(ast.program, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    if (node.id.type !== 'Identifier' || node.init?.type !== 'ArrayExpression') return;
    const values = node.init.elements
      .filter((el) => el?.type === 'StringLiteral')
      .map((el) => el.value);
    if (values.length > 0) consts.set(node.id.name, values);
  });
  return consts;
}

/**
 * Collections the file wipes wholesale: `clearCollection(db, 'users')` directly,
 * plus `for (const c of ANY_CONST) clearCollection(db, c)` — the loop variable is
 * resolved back to its `for…of` source array by name, with no whitelist.
 */
function wipedCollections(source) {
  const ast = parseSource(source);
  const consts = stringArrayConstants(ast);
  const wiped = new Set();

  // loop variable name → the array constant it iterates
  const loopVarSource = new Map();
  walk(ast.program, (node) => {
    if (node.type !== 'ForOfStatement') return;
    const decl = node.left.type === 'VariableDeclaration' ? node.left.declarations[0] : null;
    if (decl?.id.type === 'Identifier' && node.right.type === 'Identifier') {
      loopVarSource.set(decl.id.name, node.right.name);
    }
  });

  walk(ast.program, (node) => {
    if (node.type !== 'CallExpression') return;
    if (node.callee.type !== 'Identifier' || !WIPE_FNS.has(node.callee.name)) return;
    const target = node.arguments[1];
    if (!target) return;
    if (target.type === 'StringLiteral') {
      wiped.add(target.value);
    } else if (target.type === 'Identifier') {
      const arrayName = loopVarSource.get(target.name);
      for (const value of consts.get(arrayName) ?? []) wiped.add(value);
    }
  });
  return wiped;
}

/**
 * Every `/`-delimited segment of every string and template literal in the file.
 * `db.doc(`users/${uid}/backpack/${id}`)` contributes `users` and `backpack`, so
 * a subcollection is not hidden by its position in a path.
 */
function referencedSegments(source) {
  const ast = parseSource(source);
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
function isNamespaced(source) {
  const ast = parseSource(source);
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
 * A wiper, by contrast, always needs `db`, so it always lands in this set too.
 */
function touchesRealEmulator(source) {
  const ast = parseSource(source);
  let usesProductionCode = false;
  let mocksFirebase = false;
  walk(ast.program, (node) => {
    if (isJestMockOf(node, FIREBASE_MODULE)) mocksFirebase = true;
    else if (isRequireOf(node, FIREBASE_MODULE) || isRequireOf(node, PRODUCTION_MODULE)) {
      usesProductionCode = true;
    }
  });
  return usesProductionCode && !mocksFirebase;
}

/** Does the suite resolve ID tokens? Such a suite can never be namespaced. */
function resolvesIdTokens(source) {
  const ast = parseSource(source);
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
function wipesDefaultAuthProject(source) {
  const ast = parseSource(source);
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

/** All facts for one file, parsed once. */
function analyze(file, source) {
  return {
    file,
    namespaced: isNamespaced(source),
    wipes: wipedCollections(source),
    segments: referencedSegments(source),
    touchesEmulator: touchesRealEmulator(source),
    resolvesTokens: resolvesIdTokens(source),
    wipesDefaultAuthProject: wipesDefaultAuthProject(source),
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

module.exports = {
  analyze,
  findWipeCollisions,
  isNamespaced,
  referencedSegments,
  resolvesIdTokens,
  touchesRealEmulator,
  wipedCollections,
  wipesDefaultAuthProject,
};
