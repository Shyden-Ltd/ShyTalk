/**
 * pr-checks-device-e2e-deferred.test.js
 *
 * SHY-0163: the heavy device E2E jobs (android-e2e, ios-e2e) are DEFERRED off
 * the per-PR PR Gate. The CI Android emulator flakes on infrastructure — the
 * emulator process dies mid-run (`adb: device 'emulator-5554' not found` /
 * `port 5554 connection refused` ~31 min into connectedLocalDebugAndroidTest,
 * no JUnit results) — so a required PR Gate that `needs` it blocks every merge.
 * Under the MVP-sprint model real-device verification is concentrated in ONE
 * end-of-batch gauntlet on REAL devices before the develop→main promotion, so
 * the CI emulator/simulator E2E must not gate individual PRs.
 *
 * These pins lock the invariant so a future edit cannot silently re-add the
 * flaky device jobs to the required gate, and so the deferral stays honest
 * (device jobs run only on base-main, fast jobs stay per-PR).
 */

const fs = require('fs');
const path = require('path');

const PR_CHECKS = fs.readFileSync(
  path.resolve(__dirname, '../../../.github/workflows/pr-checks.yml'),
  'utf8',
);

// Slice a job body: from `  <name>:` (2-space indent) to the next 2-space job
// header (or EOF). Line-based + bounded — no backtracking regex over the
// whole file.
// A top-level job header: exactly 2-space indent, a lowercase-led
// kebab/snake identifier, then a trailing colon. The char-class checks are
// deliberately UNQUANTIFIED single-char `.test`s — a `[a-z0-9_-]*:` regex
// would trip sonarjs/slow-regex (quantified class before a literal = a
// backtracking point). This form cannot backtrack super-linearly.
function isJobHeader(line) {
  if (!line.startsWith('  ') || line.startsWith('   ')) return false;
  if (!line.endsWith(':') || line.length < 4) return false;
  const name = line.slice(2, -1);
  return /^[a-z]/.test(name) && !/[^a-z0-9_-]/.test(name);
}

function jobSection(name) {
  const lines = PR_CHECKS.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isJobHeader(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

const gate = jobSection('gate');
const androidE2e = jobSection('android-e2e');
const iosE2e = jobSection('ios-e2e');

// The gate's needs is a single-line list; parse it into trimmed job names.
// Pure string slicing (no regex) — a `[^\]]*]` capture trips sonarjs/slow-regex.
function gateNeeds() {
  const line = gate.split('\n').find((l) => l.trim().startsWith('needs: ['));
  if (!line) return [];
  const open = line.indexOf('[');
  const close = line.indexOf(']', open + 1);
  if (open < 0 || close < 0) return [];
  return line
    .slice(open + 1, close)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('SHY-0163: device E2E deferred off the per-PR PR Gate', () => {
  test('the gate job is the required "PR Gate"', () => {
    expect(gate).toMatch(/name: PR Gate/);
  });

  describe('PR Gate needs list', () => {
    const needs = gateNeeds();

    test('excludes android-e2e (deferred device job)', () => {
      expect(needs).not.toContain('android-e2e');
    });
    test('excludes ios-e2e (deferred device job)', () => {
      expect(needs).not.toContain('ios-e2e');
    });
    test('still includes playwright-web (headless browsers stay per-PR)', () => {
      expect(needs).toContain('playwright-web');
    });
    test('still includes integration-tests (backend stays per-PR)', () => {
      expect(needs).toContain('integration-tests');
    });
    test('still includes every core fast gate', () => {
      for (const job of [
        'detect-changes',
        'pre-merge-gate',
        'lint',
        'build-and-test',
        'sonarcloud',
        'test-backend',
        'qa-runner-driver-checks',
      ]) {
        expect(needs).toContain(job);
      }
    });
  });

  describe('PR Gate result-evaluation loop', () => {
    test('does not evaluate needs.android-e2e.result', () => {
      expect(gate).not.toContain('needs.android-e2e.result');
    });
    test('does not evaluate needs.ios-e2e.result', () => {
      expect(gate).not.toContain('needs.ios-e2e.result');
    });
    test('still evaluates a retained non-device job (playwright-web)', () => {
      expect(gate).toContain('needs.playwright-web.result');
    });
    test('still evaluates integration-tests', () => {
      expect(gate).toContain('needs.integration-tests.result');
    });
  });

  describe('device jobs run only on base-main (skipped on feature→develop)', () => {
    test("android-e2e if: gates on github.base_ref == 'main'", () => {
      expect(androidE2e).toMatch(/github\.base_ref\s*==\s*'main'/);
    });
    test('android-e2e retains its android_app_changed gate', () => {
      expect(androidE2e).toMatch(/android_app_changed\s*==\s*'true'/);
    });
    test("ios-e2e if: gates on github.base_ref == 'main'", () => {
      expect(iosE2e).toMatch(/github\.base_ref\s*==\s*'main'/);
    });
    test('ios-e2e retains its ios_app_changed gate', () => {
      expect(iosE2e).toMatch(/ios_app_changed\s*==\s*'true'/);
    });
  });
});
