#!/usr/bin/env node
/**
 * SHY-0448 — the admin dashboard's JavaScript, linted at last.
 *
 * `public/**` was in none of lint-staged's three globs, so every file under
 * `public/admin/js/` was committed without ESLint or Prettier ever seeing it.
 * That is the wrong surface to leave unchecked: these files take text written
 * by members of the public and put it into `innerHTML`, and the Support tab's
 * own header comment calls that "precisely the shape of a stored-XSS problem
 * if it is ever trusted". The discipline keeping it safe was entirely manual.
 *
 * A RATCHET rather than a wall, matching `check-no-new-stubs.js` and
 * `check-no-test-sleeps.sh`. Fifty-six findings exist today across
 * twenty-three files; failing the build on all of them would either block
 * every change to this surface or get switched off. Per-file counts may only
 * SHRINK, so the surface is linted from now on and the debt drains.
 *
 * Exit: 0 = at or below baseline | 1 = a file got worse, or a new one appeared
 *       2 = usage / tooling error
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const BASELINE = path.join(REPO_ROOT, 'scripts', 'public-js-lint-baseline.json');
const CONFIG = path.join(REPO_ROOT, 'public', 'eslint.config.mjs');

function lint() {
  // --no-error-on-unmatched-pattern so an empty tree is not a tooling failure.
  const out = execFileSync(
    'npx',
    ['--prefix', 'express-api', 'eslint', '--config', CONFIG, 'public/**/*.js', '-f', 'json',
     '--no-error-on-unmatched-pattern'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64e6 },
  );
  return JSON.parse(out);
}

function countsFrom(results) {
  const counts = {};
  for (const file of results) {
    const rel = path.relative(REPO_ROOT, file.filePath);
    const n = (file.messages || []).length;
    if (n > 0) counts[rel] = n;
  }
  return counts;
}

function main() {
  const generate = process.argv.includes('--generate-baseline');

  let results;
  try {
    results = lint();
  } catch (err) {
    // ESLint exits non-zero when it reports problems; the JSON is still on
    // stdout, which is what we want. A genuine tooling failure has no stdout.
    if (!err.stdout) {
      console.error(`check-public-js-lint: eslint could not run: ${err.message}`);
      process.exit(2);
    }
    results = JSON.parse(err.stdout);
  }

  const current = countsFrom(results);

  if (generate) {
    fs.writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
    const total = Object.values(current).reduce((a, b) => a + b, 0);
    console.log(`check-public-js-lint: baseline written — ${total} findings across ${Object.keys(current).length} files`);
    process.exit(0);
  }

  if (!fs.existsSync(BASELINE)) {
    console.error(`check-public-js-lint: missing baseline ${BASELINE}. Run with --generate-baseline.`);
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  const worse = [];
  for (const [file, n] of Object.entries(current)) {
    const allowed = baseline[file] ?? 0;
    if (n > allowed) worse.push(`  ${file}: ${n} > ${allowed} allowed`);
  }
  // A file that improved should shrink the baseline, or the ratchet stops
  // ratcheting — the same STALE rule the stubs baseline enforces.
  const stale = [];
  for (const [file, allowed] of Object.entries(baseline)) {
    const n = current[file] ?? 0;
    if (n < allowed) stale.push(`  ${file}: ${n} < ${allowed} recorded`);
  }

  if (worse.length) {
    console.error('check-public-js-lint: FAIL — new lint findings under public/\n' + worse.join('\n'));
    console.error('\nFix them, or run `node scripts/check-public-js-lint.js --generate-baseline` only when the count genuinely went DOWN.');
    process.exit(1);
  }
  if (stale.length) {
    console.error('check-public-js-lint: STALE baseline — these files improved, so the baseline must shrink:\n' + stale.join('\n'));
    console.error('\nRun `node scripts/check-public-js-lint.js --generate-baseline`.');
    process.exit(1);
  }

  const total = Object.values(current).reduce((a, b) => a + b, 0);
  console.log(`✓ public-js-lint: clean — ${total} findings, at or below baseline.`);
}

main();
