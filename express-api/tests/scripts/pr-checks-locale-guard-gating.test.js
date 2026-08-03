/**
 * pr-checks-locale-guard-gating.test.js — SHY-0271.
 *
 * Pins that a locale-only PR actually RUNS the guard that protects the locale
 * corpus.
 *
 * The corpus lives in `shared/src/commonMain/composeResources/`, but the tests
 * that check its CONTENT live in express-api. Before this pin, `shared/*` set
 * only the app flags, so `test-backend` was skipped on a locale-only PR and the
 * content guard ran solely by accident — inside the sonarcloud job, which
 * happens to invoke the whole Jest suite unfiltered. Narrowing that one step to
 * a test-path pattern would have silently disarmed the guard with nothing to
 * notice.
 *
 * Static pin over the workflow YAML, matching the convention of
 * `pr-checks-backend-forces-full.test.js` and `pr-checks-ios-gating.test.js`.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const yml = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/pr-checks.yml'), 'utf8');
const jestConfig = require('../../jest.config.js');

/** The detect-changes arm itself, at a line start so comments cannot match. */
const ARM_RE = /^\s{2,}shared\/src\/commonMain\/composeResources\/\*\)/;

const GUARDS = [
  'tests/scripts/locale-string-content.test.js',
  'tests/scripts/compose-resources-locale-parity.test.js',
];

describe('SHY-0271 — a locale-only PR runs the locale guards', () => {
  test('composeResources has its own detect-changes arm', () => {
    expect(yml).toContain('shared/src/commonMain/composeResources/*)');
  });

  test('that arm sets BACKEND, so the job running the guards is not skipped', () => {
    // Anchored on a line START, not a raw indexOf: a future COMMENT quoting the
    // arm text would otherwise satisfy these assertions while the real arm was
    // gone or misplaced — a pin that passes while guarding nothing.
    const armLine = yml.split('\n').find((l) => ARM_RE.test(l));
    expect(armLine).toBeDefined();
    expect(armLine).toMatch(/BACKEND=true/);
  });

  test('the arm precedes the generic shared/* arm (case is first-match)', () => {
    // Ordering is load-bearing: shell `case` takes the first matching arm, so a
    // composeResources arm placed after `shared/*` would never be reached.
    const lines = yml.split('\n');
    const specific = lines.findIndex((l) => ARM_RE.test(l));
    const generic = lines.findIndex((l) => /^\s{2,}shared\/\*\)/.test(l));
    expect(specific).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(-1);
    expect(specific).toBeLessThan(generic);
  });

  test('test-backend gates on backend_changed, which the arm now sets', () => {
    const job = yml.slice(yml.indexOf('  test-backend:'), yml.indexOf('  test-backend:') + 400);
    expect(job).toMatch(/needs\.detect-changes\.outputs\.backend_changed == 'true'/);
  });

  test('the guard files exist and are not excluded from the Jest run', () => {
    // A pin that points at a moved or renamed file is worse than no pin: it
    // stays green while guarding nothing.
    for (const rel of GUARDS) {
      expect(fs.existsSync(path.join(__dirname, '../..', rel))).toBe(true);
    }
    const ignored = jestConfig.testPathIgnorePatterns || [];
    for (const rel of GUARDS) {
      expect(ignored.some((p) => new RegExp(p).test(rel))).toBe(false);
    }
  });
});
