/**
 * check-no-direct-backend.test.js — SHY-0168 (EPIC-0006) ratchet guard tests.
 *
 * Verifies the guard that blocks any NEW direct client→backend-service access
 * (Firestore / RTDB / Storage) — clients must go through the Express API
 * (feedback-no-direct-backend-all-via-api). Pure-logic unit tests over the
 * exported functions (a permitted unit-test location: `*.test.js` under
 * tests/scripts, no real collaborator touched).
 */
const {
  classifyContent,
  isClientProductionCode,
  scanFiles,
  diffBaseline,
  isClean,
  CATEGORIES,
} = require('../../../scripts/check-no-direct-backend.js');

const EMPTY_BASE = () => Object.fromEntries(CATEGORIES.map((c) => [c.key, []]));

describe('detection — classifyContent matches BOTH SDK namespaces', () => {
  test('Android native Firestore import → firestore', () => {
    expect(
      classifyContent('import com.google.firebase.firestore.FirebaseFirestore').firestore,
    ).toBe(true);
  });

  // MUTATION SENTINEL: drop the gitlive alternation from the firestore regex and
  // this goes RED — proves the guard is not Android-only (half the violations are iOS).
  test('iOS gitlive Firestore import → firestore (not just Android)', () => {
    expect(classifyContent('import dev.gitlive.firebase.firestore.firestore').firestore).toBe(true);
  });

  test('Android RTDB import → rtdb', () => {
    expect(classifyContent('import com.google.firebase.database.FirebaseDatabase').rtdb).toBe(true);
  });

  test('iOS gitlive RTDB import → rtdb', () => {
    expect(classifyContent('import dev.gitlive.firebase.database.database').rtdb).toBe(true);
  });

  test('FirebaseDatabase.getInstance self-construct → rtdb (Android services)', () => {
    expect(
      classifyContent('val db = com.google.firebase.database.FirebaseDatabase.getInstance(url)')
        .rtdb,
    ).toBe(true);
  });

  test('Storage (both namespaces) → storage, even though currently zero sites', () => {
    expect(classifyContent('import com.google.firebase.storage.FirebaseStorage').storage).toBe(
      true,
    );
    expect(classifyContent('import dev.gitlive.firebase.storage.storage').storage).toBe(true);
  });

  test('web Firestore data usage → webData', () => {
    expect(classifyContent('const db = getFirestore(app);').webData).toBe(true);
    expect(classifyContent('onSnapshot(ref, (s) => {});').webData).toBe(true);
    expect(classifyContent('firebase.database().ref("x")').webData).toBe(true);
  });

  test('Firebase Auth is NOT a data-plane violation (operator ruling pending)', () => {
    const hit = classifyContent('import com.google.firebase.auth.FirebaseAuth');
    expect(Object.values(hit).some(Boolean)).toBe(false);
    const webHit = classifyContent('firebase.auth().signOut();');
    expect(Object.values(webHit).some(Boolean)).toBe(false);
  });

  test('clean content → no category hit', () => {
    const hit = classifyContent('class Foo { fun bar() = 42 }');
    expect(Object.values(hit).some(Boolean)).toBe(false);
  });

  // PRECISION SENTINEL: a web comment or variable that merely mentions
  // onSnapshot must NOT count — only a real call (`onSnapshot(`). Revert the
  // web regex to a bare `\bonSnapshot\b` and this goes RED.
  test('web comment / variable mentioning onSnapshot is NOT a hit (call-paren required)', () => {
    expect(classifyContent('// Uses Firestore onSnapshot for live mode').webData).toBe(false);
    expect(classifyContent('let _onSnapshot = null;').webData).toBe(false);
    expect(classifyContent(' * @param deps.firestoreFns { onSnapshot }').webData).toBe(false);
  });
});

