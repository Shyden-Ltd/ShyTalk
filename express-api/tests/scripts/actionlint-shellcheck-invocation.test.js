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

/** The YAML lines of a named step (house helper — see the SHY-0128 pins). */
function stepBlock(yaml, stepName) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l.includes(`- name: ${stepName}`));
  if (start === -1) return '';
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}- name: /.test(lines[i]) || /^ {0,4}\S/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

describe('actionlint embedded-shellcheck invocation — SHY-0191', () => {
  let lintYaml;
  let prePush;
  beforeAll(() => {
    lintYaml = fs.readFileSync(LINT_WORKFLOW, 'utf8');
    prePush = fs.readFileSync(PRE_PUSH_HOOK, 'utf8');
  });

  test('lint.yml runs actionlint with SHELLCHECK_OPTS (shellcheck ACTIVE, SC2086 excluded)', () => {
    // Step-scoped, not whole-file: the fixed form must sit INSIDE the
    // actionlint step's own block, so a stray mention elsewhere (a comment,
    // another step) can never satisfy this pin vacuously.
    const block = stepBlock(lintYaml, 'Run actionlint (workflow + embedded shellcheck)');
    expect(block).not.toBe('');
    expect(block).toContain(FIXED_FORM);
  });

  test('.husky/pre-push runs actionlint with SHELLCHECK_OPTS as the live guard condition', () => {
    // Line-anchored to the actual `if !` invocation — a comment mentioning
    // the form cannot satisfy it.
    expect(prePush).toMatch(/^[ \t]*if ! SHELLCHECK_OPTS='-e SC2086' actionlint; then$/m);
    // the graceful skip when actionlint is not installed must survive the fix
    expect(prePush).toMatch(/command -v actionlint/);
  });

  test('the broken -shellcheck= flag form is banned from both invocation sites', () => {
    // Any `-shellcheck=` value that is not a real executable silently turns
    // the integration OFF — the repo must never pass this flag at all.
    expect(lintYaml).not.toMatch(/-shellcheck=/);
    expect(prePush).not.toMatch(/-shellcheck=/);
  });

  test('no shellcheck suppression comments in any actionlint-scanned surface', () => {
    // Zero-suppression policy: findings get FIXED, never disabled inline.
    // Scan surface = exactly what actionlint lints: workflows, composite
    // actions under .github/actions/**, plus the pre-push hook.
    const files = fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => path.join(WORKFLOWS_DIR, f));
    const actionsDir = path.join(REPO_ROOT, '.github/actions');
    for (const entry of fs.readdirSync(actionsDir)) {
      for (const candidate of ['action.yml', 'action.yaml']) {
        const p = path.join(actionsDir, entry, candidate);
        if (fs.existsSync(p)) files.push(p);
      }
    }
    expect(files.length).toBeGreaterThan(10); // workflows + ≥10 composite actions
    for (const f of [...files, PRE_PUSH_HOOK]) {
      const text = fs.readFileSync(f, 'utf8');
      expect(text).not.toMatch(/shellcheck disable/);
    }
  });
});
