/**
 * Pins the integration that wires `provision-test-personas.js` into
 * `deploy-dev.yml` so every dev deploy refreshes the seeded persona cast
 * (P-02..P-19). Operator directive 2026-05-29:
 *
 *   1. Seeding must happen as part of deploy-dev (not a manual side-task).
 *   2. The script must remove ONLY seed data and replace with fresh seed
 *      data — manually-created accounts are never touched.
 *   3. Seed accounts must be easily identifiable so regular users aren't
 *      confused (covered by [SEED] displayName prefix + seedSource field,
 *      pinned in provision-test-personas.test.js).
 *
 * This file pins the workflow-level half of that directive: the
 * `seed-personas` input exists with default true, the deploy-backend-dev
 * job invokes the `seed-test-personas` composite action behind that
 * toggle, and the action declares the inputs it needs to authenticate
 * against shytalk-dev.
 */

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { readFileSync } = require('fs');
const { join } = require('path');

const REPO_ROOT = join(__dirname, '..', '..', '..');
const DEPLOY_DEV = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'deploy-dev.yml'), 'utf8');
const SEED_ACTION = readFileSync(
  join(REPO_ROOT, '.github', 'actions', 'seed-test-personas', 'action.yml'),
  'utf8',
);

describe('deploy-dev.yml — seed-personas integration', () => {
  test('declares a workflow_dispatch input `seed-personas` defaulting to true', () => {
    // Pin both the input name and the default. A `default: false` would
    // silently disable seeding on every workflow_dispatch run that didn't
    // explicitly opt in — exactly the failure mode the operator wants to
    // prevent by automating the seed step in the first place.
    expect(DEPLOY_DEV).toMatch(/^ {6}seed-personas:$/m);
    // The block following should contain a default: true (within ~5 lines).
    const inputBlock = DEPLOY_DEV.match(/^ {6}seed-personas:[\s\S]{1,300}?default: (true|false)/m);
    expect(inputBlock).not.toBeNull();
    expect(inputBlock[1]).toBe('true');
  });

  test('deploy-backend-dev job invokes the seed-test-personas composite action', () => {
    // The step lives under `./.github/actions/seed-test-personas` (a
    // composite action, NOT an inline shell step) so the credential-
    // handling + trap-cleanup logic is shared with the parallel
    // deploy-firebase-rules action.
    expect(DEPLOY_DEV).toContain('uses: ./.github/actions/seed-test-personas');
  });

  test('seed step is gated on `inputs.seed-personas != false` (operator opt-out)', () => {
    // Matching `!= false` (not `== true`) means the seed step ALSO runs on
    // workflow events that don't supply the input (e.g. if some future
    // trigger fires without inputs at all). The operator can disable on a
    // per-run basis via `gh workflow run … -f seed-personas=false`.
    const stepBlock = DEPLOY_DEV.match(
      /Seed test personas[\s\S]{0,400}uses: \.\/\.github\/actions\/seed-test-personas/m,
    );
    expect(stepBlock).not.toBeNull();
    expect(stepBlock[0]).toMatch(/if:\s*inputs\.seed-personas\s*!=\s*false/);
  });

  test('seed step passes the FIREBASE_SERVICE_ACCOUNT_DEV + PERSONAS_PASSWORD_DEV secrets + the dev RTDB URL', () => {
    // Secrets come from GitHub Actions secrets (never appear in workflow
    // YAML diffs or run logs). PERSONAS_PASSWORD_DEV is a NEW secret the
    // operator added once (value matches `~/.shytalk/dev-personas.env`).
    // database-url is the public Firebase RTDB URL (in committed
    // google-services.json) — required because the provision script
    // transitively imports firebase.js which throws if FIREBASE_DATABASE_URL
    // is unset. Region-specific (europe-west1); cannot be derived from
    // project ID alone.
    const seedIdx = DEPLOY_DEV.indexOf('uses: ./.github/actions/seed-test-personas');
    expect(seedIdx).toBeGreaterThan(-1);
    // Slice forward from the uses: line until the next step or job (top-
    // level keys / 6-space indent). The seed step's `with:` block is the
    // immediate target.
    const stepBlock = DEPLOY_DEV.slice(seedIdx, seedIdx + 1000);
    expect(stepBlock).toMatch(
      /service-account-json:\s*\$\{\{\s*secrets\.FIREBASE_SERVICE_ACCOUNT_DEV\s*\}\}/,
    );
    expect(stepBlock).toMatch(
      /personas-password:\s*\$\{\{\s*secrets\.PERSONAS_PASSWORD_DEV\s*\}\}/,
    );
    expect(stepBlock).toMatch(/firebase-project:\s*shytalk-dev/);
    // The URL is committed-public (lives in app/src/dev/google-services.json
    // too), so it can appear inline in the workflow YAML.
    expect(stepBlock).toMatch(
      /database-url:\s*https:\/\/shytalk-dev-default-rtdb\.europe-west1\.firebasedatabase\.app/,
    );
  });

  test('seed step is positioned AFTER the firebase-rules deploy + verify dev API health', () => {
    // Ordering invariant: seeding before the API is verified live would
    // mean we could seed against a half-deployed dev. By running the seed
    // step LAST inside deploy-backend-dev (after API health check + rules
    // deploy), we guarantee the seed targets a healthy, fully-deployed
    // shytalk-dev.
    const rulesIdx = DEPLOY_DEV.indexOf('uses: ./.github/actions/deploy-firebase-rules');
    const seedIdx = DEPLOY_DEV.indexOf('uses: ./.github/actions/seed-test-personas');
    expect(rulesIdx).toBeGreaterThan(-1);
    expect(seedIdx).toBeGreaterThan(-1);
    expect(seedIdx).toBeGreaterThan(rulesIdx);
  });
});

