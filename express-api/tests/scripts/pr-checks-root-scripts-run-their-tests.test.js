/**
 * SHY-0284: a root `scripts/**` change must RUN ITS TESTS — and nothing else.
 *
 * Root scripts had no automated coverage on a PR that touched only them: they
 * fell to `*) OTHER=true`, which feeds the workflow_only decision and never
 * sets `backend_changed`, and `test-backend` is gated on `backend_changed`.
 * Fifteen Jest suites exist solely to exercise root scripts, and none of them
 * ran. That is the defect this story fixes, one layer down — the guard this
 * story ADDS is itself a root script.
 *
 * The obvious fix is `scripts/*) BACKEND=true`, and it is wrong. `BACKEND` is
 * not a "run the backend tests" flag: the SHY-0127 block downstream reads it
 * as "the shared core changed, so every client must be retested" and forces
 * APP, ANDROID_APP, IOS_APP, WEB and INTEGRATION true while clearing the E2E
 * skip markers. Editing `scripts/backup-r2.sh` would then trigger a 25-minute
 * Gradle build, the full browser matrix and device E2E — and CLAUDE.md's own
 * CI-config-only boundary lists the product-runtime paths that justify that
 * cascade, which root `scripts/**` is not among.
 *
 * So the classification carries its own flag and `test-backend` runs on either.
 *
 * Real bash, real case statement, extracted from the real workflow — no
 * doubles, per the repo's no-stubs rule.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = path.resolve(__dirname, '../../../.github/workflows/pr-checks.yml');
const yaml = fs.readFileSync(WORKFLOW, 'utf8');

/** The `case "$file" in … esac` body, run for real against a file list. */
function classify(files) {
  const caseMatch = yaml.match(/case "\$file" in([\s\S]*?)esac/);
  if (!caseMatch) throw new Error('case statement not found in pr-checks.yml');
  const list = files.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ');
  const script = `
set -e
ANDROID_APP=false IOS_APP=false APP=false BACKEND=false WEB=false INTEGRATION=false SCRIPTS=false OTHER=false
for file in ${list}; do
  case "$file" in${caseMatch[1]}esac
done
for v in ANDROID_APP IOS_APP APP BACKEND WEB INTEGRATION SCRIPTS OTHER; do
  eval "echo \\"$v=\\$$v\\""
done
`;
  const r = spawnSync('/bin/bash', ['-c', script], {
    encoding: 'utf8',
    timeout: 30000,
  });
  if (r.status !== 0) throw new Error(`bash failed: ${r.stderr}`);
  return Object.fromEntries(
    r.stdout
      .trim()
      .split('\n')
      .map((l) => {
        const [k, v] = l.split('=');
        return [k, v === 'true'];
      }),
  );
}

describe('SHY-0284: a root script change runs the suites that cover it', () => {
  it.each([
    ['scripts/check-action-pin-consistency.js'],
    ['scripts/lib/action-pins.js'],
    ['scripts/check-large-files.sh'],
    ['scripts/ios/some-helper.rb'],
  ])('%s marks the scripts area as changed', (file) => {
    expect(classify([file]).SCRIPTS).toBe(true);
  });

  it('a root script does NOT masquerade as a backend change', () => {
    // The whole point. BACKEND is read downstream as "retest every client".
    const flags = classify(['scripts/backup-r2.sh']);
    expect(flags.SCRIPTS).toBe(true);
    expect(flags.BACKEND).toBe(false);
    expect(flags.APP).toBe(false);
    expect(flags.ANDROID_APP).toBe(false);
    expect(flags.IOS_APP).toBe(false);
    expect(flags.WEB).toBe(false);
    expect(flags.INTEGRATION).toBe(false);
  });

  it('a real backend change still forces the full client matrix', () => {
    // Guards the fix against over-correcting: SHY-0127 must be untouched.
    const flags = classify(['express-api/src/routes/rooms.js']);
    expect(flags.BACKEND).toBe(true);
  });

  it('a root script no longer falls through to OTHER', () => {
    // OTHER only feeds the workflow_only decision, which is how these
    // scripts came to have no coverage on a PR that changed only them.
    expect(classify(['scripts/check-no-new-stubs.js']).OTHER).toBe(false);
  });

  it('the classification still recognises the paths it always did', () => {
    expect(classify(['app/src/main/Foo.kt']).ANDROID_APP).toBe(true);
    expect(classify(['iosApp/iosApp/Bar.swift']).IOS_APP).toBe(true);
    expect(classify(['public/index.html']).WEB).toBe(true);
    expect(classify(['firestore.rules']).BACKEND).toBe(true);
    expect(classify(['README.md']).OTHER).toBe(false);
  });
});

describe('SHY-0284: the jobs that must run for a root script change', () => {
  /** A job header block, from `  name:` to the next job at the same indent. */
  function job(name) {
    const start = yaml.indexOf(`\n  ${name}:\n`);
    if (start === -1) throw new Error(`job ${name} not found`);
    const rest = yaml.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  }

  it('test-backend runs when the scripts area changed', () => {
    // Otherwise the fifteen suites covering root scripts stay unrun and the
    // classification above accomplishes nothing.
    expect(job('test-backend')).toMatch(/scripts_changed == 'true'/);
  });

  it('the detect-changes job publishes scripts_changed', () => {
    expect(yaml).toMatch(/scripts_changed: \$\{\{ steps\.changes\.outputs/);
    expect(yaml).toMatch(/scripts_changed=\$SCRIPTS/);
  });

  it('the lint job is not gated on anything', () => {
    // This is where the original defect lived: the pin guard runs from
    // lint.yml, and an `if:` on this job would silently stop running it on
    // exactly the workflow-only PRs it exists for. The step-level checks in
    // check-action-pin-consistency.test.js cannot see a JOB-level gate.
    const header = job('lint');
    expect(header).not.toMatch(/^ {4}if:/m);
  });
});
