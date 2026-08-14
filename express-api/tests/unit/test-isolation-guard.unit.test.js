/**
 * Structural guard: no test file may wipe shared emulator state that another
 * test file depends on.
 *
 * Jest parallelises test FILES against ONE Firestore/Auth emulator project. A
 * file that calls `clearCollection(db, 'users')` deletes documents a sibling
 * worker seeded moments ago — the assertions then pass or fail for reasons
 * unrelated to the code under test. SHY-0171 reproduced exactly this between
 * `tests/cron/testDataCleanup.test.js` and `tests/cron/accountDeletion.test.js`.
 *
 * The escape hatch is `FIRESTORE_TEST_NAMESPACE`: a suite that needs exclusive
 * access claims its own emulator project (see `src/utils/firebase.js`). It is
 * safe for any suite that does not resolve ID tokens — the Auth emulator binds
 * token verification to the project it was STARTED with, and nothing else.
 *
 * This guard fails LOUDLY at test time rather than letting the next wholesale
 * wipe become a mystery flake, which is SHY-0171's observability requirement.
 *
 * Two halves. The FIXTURES half proves the analyzer actually detects each form
 * of violation — a guard whose detector is blind is worse than none, because it
 * launders the absence of evidence into evidence of absence. The CORPUS half
 * then runs that detector over every real test file.
 */

const fs = require('fs');
const path = require('path');

const {
  analyze,
  doublesFirebase,
  findWipeCollisions,
  isNamespaced,
  referencedSegments,
  resolvesIdTokens,
  touchesRealEmulator,
  unresolvedSegments,
  wipedCollections,
  wipesDefaultAuthProject,
} = require('../helpers/test-isolation-analyzer');

const TESTS_ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(TESTS_ROOT, 'fixtures', 'isolation-guard');
const rel = (f) => path.relative(path.join(TESTS_ROOT, '..'), f);

const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

function allTestFiles(dir = TESTS_ROOT, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) allTestFiles(full, acc);
    else if (entry.name.endsWith('.test.js')) acc.push(full);
  }
  return acc;
}

/**
 * Follow a relative `require` so a collection name that lives in another module
 * (`const { SAFETY_AUDIT_COLLECTION } = require('../../src/safety/safety-audit')`)
 * still counts this file as a user of that collection. Cached: the corpus scan
 * would otherwise re-read and re-parse the same handful of modules hundreds of
 * times. Only the analyzer's `unresolvedSegments` path uses it, and only for
 * relative specifiers.
 */
const moduleCache = new Map();
const readModuleFrom = (testFile) => (specifier) => {
  const base = path.resolve(path.dirname(testFile), specifier);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (!moduleCache.has(candidate)) {
      const exists = fs.existsSync(candidate) && fs.statSync(candidate).isFile();
      moduleCache.set(candidate, exists ? fs.readFileSync(candidate, 'utf8') : null);
    }
    // A cached `null` means "this candidate path is not a file" — try the next
    // extension, never return it as the answer.
    const source = moduleCache.get(candidate);
    if (source !== null) return source;
  }
  return null;
};

const analyses = allTestFiles().map((f) =>
  analyze(rel(f), fs.readFileSync(f, 'utf8'), readModuleFrom(f)),
);
const emulatorSuites = analyses.filter((a) => a.touchesEmulator);

