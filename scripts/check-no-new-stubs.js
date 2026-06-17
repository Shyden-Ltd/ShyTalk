#!/usr/bin/env node
/**
 * check-no-new-stubs.js — SHY-0108 (EPIC-0003 Phase X) anti-regression
 * ratchet guard.
 *
 * EPIC-0003 is draining ~238 in-process doubles to zero. This guard
 * freezes the ceiling: it fails any commit that introduces a NEW
 * `jest.mock`, `Fake*Repository`, or `page.route(` while tolerating the
 * known-and-shrinking baseline of existing ones. The set can only ever
 * shrink — when `scripts/no-stubs-baseline.json` is empty in every
 * category, the drain is provably complete.
 *
 * Two failure directions (the ratchet only tightens):
 *   - NEW    — a tracked file offends a banned pattern but is NOT in the
 *              baseline → regression; migrate it to the real local stack
 *              (or escalate for an operator-approved exception — never a
 *              silent mock).
 *   - STALE  — a baseline path no longer offends → a migration removed
 *              the double but forgot to shrink the baseline; remove the
 *              entry (run `--generate-baseline`).
 *
 * Real-only: read-only static scan over git-tracked files; never
 * executes scanned code; `git ls-files` is spawned without a shell.
 *
 * Exit codes:
 *   0  clean (offenders == baseline) | --generate-baseline ok | --help
 *   1  ratchet violated (new offenders and/or stale baseline entries)
 *   2  usage error / missing or malformed baseline
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASELINE_REL = 'scripts/no-stubs-baseline.json';
const SCRIPT_REL = 'scripts/check-no-new-stubs.js';

// The guard's own source + its test contain these patterns as data /
// detection regexes — exclude them so they never self-trip the scan.
const SELF_EXCLUDE = new Set([
  'scripts/check-no-new-stubs.js',
  'express-api/tests/scripts/check-no-new-stubs.test.js',
]);

const JS_TS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const KT_EXT = new Set(['.kt']);

// Category definitions. `regex` is content detection (run by
// classifyContent on every file); `applies` gates which file types a
// category can bucket (so e.g. a `.kt` comment mentioning page.route is
// not miscounted as a Playwright offender).
const CATEGORIES = [
  {
    key: 'jestMock',
    label: 'jest.mock(',
    regex: /\bjest\.mock\s*\(/,
    applies: (rel) => JS_TS_EXT.has(path.extname(rel)),
  },
  {
    key: 'fakeRepository',
    label: 'Fake*Repository',
    regex: /\bFake[A-Za-z0-9_]*Repository\b/,
    applies: (rel) => KT_EXT.has(path.extname(rel)),
  },
  {
    key: 'pageRoute',
    label: 'page.route(',
    regex: /\bpage\.route\s*\(/,
    applies: (rel) => JS_TS_EXT.has(path.extname(rel)),
  },
];

const EMPTY = () => ({ jestMock: [], fakeRepository: [], pageRoute: [] });

/**
 * Pure content detection — which banned patterns the text contains.
 * Extension gating is the scanner's job, not this function's.
 */
function classifyContent(content) {
  const out = {};
  for (const cat of CATEGORIES) out[cat.key] = cat.regex.test(content);
  return out;
}

/**
 * Bucket a list of repo-relative paths into offender categories.
 * @param {string[]} relPaths
 * @param {(rel: string) => string} readFile  returns file content
 */
function scanFiles(relPaths, readFile) {
  const offenders = EMPTY();
  for (const rel of relPaths) {
    let content;
    try {
      content = readFile(rel);
    } catch {
      continue; // unreadable/binary → not a text offender
    }
    const hit = classifyContent(content);
    for (const cat of CATEGORIES) {
      if (hit[cat.key] && cat.applies(rel)) offenders[cat.key].push(rel);
    }
  }
  // Dedup (belt-and-suspenders against a duplicate path in relPaths) + sort
  // for deterministic output. git ls-files never repeats a path, but the
  // signature accepts any list, so we don't rely on the caller's uniqueness.
  for (const cat of CATEGORIES) offenders[cat.key] = [...new Set(offenders[cat.key])].sort();
  return offenders;
}

/** Git-tracked files (repo-relative). No shell → no injection class. */
function gitTrackedFiles(cwd) {
  const res = spawnSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`git ls-files failed: ${res.stderr || res.error || 'unknown error'}`);
  }
  return res.stdout.split('\0').filter(Boolean);
}

const SCANNABLE_EXT = new Set([...JS_TS_EXT, ...KT_EXT]);

/** Scan the real repo at `cwd` for offenders (excluding the guard's own files). */
function scanRepo({ cwd } = {}) {
  const root = cwd || process.cwd();
  const files = gitTrackedFiles(root).filter(
    (rel) => SCANNABLE_EXT.has(path.extname(rel)) && !SELF_EXCLUDE.has(rel),
  );
  return scanFiles(files, (rel) => fs.readFileSync(path.join(root, rel), 'utf8'));
}

