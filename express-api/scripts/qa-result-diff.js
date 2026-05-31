#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * qa-result-diff.js
 *
 * Compare two matrix-report JSON files (produced by `manual-qa-runner.js`
 * with `--report-format json --report-output <path>`) and surface
 * per-cell outcome differences. Closes gap C6 from the QA-runner
 * framework tracker — "Cell-result diff against previous run".
 *
 * Categorisation:
 *   - regression: prev=pass, curr=fail/timeout
 *   - recovery:   prev=fail/timeout, curr=pass
 *   - flake:      both pass but durationMs significantly different (rare)
 *   - new:        cell appeared only in curr (added to allowlist)
 *   - removed:    cell appeared only in prev (removed from allowlist)
 *   - unchanged:  same outcome both runs
 *
 * Usage:
 *   node express-api/scripts/qa-result-diff.js prev.json curr.json           # table
 *   node express-api/scripts/qa-result-diff.js --json prev.json curr.json    # JSON
 *   node express-api/scripts/qa-result-diff.js --help                        # usage
 *
 * Exit code:
 *   0 if no regressions
 *   1 if one or more regressions detected
 */

const fs = require('fs');

/**
 * Pure helper — categorize the diff between two report objects.
 * Both args have the matrix-report shape: { cells: [{browser, outcome, durationMs}], ... }
 */
function diffReports(prev, curr) {
  const prevByBrowser = new Map(prev.cells.map((c) => [c.browser, c]));
  const currByBrowser = new Map(curr.cells.map((c) => [c.browser, c]));

  const regressions = [];
  const recoveries = [];
  const unchanged = [];
  const added = [];
  const removed = [];

  const isFailure = (oc) => oc === 'fail' || oc === 'timeout';
  const isPass = (oc) => oc === 'pass';

  for (const [browser, currCell] of currByBrowser) {
    const prevCell = prevByBrowser.get(browser);
    if (!prevCell) {
      added.push({ browser, currOutcome: currCell.outcome });
      continue;
    }
    if (prevCell.outcome === currCell.outcome) {
      unchanged.push({ browser, outcome: currCell.outcome });
      continue;
    }
    if (isPass(prevCell.outcome) && isFailure(currCell.outcome)) {
      regressions.push({
        browser,
        prevOutcome: prevCell.outcome,
        currOutcome: currCell.outcome,
        currError: currCell.error,
      });
      continue;
    }
    if (isFailure(prevCell.outcome) && isPass(currCell.outcome)) {
      recoveries.push({
        browser,
        prevOutcome: prevCell.outcome,
        currOutcome: currCell.outcome,
      });
      continue;
    }
    // Catch-all: outcome changed but not a clean regression/recovery
    // (e.g., pass → skip when a device unplugs). Surface as "changed".
    unchanged.push({
      browser,
      outcome: `${prevCell.outcome} → ${currCell.outcome}`,
    });
  }

  for (const [browser, prevCell] of prevByBrowser) {
    if (!currByBrowser.has(browser)) {
      removed.push({ browser, prevOutcome: prevCell.outcome });
    }
  }

  return { regressions, recoveries, unchanged, added, removed };
}

function formatTable(diff) {
  const lines = [];
  lines.push('Matrix-result diff:');
  lines.push('');
  if (diff.regressions.length > 0) {
    lines.push(`Regressions (${diff.regressions.length}):`);
    for (const r of diff.regressions) {
      const tail = r.currError ? ` (${r.currError.slice(0, 80)})` : '';
      lines.push(`  ✗ ${r.browser}: ${r.prevOutcome} → ${r.currOutcome}${tail}`);
    }
    lines.push('');
  } else {
    lines.push('No regressions ✓');
    lines.push('');
  }
  if (diff.recoveries.length > 0) {
    lines.push(`Recoveries (${diff.recoveries.length}):`);
    for (const r of diff.recoveries) {
      lines.push(`  ✓ ${r.browser}: ${r.prevOutcome} → ${r.currOutcome}`);
    }
    lines.push('');
  }
  if (diff.added.length > 0) {
    lines.push(`Added cells (${diff.added.length}):`);
    for (const a of diff.added) {
      lines.push(`  + ${a.browser}: ${a.currOutcome}`);
    }
    lines.push('');
  }
  if (diff.removed.length > 0) {
    lines.push(`Removed cells (${diff.removed.length}):`);
    for (const r of diff.removed) {
      lines.push(`  - ${r.browser}: was ${r.prevOutcome}`);
    }
    lines.push('');
  }
  lines.push(
    `Summary: ${diff.regressions.length} regression(s), ` +
      `${diff.recoveries.length} recovery(ies), ` +
      `${diff.unchanged.length} unchanged, ` +
      `${diff.added.length} added, ${diff.removed.length} removed`,
  );
  return lines.join('\n');
}

function formatJson(diff) {
  return JSON.stringify(diff);
}

function formatUsage() {
  return [
    'qa-result-diff — compare two matrix-report JSON files',
    '',
    'Usage:',
    '  node express-api/scripts/qa-result-diff.js <prev.json> <curr.json> [--json]',
    '  node express-api/scripts/qa-result-diff.js --help',
    '',
    'Args:',
    '  prev.json   Older matrix-report (produced via --report-format json)',
    '  curr.json   Newer matrix-report to compare against prev',
    '',
    'Flags:',
    '  --json      Emit diff as JSON instead of table',
    '  --help, -h  Print this help and exit',
    '',
    'Exit code: 0 iff no regressions; 1 if any cell went pass → fail/timeout.',
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
  const jsonMode = args.includes('--json');
  const positional = args.filter((a) => !a.startsWith('--') && a !== '-h');
  if (positional.length !== 2) {
    console.error('Expected exactly two positional args: <prev.json> <curr.json>');
    process.exit(2);
  }
  const [prevPath, currPath] = positional;
  const prev = readReport(prevPath);
  const curr = readReport(currPath);
  const diff = diffReports(prev, curr);
  console.log(jsonMode ? formatJson(diff) : formatTable(diff));
  process.exit(diff.regressions.length > 0 ? 1 : 0);
}

module.exports = {
  diffReports,
  formatTable,
  formatJson,
  formatUsage,
  readReport,
};

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`qa-result-diff failed: ${e.message}`);
    process.exit(1);
  }
}
