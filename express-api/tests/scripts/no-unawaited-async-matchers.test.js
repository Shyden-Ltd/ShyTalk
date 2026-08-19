/**
 * SHY-0365 — no `expect(...).rejects` / `.resolves` without `await`.
 *
 * An un-awaited async matcher settles AFTER the test has already ended, so:
 *   - when it would pass, nothing is asserted and the test is vacuously green;
 *   - when it would FAIL, the rejection escapes the test lifecycle and kills the
 *     Jest worker ("child process exceptions, exceeding retry limit") instead of
 *     reporting a named failure.
 *
 * Both halves were reproduced on the real defect at
 * `tests/utils/email-local.test.js:47` before this guard was written:
 *   no await + wrong expectation -> worker crash, "Tests: 0 total"
 *   await    + wrong expectation -> clean "1 failed, 3 passed"
 *
 * Real-only: this reads the actual test corpus off disk. No mocks.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Test trees that are allowed to contain async matchers at all. */
const SCAN_DIRS = ['express-api/tests', 'express-api/src', 'tests'];
const FILE_RE = /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs)$/;

/** How far back to look for the `expect(` that owns a `.rejects` / `.resolves`. */
const LOOKBACK_LINES = 8;

/**
 * This guard is excluded from its own scan. Any guard that greps source for a
 * pattern necessarily contains that pattern — in its doc comment and in its own
 * test names — and would otherwise report itself forever.
 */
const SELF = path.join(REPO_ROOT, 'express-api/tests/scripts/no-unawaited-async-matchers.test.js');

/** A line that only mentions the pattern in prose is not a call site. */
const COMMENT_RE = /^\s*(\/\/|\/\*|\*)/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (FILE_RE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * An async matcher is handled when the statement that owns it is awaited,
 * returned, or captured in a binding (the fake-timer pattern:
 * `const assertion = expect(p).rejects...; await advanceTimers(); await assertion;`).
 */
const HANDLED_RE = /(await\s|return\s|=\s*$|=\s*expect\()/;

function findOffenders(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const offenders = [];
  lines.forEach((line, i) => {
    if (!/\.(rejects|resolves)\b/.test(line)) return;
    if (COMMENT_RE.test(line)) return;
    // Walk back to the line that opens this assertion.
    for (let j = i; j >= Math.max(0, i - LOOKBACK_LINES); j--) {
      if (!lines[j].includes('expect(')) continue;
      if (COMMENT_RE.test(lines[j])) return;
      const upToExpect = lines[j].slice(0, lines[j].indexOf('expect('));
      if (!HANDLED_RE.test(upToExpect)) {
        offenders.push(`${path.relative(REPO_ROOT, file)}:${j + 1}: ${lines[j].trim()}`);
      }
      return;
    }
  });
  return offenders;
}

describe('SHY-0365 async matchers are awaited', () => {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(REPO_ROOT, d))).filter((f) => f !== SELF);

  test('the corpus being scanned is non-empty (the guard is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  test('at least one file actually uses an async matcher (the pattern is scanned for)', () => {
    const withMatchers = files.filter((f) =>
      /\.(rejects|resolves)\b/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(withMatchers.length).toBeGreaterThan(0);
  });

  test('no `expect(...).rejects` or `.resolves` is left un-awaited', () => {
    expect(files.flatMap(findOffenders)).toEqual([]);
  });
});
