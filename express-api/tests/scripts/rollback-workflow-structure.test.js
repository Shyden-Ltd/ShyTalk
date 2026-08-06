/**
 * Pins the emergency-recovery invariants of `.github/workflows/rollback.yml`
 * (SHY-0233). This is the web-prod rollback tool: it instant-promotes the
 * previous good Cloudflare Pages production deployment of `shytalk-site` via
 * the CF API — no rebuild. The invariants below are the ones that MUST NOT
 * silently regress, because each protects the "recover in seconds when prod
 * is broken" contract:
 *
 *   - NO `production` approval gate on the job — a re-introduced
 *     `environment:` key would block recovery behind an absent approver.
 *   - A DEDICATED, GLOBAL concurrency group (not the shared multi-platform
 *     `deploy-prod` group, and not ref-scoped) so an emergency rollback never
 *     queues behind a ~100-min iOS build, and two refs can't race a promote.
 *   - Manual dispatch ONLY.
 *   - Targets `shytalk-site` via the CF `/rollback` endpoint (a POST),
 *     selecting the PREVIOUS production deployment (index [1] of the
 *     newest-first, environment==production list) — the exact jq filter is
 *     pinned verbatim and its selection semantics exercised against fixtures.
 *   - Every failure branch fails LOUD (missing token; no previous deployment;
 *     HTTP error; CF `success:false`) and the success/failure reporting the
 *     operator reads mid-incident is not invertible without a test failing.
 *   - The operator-typed `deployment_id` is consumed via `env:` and never
 *     interpolated into the `run:` script (workflow-injection hygiene).
 *   - Least-privilege `permissions: contents: read`.
 *
 * actionlint validates the YAML's overall structural correctness; this test
 * asserts the SEMANTIC invariants on the parsed tree + the selection semantics
 * of the deployment-selection filter.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ROLLBACK_PATH = path.join(REPO_ROOT, '.github/workflows/rollback.yml');

// The canonical "previous production deployment" selection filter. Kept in
// sync with the workflow by an explicit toContain() assertion below, then
// executed against fixtures so the SELECTION LOGIC itself is covered.
const SELECT_FILTER = '[.result[] | select(.environment == "production")] | .[1].id // ""';

describe('rollback.yml — emergency web-prod rollback invariants', () => {
  let text;
  let wf;

  beforeAll(() => {
    text = fs.readFileSync(ROLLBACK_PATH, 'utf8');
    // js-yaml v4 `load` is the safe loader (default schema — no arbitrary-type
    // construction; `safeLoad` is a removed-API shim in v4). Input is our own
    // version-controlled workflow file, not untrusted data.
    wf = yaml.load(text);
  });

  // YAML 1.1 (js-yaml v3) resolves the bare key `on` to boolean `true`, so
  // the trigger block lands under wf[true]; js-yaml v4 keeps it as `on`.
  // Normalise so the test is robust across both.
  const triggers = () => wf.on ?? wf[true];
  const runStep = () => wf.jobs.rollback.steps.find((s) => typeof s.run === 'string');

  test('dispatched manually with an optional deployment_id input', () => {
    const t = triggers();
    expect(t).toHaveProperty('workflow_dispatch');
    const input = t.workflow_dispatch.inputs.deployment_id;
    expect(input).toBeDefined();
    expect(input.required).toBe(false);
  });

  test('workflow_dispatch is the ONLY trigger (manual dispatch only)', () => {
    // A future PR adding `schedule:`/`push:` would contradict the "manual
    // dispatch only" contract — a scheduled/auto rollback is exactly what we
    // must never have.
    expect(Object.keys(triggers())).toEqual(['workflow_dispatch']);
  });

  test('exactly one job, which rolls back shytalk-site', () => {
    expect(Object.keys(wf.jobs)).toEqual(['rollback']);
    expect(wf.jobs.rollback.name).toMatch(/shytalk-site/);
  });

  test('NO approval gate — the rollback job declares no environment', () => {
    // The whole point of the tool: recovery must never be blocked behind an
    // approver while prod is already down. An `environment:` key would
    // re-introduce the production approval gate.
    expect(wf.jobs.rollback.environment).toBeUndefined();
  });

  test('dedicated concurrency group, NOT the multi-platform deploy-prod group', () => {
    expect(wf.concurrency.group).toBe('rollback-web-prod');
    expect(wf.concurrency.group).not.toBe('deploy-prod');
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
  });

  test('least-privilege permissions (contents: read only)', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
  });

  test('job is time-boxed (timeout-minutes: 10)', () => {
    expect(wf.jobs.rollback['timeout-minutes']).toBe(10);
  });

  test('targets shytalk-site via the CF rollback endpoint as a POST', () => {
    const run = runStep().run;
    expect(run).toContain('pages/projects/shytalk-site');
    expect(run).toMatch(/deployments\/\$\{target\}\/rollback/);
    // Must be a POST — curl defaults to GET, which would silently turn the
    // "rollback" into a no-op read.
    expect(run).toMatch(/curl -fsS -X POST[^\n]*\/rollback/);
  });

  test('uses the canonical previous-production selection filter', () => {
    // Keeps the executed-fixture test below honest: if the workflow's filter
    // drifts from SELECT_FILTER, this fails and forces both to be updated.
    expect(runStep().run).toContain(SELECT_FILTER);
    expect(runStep().run).toContain('.environment == "production"');
  });

  test('the previous-production selection logic picks index [1] across shapes', () => {
    // A JS mirror of the pinned jq filter (SELECT_FILTER, asserted verbatim in
    // the workflow above): filter to production, take the SECOND newest ([1] —
    // [0] is the current live one), default to "" when there is no previous.
    // Mirrored rather than shelling out to jq to avoid a PATH-resolved OS
    // command (sonarjs/no-os-command-from-path); the verbatim string-pin above
    // guarantees the workflow uses this exact filter.
    const pick = (result) => {
      const prod = result.filter((d) => d.environment === 'production');
      return prod[1]?.id ?? '';
    };
    // Many, with preview deployments interleaved (newest-first): [0] is live,
    // the next production entry is the one we roll back to.
    expect(
      pick([
        { id: 'live', environment: 'production' },
        { id: 'pv1', environment: 'preview' },
        { id: 'prev', environment: 'production' },
        { id: 'older', environment: 'production' },
      ]),
    ).toBe('prev');
    // Exactly one production deployment → nothing to roll back to → empty.
    expect(
      pick([
        { id: 'live', environment: 'production' },
        { id: 'pv', environment: 'preview' },
      ]),
    ).toBe('');
    // Zero production deployments → empty.
    expect(pick([{ id: 'pv', environment: 'preview' }])).toBe('');
    // Empty result set → empty (never throws).
    expect(pick([])).toBe('');
  });

  test('no-previous-deployment guard fails loud (never promotes the live [0])', () => {
    expect(runStep().run).toContain('No previous production deployment found to roll back to.');
  });

  test('a failed rollback (success:false) fails loud and echoes .errors', () => {
    const run = runStep().run;
    // The success check must compare against "true" with `!=` — inverting to
    // `==` would print "Rollback OK" on a genuine failure and error on a real
    // success. Pin the exact comparison so that inversion fails this test.
    expect(run).toMatch(/jq -r '\.success' <<<"\$resp"\)" != "true"/);
    expect(run).toContain("jq -c '.errors'");
  });

  test('on success, prints the resulting live deployment id + url', () => {
    expect(runStep().run).toMatch(/jq -r '\.result\.id'[\s\S]*jq -r '\.result\.url'/);
  });

  test('operator input passed via env, never inlined into run (injection hygiene)', () => {
    const step = runStep();
    expect(step.env.TARGET_ID).toBe('${{ inputs.deployment_id }}');
    // Referenced as the shell env var (`$TARGET_ID` or `${TARGET_ID}`), the
    // safe indirection — not the raw GitHub expression.
    expect(step.run).toMatch(/\$\{?TARGET_ID\}?/);
    // The raw expression must NOT appear in the run script — that would be
    // the unsafe interpolation pattern the env indirection exists to avoid.
    expect(step.run).not.toContain('${{ inputs.deployment_id }}');
  });

  test('fails fast on a missing CF token BEFORE any API call, under strict bash', () => {
    const run = runStep().run;
    expect(run).toContain('set -euo pipefail');
    // Assert the ACTUAL fail-fast guard (not merely that the token name
    // appears somewhere — it also appears in the Authorization header). The
    // guard's error message must precede the first curl.
    const guardMsg = 'CLOUDFLARE_API_TOKEN secret is not set';
    expect(run).toContain(guardMsg);
    // Anchor on the curl COMMAND (`curl -fsS`), not the bare word "curl"
    // which also appears in an explanatory comment above the guard.
    expect(run.indexOf(guardMsg)).toBeLessThan(run.indexOf('curl -fsS'));
  });

  test('rollback-web-prod is registered in the concurrency guard allowlist', () => {
    // Directly covers the one-line addition to
    // scripts/check-workflow-concurrency-scoping.sh: the global group must be
    // in INTENTIONAL_GLOBALS, else CI's guard would flag rollback.yml as an
    // unscoped group. Static read (not spawning bash) — avoids a PATH-resolved
    // OS command in the test.
    const guard = fs.readFileSync(
      path.join(REPO_ROOT, 'scripts/check-workflow-concurrency-scoping.sh'),
      'utf8',
    );
    // Anchor on the array's real closing paren (a `)` at line start) — a
    // non-greedy stop at the first `)` would end inside the deploy-dev comment
    // (`…TestFlight queue)`), before the rollback-web-prod entry.
    const globalsBlock = guard.match(/INTENTIONAL_GLOBALS=\(([\s\S]*?)\n\)/);
    expect(globalsBlock).not.toBeNull();
    expect(globalsBlock[1]).toContain('"rollback-web-prod"');
  });
});
