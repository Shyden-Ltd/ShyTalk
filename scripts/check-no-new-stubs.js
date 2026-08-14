#!/usr/bin/env node
/**
 * check-no-new-stubs.js — SHY-0108 + SHY-0112 (EPIC-0003) anti-regression
 * ratchet guard.
 *
 * EPIC-0003 is draining the in-process doubles outside unit tests to zero.
 * This guard freezes the ceiling: it fails any commit that introduces a NEW
 * double — `jest.mock`/`jest.fn`/`page.route`/`mockResolvedValue`-family/
 * `make*Fake*` (JS/TS), `Fake*Repository`/`mockk`/`Mockito` (Kotlin), or an
 * iOS `Mock/Fake/Stub/Spy` type — while tolerating the known-and-shrinking
 * baseline of existing ones. The set can only ever shrink — when
 * `scripts/no-stubs-baseline.json` is empty in every category, the drain is
 * provably complete.
 *
 * Policy-aware (SHY-0112): the hardened policy permits doubles ONLY in unit
 * tests (operator 2026-06-17). A file in a recognised unit-test location is
 * exempt — never scanned. See isUnitTestLocation for the boundary convention.
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
const SWIFT_EXT = new Set(['.swift']);

const isJsTs = (rel) => JS_TS_EXT.has(path.extname(rel));
const isKt = (rel) => KT_EXT.has(path.extname(rel));
// iOS doubles are structural Swift type declarations (`class MockX`/`StubX`…).
// The pattern can legitimately appear in *product* Swift (a `MockingbirdView`),
// so scope this category to Swift TEST paths (a `…Tests/` source dir) to avoid
// flagging shipping code — unlike the framework-specific JS/Kotlin patterns
// (`jest.*`, `mockk`) which only ever occur in tests.
const SWIFT_TEST_PATH = /(^|\/)[A-Za-z0-9]*Tests?\//;
const isSwiftTest = (rel) => SWIFT_EXT.has(path.extname(rel)) && SWIFT_TEST_PATH.test(rel);

// Category definitions. `regex` is content detection (run by
// classifyContent on every file); `applies` gates which file types/paths a
// category can bucket (so e.g. a `.kt` comment mentioning page.route is
// not miscounted as a Playwright offender).
//
// SHY-0108 froze the first three; SHY-0112 (the EPIC-0003 keystone) widened
// the set with the blind-spot detectors that actually dominate the debt
// (jest.fn collaborators, hand-rolled fakes, mockResolved* families, Kotlin
// mockk/Mockito, iOS doubles) and made the ratchet policy-aware via
// isUnitTestLocation — a double in a unit-test location is permitted and never
// scanned (operator 2026-06-17: "the only thing I will allow fakes or mocks is
// the unit tests").
const CATEGORIES = [
  {
    key: 'jestMock',
    label: 'jest.mock(',
    regex: /\bjest\.mock\s*\(/,
    applies: isJsTs,
  },
  {
    key: 'fakeRepository',
    label: 'Fake*Repository',
    regex: /\bFake[A-Za-z0-9_]*Repository\b/,
    applies: isKt,
  },
  {
    key: 'pageRoute',
    label: 'page.route(',
    regex: /\bpage\.route\s*\(/,
    applies: isJsTs,
  },
  {
    key: 'jestFn',
    label: 'jest.fn(',
    regex: /\bjest\.fn\s*\(/,
    applies: isJsTs,
  },
  {
    key: 'handRolledFake',
    label: 'make*Fake* factory',
    regex: /\bmake[A-Za-z0-9_]*Fake[A-Za-z0-9_]*/,
    applies: isJsTs,
  },
  {
    key: 'mockResolved',
    label: 'mockResolvedValue/etc',
    regex: /\.mock(Resolved|Rejected|Return)Value(Once)?\b|\.mockImplementation(Once)?\b/,
    applies: isJsTs,
  },
  {
    key: 'kotlinMock',
    label: 'mockk/Mockito',
    regex: /\bmockk\s*[(<]|\bMockito\.|@Mock[A-Za-z]*\b/,
    applies: isKt,
  },
  {
    key: 'iosDouble',
    label: 'iOS Mock/Fake/Stub/Spy type',
    regex: /\b(class|struct|protocol)\s+(Mock|Fake|Stub|Spy)[A-Za-z0-9_]*/,
    applies: isSwiftTest,
  },
];

