/**
 * SHY-0284: the action-pin drift guard runs as a SCRIPT, on every PR.
 *
 * The SHY-0162 invariant ("one SHA per action repo") already existed, but only
 * inside express-api/tests/scripts/ci-action-pin-consistency.test.js — and
 * `test-backend` is gated on `backend_changed`, so a workflow-only PR skipped
 * it. That is the exact shape of the partial Dependabot action bump the
 * invariant exists to catch, so it could only ever fire by accident:
 * actions/setup-node (6.4.0 vs 7.0.0) and actions/setup-java (5.6.0 vs 5.7.0)
 * both sat split across main for two days.
 *
 * These tests drive the REAL script as a REAL process against REAL directories
 * of REAL yaml files (ACTION_PINS_ROOT), asserting its real exit codes — no
 * injected reader, no fake stream. `tests/scripts/` is not a unit-test
 * location under the repo's no-stubs rule, so real-only applies.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-action-pin-consistency.js');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function run(root) {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    timeout: 30000,
    env: root === undefined ? process.env : { ...process.env, ACTION_PINS_ROOT: root },
  });
}

/**
 * A real scratch tree with `count` distinct pinned actions, plus whatever extra
 * `uses:` lines the case needs. Enough refs by default to clear MIN_EXPECTED_REFS
 * so a case testing DRIFT fails for drift, not for being too small.
 */
function makeScratchTree(extraLines = [], count = 25) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-pins-'));
  const wf = path.join(dir, '.github', 'workflows');
  fs.mkdirSync(wf, { recursive: true });
  const lines = ['name: t', 'jobs:', '  j:', '    steps:'];
  for (let i = 0; i < count; i += 1) {
    lines.push(`      - uses: vendor/action-${i}@${SHA_A} # v1`);
  }
  lines.push(...extraLines.map((l) => `      - ${l}`));
  fs.writeFileSync(path.join(wf, 'probe.yml'), `${lines.join('\n')}\n`);
  return dir;
}

describe('SHY-0284: check-action-pin-consistency.js', () => {
  const scratches = [];
  const scratch = (...args) => {
    const d = makeScratchTree(...args);
    scratches.push(d);
    return d;
  };
  afterAll(() => {
    for (const d of scratches) fs.rmSync(d, { recursive: true, force: true });
  });

  test('the live repository passes — every action repo pins exactly one SHA', () => {
    const r = run();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  test('a clean run reports how many references it verified', () => {
    // A guard that verified nothing must not be indistinguishable from a clean
    // one. The count is the evidence that the scan actually scanned.
    const r = run();
    expect(r.stdout).toMatch(/\d{1,9} action reference\(s\) across \d{1,9} action repo\(s\)/);
    const [, n] = /(\d{1,9}) action reference/.exec(r.stdout);
    expect(Number(n)).toBeGreaterThan(20);
  });

  test('a partial bump fails and names the action repo and BOTH SHAs', () => {
    // Exactly the setup-node/setup-java shape: one ref of an action moves, a
    // sibling does not.
    const root = scratch([`uses: vendor/split@${SHA_A} # v1`, `uses: vendor/split@${SHA_B} # v2`]);
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('vendor/split');
    expect(r.stderr).toContain(SHA_A);
    expect(r.stderr).toContain(SHA_B);
  });

  test('drift inside a composite action is caught, not just drift between workflows', () => {
    // The composite directory is the blind spot that let both real bumps split:
    // Dependabot watches .github/workflows/ but not .github/actions/.
    const root = scratch([`uses: vendor/split@${SHA_A} # v1`]);
    const act = path.join(root, '.github', 'actions', 'thing');
    fs.mkdirSync(act, { recursive: true });
    fs.writeFileSync(
      path.join(act, 'action.yml'),
      `runs:\n  steps:\n    - uses: vendor/split@${SHA_B} # v2\n`,
    );
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('vendor/split');
    expect(r.stderr).toContain('actions/thing/action.yml');
  });

  test('a floating tag fails even when every repo is internally consistent', () => {
    const root = scratch(['uses: vendor/floating@v3']);
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('vendor/floating@v3');
  });

  test('a tree with too few references refuses instead of reporting success', () => {
    // The failure this guard most needs to avoid is its own: a broken scan that
    // finds nothing and calls it clean.
    const root = scratch([], 3);
    const r = run(root);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/only 3 action reference\(s\)/);
    expect(r.stdout).not.toMatch(/✓/);
  });

  test('a consistent scratch tree passes, so the failures above are about drift', () => {
    // Negative control: without it, every red above could be an artefact of the
    // fixture rather than the condition under test.
    const root = scratch();
    const r = run(root);
    expect(r.status).toBe(0);
  });

  test('lint.yml runs this guard unconditionally', () => {
    // The entire defect was an invariant sitting in a job that did not run.
    // Deleting the step would silently restore that, so pin it here.
    const lint = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/lint.yml'), 'utf8');
    expect(lint).toContain('node scripts/check-action-pin-consistency.js');
    // ...and it must not be gated behind an `if:` that could skip it.
    const step = lint.slice(0, lint.indexOf('node scripts/check-action-pin-consistency.js'));
    const lastStep = step.slice(step.lastIndexOf('      - name:'));
    expect(lastStep).not.toMatch(/^[ \t]{1,40}if:/m);
  });
});
