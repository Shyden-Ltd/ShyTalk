/**
 * manual-qa-matrix-workflow-pin.test.js
 *
 * Structural pin for .github/workflows/manual-qa-matrix.yml (gap E1).
 *
 * Catches accidental regressions in the workflow shape:
 *   - workflow_dispatch trigger + all 5 inputs declared
 *   - target choices = [local, dev, prod]
 *   - report-format choices = [json, junit]
 *   - Job runs on ubuntu-latest (per [[feedback-no-self-hosted-runners]])
 *   - Steps: checkout, setup-node, npm ci, playwright install, dispatch,
 *     upload-artifact
 *   - All operator-supplied inputs are passed via env vars (NOT
 *     interpolated into the run script), preventing shell-metacharacter
 *     injection
 *   - Secrets used match the established naming convention
 *     (DEV_QA_PERSONAS_PASSWORD, DEV_FIREBASE_API_KEY, PROD_FIREBASE_API_KEY)
 *   - Playwright browsers cached on version (per [[feedback-ci-cache-
 *     downloads-version-aware]])
 *   - No cron schedule (per [[feedback-avoid-crons-prefer-event-driven]])
 *
 * Live dispatch verification is the operator's responsibility per
 * [[feedback-workflow-verify-by-running]] — static YAML pins catch
 * typos but cannot prove the workflow actually runs to green.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github/workflows/manual-qa-matrix.yml');

describe('manual-qa-matrix.yml — structural pin', () => {
  let yamlText;
  beforeAll(() => {
    yamlText = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  });

  // ── Trigger ──────────────────────────────────────────────────

  test('workflow_dispatch trigger is declared (operator-invoked, no cron)', () => {
    expect(yamlText).toMatch(/on:\s{0,20}\n\s{0,20}workflow_dispatch:/);
    // Per [[feedback-avoid-crons-prefer-event-driven]] — no schedule:
    // block. Operator dispatches manually.
    expect(yamlText).not.toMatch(/schedule:/);
  });

  // ── Inputs ───────────────────────────────────────────────────

  test('input "target" declared as choice with local/dev/prod options', () => {
    // target is the most important input — must be a constrained
    // choice (not free-form string) so operator can't typo "deb"
    // and get a confusing downstream error.
    expect(yamlText).toMatch(/target:\s{0,20}\n\s{1,20}description:.*\n\s{1,20}type:\s*choice/);
    expect(yamlText).toMatch(/options:\s*\n(\s{1,20}- (local|dev|prod)\s{0,20}\n)+/);
    expect(yamlText).toMatch(/- local/);
    expect(yamlText).toMatch(/- dev/);
    expect(yamlText).toMatch(/- prod/);
  });

  test('input "filter" declared (optional string)', () => {
    expect(yamlText).toMatch(/filter:\s{0,20}\n\s{1,20}description:.*\n\s{1,20}type:\s*string/);
  });

  test('input "shard" declared (optional string for X/Y)', () => {
    expect(yamlText).toMatch(/shard:\s{0,20}\n\s{1,20}description:.*\n\s{1,20}type:\s*string/);
  });

  test('input "retry" declared (optional string for integer)', () => {
    expect(yamlText).toMatch(/retry:\s{0,20}\n\s{1,20}description:.*\n\s{1,20}type:\s*string/);
  });

  test('input "report-format" declared as choice with json/junit options', () => {
    expect(yamlText).toMatch(/report-format:/);
    // json + junit options both required
    expect(yamlText).toMatch(/- json/);
    expect(yamlText).toMatch(/- junit/);
  });

  // ── Job + runner ─────────────────────────────────────────────

  test('job runs on ubuntu-latest (no self-hosted runners)', () => {
    expect(yamlText).toMatch(/runs-on:\s*ubuntu-latest/);
    // [[feedback-no-self-hosted-runners]] — hard policy
    expect(yamlText).not.toMatch(/\[self-hosted/);
  });

  test('job has timeout-minutes set (prevents runaway matrix)', () => {
    expect(yamlText).toMatch(/timeout-minutes:\s*\d+/);
  });

  // ── Steps ────────────────────────────────────────────────────

  test('checkout step is present', () => {
    expect(yamlText).toMatch(/uses:\s*actions\/checkout/);
  });

  test('setup-node@v4 with cache: npm + cache-dependency-path', () => {
    // Pin the npm cache invariant — without cache-dependency-path,
    // setup-node defaults to repo-root package.json which doesn't
    // exist; cache would silently no-op and slow every PR.
    expect(yamlText).toMatch(/uses:\s*actions\/setup-node@v4/);
    expect(yamlText).toMatch(/cache:\s*npm/);
    expect(yamlText).toMatch(/cache-dependency-path:\s*express-api\/package-lock\.json/);
  });

  test('npm ci runs in express-api working directory', () => {
    expect(yamlText).toMatch(/npm ci/);
    expect(yamlText).toMatch(/working-directory:\s*express-api/);
  });

  test('Playwright browsers installed with --with-deps', () => {
    // Without --with-deps, headless WebKit silently fails to launch
    // on Ubuntu (missing libgtk/libgstreamer).
    expect(yamlText).toMatch(/npx playwright install --with-deps/);
    expect(yamlText).toMatch(/chromium/);
    expect(yamlText).toMatch(/firefox/);
    expect(yamlText).toMatch(/webkit/);
  });

  test('Playwright browser cache keyed on resolved version', () => {
    // [[feedback-ci-cache-downloads-version-aware]] — cache must
    // invalidate when Playwright version bumps.
    expect(yamlText).toMatch(/actions\/cache@v4/);
    expect(yamlText).toMatch(
      /playwright-\$\{\{ runner\.os \}\}-\$\{\{ steps\.pw\.outputs\.version \}\}/,
    );
  });

  test('manual-qa-runner.js invoked with --matrix', () => {
    expect(yamlText).toMatch(/scripts\/manual-qa-runner\.js/);
    expect(yamlText).toMatch(/--matrix/);
  });

  test('upload-artifact uses if: always() (uploads on failure too)', () => {
    expect(yamlText).toMatch(/uses:\s*actions\/upload-artifact@v4/);
    expect(yamlText).toMatch(/if:\s*always\(\)/);
  });

  // ── Security: env-var injection prevention ──────────────────

  test('operator inputs passed via env vars, NOT interpolated into run scripts', () => {
    // Security-critical: ${{ inputs.X }} inside `run: |` is a shell
    // injection vector. The workflow MUST use env: blocks and
    // reference $IN_TARGET etc. inside the run script.
    expect(yamlText).toMatch(/IN_TARGET:\s*\$\{\{\s*inputs\.target\s*\}\}/);
    expect(yamlText).toMatch(/IN_FILTER:\s*\$\{\{\s*inputs\.filter\s*\}\}/);
    expect(yamlText).toMatch(/IN_SHARD:\s*\$\{\{\s*inputs\.shard\s*\}\}/);
    expect(yamlText).toMatch(/IN_RETRY:\s*\$\{\{\s*inputs\.retry\s*\}\}/);
    expect(yamlText).toMatch(/IN_REPORT_FORMAT:\s*\$\{\{\s*inputs\['report-format'\]\s*\}\}/);
  });

  test('run script references $IN_* env vars (not inputs.* interpolations)', () => {
    // Extract all "run: |" blocks and confirm no ${{ inputs.X }}
    // appears inside any of them. (A grep for the inputs prefix
    // anywhere in a run-block would catch the injection.)
    const lines = yamlText.split('\n');
    let inRunBlock = false;
    let runBlockIndent = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimEnd();
      if (/^\s+run:\s*\|/.test(line)) {
        inRunBlock = true;
        runBlockIndent = line.match(/^( *)/)[1].length;
        continue;
      }
      if (inRunBlock) {
        // Block ends when we hit a line at or below the run: indent
        if (trimmed.length > 0) {
          const lineIndent = line.match(/^( *)/)[1].length;
          if (lineIndent <= runBlockIndent) {
            inRunBlock = false;
            continue;
          }
        }
        // Critical assertion: no ${{ inputs.X }} inside run block.
        expect(line).not.toMatch(/\$\{\{\s*inputs\./);
      }
    }
  });

  // ── Secrets convention ──────────────────────────────────────

  test('secrets follow established naming convention', () => {
    // DEV_QA_PERSONAS_PASSWORD + DEV_FIREBASE_API_KEY +
    // PROD_FIREBASE_API_KEY — same names used by other workflows
    // (PR #867+/seed-test-personas action).
    expect(yamlText).toMatch(/\$\{\{\s*secrets\.DEV_QA_PERSONAS_PASSWORD\s*\}\}/);
    expect(yamlText).toMatch(/\$\{\{\s*secrets\.DEV_FIREBASE_API_KEY\s*\}\}/);
    expect(yamlText).toMatch(/\$\{\{\s*secrets\.PROD_FIREBASE_API_KEY\s*\}\}/);
  });

  // ── Permissions ─────────────────────────────────────────────

  test('permissions block restricts to read-only', () => {
    // Least privilege — no checks: write or pull-requests: write
    // needed for a manual matrix run.
    expect(yamlText).toMatch(/permissions:\s{0,20}\n\s{1,20}contents:\s*read/);
  });
});