describe('seed-test-personas composite action — interface', () => {
  test('declares the four required inputs (service-account-json, firebase-project, personas-password, database-url)', () => {
    // Use indexOf-based slicing instead of `\s*\n\s*` regex — SonarJS flags
    // the nested whitespace quantifiers as super-linear-backtracking-prone.
    for (const name of [
      'service-account-json:',
      'firebase-project:',
      'personas-password:',
      'database-url:',
    ]) {
      const idx = SEED_ACTION.indexOf(name);
      expect(idx).toBeGreaterThan(-1);
      const window = SEED_ACTION.slice(idx, idx + 50);
      expect(window).toContain('description:');
    }
  });

  test('exports FIREBASE_DATABASE_URL from the database-url input (region-specific RTDB URL)', () => {
    // The provision script transitively imports `express-api/src/utils/firebase.js`,
    // which throws `FIREBASE_DATABASE_URL env var is required` at module-load
    // time if unset. Caught in local dry-run after PR #870's npm-ci fix —
    // the require chain works, but module-init then fails on the URL check.
    // Action must wire the input through to the env.
    expect(SEED_ACTION).toContain('DATABASE_URL: ${{ inputs.database-url }}');
    expect(SEED_ACTION).toContain('export FIREBASE_DATABASE_URL="$DATABASE_URL"');
  });

  test('all four inputs are required (no defaults that would silently work in CI without secrets)', () => {
    // Required inputs make the action fail loudly if any secret/value is
    // missing from the workflow that calls it — the alternative (defaults
    // to empty string) would let firebase-admin attempt to auth with no
    // credentials, producing a confusing log line buried in runner output.
    // Slice the inputs block via string-index (not greedy regex) so SonarJS
    // doesn't flag a super-linear-backtracking risk on `[\s\S]+?`.
    const inputsIdx = SEED_ACTION.indexOf('inputs:');
    const runsIdx = SEED_ACTION.indexOf('\nruns:');
    expect(inputsIdx).toBeGreaterThan(-1);
    expect(runsIdx).toBeGreaterThan(inputsIdx);
    const inputsBlock = SEED_ACTION.slice(inputsIdx, runsIdx);
    for (const name of [
      'service-account-json:',
      'firebase-project:',
      'personas-password:',
      'database-url:',
    ]) {
      const start = inputsBlock.indexOf(`  ${name}`);
      expect(start).toBeGreaterThan(-1);
      const nextKey = inputsBlock.slice(start + name.length).search(/\n {2}[a-z]/);
      const end = nextKey === -1 ? inputsBlock.length : start + name.length + nextKey;
      const slice = inputsBlock.slice(start, end);
      expect(slice).toContain('required: true');
    }
  });

  test('wipes the service-account JSON via a trap (credential never leaks across jobs)', () => {
    // Without the trap, set -e would abort the bash script before the
    // trailing `rm` runs, leaving /tmp/firebase-sa-seed.json on the
    // shared runner. Mirrors the safety pattern in
    // deploy-firebase-rules/action.yml.
    expect(SEED_ACTION).toContain("trap 'rm -f /tmp/firebase-sa-seed.json' EXIT");
    expect(SEED_ACTION).toContain('umask 077');
  });

  test('passes GOOGLE_APPLICATION_CREDENTIALS so firebase-admin auto-auths', () => {
    // The provision script's `admin.initializeApp()` defaults to
    // GOOGLE_APPLICATION_CREDENTIALS — if the action didn't export it,
    // firebase-admin would fall back to gcloud ADC and fail in CI.
    expect(SEED_ACTION).toContain(
      'export GOOGLE_APPLICATION_CREDENTIALS=/tmp/firebase-sa-seed.json',
    );
  });

  test('does NOT use the dotenv preload flag on the node invocation (CI exports env directly)', () => {
    // The script's own usage docstring shows the preload flag because it
    // assumes a .env file on the dev Express host. In CI dotenv is not on
    // the node resolution path (lives in express-api/node_modules, not
    // the repo-root node_modules that the composite action invokes from),
    // so the preload fails at runtime. Caught in run 26636553597: the
    // first attempted dev deploy with this action failed at exactly this
    // point. Pin the absence so it can't regress.
    //
    // Slice the actual `node ...` invocation line (not the whole file —
    // the comment ABOVE the node line literally mentions the flag, so a
    // whole-file `not.toContain` would match the comment text and pass-
    // through the actual bug if it returned).
    const nodeLine = SEED_ACTION.split('\n').find(
      (l) => /^\s*node\s+/.test(l) && l.includes('provision-test-personas.js'),
    );
    expect(nodeLine).toBeDefined();
    expect(nodeLine).not.toContain('-r dotenv');
  });

  test('cd-s into express-api before running node (so require("firebase-admin") resolves)', () => {
    // The provision script does `require('firebase-admin')` etc. — those
    // resolve against `express-api/node_modules`, NOT the repo-root.
    // Running the script with a `express-api/scripts/...` path from repo
    // root fails because the repo root has no `node_modules/firebase-admin`.
    // Caught in run 26637428443: `Cannot find module 'firebase-admin'`.
    //
    // Pin both: (1) a `cd express-api` precedes the node line, (2) the
    // node line uses a bare relative path `scripts/provision-test-...`,
    // NOT the repo-root-prefixed `express-api/scripts/provision-test-...`.
    const lines = SEED_ACTION.split('\n');
    const cdIdx = lines.findIndex((l) => /^\s*cd\s+express-api\s*$/.test(l));
    const nodeIdx = lines.findIndex(
      (l) => /^\s*node\s+/.test(l) && l.includes('provision-test-personas.js'),
    );
    expect(cdIdx).toBeGreaterThan(-1);
    expect(nodeIdx).toBeGreaterThan(cdIdx);
    expect(lines[nodeIdx]).toMatch(/^\s*node\s+scripts\/provision-test-personas\.js\s*$/);
    // Anti-pattern guard: must NOT use repo-root-prefixed path on the
    // node line (would fail because firebase-admin lives in
    // express-api/node_modules, not the repo-root resolution path).
    expect(lines[nodeIdx]).not.toContain('express-api/scripts/');
  });

  test('runs `npm ci --omit=dev` before node (installs firebase-admin on the runner)', () => {
    // The outer deploy-backend-dev workflow only npm-installs on the REMOTE
    // London VM via ssh — the GitHub runner's `express-api/node_modules`
    // is empty when the seed step starts. Without an install, every
    // `require('firebase-admin')` etc. in the provision script fails
    // MODULE_NOT_FOUND. Caught in runs 26637428443 + 26638445667.
    //
    // Pin: an `npm ci` line precedes the node line, has `--omit=dev` (we
    // only need production deps), and is inside the express-api CWD
    // (after the `cd express-api`).
    const lines = SEED_ACTION.split('\n');
    const cdIdx = lines.findIndex((l) => /^\s*cd\s+express-api\s*$/.test(l));
    const installIdx = lines.findIndex((l) => /^\s*npm ci\b/.test(l));
    const nodeIdx = lines.findIndex(
      (l) => /^\s*node\s+/.test(l) && l.includes('provision-test-personas.js'),
    );
    expect(cdIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(cdIdx);
    expect(nodeIdx).toBeGreaterThan(installIdx);
    expect(lines[installIdx]).toContain('--omit=dev');
  });
});
