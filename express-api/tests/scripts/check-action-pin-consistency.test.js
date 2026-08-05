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
// Read from the script rather than restated here: a floor asserted against a
// copy of itself proves the copy, not the guard.
const { MIN_EXPECTED_REFS } = require(SCRIPT);

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

/** Every scratch tree carries one composite ref, to give the walk two areas. */
const COMPOSITE_REFS_PER_TREE = 1;

function run(root) {
  // ACTION_PINS_ROOT is stripped, never merely overridden. Jest inherits the
  // caller's environment, so a developer (or a CI step) with that variable
  // already set would have every `run()` with no argument silently scan THEIR
  // tree instead of the live repository — and the "the live repository passes"
  // case would then be asserting nothing about this repository at all.
  const env = { ...process.env };
  delete env.ACTION_PINS_ROOT;
  if (root !== undefined) env.ACTION_PINS_ROOT = root;

  return spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    timeout: 30000,
    env,
  });
}

/**
 * A real scratch tree with `count` distinct pinned actions, plus whatever extra
 * `uses:` lines the case needs. Enough refs by default to clear MIN_EXPECTED_REFS
 * so a case testing DRIFT fails for drift, not for being too small.
 *
 * Writes BOTH areas the guard walks — `.github/workflows/` and a composite
 * under `.github/actions/`. That is what a real repository looks like, and it
 * is what the directory-spread check requires: a result drawn from a single
 * area means the walk stopped descending, which is the blind spot that let
 * setup-node sit split across main for two days. Giving the fixtures only
 * workflows would have forced that check to be conditional to keep the suite
 * green, i.e. would have weakened the guard to fit the test — backwards.
 */
