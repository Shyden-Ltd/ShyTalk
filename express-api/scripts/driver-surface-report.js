#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * driver-surface-report.js
 *
 * Survey tool — surfaces method-count divergences across the
 * 12-cell matrix's drivers. Closes gap B5 from the QA-runner
 * framework tracker ("Wide-divergent method counts. Investigation
 * needed.") by giving operators a quick read on which drivers
 * implement how many step-binding methods.
 *
 * Pure read-only tool — no env vars required, no runtime side effects
 * beyond stdout. Loads each driver fresh (cleared from require-cache)
 * with all credential envs stripped, just like the contract test does.
 *
 * Usage:
 *   node express-api/scripts/driver-surface-report.js              # table
 *   node express-api/scripts/driver-surface-report.js --json       # JSON
 *   node express-api/scripts/driver-surface-report.js --help       # usage
 *
 * The table form is operator-friendly (sorted by method count,
 * widest column auto-fit). The JSON form is pipeable to jq for
 * regression detection: e.g. compare two runs to spot driver-surface
 * additions/removals between releases.
 */

const fs = require('fs');
const path = require('path');

const DRIVERS_DIR = path.join(__dirname, 'drivers');
const RUNNER_FILE = path.join(__dirname, 'manual-qa-runner.js');
const HELPER_FILES = new Set([
  'android-cdp-helpers.js',
  'ios-driver-loader.js',
  'driver-screenshot-helper.js',
]);

/**
 * The drivers the twelve matrix cells actually construct, and what each is
 * accountable for.
 *
 * `ios-devicectl-driver` / `ios-simctl-driver` are deliberately absent: the
 * loader picks Appium whenever WDA_TEAM_ID is set, which is the only
 * configuration a real iPhone runs under. Holding a fallback driver to the
 * full surface would inflate the gap count with work no cell ever executes.
 *
 * `platforms` lists the method-name prefixes the driver is answerable for.
 * An Android driver asked for `iosTap` is a routing bug, not a driver gap, so
 * the prefixes are what make this measurement meaningful rather than a naive
 * union — the union claimed 47 missing on android-adb, where the honest number
 * is zero.
 */
const MATRIX_DRIVERS = [
  { file: 'android-adb-driver.js', namespace: 'uiDriver', platforms: ['android'] },
  { file: 'ios-appium-driver.js', namespace: 'uiDriver', platforms: ['ios'] },
  { file: 'web-playwright-driver.js', namespace: 'webDriver', platforms: ['web'] },
  { file: 'web-mobile-chrome-android-driver.js', namespace: 'webDriver', platforms: ['web'] },
  { file: 'web-mobile-samsung-android-driver.js', namespace: 'webDriver', platforms: ['web'] },
  { file: 'web-mobile-edge-android-driver.js', namespace: 'webDriver', platforms: ['web'] },
  { file: 'web-mobile-firefox-android-driver.js', namespace: 'webDriver', platforms: ['web'] },
  { file: 'web-mobile-safari-ios-driver.js', namespace: 'webDriver', platforms: ['web'] },
  { file: 'web-mobile-webkit-ios-driver.js', namespace: 'webDriver', platforms: ['web'] },
];

/** Which platform a method name is for, from its prefix. */
function platformOf(name) {
  if (/^android[A-Z]/.test(name)) return 'android';
  if (/^ios[A-Z]/.test(name)) return 'ios';
  if (/^web[A-Z]/.test(name)) return 'web';
  return null; // unprefixed — every driver in the namespace must carry it
}

/**
 * Every driver method the runner can demand, grouped by ctx namespace.
 *
 * Read from the runner's own source because the runner IS the consumer: the
 * `ctx.<driver>.<name> not configured` strings it raises are the exact set of
 * names a cell can be asked for at runtime.
 */
function referencedMethods(runnerSrc = fs.readFileSync(RUNNER_FILE, 'utf8')) {
  const byNamespace = {};
  // COMMENTS ARE NOT REFERENCES. A doc comment explaining that matchers "used
  // to reach for ctx.uiDriver.androidX" made the scanner demand a method called
  // `androidX` — a name no driver will ever have, reported as a coverage gap.
  // Prose about the code is not the code.
  const code = runnerSrc
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');

  for (const m of code.matchAll(/ctx\.([A-Za-z0-9_]+)\??\.([A-Za-z0-9_]+)/g)) {
    const [, ns, name] = m;
    if (!/^(uiDriver|webDriver|firebaseAdmin)$/.test(ns)) continue;
    (byNamespace[ns] = byNamespace[ns] || new Set()).add(name);
  }

  // `appMethod(ctx, 'TapUserCard')` is the platform-NEUTRAL call the matchers
  // now make so a step can run on either phone. It is satisfied by whichever
  // prefix the attached driver carries, so it is recorded under both — an
  // Android-only implementation would leave the iPhone unable to run the step,
  // which is the gap this whole report exists to surface.
  for (const m of code.matchAll(/\bappMethod\(\s*ctx\s*,\s*'([A-Za-z0-9_]+)'\s*\)/g)) {
    const set = (byNamespace.uiDriver = byNamespace.uiDriver || new Set());
    set.add(`android${m[1]}`);
    set.add(`ios${m[1]}`);
  }
  return byNamespace;
}

/**
 * The method names a driver file DEFINES.
 *
 * Definition sites only — `driver.x = …` and the mixin's `def('x', …)`.
 *
 * The previous guard asked `driverSrc.includes(name)`, which is a SUBSTRING
 * test: `webTap` passed because `webTapNamedButton` exists, and every short
 * method name was invisible to it. Twenty-six methods reached a live gauntlet
 * that way. A name mentioned in a comment satisfied it too.
 */
function definedMethods(file) {
  const src = fs.readFileSync(path.join(DRIVERS_DIR, file), 'utf8');
  const names = new Set();
  // `[ \t]*` rather than `\s*`: what precedes a definition is INDENTATION, and
  // `\s` matches newlines too, which lets the engine backtrack across the
  // whole file for a line that never matches.
  for (const m of src.matchAll(/^[ \t]*driver\.([A-Za-z0-9_]+)[ \t]*=/gm)) names.add(m[1]);
  // `\s*` between `def(` and the name is load-bearing: prettier wraps a long
  // call onto its own line, moving the name to the NEXT line. A regex that
  // required them adjacent silently lost 24 methods the moment the file was
  // reformatted — the extraction must describe the code, not its layout.
  for (const m of src.matchAll(/\bdef\(\s*'([A-Za-z0-9_]+)'/g)) names.add(m[1]);
  // A driver that attaches the shared web surface carries everything in it.
  if (src.includes('attachCommonWebMethods') && file !== 'web-common-methods.js') {
    for (const n of definedMethods('web-common-methods.js')) names.add(n);
  }
  // Same for the shared APP surface. Both device drivers register it in a loop
  // (`driver[`ios${name}`] = impl`), which no `driver.x =` scan can see — so
  // without this every shared method reads as missing on both phones.
  if (src.includes('createSharedAppMethods(')) {
    const prefix = file.startsWith('ios') ? 'ios' : 'android';
    for (const n of require('./drivers/app-ui-methods').SHARED_METHOD_NAMES) {
      names.add(`${prefix}${n}`);
    }
  }
  return names;
}

/**
 * Names a driver DECLARES but never implements.
 *
 * Three drivers wire every declared name to a stub that logs and returns
 * false. A stub RESOLVES, so the runner records the step as the product
 * failing rather than as a missing method — the single most expensive failure
 * mode this report exists to expose, because it is indistinguishable from a
 * real defect in a matrix report.
 */
function declaredButUnimplemented(file) {
  const src = fs.readFileSync(path.join(DRIVERS_DIR, file), 'utf8');
  const declared = new Set();
  for (const block of src.matchAll(
    /const\s+\w*METHOD_NAMES\s*=\s*\[([\s\S]*?)\n\](?:\.sort\(\))?;/g,
  )) {
    for (const m of block[1].matchAll(/'([A-Za-z0-9_]+)'/g)) declared.add(m[1]);
  }
  const defined = definedMethods(file);
  return [...declared].filter((n) => !defined.has(n)).sort();
}

/**
 * Per-matrix-driver coverage gaps: what the runner can ask for and this
 * driver cannot answer.
 *
 * @returns {Array<{driver: string, namespace: string, missing: string[], stubbed: string[]}>}
 */
function coverageGaps() {
  const referenced = referencedMethods();
  return MATRIX_DRIVERS.map(({ file, namespace, platforms }) => {
    const wanted = [...(referenced[namespace] || [])].filter((n) => {
      const p = platformOf(n);
      return p === null || platforms.includes(p);
    });
    const defined = definedMethods(file);
    return {
      driver: file.replace(/\.js$/, ''),
      namespace,
      missing: wanted.filter((n) => !defined.has(n)).sort(),
      stubbed: declaredButUnimplemented(file),
    };
  });
}

function discoverDrivers() {
  return fs
    .readdirSync(DRIVERS_DIR)
    .filter((f) => f.endsWith('.js') && !HELPER_FILES.has(f))
    .map((f) => ({ name: f.replace(/\.js$/, ''), full: path.join(DRIVERS_DIR, f) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build the report data structure. Pure — safe to call from tests.
 * Returns an array sorted by method count ascending (so the operator
 * sees the smallest-surface drivers first; visual outliers).
 */
function buildReport() {
  // Clear credential env vars before requiring drivers so a driver that
  // reads env at module-top doesn't pull operator credentials into the
  // process (defense-in-depth; the contract test already enforces lazy
  // env-loading, but this tool may run before that pin lands in CI).
  const saved = {};
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith('PERSONAS_') ||
      key.startsWith('FIREBASE_') ||
      key.startsWith('APPIUM_') ||
      key.startsWith('ANDROID_') ||
      key.startsWith('IOS_')
    ) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }
  try {
    return discoverDrivers().map(({ name, full }) => {
      delete require.cache[require.resolve(full)];
      const mod = require(full);
      const methods = typeof mod.listMethods === 'function' ? mod.listMethods() : [];
      return { name, count: methods.length, methods };
    });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      process.env[k] = v;
    }
  }
}

/**
 * Format the report as a human-readable table. Sorted by count desc
 * so outliers (highest + lowest) bracket the list — easy to scan.
 */
function formatTable(report) {
  const sorted = [...report].sort((a, b) => b.count - a.count);
  const nameW = Math.max(6, ...sorted.map((r) => r.name.length));
  const countW = Math.max(5, ...sorted.map((r) => String(r.count).length));
  const lines = [];
  const sep = `+${'-'.repeat(nameW + 2)}+${'-'.repeat(countW + 2)}+`;
  lines.push(sep);
  lines.push(`| ${'Driver'.padEnd(nameW)} | ${'Count'.padEnd(countW)} |`);
  lines.push(sep);
  for (const r of sorted) {
    lines.push(`| ${r.name.padEnd(nameW)} | ${String(r.count).padEnd(countW)} |`);
  }
  lines.push(sep);
  const total = sorted.reduce((acc, r) => acc + r.count, 0);
  const avg = sorted.length ? (total / sorted.length).toFixed(1) : '0.0';
  const max = sorted.length ? sorted[0].count : 0;
  const min = sorted.length ? sorted[sorted.length - 1].count : 0;
  lines.push('');
  lines.push(
    `Surface stats: ${sorted.length} drivers / ${total} total methods / avg ${avg} / min ${min} / max ${max}`,
  );
  return lines.join('\n');
}

function formatJson(report) {
  return JSON.stringify(report);
}

/** Human-readable gap report. Names every missing method — the fix list IS the output. */
function formatGaps(gaps) {
  const lines = [];
  let totalMissing = 0;
  let totalStubbed = 0;
  for (const g of gaps) {
    totalMissing += g.missing.length;
    totalStubbed += g.stubbed.length;
    const flag = g.missing.length || g.stubbed.length ? '✗' : '✓';
    lines.push(`${flag} ${g.driver} (${g.namespace})`);
    if (g.missing.length) {
      lines.push(`    missing (${g.missing.length}): ${g.missing.join(', ')}`);
    }
    if (g.stubbed.length) {
      lines.push(`    declared but stubbed (${g.stubbed.length}): ${g.stubbed.join(', ')}`);
    }
  }
  lines.push('');
  lines.push(
    `Totals: ${totalMissing} missing, ${totalStubbed} declared-but-stubbed across ${gaps.length} matrix drivers`,
  );
  return lines.join('\n');
}

function formatUsage() {
  return [
    'driver-surface-report — survey driver method-counts across the matrix',
    '',
    'Usage:',
    '  node express-api/scripts/driver-surface-report.js [flags]',
    '',
    'Flags:',
    '  --json       Emit JSON (array of {name, count, methods})',
    '  --gaps       Report, per matrix driver, the runner-referenced methods it cannot answer',
    '  --help, -h   Print this help and exit',
    '',
    'Output (default table form):',
    '  Sorted by method count descending. Footer line reports total / avg / min / max.',
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(formatUsage());
    process.exit(0);
  }
  if (args.includes('--gaps')) {
    const gaps = coverageGaps();
    if (args.includes('--json')) {
      console.log(JSON.stringify(gaps));
    } else {
      console.log(formatGaps(gaps));
    }
    // Non-zero when anything is missing, so a shell caller can gate on it
    // without parsing the output.
    process.exit(gaps.some((g) => g.missing.length || g.stubbed.length) ? 1 : 0);
  }
  const report = buildReport();
  const json = args.includes('--json');
  console.log(json ? formatJson(report) : formatTable(report));
  process.exit(0);
}

module.exports = {
  discoverDrivers,
  buildReport,
  formatTable,
  formatJson,
  formatUsage,
  formatGaps,
  MATRIX_DRIVERS,
  platformOf,
  referencedMethods,
  definedMethods,
  declaredButUnimplemented,
  coverageGaps,
};

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`driver-surface-report failed: ${e.message}`);
    process.exit(1);
  }
}