// Category-driven so adding a CATEGORIES entry never requires editing this.
const EMPTY = () => Object.fromEntries(CATEGORIES.map((c) => [c.key, []]));

// ── The unit↔integration boundary (SHY-0112) ────────────────────────────────
// The hardened policy permits doubles ONLY in unit tests; integration /
// journey-runner / e2e / device layers are real-only. Classification is by what
// a test EXERCISES, proxied here by a greppable LOCATION convention the ratchet
// can enforce mechanically (code-reviewer + the per-SHY Test Plan are the
// backstops that catch a mislabelled integration test). A file in a unit-test
// location is exempt — never scanned for any category.
const JS_UNIT_DIR = /(^|\/)tests\/unit\//;
const JS_UNIT_SUFFIX = /\.unit\.test\.(js|jsx|ts|tsx|mjs|cjs)$/;
// Instrumented Kotlin test source sets need a real device → real-only → counted.
const KT_INSTRUMENTED = /(^|\/)src\/(androidTest|androidInstrumentedTest|androidUiTest)\//;
// Any OTHER Kotlin test source set runs on the host JVM (commonTest, jvmTest,
// androidHostTest, plain src/test) → unit → exempt.
const KT_HOST_TEST = /(^|\/)src\/(test|[A-Za-z0-9]+Test)\//;

/**
 * Is `rel` a recognised unit-test location (doubles permitted, exempt from the
 * scan)? JS: `**\/tests/unit/**` or `*.unit.test.{js,ts,…}`. Kotlin: a
 * non-instrumented (host) test source set. iOS/Swift has no unit-location
 * convention yet, so Swift is never exempt (its doubles mock real collaborators
 * and must be drained). Production code is never a unit-test location.
 */
function isUnitTestLocation(rel) {
  const p = rel.split(path.sep).join('/');
  if (isJsTs(p)) return JS_UNIT_DIR.test(p) || JS_UNIT_SUFFIX.test(p);
  if (isKt(p)) {
    if (KT_INSTRUMENTED.test(p)) return false;
    return KT_HOST_TEST.test(p);
  }
  return false;
}

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

const SCANNABLE_EXT = new Set([...JS_TS_EXT, ...KT_EXT, ...SWIFT_EXT]);

/**
 * Scan the real repo at `cwd` for offenders. Excludes the guard's own files
 * AND unit-test locations (policy: doubles are permitted in unit tests, so
 * they are never scanned — SHY-0112).
 */
function scanRepo({ cwd } = {}) {
  const root = cwd || process.cwd();
  const files = gitTrackedFiles(root).filter(
    (rel) =>
      SCANNABLE_EXT.has(path.extname(rel)) &&
      !SELF_EXCLUDE.has(rel) &&
      !isUnitTestLocation(rel),
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
      err(`::error file=${f}::NEW ${cat.label} introduced — migrate to the real local stack (no mocks/fakes), or move it to a unit-test location if it is genuinely a unit test (tests/unit/ · *.unit.test.js · a non-instrumented Kotlin src/*Test source set), or escalate for an operator-approved exception.`);
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

Bans (ratchet, may only shrink) — OUTSIDE unit-test locations only:
  jest.mock( · Fake*Repository · page.route( · jest.fn( · make*Fake* factory
  · mockResolvedValue/etc · Kotlin mockk/Mockito · iOS Mock/Fake/Stub/Spy type
Unit-test locations are EXEMPT (policy: doubles allowed only in unit tests):
  tests/unit/** · *.unit.test.{js,ts} · non-instrumented Kotlin src/*Test sets
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
  isUnitTestLocation,
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