function makeScratchTree(extraLines = [], count = 25) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-pins-'));
  const wf = path.join(dir, '.github', 'workflows');
  const composite = path.join(dir, '.github', 'actions', 'probe-action');
  fs.mkdirSync(wf, { recursive: true });
  fs.mkdirSync(composite, { recursive: true });

  const lines = ['name: t', 'jobs:', '  j:', '    steps:'];
  for (let i = 0; i < count; i += 1) {
    lines.push(`      - uses: vendor/action-${i}@${SHA_A} # v1`);
  }
  lines.push(...extraLines.map((l) => `      - ${l}`));
  fs.writeFileSync(path.join(wf, 'probe.yml'), `${lines.join('\n')}\n`);

  // Consistent with the workflow above on purpose: this exists to give the
  // walk a second area, not to introduce drift a case did not ask for.
  fs.writeFileSync(
    path.join(composite, 'action.yml'),
    [
      'name: probe-composite',
      'runs:',
      '  using: composite',
      '  steps:',
      `    - uses: vendor/composite-helper@${SHA_A} # v1`,
      '',
    ].join('\n'),
  );
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
    //
    // 3 workflow refs + the 1 composite ref every scratch tree carries. Spelt
    // out rather than left as a bare 4, because the number moving is exactly
    // how a "wrong count reported confidently" defect would look.
    const root = scratch([], 3);
    const r = run(root);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(
      new RegExp(`only ${3 + COMPOSITE_REFS_PER_TREE} action reference\\(s\\)`),
    );
    expect(r.stdout).not.toMatch(/✓/);
  });

  test('the floor is a floor: one ref below refuses, exactly on it passes', () => {
    // The boundary itself. MIN_EXPECTED_REFS was previously exercised only far
    // from its edge, so an off-by-one either way went unnoticed.
    const below = run(scratch([], MIN_EXPECTED_REFS - COMPOSITE_REFS_PER_TREE - 1));
    expect(below.status).toBe(2);
    expect(below.stderr).toMatch(/expected at least/);

    const exactly = run(scratch([], MIN_EXPECTED_REFS - COMPOSITE_REFS_PER_TREE));
    expect(exactly.status).toBe(0);
    expect(exactly.stderr).toBe('');
  });

  test('a consistent scratch tree passes, so the failures above are about drift', () => {
    // Negative control: without it, every red above could be an artefact of the
    // fixture rather than the condition under test.
    const root = scratch();
    const r = run(root);
    expect(r.status).toBe(0);
  });

  test('a sub-path action shares its repo release, and drift there is caught', () => {
    // actions/cache, actions/cache/restore and actions/cache/save are ONE
    // repo with one release SHA. The scan derives the repo by taking the
    // first two path segments, and nothing exercised that through the CLI —
    // so a regression to "compare the whole action path" would have split
    // them into three independent repos and gone quiet on exactly the
    // half-finished-upgrade shape this guard exists for.
    const consistent = run(
      scratch([
        `uses: actions/cache@${SHA_A} # v4`,
        `uses: actions/cache/restore@${SHA_A} # v4`,
        `uses: actions/cache/save@${SHA_A} # v4`,
      ]),
    );
    expect(consistent.stderr).toBe('');
    expect(consistent.status).toBe(0);

    const drifted = run(
      scratch([`uses: actions/cache@${SHA_A} # v4`, `uses: actions/cache/restore@${SHA_B} # v4.1`]),
    );
    expect(drifted.status).toBe(1);
    // Reported against the REPO, which is the thing that has one release.
    expect(drifted.stderr).toContain('actions/cache');
    expect(drifted.stderr).toContain(SHA_A);
    expect(drifted.stderr).toContain(SHA_B);
  });

  test('lint.yml points the guard at THIS repo — no env override', () => {
    // ACTION_PINS_ROOT exists so these tests can drive the real script against
    // a scratch tree. In CI it must be absent: a step that set it would run
    // the guard, exit 0, and be reporting on a directory that is not this
    // repository — green, and meaningless.
    const lint = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/lint.yml'), 'utf8');
    const at = lint.indexOf('node scripts/check-action-pin-consistency.js');
    expect(at).toBeGreaterThan(-1);
    const step = lint.slice(lint.lastIndexOf('      - name:', at), at);
    expect(step).not.toMatch(/^[ \t]{1,40}env:/m);
    expect(lint).not.toContain('ACTION_PINS_ROOT');
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

/**
 * The exit-code contract, driven through main() directly.
 *
 * Everything above spawns the real script against real directories, which is
 * right for the scan. But the three refusal branches are decided from a REF
 * LIST, and building a directory tree per branch tests the tree as much as the
 * decision. `refs` and the two streams are parameters the script exposes for
 * exactly this; the streams here are real node Writables collecting real
 * bytes, not fakes standing in for one.
 */
describe('SHY-0284: main() exit codes, from a ref list', () => {
  const { Writable } = require('node:stream');
  const { main } = require(SCRIPT);

  const capture = () => {
    const chunks = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    stream.text = () => chunks.join('');
    return stream;
  };

  /** `n` consistent refs spread across both areas, so only the tested branch fails. */
  const healthy = (n) =>
    Array.from({ length: n }, (_, i) => ({
      file: i === 0 ? '.github/actions/x/action.yml' : '.github/workflows/w.yml',
      action: `vendor/a-${i}`,
      ref: SHA_A,
      repo: `vendor/a-${i}`,
    }));

  const runMain = (refs) => {
    const out = capture();
    const err = capture();
    return { code: main({ refs, out, err }), out: out.text(), err: err.text() };
  };

  test('a clean list exits 0 and says so', () => {
    const r = runMain(healthy(MIN_EXPECTED_REFS));
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
    expect(r.out).toMatch(/✓/);
  });

  test('an empty list exits 2 — nothing scanned is not success', () => {
    const r = runMain([]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/only 0 action reference\(s\)/);
    expect(r.out).not.toMatch(/✓/);
  });

  test('refs from a single area exit 2, however many there are', () => {
    // Volume without breadth: the shape of a walk that stopped descending.
    const oneArea = healthy(MIN_EXPECTED_REFS + 50).map((r) => ({
      ...r,
      file: '.github/workflows/w.yml',
    }));
    const r = runMain(oneArea);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/single area/);
  });

  test('two SHAs for one repo exit 1 and name both', () => {
    const refs = [
      ...healthy(MIN_EXPECTED_REFS),
      {
        file: '.github/workflows/w.yml',
        action: 'actions/setup-node',
        ref: SHA_A,
        repo: 'actions/setup-node',
      },
      {
        file: '.github/actions/x/action.yml',
        action: 'actions/setup-node',
        ref: SHA_B,
        repo: 'actions/setup-node',
      },
    ];
    const r = runMain(refs);
    expect(r.code).toBe(1);
    expect(r.err).toContain('actions/setup-node');
    expect(r.err).toContain(SHA_A);
    expect(r.err).toContain(SHA_B);
  });

  test('an unpinned ref exits 1', () => {
    const refs = [
      ...healthy(MIN_EXPECTED_REFS),
      {
        file: '.github/workflows/w.yml',
        action: 'vendor/floating',
        ref: 'v3',
        repo: 'vendor/floating',
      },
    ];
    const r = runMain(refs);
    expect(r.code).toBe(1);
    expect(r.err).toContain('vendor/floating');
  });
});
