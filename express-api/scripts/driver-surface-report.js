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
const HELPER_FILES = new Set([
  'android-cdp-helpers.js',
  'ios-driver-loader.js',
  'driver-screenshot-helper.js',
]);

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

function formatUsage() {
  return [
    'driver-surface-report — survey driver method-counts across the matrix',
    '',
    'Usage:',
    '  node express-api/scripts/driver-surface-report.js [flags]',
    '',
    'Flags:',
    '  --json       Emit JSON (array of {name, count, methods})',
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
};

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`driver-surface-report failed: ${e.message}`);
    process.exit(1);
  }
}
