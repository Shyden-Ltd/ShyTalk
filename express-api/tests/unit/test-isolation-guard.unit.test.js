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

const analyses = allTestFiles().map((f) => analyze(rel(f), fs.readFileSync(f, 'utf8')));
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

  test('REPORTS: a wipe call with no collection argument', () => {
    const { wipes, unresolved } = analyseBody('clearCollection(db);');
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([expect.stringMatching(/no collection argument/)]);
  });

  test('REPORTS: an array constant declared twice — which one binds is unknowable', () => {
    const { wipes, unresolved } = analyseBody(
      [
        "const COLLECTIONS = ['users'];",
        'function elsewhere() {',
        "  const COLLECTIONS = ['scratch'];",
        '  return COLLECTIONS;',
        '}',
        'beforeEach(async () => {',
        '  for (const c of COLLECTIONS) await clearCollection(db, c);',
        '});',
      ].join('\n'),
    );
    expect([...wipes]).toEqual([]); // NOT ['users'], and NOT ['scratch']
    expect(unresolved).toEqual([expect.stringMatching(/'COLLECTIONS' is declared more than once/)]);
  });

  test('REPORTS: a string constant declared twice', () => {
    const { wipes, unresolved } = analyseBody(
      [
        "const NAME = 'users';",
        'function elsewhere() {',
        "  const NAME = 'scratch';",
        '  return NAME;',
        '}',
        'beforeEach(async () => { await clearCollection(db, NAME); });',
      ].join('\n'),
    );
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([expect.stringMatching(/'NAME' is declared more than once/)]);
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
      expect.stringMatching(/'c' is shadowed by a ArrowFunctionExpression binding/),
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
    expect(unresolved).toEqual([expect.stringMatching(/shadowed by a CatchClause binding/)]);
  });

  test('REPORTS: a destructuring loop binding, which names no single collection', () => {
    const { wipes, unresolved } = analyseBody(
      'for (const [k, v] of Object.entries({})) clearCollection(db, k);',
    );
    expect([...wipes]).toEqual([]);
    expect(unresolved).toEqual([
      expect.stringMatching(/'k' is neither a loop variable nor a string constant/),
    ]);
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
