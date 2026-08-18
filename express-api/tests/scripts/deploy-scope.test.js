'use strict';

/**
 * SHY-0347 — which deploy areas a change set touches.
 *
 * PR #1794 merged five markdown files and the deploy that followed spent
 * 53 MINUTES in the iOS archive before timing out. Every `workflow_dispatch`
 * input on `deploy-dev.yml` defaults to `true`, so a bare dispatch ships
 * everything regardless of the diff.
 *
 * `scripts/deploy-scope.sh` is the logic that decides whether an hour of macOS
 * runner time gets spent, so it is a script rather than inline YAML and it is
 * tested here — the alternative is dispatching a workflow to find out.
 *
 * The asymmetry that shapes every assertion below: a deploy that runs when it
 * needn't costs runner minutes; a deploy SKIPPED when it was needed ships
 * nothing and nobody notices. So the script fails SAFE, and the "no diff
 * available" case is tested as carefully as the happy path.
 */

const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const SCRIPT = join(__dirname, '..', '..', '..', 'scripts', 'deploy-scope.sh');

/** An absolute bash, never resolved through PATH (sonarjs/no-os-command-from-path). */
const BASH = ['/bin/bash', '/usr/bin/bash'].find((p) => existsSync(p));

/** Run the script with `paths` on stdin and return its outputs as an object. */
function scope(paths) {
  const out = execFileSync(BASH, [SCRIPT], {
    input: paths.join('\n'),
    encoding: 'utf8',
  });
  return Object.fromEntries(
    out
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => {
        const [k, v] = l.split('=');
        return [k, v === 'true' ? true : v === 'false' ? false : v];
      }),
  );
}

describe('SHY-0347 — deploy scope from a change set', () => {
  test('a docs-only diff deploys NOTHING — the defect, in one assertion', () => {
    // The exact shape of PR #1794. Today this costs an iOS archive.
    const s = scope([
      '.project/stories/SHY-0340-moderator-mute-does-not-stick.md',
      '.project/stories/SHY-INDEX.md',
      'README.md',
      'CLAUDE.md',
    ]);
    expect(s).toMatchObject({ backend: false, web: false, android: false, ios: false });
  });

  test('a backend-only diff deploys the backend and nothing else', () => {
    const s = scope(['express-api/src/routes/users.js']);
    expect(s).toMatchObject({ backend: true, web: false, android: false, ios: false });
  });

  test('shared Kotlin deploys BOTH apps — it is compiled into each', () => {
    // The case most likely to be got wrong: commonMain is not "the Android
    // app", it is both. Skipping iOS here would ship a stale iOS binary
    // against changed shared logic.
    const s = scope(['shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/User.kt']);
    expect(s).toMatchObject({ android: true, ios: true, backend: false, web: false });
  });

  test('platform-specific shared code deploys only that platform', () => {
    expect(scope(['shared/src/iosMain/kotlin/X.kt'])).toMatchObject({ ios: true, android: false });
    expect(scope(['shared/src/androidMain/kotlin/X.kt'])).toMatchObject({
      android: true,
      ios: false,
    });
  });

  test('app code deploys its own platform', () => {
    expect(scope(['app/src/main/java/A.kt'])).toMatchObject({ android: true, ios: false });
    expect(scope(['iosApp/iosApp/AppEnvironment.swift'])).toMatchObject({
      ios: true,
      android: false,
    });
  });

  test('website changes deploy the web only', () => {
    expect(scope(['public/privacy.html'])).toMatchObject({
      web: true,
      backend: false,
      android: false,
      ios: false,
    });
  });

  test('build configuration deploys both apps', () => {
    // A dependency bump changes what is compiled into both binaries.
    expect(scope(['gradle/libs.versions.toml'])).toMatchObject({ android: true, ios: true });
  });

  test('firestore rules count as backend', () => {
    // Rules are deployed with the backend and are the difference between a
    // working app and a permission-denied one — SHY-0338 was exactly that.
    expect(scope(['firestore.rules'])).toMatchObject({ backend: true });
  });

  test('a mixed diff deploys every area it touches', () => {
    const s = scope([
      'express-api/src/routes/users.js',
      'public/index.html',
      'app/src/main/java/A.kt',
      'iosApp/iosApp/X.swift',
    ]);
    expect(s).toMatchObject({ backend: true, web: true, android: true, ios: true });
  });

  test('NO diff available fails SAFE by deploying everything', () => {
    // The assertion that matters most. Empty input means "I could not work out
    // what changed", NOT "nothing changed". Getting this backwards turns an
    // unresolvable baseline into a silent no-op deploy.
    const s = scope([]);
    expect(s).toMatchObject({ backend: true, web: true, android: true, ios: true });
    expect(s.reason).toBe('no-diff-available-failing-safe');
  });

  test('the reason is reported so a surprising skip can be explained', () => {
    expect(scope(['README.md']).reason).toBe('derived-from-diff');
  });

  test('tests and workflows deploy nothing', () => {
    const s = scope([
      'express-api/tests/routes/users-batch-cohort.test.js',
      '.github/workflows/pr-checks.yml',
      'scripts/deploy-scope.sh',
    ]);
    expect(s).toMatchObject({ backend: false, web: false, android: false, ios: false });
  });
});
describe('SHY-0347 — every deploy job consults the detection', () => {
  const { readFileSync } = require('node:fs');
  const WORKFLOW = join(__dirname, '..', '..', '..', '.github', 'workflows', 'deploy-dev.yml');
  const yamlSrc = () => readFileSync(WORKFLOW, 'utf8');

  /** A job's own lines, ending at the next top-level job key. */
  function jobBlock(name) {
    const lines = yamlSrc().split('\n');
    const start = lines.findIndex((l) => l === `  ${name}:`);
    if (start < 0) throw new Error(`job ${name} not found`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^ {2}[A-Za-z0-9_-]+:$/.test(lines[i])) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join('\n');
  }

  test.each([
    ['deploy-backend-dev', 'backend'],
    ['deploy-web-dev', 'web'],
    ['distribute-android', 'android'],
    ['distribute-ios', 'ios'],
  ])('%s is gated on the detected scope', (job, area) => {
    // The assertion that makes the whole story real. Without it a job could
    // quietly revert to `inputs.X` alone and nothing would notice until the
    // next hour-long archive of a documentation change.
    const block = jobBlock(job);
    expect(block).toMatch(
      new RegExp(`needs\\.detect-deploy-scope\\.outputs\\.${area}\\s*==\\s*'true'`),
    );
    expect(block).toMatch(/needs:.*detect-deploy-scope|needs: \[[^\]]*detect-deploy-scope/s);
  });

  test('the detector job exists and publishes every area as an output', () => {
    const block = jobBlock('detect-deploy-scope');
    for (const area of ['backend', 'web', 'android', 'ios']) {
      expect(block).toMatch(new RegExp(`^\\s+${area}: `, 'm'));
    }
  });

  test('the detector runs the shared script rather than reimplementing it inline', () => {
    // Two copies of this logic is two chances to be wrong and one to be fixed —
    // the same trap that reddened SHY-0284 when a workflow line was hand-copied
    // into a test fixture.
    expect(jobBlock('detect-deploy-scope')).toMatch(/scripts\/deploy-scope\.sh/);
  });
});
