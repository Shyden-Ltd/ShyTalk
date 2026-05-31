#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * qa-html-report.js
 *
 * Convert a matrix-report JSON file (produced by `manual-qa-runner.js`
 * with `--report-format json --report-output PATH`) into a single
 * self-contained HTML file with inline CSS. Closes gap C1 from the
 * QA-runner framework tracker — "HTML report aggregation across cells".
 *
 * Standalone tool — no runner integration, no external CSS, no
 * JS dependencies. The output is one .html file the operator can
 * open in any browser or attach to a PR / Slack thread.
 *
 * Usage:
 *   node express-api/scripts/qa-html-report.js report.json > report.html
 *   node express-api/scripts/qa-html-report.js report.json -o report.html
 *   node express-api/scripts/qa-html-report.js --help
 *
 * Design: keep it small and inert. No external links (CSS or analytics),
 * no remote fonts (system stack), no JS (operators paste into Slack as
 * attachments and unfurl previews matter). HTML escaping is mandatory
 * for cell.error and cell.browser since they can contain `<`/`>` and
 * pre-rendered content goes into a markdown/Slack context.
 */

const fs = require('fs');

const OUTCOME_COLOR = {
  pass: '#1f7a1f',
  fail: '#b22222',
  timeout: '#b86a00',
  skip: '#666666',
};
const OUTCOME_BG = {
  pass: '#e6f4e6',
  fail: '#fce4e4',
  timeout: '#fdefd9',
  skip: '#eeeeee',
};

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRow(cell) {
  const outcome = cell.outcome || 'unknown';
  const color = OUTCOME_COLOR[outcome] || '#444';
  const bg = OUTCOME_BG[outcome] || '#f8f8f8';
  const errorCell = cell.error
    ? `<td class="err">${escHtml(cell.error)}</td>`
    : '<td class="err"></td>';
  return (
    `<tr style="background:${bg}">` +
    `<td class="browser">${escHtml(cell.browser)}</td>` +
    `<td class="outcome" style="color:${color};font-weight:bold;">${escHtml(outcome)}</td>` +
    `<td class="duration">${Number.isFinite(cell.durationMs) ? cell.durationMs : 0}ms</td>` +
    `${errorCell}` +
    `</tr>`
  );
}

function renderHtml(report, { title = 'QA Matrix Report' } = {}) {
  const cells = Array.isArray(report.cells) ? report.cells : [];
  const totals = report.totals || { pass: 0, fail: 0, skip: 0, timeout: 0 };
  const summary = report.summary || '';
  const ok = Boolean(report.ok);

  const rows = cells.map(renderRow).join('\n');
  const statusBadge = ok
    ? `<span class="badge badge-ok">PASS</span>`
    : `<span class="badge badge-fail">FAIL</span>`;

  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${escHtml(title)}</title>`,
    `<style>`,
    `body { font-family: -apple-system, system-ui, sans-serif; max-width: 900px; margin: 2em auto; padding: 0 1em; color: #222; }`,
    `h1 { font-size: 1.5em; margin: 0 0 0.5em; }`,
    `.subtitle { color: #666; margin: 0 0 1em; }`,
    `.badge { display: inline-block; padding: 0.2em 0.6em; border-radius: 3px; font-size: 0.85em; font-weight: bold; vertical-align: middle; }`,
    `.badge-ok { background: #1f7a1f; color: #fff; }`,
    `.badge-fail { background: #b22222; color: #fff; }`,
    `table { width: 100%; border-collapse: collapse; margin-top: 1em; font-size: 0.95em; }`,
    `th, td { text-align: left; padding: 0.45em 0.6em; border-bottom: 1px solid #ddd; }`,
    `th { background: #f0f0f0; font-weight: 600; }`,
    `td.browser { font-family: ui-monospace, Menlo, monospace; }`,
    `td.duration { text-align: right; font-variant-numeric: tabular-nums; color: #555; }`,
    `td.err { font-family: ui-monospace, Menlo, monospace; font-size: 0.85em; color: #b22222; max-width: 360px; word-break: break-word; }`,
    `.totals { margin-top: 1em; font-size: 0.9em; color: #555; }`,
    `</style>`,
    `</head>`,
    `<body>`,
    `<h1>${escHtml(title)} ${statusBadge}</h1>`,
    `<p class="subtitle">${escHtml(summary)}</p>`,
    `<table>`,
    `<thead><tr><th>Browser</th><th>Outcome</th><th>Duration</th><th>Error</th></tr></thead>`,
    `<tbody>`,
    rows,
    `</tbody>`,
    `</table>`,
    `<p class="totals">Totals: ${totals.pass} pass / ${totals.fail} fail / ${totals.skip} skip / ${totals.timeout} timeout</p>`,
    `</body>`,
    `</html>`,
  ].join('\n');
}

function formatUsage() {
  return [
    'qa-html-report — convert a matrix-report JSON to self-contained HTML',
    '',
    'Usage:',
    '  node express-api/scripts/qa-html-report.js <report.json>           # HTML to stdout',
    '  node express-api/scripts/qa-html-report.js <report.json> -o out.html',
    '  node express-api/scripts/qa-html-report.js --help',
    '',
    'Output is a single self-contained .html file (inline CSS, no external',
    'fonts/scripts) safe to attach to Slack or paste into a PR description.',
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

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(formatUsage());
    process.exit(args.length === 0 ? 2 : 0);
  }
  let outputPath = null;
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--output') {
      outputPath = args[++i];
    } else if (!args[i].startsWith('-')) {
      positional.push(args[i]);
    }
  }
  if (positional.length !== 1) {
    console.error('Expected exactly one positional arg: <report.json>');
    process.exit(2);
  }
  const report = readReport(positional[0]);
  const html = renderHtml(report);
  if (outputPath) {
    fs.writeFileSync(outputPath, html);
  } else {
    process.stdout.write(html + '\n');
  }
  process.exit(0);
}

module.exports = {
  escHtml,
  renderRow,
  renderHtml,
  formatUsage,
  readReport,
};

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`qa-html-report failed: ${e.message}`);
    process.exit(1);
  }
}
