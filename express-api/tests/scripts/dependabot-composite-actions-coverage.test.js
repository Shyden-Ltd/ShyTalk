/**
 * SHY-0226: Dependabot must see every composite-action directory.
 *
 * Why this exists: dependabot.yml's `github-actions` ecosystem watched
 * `directory: "/"` only, which covers `.github/workflows/**` but NOT the
 * composite actions under `.github/actions/**`. Every setup-java bump
 * therefore moved the workflow references while the composite's pin stayed
 * behind — the exact two-SHA drift that reddened the whole Dependabot queue
 * (#1587 split the pins on 2026-07-13; #1646 widened it on 2026-07-20; all
 * 17 queued PRs failed the SHY-0162 one-SHA invariant with the same
 * signature). With every composite directory declared, Dependabot raises ONE
 * PR per action update that moves every reference together, so the drift
 * class cannot be reintroduced by a routine bump.
 *
 * The live pin is EXHAUSTIVE on purpose: adding a new `.github/actions/*`
 * directory without declaring it here fails this test naming the missing
 * directory — future composites are registered at birth, pinned or not
 * (declaring a pin-free composite is harmless and future-proofs its first
 * pinned step).
 *
 * All scanning/analysis is pure + injectable so the diagnostic path is
 * covered by synthetic fixtures, not only by a (hopefully-never) broken repo.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEPENDABOT_PATH = path.join(REPO_ROOT, '.github/dependabot.yml');
const ACTIONS_DIR = path.join(REPO_ROOT, '.github/actions');

// Anchored, ReDoS-safe line matchers (negated classes, no nested
// quantifiers) — same idiom as ci-action-pin-consistency.test.js.
const ECOSYSTEM_RE = /^\s*-\s*package-ecosystem:\s*['"]?([^\s'"#]+)/;
const DIRECTORY_RE = /^\s*directory:\s*['"]?([^\s'"#]+)/;
const DIRECTORIES_KEY_RE = /^\s*directories:\s*$/;
const LIST_ITEM_RE = /^\s*-\s*['"]?([^\s'"#]+)/;

/**
 * Pure: collect every directory declared under `github-actions` update
 * entries in a dependabot.yml text. Handles both the singular `directory:`
 * key and a plural `directories:` block of list items. Line-based on
 * purpose (mirrors the sibling pin tests; no YAML dependency).
 */
function collectGithubActionsDirectories(text) {
  const dirs = [];
  let inGithubActionsEntry = false;
  let inDirectoriesBlock = false;
  for (const line of text.split('\n')) {
    const eco = ECOSYSTEM_RE.exec(line);
    if (eco) {
      inGithubActionsEntry = eco[1] === 'github-actions';
      inDirectoriesBlock = false;
      continue;
    }
    if (!inGithubActionsEntry) continue;
    if (DIRECTORIES_KEY_RE.test(line)) {
      inDirectoriesBlock = true;
      continue;
    }
    if (inDirectoriesBlock) {
      const item = LIST_ITEM_RE.exec(line);
      if (item) {
        dirs.push(item[1]);
        continue;
      }
      // Any non-list-item line (a sibling key, blank, comment) ends the
      // directories block.
      if (line.trim().length > 0) inDirectoriesBlock = false;
    }
    const single = DIRECTORY_RE.exec(line);
    if (single) dirs.push(single[1]);
  }
  return dirs;
}

/**
 * Pure: which composite-action directory names are NOT covered by the
 * declared github-actions directories. Coverage means the exact
 * `/.github/actions/<name>` path is declared.
 */
function findUncoveredComposites(compositeNames, declaredDirs) {
  const declared = new Set(declaredDirs);
  return compositeNames
    .filter((name) => !declared.has(`/.github/actions/${name}`))
    .map((name) => `/.github/actions/${name}`);
}