describe('isolation analyzer — the detector sees every form a violation can take', () => {
  test('a wipe driven by an arbitrarily-named array constant is detected', () => {
    // A hardcoded whitelist of constant names would miss `COLLECTIONS_TO_WIPE`.
    const { wipes, unresolved } = wipedCollections(fixture('wipes-via-array-const.js.txt'));
    expect([...wipes].sort()).toEqual(['deviceBans', 'rooms', 'users']);
    expect(unresolved).toEqual([]);
  });

  test('a direct string wipe is detected, for both collections and groups', () => {
    const { wipes } = wipedCollections(fixture('wipes-directly.js.txt'));
    expect([...wipes].sort()).toEqual(['backpack', 'users']);
  });

  test('a wipe target held in a plain string constant is resolved', () => {
    // Neither an inline literal nor a loop variable. Both earlier versions of
    // this analyzer were blind to it, and three real suites use this shape.
    const { wipes, unresolved } = wipedCollections(fixture('wipes-via-string-const.js.txt'));
    expect([...wipes]).toEqual(['segregationEvents']);
    expect(unresolved).toEqual([]);
  });

  test('two for-of loops sharing a variable name do not shadow each other', () => {
    // A file-global name→array map lets the LAST declaration win, hiding the wipe.
    const { wipes, unresolved } = wipedCollections(fixture('wipes-with-shadowed-loop-var.js.txt'));
    expect([...wipes].sort()).toEqual(['rooms', 'users']);
    expect(wipes.has('scratch')).toBe(false);
    expect(unresolved).toEqual([]);
  });

  test('an unresolvable wipe target is REPORTED, never silently ignored', () => {
    const { wipes, unresolved } = wipedCollections(fixture('wipes-unresolvable-target.js.txt'));
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([expect.stringMatching(/MemberExpression.*cannot be resolved/)]);
  });

  test('a spread-built wipe list is REPORTED, never silently ignored', () => {
    const { wipes, unresolved } = wipedCollections(fixture('wipes-via-spread-array.js.txt'));
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([
      expect.stringMatching(/'ALL' is built from spreads or expressions/),
    ]);
  });

  test('a suite that doubles firebase with jest.doMock is NOT an emulator suite', () => {
    // `jest.doMock` (scoped) doubles just as surely as the hoisted `jest.mock`.
    const source = fixture('doubles-firebase-via-domock.js.txt');
    expect(doublesFirebase(source)).toBe(true);
    expect(touchesRealEmulator(source)).toBe(false);
  });

  test('a Firestore path whose leading name is a LOCAL constant needs no report', () => {
    // `const ROOMS = 'rooms'` is itself a string literal, so `referencedSegments`
    // already counts this file as a user of `rooms`. Nothing is hidden.
    const source = ["const ROOMS = 'rooms';", 'db.doc(`${ROOMS}/${roomId}`).set({});'].join('\n');
    expect(referencedSegments(source).has('rooms')).toBe(true);
    expect(unresolvedSegments(source)).toEqual([]);
  });

  test('a Firestore path whose leading name is a FUNCTION PARAMETER needs no report', () => {
    // Its arguments are supplied at call sites in this file, as string literals.
    const source = [
      'function seedParent(collection, id) {',
      '  return db.doc(`${collection}/${id}`).set({});',
      '}',
      "seedParent('conversations', 'c1');",
    ].join('\n');
    expect(referencedSegments(source).has('conversations')).toBe(true);
    expect(unresolvedSegments(source)).toEqual([]);
  });

  test('REPORTS: a Firestore path whose leading name is IMPORTED — the victim side would go blind', () => {
    // Under-approximating the victim side is the one direction findWipeCollisions
    // cannot tolerate: a sibling's wholesale wipe of this collection would pass.
    const source = [
      "const { ROOMS } = require('./collection-names');",
      'db.doc(`${ROOMS}/${roomId}`).set({});',
    ].join('\n');
    expect(referencedSegments(source).has('rooms')).toBe(false); // the name appears nowhere
    expect(unresolvedSegments(source)).toEqual([
      expect.stringMatching(/'ROOMS' is not a local string constant/),
    ]);
  });

  test('REPORTS: a bare-Identifier Firestore path whose name is IMPORTED and unreadable', () => {
    // The commonest shape by far — `db.doc(SAFETY_DOC)` — and the one the first
    // version of this check never looked at (reviewer R14-C1).
    const source = [
      "const { SAFETY_DOC } = require('./collection-names');",
      'db.doc(SAFETY_DOC).get();',
    ].join('\n');
    expect(unresolvedSegments(source)).toEqual([
      expect.stringMatching(/'SAFETY_DOC' is not a local string constant/),
    ]);
  });

  test('RESOLVES: an imported name, when the module can be read', () => {
    const readModule = (spec) =>
      spec === './collection-names' ? "const SAFETY_DOC = 'safetyAudit';" : null;
    const source = [
      "const { SAFETY_DOC } = require('./collection-names');",
      'db.doc(SAFETY_DOC).get();',
    ].join('\n');
    expect(unresolvedSegments(source, readModule)).toEqual([]);
  });

  test('REPORTS: a leading-slash template — a separator is not a collection name', () => {
    // `quasis[0].cooked === '/'` is non-empty, so a naive "starts with literal
    // text" check short-circuits past an unreadable identifier (reviewer R14-C1).
    const source = [
      "const { ROOMS } = require('./collection-names');",
      'db.doc(`/${ROOMS}/${id}`).get();',
    ].join('\n');
    expect(unresolvedSegments(source)).toEqual([
      expect.stringMatching(/'ROOMS' is not a local string constant/),
    ]);
  });

  test('REPORTS: a path built by concatenation, and any other unhandled shape', () => {
    // Fail closed on shapes the analyzer does not understand, exactly as the
    // wipe side does — an allowlist is how the victim side went blind.
    expect(unresolvedSegments("const R = 'rooms'; db.doc(R + '/' + id).get();")).toEqual([
      expect.stringMatching(/the path is a BinaryExpression/),
    ]);
    expect(unresolvedSegments('db.collection(namesFor(x)).get();')).toEqual([
      expect.stringMatching(/the path is a CallExpression/),
    ]);
  });

  test('REPORTS: a loop over names this file never spells out', () => {
    const source = [
      "const { NAMES } = require('./collection-names');",
      'for (const c of NAMES) db.collection(c).get();',
    ].join('\n');
    expect(unresolvedSegments(source)).toEqual([
      expect.stringMatching(/'c' iterates names this file never spells out/),
    ]);
  });

  test('a document-id slot hides no collection — `users/${uid}` needs no report', () => {
    expect(unresolvedSegments('db.doc(`users/${uid}`).get();')).toEqual([]);
  });

  test('REPORTS: a SUBCOLLECTION slot whose name is imported (not just the leading one)', () => {
    // `users/${uid}/${SUBCOL}/${id}` — segment 2 names a collection. Checking
    // only the head because the leading text reads fine is the same allowlist
    // mistake, one level in (reviewer R15-I1).
    const source = [
      "const { SUBCOL } = require('./collection-names');",
      'db.doc(`users/${uid}/${SUBCOL}/${id}`).set({});',
    ].join('\n');
    expect(unresolvedSegments(source)).toEqual([
      expect.stringMatching(/'SUBCOL' is not a local string constant/),
    ]);
  });

  test('a locally-named subcollection slot needs no report', () => {
    const source = ["const SUB = 'backpack';", 'db.doc(`users/${uid}/${SUB}/${id}`).set({});'].join(
      '\n',
    );
    expect(unresolvedSegments(source)).toEqual([]);
  });

  test('a chained `.doc(id)` takes a document id, not a path', () => {
    // `db.collection(SPEC).doc(`p${i}`)` — the `.doc()` argument names nothing.
    const source = ["const SPEC = 'spec';", 'db.collection(SPEC).doc(`p${i}`).set({});'].join('\n');
    expect(unresolvedSegments(source)).toEqual([]);
  });

  test('REPORTS: a chained `.collection(name)` whose name is imported', () => {
    const source = [
      "const { SUB } = require('./collection-names');",
      "db.collection('users').doc('u1').collection(SUB).get();",
    ].join('\n');
    expect(unresolvedSegments(source)).toEqual([
      expect.stringMatching(/'SUB' is not a local string constant/),
    ]);
  });

  test('a helper parameter is readable when every call site passes a readable path', () => {
    const source = [
      'const seed = (path, data) => db.doc(path).set(data);',
      "seed('gifts/g1', {});",
      'seed(`${col}/stale`, {});',
      "const col = 'rooms';",
    ].join('\n');
    expect(unresolvedSegments(source)).toEqual([]);
  });

  test('REPORTS: a helper parameter whose call sites do not all pass a readable path', () => {
    // Trusting the parameter without checking its call sites is how the victim
    // side went blind in the first place (reviewer R15-I2).
    const source = [
      "const { HIDDEN } = require('./collection-names');",
      'const seed = (path, data) => db.doc(path).set(data);',
      "seed('gifts/g1', {});",
      'seed(`${HIDDEN}/x`, {});',
    ].join('\n');
    expect(unresolvedSegments(source)).toEqual([
      expect.stringMatching(/'path' is a parameter whose call sites do not all pass/),
    ]);
  });

  test('REPORTS: a self-referential constant, without hanging', () => {
    // Babel parses `const A = `${A}`` happily; Node would throw a TDZ error. The
    // analyzer must not recurse forever (reviewer R15-I4).
    expect(unresolvedSegments('const A = `${A}`; db.doc(A).get();')).toEqual([
      expect.stringMatching(/'A' is defined in terms of itself/),
    ]);
  });

  test('REPORTS: a Firestore path whose leading name is never declared', () => {
    expect(unresolvedSegments('db.collection(`${MYSTERY}/${id}`).get();')).toEqual([
      expect.stringMatching(/'MYSTERY' is not a local string constant/),
    ]);
  });

  test('a collection name inside a route path counts as a use (deliberate over-approximation)', () => {
    // Documented trade-off: a false positive costs one namespace; a false
    // negative costs a scheduling-dependent flake.
    expect(referencedSegments(fixture('uses-collection-name-in-url.js.txt')).has('users')).toBe(
      true,
    );
  });

  test('a subcollection buried mid-path in a template literal counts as a use', () => {
    // `users/${uid}/backpack/${id}` — a quote-anchored scan never sees `backpack`.
    const segments = referencedSegments(fixture('uses-subcollection-midpath.js.txt'));
    expect(segments.has('backpack')).toBe(true);
    expect(segments.has('users')).toBe(true);
  });

  test('comments never register as code, and code inside strings never registers as a comment', () => {
    // Contains: a docblock naming clearCollection; a string holding `a // b`;
    // a regex literal `/https?:\/\//`; and one real wipe.
    const source = fixture('comments-and-lookalikes.js.txt');
    expect([...wipedCollections(source).wipes]).toEqual(['rooms']);
    expect(isNamespaced(source)).toBe(false);
    expect(wipesDefaultAuthProject(source)).toBe(true); // the URL string survives
  });

  test('a real-emulator suite is recognised even when named like a unit test', () => {
    // The `.unit.test.js` naming convention must not be an escape hatch.
    expect(touchesRealEmulator(fixture('real-emulator-suite.js.txt'))).toBe(true);
  });

  test('a suite that doubles firebase is NOT an emulator suite', () => {
    expect(touchesRealEmulator(fixture('mocks-firebase.js.txt'))).toBe(false);
  });

  test('namespacing is recognised by assignment, not by mention', () => {
    expect(isNamespaced(fixture('mentions-namespace-only.js.txt'))).toBe(false);
    expect(isNamespaced(fixture('wipes-via-array-const.js.txt'))).toBe(true);
  });

  test('token resolution is detected through both bare and member calls', () => {
    expect(resolvesIdTokens(fixture('real-emulator-suite.js.txt'))).toBe(true);
    expect(resolvesIdTokens(fixture('wipes-directly.js.txt'))).toBe(false);
  });

  test('findWipeCollisions reports a genuine collision and stays silent on a namespaced one', () => {
    const wiper = analyze('wiper.test.js', fixture('wipes-directly.js.txt'));
    const victim = analyze('victim.test.js', fixture('uses-subcollection-midpath.js.txt'));
    // The victim's `users/${uid}/backpack/${id}` path uses BOTH collections the
    // wiper clears, so both collide; violations are reported collection-sorted.
    expect(findWipeCollisions([wiper, victim])).toEqual([
      expect.stringContaining("wiper.test.js wipes 'backpack'"),
      expect.stringContaining("wiper.test.js wipes 'users'"),
    ]);

    const namespacedWiper = analyze('wiper.test.js', fixture('wipes-via-array-const.js.txt'));
    expect(findWipeCollisions([namespacedWiper, victim])).toEqual([]);
  });
});

