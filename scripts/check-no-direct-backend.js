#!/usr/bin/env node
/**
 * check-no-direct-backend.js — SHY-0168 (EPIC-0006) anti-regression ratchet.
 *
 * HARD GLOBAL RULE (operator 2026-07-09, feedback-no-direct-backend-all-via-api):
 * clients must NEVER touch a backend service (Firestore / RTDB / Storage)
 * directly — ALL backend access goes through the Express API, the one
 * authorization chokepoint. Direct client→Firestore access relies on
 * client-side rules enforcement with no server-side arbiter: a critical,
 * launch-blocking security risk for a minors-facing app.
 *
 * This guard freezes the ceiling while EPIC-0006 drains the existing direct-
 * access sites to zero: it FAILS any commit that introduces a NEW direct
 * backend-service reference in shipped client code, tolerating the known-and-
 * shrinking baseline. The set may only SHRINK. When
 * `scripts/direct-backend-baseline.json` is empty in every category, the
 * migration is provably complete.
 *
 * Scope — shipped CLIENT production code only:
 *   app/src/main/**            (Android app)
 *   shared/src/commonMain/**   (KMP shared)
 *   shared/src/androidMain/**  (Android actuals)
 *   shared/src/iosMain/**      (iOS actuals)
 *   public/**                  (web)
 * NEVER scanned: express-api/** (the sanctioned server Admin SDK channel);
 * ALL test source sets (a test hitting the real emulator is the no-mocks REAL
 * path, not a shipped-client violation); generated build output.
 *
 * BOTH SDK namespaces are matched or half the violations pass: Android native
 * `com.google.firebase.{firestore,database,storage}` AND iOS/KMP
 * `dev.gitlive.firebase.{firestore,database,storage}`, plus web data usage.
 * Firebase Auth is deliberately NOT matched — auth-plane token minting is a
 * separate operator ruling (EPIC-0006), not a data-plane violation.
 *
 * Two failure directions (the ratchet only tightens):
 *   - NEW   — a client file references a backend SDK but is NOT in the baseline
 *             → route it through an Express API endpoint.
 *   - STALE — a baseline path no longer offends → a migration removed the
 *             access but forgot to shrink the baseline; run --generate-baseline.
 *
 * Read-only static scan over git-tracked files; never executes scanned code;
 * `git ls-files` is spawned without a shell.
 *
 * Exit codes:
 *   0  clean (offenders == baseline) | --generate-baseline ok | --help
 *   1  ratchet violated (new offenders and/or stale baseline entries)
 *   2  usage error / missing or malformed baseline
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASELINE_REL = 'scripts/direct-backend-baseline.json';
const SCRIPT_REL = 'scripts/check-no-direct-backend.js';

const KT_EXT = new Set(['.kt']);
const WEB_EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.htm']);
const isKt = (rel) => KT_EXT.has(path.extname(rel));
const isWeb = (rel) => WEB_EXT.has(path.extname(rel));

// Category definitions. `regex` is content detection; `applies` gates which
// file types a category can bucket (so a .kt comment mentioning getFirestore is
// not miscounted as web, and vice-versa). Each Kotlin category matches BOTH the
// Android-native and the iOS-gitlive namespace — the risk is duplicated
// per-platform, so an Android-only match would miss half of it.
const CATEGORIES = [
  {
    key: 'firestore',
    label: 'Firestore SDK (direct)',
    regex:
      /(com\.google\.firebase\.firestore|dev\.gitlive\.firebase\.firestore)/,
    applies: isKt,
  },
  {
    key: 'rtdb',
    label: 'Realtime Database SDK (direct)',
    regex: /(com\.google\.firebase\.database|dev\.gitlive\.firebase\.database)/,
    applies: isKt,
  },
  {
    key: 'storage',
    label: 'Storage SDK (direct)',
    regex: /(com\.google\.firebase\.storage|dev\.gitlive\.firebase\.storage)/,
    applies: isKt,
  },
  {
    // Web data-plane, THREE signals (recall over precision — a security
    // ratchet must not MISS a real call):
    //   1. A modular import from a firebase data module — `from '…firebase[-/]
    //      {firestore,database,storage}…'` (matches both `firebase/firestore`
    //      and the gstatic `…/firebase-firestore.js` CDN form).
    //   2. Compat calls — `firebase.{firestore,database,storage}(`.
    //   3. Modular SDK calls — the entry points `get{Firestore,Database,
    //      Storage}(` AND the read/write ops `onSnapshot/onValue/getDocs/getDoc/
    //      addDoc/setDoc/updateDoc/deleteDoc(`. NO `\b` left-anchor: `_` is a
    //      word char, so `\b` wrongly excluded the DI-renamed accessors this
    //      codebase actually uses (`_onSnapshot(`, `_getDocs(` in the admin
    //      tabs). The call-paren (`\s*\(`) is what gives precision — a bare
    //      mention or a `= null` declaration has no paren, so it still won't hit.
    // Deliberately excludes firebase.auth()/getAuth( — Auth is an operator
    // ruling, not a data-plane violation.
    key: 'webData',
    label: 'web Firebase data access (direct)',
    regex:
      /from\s*['"][^'"]*firebase[-/](firestore|database|storage)|firebase\.(firestore|database|storage)\s*\(|(getFirestore|getDatabase|getStorage|onSnapshot|onValue|getDocs|getDoc|addDoc|setDoc|updateDoc|deleteDoc)\s*\(/,
    applies: isWeb,
  },
];

const EMPTY = () => Object.fromEntries(CATEGORIES.map((c) => [c.key, []]));

// ── Scope: shipped client production code only (include-list) ────────────────
// An include-list (not an exclude-list) so a new source set defaults to
// UNSCANNED-safe only if it is genuinely not shipped client code — anything
// added under these roots is caught. express-api/**, every test source set,
// and generated build output fall outside these roots and are never scanned.
const KT_CLIENT_ROOT =
  /^(app\/src\/main\/|shared\/src\/(commonMain|androidMain|iosMain)\/)/;
const WEB_CLIENT_ROOT = /^public\//;

function isClientProductionCode(rel) {
  const p = rel.split(path.sep).join('/');
  if (isKt(p)) return KT_CLIENT_ROOT.test(p);
  if (isWeb(p)) return WEB_CLIENT_ROOT.test(p);
  return false;
}

/** Pure content detection — which categories the text contains. */
function classifyContent(content) {
  const out = {};
  for (const cat of CATEGORIES) out[cat.key] = cat.regex.test(content);
  return out;
}

