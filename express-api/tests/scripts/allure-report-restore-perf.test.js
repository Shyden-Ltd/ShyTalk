/**
 * allure-report-restore-perf.test.js — SHY-0127 (Gate-4-exposed gh-pages slowness).
 *
 * Gate-4 first ran android-e2e AND playwright-web on one PR. The playwright
 * suite blew the allure-report job's `timeout-minutes: 10`: "Restore history
 * from gh-pages" did a FULL `actions/checkout` of the entire gh-pages tree
 * (~4min — it writes every suite's whole HTML report to disk) when it only needs
 * the small `<suite>/<env>/history` subfolder, leaving too little budget for the
 * deploy push (which got guillotined mid-push at the 10-min cap).
 *
 * Fix (operator-chosen shape — sparse-checkout + headroom):
 *   - sparse-checkout the restore to ONLY `<suite>/<env>/history` → trims the
 *     working-tree WRITE (the many-small-files disk cost). NB per actions/checkout
 *     docs this does NOT reduce the network fetch (only `filter:` would, and it
 *     "Overrides sparse-checkout"); the fetch + deploy stay bound by the gh-pages
 *     branch size, whose real fix is the follow-up bloat-reduction SHY-0128.
 *   - raise `timeout-minutes` to 20 → the load-bearing GUARANTEE the round-trip
 *     completes regardless.
 *
 * These are STRUCTURAL pins on declarative CI config (you can't run an
 * actions/checkout sparse fetch locally) — the live CI run on the PR is the
 * behavioral proof. Mirrors emulator-in-ci-pin.test.js / release-workflow-pin.js.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/allure-report.yml');

/** The YAML lines of a named step, from its `- name:` to the next step (6-space
 * `- name:`) or a less-indented (job/key) boundary. */
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

describe('allure-report.yml gh-pages restore perf — SHY-0127', () => {
  let yaml;
  beforeAll(() => {
    yaml = fs.readFileSync(WORKFLOW, 'utf8');
  });

  test('generate-report job timeout raised to 20 min (headroom for the gh-pages round-trip)', () => {
    expect(yaml).toMatch(/timeout-minutes:\s*20\b/);
    // the 10-min cap that the playwright suite blew must be gone
    expect(yaml).not.toMatch(/timeout-minutes:\s*10\b/);
  });

  test('"Restore history from gh-pages" sparse-checks-out ONLY the <suite>/<env>/history subtree', () => {
    const block = stepBlock(yaml, 'Restore history from gh-pages');
    expect(block).toMatch(/uses: actions\/checkout@/);
    expect(block).toMatch(/ref: gh-pages/);
    expect(block).toMatch(/sparse-checkout:/);
    // exact cone path — the suite+env history folder, nothing else
    expect(block).toMatch(
      /sparse-checkout:\s*\|[\s\S]*\$\{\{\s*inputs\.suite_name\s*\}\}\/\$\{\{\s*inputs\.report_env\s*\}\}\/history/,
    );
    // first-run tolerance preserved (gh-pages may not exist yet for a new suite)
    expect(block).toMatch(/continue-on-error:\s*true/);
    // cone mode must stay ON (default true): with it off, the directory path
    // degrades to a filename glob and silently stops matching the history dir.
    expect(block).not.toMatch(/sparse-checkout-cone-mode:\s*false/);
  });

  test('restore step does NOT set `filter:` (it would override sparse-checkout per actions/checkout docs)', () => {
    const block = stepBlock(yaml, 'Restore history from gh-pages');
    // `[ \t]*` (not `\s*`): match `filter:` only as a line-leading YAML key, and
    // keep the whitespace horizontal so it can't span newlines (no ReDoS). The
    // `# … filter: …` explanatory comment in the step is correctly NOT matched.
    expect(block).not.toMatch(/^[ \t]*filter:/m);
  });

  test('the deploy step is unchanged (still publishes via peaceiris with keep_files)', () => {
    // Regression guard: the perf change touches only the restore + timeout, not
    // the multi-suite/multi-env deploy layout.
    const block = stepBlock(yaml, 'Deploy report to GitHub Pages');
    expect(block).toMatch(/peaceiris\/actions-gh-pages@/);
    expect(block).toMatch(/keep_files:\s*true/);
    // full per-suite/env/latest layout (not just suite_name) — a truncation
    // would make pr/deploy envs overwrite each other. Exact-substring pin
    // (no regex) — avoids ReDoS heuristics and matches the real YAML verbatim.
    expect(block).toContain('${{ inputs.suite_name }}/${{ inputs.report_env }}/latest');
  });
});
