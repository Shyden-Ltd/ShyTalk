/**
 * Pins the auto-seed-dev-personas integration after the 2026-05-29
 * refactor (operator directive): seed now lives in its own reusable
 * workflow `seed-dev-personas.yml`, invoked by:
 *
 *   1. `deploy-dev.yml` — as a top-level job that `needs: deploy-backend-dev`
 *      and uses the reusable workflow. Every dev deploy refreshes seed data.
 *   2. DIRECT `gh workflow run seed-dev-personas.yml` — refreshes seed
 *      WITHOUT a full deploy. Use case: re-running journey tests after a
 *      bug fix without burning 30-60min on a redeploy. THIS is the
 *      contract that drove the refactor.
 *
 * Three contracts pinned by this file:
 *   - deploy-dev.yml has a `seed-dev-personas` job that uses the reusable
 *     workflow and inherits secrets (instead of an inline composite action).
 *   - `seed-dev-personas.yml` declares both `workflow_call` and
 *     `workflow_dispatch` triggers + correct secrets surface.
 *   - The `seed-test-personas` composite action still encapsulates the
 *     credential-handling + cd/install/run pipeline (it's invoked from
 *     the new reusable workflow now, not directly from deploy-dev).
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
const SEED_WORKFLOW = readFileSync(
  join(REPO_ROOT, '.github', 'workflows', 'seed-dev-personas.yml'),
  'utf8',
);
const SEED_ACTION = readFileSync(
  join(REPO_ROOT, '.github', 'actions', 'seed-test-personas', 'action.yml'),
  'utf8',
);

// ── deploy-dev.yml — invokes the reusable workflow ─────────────────────

describe('deploy-dev.yml — seed-dev-personas job (reusable workflow caller)', () => {
  test('declares a workflow_dispatch input `seed-personas` defaulting to true', () => {
    // Same toggle as before the refactor; default `true` so seed runs on
    // every dev deploy unless the operator explicitly opts out via
    // `gh workflow run deploy-dev.yml -f seed-personas=false`.
    expect(DEPLOY_DEV).toMatch(/^ {6}seed-personas:$/m);
    const inputBlock = DEPLOY_DEV.match(/^ {6}seed-personas:[\s\S]{1,300}?default: (true|false)/m);
    expect(inputBlock).not.toBeNull();
    expect(inputBlock[1]).toBe('true');
  });

  test('seed step is a top-level JOB (not a step inside deploy-backend-dev) — refactored 2026-05-29', () => {
    // Pre-refactor: seed was an inline `uses: ./.github/actions/...` step
    // inside the `deploy-backend-dev` job. Post-refactor: it's a top-
    // level job `seed-dev-personas` that `uses: ./.github/workflows/...`.
    // The job-level structure makes the seed independently dispatchable
    // (via the workflow_dispatch on `seed-dev-personas.yml` itself).
    expect(DEPLOY_DEV).toMatch(/^ {2}seed-dev-personas:$/m);
    expect(DEPLOY_DEV).toContain('uses: ./.github/workflows/seed-dev-personas.yml');
    // Anti-pattern guard: the inline action should NOT appear inside
    // deploy-backend-dev anymore (would indicate someone re-added it
    // without removing the new job).
    const backendIdx = DEPLOY_DEV.indexOf('deploy-backend-dev:');
    const nextJobIdx = DEPLOY_DEV.indexOf('\n  seed-dev-personas:');
    expect(backendIdx).toBeGreaterThan(-1);
    expect(nextJobIdx).toBeGreaterThan(backendIdx);
    const backendBlock = DEPLOY_DEV.slice(backendIdx, nextJobIdx);
    expect(backendBlock).not.toContain('uses: ./.github/actions/seed-test-personas');
  });

  test('seed-dev-personas job needs deploy-backend-dev (ordering — seed after API + rules)', () => {
    // Ordering invariant: seed must run AFTER the backend deploy + rules
    // deploy succeed. Otherwise we'd seed against a half-deployed env.
    const seedJobIdx = DEPLOY_DEV.indexOf('seed-dev-personas:\n');
    expect(seedJobIdx).toBeGreaterThan(-1);
    const jobBlock = DEPLOY_DEV.slice(seedJobIdx, seedJobIdx + 400);
    expect(jobBlock).toMatch(/needs:\s*deploy-backend-dev/);
  });

  test('seed-dev-personas job is gated on `inputs.seed-personas != false` (operator opt-out)', () => {
    // The toggle still applies — `gh workflow run deploy-dev.yml -f
    // seed-personas=false` skips the seed job entirely.
    const seedJobIdx = DEPLOY_DEV.indexOf('seed-dev-personas:\n');
    const jobBlock = DEPLOY_DEV.slice(seedJobIdx, seedJobIdx + 400);
    expect(jobBlock).toMatch(/if:.*inputs\.seed-personas\s*!=\s*false/);
  });

  test('seed-dev-personas job inherits secrets (so the reusable workflow can read FIREBASE_SERVICE_ACCOUNT_DEV / PERSONAS_PASSWORD_DEV)', () => {
    // `secrets: inherit` is the only path by which the reusable workflow
    // sees the calling repo's secrets. Without it, the workflow_call
    // would fail at the secrets validation in seed-dev-personas.yml.
    const seedJobIdx = DEPLOY_DEV.indexOf('seed-dev-personas:\n');
    const jobBlock = DEPLOY_DEV.slice(seedJobIdx, seedJobIdx + 400);
    expect(jobBlock).toMatch(/secrets:\s*inherit/);
  });
});

// ── seed-dev-personas.yml — reusable workflow + direct dispatch ────────

describe('seed-dev-personas.yml — reusable workflow + direct dispatch', () => {
  test('declares both workflow_call AND workflow_dispatch triggers', () => {
    // workflow_call: invoked from deploy-dev.yml on every dev deploy.
    // workflow_dispatch: invoked DIRECTLY by operator (or CI rerun job)
    // to refresh seed WITHOUT a full deploy — the key user-facing
    // ergonomics improvement of the refactor.
    expect(SEED_WORKFLOW).toMatch(/^ {2}workflow_call:$/m);
    expect(SEED_WORKFLOW).toMatch(/^ {2}workflow_dispatch:$/m);
  });

  test('workflow_call declares the secrets it needs (caller forwards via `secrets: inherit`)', () => {
    // Declared with the EXACT repo-level secret names so actionlint can
    // type-check the `secrets.X` references inside the workflow AND so
    // `secrets: inherit` from the caller forwards by name without needing
    // an explicit per-secret mapping. Names match the repo's GitHub
    // Actions secrets settings.
    expect(SEED_WORKFLOW).toContain('FIREBASE_SERVICE_ACCOUNT_DEV:');
    expect(SEED_WORKFLOW).toContain('PERSONAS_PASSWORD_DEV:');
    // Both must be required so a future caller that forgets to forward
    // them fails at workflow_call validation rather than at runtime.
    const callIdx = SEED_WORKFLOW.indexOf('workflow_call:');
    const dispatchIdx = SEED_WORKFLOW.indexOf('workflow_dispatch:');
    const callBlock = SEED_WORKFLOW.slice(callIdx, dispatchIdx);
    expect(callBlock).toMatch(/FIREBASE_SERVICE_ACCOUNT_DEV:[\s\S]{1,200}required: true/);
    expect(callBlock).toMatch(/PERSONAS_PASSWORD_DEV:[\s\S]{1,200}required: true/);
  });

  test('declares a `target` input on both triggers with `dev` as the only allowed value', () => {
    // Production-safety: the provision script's assertSafeProject() check
    // refuses to run unless the project id contains "dev" or "local". The
    // workflow_dispatch input is a `choice` with only `dev` to prevent
    // a typo in `gh workflow run seed-dev-personas.yml -f target=prod`
    // from even reaching the script. Belt + suspenders.
    expect(SEED_WORKFLOW).toContain('target:');
    expect(SEED_WORKFLOW).toContain('default: dev');
    // workflow_dispatch uses `type: choice` with `dev` as the only option.
    const dispatchIdx = SEED_WORKFLOW.indexOf('workflow_dispatch:');
    const dispatchBlock = SEED_WORKFLOW.slice(dispatchIdx, dispatchIdx + 500);
    expect(dispatchBlock).toContain('type: choice');
    expect(dispatchBlock).toContain('- dev');
  });

  test('asserts target=dev at runtime (defence-in-depth against a future input addition)', () => {
    // The script has its own assertSafeProject() but layering a workflow-
    // level reject too means a typo'd input fails BEFORE the credential
    // is decoded to /tmp. Cheap belt-and-suspenders.
    expect(SEED_WORKFLOW).toContain('"$TARGET" != "dev"');
    expect(SEED_WORKFLOW).toContain('Unsupported target');
  });

  test('hardcodes FIREBASE_DATABASE_URL to the dev project + region (no JSON lookup)', () => {
    // The RTDB URL is hardcoded — NOT sourced from a file. The
    // corresponding google-services.json is gitignored (it carries the
    // OAuth client ID, treated as semi-sensitive client config) so it's
    // not on the runner unless the Android-build composite-action step
    // decodes it from a base64 secret first. The seed runner doesn't
    // run the Android build; adding a decode step + secret declaration
    // just to read one stable URL is more cost than the single-source-
    // of-truth benefit. Region (europe-west1) + project (shytalk-dev)
    // are stable for the project lifetime.
    expect(SEED_WORKFLOW).toContain(
      'https://shytalk-dev-default-rtdb.europe-west1.firebasedatabase.app',
    );
  });

  test('shell-command bodies do NOT operationally reference any gitignored google-services.json — regression guard from the 2026-05-29 first-dispatch failure', () => {
    // Run 26645780661 broke because an earlier draft did
    //   jq -r '.project_info.firebase_url' app/src/dev/google-services.json
    // — that file is gitignored, so the jq call failed at the very
    // first dispatch (caught only because we ran the workflow_dispatch
    // live; every static gate had passed).
    //
    // We strip COMMENT lines from the run blocks before asserting:
    // commenting the file path is fine (and useful — `git grep
    // google-services.json` should still find the discussion), but no
    // shell command may use it. A future maintainer who tries to
    // factor the URL out of YAML must either commit the source file
    // or add a decode-from-secret step first.
    const runBlocks = SEED_WORKFLOW.split(/run:\s*\|/).slice(1);
    expect(runBlocks.length).toBeGreaterThan(0);
    runBlocks.forEach((block) => {
      // Find next-step boundary by searching for both `- name:` and `- uses:`
      // separately with indexOf — avoids SonarJS's slow-regex false
      // positive on the `(name|uses)` alternation pattern. Picking the
      // FIRST occurrence of either marker correctly bounds the run body
      // before the next step starts.
      const nameIdx = block.indexOf('\n      - name:');
      const usesIdx = block.indexOf('\n      - uses:');
      let stepBoundary = -1;
      if (nameIdx !== -1 && usesIdx !== -1) {
        stepBoundary = Math.min(nameIdx, usesIdx);
      } else if (nameIdx !== -1) {
        stepBoundary = nameIdx;
      } else if (usesIdx !== -1) {
        stepBoundary = usesIdx;
      }
      const body = stepBoundary === -1 ? block : block.slice(0, stepBoundary);
      const code = body
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      expect(code).not.toContain('google-services.json');
      // String-contains checks instead of a regex to avoid SonarJS's
      // slow-regex false positive on `['"]\.project_info` — that pattern
      // has no super-linear backtracking risk, but the linter rejects
      // character-class alternations inside quantified groups. Both
      // jq + yq are common offenders; cover both.
      expect(code).not.toContain("jq -r '.project_info");
      expect(code).not.toContain('jq -r ".project_info');
      expect(code).not.toContain("yq -r '.project_info");
      expect(code).not.toContain('yq -r ".project_info');
    });
  });

  test('uses the seed-test-personas composite action', () => {
    // The implementation hasn't moved — only the invocation layer. The
    // composite action still does the credential-trap + cd/install/run
    // pipeline. This pin ensures the workflow stays a thin wrapper.
    expect(SEED_WORKFLOW).toContain('uses: ./.github/actions/seed-test-personas');
  });

  test('serializes seed runs against the same target via concurrency.group', () => {
    // Concurrent seed runs would last-write-wins each persona doc. Queue
    // them via the concurrency group so a re-seed mid-flight just waits
    // for the previous one to finish.
    expect(SEED_WORKFLOW).toContain('concurrency:');
    expect(SEED_WORKFLOW).toContain('seed-dev-personas-');
    expect(SEED_WORKFLOW).toContain('cancel-in-progress: false');
  });

  test('bounded timeout-minutes (10 — leaves room for transient quota throttling)', () => {
    // Provisioning ~17 personas with create-or-update each is typically
    // 30-60 sec. 10min cap leaves headroom for transient Firebase Auth
    // quota throttling without letting a stuck run idle forever.
    expect(SEED_WORKFLOW).toMatch(/timeout-minutes:\s*10/);
  });
});

// ── seed-test-personas composite action — unchanged contracts ──────────

describe('seed-test-personas composite action — interface (unchanged by refactor)', () => {
  test('declares the four required inputs (service-account-json, firebase-project, personas-password, database-url)', () => {
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

  test('all four inputs are required (no defaults that would silently work in CI without secrets)', () => {
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
    expect(SEED_ACTION).toContain("trap 'rm -f /tmp/firebase-sa-seed.json' EXIT");
    expect(SEED_ACTION).toContain('umask 077');
  });

  test('exports GOOGLE_APPLICATION_CREDENTIALS + FIREBASE_PROJECT_ID + FIREBASE_DATABASE_URL', () => {
    expect(SEED_ACTION).toContain(
      'export GOOGLE_APPLICATION_CREDENTIALS=/tmp/firebase-sa-seed.json',
    );
    expect(SEED_ACTION).toContain('export FIREBASE_PROJECT_ID="$PROJECT"');
    expect(SEED_ACTION).toContain('export FIREBASE_DATABASE_URL="$DATABASE_URL"');
  });

  test('does NOT use the dotenv preload flag on the node invocation', () => {
    const nodeLine = SEED_ACTION.split('\n').find(
      (l) => /^\s*node\s+/.test(l) && l.includes('provision-test-personas.js'),
    );
    expect(nodeLine).toBeDefined();
    expect(nodeLine).not.toContain('-r dotenv');
  });

  test('cd-s into express-api + npm-ci-s + runs the script in that order', () => {
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
    expect(lines[nodeIdx]).toMatch(/^\s*node\s+scripts\/provision-test-personas\.js\s*$/);
  });
});