/**
 * Bucket repo-relative paths into offender categories. Extension gating is via
 * cat.applies; path scoping (client-production-only) is the caller's job
 * (scanRepo), so this stays a pure list→buckets function for testing.
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
  for (const cat of CATEGORIES)
    offenders[cat.key] = [...new Set(offenders[cat.key])].sort();
  return offenders;
}

/** Git-tracked files (repo-relative). No shell → no injection class. */
function gitTrackedFiles(cwd) {
  const res = spawnSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(
      `git ls-files failed: ${res.stderr || res.error || 'unknown error'}`,
    );
  }
  return res.stdout.split('\0').filter(Boolean);
}

/** Scan the real repo at `cwd`, restricted to shipped client production code. */
function scanRepo({ cwd } = {}) {
  const root = cwd || process.cwd();
  const files = gitTrackedFiles(root).filter(isClientProductionCode);
  return scanFiles(files, (rel) =>
    fs.readFileSync(path.join(root, rel), 'utf8'),
  );
}

function loadBaseline({ cwd } = {}) {
  const root = cwd || process.cwd();
  const file = path.join(root, BASELINE_REL);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(
      `Baseline not found at ${BASELINE_REL} — run \`node ${SCRIPT_REL} --generate-baseline\`.`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Baseline ${BASELINE_REL} is malformed JSON: ${e.message}`);
  }
  const base = EMPTY();
  for (const cat of CATEGORIES) {
    if (parsed[cat.key] && !Array.isArray(parsed[cat.key])) {
      throw new Error(
        `Baseline ${BASELINE_REL} category "${cat.key}" must be an array.`,
      );
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
    (cat) =>
      diff.newOffenders[cat.key].length === 0 &&
      diff.staleEntries[cat.key].length === 0,
  );
}

function generateBaseline({ cwd } = {}) {
  const root = cwd || process.cwd();
  const offenders = scanRepo({ cwd: root });
  const ordered = {};
  for (const cat of CATEGORIES) ordered[cat.key] = offenders[cat.key];
  fs.writeFileSync(
    path.join(root, BASELINE_REL),
    `${JSON.stringify(ordered, null, 2)}\n`,
  );
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
    const total = CATEGORIES.reduce((n, c) => n + baseline[c.key].length, 0);
    const sizes = CATEGORIES.map(
      (c) => `${c.label}=${baseline[c.key].length}`,
    ).join(', ');
    out(
      `✓ no-direct-backend: clean. Remaining direct-access debt (${total}) — ${sizes}.`,
    );
    return 0;
  }
  err(
    '::error::no-direct-backend ratchet violated — clients must go through the Express API (feedback-no-direct-backend-all-via-api, EPIC-0006). Direct backend access may only SHRINK.',
  );
  for (const cat of CATEGORIES) {
    for (const f of diff.newOffenders[cat.key]) {
      err(
        `::error file=${f}::NEW ${cat.label} in client code — route this through an authz'd Express API endpoint (CLAUDE.md § API-only backend access). NEVER touch Firestore/RTDB/Storage directly from a client.`,
      );
    }
    for (const f of diff.staleEntries[cat.key]) {
      err(
        `::error file=${f}::STALE baseline entry — this file no longer has ${cat.label}; remove it from ${BASELINE_REL} (run --generate-baseline). The ratchet only tightens.`,
      );
    }
  }
  const newCount = CATEGORIES.reduce(
    (n, c) => n + diff.newOffenders[c.key].length,
    0,
  );
  const staleCount = CATEGORIES.reduce(
    (n, c) => n + diff.staleEntries[c.key].length,
    0,
  );
  err(
    `no-direct-backend: ${newCount} new offender(s), ${staleCount} stale baseline entr(ies).`,
  );
  return 1;
}

