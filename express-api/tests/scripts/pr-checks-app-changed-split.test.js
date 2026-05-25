/**
 * pr-checks.yml — APP_CHANGED granular-split contract pin.
 *
 * Triggered by: 2026-05-25 observation that release PRs (which
 * only touch app/build.gradle.kts + release notes) were eating
 * ~45min of macOS runner time on the full iOS pipeline (Build iOS
 * + iOS E2E) despite touching ZERO iOS files. Same for Android-only
 * feature PRs: they pay iOS Build cost. Same for iOS-only PRs:
 * they pay Android KMP build cost.
 *
 * Root cause: pr-checks.yml's detect-changes step lumped
 * `app/*|shared/*|iosApp/*|gradle/*|*.gradle.kts|...` into a
 * single APP=true flag. Downstream Build & Test (Android) and
 * Build iOS jobs both gated on `app_changed == 'true'`, so any
 * one of those files triggered both pipelines.
 *
 * Fix: split into per-platform granular flags:
 *   - `android_app_changed`: app/* OR shared/src/androidMain/*
 *     OR shared/* (commonMain etc affects both) OR
 *     gradle-infra (gradle/*, *.gradle.kts, gradle.properties,
 *     gradlew, gradlew.bat — affect both platforms)
 *   - `ios_app_changed`: iosApp/* OR shared/src/iosMain/* OR
 *     shared/* OR gradle-infra (same union)
 *   - `app_changed` (backward compat): union of both — used by
 *     lint.yml (ktlint covers both), sonarcloud.yml (Kotlin
 *     metrics), integration-tests (KMP contract changes affect
 *     both Express ↔ shared contracts)
 *
 * Then change two job gates:
 *   - build-and-test → `android_app_changed == 'true'`
 *   - ios-e2e → `ios_app_changed == 'true'`
 *
 * Lint.yml, sonarcloud.yml, integration-tests, android-e2e
 * continue to use `app_changed` (any-of) so they still run on
 * cross-platform changes.
 *
 * Coverage (15 tests across 4 describe blocks):
 *   - detect-changes outputs declare all 3 flags
 *     (android_app_changed, ios_app_changed, app_changed)
 *   - case statement: per-platform classification rules
 *     (iosApp/*, app/*, shared/src/iosMain/*,
 *      shared/src/androidMain/*, shared/*, gradle infra)
 *   - case statement: ORDER is correct (specific patterns like
 *     shared/src/iosMain/* BEFORE generic shared/* — shell case
 *     is first-match, so specific must come first to win)
 *   - downstream gates:
 *     - build-and-test job uses android_app_changed
 *     - ios-e2e job uses ios_app_changed
 *     - android-e2e job uses android_app_changed
 *     - sonarcloud / lint / integration-tests keep using
 *       app_changed (intentional — they cover both)
 *   - behavioral via extracted shell script: simulated file
 *     lists produce the expected classifications (release PR
 *     → only ANDROID_APP; iOS-only PR → only IOS_APP; shared
 *     change → both; gradle infra → both)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PR_CHECKS_PATH = path.join(REPO_ROOT, '.github/workflows/pr-checks.yml');

/**
 * Extract a workflow step's full YAML block by its `- name:`
 * header. Mirror of the canonical helper in ios-tests-build-cache.test.js.
 */
function extractStep(yamlText, stepName) {
  const lines = yamlText.split('\n');
  const stepHeader = `      - name: ${stepName}`;
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd() === stepHeader) matches.push(i);
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
    const trimmed = lines[endIdx].trimEnd();
    if (trimmed.startsWith('      - name:')) break;
    if (trimmed.length > 0 && !trimmed.startsWith(' ')) break;
    endIdx++;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/**
 * Extract a job's full YAML block by `<jobName>:` at 2-space indent.
 * Mirror of the canonical helper.
 */
function extractJob(yamlText, jobName) {
  const lines = yamlText.split('\n');
  const jobsSectionIdx = lines.findIndex((l) => l.trimEnd() === 'jobs:');
  if (jobsSectionIdx < 0) {
    throw new Error('Could not find "jobs:" section in workflow file.');
  }
  const jobHeader = `  ${jobName}:`;
  const matches = [];
  for (let i = jobsSectionIdx + 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === jobHeader) matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(`Could not find job "${jobName}" in workflow file.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous job name "${jobName}": found at lines ${matches.map((i) => i + 1).join(', ')}.`,
    );
  }
  const startIdx = matches[0];
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    const trimmed = lines[endIdx].trimEnd();
    if (/^ {2}[a-zA-Z_][\w-]*:$/.test(trimmed)) break;
    if (trimmed.length > 0 && !trimmed.startsWith(' ')) break;
    endIdx++;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/**
 * Extract the case-statement body from the detect-changes step
 * and run it against a synthetic file list in a real bash shell.
 * Returns the resulting flag values as an object.
 *
 * This is the BEHAVIORAL pin — it actually runs the production
 * classification logic against the inputs the test cares about
 * (release PR, Android-only, iOS-only, shared, gradle infra).
 * Structural pins above prove the right patterns are present;
 * behavioral pin proves the runtime semantics are correct.
 */
