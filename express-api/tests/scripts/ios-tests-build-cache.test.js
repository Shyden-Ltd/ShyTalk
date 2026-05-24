/**
 * ios-tests.yml — build-ios job cold-cache survival
 *
 * Triggered by: PR #714 was the first PR after PR #708 (which enabled
 * iOS E2E gating) to touch iOS files. Its pr-checks `build-ios` job
 * cancelled at exactly 30 min — the job-level timeout. Cold K/N
 * compile alone takes 24-29 min on macos-15; with CocoaPods install +
 * xcodebuild build-for-testing on top, 30 min is too tight.
 *
 * Mirrors the fix PR #690 applied to deploy-dev.yml's distribute-ios
 * job: add a `~/.konan` cache step + bump the job-level timeout.
 *
 * Coverage:
 *   - timeout-minutes is at least 60 (was 30)
 *   - the new konan cache step exists, scoped to the build-ios job
 *   - SHA pin matches deploy-dev (supply-chain consistency)
 *   - cache key uses gradle/libs.versions.toml hash
 *   - restore-keys is OS-scoped (konan-${{ runner.os }}-) NOT bare
 *     (a bare `konan-` prefix would restore a Linux toolchain onto
 *     a macOS runner — silent corruption)
 *   - cache step appears before the gradle warm-up step
 *   - --max-workers=1 carries over from PR #690 (catches a future
 *     "CI speed optimisation" PR that removes the flag)
 *   - extractStep helper error branches (unknown name + non-6-space
 *     indent) — ambiguous-name omitted because no step names
 *     duplicate across jobs in ios-tests.yml today
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const IOS_TESTS_PATH = path.join(REPO_ROOT, '.github/workflows/ios-tests.yml');

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
 *
 * Mirror of the canonical helper in afk-install-artifacts.test.js —
 * keep these two in sync (Round 2 P-1 fix).
 */