const HELP = `check-no-direct-backend.js — EPIC-0006 API-only-backend ratchet guard

Usage:
  node scripts/check-no-direct-backend.js                    # verify: fail on any new/stale direct backend access
  node scripts/check-no-direct-backend.js --generate-baseline  # (re)write ${BASELINE_REL}
  node scripts/check-no-direct-backend.js --help

Bans (ratchet, may only shrink) in shipped CLIENT code
  (app/src/main · shared/src/{commonMain,androidMain,iosMain} · public):
    com.google.firebase.{firestore,database,storage}   (Android native)
    dev.gitlive.firebase.{firestore,database,storage}  (iOS / KMP)
    web getFirestore()/onSnapshot()/firebase.{firestore,database,storage}()
  NEVER scanned: express-api/** (sanctioned Admin SDK) · all test source sets · build output.
  NOT matched: Firebase Auth (auth-plane token minting — separate operator ruling).
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
      const total = CATEGORIES.reduce((n, c) => n + off[c.key].length, 0);
      const sizes = CATEGORIES.map(
        (c) => `${c.label}=${off[c.key].length}`,
      ).join(', ');
      out(`✓ wrote ${BASELINE_REL} — ${total} file(s): ${sizes}.`);
      return 0;
    }
    const offenders = scanRepo({ cwd });
    const baseline = loadBaseline({ cwd });
    return reportAndExit(diffBaseline(offenders, baseline), baseline);
  } catch (e) {
    err(`::error::no-direct-backend guard error: ${e.message}`);
    return 2;
  }
}

module.exports = {
  classifyContent,
  isClientProductionCode,
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
