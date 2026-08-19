/**
 * action-pins.js — the ONE definition of how this repo reads third-party
 * GitHub Action pins out of `.github/`.
 *
 * Extracted from express-api/tests/scripts/ci-action-pin-consistency.test.js
 * (SHY-0162) by SHY-0284 so the same scan can back BOTH:
 *
 *   - that Jest suite, which unit-tests these functions against synthetic
 *     fixtures as well as the live tree, and
 *   - scripts/check-action-pin-consistency.js, run unconditionally by
 *     lint.yml.
 *
 * Why the CLI had to exist: the SHY-0162 invariant only lived in the Express
 * Jest suite, and `test-backend` is gated on `backend_changed`. A workflow-only
 * PR — precisely the shape of the partial Dependabot action bump this guard
 * was written to catch — never ran it. `actions/setup-node` and
 * `actions/setup-java` both sat at two SHAs on main for two days as a result.
 * A guard has to run in the same job class as the change it guards.
 *
 * No dependencies beyond node builtins: lint.yml's workflow-only path is
 * deliberately ~30s of cheap script invocations with no `npm ci`.
 */
const fs = require('node:fs');
const path = require('node:path');

// ACTION_PINS_ROOT lets a caller point the scan at a different tree. It exists
// so the guard's own tests can run the REAL script, as a real process, against
// a real directory of real YAML files — rather than injecting a fake reader.
// `express-api/tests/scripts/` is not a unit-test location under this repo's
// no-stubs rule, so real-only applies. Unset in CI and in normal use.
const REPO_ROOT = process.env.ACTION_PINS_ROOT
  ? path.resolve(process.env.ACTION_PINS_ROOT)
  : path.resolve(__dirname, '../..');
const GITHUB_DIR = path.join(REPO_ROOT, '.github');

// Match a real YAML `uses:` key (optionally list-dashed), NOT a `#`-commented
// or prose mention: anchored at line start, so `# uses: foo@old` can't leak in.
// An optional opening quote is tolerated (`uses: "actions/foo@sha"`). Negated
// char classes only => no backtracking (ReDoS-safe; sonarjs/slow-regex). The
// action stops at `@`; the ref stops at whitespace/quote/`#`, so a trailing
// `# v6.1.0` version comment (and any closing quote) is dropped cleanly.
const USES_LINE_RE = /^\s*(?:-\s*)?uses:\s*['"]?([^\s@'"#]+)@([^\s'"#]+)/;
const SHA_RE = /^[0-9a-f]{40}$/;

// The action REPO an owner/repo[/sub] ref belongs to (cache/restore + cache/save
// share the `actions/cache` repo, so they must share one release SHA).
function repoOf(action) {
  return action.split('/').slice(0, 2).join('/');
}

// Pure: extract every third-party pinned `uses:` ref from one file's text.
// Skips local composite refs (`./…`) and container refs (`docker://…`).
function collectRefsFromText(file, text) {
  const refs = [];
  for (const line of text.split('\n')) {
    const m = USES_LINE_RE.exec(line);
    if (!m) continue;
    const [, action, ref] = m;
    if (action.startsWith('.') || action.includes('://') || !action.includes('/')) continue;
    refs.push({ file, action, ref, repo: repoOf(action) });
  }
  return refs;
}

// Every YAML file under `.github/` that can carry a third-party pin — workflows,
// composite/reusable action manifests, codeql config, anything. Recursive so a
// pin in a new location is never silently missed (parity with the wider scan in
// scripts/check-action-shas.sh).
function listYamlFiles(dir = GITHUB_DIR, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listYamlFiles(full, acc);
    else if (/\.ya?ml$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function collectAllRefs() {
  const refs = [];
  for (const file of listYamlFiles()) {
    const rel = path.relative(REPO_ROOT, file);
    refs.push(...collectRefsFromText(rel, fs.readFileSync(file, 'utf8')));
  }
  return refs;
}

// Pure: refs whose pin is not a 40-hex commit SHA (a floating tag / branch).
function findUnpinned(refs) {
  return refs.filter((r) => !SHA_RE.test(r.ref)).map((r) => `${r.file}: ${r.action}@${r.ref}`);
}

// Pure: action repos pinned to >1 distinct SHA, each with a {sha -> [file:action]}
// map so a partial bump is instantly attributable to the file that introduced it.
function findInconsistentRepos(refs) {
  const byRepo = new Map();
  for (const r of refs) {
    if (!byRepo.has(r.repo)) byRepo.set(r.repo, new Map());
    const shaMap = byRepo.get(r.repo);
    if (!shaMap.has(r.ref)) shaMap.set(r.ref, new Set());
    shaMap.get(r.ref).add(`${r.file}: ${r.action}`);
  }
  const bad = [];
  for (const [repo, shaMap] of byRepo) {
    if (shaMap.size > 1) {
      bad.push({
        repo,
        shas: Object.fromEntries([...shaMap].map(([sha, where]) => [sha, [...where].sort()])),
      });
    }
  }
  return bad.sort((a, b) => a.repo.localeCompare(b.repo));
}

// Pure: the human-readable drift report thrown by the live-repo guard. Extracted
// so the message content (repo names, every SHA, the file list) is unit-tested
// with a synthetic `bad` array, not only when the live repo is actually broken.
function describeInconsistency(bad) {
  return (
    'CI action SHA drift — these action repos are pinned to >1 SHA ' +
    '(a partial Dependabot bump; bump every ref of the action together):\n' +
    JSON.stringify(bad, null, 2)
  );
}

module.exports = {
  REPO_ROOT,
  GITHUB_DIR,
  USES_LINE_RE,
  SHA_RE,
  repoOf,
  collectRefsFromText,
  listYamlFiles,
  collectAllRefs,
  findUnpinned,
  findInconsistentRepos,
  describeInconsistency,
};
