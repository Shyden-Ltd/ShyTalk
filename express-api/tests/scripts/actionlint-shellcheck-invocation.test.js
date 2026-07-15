/**
 * actionlint-shellcheck-invocation.test.js — SHY-0191.
 *
 * actionlint's `-shellcheck` flag takes the COMMAND NAME OR PATH of the
 * shellcheck executable ("If empty, shellcheck integration will be
 * disabled"). The repo invoked `actionlint -shellcheck='-e SC2086'`
 * believing it passed flags through — actionlint looked for an executable
 * literally named `-e SC2086`, found none, and silently disabled embedded
 * shellcheck in BOTH gates (CI lint.yml + .husky/pre-push) with exit 0.
 * The documented flag-passing channel is the SHELLCHECK_OPTS environment
 * variable. These pins lock the working form into both invocation sites and
 * ban the broken flag + any suppression comments from sneaking back.
 *
 * Behavioral proof is the live command itself (it runs in pre-push and CI);
 * the A/B evidence (broken form exit 0 vs. fixed form exit 1 on the pre-fix
 * tree with 7 findings) is recorded in the story Notes.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const LINT_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/lint.yml');
const PRE_PUSH_HOOK = path.join(REPO_ROOT, '.husky/pre-push');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github/workflows');

const FIXED_FORM = "SHELLCHECK_OPTS='-e SC2086' actionlint";

describe('actionlint embedded-shellcheck invocation — SHY-0191', () => {
  let lintYaml;
  let prePush;
  beforeAll(() => {
    lintYaml = fs.readFileSync(LINT_WORKFLOW, 'utf8');
    prePush = fs.readFileSync(PRE_PUSH_HOOK, 'utf8');
  });

  test('lint.yml runs actionlint with SHELLCHECK_OPTS (shellcheck ACTIVE, SC2086 excluded)', () => {
    expect(lintYaml).toContain(FIXED_FORM);
  });

  test('.husky/pre-push runs actionlint with SHELLCHECK_OPTS (same gate locally)', () => {
    expect(prePush).toContain(FIXED_FORM);
    // the graceful skip when actionlint is not installed must survive the fix
    expect(prePush).toMatch(/command -v actionlint/);
  });

  test('the broken -shellcheck= flag form is banned from both invocation sites', () => {
    // Any `-shellcheck=` value that is not a real executable silently turns
    // the integration OFF — the repo must never pass this flag at all.
    expect(lintYaml).not.toMatch(/-shellcheck=/);
    expect(prePush).not.toMatch(/-shellcheck=/);
  });

  test('no shellcheck suppression comments anywhere in workflows or the pre-push hook', () => {
    // Zero-suppression policy: findings get FIXED, never disabled inline.
    const files = fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => path.join(WORKFLOWS_DIR, f));
    for (const f of [...files, PRE_PUSH_HOOK]) {
      const text = fs.readFileSync(f, 'utf8');
      expect(text).not.toMatch(/shellcheck disable/);
    }
  });
});
