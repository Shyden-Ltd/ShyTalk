#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * qa-allure-emit.js
 *
 * Converts a matrix-report JSON file (produced by `manual-qa-runner.js`
 * with `--report-format json --report-output PATH`) into Allure JSON
 * result files — one file per matrix cell — written to an output
 * directory. Closes gap C2 from the QA-runner framework tracker:
 * "Allure integration".
 *
 * Standalone post-processor — no runner changes required. Mirrors the
 * shape of qa-html-report.js (PR #929) and qa-result-diff.js (PR #927).
 * The runner emits matrix JSON; this tool emits Allure JSON. Operator
 * pipelines: run --matrix --report-format json → qa-allure-emit →
 * allure CLI for HTML report generation.
 *
 * Usage:
 *   node express-api/scripts/qa-allure-emit.js report.json -o allure-results/
 *   node express-api/scripts/qa-allure-emit.js --help
 *
 * Output schema follows the Allure JSON Test Result spec
 * (https://allurereport.org/docs/data-files/#allure-results-format):
 *   - `uuid` — stable per cell (derived from browser slug + run id)
 *   - `historyId` — same as uuid for stability across runs
 *   - `name` — human-readable cell name (browser slug)
 *   - `fullName` — `qa-matrix.<browser>` for grouping
 *   - `status` — passed | failed | broken | skipped
 *   - `statusDetails` — { message } for non-passed outcomes
 *   - `start` / `stop` — millisecond epoch; if matrix JSON lacks
 *     timestamps, compute from generatedAt - sum-of-durations
 *   - `labels` — [{ name: 'suite', value: 'qa-matrix' }, { name: 'host',
 *     value: 'ci' }]
 *
 * Outcome mapping:
 *   matrix outcome | Allure status
 *   pass           | passed
 *   fail           | failed
 *   timeout        | broken     (distinguishes from assertion failures)
 *   skip           | skipped    (init-error / device missing)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUTCOME_TO_STATUS = {
  pass: 'passed',
  fail: 'failed',
  timeout: 'broken',
  skip: 'skipped',
};

function uuidFor(browser, runStartMs, cellIndex = 0) {
  // Deterministic UUID per cell-run — stable across multiple
  // emit-tool invocations on the same matrix report, but distinct
  // across runs (so Allure can build historic trend lines).
  //
  // cellIndex disambiguates duplicate browser slugs in the same
  // report. Without it, two cells for the same browser with
  // zero/NaN-duration predecessors would share startMs → collide.
  // writeAllureResults would silently overwrite the first file.
  // Reviewer-flagged 2026-05-31 (C1 collision).
  const hash = crypto
    .createHash('sha256')
    .update(`qa-matrix:${browser}:${runStartMs}:${cellIndex}`)
    .digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}

/**
 * Convert one matrix-cell result into an Allure JSON result object.
 *
 * @param {object} cell - { browser, outcome, durationMs, error?, ... }
 * @param {number} cellStartMs - epoch ms for this cell's start
 * @param {number} cellIndex - position in the cells array (for uuid disambiguation)
 * @returns {object} Allure test-result JSON
 */
function cellToAllure(cell, cellStartMs, cellIndex = 0) {
  const status = OUTCOME_TO_STATUS[cell.outcome] || 'broken';
  const durationMs = Number.isFinite(cell.durationMs) ? cell.durationMs : 0;
  const uuid = uuidFor(cell.browser, cellStartMs, cellIndex);
  const result = {
    uuid,
    historyId: uuid,
    name: String(cell.browser),
    fullName: `qa-matrix.${cell.browser}`,
    status,
    start: cellStartMs,
    stop: cellStartMs + durationMs,
    labels: [
      { name: 'suite', value: 'qa-matrix' },
      { name: 'host', value: 'ci' },
    ],
  };
  if (status !== 'passed' && cell.error) {
    result.statusDetails = { message: String(cell.error) };
  }
  return result;
}

/**
 * Pure helper — converts a matrix-report object into an array of
 * Allure result objects, one per cell. Distributes cell start times
 * by walking the cells in order from `runStartMs`, advancing by each
 * cell's duration (a reasonable approximation when the matrix JSON
 * doesn't include per-cell start timestamps).
 */
function buildAllureResults(report, { runStartMs = Date.now() } = {}) {
  if (!report || !Array.isArray(report.cells)) {
    throw new Error('input is not a matrix report (missing cells array)');
  }
  const results = [];
  let cursor = runStartMs;
  for (let i = 0; i < report.cells.length; i++) {
    const cell = report.cells[i];
    results.push(cellToAllure(cell, cursor, i));
    cursor += Number.isFinite(cell.durationMs) ? cell.durationMs : 0;
  }
  return results;
}

function formatUsage() {
  return [
    'qa-allure-emit — convert a matrix-report JSON to Allure result files',
    '',
    'Usage:',
    '  node express-api/scripts/qa-allure-emit.js <report.json> -o <dir>',
    '  node express-api/scripts/qa-allure-emit.js --help',
    '',
    'Writes one Allure test-result JSON file per matrix cell to <dir>.',
    'File names: <uuid>-result.json (Allure convention).',
    '',
    'Then run: allure generate <dir> -o allure-report',
  ].join('\n');
}

function readReport(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const obj = JSON.parse(text);
  if (!obj || !Array.isArray(obj.cells)) {
    throw new Error(`${filePath}: not a matrix report (missing cells array)`);
  }
  return obj;
}

function writeAllureResults(results, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  for (const r of results) {
    const filePath = path.join(outputDir, `${r.uuid}-result.json`);
    fs.writeFileSync(filePath, JSON.stringify(r, null, 2));
  }
  return results.length;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(formatUsage());
    process.exit(args.length === 0 ? 2 : 0);
  }
  let outputDir = null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--output') {
      outputDir = args[++i];
    } else if (!args[i].startsWith('-')) {
      positional.push(args[i]);
    }
  }
  if (positional.length !== 1) {
    console.error('Expected exactly one positional arg: <report.json>');
    process.exit(2);
  }
  if (!outputDir) {
    console.error('Required: -o <output-dir>');
    process.exit(2);
  }
  const report = readReport(positional[0]);
  const results = buildAllureResults(report);
  const count = writeAllureResults(results, outputDir);
  console.log(`Wrote ${count} Allure result file(s) to ${outputDir}`);
  process.exit(0);
}

module.exports = {
  cellToAllure,
  buildAllureResults,
  formatUsage,
  readReport,
  writeAllureResults,
  uuidFor,
  OUTCOME_TO_STATUS,
};

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`qa-allure-emit failed: ${e.message}`);
    process.exit(1);
  }
}
