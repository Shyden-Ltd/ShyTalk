/**
 * ios-tests.yml — xcodebuild log capture + artifact upload
 *
 * Phase 3.3 attempt #1 (PR #719) failed in `Build iOS app for
 * testing` at 40m34s, but GitHub Actions truncated the 48k-line
 * log somewhere in the gRPC compile flood, hiding the actual error
 * in a 12-min gap. With the build log uploaded as a workflow
 * artifact, ANY future iOS build failure is debuggable via
 * `gh run download <run-id> -n ios-xcodebuild-logs`.
 *
 * This file pins the wiring:
 *   - `Build iOS app for testing` pipes through `tee` to a file
 *     under build/ios-build-logs/
 *   - `set -o pipefail` is set so xcodebuild's non-zero exit is
 *     preserved through the tee pipe (without it, tee always exits
 *     0 and masks the build failure)
 *   - A subsequent `Upload xcodebuild logs` step uploads
 *     build/ios-build-logs/ as the `ios-xcodebuild-logs` artifact
 *   - That step has `if: always()` so it runs on failure (the
 *     critical case — failures are when we need the log)
 *   - `if-no-files-found: error` so an empty zip is treated as a
 *     bug (defence against tee never receiving output)
 *
 * Without this contract: a future workflow refactor that drops
 * `set -o pipefail`, removes the tee, or strips `if: always()`
 * silently re-blinds CI debugging.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const IOS_TESTS_YML = path.join(REPO_ROOT, '.github/workflows/ios-tests.yml');
const UPLOAD_ARTIFACT_SHA = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

/**
 * Extract a workflow step's full YAML block by its `- name:` header.
 *
 * Mirror of the canonical helper in afk-install-artifacts.test.js
 * and ios-tests-build-cache.test.js — kept line-anchored, CRLF-safe,
 * and ambiguous-name-strict. Round 1 review I-1 required replacing
 * the prior weaker `extractStepBody` with this canonical version so
 * a CRLF line ending or duplicate step header can't silently corrupt
 * the returned block.
 *
 * Contract — failure modes:
 *   - Zero matches → throws "Could not find step …"
 *   - More than one match → throws "Ambiguous step name …" with line
 *     numbers
 *   - Non-6-space-indented input → throws "Could not find step …"
 *
 * trimEnd() on both the header match and the terminator loop makes
 * the helper CRLF-tolerant — `\r` blank lines won't fire the
 * column-0 guard prematurely; sibling job headers with `\r` won't
 * be invisible to the regex.
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

describe('ios-tests.yml — xcodebuild log capture + artifact upload', () => {
  let yamlText;

  beforeAll(() => {
    yamlText = fs.readFileSync(IOS_TESTS_YML, 'utf8');
  });

  describe('Build iOS app for testing — log capture', () => {
    test('Build step pipes xcodebuild output through tee to build/ios-build-logs/', () => {
      const body = extractStep(yamlText, 'Build iOS app for testing');
      expect(body).toContain('build/ios-build-logs/');
      // The tee target file name pinned so the upload step can
      // glob it. `xcodebuild-build-for-testing.log` matches the
      // step's semantic purpose.
      expect(body).toMatch(/tee\s+build\/ios-build-logs\/xcodebuild-build-for-testing\.log/);
    });

    test('Build step sets `set -o pipefail` BEFORE the xcodebuild pipe', () => {
      // Without pipefail, tee's exit 0 swallows xcodebuild's non-
      // zero exit and the step appears to "succeed" even when the
      // build failed. pipefail propagates the leftmost non-zero
      // exit through the pipe. Use `xcodebuild build-for-testing`
      // (the specific command) so indexOf doesn't land on the word
      // "xcodebuild" inside the comment block above the run script.
      const body = extractStep(yamlText, 'Build iOS app for testing');
      const pipefailIdx = body.indexOf('set -o pipefail');
      const xcodebuildCmdIdx = body.indexOf('xcodebuild build-for-testing');
      expect(pipefailIdx).toBeGreaterThanOrEqual(0);
      expect(xcodebuildCmdIdx).toBeGreaterThan(pipefailIdx);
    });

    test('Build step creates the log directory before tee tries to write to it', () => {
      // tee fails if the parent directory doesn't exist. `mkdir -p`
      // is idempotent and must precede the xcodebuild | tee pipe.
      // Use the specific command `xcodebuild build-for-testing` so
      // the indexOf doesn't land on the word "xcodebuild" inside
      // the step's comment block.
      const body = extractStep(yamlText, 'Build iOS app for testing');
      const mkdirIdx = body.indexOf('mkdir -p build/ios-build-logs');
      const xcodebuildCmdIdx = body.indexOf('xcodebuild build-for-testing');
      expect(mkdirIdx).toBeGreaterThanOrEqual(0);
      expect(xcodebuildCmdIdx).toBeGreaterThan(mkdirIdx);
    });
  });

  describe('Upload xcodebuild logs — artifact step', () => {
    test('Upload xcodebuild logs step exists', () => {
      expect(yamlText).toContain('      - name: Upload xcodebuild logs');
    });

    test('Upload step uses pinned actions/upload-artifact SHA', () => {
      const body = extractStep(yamlText, 'Upload xcodebuild logs');
      expect(body).toContain(UPLOAD_ARTIFACT_SHA);
    });

    test('Upload step has if: always() so it runs ON FAILURE (the critical case)', () => {
      // The whole point of this artifact is debugging failures. If
      // `if: always()` is missing, the upload only runs when the
      // build succeeds — exactly the opposite of when we need it.
      // Plain substring check avoids sonarjs/slow-regex (\s+ would
      // be unbounded). The step uses exactly 8 leading spaces.
      const body = extractStep(yamlText, 'Upload xcodebuild logs');
      expect(body).toContain('\n        if: always()');
    });

    // Round 1 I-2: pin the FULL compound `if` condition. The prior
    // test asserted `always()` was present but not that the
    // `has_tests == 'true'` clause was also there. Without the
    // has_tests guard, a run on a repo with no XCTest targets would
    // skip the build step entirely, leaving nothing for tee to write,
    // and `if-no-files-found: error` would fire on an empty zip —
    // false-positive failure. Pin both halves of the AND.
    test('Upload step if condition includes has_tests == true guard', () => {
      const body = extractStep(yamlText, 'Upload xcodebuild logs');
      expect(body).toContain("if: always() && steps.check-tests.outputs.has_tests == 'true'");
    });

    test('Upload step uses artifact name ios-xcodebuild-logs', () => {
      const body = extractStep(yamlText, 'Upload xcodebuild logs');
      expect(body).toContain('name: ios-xcodebuild-logs');
    });

    test('Upload step uses if-no-files-found: error (defence against silent empty zips)', () => {
      // Default `warn` would silently produce an empty zip if the
      // tee never wrote anything (e.g. xcodebuild failed before
      // emitting output). `error` makes the missing-log condition
      // a loud failure.
      const body = extractStep(yamlText, 'Upload xcodebuild logs');
      expect(body).toContain('if-no-files-found: error');
    });

    test('Upload step path globs the build/ios-build-logs/ directory', () => {
      const body = extractStep(yamlText, 'Upload xcodebuild logs');
      // Plain substring match avoids sonarjs/slow-regex (\s* is
      // unbounded). YAML uses exactly one space after `path:`.
      expect(body).toContain('path: build/ios-build-logs');
    });

    test('Upload step runs AFTER Build iOS app for testing (so the log file exists)', () => {
      const buildIdx = yamlText.indexOf('      - name: Build iOS app for testing');
      const uploadIdx = yamlText.indexOf('      - name: Upload xcodebuild logs');
      expect(buildIdx).toBeGreaterThanOrEqual(0);
      expect(uploadIdx).toBeGreaterThan(buildIdx);
    });

    test('Upload step has retention-days: 7 (matches the existing iOS test-bundle artifact)', () => {
      const body = extractStep(yamlText, 'Upload xcodebuild logs');
      expect(body).toMatch(/retention-days:\s*7/);
    });
  });

  // Round 1 I-1: error-branch tests per the canonical extractStep
  // contract in ios-tests-build-cache.test.js and afk-install-
  // artifacts.test.js. Ensures this file's copy of the helper
  // behaves identically under failure modes — unknown step name,
  // non-6-space indent, CRLF round-trip.
  //
  // Ambiguous-name throw not exercised here because none of THIS
  // file's tests call extractStep with a name that duplicates in
  // ios-tests.yml. Note: ios-tests.yml DOES contain a duplicate
  // step name today (`Select Xcode 26.3` appears in both build-ios
  // and test-ios jobs from PR #718), so any future test in THIS
  // file that calls extractStep with that name would correctly
  // throw "Ambiguous step name" — that path is canonically tested
  // in afk-install-artifacts.test.js against deploy-dev.yml's
  // duplicate "Install dependencies" step.
  describe('extractStep helper — error branches', () => {
    test('throws a clear error for unknown step names', () => {
      expect(() => extractStep(yamlText, 'Nonexistent Step Name')).toThrow(
        /Could not find step "Nonexistent Step Name"/,
      );
    });

    test('throws when YAML uses non-6-space step indentation', () => {
      const fourSpaceIndent = '    - name: Some Step\n      run: echo hi\n';
      expect(() => extractStep(fourSpaceIndent, 'Some Step')).toThrow(
        /Could not find step "Some Step"/,
      );
    });

    test('handles CRLF line endings without bleed-through', () => {
      // Same fixture pattern as ios-tests-build-cache.test.js — blank
      // CRLF line INSIDE the First step body. Without trimEnd on the
      // terminator's column-0 guard, the `\r` blank line truncates
      // capture before reaching `if: always()`.
      const crlf = [
        'jobs:',
        '  build:',
        '    steps:',
        '      - name: First',
        '        run: echo a',
        '',
        '        if: always()',
        '      - name: Second',
        '        run: echo b',
        '',
      ].join('\r\n');
      const block = extractStep(crlf, 'First');
      expect(block).toContain('run: echo a');
      expect(block).toContain('if: always()');
      expect(block).not.toContain('Second');
      expect(block).not.toContain('echo b');
    });
  });
});