function listCompositeActionDirs(actionsDir) {
  return fs
    .readdirSync(actionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// Match a real YAML `uses:` line — same anchored, ReDoS-safe idiom as
// ci-action-pin-consistency.test.js (which owns the one-SHA invariant this
// grouping requirement exists to keep satisfiable).
const USES_LINE_RE = /^\s*(?:-\s*)?uses:\s*['"]?([^\s@'"#]+)@/;

/**
 * Pure: collect every group `patterns:` glob declared under `github-actions`
 * update entries. Same entry/block walk as the directories collector.
 */
function collectGithubActionsGroupPatterns(text) {
  const patterns = [];
  let inGithubActionsEntry = false;
  let inPatternsBlock = false;
  for (const line of text.split('\n')) {
    const eco = ECOSYSTEM_RE.exec(line);
    if (eco) {
      inGithubActionsEntry = eco[1] === 'github-actions';
      inPatternsBlock = false;
      continue;
    }
    if (!inGithubActionsEntry) continue;
    if (/^\s*patterns:\s*$/.test(line)) {
      inPatternsBlock = true;
      continue;
    }
    if (inPatternsBlock) {
      const item = LIST_ITEM_RE.exec(line);
      if (item) {
        patterns.push(item[1]);
        continue;
      }
      if (line.trim().length > 0) inPatternsBlock = false;
    }
  }
  return patterns;
}

/**
 * Pure: action repos referenced under >= 2 distinct sub-paths (e.g.
 * github/codeql-action/init + /autobuild + /analyze; actions/cache +
 * /restore + /save). Dependabot treats each sub-path as a separate
 * dependency and raises separate PRs — every such solo PR violates the
 * one-SHA-per-repo invariant by construction (#1649: autobuild bumped
 * alone, CodeQL failed with a 4.36.3-config-vs-4.37.1-runtime mismatch).
 */
function findMultiSubpathRepos(actionPaths) {
  const pathsByRepo = new Map();
  for (const action of actionPaths) {
    const repo = action.split('/').slice(0, 2).join('/');
    if (!pathsByRepo.has(repo)) pathsByRepo.set(repo, new Set());
    pathsByRepo.get(repo).add(action);
  }
  return [...pathsByRepo.entries()]
    .filter(([, paths]) => paths.size >= 2)
    .map(([repo]) => repo)
    .sort();
}

/**
 * Pure: does a Dependabot group glob (literal text + `*` wildcards) cover
 * every sub-path of the repo? A repo is covered when the glob matches the
 * bare repo name AND keeps matching with a sub-path appended (in practice:
 * a `<repo>*` prefix glob).
 */
function repoCoveredByPatterns(repo, patterns) {
  return patterns.some((glob) => {
    const re = new RegExp(`^${glob.split('*').map(escapeRegExp).join('.*')}$`);
    return re.test(repo) && re.test(`${repo}/subpath`);
  });
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectActionPathsFromGithubDir(githubDir) {
  const actionPaths = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.ya?ml$/.test(entry.name)) {
        for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
          const m = USES_LINE_RE.exec(line);
          if (!m) continue;
          const action = m[1];
          if (action.startsWith('.') || action.includes('://') || !action.includes('/')) continue;
          actionPaths.push(action);
        }
      }
    }
  };
  walk(githubDir);
  return actionPaths;
}

