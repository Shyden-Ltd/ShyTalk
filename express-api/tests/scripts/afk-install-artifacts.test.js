/**
 * Asserts the CI artifact surface needed for autonomous install of
 * dev + local flavors on both physical devices (OnePlus + iPhone).
 *
 * Coverage after PR #713:
 *   - Android dev:    pr-checks.yml uploads `dev-release-apk` (pre-existing)
 *   - Android local:  pr-checks.yml uploads `local-debug-apk`   (this PR)
 *   - iOS dev:        deploy-dev.yml uploads `dev-ios-ipa`       (this PR)
 *   - iOS local:      out of scope — no Xcode scheme exists (Phase 3)
 *
 * Each upload pins:
 *   - name (artifact identifier for `gh run download`)
 *   - path (gradle output dir / runner.temp export dir)
 *   - if-no-files-found: error  (fail loud on empty glob)
 *   - retention-days: 7
 *
 * Implementation: an `extractStep(yaml, stepName)` helper that
 * matches step header by exact string equality (no regex
 * backtracking, no anchor-to-comment drift class). All assertions
 * are scoped to a specific step block.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PR_CHECKS_PATH = path.join(REPO_ROOT, '.github/workflows/pr-checks.yml');
const DEPLOY_DEV_PATH = path.join(REPO_ROOT, '.github/workflows/deploy-dev.yml');

/**
 * Extract a workflow step's full YAML block by its `- name:` header.
 *
 * Walks the file line-by-line, finds the exact `      - name: <stepName>`
 * header line (6-space indent, step-list level), then captures every
 * subsequent line until the next `      - name:` step header or the
 * next top-level YAML key (column 0). Returns the joined block.
 *
 * Contract — failure modes:
 *   - Zero matches → throws "Could not find step …"
 *   - More than one match → throws "Ambiguous step name …" (no silent
 *     first-match — the helper does NOT pick a block when the name is
 *     duplicated across jobs in the same file; callers must use a
 *     uniquely-named step header or scope by job)
 *   - Non-6-space-indented input (e.g. composite-action YAMLs with
 *     4-space step indent) → throws "Could not find step" because the
 *     hardcoded `      - name:` prefix won't match
 *
 * Exact string equality on the header line (not regex) eliminates the
 * anchor-to-comment class of bug: a comment elsewhere in the file
 * containing the step name can't match because comments are prefixed
 * with `#` and don't equal the literal header string.
 */