function loadBaseline({ cwd } = {}) {
  const root = cwd || process.cwd();
  const file = path.join(root, BASELINE_REL);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`Baseline not found at ${BASELINE_REL} — run \`node ${SCRIPT_REL} --generate-baseline\`.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Baseline ${BASELINE_REL} is malformed JSON: ${e.message}`);
  }
  // Normalise to the canonical shape (missing categories → empty).
  const base = EMPTY();
  for (const cat of CATEGORIES) {
    if (parsed[cat.key] && !Array.isArray(parsed[cat.key])) {
      throw new Error(`Baseline ${BASELINE_REL} category "${cat.key}" must be an array.`);
    }
    base[cat.key] = (parsed[cat.key] || []).slice().sort();
  }
  return base;
}

function diffBaseline(offenders, baseline) {
  const newOffenders = EMPTY();
  const staleEntries = EMPTY();
  for (const cat of CATEGORIES) {
    const live = new Set(offenders[cat.key] || []);
    const base = new Set(baseline[cat.key] || []);
    newOffenders[cat.key] = [...live].filter((p) => !base.has(p)).sort();
    staleEntries[cat.key] = [...base].filter((p) => !live.has(p)).sort();
  }
  return { newOffenders, staleEntries };
}

function isClean(diff) {
  return CATEGORIES.every(
    (cat) => diff.newOffenders[cat.key].length === 0 && diff.staleEntries[cat.key].length === 0,
  );
}

function generateBaseline({ cwd } = {}) {
  const root = cwd || process.cwd();
  const offenders = scanRepo({ cwd: root });
  // Stable key order + sorted arrays + trailing newline → deterministic.
  const ordered = {};
  for (const cat of CATEGORIES) ordered[cat.key] = offenders[cat.key];
  fs.writeFileSync(path.join(root, BASELINE_REL), `${JSON.stringify(ordered, null, 2)}\n`);
  return offenders;
}

function out(s) {
  process.stdout.write(`${s}\n`);
}
function err(s) {
  process.stderr.write(`${s}\n`);
}

function reportAndExit(diff, baseline) {
  if (isClean(diff)) {
    const sizes = CATEGORIES.map((c) => `${c.label}=${baseline[c.key].length}`).join(', ');
    out(`✓ no-new-stubs: clean. Remaining baseline debt — ${sizes}.`);
    return 0;
  }
  err('::error::no-new-stubs ratchet violated — the in-process-double debt may only SHRINK (EPIC-0003).');
  for (const cat of CATEGORIES) {
    for (const f of diff.newOffenders[cat.key]) {
      err(`::error file=${f}::NEW ${cat.label} introduced — migrate to the real local stack (no mocks/fakes), or escalate for an operator-approved exception.`);
    }
    for (const f of diff.staleEntries[cat.key]) {
      err(`::error file=${f}::STALE baseline entry — this file no longer contains ${cat.label}; remove it from ${BASELINE_REL} (run --generate-baseline). The ratchet only tightens.`);
    }
  }
  const newCount = CATEGORIES.reduce((n, c) => n + diff.newOffenders[c.key].length, 0);
  const staleCount = CATEGORIES.reduce((n, c) => n + diff.staleEntries[c.key].length, 0);
  err(`no-new-stubs: ${newCount} new offender(s), ${staleCount} stale baseline entr(ies).`);
  return 1;
}

const HELP = `check-no-new-stubs.js — EPIC-0003 Phase X anti-regression ratchet guard

Usage:
  node scripts/check-no-new-stubs.js                 # verify: fail on any new/stale double
  node scripts/check-no-new-stubs.js --generate-baseline  # (re)write ${BASELINE_REL}
  node scripts/check-no-new-stubs.js --help

Bans (ratchet, may only shrink): jest.mock( · Fake*Repository · page.route(
Exit: 0 clean | 1 ratchet violated | 2 usage / bad baseline`;

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    out(HELP);
    return 0;
  }
  const cwd = process.cwd();
  try {
    if (args.includes('--generate-baseline')) {
      const off = generateBaseline({ cwd });
      const sizes = CATEGORIES.map((c) => `${c.label}=${off[c.key].length}`).join(', ');
      out(`✓ wrote ${BASELINE_REL} — ${sizes}.`);
      return 0;
    }
    const offenders = scanRepo({ cwd });
    const baseline = loadBaseline({ cwd });
    return reportAndExit(diffBaseline(offenders, baseline), baseline);
  } catch (e) {
    err(`::error::no-new-stubs guard error: ${e.message}`);
    return 2;
  }
}

module.exports = {
  classifyContent,
  scanFiles,
  scanRepo,
  gitTrackedFiles,
  diffBaseline,
  isClean,
  loadBaseline,
  generateBaseline,
  reportAndExit,
  main,
  CATEGORIES,
  BASELINE_REL,
  SCRIPT_REL,
};

if (require.main === module) {
  process.exit(main(process.argv));
}
