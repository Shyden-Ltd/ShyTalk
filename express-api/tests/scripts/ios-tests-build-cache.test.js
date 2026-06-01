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
 *
 * PR #827 R2 + R3 additions:
 *   - 4 cache steps pinned (cocoapods-repos, iosApp/Pods,
 *     ios-derived, ios-spm) — SHA, path, key, restore-keys,
 *     ordering, has_tests guard on Install CocoaPods
 *   - xcodebuild perf flags pinned (--quiet, -clonedSourcePackagesDirPath,
 *     -skipPackagePluginValidation, -skipMacroValidation)
 *   - extractCacheKeyLines helper + 7 direct contract tests
 *     (key + restore-keys capture, metadata exclusion, multi-entry
 *     block-scalar, sibling-indent termination, empty-line
 *     termination, no-cache-step empty result, YAML-comment-line
 *     rejection — added R3 I-2)
 *   - Verify iosAppTests Pods integration step (jest invocation,
 *     AFTER install, no has_tests guard) — wires the new
 *     ios-pods-integration-pin.test.js into CI
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

/**
 * Extract the cache-key value lines from an actions/cache step block —
 * the `key:` line plus the block-scalar continuation under
 * `restore-keys: |`. Excludes step metadata (`name:`, `id:`, `path:`,
 * `uses:`) which can incidentally contain a cache prefix but are not
 * cache-key values that need runner.os scoping.
 *
 * Used by the defence-in-depth "every cache-key line carries
 * ${{ runner.os }}" checks (R2 review I-3). Positive scoping is more
 * robust than negative exclusion: when a new metadata field (or YAML
 * comment) is added to a step, the test only checks the lines that
 * actually matter, instead of silently catching the new line as a
 * false positive.
 *
 * YAML block-scalar termination: the loop walks forward from the
 * `restore-keys:` line, collecting every line indented MORE than the
 * `restore-keys:` line itself. An empty line, or a line at sibling /
 * parent indent, ends the block.
 */
function extractCacheKeyLines(stepText) {
  const lines = stepText.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('key:')) {
      out.push(lines[i]);
    } else if (trimmed.startsWith('restore-keys:')) {
      const baseIndent = lines[i].search(/\S/);
      for (let j = i + 1; j < lines.length; j++) {
        const indent = lines[j].search(/\S/);
        if (indent < 0 || indent <= baseIndent) break;
        out.push(lines[j]);
      }
    }
  }
  return out;
}

