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
 *    Git Data API — no multi-GiB fetch — then force-moves the ref. Its
 *    race-safety rests on re-reading the tip immediately before the ref update
 *    and SKIPPING when another writer landed.
 *
 *    SHY-0298 UPDATE: that re-check is now the ONLY protection, and therefore
 *    load-bearing rather than defensive. The workflow-level `gh-pages-deploy`
 *    concurrency group this file used to assert has been REMOVED: a group holds
 *    exactly one pending entry, so a third contender cancels the pending second
 *    (incidents #568/#570). Publishing retries against the moving tip instead.
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

/** True when a YAML line invokes peaceiris, in EITHER legal step form
 * (`- uses: peaceiris/...` or a bare `uses:` under a `- name:`). String ops
 * rather than one regex: two star-quantifiers around an optional `-` trip
 * sonarjs/slow-regex. */
function usesPeaceiris(line) {
  const afterDash = line.trim().replace(/^- +/, '');
  if (!afterDash.startsWith('uses:')) return false;
  return afterDash.slice('uses:'.length).trim().startsWith('peaceiris/actions-gh-pages');
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
    // SHY-0298 moved the single peaceiris invocation (and with it the
    // `keep_files: false` flag) into `.github/actions/publish-gh-pages`, so
    // there is now ONE place to assert the flag instead of three — pinned,
    // parsed rather than text-matched, in gh-pages-publisher.test.js.
    //
    // What stays this file's job is the half that is still PER-CALLER and is
    // the reason keep_files:false is safe at all: each deploy must target its
    // OWN scoped destination. `keep_files: false` cleans destination_dir before
    // copying, so a caller that widened its destination would wipe sibling
    // suites. These pins follow that invariant to its new home rather than
    // being deleted with the step they used to live on.
    const KEEP_FILES_OWNER = 'express-api/tests/scripts/gh-pages-publisher.test.js';

    test('the keep_files invariant has an owner (it moved, it did not vanish)', () => {
      const owner = path.join(__dirname, '..', '..', '..', KEEP_FILES_OWNER);
      expect(fs.existsSync(owner)).toBe(true);
      expect(fs.readFileSync(owner, 'utf8')).toMatch(/keep_files/);
    });

    test('allure-report.yml publishes via the one shared action', () => {
      const block = stepBlock(allureYaml, 'Deploy report to GitHub Pages');
      expect(block).toMatch(/uses:\s*\.\/\.github\/actions\/publish-gh-pages/);
      expect(block).not.toMatch(/peaceiris\/actions-gh-pages@/);
      // layout unchanged — cleaning must stay scoped to this suite/env
      expect(block).toContain('${{ inputs.suite_name }}/${{ inputs.report_env }}/latest');
    });

    test('test-backend.yml express publish keeps its per-env destination', () => {
      expect(backendYaml).toMatch(/uses:\s*\.\/\.github\/actions\/publish-gh-pages/);
      expect(backendYaml.split('\n').filter(usesPeaceiris)).toEqual([]);
      expect(backendYaml).toContain("express/${{ inputs.report_env || 'pr' }}/latest");
    });

    test('pr-checks.yml kotlin publish keeps its scoped destination', () => {
      expect(prChecksYaml).toMatch(/uses:\s*\.\/\.github\/actions\/publish-gh-pages/);
      expect(prChecksYaml.split('\n').filter(usesPeaceiris)).toEqual([]);
      expect(prChecksYaml).toContain('kotlin/pr/latest');
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

  describe('race-safety the cap depends on', () => {
    // SHY-0298 REMOVED the `gh-pages-deploy` concurrency group this block used
    // to assert. That group was not a safe serializer: a concurrency group
    // holds exactly ONE pending entry, so a third contender cancels the pending
    // second — this repo's own incidents #568/#570. Publishing now retries
    // against the moving tip instead, and no writer excludes any other.
    //
    // The cap's race-safety therefore rests entirely on its OWN check, which
    // was always present and is now load-bearing rather than defensive. That is
    // what these tests assert: the invariant followed the protection, it was
    // not dropped with the lock.
    const capBlock = () =>
      stepBlock(allureYaml, 'Cap gh-pages history (bounded, content-identical)');

    test('no workflow-level gh-pages-deploy group remains (it was never a safe serializer)', () => {
      expect(allureYaml).not.toMatch(/^ {2}group: gh-pages-deploy$/m);
    });

    test('the cap re-reads the tip and SKIPS when another writer landed', () => {
      const block = capBlock();
      // Re-read immediately before the ref move, compared against the tip the
      // count was taken from, and a skip — not a force — when they differ.
      expect(block).toMatch(/CURRENT=/);
      expect(block).toMatch(/if \[ "\$CURRENT" != "\$TIP" \]/);
      expect(block).toMatch(/skipping cap this run/);
      // The comparison must come BEFORE the ref update, or it guards nothing.
      const cmpIdx = block.indexOf('"$CURRENT" != "$TIP"');
      const patchIdx = block.indexOf('git/refs/heads/gh-pages');
      expect(cmpIdx).toBeGreaterThan(-1);
      expect(patchIdx).toBeGreaterThan(cmpIdx);
    });
  });
});