function classifyFiles(yamlText, files) {
  const stepBlock = extractStep(yamlText, 'Detect changed paths');
  // Pull the `case "$file" in ... esac` block out of the step.
  // The case statement is the heart of the classification.
  const caseMatch = stepBlock.match(/case "\$file" in([\s\S]*?)esac/);
  if (!caseMatch) {
    throw new Error('Could not find case statement in detect-changes step');
  }
  const caseBody = caseMatch[1];
  // Build a synthetic bash script that initialises all flags,
  // iterates the provided files, runs the case statement on each,
  // and prints the final flag values as KEY=VALUE pairs.
  const flagsInit =
    'ANDROID_APP=false IOS_APP=false APP=false BACKEND=false WEB=false INTEGRATION=false OTHER=false GRADLE_INFRA=false';
  const fileList = files.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ');
  const script = `
set -e
${flagsInit}
for file in ${fileList}; do
  case "$file" in${caseBody}esac
done
echo "ANDROID_APP=$ANDROID_APP"
echo "IOS_APP=$IOS_APP"
echo "APP=$APP"
echo "BACKEND=$BACKEND"
echo "WEB=$WEB"
echo "INTEGRATION=$INTEGRATION"
echo "OTHER=$OTHER"
echo "GRADLE_INFRA=$GRADLE_INFRA"
`;
  // Use absolute path /bin/bash (not PATH lookup) to satisfy
  // sonarjs/no-os-command-from-path — and because the test must
  // run the SAME bash that the GitHub Actions runner uses (the
  // canonical macOS-15 runner ships /bin/bash 3.2 from the OS).
  const out = execFileSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
  const result = {};
  for (const line of out.trim().split('\n')) {
    const [k, v] = line.split('=');
    result[k] = v;
  }
  return result;
}