/**
 * Every outcome `wipedCollections` can produce, one case each. Sources are inline
 * because each is 3-6 lines and lives or dies by one syntactic detail; a reader
 * comparing two rows should not have to open two files. (The richer, more
 * file-shaped scenarios stay in `tests/fixtures/isolation-guard/`.)
 *
 * The contract: RESOLVE what is statically knowable, REPORT what is not. Never
 * return an empty set for a wipe that happened.
 */
describe('wipedCollections — every branch resolves or reports, none silently ignores', () => {
  const preamble = [
    "const { db } = require('../../src/utils/firebase');",
    "const { clearCollection, clearCollectionGroup } = require('../helpers/firebase-emulator');",
  ].join('\n');
  const analyseBody = (body) => wipedCollections(`${preamble}\n${body}`);

  test('RESOLVES: an inline array of string literals', () => {
    const { wipes, unresolved } = analyseBody(
      "for (const c of ['users', 'rooms']) clearCollection(db, c);",
    );
    expect([...wipes].sort()).toEqual(['rooms', 'users']);
    expect(unresolved).toEqual([]);
  });

  test('RESOLVES: `let` loop bindings, not just `const`', () => {
    const { wipes } = analyseBody("for (let c of ['users']) clearCollection(db, c);");
    expect([...wipes]).toEqual(['users']);
  });

  test('a member-expression wipe call is seen, not silently skipped', () => {
    // `helpers.clearCollection(db, x)` — a different import style must not make
    // the wipe invisible (reviewer R15-I3).
    const { wipes, unresolved } = analyseBody(
      [
        "const helpers = require('../helpers/firebase-emulator');",
        "helpers.clearCollection(db, 'users');",
      ].join('\n'),
    );
    expect([...wipes]).toEqual(['users']);
    expect(unresolved).toEqual([]);
  });

  test('REPORTS: a member-expression wipe call with an unresolvable target', () => {
    const { wipes, unresolved } = analyseBody(
      [
        "const helpers = require('../helpers/firebase-emulator');",
        'helpers.clearCollection(db, mystery);',
      ].join('\n'),
    );
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([
      expect.stringMatching(/'mystery' is neither a loop variable nor a string constant/),
    ]);
  });

  test('REPORTS: a wipe call with no collection argument', () => {
    const { wipes, unresolved } = analyseBody('clearCollection(db);');
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([expect.stringMatching(/no collection argument/)]);
  });

  test('RESOLVES: two constants of one name — the NEAREST binding wins, exactly', () => {
    // Not "ambiguous": JS forbids two declarations in one block, so the nearest
    // enclosing one is the only thing the wipe can refer to. Answer, don't report.
    const { wipes, unresolved } = analyseBody(
      [
        "const COLLECTIONS = ['users'];",
        'function elsewhere() {',
        "  const COLLECTIONS = ['scratch'];",
        '  for (const c of COLLECTIONS) clearCollection(db, c);',
        '}',
        'elsewhere();',
      ].join('\n'),
    );
    expect([...wipes]).toEqual(['scratch']); // NOT 'users' — the outer one is shadowed
    expect(unresolved).toEqual([]);
  });

  test('RESOLVES: a block-scoped redeclaration of the loop variable', () => {
    // `for (const c of WIPED) { { const c = 'other'; clear(db, c) } }` clears
    // 'other'. Name-only matching confidently reports WIPED's contents instead.
    const { wipes, unresolved } = analyseBody(
      [
        "const WIPED = ['users'];",
        'beforeEach(() => {',
        '  for (const c of WIPED) {',
        "    { const c = 'other'; clearCollection(db, c); }",
        '  }',
        '});',
      ].join('\n'),
    );
    expect([...wipes]).toEqual(['other']);
    expect(unresolved).toEqual([]);
  });

  test('REPORTS: a constant that is declared, but not as a string literal', () => {
    const { wipes, unresolved } = analyseBody(
      ['const NAME = buildName();', 'beforeEach(() => clearCollection(db, NAME));'].join('\n'),
    );
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([
      expect.stringMatching(/'NAME' is declared, but not as a string literal/),
    ]);
  });

  test('REPORTS: a for-of over an identifier that is never declared at all', () => {
    const { wipes, unresolved } = analyseBody('for (const c of NEVER) clearCollection(db, c);');
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([expect.stringMatching(/'NEVER' is not a declared array constant/)]);
  });

  test('REPORTS: a loop variable shadowed by a callback parameter — never a wrong answer', () => {
    // `for (const c of WIPED) other.forEach((c) => clear(db, c))` clears the
    // CALLBACK's `c`, not the loop's. Resolving it to WIPED would be a silent
    // wrong answer — the one outcome this analyzer must never produce.
    const { wipes, unresolved } = analyseBody(
      [
        "const WIPED = ['users'];",
        "const other = ['scratch'];",
        'beforeEach(async () => {',
        '  for (const c of WIPED) other.forEach((c) => clearCollection(db, c));',
        '});',
      ].join('\n'),
    );
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([
      expect.stringMatching(/'c' is shadowed by a ArrowFunctionExpression parameter/),
    ]);
  });

  test('REPORTS: a loop variable shadowed by a catch parameter', () => {
    const { wipes, unresolved } = analyseBody(
      [
        "const WIPED = ['users'];",
        'beforeEach(async () => {',
        '  for (const c of WIPED) {',
        '    try { boom(); } catch (c) { clearCollection(db, c); }',
        '  }',
        '});',
      ].join('\n'),
    );
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([expect.stringMatching(/shadowed by a CatchClause parameter/)]);
  });

  test('REPORTS: a destructuring loop binding, which names no single collection', () => {
    const { wipes, unresolved } = analyseBody(
      'for (const [k, v] of Object.entries({})) clearCollection(db, k);',
    );
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([expect.stringMatching(/shadowed by a ArrayPattern loop binding/)]);
  });

  test('REPORTS: an identifier that is neither a loop variable nor any constant', () => {
    const { wipes, unresolved } = analyseBody('beforeEach(() => clearCollection(db, mystery));');
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([
      expect.stringMatching(/'mystery' is neither a loop variable nor a string constant/),
    ]);
  });

  test('REPORTS: an inline array holding a non-literal element', () => {
    const { wipes, unresolved } = analyseBody(
      "for (const c of ['users', someVar]) clearCollection(db, c);",
    );
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([expect.stringMatching(/is not all string literals/)]);
  });

  test('REPORTS: a for-of over a call expression', () => {
    const { wipes, unresolved } = analyseBody('for (const c of listOf()) clearCollection(db, c);');
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([expect.stringMatching(/'c' iterates a CallExpression/)]);
  });

  test('REPORTS: a for-of over an identifier that is not a literal array constant', () => {
    const { wipes, unresolved } = analyseBody(
      ['const ALL = buildList();', 'for (const c of ALL) clearCollection(db, c);'].join('\n'),
    );
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([expect.stringMatching(/'ALL' is not a literal array constant/)]);
  });

  test('REPORTS: a hoisted `var` shadowing an outer constant, from a nested block', () => {
    // `var` is function-scoped: a `var SEG` inside an `if` shadows an outer
    // `const SEG` for the WHOLE function body, including lines above it, and its
    // value depends on the branch. The repo bans `var`, so this cannot fire
    // today — the test exists so relaxing `no-var` cannot silently reintroduce
    // a wrong answer.
    const { wipes, unresolved } = analyseBody(
      [
        "const SEG = 'segregationEvents';",
        'function setup() {',
        "  if (cond) { var SEG = 'other'; }",
        '  clearCollection(db, SEG);',
        '}',
        'setup();',
      ].join('\n'),
    );
    expect([...wipes]).toEqual([]); // NOT 'segregationEvents'
    expect(unresolved).toEqual([
      expect.stringMatching(/'SEG' is shadowed by a hoisted var declaration/),
    ]);
  });

  test('REPORTS: a function declaration shadowing a same-named outer constant', () => {
    const { wipes, unresolved } = analyseBody(
      [
        "const NAME = 'users';",
        'function outer() {',
        '  function NAME() {}',
        '  clearCollection(db, NAME);',
        '}',
        'outer();',
      ].join('\n'),
    );
    expect([...wipes]).toEqual([]); // NOT 'users'
    expect(unresolved).toEqual([
      expect.stringMatching(/'NAME' is declared, but not as a string literal/),
    ]);
  });

  test('REPORTS: a class declaration shadowing a same-named outer constant', () => {
    const { wipes, unresolved } = analyseBody(
      [
        "const NAME = 'users';",
        'function outer() {',
        '  class NAME {}',
        '  clearCollection(db, NAME);',
        '}',
        'outer();',
      ].join('\n'),
    );
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([
      expect.stringMatching(/'NAME' is declared, but not as a string literal/),
    ]);
  });

  test('RESOLVES: doubling the Admin SDK itself counts as doubling firebase', () => {
    expect(doublesFirebase("jest.mock('firebase-admin', () => ({}));")).toBe(true);
    expect(doublesFirebase("jest.doMock('firebase-admin/firestore', () => ({}));")).toBe(true);
    expect(doublesFirebase("jest.mock('firebase-admin-lookalike', () => ({}));")).toBe(false);
  });
});

