'use strict';

/**
 * Readers for `.github/workflows/qa-runner-driver-checks.yml` (SHY-0329).
 *
 * Two test files bracket that job's `timeout-minutes` — a FLOOR
 * (`qa-runner-driver-checks-timeout.test.js`, must exceed a cold Playwright
 * install) and a CEILING (`qa-runner-driver-checks-pin.test.js`, must still
 * catch a runaway job). They previously carried a byte-identical copy of the
 * same regex, which is two chances to be wrong and one to be fixed.
 *
 * Both fragilities below were demonstrated, not theorised:
 *
 *   /^\s*timeout-minutes:\s*(\d+)\s*$/m
 *     'timeout-minutes: 25'            -> 25
 *     'timeout-minutes: 25  # note'    -> NULL   <- a cosmetic edit reds 3 tests
 *     two jobs, 5 then 25              -> 5      <- silently the WRONG job
 *
 * So: scope to the job before matching, and end on a word boundary rather than
 * end-of-line so a trailing comment is tolerated.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(
  __dirname,
  '../../../.github/workflows/qa-runner-driver-checks.yml',
);

function workflowSource() {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8');
}

/**
 * The `driver-checks:` job's own lines, ending at the next top-level job key.
 *
 * Without this, a `timeout-minutes` belonging to a second job — or to a single
 * STEP — silently satisfies an assertion written about the job. Returns '' when
 * the job is absent, so callers surface a null rather than matching stray text
 * elsewhere in the file.
 *
 * @param {string} src
 * @returns {string}
 */
function driverChecksJobSection(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /^ {2}driver-checks:\s*$/.test(l));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    // A sibling job key: exactly two spaces of indent, then a key.
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/**
 * The JOB-level `timeout-minutes`, or null when absent.
 *
 * @param {string} src  full workflow source
 * @returns {number|null}
 */
function declaredTimeoutMinutes(src) {
  // EXACTLY four spaces. A job key sits at two, so its own properties sit at
  // four; anything under `steps:` is deeper. Matching `^\s*` instead would
  // accept a STEP's budget as if it were the job's — and a job with no ceiling
  // would then pass because one of its steps happened to have one.
  const m = driverChecksJobSection(src).match(/^ {4}timeout-minutes:\s*(\d+)\b/m);
  return m ? Number(m[1]) : null;
}

/**
 * A `run:` DIRECTIVE containing `needle` — never a comment that mentions it.
 *
 * Prose can contain any substring, and does: the comment explaining this job's
 * budget names the install command, and an earlier draft matched that comment
 * instead of the command. Anchoring on `run:` means documenting a change cannot
 * break the test that guards it.
 *
 * @param {string} src
 * @param {string} needle
 * @returns {string|undefined}
 */
function runLineContaining(src, needle) {
  return src
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('run:') && l.includes(needle));
}

module.exports = {
  WORKFLOW_PATH,
  workflowSource,
  driverChecksJobSection,
  declaredTimeoutMinutes,
  runLineContaining,
};