describe('ios-tests.yml — build-ios job cold-cache survival', () => {
  let yamlText;
  let buildIosJob;
  let cacheStep;
  let kmpBuildStep;

  beforeAll(() => {
    yamlText = fs.readFileSync(IOS_TESTS_PATH, 'utf8');
    buildIosJob = extractJob(yamlText, 'build-ios');
    // Step renamed 2026-06-01: the combined actions/cache step was
    // split into restore + save to bound the cache-save blast radius
    // (the combined step's POST-job upload would hang for hours on
    // ~/.konan's multi-GB payload, with job-level timeout-minutes
    // unable to enforce a kill on the synthetic POST). The restore
    // step carries the key + restore-keys + path that this suite
    // pins; the save step's safety attributes are pinned separately
    // by ios-konan-cache-no-hang.test.js.
    cacheStep = extractStep(yamlText, 'Restore Kotlin/Native cache (~/.konan)');
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
  test('Restore Kotlin/Native step pins actions/cache/restore@v5.0.5 SHA (matches deploy-dev)', () => {
    expect(cacheStep).toContain('actions/cache/restore@27d5ce7f107fe9357f9df03efb73ab90386fccae');
  });

  test('Restore Kotlin/Native step targets ~/.konan', () => {
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
    // would silently miss).
    //
    // Exclusions (none of these are cache key values):
    //   - `restore-keys:` — the keyword itself
    //   - `id:` — step identifier (e.g. `id: konan-cache-restore`),
    //     added 2026-06-01 when the cache step was split into
    //     restore + save and the restore step gained an `id` so the
    //     save step can gate on its cache-hit output.
    //
    // Filter-into-violations pattern (not forEach + nested expect):
    // when a forEach-with-expect fails, Jest reports only the offending
    // value with no line context. By collecting violations into an
    // array and asserting empty, the failure message shows the full
    // list of offending lines, which is actionable without rerunning
    // the test in a debugger.
    const violations = lines.filter(
      (l) =>
        l.includes('konan-') &&
        !l.includes('restore-keys:') &&
        !/^\s*id:\s+/.test(l) &&
        !l.includes('${{ runner.os }}'),
    );
    expect(violations).toEqual([]);
  });

  // I-1 fix: anchor `indexOf` on the FULL 6-space prefix step header
  // (`      - name: …`), not the bare `- name: …` substring. A YAML
  // comment can never literally equal that prefix because comments
  // are introduced by `#`, not 6 spaces.
  //
  // Renamed 2026-06-01 from `Cache Kotlin/Native (~/.konan)` to the
  // restore step (cache step split into restore + save). The ordering
  // invariant remains the same: restore must happen before the
  // KMP build step so the cache is warm when the build resolves
  // K/N artifacts.
  test('Restore Kotlin/Native cache step appears before the Build shared KMP framework step', () => {
    const cacheStepIdx = yamlText.indexOf('      - name: Restore Kotlin/Native cache (~/.konan)');
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

    // CRLF-safety fixture hardening (carried over from the canonical
    // extractStep helper's review history in afk-install-artifacts.test.js
    // round 5 finding I-1, NOT PR #827's R5):
    // the prior fixture placed the blank line BETWEEN siblings,
    // where premature termination at `\r` happened to land exactly
    // on the boundary — all assertions passed even without trimEnd,
    // so the test couldn't detect a regression. The fix is to place
    // the blank line INSIDE the First step's body. Without trimEnd,
    // the column-0 guard fires on the `\r` blank line and the loop
    // breaks BEFORE capturing `if: always()` — the
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

  // R2 review I-3 helper contract: extractCacheKeyLines underpins all
  // 4 defence-in-depth violation checks. If it silently misses lines,
  // every consumer test passes vacuously. These direct tests pin the
  // contract so a future refactor that breaks the block-scalar walker
  // (or accidentally includes metadata) fails loudly here, not in the
  // 4 downstream "restore-keys is OS-scoped" tests that would each
  // produce a less obvious symptom.
  describe('extractCacheKeyLines helper — contract', () => {
    test('captures the key: line and excludes name/id/path/uses metadata', () => {
      const step = [
        '      - name: Cache iosApp/Pods',
        '        id: pods-cache',
        '        uses: actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae',
        '        with:',
        '          path: iosApp/Pods',
        "          key: pods-${{ runner.os }}-${{ hashFiles('iosApp/Podfile.lock') }}",
        '          restore-keys: |',
        '            pods-${{ runner.os }}-',
      ].join('\n');
      const captured = extractCacheKeyLines(step);
      expect(captured).toHaveLength(2);
      expect(captured[0]).toContain('key: pods-');
      expect(captured[1]).toContain('pods-${{ runner.os }}-');
      // Negative assertions — metadata lines containing the prefix
      // MUST be excluded.
      expect(captured.join('\n')).not.toContain('name:');
      expect(captured.join('\n')).not.toContain('id: pods-cache');
      expect(captured.join('\n')).not.toContain('path: iosApp/Pods');
    });

    test('captures multi-entry restore-keys block-scalar contents', () => {
      const step = [
        '      - name: Cache Multi',
        '        with:',
        '          path: /tmp/multi',
        "          key: multi-${{ runner.os }}-${{ hashFiles('**') }}",
        '          restore-keys: |',
        '            multi-${{ runner.os }}-',
        '            multi-',
        '      - name: NextStep',
      ].join('\n');
      const captured = extractCacheKeyLines(step);
      // 1 key line + 2 restore-keys entries.
      expect(captured).toHaveLength(3);
      // The bare `multi-` entry would be a defence-in-depth violation;
      // this test confirms the helper SEES it (a downstream
      // "no bare prefix" check is the one that would flag it).
      expect(captured.some((l) => l.trim() === 'multi-')).toBe(true);
    });

    test('block-scalar walker terminates at sibling/parent indent', () => {
      const step = [
        '      - name: Cache',
        '        with:',
        '          key: foo-${{ runner.os }}',
        '          restore-keys: |',
        '            foo-${{ runner.os }}-',
        '        env:', // sibling of `with:` — outside the block.
        '          OTHER: foo-bare',
      ].join('\n');
      const captured = extractCacheKeyLines(step);
      // Must NOT capture the env block — it's at a parent indent
      // relative to `restore-keys:`.
      expect(captured.join('\n')).not.toContain('OTHER: foo-bare');
      expect(captured.join('\n')).not.toContain('env:');
    });

    test('block-scalar walker terminates on empty line inside block', () => {
      const step = [
        '      - name: Cache',
        '        with:',
        '          key: foo-${{ runner.os }}',
        '          restore-keys: |',
        '            foo-${{ runner.os }}-',
        '',
        '      - name: NextStep',
        '        run: |',
        '          echo foo-not-cache',
      ].join('\n');
      const captured = extractCacheKeyLines(step);
      // Walker stops at the empty line — `echo foo-not-cache` (which
      // contains `foo-`) MUST NOT leak in.
      expect(captured.join('\n')).not.toContain('echo foo-not-cache');
    });

    test('returns empty array for a step with no cache keys', () => {
      const step = ['      - name: Run something', '        run: echo hi'].join('\n');
      expect(extractCacheKeyLines(step)).toEqual([]);
    });

    test('does not capture YAML comment lines whose text starts with key:', () => {
      // R3 review I-2: the helper uses `trimmed.startsWith('key:')`
      // which correctly rejects a comment line because comments are
      // prefixed with `#`, so the trimmed line starts with `#`, not
      // `key:`. This test pins that — a refactor that swapped
      // `startsWith` for `includes` would silently capture the
      // commented-out cache key as a violation candidate.
      const step = [
        '      - name: Cache',
        '        with:',
        '          # key: do-not-capture-me',
        "          key: foo-${{ runner.os }}-${{ hashFiles('x') }}",
        '          restore-keys: |',
        '            foo-${{ runner.os }}-',
      ].join('\n');
      const captured = extractCacheKeyLines(step);
      expect(captured).toHaveLength(2);
      expect(captured.join('\n')).not.toContain('# key:');
      expect(captured.join('\n')).not.toContain('do-not-capture-me');
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

// ── PR #827 cache + xcodebuild flag pins ─────────────────────────────
//
// Added by PR #827 after operator flagged Build iOS step taking ~35min.
// 4 new cache steps + 4 xcodebuild flags estimated ~20min warm-cache
// savings. Each pinned here so a future "cleanup" PR can't silently
// regress to the slow path. Same coverage shape as the konan cache
// pins above (SHA, path, key, restore-key OS-scope) plus per-flag
// presence pins for xcodebuild.
describe('ios-tests.yml — build-ios cache + xcodebuild perf pins (PR #827)', () => {
  let yamlText;
  let cocoaPodsRepoCacheStep;
  let podsCacheStep;
  let derivedDataCacheStep;
  let swiftPmCacheStep;
  let installPodsStep;
  let buildIosStep;

  beforeAll(() => {
    yamlText = fs.readFileSync(IOS_TESTS_PATH, 'utf8');
    cocoaPodsRepoCacheStep = extractStep(
      yamlText,
      'Cache CocoaPods spec repos (~/.cocoapods/repos)',
    );
    podsCacheStep = extractStep(yamlText, 'Cache iosApp/Pods');
    derivedDataCacheStep = extractStep(
      yamlText,
      'Cache Xcode DerivedData (build/ios-derived-data)',
    );
    swiftPmCacheStep = extractStep(yamlText, 'Cache SwiftPM packages (build/ios-spm-packages)');
    installPodsStep = extractStep(yamlText, 'Install CocoaPods');
    buildIosStep = extractStep(yamlText, 'Build iOS app for testing');
  });

  describe('CocoaPods spec-repos cache', () => {
    test('pins actions/cache@v5.0.5 SHA', () => {
      expect(cocoaPodsRepoCacheStep).toContain(
        'actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae',
      );
    });
    test('targets ~/.cocoapods/repos', () => {
      expect(cocoaPodsRepoCacheStep).toContain('~/.cocoapods/repos');
    });
    test('key keyed on Podfile.lock', () => {
      expect(cocoaPodsRepoCacheStep).toContain("hashFiles('iosApp/Podfile.lock')");
    });
    test('restore-keys is OS-scoped (cocoapods-repos-${{ runner.os }}-)', () => {
      const lines = cocoaPodsRepoCacheStep.split('\n');
      const idx = lines.findIndex((l) => l.includes('restore-keys:'));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(lines[idx + 1]).toContain('cocoapods-repos-${{ runner.os }}-');
      // R2 review I-3: defence-in-depth — assert every CACHE-KEY VALUE
      // line (the `key:` line + the `restore-keys:` block-scalar
      // contents) carries the runner.os scope. Positively scoped via
      // extractCacheKeyLines so step metadata (name/id/path/uses) that
      // incidentally contains the prefix doesn't cause a false positive.
      // Guards a future PR adding a second restore-key entry with a
      // bare prefix.
      const violations = extractCacheKeyLines(cocoaPodsRepoCacheStep).filter(
        (l) => l.includes('cocoapods-repos-') && !l.includes('${{ runner.os }}'),
      );
      expect(violations).toEqual([]);
    });
  });

  describe('iosApp/Pods cache (load-bearing — gates Install CocoaPods skip)', () => {
    test('pins actions/cache@v5.0.5 SHA', () => {
      expect(podsCacheStep).toContain('actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae');
    });
    test('targets iosApp/Pods', () => {
      expect(podsCacheStep).toContain('path: iosApp/Pods');
    });
    test('has id: pods-cache (required for Install CocoaPods step cache-hit ref)', () => {
      // Without `id: pods-cache`, the `steps.pods-cache.outputs.cache-hit`
      // reference in the Install CocoaPods step's `if:` evaluates to
      // empty string, and `pod install` would run on every push even
      // on warm cache — defeating the whole optimisation.
      expect(podsCacheStep).toContain('id: pods-cache');
    });
    test('key keyed on Podfile.lock', () => {
      expect(podsCacheStep).toContain("hashFiles('iosApp/Podfile.lock')");
    });
    test('restore-keys is OS-scoped (pods-${{ runner.os }}-)', () => {
      const lines = podsCacheStep.split('\n');
      const idx = lines.findIndex((l) => l.includes('restore-keys:'));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(lines[idx + 1]).toContain('pods-${{ runner.os }}-');
      // Defence-in-depth via positively-scoped extractCacheKeyLines.
      // The step also has `id: pods-cache` which contains `pods-` but
      // is step metadata, not a cache key value — the helper excludes it.
      const violations = extractCacheKeyLines(podsCacheStep).filter(
        (l) => l.includes('pods-') && !l.includes('${{ runner.os }}'),
      );
      expect(violations).toEqual([]);
    });
  });

  describe('Xcode DerivedData cache', () => {
    test('pins actions/cache@v5.0.5 SHA', () => {
      expect(derivedDataCacheStep).toContain(
        'actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae',
      );
    });
    test('targets build/ios-derived-data (matches xcodebuild -derivedDataPath)', () => {
      expect(derivedDataCacheStep).toContain('path: build/ios-derived-data');
    });
    test('key does NOT use bare iosApp/** glob (C-1 fix: would include iosApp/Pods/**)', () => {
      // The Pods cache restores iosApp/Pods/ BEFORE this hashFiles
      // runs. A bare `iosApp/**` glob would include those Pods files
      // and produce a warm-Pods-induced cache key, guaranteeing a
      // DerivedData miss on every warm-Pods run. Must list specific
      // committed dirs/files instead.
      expect(derivedDataCacheStep).not.toContain("hashFiles('iosApp/**'");
    });
    test('key hashes app/test/UI-test sources + project + Podfile.lock + Configurations', () => {
      expect(derivedDataCacheStep).toContain("'iosApp/iosApp/**'");
      expect(derivedDataCacheStep).toContain("'iosApp/iosAppTests/**'");
      expect(derivedDataCacheStep).toContain("'iosApp/iosAppUITests/**'");
      expect(derivedDataCacheStep).toContain("'iosApp/iosApp.xcodeproj/**'");
      expect(derivedDataCacheStep).toContain("'iosApp/Podfile.lock'");
      expect(derivedDataCacheStep).toContain("'iosApp/Configurations/**'");
    });
    test('key hashes KMP simulator framework so KMP-source changes invalidate', () => {
      expect(derivedDataCacheStep).toContain("'shared/build/bin/iosSimulatorArm64/**'");
    });
    test('restore-keys is OS-scoped', () => {
      const lines = derivedDataCacheStep.split('\n');
      const idx = lines.findIndex((l) => l.includes('restore-keys:'));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(lines[idx + 1]).toContain('ios-derived-${{ runner.os }}-');
      // Defence-in-depth via positively-scoped extractCacheKeyLines.
      // The step's `name:` ("Cache Xcode DerivedData (build/ios-derived-data)")
      // and `path:` (`build/ios-derived-data`) both contain `ios-derived-`
      // but are step metadata, not cache key values — the helper excludes them.
      const violations = extractCacheKeyLines(derivedDataCacheStep).filter(
        (l) => l.includes('ios-derived-') && !l.includes('${{ runner.os }}'),
      );
      expect(violations).toEqual([]);
    });
  });

  describe('SwiftPM packages cache', () => {
    test('pins actions/cache@v5.0.5 SHA', () => {
      expect(swiftPmCacheStep).toContain('actions/cache@27d5ce7f107fe9357f9df03efb73ab90386fccae');
    });
    test('targets build/ios-spm-packages (matches xcodebuild -clonedSourcePackagesDirPath)', () => {
      expect(swiftPmCacheStep).toContain('path: build/ios-spm-packages');
    });
    test('key keyed on Package.resolved + Package.swift', () => {
      expect(swiftPmCacheStep).toContain("hashFiles('iosApp/**/Package.resolved'");
      expect(swiftPmCacheStep).toContain("'iosApp/**/Package.swift'");
    });
    test('restore-keys is OS-scoped (ios-spm-${{ runner.os }}-)', () => {
      const lines = swiftPmCacheStep.split('\n');
      const idx = lines.findIndex((l) => l.includes('restore-keys:'));
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(lines[idx + 1]).toContain('ios-spm-${{ runner.os }}-');
      // Defence-in-depth via positively-scoped extractCacheKeyLines.
      // The step's `name:` and `path:` both contain `ios-spm-` but are
      // step metadata, not cache key values — the helper excludes them.
      const violations = extractCacheKeyLines(swiftPmCacheStep).filter(
        (l) => l.includes('ios-spm-') && !l.includes('${{ runner.os }}'),
      );
      expect(violations).toEqual([]);
    });
  });

  describe('Install CocoaPods step', () => {
    test('uses --deployment (I-5: lock divergence fails loudly)', () => {
      expect(installPodsStep).toContain('pod install --deployment');
    });
    test('skip-on-cache-hit gate references steps.pods-cache.outputs.cache-hit', () => {
      // Without this gate, pod install runs on every push even with
      // warm Pods cache, defeating the cache. The gate is load-bearing.
      expect(installPodsStep).toContain("steps.pods-cache.outputs.cache-hit != 'true'");
    });
    test('also guarded by has_tests == true (no pod install on no-test branches)', () => {
      // R2 review I-1: a future PR removing `has_tests == 'true'`
      // from the if would run pod install even on branches with no
      // iOS test targets, wasting runner minutes. Pin the guard.
      expect(installPodsStep).toContain("steps.check-tests.outputs.has_tests == 'true'");
    });
  });

  describe('Build iOS app for testing — xcodebuild perf flags', () => {
    test('uses -quiet (drops per-file CpHeader/CompileC chatter, stays under 48k log line ceiling)', () => {
      expect(buildIosStep).toContain('-quiet');
    });
    test('uses -clonedSourcePackagesDirPath build/ios-spm-packages (cacheable SPM dir)', () => {
      expect(buildIosStep).toContain('-clonedSourcePackagesDirPath build/ios-spm-packages');
    });
    test('uses -skipPackagePluginValidation (no interactive trust prompts in CI)', () => {
      expect(buildIosStep).toContain('-skipPackagePluginValidation');
    });
    test('uses -skipMacroValidation (no interactive Swift-macro trust prompts in CI)', () => {
      expect(buildIosStep).toContain('-skipMacroValidation');
    });
    test('still uses -derivedDataPath build/ios-derived-data (matches DerivedData cache path)', () => {
      expect(buildIosStep).toContain('-derivedDataPath build/ios-derived-data');
    });
  });

  describe('Ordering — caches restore BEFORE Install CocoaPods + Build iOS app', () => {
    test('Cache iosApp/Pods step appears before Install CocoaPods', () => {
      const cacheIdx = yamlText.indexOf('      - name: Cache iosApp/Pods');
      const installIdx = yamlText.indexOf('      - name: Install CocoaPods');
      expect(cacheIdx).toBeGreaterThanOrEqual(0);
      expect(installIdx).toBeGreaterThanOrEqual(0);
      expect(cacheIdx).toBeLessThan(installIdx);
    });
    test('Cache CocoaPods spec repos appears before Install CocoaPods', () => {
      // R2 review I-2: spec-repos cache must be restored before
      // `pod install` so CocoaPods uses the cached master mirror
      // instead of re-cloning trunk (~1-3min waste on cold miss).
      const cacheIdx = yamlText.indexOf(
        '      - name: Cache CocoaPods spec repos (~/.cocoapods/repos)',
      );
      const installIdx = yamlText.indexOf('      - name: Install CocoaPods');
      expect(cacheIdx).toBeGreaterThanOrEqual(0);
      expect(installIdx).toBeGreaterThanOrEqual(0);
      expect(cacheIdx).toBeLessThan(installIdx);
    });
    test('Cache DerivedData + SwiftPM steps appear before Build iOS app for testing', () => {
      const derivedIdx = yamlText.indexOf(
        '      - name: Cache Xcode DerivedData (build/ios-derived-data)',
      );
      const spmIdx = yamlText.indexOf(
        '      - name: Cache SwiftPM packages (build/ios-spm-packages)',
      );
      const buildIdx = yamlText.indexOf('      - name: Build iOS app for testing');
      expect(derivedIdx).toBeGreaterThanOrEqual(0);
      expect(spmIdx).toBeGreaterThanOrEqual(0);
      expect(buildIdx).toBeGreaterThanOrEqual(0);
      expect(derivedIdx).toBeLessThan(buildIdx);
      expect(spmIdx).toBeLessThan(buildIdx);
    });
  });
});

// ── ios-pods-integration-pin.test.js CI wiring (C-3 fix) ─────────────
describe('ios-tests.yml — Verify iosAppTests Pods integration CI step', () => {
  let yamlText;
  let pinStep;

  beforeAll(() => {
    yamlText = fs.readFileSync(IOS_TESTS_PATH, 'utf8');
    pinStep = extractStep(yamlText, 'Verify iosAppTests Pods integration (pin contract)');
  });

  test('Verify iosAppTests Pods integration step exists', () => {
    expect(pinStep).toContain('npx jest tests/scripts/ios-pods-integration-pin.test.js');
  });

  test('Verify iosAppTests step appears AFTER Install CocoaPods (reads post-install pbxproj)', () => {
    const installIdx = yamlText.indexOf('      - name: Install CocoaPods');
    const pinIdx = yamlText.indexOf(
      '      - name: Verify iosAppTests Pods integration (pin contract)',
    );
    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(pinIdx).toBeGreaterThanOrEqual(0);
    expect(pinIdx).toBeGreaterThan(installIdx);
  });

  test('Verify iosAppTests step has NO `if:` guard on has_tests (contract is always-on)', () => {
    // The Pods integration contract for iosAppTests must hold even
    // when XCTest targets are temporarily empty — the wiring itself
    // is what's pinned.
    const lines = pinStep.split('\n');
    const ifLines = lines.filter((l) => /^\s+if:/.test(l));
    expect(ifLines).toEqual([]);
  });

  test('Verify iosAppTests step uses working-directory: express-api (not inline cd)', () => {
    // R3 review M-2: GitHub Actions idiomatic form is
    // `working-directory:` not `cd express-api &&` chained into the
    // run command. Pin the idiomatic form so a future PR can't
    // regress to the inline cd (which conflicts with the project
    // convention for non-Bash steps).
    expect(pinStep).toContain('working-directory: express-api');
    expect(pinStep).not.toContain('cd express-api');
  });
});

describe('ios-tests.yml — Verify pbxproj-mutation script idempotency step', () => {
  let yamlText;
  let idempotencyStep;

  beforeAll(() => {
    yamlText = fs.readFileSync(IOS_TESTS_PATH, 'utf8');
    idempotencyStep = extractStep(yamlText, 'Verify pbxproj-mutation script idempotency');
  });

  test('step uses working-directory: express-api (R3 M-2 consistency)', () => {
    // Companion to the Verify iosAppTests step — both jest-driving
    // verification steps must use the idiomatic GitHub Actions form
    // for the working directory.
    expect(idempotencyStep).toContain('working-directory: express-api');
    // R4 I-2 + R5 I-1: `gem install xcodeproj` (no --user-install)
    // installs to the system Ruby gem directory, which is on
    // $LOAD_PATH for the runner user. working-directory doesn't
    // affect gem installation; the step is still correct. What
    // MUST be absent is the inline `cd express-api` form.
    expect(idempotencyStep).not.toContain('cd express-api');
  });

  test('step still invokes jest on ios-local-configurations.test.js', () => {
    // Pin the contract — the step's purpose is to run the
    // idempotency assertions. A working-directory refactor must NOT
    // accidentally drop the jest call.
    expect(idempotencyStep).toContain('npx jest tests/scripts/ios-local-configurations.test.js');
  });

  test('step installs xcodeproj gem BEFORE invoking jest (R4 I-3)', () => {
    // R4 review I-3: the Ruby script `add-local-configurations.rb`
    // does `require 'xcodeproj'`. Without `gem install xcodeproj`
    // first, the require fails on a cold macOS runner (the gem is
    // not pre-installed). A future refactor that drops the gem
    // install line — or splits it to a different preceding step
    // (making it absent from THIS step block) — must fail this test.
    //
    // R5 T-1: assert the exact token `gem install xcodeproj` (not
    // separate `gem install` and `xcodeproj` substrings), so a
    // change to `gem install bundler` plus an unrelated `xcodeproj`
    // reference can't accidentally pass.
    // R5 I-2: the ordering check `gemIdx < jestIdx` does NOT prove
    // presence — if gemIdx is -1 (absent) and jestIdx is positive,
    // `-1 < positive` is TRUE and the test silently passes the
    // absent-gem-install case. The `toContain` calls below are the
    // load-bearing presence checks; the indexOf comparison adds
    // ordering on top.
    expect(idempotencyStep).toContain('gem install xcodeproj');
    expect(idempotencyStep).toContain('npx jest');
    // R6 I-1: the YAML comments captured by extractStep also mention
    // `gem install xcodeproj` (the R4 I-2 explanatory comment),
    // so indexOf on the full step would hit the COMMENT first and
    // silently pass a swapped ordering inside the `run: |` block.
    // Scope the ordering check to the run-block contents only.
    //
    // R7 I-1: guard runBlockStart >= 0 for symmetry with the
    // regression pin test below — if `run: |` is ever absent (e.g.,
    // the step migrates to `run: |-` or `run: >`), the slice would
    // become a no-op (slice(-1) = last char) and the comparison
    // would produce the cryptic `-1 < -1` failure message. The
    // guard fails first with a clear diagnostic.
    const runBlockStart = idempotencyStep.indexOf('run: |');
    expect(runBlockStart).toBeGreaterThanOrEqual(0);
    const runBlock = idempotencyStep.slice(runBlockStart);
    expect(runBlock.indexOf('gem install xcodeproj')).toBeLessThan(runBlock.indexOf('npx jest'));
  });

  test('runBlock scoping excludes the comment mention of `gem install xcodeproj` (R6 regression pin)', () => {
    // R6 review I-1 regression pin: prove the `run: |` scoping is
    // load-bearing. The R4 explanatory comment in ios-tests.yml
    // mentions the literal string `gem install xcodeproj` BEFORE
    // the `run: |` block. Without the slice, `indexOf` would hit
    // the comment occurrence and an inverted ordering inside the
    // run-block would silently pass.
    //
    // This test pins the scoping behaviour: the runBlock substring
    // must NOT contain the comment-line prefix `# R4 review I-2:`
    // (which is what the comment line starts with), and the
    // `gem install xcodeproj` text inside runBlock must come from
    // the actual shell command, not the comment.
    const runBlockStart = idempotencyStep.indexOf('run: |');
    expect(runBlockStart).toBeGreaterThanOrEqual(0);
    const runBlock = idempotencyStep.slice(runBlockStart);
    expect(runBlock).not.toContain('# R4 review I-2');
    expect(runBlock).toContain('gem install xcodeproj');
  });
});