function extractStep(yamlText, stepName) {
  const lines = yamlText.split('\n');
  const stepHeader = `      - name: ${stepName}`;
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === stepHeader) matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(
      `Could not find step "${stepName}" in workflow file. ` +
        'Step was renamed, removed, or indentation changed (helper ' +
        'requires 6-space step indent) — update this test to match.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous step name "${stepName}": found at lines ${matches
        .map((i) => i + 1)
        .join(', ')}. Use a more specific name or scope to a single job.`,
    );
  }
  const startIdx = matches[0];
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    // Next step header at the same indent level terminates this block.
    if (lines[endIdx].startsWith('      - name:')) break;
    // Top-level YAML key (column 0, non-comment) also terminates.
    if (lines[endIdx].length > 0 && !lines[endIdx].startsWith(' ')) break;
    endIdx++;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

describe('CI artifact surface for AFK install', () => {
  describe('pr-checks.yml — Android local-flavor APK', () => {
    let yamlText;
    let buildBlock;
    let uploadBlock;

    beforeAll(() => {
      yamlText = fs.readFileSync(PR_CHECKS_PATH, 'utf8');
      buildBlock = extractStep(yamlText, 'Build localDebug APK');
      uploadBlock = extractStep(yamlText, 'Upload localDebug APK');
    });

    test('Build localDebug APK step runs assembleLocalDebug', () => {
      expect(buildBlock).toContain('./gradlew assembleLocalDebug');
    });

    test('Build localDebug APK step has no dead env vars (KEYSTORE_PASSWORD, LIVEKIT_URL)', () => {
      // The `local` flavor hardcodes both values in
      // app/build.gradle.kts (LIVEKIT_URL as `ws://$localHostAlias:7880`,
      // KEYSTORE_PASSWORD is only consumed by signingConfigs.release
      // which the debug build type doesn't reference). Carrying these
      // env vars over from the dev step would mislead future
      // maintainers into thinking the local-debug build needs
      // release-signing credentials.
      expect(buildBlock).not.toContain('KEYSTORE_PASSWORD');
      expect(buildBlock).not.toContain('LIVEKIT_URL');
    });

    test('Upload localDebug APK step uses the local-debug-apk artifact name', () => {
      expect(uploadBlock).toContain('name: local-debug-apk');
    });

    test('Upload localDebug APK path points at the gradle local-debug output dir', () => {
      expect(uploadBlock).toContain('path: app/build/outputs/apk/local/debug/*.apk');
    });

    test('Upload localDebug APK uses if-no-files-found: error (fail loud on empty glob)', () => {
      // Default `warn` would silently produce an empty zip — gh run
      // download would succeed with an empty dir, breaking AFK
      // install. `error` is the only acceptable value here.
      expect(uploadBlock).toContain('if-no-files-found: error');
    });

    test('Upload localDebug APK has retention-days: 7 (matches IPA retention)', () => {
      expect(uploadBlock).toMatch(/^ {10}retention-days: 7$/m);
    });
  });

  describe('deploy-dev.yml — iOS dev IPA artifact', () => {
    let yamlText;
    let uploadBlock;

    beforeAll(() => {
      yamlText = fs.readFileSync(DEPLOY_DEV_PATH, 'utf8');
      uploadBlock = extractStep(yamlText, 'Upload IPA as workflow artifact');
    });

    test('Upload IPA step uses the dev-ios-ipa artifact name', () => {
      expect(uploadBlock).toContain('name: dev-ios-ipa');
    });

    test('Upload IPA path points at the runner.temp export directory', () => {
      // Actions-expression `${{ runner.temp }}` is required here —
      // shell-env `$RUNNER_TEMP` is NOT expanded in the `path:`
      // field of an upload-artifact step.
      expect(uploadBlock).toContain('path: ${{ runner.temp }}/export/*.ipa');
    });

    test('Upload IPA uses if-no-files-found: error (defence-in-depth for naming changes)', () => {
      expect(uploadBlock).toContain('if-no-files-found: error');
    });

    test('Upload IPA has retention-days: 7 (matches APK retention for consistency)', () => {
      expect(uploadBlock).toMatch(/^ {10}retention-days: 7$/m);
    });

    test('Upload IPA step runs BEFORE the Upload to TestFlight step', () => {
      // Anchor to step headers (unambiguous — appear exactly once),
      // NOT to artifact name strings (which appear in both comments
      // and the actual `name:` field and would resolve to the
      // first occurrence — likely a comment).
      const uploadStepIdx = yamlText.indexOf('- name: Upload IPA as workflow artifact');
      const testflightStepIdx = yamlText.indexOf('- name: Upload to TestFlight');
      expect(uploadStepIdx).toBeGreaterThanOrEqual(0);
      expect(testflightStepIdx).toBeGreaterThanOrEqual(0);
      expect(uploadStepIdx).toBeLessThan(testflightStepIdx);
    });
  });

  describe('extractStep helper — error branch', () => {
    let yamlText;

    beforeAll(() => {
      yamlText = fs.readFileSync(PR_CHECKS_PATH, 'utf8');
    });

    test('throws a clear error for unknown step names', () => {
      expect(() => extractStep(yamlText, 'Nonexistent Step Name')).toThrow(
        /Could not find step "Nonexistent Step Name"/,
      );
    });

    // I2 (round 3): the helper must NOT silently first-match when a
    // step name is duplicated across jobs in the same file. In
    // deploy-dev.yml, "Install dependencies" appears in both the
    // `sanity-check` and `smoke-tests` jobs. Calling extractStep with
    // an ambiguous name would silently return the first match — a
    // latent footgun. The contract is: throw with line numbers so the
    // caller knows to disambiguate.
    test('throws when a step name appears in more than one job', () => {
      const deployYaml = fs.readFileSync(DEPLOY_DEV_PATH, 'utf8');
      expect(() => extractStep(deployYaml, 'Install dependencies')).toThrow(
        /Ambiguous step name "Install dependencies": found at lines/,
      );
    });

    // I3 (round 3): the helper hardcodes a 6-space step indent —
    // appropriate for top-level workflow YAMLs in this repo, but not
    // for composite-action YAMLs under .github/actions/ which use a
    // 4-space step indent. Document this contract explicitly so a
    // future reuse attempt against the wrong file shape fails loudly
    // rather than silently returning a one-line block.
    test('throws when YAML uses non-6-space step indentation', () => {
      const fourSpaceIndent = '    - name: Some Step\n      run: echo hi\n';
      expect(() => extractStep(fourSpaceIndent, 'Some Step')).toThrow(
        /Could not find step "Some Step"/,
      );
    });
  });
});
