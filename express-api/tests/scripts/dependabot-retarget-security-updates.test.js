/**
 * Static assertions on .github/workflows/dependabot-retarget-security-updates.yml.
 *
 * Spec: .project/stories/SHY-0520-dependabot-security-updates-open-against-main-and-never-reach-the-develop-gate.md
 *
 * Why this workflow exists: SHY-0242 set `target-branch: "develop"` for all four
 * Dependabot ecosystems, but GitHub raises *security* updates against the default
 * branch regardless of that setting. Those PRs land on `main`, where the
 * never-merge-into-main-directly rule forbids merging them, so they strand — and
 * their alerts stay open even after `develop` carries the fix.
 *
 * Why static rather than dispatch-and-observe: actionlint covers YAML syntax;
 * these assertions cover the contract bits that would silently regress — the
 * pull_request_target safety shape, the App-token identity, and the
 * close/reopen sequence that actually starts the checks.
 *
 * This file does NOT make the story Done. SHY-0520's Definition of Done requires
 * the first real Dependabot security PR after the merge to be retargeted,
 * checked and merged with no human action. A static test cannot prove that a
 * token's events start a workflow run; only a live PR can.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/dependabot-retarget-security-updates.yml');
const STORY_ID = 'SHY-0520';

describe('.github/workflows/dependabot-retarget-security-updates.yml', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(WORKFLOW, 'utf8');
  });

  test('workflow file exists', () => {
    expect(fs.existsSync(WORKFLOW)).toBe(true);
  });

  describe('trigger', () => {
    test('fires on pull_request_target, opened only, scoped to main', () => {
      expect(content).toMatch(/^on:/m);
      // ANCHORED TO A YAML KEY, not to the token anywhere in the file. Line 12
      // is `# Why pull_request_target: ...`, so an unanchored match is
      // satisfied by the prose explaining the setting. Measured 2026-09-10:
      // with the real trigger deleted and that comment left in place, all 22
      // assertions still passed — the guard could not see the workflow stop
      // firing. A comment line begins with `#`, so requiring leading
      // whitespace before the key excludes it. Same shape as the
      // `pull_request` check below, which already had this right.
      expect(content).toMatch(/^[ \t]+pull_request_target:/m);
      expect(content).toMatch(/types:[ \t]*\[[ \t]*opened[ \t]*\]/);
      expect(content).toMatch(/branches:[ \t]*\[[ \t]*main[ \t]*\]/);
    });

    test('does not re-fire on its own reopen (no `reopened` in trigger types)', () => {
      // The job itself closes and reopens the PR. Listening for `reopened`
      // would make the workflow re-trigger on its own action — an infinite loop.
      const triggerTypes = content.match(/types:[ \t]*\[[^\]\n]*\]/g) || [];
      // ANCHOR: the scan must actually find the trigger it is about to vet —
      // an empty match list would make the assertion below pass vacuously
      // ([[feedback-source-scanning-guards-need-their-own-anchors]]).
      expect(triggerTypes).toHaveLength(1);
      expect(triggerTypes[0]).not.toMatch(/reopened/);
    });

    test('is not triggered by pull_request (which would run without a write token)', () => {
      expect(content).not.toMatch(/^[ \t]+pull_request:/m);
    });
  });

  describe('author gate', () => {
    test('job runs only for dependabot[bot]', () => {
      expect(content).toMatch(
        /if:[ \t]+github\.event\.pull_request\.user\.login[ \t]*==[ \t]*['"]dependabot\[bot\]['"]/,
      );
    });

    test('skips a pull request whose base is already the integration branch', () => {
      // Idempotence: a human (or an earlier run) may have retargeted it already.
      expect(content).toMatch(/github\.event\.pull_request\.base\.ref[ \t]*==[ \t]*['"]main['"]/);
    });
  });

  describe('security: pull_request_target grants a write token', () => {
    test('checks out nothing — no actions/checkout step', () => {
      // pull_request_target runs in the BASE branch context with repo write.
      // Checking out the head would execute pull-request-controlled code with
      // that token. This job only edits PR metadata via `gh`, so it needs no
      // working tree at all.
      expect(content).not.toMatch(/actions\/checkout/);
    });

    test('never references the pull request head', () => {
      expect(content).not.toMatch(/github\.event\.pull_request\.head/);
    });

    test('interpolates only non-injectable pull-request fields', () => {
      // Guard the CLASS, not the instance: `.head` is the field the story
      // named, but `.title` and `.body` are attacker-controlled strings that
      // would be just as unsafe inside a `run:` block. Assert an allow-list.
      const SAFE_FIELDS = ['number', 'user.login', 'base.ref'];
      const refs = content.match(/github\.event\.pull_request\.[a-z_.]+[a-z_]/g) || [];
      // ANCHOR: the workflow must actually reference some PR fields; an empty
      // scan would make the subset check below meaningless.
      expect(refs.length).toBeGreaterThan(0);
      const fields = [...new Set(refs.map((r) => r.replace('github.event.pull_request.', '')))];
      expect(fields.filter((f) => !SAFE_FIELDS.includes(f))).toEqual([]);
    });

    test('permissions are the documented minimum and nothing else', () => {
      expect(content).toMatch(/permissions:/);
      expect(content).toMatch(/pull-requests:[ \t]+write/);
      expect(content).toMatch(/contents:[ \t]+read/);
      const writePerms = content.match(/^[ \t]+[a-z-]+:[ \t]+write\b/gm) || [];
      // ANCHOR before filtering — `toEqual([])` on the remainder passes
      // vacuously when the scan itself matched nothing.
      expect(writePerms).toHaveLength(1);
      expect(writePerms[0]).toMatch(/pull-requests:[ \t]+write/);
    });

    test('runs on a github-hosted runner', () => {
      expect(content).toMatch(/runs-on:[ \t]*ubuntu-latest/);
      expect(content).not.toMatch(/runs-on:.*self-hosted/);
    });
  });

  describe('identity', () => {
    test('mints a Release App token via actions/create-github-app-token (SHA-pinned)', () => {
      // A default GITHUB_TOKEN's own actions create no further workflow runs,
      // so a reopen performed with it would start no checks at all — the exact
      // failure this workflow exists to avoid.
      expect(content).toMatch(
        /uses:[ \t]*actions\/create-github-app-token@[0-9a-f]{40}[ \t]*#[ \t]*v\d[\d.]*/,
      );
    });

    test('App-token SHA matches release.yml exactly (cross-workflow parity)', () => {
      // Version-agnostic on purpose: a frozen literal would red on every
      // Dependabot bump. Deriving release.yml's SHA forces any future bump to
      // be atomic across both workflows.
      const releaseContent = fs.readFileSync(
        path.join(REPO_ROOT, '.github/workflows/release.yml'),
        'utf8',
      );
      const extract = (src) => {
        const m = src.match(/actions\/create-github-app-token@([0-9a-f]{40})/);
        return m ? m[1] : null;
      };
      const here = extract(content);
      const release = extract(releaseContent);
      expect(here).not.toBeNull();
      expect(release).not.toBeNull();
      expect(here).toBe(release);
    });

    test('App-token step reads the RELEASE_APP secrets', () => {
      // v3.x renamed the input: `client-id` replaces the deprecated `app-id`,
      // and the action aliases both to the same internal appId, so the numeric
      // RELEASE_APP_ID secret still works. Matches release.yml + sync-roadmap-data.yml.
      expect(content).toMatch(/client-id:[ \t]*\$\{\{[ \t]*secrets\.RELEASE_APP_ID[ \t]*\}\}/);
      expect(content).not.toMatch(/^[ \t]+app-id:/m);
      expect(content).toMatch(
        /private-key:[ \t]*\$\{\{[ \t]*secrets\.RELEASE_APP_PRIVATE_KEY[ \t]*\}\}/,
      );
    });

    test('gh commands run as the App, never as GITHUB_TOKEN', () => {
      expect(content).toMatch(
        /GH_TOKEN:[ \t]*\$\{\{[ \t]*steps\.app-token\.outputs\.token[ \t]*\}\}/,
      );
      expect(content).not.toMatch(/GH_TOKEN:[ \t]*\$\{\{[ \t]*secrets\.GITHUB_TOKEN[ \t]*\}\}/);
    });
  });

  describe('behaviour', () => {
    test('retargets the pull request onto develop', () => {
      expect(content).toMatch(/gh pr edit[^\n]*--base develop/);
    });

    test('closes and reopens so a pull_request event actually fires', () => {
      // A base change alone fires no pull_request event, so pr-checks.yml,
      // branch-discipline-check.yml and dependabot-auto-merge.yml never run.
      // The close/reopen pair is what starts them.
      expect(content).toMatch(/gh pr close/);
      expect(content).toMatch(/gh pr reopen/);
      const closeAt = content.indexOf('gh pr close');
      const reopenAt = content.indexOf('gh pr reopen');
      const editAt = content.indexOf('gh pr edit');
      expect(editAt).toBeGreaterThan(-1);
      expect(closeAt).toBeGreaterThan(editAt);
      expect(reopenAt).toBeGreaterThan(closeAt);
    });

    test('polls for checks to start rather than assuming they did', () => {
      expect(content).toMatch(/gh pr checks/);
    });

    test('has a timeout so a stuck poll cannot hold a runner open', () => {
      expect(content).toMatch(/timeout-minutes:[ \t]*\d+/);
    });
  });

  describe('observability', () => {
    test('comments on the pull request naming the story', () => {
      expect(content).toMatch(/gh pr comment/);
      expect(content).toContain(STORY_ID);
    });

    test('writes a step summary', () => {
      expect(content).toMatch(/GITHUB_STEP_SUMMARY/);
    });

    test('fails loud when no check starts (never exits 0 on a stranded PR)', () => {
      expect(content).toMatch(/exit 1/);
    });
  });
});
