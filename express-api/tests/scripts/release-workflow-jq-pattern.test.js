/**
 * Static assertions on .github/workflows/release.yml's GraphQL commit-back step.
 *
 * Spec: .project/stories/SHY-0065-release-yml-single-jq-pattern.md
 *
 * Mirrors the SHY-0064 single-jq inline-additions guards already applied to
 * .github/workflows/sync-roadmap-data.yml. Preventive — release.yml's
 * combined-payload size (~24KB base64 today) is well below Linux ARG_MAX, so
 * there's no live bug to trip. But the structural symmetry to sync's broken-
 * before-SHY-0064 pattern is the same shape, and Play Store release-notes can
 * legitimately grow over time. Better to apply the proven fix preventively + lock
 * the shape with assertions than to discover ARG_MAX during a release cut.
 *
 * Cross-workflow parity: see the final describe block — both workflows must use
 * the same single-jq idiom, so a future engineer can't accidentally drift one
 * workflow back to the two-jq form while leaving the other on the new shape.
 *
 * Note: this file deliberately covers only the SHY-0065 contribution (the jq
 * commit-back step shape). Other release.yml properties (SHA pinning, removed
 * PR-open step, app-token shape) are covered by release-workflow-pin.test.js.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const RELEASE_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/release.yml');
const SYNC_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/sync-roadmap-data.yml');

describe('.github/workflows/release.yml — SHY-0065 single-jq commit-back pattern', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(RELEASE_WORKFLOW, 'utf8');
  });

  test('release.yml exists', () => {
    expect(fs.existsSync(RELEASE_WORKFLOW)).toBe(true);
  });

  test('contains the createCommitOnBranch GraphQL mutation step', () => {
    expect(content).toMatch(/Create signed commit on main via GraphQL/);
    expect(content).toMatch(/createCommitOnBranch/);
  });

  test('SHY-0065: no `ADDITIONS=$(jq ...)` intermediate bash variable', () => {
    // The pre-SHY-0064 two-step pattern built an ADDITIONS bash variable from a
    // first jq invocation, then passed it to a second jq via --argjson. On sync
    // that pattern blew up at ~237KB base64 with `/usr/bin/jq: Argument list
    // too long` (Linux ARG_MAX). release.yml's payload is smaller today (~24KB)
    // but grows linearly with build.gradle.kts + per-locale Play Store release
    // notes, so we forbid the same structural shape preventively.
    expect(content).not.toMatch(/ADDITIONS=\$\(jq/);
  });

  test('SHY-0065: no `--argjson additions` flag', () => {
    // Companion negative assertion to the no-ADDITIONS-bash-var rule. Catches
    // any variant where someone preserves the variable name but renames it.
    expect(content).not.toMatch(/--argjson\s+additions/);
  });

  test('SHY-0065: exactly one `jq -n` invocation in the entire release.yml run blocks', () => {
    // Other jq calls in release.yml (response parsing) use `jq -r`, `jq .`, or
    // `jq -c` — NOT `jq -n` (null input). So a count of `jq -n` should be
    // exactly 1: the single consolidated PAYLOAD construction.
    const jqNullInputMatches = content.match(/jq -n\b/g) || [];
    expect(jqNullInputMatches.length).toBe(1);
  });

  test('SHY-0065: the single jq -n call uses --rawfile + @base64 for safe file encoding', () => {
    // --rawfile reads file bytes verbatim (preserves trailing newlines, CRLF,
    // multi-byte chars); @base64 in jq produces RFC-4648-compliant output that
    // GraphQL accepts without padding/newline issues. The distance gap matches
    // the SHY-0064 sync-test gap ({0,900}) widened to accommodate the inline-
    // additions block with 3 files instead of 1.
    expect(content).toMatch(/jq -n[\s\S]{0,900}--rawfile[\s\S]{0,900}@base64/);
  });

  test('SHY-0065: --rawfile is used 3 times (one per file in the additions array)', () => {
    // Build gradle + Play Store internal-track notes + Play Store default
    // notes. If a future engineer adds a 4th file, this assertion catches the
    // additions-array growth — they'll need to update the count + verify the
    // payload stays under any practical ARG_MAX even after the refactor.
    const rawfileMatches = content.match(/--rawfile\s+c[0-9]+/g) || [];
    expect(rawfileMatches.length).toBe(3);
  });

  test('SHY-0065: all 3 release file paths still appear in additions array', () => {
    // The single-jq refactor must preserve the byte-shape of the commit:
    // exactly 3 files at the documented paths, in any order. Positive matches
    // — these are the contract with main.
    expect(content).toMatch(/app\/build\.gradle\.kts/);
    expect(content).toMatch(/app\/src\/main\/play\/release-notes\/en-US\/internal\.txt/);
    expect(content).toMatch(/app\/src\/main\/play\/release-notes\/en-US\/default\.txt/);
  });

  test('SHY-0065: each file path appears inside an inline additions object using ($cN|@base64)', () => {
    // Stronger than the previous test: confirms the file paths are in the
    // SHY-0064-shape inline construction `{path: "...", contents: ($cN|@base64)}`
    // — not in a separate ADDITIONS variable that gets pulled in later. The
    // [\s\S]{0,300} window covers a typical inline object span.
    expect(content).toMatch(
      /path:\s*"app\/build\.gradle\.kts"[\s\S]{0,300}contents:\s*\(\$c[0-9]+\|@base64\)/,
    );
    expect(content).toMatch(
      /path:\s*"app\/src\/main\/play\/release-notes\/en-US\/internal\.txt"[\s\S]{0,300}contents:\s*\(\$c[0-9]+\|@base64\)/,
    );
    expect(content).toMatch(
      /path:\s*"app\/src\/main\/play\/release-notes\/en-US\/default\.txt"[\s\S]{0,300}contents:\s*\(\$c[0-9]+\|@base64\)/,
    );
  });

  test('SHY-0065: PAYLOAD bash variable still piped to `gh api graphql --input -` via stdin', () => {
    // The whole point of SHY-0064: only argv has a kernel ARG_MAX limit; stdin
    // does not. So even if a future release pushes a huge payload (many locales
    // worth of release notes), it goes through stdin and survives.
    expect(content).toMatch(/echo\s+"\$PAYLOAD"\s*\|\s*gh\s+api\s+graphql\s+--input\s+-/);
  });

  test('SHY-0065: post-mutation response parsed via `jq -r .data.createCommitOnBranch.commit.oid`', () => {
    // The existing response parser is unchanged — verify it stayed intact.
    expect(content).toMatch(/jq -r '\.data\.createCommitOnBranch\.commit\.oid/);
  });

  test('SHY-0065: expectedHeadOid optimistic concurrency preserved', () => {
    // SHY-0034's expectedHeadOid guard is the safety net against any commit
    // landing on main between rev-parse and the mutation. The single-jq
    // refactor must preserve this — verify the GraphQL mutation query string
    // still references `expectedHeadOid: $oid`.
    expect(content).toMatch(/expectedHeadOid:\s*\$oid/);
  });

  test('SHY-0065: release commit message still uses chore: release v${VERSION} form', () => {
    expect(content).toMatch(/chore:\s+release\s+v\$\{VERSION\}/);
  });

  test('SHY-0065: GRAPH mutation query string accepts $additions: [FileAddition!]!', () => {
    // The mutation signature must still declare $additions as a non-null
    // FileAddition list — otherwise the inline-additions construction breaks.
    expect(content).toMatch(/\$additions:\s*\[FileAddition!\]!/);
  });

  test('SHY-0065: step runs under set -euo pipefail (fail-fast on jq error)', () => {
    // If --rawfile points at a missing file or jq emits invalid JSON, set -e
    // propagates the failure immediately. Verify the step head still asserts
    // this safety net.
    expect(content).toMatch(/set -euo pipefail/);
  });

  test('SHY-0065: no plain `git commit` + `git push` fallback path in the commit-back step', () => {
    // git commit/push produces UNSIGNED commits in CI (no GPG/SSH key) which
    // get rejected by ruleset 12613584's required_signatures rule. The
    // createCommitOnBranch mutation is the ONLY signed-commit path. A future
    // engineer might try to "simplify" the step with a git fallback — block it.
    // Scope the negative to within the commit-back step run block to avoid
    // catching git commit/push references in other steps (e.g. checkout).
    // Window is the full step body — measured ~6200 bytes today (lines 318-
    // 423); 8000 gives comfortable headroom for future audit-trail / comment
    // additions but stays small enough that two separate steps couldn't both
    // be swept inside. No lazy `?` needed: only one `GITHUB_STEP_SUMMARY` in
    // the file, so greedy/lazy are equivalent — keep the regex simple.
    const commitStepRegex =
      /Create signed commit on main via GraphQL[\s\S]{0,8000}GITHUB_STEP_SUMMARY/;
    const commitStepMatch = content.match(commitStepRegex);
    expect(commitStepMatch).not.toBeNull();
    if (commitStepMatch) {
      const block = commitStepMatch[0];
      expect(block).not.toMatch(/git\s+commit\s+-/);
      expect(block).not.toMatch(/git\s+push\s+origin/);
    }
  });
});

describe('.github/workflows/release.yml ↔ sync-roadmap-data.yml jq-pattern parity (SHY-0065)', () => {
  // Cross-workflow parity: both must use the same single-jq inline-additions
  // idiom going forward. SHY-0064 fixed sync; SHY-0065 mirrors onto release.
  // A future engineer regressing one but not the other would create the same
  // dual-pattern cognitive debt SHY-0065 was filed to eliminate.
  let releaseContent;
  let syncContent;

  beforeAll(() => {
    releaseContent = fs.readFileSync(RELEASE_WORKFLOW, 'utf8');
    syncContent = fs.readFileSync(SYNC_WORKFLOW, 'utf8');
  });

  test('both workflows have exactly one `jq -n` invocation', () => {
    // If either workflow goes back to two-jq, both must re-converge. This
    // assertion is the same shape as the in-file SHY-0065 + SHY-0064 single-jq
    // assertions — but having it cross-file makes the parity explicit.
    const releaseJqN = (releaseContent.match(/jq -n\b/g) || []).length;
    const syncJqN = (syncContent.match(/jq -n\b/g) || []).length;
    expect(releaseJqN).toBe(1);
    expect(syncJqN).toBe(1);
  });

  test('neither workflow uses --argjson additions', () => {
    expect(releaseContent).not.toMatch(/--argjson\s+additions/);
    expect(syncContent).not.toMatch(/--argjson\s+additions/);
  });

  test('neither workflow uses ADDITIONS=$(jq', () => {
    expect(releaseContent).not.toMatch(/ADDITIONS=\$\(jq/);
    expect(syncContent).not.toMatch(/ADDITIONS=\$\(jq/);
  });

  test('both workflows pipe $PAYLOAD into gh api graphql via stdin', () => {
    expect(releaseContent).toMatch(/echo\s+"\$PAYLOAD"\s*\|\s*gh\s+api\s+graphql\s+--input\s+-/);
    expect(syncContent).toMatch(/echo\s+"\$PAYLOAD"\s*\|\s*gh\s+api\s+graphql\s+--input\s+-/);
  });

  test('both workflows declare $additions: [FileAddition!]! in the mutation signature', () => {
    expect(releaseContent).toMatch(/\$additions:\s*\[FileAddition!\]!/);
    expect(syncContent).toMatch(/\$additions:\s*\[FileAddition!\]!/);
  });
});