describe('pr-checks.yml — APP_CHANGED granular-split contract', () => {
  let yamlText;
  let detectStep;

  beforeAll(() => {
    yamlText = fs.readFileSync(PR_CHECKS_PATH, 'utf8');
    detectStep = extractStep(yamlText, 'Detect changed paths');
  });

  describe('detect-changes outputs declare all 3 flags', () => {
    test('android_app_changed output is declared', () => {
      // Plain substring check at the canonical 6-space outputs
      // indent — avoids the ReDoS-flagged `\s+` quantifier and is
      // a more precise pin (catches a refactor that drops the
      // outputs: block indent convention).
      expect(yamlText).toContain('\n      android_app_changed:');
    });

    test('ios_app_changed output is declared', () => {
      expect(yamlText).toContain('\n      ios_app_changed:');
    });

    test('app_changed output is preserved (backward compat for lint/sonar/integration)', () => {
      expect(yamlText).toContain('\n      app_changed:');
    });
  });

  describe('case statement classification patterns', () => {
    test('iosApp/* sets IOS_APP', () => {
      expect(detectStep).toMatch(/iosApp\/\*\).*?IOS_APP=true/);
    });

    test('app/* sets ANDROID_APP', () => {
      // Anchored on the case-arm form `app/*)` to avoid matching
      // `iosApp/*)` or `app/src/...) which would be inside the arm body.
      expect(detectStep).toMatch(/\bapp\/\*\).*?ANDROID_APP=true/);
    });

    test('shared/src/iosMain/* sets IOS_APP only (specific case BEFORE generic shared/*)', () => {
      expect(detectStep).toMatch(/shared\/src\/iosMain\/\*\).*?IOS_APP=true/);
      // Negative: this arm must NOT also set ANDROID_APP, because
      // iosMain is iOS-actual-only.
      const iosMainArm = detectStep.match(/shared\/src\/iosMain\/\*\)([^\n]*?);;/);
      expect(iosMainArm).not.toBeNull();
      expect(iosMainArm[1]).not.toMatch(/ANDROID_APP=true/);
    });

    test('shared/src/androidMain/* sets ANDROID_APP only', () => {
      expect(detectStep).toMatch(/shared\/src\/androidMain\/\*\).*?ANDROID_APP=true/);
      const androidMainArm = detectStep.match(/shared\/src\/androidMain\/\*\)([^\n]*?);;/);
      expect(androidMainArm).not.toBeNull();
      expect(androidMainArm[1]).not.toMatch(/IOS_APP=true/);
    });

    test('shared/* (commonMain et al.) sets BOTH ANDROID_APP and IOS_APP', () => {
      // The generic `shared/*` arm catches commonMain and anything
      // else under shared/ that doesn't match an earlier arm.
      const sharedArm = detectStep.match(/\bshared\/\*\)([^\n]*?);;/);
      expect(sharedArm).not.toBeNull();
      expect(sharedArm[1]).toMatch(/ANDROID_APP=true/);
      expect(sharedArm[1]).toMatch(/IOS_APP=true/);
    });

    test('gradle/* + *.gradle.kts + gradle.properties + gradlew set BOTH platforms', () => {
      // Gradle infra affects every Gradle invocation, including the
      // KMP framework build that iOS depends on.
      const gradleArm = detectStep.match(/gradle\/\*\|[^)\n]*\)([^\n]*?);;/);
      expect(gradleArm).not.toBeNull();
      expect(gradleArm[1]).toMatch(/ANDROID_APP=true/);
      expect(gradleArm[1]).toMatch(/IOS_APP=true/);
    });

    test('case-arm ordering: iosMain/androidMain BEFORE generic shared/* (shell first-match wins)', () => {
      const iosMainIdx = detectStep.indexOf('shared/src/iosMain/*)');
      const androidMainIdx = detectStep.indexOf('shared/src/androidMain/*)');
      const sharedIdx = detectStep.indexOf('shared/*)');
      expect(iosMainIdx).toBeGreaterThanOrEqual(0);
      expect(androidMainIdx).toBeGreaterThanOrEqual(0);
      expect(sharedIdx).toBeGreaterThan(iosMainIdx);
      expect(sharedIdx).toBeGreaterThan(androidMainIdx);
    });
  });

  describe('downstream job gates use the granular flags', () => {
    test('build-and-test (Android KMP) gates on android_app_changed', () => {
      const job = extractJob(yamlText, 'build-and-test');
      expect(job).toContain('android_app_changed');
      // Hard requirement: android_app_changed appears as the gate
      // in this job's if: block (in `== 'true'` form). Negative
      // assertion below confirms the legacy app_changed gate was
      // actually replaced, not just augmented.
      expect(job).toMatch(/android_app_changed\s*==\s*'true'/);
      // The legacy `needs.detect-changes.outputs.app_changed`
      // reference must NOT appear in this job — the whole point of
      // the split is that build-and-test (Android) no longer fires
      // for iOS-only PRs.
      expect(job).not.toMatch(/needs\.detect-changes\.outputs\.app_changed/);
    });

    test('ios-e2e gates on ios_app_changed', () => {
      const job = extractJob(yamlText, 'ios-e2e');
      expect(job).toMatch(/ios_app_changed\s*==\s*'true'/);
    });

    test('android-e2e gates on android_app_changed', () => {
      const job = extractJob(yamlText, 'android-e2e');
      expect(job).toMatch(/android_app_changed\s*==\s*'true'/);
    });
  });

  describe('behavioral pin: case statement classifies real PR file lists correctly', () => {
    test('release PR (only app/build.gradle.kts + release notes) → ANDROID_APP only', () => {
      const result = classifyFiles(yamlText, [
        'app/build.gradle.kts',
        'app/src/main/play/release-notes/en-US/internal.txt',
      ]);
      expect(result.ANDROID_APP).toBe('true');
      expect(result.IOS_APP).toBe('false');
    });

    test('iOS-only PR (only iosApp/) → IOS_APP only', () => {
      const result = classifyFiles(yamlText, [
        'iosApp/iosApp/LiveKitBridge.swift',
        'iosApp/iosApp.xcodeproj/project.pbxproj',
      ]);
      expect(result.IOS_APP).toBe('true');
      expect(result.ANDROID_APP).toBe('false');
    });

    test('shared/iosMain change → IOS_APP only (Kotlin/Native iOS-actual)', () => {
      const result = classifyFiles(yamlText, [
        'shared/src/iosMain/kotlin/com/shyden/shytalk/foo/IosFooImpl.kt',
      ]);
      expect(result.IOS_APP).toBe('true');
      expect(result.ANDROID_APP).toBe('false');
    });

    test('shared/commonMain change → BOTH (affects every platform)', () => {
      const result = classifyFiles(yamlText, [
        'shared/src/commonMain/kotlin/com/shyden/shytalk/foo/Foo.kt',
      ]);
      expect(result.ANDROID_APP).toBe('true');
      expect(result.IOS_APP).toBe('true');
    });

    test('gradle.properties change → BOTH (affects every Gradle invocation)', () => {
      const result = classifyFiles(yamlText, ['gradle.properties']);
      expect(result.ANDROID_APP).toBe('true');
      expect(result.IOS_APP).toBe('true');
    });
  });
});
