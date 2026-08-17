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
      // Belt: counting must not pull the branch down. SHY-0298 R3 added a
      // clone for the ref move, so "no clone at all" is no longer the right
      // assertion — what matters is that it stays cheap. A clone without
      // BOTH --depth=1 and --filter=blob:none would drag the multi-GiB
      // history back, which is the cost this whole step exists to control.
      const clones = block.match(/git clone[^\n]*(\n\s*[^\n]*)?/g) || [];
      clones.forEach((c) => {
        expect(c).toContain('--depth=1');
        expect(c).toContain('--filter=blob:none');
        expect(c).toContain('--no-checkout');
      });
      // And the count itself must still come from the API, not a local walk.
      expect(block).not.toMatch(/git rev-list|git log --oneline/);
    });

    test('rebuild is an orphan commit of the CURRENT TIP TREE (content-identical by construction)', () => {
      // SHY-0298 R4: built by LOCAL `git commit-tree`, in the clone, from the
      // clone's own HEAD tree. It used to be `gh api -X POST … -f tree=`, but
      // an API-created commit is referenced by no ref and so is absent from
      // the `--depth=1` clone that has to push it — `fatal: bad object`, then
      // `! [remote rejected] … (unpacker error)`, on every capped run.
      expect(block).toMatch(/git -C "\$WORK" commit-tree "HEAD\^\{tree\}"/);
      // The Git Data API must be gone entirely: a commit or ref created there
      // reintroduces exactly that failure.
      expect(block).not.toMatch(/git\/commits|git\/refs\//);
      // NO parent — omitting it is what makes the commit an orphan; `-p` would
      // chain history instead of truncating it.
      expect(block).not.toMatch(/parents|commit-tree[^\n]*\s-p\s/);
      // An empty $NEW would make the refspec `:refs/heads/gh-pages` — git's
      // spelling of DELETE THE BRANCH — so it is refused before the push.
      expect(block).toContain('refusing to push an empty refspec');
    });

    test('the ref move is an atomic compare-and-swap, never an unconditional force', () => {
      // SHY-0298 R3. The API's ref PATCH with force=true is unconditional, so
      // the re-read that used to precede it was a check and not a CAS: a
      // publisher landing in that window was overwritten while its own job
      // exited 0 — nothing red, a report simply gone.
      expect(block).toContain('--force-with-lease="refs/heads/gh-pages:${TIP}"');
      expect(block).toContain('refs/heads/gh-pages');
      // The unconditional forms must be gone, in both spellings.
      expect(block).not.toContain('force=true');
      expect(block).not.toMatch(/git .*push[^\n]*--force(?!-with-lease)/);
    });

    test('a lost race SKIPS quietly; any other push failure is loud', () => {
      // A skip must exit 0 (a later run caps again), but only for a genuine
      // lost race. Reporting an auth or quota failure as "tip moved" would
      // hide a permanently broken cap behind a reassuring message.
      expect(block).toMatch(/stale info/);
      expect(block).toMatch(/skipping cap this run/);
      expect(block).toContain('::error::');
      const skipIdx = block.indexOf('skipping cap this run');
      const errIdx = block.indexOf('::error::gh-pages history cap failed for a reason');
      expect(skipIdx).toBeGreaterThan(-1);
      expect(errIdx).toBeGreaterThan(skipIdx);
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
    // The cap's race-safety therefore rests entirely on its own mechanism —
    // and the re-read it used to rely on was NOT one. A read followed by an
    // unconditional force move has a window one API round-trip wide, and C3
    // made that window routinely reachable by design. An earlier version of
    // this comment claimed "the invariant followed the protection"; it had
    // not. R3 replaced the re-read with `git push --force-with-lease`, which
    // is a genuine compare-and-swap enforced by the server, so there is no
    // window for a publisher to be lost in.
    const capBlock = () =>
      stepBlock(allureYaml, 'Cap gh-pages history (bounded, content-identical)');

    test('no workflow-level gh-pages-deploy group remains (it was never a safe serializer)', () => {
      expect(allureYaml).not.toMatch(/^ {2}group: gh-pages-deploy$/m);
    });

    test('the lease names the tip the count was taken from', () => {
      const block = capBlock();
      // The lease is only meaningful if it names $TIP — the tip the commit
      // count and the tree read were both taken from. A lease against
      // anything else, or one refreshed just before the push, would authorise
      // overwriting work that landed in between, which is the whole defect.
      expect(block).toMatch(/--force-with-lease="refs\/heads\/gh-pages:\$\{TIP\}"/);
      expect(block).toMatch(/skipping cap this run/);
      // $TIP must be captured BEFORE the lease uses it, not refreshed later.
      const tipIdx = block.indexOf('TIP=$(gh api');
      const leaseIdx = block.indexOf('--force-with-lease=');
      expect(tipIdx).toBeGreaterThan(-1);
      expect(leaseIdx).toBeGreaterThan(tipIdx);
      // And the unconditional API force move must be gone.
      expect(block).not.toContain('force=true');
    });
  });
});