describe('test-isolation guard — a wholesale wipe requires an exclusive emulator project', () => {
  // A corpus check passes trivially once no wipers remain, so pin the POPULATION
  // by name: a known real-emulator suite must be in it, a known doubled suite
  // must not, and known wipers must be seen as wiping the collections they wipe.
  test('the population is real: named suites land on the correct side of the line', () => {
    const byName = (needle) => analyses.find((a) => a.file.endsWith(needle));

    expect(byName('middleware/auth-ban-gate.test.js').touchesEmulator).toBe(true);
    expect(byName('unit/bans.unit.test.js').touchesEmulator).toBe(false);
    // Doubles firebase only via `jest.doMock` — previously misclassified as real.
    expect(byName('utils/loggerInstance.test.js').touchesEmulator).toBe(false);

    const testData = byName('cron/testDataCleanup.test.js');
    expect(testData.namespaced).toBe(true);
    expect([...testData.wipes]).toEqual(expect.arrayContaining(['users', 'deviceBans']));

    const accountDeletion = byName('cron/accountDeletion.test.js');
    expect(accountDeletion.namespaced).toBe(true);
    expect(accountDeletion.wipesDefaultAuthProject).toBe(false);
  });

  test('the scan sees emulator suites, wipers and namespaced suites (not vacuous)', () => {
    expect(emulatorSuites.length).toBeGreaterThan(50);
    expect(emulatorSuites.filter((a) => a.wipes.size > 0).length).toBeGreaterThan(5);
    expect(emulatorSuites.filter((a) => a.namespaced).length).toBeGreaterThan(5);
    // Doubled suites exist and are correctly excluded from the population.
    expect(analyses.length).toBeGreaterThan(emulatorSuites.length);
  });

  test('no non-namespaced suite wipes a collection another non-namespaced suite uses', () => {
    expect(findWipeCollisions(analyses)).toEqual([]);
  });

  test('every Firestore path in an emulator suite names a collection the guard can read', () => {
    // A path like `db.doc(SAFETY_DOC)` or `db.doc(`${IMPORTED}/${id}`)` hides
    // which collection this file uses, so a sibling's wipe of it would not be
    // reported as a collision. Doubled suites are exempt: their `db.collection()`
    // is a mock and reads no real data.
    const blind = emulatorSuites
      .filter((a) => a.unresolvedSegments.length > 0)
      .map((a) => `${a.file}: ${a.unresolvedSegments.join('; ')}`);
    expect(blind).toEqual([]);
  });

  test('a collection name imported from another module still counts as a use', () => {
    // `tests/safety/safety-audit.test.js` never spells 'safetyAudit' — it imports
    // SAFETY_AUDIT_COLLECTION from src/safety/safety-audit.js. Before the analyzer
    // followed that require, the file was invisible as a user of the collection.
    const safetyAudit = analyses.find((a) => a.file.endsWith('safety/safety-audit.test.js'));
    expect(safetyAudit.segments.has('safetyAudit')).toBe(true);
    expect(safetyAudit.unresolvedSegments).toEqual([]);
  });

  test('every wipe in the corpus is statically resolvable — the guard never guesses', () => {
    // A wipe the analyzer cannot resolve is a hole in the guard. Fail loudly and
    // make the author either simplify the wipe or teach the analyzer the shape.
    const blind = analyses
      .filter((a) => a.unresolvedWipes.length > 0)
      .map((a) => `${a.file}: ${a.unresolvedWipes.join('; ')}`);
    expect(blind).toEqual([]);
  });

  test('no doubled suite wipes — a wiper cannot hide behind a firebase double', () => {
    // Doubled suites are excluded from the collision scan, so a wiper among them
    // would go unchecked. There are none; keep it that way.
    const hidden = analyses.filter((a) => a.doublesFirebase && a.wipes.size > 0).map((a) => a.file);
    expect(hidden).toEqual([]);
  });

  test('no suite wipes the Auth accounts of the shared default project', () => {
    // `DELETE /emulator/v1/projects/demo-shytalk/accounts` deletes the Firebase
    // users behind every ID token a sibling suite just minted. A suite that
    // needs this must claim its own project and derive the URL from it.
    expect(analyses.filter((a) => a.wipesDefaultAuthProject).map((a) => a.file)).toEqual([]);
  });

  test('a namespaced suite never resolves ID tokens (the one thing a namespace breaks)', () => {
    const offenders = emulatorSuites
      .filter((a) => a.namespaced && a.resolvesTokens)
      .map((a) => a.file);
    expect(offenders).toEqual([]);
  });
});