describe('scoping — isClientProductionCode (include-list of shipped client source sets)', () => {
  test.each([
    'app/src/main/java/com/shyden/shytalk/data/RoomRepositoryImpl.kt',
    'shared/src/commonMain/kotlin/com/shyden/shytalk/data/Foo.kt',
    'shared/src/androidMain/kotlin/com/shyden/shytalk/data/Foo.kt',
    'shared/src/iosMain/kotlin/com/shyden/shytalk/data/IosSmallRepositories.kt',
    'public/js/portal.js',
    'public/admin/js/main.js',
  ])('IS client production: %s', (p) => {
    expect(isClientProductionCode(p)).toBe(true);
  });

  test.each([
    'express-api/src/routes/rooms.js', // the SANCTIONED server Admin SDK channel — never flag
    'app/src/test/java/com/shyden/shytalk/AuthViewModelTest.kt', // host unit test
    'app/src/androidTest/java/com/shyden/shytalk/steps/PinSteps.kt', // instrumented test
    'shared/src/commonTest/kotlin/com/shyden/shytalk/Foo.kt',
    'shared/src/jvmTest/kotlin/com/shyden/shytalk/Foo.kt',
    'shared/src/androidHostTest/kotlin/com/shyden/shytalk/Foo.kt',
    'shared/build/generated/foo.kt', // generated
    'scripts/check-no-direct-backend.js', // the guard itself
  ])('is NOT client production: %s', (p) => {
    expect(isClientProductionCode(p)).toBe(false);
  });
});

describe('scanFiles — buckets client files by category', () => {
  test('an iOS repo with gitlive Firestore is bucketed under firestore', () => {
    const off = scanFiles(
      ['shared/src/iosMain/kotlin/com/shyden/shytalk/data/IosSmallRepositories.kt'],
      () => 'import dev.gitlive.firebase.firestore.firestore\nfirestore.collection("users")',
    );
    expect(off.firestore).toContain(
      'shared/src/iosMain/kotlin/com/shyden/shytalk/data/IosSmallRepositories.kt',
    );
  });

  test('a web file with onSnapshot is bucketed under webData', () => {
    const off = scanFiles(['public/js/portal.js'], () => 'onSnapshot(ref, cb)');
    expect(off.webData).toContain('public/js/portal.js');
  });

  test('a Kotlin category does not bucket a web file (applies gate)', () => {
    const off = scanFiles(['public/js/x.js'], () => 'import com.google.firebase.firestore.X');
    expect(off.firestore).toEqual([]);
  });
});

describe('ratchet diff — the set may only shrink', () => {
  test('NEW offender absent from baseline → not clean', () => {
    const off = { ...EMPTY_BASE(), firestore: ['shared/src/iosMain/New.kt'] };
    const diff = diffBaseline(off, EMPTY_BASE());
    expect(isClean(diff)).toBe(false);
    expect(diff.newOffenders.firestore).toContain('shared/src/iosMain/New.kt');
  });

  test('offenders == baseline → clean (remediation not blocked)', () => {
    const off = { ...EMPTY_BASE(), firestore: ['a.kt', 'b.kt'] };
    expect(isClean(diffBaseline(off, { ...EMPTY_BASE(), firestore: ['a.kt', 'b.kt'] }))).toBe(true);
  });

  test('STALE baseline entry (file remediated) → not clean, surfaced to trim', () => {
    const diff = diffBaseline(EMPTY_BASE(), { ...EMPTY_BASE(), firestore: ['remediated.kt'] });
    expect(isClean(diff)).toBe(false);
    expect(diff.staleEntries.firestore).toContain('remediated.kt');
  });
});

describe('fail-closed — malformed baseline throws (never a false green)', () => {
  test('loadBaseline throws on malformed JSON', () => {
    const { loadBaseline } = require('../../../scripts/check-no-direct-backend.js');
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndb-'));
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'direct-backend-baseline.json'), '{ not json');
    expect(() => loadBaseline({ cwd: dir })).toThrow(/malformed/i);
  });

  test('loadBaseline throws when the baseline file is absent', () => {
    const { loadBaseline } = require('../../../scripts/check-no-direct-backend.js');
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndb-'));
    expect(() => loadBaseline({ cwd: dir })).toThrow(/not found/i);
  });
});
