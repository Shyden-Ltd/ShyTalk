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

  // RECALL over precision (security ratchet): a DI-renamed accessor is a REAL
  // call and MUST be caught. The `_`-prefix is the established admin-console DI
  // idiom (logs.js:669 `_onSnapshot(`, spin-monitor.js:376 `_getDocs(`). A `\b`
  // left-anchor wrongly excluded these because `_` is a word char — the paren
  // (`\s*\(`) already gives the precision, so no boundary is needed.
  test('DI-renamed accessor _onSnapshot( / _getDocs( IS a hit (Finding 1 regression)', () => {
    expect(classifyContent('liveUnsub = _onSnapshot(q, cb);').webData).toBe(true);
    expect(classifyContent('const s = await _getDocs(_collection(db, "gifts"));').webData).toBe(
      true,
    );
  });

  test('modular web RTDB/Storage getters ARE hits (Finding 2 — both namespaces on web too)', () => {
    expect(classifyContent('const db = getDatabase(app);').webData).toBe(true);
    expect(classifyContent('onValue(ref(db, "x"), cb);').webData).toBe(true);
    expect(classifyContent('const st = getStorage(app);').webData).toBe(true);
  });

  test('modular Firestore reads getDocs(/getDoc( ARE hits, even without getFirestore/onSnapshot (Finding 3)', () => {
    expect(classifyContent('const snap = await getDocs(collection(db, "reports"));').webData).toBe(
      true,
    );
    expect(classifyContent('const d = await getDoc(doc(db, "u", id));').webData).toBe(true);
  });

  test('a modular import from a firebase data module IS a hit (import-source signal)', () => {
    expect(classifyContent("import { getFirestore } from 'firebase/firestore';").webData).toBe(
      true,
    );
    expect(
      classifyContent(
        "import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.0.0/firebase-database.js';",
      ).webData,
    ).toBe(true);
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

// Finding 4 — the 5 exports the first pass never touched (main, reportAndExit,
// generateBaseline, scanRepo, gitTrackedFiles), incl. the drift-catching
// "real scan == committed baseline" invariant (mirrors check-no-new-stubs.test).
// node is spawned via process.execPath (absolute — no PATH lookup, so no
// sonarjs/no-os-command-from-path); NO `git` is spawned from the test (the
// git-needing paths use the real repo; the exit-2 path uses a non-git tmp dir).
describe('integration — real repo scan, baseline sync, and CLI exit-code contract', () => {
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const REPO = path.resolve(__dirname, '../../..');
  const SCRIPT = path.join(REPO, 'scripts', 'check-no-direct-backend.js');
  const BASELINE = path.join(REPO, 'scripts', 'direct-backend-baseline.json');
  const {
    scanRepo,
    serializeBaseline,
    gitTrackedFiles,
    reportAndExit,
    diffBaseline,
    CATEGORIES,
  } = require('../../../scripts/check-no-direct-backend.js');
  const EMPTY = () => Object.fromEntries(CATEGORIES.map((c) => [c.key, []]));
  const runCli = (args, cwd) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

  test('committed baseline == a fresh real-repo scanRepo() (drift is impossible to miss)', () => {
    const live = scanRepo({ cwd: REPO });
    const committed = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    for (const cat of CATEGORIES) {
      expect((committed[cat.key] || []).slice().sort()).toEqual(live[cat.key].slice().sort());
    }
  });

  // Read-only: the exact text generateBaseline would WRITE (via serializeBaseline)
  // equals the committed baseline. Proves determinism + format WITHOUT ever
  // writing to the real tracked file (no test side-effect).
  test('serializeBaseline(scanRepo) equals the committed baseline byte-for-byte', () => {
    expect(serializeBaseline(scanRepo({ cwd: REPO }))).toBe(fs.readFileSync(BASELINE, 'utf8'));
  });

  test('CLI: clean repo → exit 0', () => {
    const r = runCli([], REPO);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no-direct-backend: clean/);
  });

  test.each(['--help', '-h'])('CLI: %s → exit 0 and prints usage', (flag) => {
    const r = runCli([flag], REPO);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/check-no-direct-backend\.js/); // the HELP banner, not just exit 0
  });

  test('CLI: non-git / no-baseline cwd → fail-closed exit 2', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndb-cli-'));
    expect(runCli([], dir).status).toBe(2);
  });

  test('reportAndExit: a new offender → returns 1 and names the file', () => {
    const off = { ...EMPTY(), firestore: ['shared/src/iosMain/New.kt'] };
    const orig = process.stderr.write;
    let captured = '';
    process.stderr.write = (s) => {
      captured += s;
      return true;
    };
    const code = reportAndExit(diffBaseline(off, EMPTY()), EMPTY());
    process.stderr.write = orig;
    expect(code).toBe(1);
    expect(captured).toMatch(/New\.kt/);
  });

  test('reportAndExit: clean diff → returns 0', () => {
    const orig = process.stdout.write;
    process.stdout.write = () => true;
    const code = reportAndExit(diffBaseline(EMPTY(), EMPTY()), EMPTY());
    process.stdout.write = orig;
    expect(code).toBe(0);
  });

  test('gitTrackedFiles: a non-git directory throws the git-failure error (never a silent empty scan)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndb-nogit-'));
    expect(() => gitTrackedFiles(dir)).toThrow(/git ls-files failed/i);
  });
});