function extractStep(yamlText, stepName) {
  const lines = yamlText.split('\n');
  const stepHeader = `      - name: ${stepName}`;
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    // Round 3 M-1: trimEnd() for CRLF safety, see extractJob.
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
    // Round 4 I-1: trimEnd() makes the terminator CRLF-safe. A blank
    // CRLF line is `\r` — length 1, doesn't start with a space — and
    // would otherwise falsely fire the "top-level key" guard below.
    const trimmed = lines[endIdx].trimEnd();
    if (trimmed.startsWith('      - name:')) break;
    if (trimmed.length > 0 && !trimmed.startsWith(' ')) break;
    endIdx++;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/**
 * Extract a job's full YAML block by its `<jobName>:` key at the
 * 2-space indent level (jobs.<jobName>). Returns the joined block from
 * the job header to the start of the next sibling job (or end of file).
 *
 * Contract — failure modes:
 *   - No `jobs:` section in the file → throws (defends against
 *     accidental calls against YAML that lacks a top-level `jobs:`
 *     section — covers both non-workflow YAMLs and partial workflow
 *     stubs missing the jobs declaration)
 *   - Zero matches → throws "Could not find job …"
 *   - More than one match → throws "Ambiguous job name …" — symmetric
 *     with extractStep, so the helpers behave the same way under
 *     duplicate names (Round 2 M-2 fix)
 *
 * Scoping: the search starts AFTER the `jobs:` header line. This avoids
 * a latent false-match risk where 2-space-indented `on:` sub-keys
 * (workflow_call, workflow_dispatch) or `concurrency:` sub-keys could
 * theoretically be mistaken for jobs by name or terminate the scan
 * early. Since `jobs:` is by convention the last top-level section in
 * GitHub Actions workflows, the post-`jobs:` slice contains only job
 * definitions — terminator-regex matches are guaranteed to be sibling
 * jobs (Round 2 M-3 fix).
 *
 * The terminator regex `/^ {2}[a-zA-Z_][\w-]*:$/` matches any 2-space
 * bare-colon key. Inside the post-`jobs:` slice this is safe because
 * only sibling job names appear at that indent.
 */
function extractJob(yamlText, jobName) {
  const lines = yamlText.split('\n');
  // Round 3 M-1: trimEnd() handles CRLF line endings — if a Windows
  // contributor with core.autocrlf=true commits the file, `jobs:\r`
  // would never equal `jobs:`. trimEnd is safe on LF (no-op).
  const jobsSectionIdx = lines.findIndex((l) => l.trimEnd() === 'jobs:');
  if (jobsSectionIdx < 0) {
    throw new Error(
      `Could not find "jobs:" section in workflow file. ` +
        'extractJob is for top-level GitHub Actions workflow YAMLs only.',
    );
  }
  const jobHeader = `  ${jobName}:`;
  const matches = [];
  for (let i = jobsSectionIdx + 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === jobHeader) matches.push(i);
  }
  if (matches.length === 0) {
    throw new Error(
      `Could not find job "${jobName}" in workflow file. ` +
        'Job was renamed, removed, or moved outside the jobs: section.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous job name "${jobName}": found at lines ${matches
        .map((i) => i + 1)
        .join(', ')}. Rename one occurrence — job names must be unique within a workflow.`,
    );
  }
  const startIdx = matches[0];
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    // Round 4 I-1: trimEnd() makes both checks CRLF-safe. The regex
    // anchor `:$` does NOT match before a literal `\r` (only before
    // `\n` or end-of-string), and a blank CRLF line is `\r` (length 1)
    // which would falsely fire the column-0 guard. trimEnd handles
    // both. Same pattern as extractStep above.
    const trimmed = lines[endIdx].trimEnd();
    // Terminator: exactly 2 leading spaces, then a letter/underscore,
    // then word chars, then a colon, then end-of-line. Matches sibling
    // job headers (`  test-ios:`, `  ios-summary:`) but NOT job-body
    // keys at 4-space indent (`    name:`, `    outputs:`), because
    // 4-space lines have a space at position 2 which fails the
    // [a-zA-Z_] character class. Verified by the "captures the full
    // build-ios job block including outputs:" test in this file.
    if (/^ {2}[a-zA-Z_][\w-]*:$/.test(trimmed)) break;
    if (trimmed.length > 0 && !trimmed.startsWith(' ')) break;
    endIdx++;
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

describe('ios-tests.yml — build-ios job cold-cache survival', () => {
  let yamlText;
  let buildIosJob;
  let cacheStep;
  let kmpBuildStep;

  beforeAll(() => {
    yamlText = fs.readFileSync(IOS_TESTS_PATH, 'utf8');
    buildIosJob = extractJob(yamlText, 'build-ios');
    cacheStep = extractStep(yamlText, 'Cache Kotlin/Native (~/.konan)');
    kmpBuildStep = extractStep(yamlText, 'Build shared KMP framework for iOS Simulator');
  });

  // Original timeout was 30 min. Cold K/N alone = 24-29 min on
  // macos-15; with pod install + xcodebuild on top, 30 is below the
  // floor. 60 gives ~15 min headroom over the observed worst case
  // (PR #714 cancelled at 30:00 exactly).
  // I-2 fix: assert within the extracted build-ios job block so the
  // regex can't drift to another job's timeout-minutes.
  test('build-ios job timeout-minutes is at least 60', () => {
    const match = buildIosJob.match(/^ {4}timeout-minutes: (\d+)$/m);
    expect(match).not.toBeNull();
    const minutes = parseInt(match[1], 10);
    expect(minutes).toBeGreaterThanOrEqual(60);
  });

  // Round 1 M-1 + Round 2 M-1: pin the exact SHA used by deploy-dev.yml
  // so a supply-chain shift (or a future SHA-pin "update") is caught.
  // The full SHA string contains 'actions/cache' as a substring, so
  // asserting both would be redundant — a single assertion on the
  // pinned SHA covers both the action choice and the version pin.
  test('Cache Kotlin/Native step pins actions/cache@v5.0.5 SHA (matches deploy-dev)', () => {
    expect(cacheStep).toContain('actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae');
  });

  test('Cache Kotlin/Native step targets ~/.konan', () => {
    expect(cacheStep).toContain('~/.konan');
  });

  // Cache key shape mirrors deploy-dev.yml: hash of
  // gradle/libs.versions.toml (the Kotlin version is part of the
  // toolchain version).
  test('konan cache key uses gradle/libs.versions.toml hash', () => {
    expect(cacheStep).toContain("hashFiles('gradle/libs.versions.toml')");
  });

  // M-2 fix: assert the restore-keys VALUE, not just the presence
  // of the key word. A bare `konan-` prefix (missing the OS scope)
  // would restore a Linux toolchain onto a macOS runner — silent
  // corruption.
  test('konan cache restore-keys is OS-scoped (konan-${{ runner.os }}-)', () => {
    // Non-backtracking line-by-line scan: find the `restore-keys:`
    // line then verify the following line contains the OS-scoped
    // prefix. A bare `konan-` prefix (missing OS scope) would match
    // Linux toolchain entries and silently corrupt macOS runs.
    const lines = cacheStep.split('\n');
    const restoreKeysIdx = lines.findIndex((l) => l.includes('restore-keys:'));
    expect(restoreKeysIdx).toBeGreaterThanOrEqual(0);
    expect(lines[restoreKeysIdx + 1]).toContain('konan-${{ runner.os }}-');

    // Round 2 I-2 + Round 3 I-1: defence-in-depth — assert EVERY line
    // in the step that mentions `konan-` carries the `${{ runner.os }}`
    // scope. Guards a future PR that adds a second restore-key entry
    // with a bare `konan-` prefix (which the prior single-line check
    // would silently miss). The `restore-keys:` literal itself is
    // excluded — it's the keyword, not a cache key value.
    //
    // Filter-into-violations pattern (not forEach + nested expect):
    // when a forEach-with-expect fails, Jest reports only the offending
    // value with no line context. By collecting violations into an
    // array and asserting empty, the failure message shows the full
    // list of offending lines, which is actionable without rerunning
    // the test in a debugger.
    const violations = lines.filter(
      (l) =>
        l.includes('konan-') && !l.includes('restore-keys:') && !l.includes('${{ runner.os }}'),
    );
    expect(violations).toEqual([]);
  });

  // I-1 fix: anchor `indexOf` on the FULL 6-space prefix step header
  // (`      - name: …`), not the bare `- name: …` substring. A YAML
  // comment can never literally equal that prefix because comments
  // are introduced by `#`, not 6 spaces.
  test('konan cache step appears before the Build shared KMP framework step', () => {
    const cacheStepIdx = yamlText.indexOf('      - name: Cache Kotlin/Native (~/.konan)');
    const kmpBuildIdx = yamlText.indexOf(
      '      - name: Build shared KMP framework for iOS Simulator',
    );
    expect(cacheStepIdx).toBeGreaterThanOrEqual(0);
    expect(kmpBuildIdx).toBeGreaterThanOrEqual(0);
    expect(cacheStepIdx).toBeLessThan(kmpBuildIdx);
  });

  // M-4 fix: pin --max-workers=1 on the KMP build step. PR #690
  // documented that parallel K/N link tasks deadlock under macOS
  // runner memory pressure. A future "CI speed" PR removing the
  // flag would silently re-introduce the deadlock.
  test('KMP build step uses --max-workers=1 (prevents parallel K/N deadlock)', () => {
    expect(kmpBuildStep).toContain('--max-workers=1');
  });

  // Round 1 P-3 fix: extractStep error-branch coverage matching the
  // canonical contract from afk-install-artifacts.test.js.
  // Ambiguous-name case omitted because no step names duplicate across
  // jobs in ios-tests.yml today — verified by inspection 2026-05-22.
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

    // Round 5 I-1: the prior fixture placed the blank line BETWEEN
    // siblings, where premature termination at `\r` happened to land
    // exactly on the boundary — all assertions passed even without
    // trimEnd, so the test couldn't detect a regression. The fix is
    // to place the blank line INSIDE the First step's body. Without
    // trimEnd, the column-0 guard fires on the `\r` blank line and
    // the loop breaks BEFORE capturing `if: always()` — the
    // `toContain('if: always()')` assertion then fails. With trimEnd,
    // the blank line trims to '' (length 0, falsy column-0 guard),
    // the loop continues, and the full step body is captured.
    test('extractStep handles CRLF line endings without bleed-through', () => {
      const crlf = [
        'jobs:',
        '  build:',
        '    steps:',
        '      - name: First',
        '        run: echo a',
        '', // blank CRLF line INSIDE First's body
        '        if: always()',
        '      - name: Second',
        '        run: echo b',
        '',
      ].join('\r\n');
      const block = extractStep(crlf, 'First');
      expect(block).toContain('run: echo a');
      // Without trimEnd, this fails — the blank `\r` line fires the
      // column-0 guard, terminating capture before `if: always()`.
      expect(block).toContain('if: always()');
      expect(block).not.toContain('Second');
      expect(block).not.toContain('echo b');
    });
  });

  // Round 3 I-2 rebuttal: the reviewer claimed extractJob would
  // prematurely terminate at the `outputs:` declaration in the
  // build-ios job. That's incorrect: `outputs:` inside a job body is
  // 4-space-indented (siblings of `name:`, `runs-on:`, `steps:`),
  // not 2-space. The terminator regex requires EXACTLY 2 leading
  // spaces followed by a letter — 4-space lines have a space at
  // column 2, which fails the [a-zA-Z_] class. This test pins that
  // invariant so a future regex "simplification" that broadens the
  // match (e.g. `^ {2,}[a-zA-Z_]`) would be caught.
  test('extractJob captures the full build-ios block including its outputs declaration', () => {
    expect(buildIosJob).toContain('    outputs:');
    expect(buildIosJob).toContain('has_tests: ${{ steps.check-tests.outputs.has_tests }}');
    // And it does NOT bleed into the next sibling job.
    expect(buildIosJob).not.toContain('  test-ios:');
    expect(buildIosJob).not.toContain('name: "iOS E2E');
  });

  // Round 2 I-1 fix: parity with extractStep — without these tests, a
  // future job rename causes `beforeAll` to throw, and Jest reports
  // all 10 tests with the same generic beforeAll error rather than a
  // single targeted diagnostic. With these tests, the failure mode is
  // localised to the helper's contract violations.
  describe('extractJob helper — error branches', () => {
    test('throws a clear error for unknown job names', () => {
      expect(() => extractJob(yamlText, 'nonexistent-job')).toThrow(
        /Could not find job "nonexistent-job"/,
      );
    });

    test('throws when the file has no "jobs:" section', () => {
      const noJobsYaml = 'name: Foo\non:\n  push:\n    branches: [main]\n';
      expect(() => extractJob(noJobsYaml, 'build')).toThrow(
        /Could not find "jobs:" section in workflow file/,
      );
    });

    // Symmetric with extractStep: throw on ambiguous match, never
    // silently first-match. Synthesised duplicate is the cleanest way
    // to exercise this — none of the real workflow files in the repo
    // contain duplicate job names today.
    test('throws when a job name appears more than once', () => {
      const duplicateYaml = [
        'name: Foo',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '  build:',
        '    runs-on: macos-15',
        '',
      ].join('\n');
      expect(() => extractJob(duplicateYaml, 'build')).toThrow(
        /Ambiguous job name "build": found at lines/,
      );
    });

    // Round 4 I-1: pin CRLF-tolerance on the terminator path. Without
    // trimEnd on the regex test (line 162) the sibling `  other:\r`
    // header would not match `^ {2}[a-zA-Z_][\w-]*:$` (the `$` anchor
    // doesn't match before `\r`), so extractJob would return from
    // `  build:` to end-of-file and the `not.toContain('  other:')`
    // assertion would silently fail to catch bleed-through.
    test('extractJob terminates correctly with CRLF line endings', () => {
      const crlfYaml = [
        'name: Foo',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '  other:',
        '    runs-on: ubuntu-latest',
        '',
      ].join('\r\n');
      const block = extractJob(crlfYaml, 'build');
      expect(block).toContain('  build:');
      expect(block).toContain('runs-on: ubuntu-latest');
      expect(block).not.toContain('  other:');
    });
  });
});
