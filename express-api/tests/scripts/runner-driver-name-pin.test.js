/**
 * manual-qa-runner — driver-name error-message pattern pin.
 *
 * Every handler in `scripts/manual-qa-runner.js` that dispatches across
 * Web vs uiDriver platforms via
 *
 *     const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
 *
 * must immediately also declare
 *
 *     const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
 *
 * and use `${driverName}.${methodName} not configured` (NOT the
 * hardcoded `ctx.uiDriver.${methodName} not configured`) in the
 * driver-missing error message.
 *
 * Pre-PR #815 the 89 handlers below all used the hardcoded form, which
 * pointed operators at the wrong driver object when a Web step's web
 * driver was missing — reviewer-flagged on PR #807/#809/#811/#812 but
 * deferred each time as "out of scope". This test pins the corrected
 * pattern so a future handler addition can't silently re-introduce the
 * bug.
 *
 * Implementation: source-text scan (no AST dependency). The patterns
 * are unambiguous string-equality checks against the specific 4-line
 * shape; if a future refactor reformats them, the test fails loudly
 * and the refactor must update the pin alongside.
 */

const fs = require('fs');
const path = require('path');

const RUNNER_PATH = path.resolve(__dirname, '../../scripts/manual-qa-runner.js');
let RUNNER_SRC;

const DISPATCH_LINE = "const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;";
const DRIVER_NAME_LINE =
  "const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';";
const FIXED_ERROR_TEMPLATE = '`${driverName}.${methodName} not configured`';
const BUGGY_ERROR_TEMPLATE = '`ctx.uiDriver.${methodName} not configured`';

function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

describe('manual-qa-runner — driver-name error-message pin', () => {
  beforeAll(() => {
    // Load the runner source inside beforeAll (rather than at module
    // level) so a missing/renamed file produces a named test failure
    // instead of a Jest module-load error. Matches the convention
    // used in manual-qa-runner.test.js.
    RUNNER_SRC = fs.readFileSync(RUNNER_PATH, 'utf8');
  });

  test('zero handlers retain the buggy hardcoded ctx.uiDriver template', () => {
    // The bug being pinned: `ctx.uiDriver.${methodName} not configured`
    // anywhere in the runner. Every occurrence was migrated to the
    // `${driverName}` form by PR #815. A regression would re-introduce
    // this string.
    const buggyCount = countOccurrences(RUNNER_SRC, BUGGY_ERROR_TEMPLATE);
    expect(buggyCount).toBe(0);
  });

  test('every driver-dispatch line has a matching driverName line on the next line', () => {
    // Strict adjacency check. If a future handler adds the dispatch
    // ternary but forgets the driverName companion, this fails.
    const lines = RUNNER_SRC.split('\n');
    const offendingLineNumbers = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(DISPATCH_LINE)) {
        const next = lines[i + 1] || '';
        if (!next.includes(DRIVER_NAME_LINE)) {
          offendingLineNumbers.push(i + 1);
        }
      }
    }
    expect(offendingLineNumbers).toEqual([]);
  });

  test('dispatch and driverName line counts match, and total is at least 110', () => {
    // 1:1 ratio pins the invariant: any new dispatch handler that
    // forgets driverName, or any driverName declaration orphaned from
    // its dispatch, breaks this count.
    const dispatchCount = countOccurrences(RUNNER_SRC, DISPATCH_LINE);
    const driverNameCount = countOccurrences(RUNNER_SRC, DRIVER_NAME_LINE);
    expect(dispatchCount).toBe(driverNameCount);
    // Sanity: at least the 110 handlers that existed when PR #815 landed.
    // If this drops, a handler was removed; if it grows past 110, new
    // handlers were added (expected — just update the bound).
    expect(dispatchCount).toBeGreaterThanOrEqual(110);
  });

  test('every fixed-error-template occurrence is paired with a driverName declaration in the same handler block', () => {
    // Every use of `${driverName}.${methodName} not configured` must
    // appear within ~10 lines AFTER a `const driverName = ...` line.
    // We can't easily detect handler boundaries without an AST, but
    // requiring the declaration within a small window above each
    // usage catches "error template moved to a handler that lost its
    // driverName declaration" regressions.
    const lines = RUNNER_SRC.split('\n');
    const offendingLineNumbers = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(FIXED_ERROR_TEMPLATE)) {
        const windowStart = Math.max(0, i - 10);
        const window = lines.slice(windowStart, i).join('\n');
        if (!window.includes(DRIVER_NAME_LINE)) {
          offendingLineNumbers.push(i + 1);
        }
      }
    }
    expect(offendingLineNumbers).toEqual([]);
  });

  test('fixed-error-template count matches driverName declaration count', () => {
    // Every driverName declaration exists to feed the error template.
    // A 1:1 ratio prevents both "declared but unused" (dead code) and
    // "used without declaration" (would have hit the prior test).
    const fixedCount = countOccurrences(RUNNER_SRC, FIXED_ERROR_TEMPLATE);
    const driverNameCount = countOccurrences(RUNNER_SRC, DRIVER_NAME_LINE);
    expect(fixedCount).toBe(driverNameCount);
  });
});
