/**
 * The admin dashboard's ES modules have to actually LOAD in a browser.
 *
 * ## Why this exists
 *
 * On 2026-08-22 the admin Support tab rendered nothing at all in chromium,
 * firefox and webkit — no tickets, no empty-state, not even "Loading…". One
 * line was responsible:
 *
 *     import { renderEvidence } from "/js/tabs/users.js";   // 404
 *
 * The file is served at `/admin/js/tabs/users.js`. A 404 on an ES module import
 * aborts the whole module, so `init()` never ran and the tab was inert. Every
 * unit test was green throughout, because they read the file as TEXT.
 *
 * That is the lesson twice over. `support-follow-up-reaches-the-admin.test.js`
 * greps `support.js` and asserts it renders follow-ups — perfectly true of the
 * source, and completely irrelevant to a module the browser refuses to execute.
 * A source-scanning guard can only ever prove what the source SAYS.
 *
 * So this file checks the two things a grep-based guard cannot: that every
 * absolute import resolves to a file that exists under the served root, and
 * that `apiCall` is never called with the wrong arity. Both are whole-class
 * checks — they fail for the NEXT tab to make either mistake, not just for the
 * one that made it first.
 *
 * See [[feedback-assert-the-seam-not-the-sides]].
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const PUBLIC_DIR = path.join(repoRoot, 'public');
const ADMIN_JS = path.join(PUBLIC_DIR, 'admin', 'js');

/** Every .js file under public/admin/js, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const FILES = walk(ADMIN_JS);
const rel = (p) => path.relative(repoRoot, p);

/**
 * `serve-web.js` maps a URL path onto `public/`, so an absolute specifier `/x/y`
 * is the file `public/x/y`. Anything relative is resolved against its importer.
 */
function resolveSpecifier(fromFile, spec) {
  if (spec.startsWith('/')) return path.join(PUBLIC_DIR, spec);
  if (spec.startsWith('.')) return path.resolve(path.dirname(fromFile), spec);
  return null; // bare specifier — not something this server can serve anyway
}

const IMPORT_RE = /\bimport\s+(?:[\s\S]*?\bfrom\s*)?['"]([^'"]+)['"]/g;

describe('admin dashboard ES modules', () => {
  test('there are admin modules to check (the guard is not vacuous)', () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  test.each(FILES.map((f) => [rel(f), f]))('%s imports only files that exist', (_name, file) => {
    const src = fs.readFileSync(file, 'utf8');
    const broken = [];
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      const resolved = resolveSpecifier(file, spec);
      if (!resolved) continue;
      if (!fs.existsSync(resolved)) broken.push({ spec, wouldServe: rel(resolved) });
    }
    // Reported as the list, not a count: the failure has to name the bad
    // specifier, or somebody has to re-derive it before they can fix it.
    expect(broken).toEqual([]);
  });

  /**
   * `apiCall(method, path, body)` — the path in the first slot means
   * `fetch(baseUrl + undefined)`, which throws before any request leaves the
   * page. In the Support tab that surfaced as a red "Attachments could not be
   * loaded" on EVERY ticket, including ones with no attachments, and no
   * `/attachments` request was ever made.
   */
  test.each(FILES.map((f) => [rel(f), f]))(
    '%s calls apiCall with a method first',
    (_name, file) => {
      const src = fs.readFileSync(file, 'utf8');
      const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];
      const bad = [];
      for (const m of src.matchAll(/\bapiCall\s*\(\s*([\s\S]{0,40})/g)) {
        const firstArg = m[1].trimStart();
        const looksLikeMethod = METHODS.some(
          (v) => firstArg.startsWith(`'${v}'`) || firstArg.startsWith(`"${v}"`),
        );
        // A variable in the first slot is allowed — it cannot be judged here, and
        // a false failure would push somebody to weaken the guard.
        const looksLikeIdentifier = /^[A-Za-z_$][\w$]*\s*[,)]/.test(firstArg);
        if (!looksLikeMethod && !looksLikeIdentifier) {
          bad.push(firstArg.split('\n')[0].slice(0, 60));
        }
      }
      expect(bad).toEqual([]);
    },
  );
});