describe('SHY-0226: dependabot.yml covers every composite-action directory', () => {
  describe('live repo invariants', () => {
    let declaredDirs;
    let compositeNames;

    beforeAll(() => {
      declaredDirs = collectGithubActionsDirectories(fs.readFileSync(DEPENDABOT_PATH, 'utf8'));
      compositeNames = listCompositeActionDirs(ACTIONS_DIR);
    });

    test('the repo actually has composite actions (guard is not vacuous)', () => {
      expect(compositeNames.length).toBeGreaterThan(0);
    });

    test('workflows root "/" stays covered', () => {
      expect(declaredDirs).toContain('/');
    });

    test('every .github/actions/* directory is declared to Dependabot', () => {
      const missing = findUncoveredComposites(compositeNames, declaredDirs);
      if (missing.length > 0) {
        throw new Error(
          'Composite-action directories invisible to Dependabot — a future ' +
            'action bump would move workflow pins but not these, recreating ' +
            'the SHY-0162 two-SHA drift that blocked the whole Dependabot ' +
            `queue. Declare them under the github-actions update entry:\n  ${missing.join('\n  ')}`,
        );
      }
    });

    test('every multi-sub-path action repo is covered by a Dependabot group', () => {
      const repos = findMultiSubpathRepos(
        collectActionPathsFromGithubDir(path.join(REPO_ROOT, '.github')),
      );
      // Guard against vacuity: the repo uses cache/{,restore,save} and
      // codeql-action/{init,autobuild,analyze} today.
      expect(repos.length).toBeGreaterThan(0);
      const patterns = collectGithubActionsGroupPatterns(fs.readFileSync(DEPENDABOT_PATH, 'utf8'));
      const ungrouped = repos.filter((repo) => !repoCoveredByPatterns(repo, patterns));
      if (ungrouped.length > 0) {
        throw new Error(
          'Action repos used under multiple sub-paths but not grouped in ' +
            'dependabot.yml — Dependabot bumps each sub-path in a SEPARATE ' +
            'PR, so every such solo PR both violates the one-SHA invariant ' +
            'and (for codeql-action) breaks at runtime on mixed versions ' +
            `(#1649). Add a "<repo>*" group pattern for:\n  ${ungrouped.join('\n  ')}`,
        );
      }
    });
  });

  describe('collectGithubActionsDirectories (synthetic fixtures)', () => {
    test('reads the singular directory: form', () => {
      const text = [
        'updates:',
        '  - package-ecosystem: "github-actions"',
        '    directory: "/"',
      ].join('\n');
      expect(collectGithubActionsDirectories(text)).toEqual(['/']);
    });

    test('reads a plural directories: block and stops at the next key', () => {
      const text = [
        'updates:',
        '  - package-ecosystem: "github-actions"',
        '    directories:',
        '      - "/"',
        '      - "/.github/actions/setup-node"',
        '    schedule:',
        '      interval: "weekly"',
      ].join('\n');
      expect(collectGithubActionsDirectories(text)).toEqual(['/', '/.github/actions/setup-node']);
    });

    test('ignores directories of other ecosystems', () => {
      const text = [
        'updates:',
        '  - package-ecosystem: "npm"',
        '    directory: "/express-api"',
        '  - package-ecosystem: "github-actions"',
        '    directory: "/"',
      ].join('\n');
      expect(collectGithubActionsDirectories(text)).toEqual(['/']);
    });
  });

  describe('findUncoveredComposites (synthetic fixtures)', () => {
    test('names exactly the undeclared composites', () => {
      expect(findUncoveredComposites(['a', 'b'], ['/', '/.github/actions/a'])).toEqual([
        '/.github/actions/b',
      ]);
    });

    test('empty when everything is declared', () => {
      expect(findUncoveredComposites(['a'], ['/', '/.github/actions/a'])).toEqual([]);
    });
  });

  describe('findMultiSubpathRepos (synthetic fixtures)', () => {
    test('flags repos with two or more distinct sub-paths', () => {
      expect(
        findMultiSubpathRepos([
          'github/codeql-action/init',
          'github/codeql-action/analyze',
          'actions/cache',
          'actions/cache/restore',
          'actions/checkout',
          'actions/checkout',
        ]),
      ).toEqual(['actions/cache', 'github/codeql-action']);
    });

    test('a repo used under one path repeatedly is not flagged', () => {
      expect(findMultiSubpathRepos(['actions/checkout', 'actions/checkout'])).toEqual([]);
    });
  });

  describe('repoCoveredByPatterns (synthetic fixtures)', () => {
    test('a "<repo>*" prefix glob covers the repo and its sub-paths', () => {
      expect(repoCoveredByPatterns('actions/cache', ['actions/cache*'])).toBe(true);
    });

    test('an exact-name glob does NOT cover sub-paths (must fail closed)', () => {
      expect(repoCoveredByPatterns('actions/cache', ['actions/cache'])).toBe(false);
    });

    test('an unrelated glob does not cover', () => {
      expect(repoCoveredByPatterns('github/codeql-action', ['actions/cache*'])).toBe(false);
    });
  });

  describe('collectGithubActionsGroupPatterns (synthetic fixtures)', () => {
    test('reads patterns lists and ignores update-types groups', () => {
      const text = [
        'updates:',
        '  - package-ecosystem: "github-actions"',
        '    groups:',
        '      codeql-action:',
        '        patterns:',
        '          - "github/codeql-action*"',
        '      patch-updates:',
        '        update-types:',
        '          - "patch"',
      ].join('\n');
      expect(collectGithubActionsGroupPatterns(text)).toEqual(['github/codeql-action*']);
    });

    test('ignores groups of other ecosystems', () => {
      const text = [
        'updates:',
        '  - package-ecosystem: "npm"',
        '    groups:',
        '      npm-group:',
        '        patterns:',
        '          - "eslint*"',
        '  - package-ecosystem: "github-actions"',
        '    directory: "/"',
      ].join('\n');
      expect(collectGithubActionsGroupPatterns(text)).toEqual([]);
    });
  });
});
