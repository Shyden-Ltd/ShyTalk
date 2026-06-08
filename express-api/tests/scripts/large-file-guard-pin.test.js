/**
 * Pin tests for the SHY-0035 large-file guard wiring in
 * `.github/workflows/lint.yml` (and its `workflow_call` caller
 * `.github/workflows/pr-checks.yml`).
 *
 * Why a separate pin test: workflows evolve via copy-paste and step-
 * renames; pin tests are the only mechanism that catches "someone
 * renamed the step so the lint silently stopped firing." This mirrors
 * the pattern already used by `release-workflow-pin.test.js` and
 * `reusable-workflow-concurrency.test.js`.
 *
 * Pinned invariants:
 *   - lint.yml declares a `pr_body` input on workflow_call
 *   - lint.yml fetches origin/main as its own discrete step
 *   - lint.yml runs `scripts/check-large-files.sh --against origin/main`
 *     with `ALLOW_LARGE_FILE_BODY=${{ inputs.pr_body }}`
 *   - lint.yml's large-file step appears BEFORE the story-frontmatter
 *     validator (which is pinned last)
 *   - pr-checks.yml threads `pr_body: ${{ github.event.pull_request.body }}`
 *     into the lint.yml workflow_call
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const LINT_YML = path.join(REPO_ROOT, '.github', 'workflows', 'lint.yml');
const PR_CHECKS_YML = path.join(REPO_ROOT, '.github', 'workflows', 'pr-checks.yml');

// Read-once at module scope — these YAML files don't change during a
// test run, and re-reading per test would slow the suite without
// catching any new failure modes.
const LINT_CONTENT = fs.readFileSync(LINT_YML, 'utf-8');
const PR_CHECKS_CONTENT = fs.readFileSync(PR_CHECKS_YML, 'utf-8');

describe('lint.yml — SHY-0035 large-file guard wiring', () => {
  describe('workflow_call input contract', () => {
    it('declares a `pr_body` input', () => {
      // Tolerate any whitespace pattern; key on the input name + type.
      expect(LINT_CONTENT).toMatch(/pr_body:[\s\S]{0,200}?type:\s*string/);
    });

    it('`pr_body` input is optional with default empty string', () => {
      // Default '' so the input is safe under workflow_dispatch (no PR
      // context) — the script receives an empty body → 0 exemptions.
      expect(LINT_CONTENT).toMatch(
        /pr_body:[\s\S]{0,300}?required:\s*false[\s\S]{0,200}?default:\s*''/,
      );
    });
  });

  describe('fetch step', () => {
    it('has a dedicated "Fetch origin/main for diff base" step', () => {
      expect(LINT_CONTENT).toMatch(/name:\s*Fetch origin\/main for diff base/);
    });

    it('uses the minimal --no-tags --depth=1 fetch (cheap on a 12.74 GiB pack)', () => {
      // Match the exact form including the explicit refspec — the
      // refspec ensures origin/main is resolvable by `git rev-parse`
      // immediately after the fetch.
      expect(LINT_CONTENT).toMatch(
        /git fetch --no-tags --depth=1 origin main:refs\/remotes\/origin\/main/,
      );
    });
  });

  describe('large-file guard step', () => {
    it('has a step named "Large-file guard (>5MB threshold)"', () => {
      expect(LINT_CONTENT).toMatch(/name:\s*Large-file guard \(>5MB threshold\)/);
    });

    it('runs `bash scripts/check-large-files.sh --against origin/main`', () => {
      expect(LINT_CONTENT).toMatch(/bash scripts\/check-large-files\.sh --against origin\/main/);
    });

    it('passes ALLOW_LARGE_FILE_BODY from `inputs.pr_body` (not from `github.event.pull_request.body`)', () => {
      // The architect's Issue 2 fix: source via the explicit input,
      // not via `github.event` propagation. The latter would still
      // work in `pull_request` triggers but the input is robust to
      // future caller refactors (e.g. workflow_dispatch).
      expect(LINT_CONTENT).toMatch(/ALLOW_LARGE_FILE_BODY:\s*\$\{\{\s*inputs\.pr_body\s*\}\}/);
      // Regression: the actual env-value interpolation must NOT use
      // github.event.pull_request.body. We check the specific YAML
      // mapping (allowing only the inputs.pr_body form) rather than
      // grep-the-whole-step, because explanatory comments adjacent to
      // the env block legitimately mention github.event.pull_request.body
      // when explaining WHY we use inputs.pr_body instead.
      expect(LINT_CONTENT).not.toMatch(
        /ALLOW_LARGE_FILE_BODY:\s*\$\{\{\s*github\.event\.pull_request\.body\s*\}\}/,
      );
    });
  });

  describe('step ordering', () => {
    it('large-file step appears BEFORE the story-frontmatter validator (pinned-last)', () => {
      const largeFileIdx = LINT_CONTENT.indexOf('Large-file guard');
      const storyValidatorIdx = LINT_CONTENT.indexOf('Validate SHY story frontmatter');
      expect(largeFileIdx).toBeGreaterThan(-1);
      expect(storyValidatorIdx).toBeGreaterThan(-1);
      expect(largeFileIdx).toBeLessThan(storyValidatorIdx);
    });

    it('fetch step appears BEFORE the large-file guard step', () => {
      const fetchIdx = LINT_CONTENT.indexOf('Fetch origin/main for diff base');
      const largeFileIdx = LINT_CONTENT.indexOf('Large-file guard');
      expect(fetchIdx).toBeGreaterThan(-1);
      expect(largeFileIdx).toBeGreaterThan(-1);
      expect(fetchIdx).toBeLessThan(largeFileIdx);
    });
  });
});

describe('pr-checks.yml — threads pr_body into lint.yml workflow_call', () => {
  it('threads `pr_body: ${{ github.event.pull_request.body }}` into the lint.yml call', () => {
    expect(PR_CHECKS_CONTENT).toMatch(
      /pr_body:\s*\$\{\{\s*github\.event\.pull_request\.body\s*\}\}/,
    );
  });

  it('the threading sits inside the `uses: ./.github/workflows/lint.yml` block', () => {
    // Find the lint.yml invocation block — anchored by the known
    // `secrets: inherit` terminator that every workflow_call in this
    // repo carries — and assert pr_body lives inside it (not in some
    // other unrelated workflow_call elsewhere in the file).
    const lintCallMatch = PR_CHECKS_CONTENT.match(
      /uses:\s*\.\/\.github\/workflows\/lint\.yml[\s\S]+?secrets:\s*inherit/,
    );
    expect(lintCallMatch).not.toBeNull();
    expect(lintCallMatch[0]).toMatch(
      /pr_body:\s*\$\{\{\s*github\.event\.pull_request\.body\s*\}\}/,
    );
  });
});
