/**
 * SHY-0145 — the fun-facts pipeline is decommissioned (backend + admin + data).
 *
 * Sibling of `no-funfact-splash-app-surface.test.js`, which covers SHY-0144's
 * APP-side removal and deliberately carved this surface out so the two stories
 * could be told apart. With SHY-0145 landed, that carve-out is empty and the two
 * guards together cover the whole repository.
 *
 * It SCANS rather than listing known files, so a reference reintroduced in a file
 * nobody thought of still fails. Real-only: it reads the tree off disk.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../../..');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'build',
  'dist',
  '.gradle',
  'Pods',
  'test-results',
  'playwright-report',
  'allure-results',
  '.project', // stories and handovers RECORD the removal; they must keep saying so
]);

/** Extensions that make up the backend + admin-web surface. */
const SURFACE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.html', '.rules']);

/**
 * Files that legitimately still contain the string. `roadmap-data.json` carries
 * a historical description of a PAST story that happens to name `admin-funfacts`
 * as a test file it fixed — a record of what happened, not a live surface.
 */
const ALLOWED = new Set([
  'public/roadmap-data.json',
  // These two guards NAME the surface they forbid — in their headers, their
  // deleted-file lists and their test names. Any guard that greps for a pattern
  // contains that pattern, and would otherwise report itself forever.
  'express-api/tests/scripts/no-funfacts-backend-admin-surface.test.js',
  'express-api/tests/scripts/no-funfact-splash-app-surface.test.js',
]);

/**
 * A line that only MENTIONS the removed pipeline in prose is documentation, not
 * surface — e.g. the comment in `backups.test.js` recording why the backup
 * collection count dropped. Comments do not execute, so they cannot resurrect
 * anything; and a guard that forbade them could never be explained in any file
 * it scans.
 */
const COMMENT_RE = /^\s*(\/\/|\/\*|\*|#|<!--)/;

/** Non-comment lines of a file, joined for scanning. */
const codeOf = (f) =>
  fs
    .readFileSync(f, 'utf8')
    .split('\n')
    .filter((l) => !COMMENT_RE.test(l))
    .join('\n');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const ALL_FILES = walk(REPO);
const rel = (f) => path.relative(REPO, f);

describe('SHY-0145 — the fun-facts pipeline is decommissioned', () => {
  test('the scan actually sees source — the guard is not vacuous', () => {
    const js = ALL_FILES.filter((f) => f.endsWith('.js'));
    expect(js.length).toBeGreaterThan(200);
  });

  test('the fun-facts source files are deleted', () => {
    const gone = [
      'express-api/src/routes/fun-facts.js',
      'express-api/tests/routes/fun-facts.test.js',
      'public/admin/js/tabs/fun-facts.js',
      'tests/web/admin-funfacts.spec.ts',
    ];
    expect(gone.filter((p) => fs.existsSync(path.join(REPO, p)))).toEqual([]);
  });

  test('no backend or admin source references the funFacts collection', () => {
    const offenders = ALL_FILES.filter((f) => {
      if (!SURFACE_EXTENSIONS.has(path.extname(f))) return false;
      if (ALLOWED.has(rel(f))) return false;
      return /funFacts/.test(codeOf(f));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  test('no source registers or calls a fun-facts route or admin tab', () => {
    const offenders = ALL_FILES.filter((f) => {
      if (!SURFACE_EXTENSIONS.has(path.extname(f))) return false;
      if (ALLOWED.has(rel(f))) return false;
      // `fun facts` with a SPACE matters: the admin tab is referenced by its
      // LABEL in the Playwright specs, and a hyphen/concatenation-only pattern
      // missed three of them until CI failed (SHY-0145).
      return /fun-facts|funfacts|fun facts|funFact/i.test(codeOf(f));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  test('firestore.rules has no funFacts block', () => {
    const rules = path.join(REPO, 'firestore.rules');
    expect(fs.existsSync(rules)).toBe(true);
    expect(fs.readFileSync(rules, 'utf8')).not.toMatch(/funFacts/);
  });
});
