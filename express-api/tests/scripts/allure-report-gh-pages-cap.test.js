/**
 * allure-report-gh-pages-cap.test.js — SHY-0128 (gh-pages bloat root-cause fix).
 *
 * The 2026-07-15 audit measured gh-pages at 7.2 GiB tree / 12.75 GiB reachable
 * pack: 95.8% of the tree is `playwright/pr/latest` (6.9 GiB, 1.05M files) and
 * the branch carries 1,771 deploy commits (verified live via the commits
 * API Link header AND local `git rev-list --count`, 2026-07-15). TWO root
 * causes, TWO fixes:
 *
 * 1. `keep_files: true` on every peaceiris deploy — peaceiris copies the fresh
 *    report INTO destination_dir without cleaning it, and Allure/Gradle reports
 *    use content-hashed/per-class filenames, so every deploy strands the
 *    previous run's files forever. Fix: `keep_files: false` on ALL THREE
 *    deploys (allure-report.yml, test-backend.yml, pr-checks.yml). Per the
 *    pinned v4.1.0 source (git-utils.ts L127-138) this cleans ONLY
 *    destination_dir — sibling suites, the root landing page and CNAME are
 *    untouched. `force_orphan` was evaluated and DISQUALIFIED (src L97-104: it
 *    skips the clone entirely, so each deploy would wipe every sibling suite).
 *
 * 2. Unbounded deploy-commit history — each deploy adds a commit; the reports
 *    are point-in-time snapshots so the history has no value, but everyone who
 *    fetches gh-pages pays for it. Fix: a cap step in allure-report.yml that,
 *    past MAX_GH_PAGES_COMMITS, rebuilds the branch as ONE orphan commit whose
 *    tree IS the current tip tree (content-identical by construction) via the
 *    Git Data API — no multi-GiB fetch — then force-moves the ref. It runs
 *    inside the workflow-level `gh-pages-deploy` concurrency group and
 *    re-checks the tip immediately before the ref update (the kotlin deploy in
 *    pr-checks.yml is OUTSIDE the group and could land mid-cap; on a moved tip
 *    the cap skips and retries on a later run).
 *
 * These are STRUCTURAL pins on declarative CI config (the cap's behaviour needs
 * a live gh-pages branch + GITHUB_TOKEN); the first post-merge deploy is the
 * behavioral proof, recorded in the story Notes. Mirrors the house style of
 * allure-report-restore-perf.test.js / release-workflow-pin.test.js.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ALLURE_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/allure-report.yml');
const BACKEND_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/test-backend.yml');
const PR_CHECKS_WORKFLOW = path.join(REPO_ROOT, '.github/workflows/pr-checks.yml');

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

describe('gh-pages bloat fixes — SHY-0128', () => {
  let allureYaml;
  let backendYaml;
  let prChecksYaml;
  beforeAll(() => {
    allureYaml = fs.readFileSync(ALLURE_WORKFLOW, 'utf8');
    backendYaml = fs.readFileSync(BACKEND_WORKFLOW, 'utf8');
    prChecksYaml = fs.readFileSync(PR_CHECKS_WORKFLOW, 'utf8');
  });

  describe('fix 1 — keep_files: false on every gh-pages deploy', () => {
    test('allure-report.yml deploy cleans its destination_dir (keep_files: false)', () => {
      const block = stepBlock(allureYaml, 'Deploy report to GitHub Pages');
      expect(block).toMatch(/peaceiris\/actions-gh-pages@/);
      expect(block).toMatch(/keep_files:\s*false/);
      expect(block).not.toMatch(/keep_files:\s*true/);
    });

    test('test-backend.yml express deploy cleans its destination_dir (keep_files: false)', () => {
      const block = stepBlock(backendYaml, 'Deploy Express report to GitHub Pages');
      expect(block).toMatch(/peaceiris\/actions-gh-pages@/);
      expect(block).toMatch(/keep_files:\s*false/);
      expect(block).not.toMatch(/keep_files:\s*true/);
      // layout unchanged — cleaning must stay scoped to this suite/env
      expect(block).toContain("express/${{ inputs.report_env || 'pr' }}/latest");
    });

    test('pr-checks.yml kotlin deploy cleans its destination_dir (keep_files: false)', () => {
      const block = stepBlock(prChecksYaml, 'Deploy Kotlin report to GitHub Pages');
      expect(block).toMatch(/peaceiris\/actions-gh-pages@/);
      expect(block).toMatch(/keep_files:\s*false/);
      expect(block).not.toMatch(/keep_files:\s*true/);
      expect(block).toContain('kotlin/pr/latest');
    });

    test('no keep_files: true survives anywhere in the three deploying workflows', () => {
      // Sweep guard: a fourth deploy added later (or one flip missed in a
      // refactor) must not silently reintroduce the accumulation bug.
      // Line-anchored key match (house style — see the `filter:` pin in
      // allure-report-restore-perf.test.js): comments MAY discuss the option.
      for (const yaml of [allureYaml, backendYaml, prChecksYaml]) {
        expect(yaml).not.toMatch(/^[ \t]*keep_files:[ \t]*true/m);
      }
    });

    test('no deploy uses force_orphan (it skips the clone and would wipe sibling suites)', () => {
      // Same line-anchored key form: the allure-report.yml comment documenting
      // WHY force_orphan is rejected must stay legal; only the live key trips.
      for (const yaml of [allureYaml, backendYaml, prChecksYaml]) {
        expect(yaml).not.toMatch(/^[ \t]*force_orphan:/m);
      }
    });
  });

  describe('fix 2 — bounded history cap step (allure-report.yml)', () => {
    const STEP_NAME = 'Cap gh-pages history (bounded, content-identical)';
    let block;
    beforeAll(() => {
      block = stepBlock(allureYaml, STEP_NAME);
    });

    test('the cap step exists and runs after the deploy step', () => {
      expect(block).not.toBe('');
      const deployIdx = allureYaml.indexOf('- name: Deploy report to GitHub Pages');
      const capIdx = allureYaml.indexOf(`- name: ${STEP_NAME}`);
      expect(deployIdx).toBeGreaterThan(-1);
      expect(capIdx).toBeGreaterThan(deployIdx);
    });

    test('cap is gated like the deploy: skip-guard + dependabot read-only token guard', () => {
      expect(block).toContain("steps.check-existing.outputs.skip != 'true'");
      expect(block).toContain("!startsWith(github.head_ref, 'dependabot/')");
    });

    test('cap authenticates gh with the workflow GITHUB_TOKEN', () => {
      expect(block).toContain('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
    });

    test('threshold is 25 commits, named MAX_GH_PAGES_COMMITS', () => {
      expect(block).toMatch(/MAX_GH_PAGES_COMMITS:\s*25\b/);
      // the comparison must reference the env var, not a second hardcoded copy
      expect(block).toMatch(/\$MAX_GH_PAGES_COMMITS|\$\{MAX_GH_PAGES_COMMITS\}/);
    });

    test('commit count comes from the Link header (O(1) — no multi-GiB fetch of gh-pages)', () => {
      expect(block).toContain('per_page=1');
      expect(block).toContain('rel="last"');
      // belt: the step must NOT clone/fetch gh-pages to count commits
      expect(block).not.toMatch(/git\s+(clone|fetch)/);
    });

    test('rebuild is an orphan commit of the CURRENT TIP TREE (content-identical by construction)', () => {
      // createCommit with the tip's tree...
      expect(block).toMatch(/-f tree=/);
      // ...and NO parents field — omitting it is what makes the commit an
      // orphan; a `parents` arg would chain history instead of truncating it.
      expect(block).not.toMatch(/parents/);
    });

    test('ref update is an explicit force move of refs/heads/gh-pages', () => {
      expect(block).toContain('-X PATCH');
      expect(block).toContain('refs/heads/gh-pages');
      expect(block).toContain('force=true');
    });

    test('cap re-checks the tip immediately before the force move (racing writer ⇒ skip, not clobber)', () => {
      expect(block).toContain('"$CURRENT" != "$TIP"');
      // the skip path must exit 0 (self-healing on a later run), not fail the job
      expect(block).toMatch(/skipping cap[\s\S]*exit 0/);
    });

    test('missing gh-pages branch (first ever run) is tolerated; other API errors stay loud', () => {
      expect(block).toContain('HTTP 404');
      expect(block).toContain('nothing to cap');
    });
  });

  describe('serialization the cap depends on', () => {
    test('allure-report.yml holds the workflow-level gh-pages-deploy group, non-cancelling', () => {
      // The cap's race-safety argument rests on this group serializing every
      // allure deploy; reusable-workflow-concurrency.test.js deliberately
      // EXCLUDES allure-report.yml from the cancel-in-progress family, so this
      // is the one home asserting the group actually exists.
      expect(allureYaml).toMatch(
        /^concurrency:\n {2}group: gh-pages-deploy\n {2}cancel-in-progress: false$/m,
      );
    });
  });
});
