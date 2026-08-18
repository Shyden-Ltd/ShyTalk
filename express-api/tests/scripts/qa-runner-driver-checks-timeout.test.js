'use strict';

/**
 * qa-runner-driver-checks-timeout.test.js — SHY-0329
 *
 * The driver-checks job sets a job-level `timeout-minutes`. When the Playwright
 * cache MISSES, `npx playwright install --with-deps chromium firefox webkit`
 * costs ~10 minutes on its own — so a budget of 10 cancelled the job
 * deterministically, skipping the contract test and both diagnostics it exists
 * to run, and failing `PR Gate` (which treats `cancelled` as `failure`).
 *
 * Measured on PR #1781, job 95539346116: cache step 1s (a miss — a hit spends
 * time restoring ~1 GB), install 9m53s, cancelled at 10m16s.
 *
 * Reads the real workflow file, so it cannot drift from what CI actually runs.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW = path.join(__dirname, '../../../.github/workflows/qa-runner-driver-checks.yml');

/**
 * Observed cost of a COLD `playwright install --with-deps` of three engines,
 * rounded up from the 9m53s measured on PR #1781.
 *
 * Named rather than inlined so the assertion below states WHY the budget must
 * be what it is. A future step that outgrows the headroom fails here, on a
 * developer's machine, rather than as a cancelled job on someone's PR.
 */
const COLD_PLAYWRIGHT_INSTALL_MINUTES = 10;

/** The job's own work after the install: contract test + 2 diagnostics. */
const JOB_STEPS_HEADROOM_MINUTES = 8;

function workflowSource() {
  return fs.readFileSync(WORKFLOW, 'utf8');
}

function declaredTimeoutMinutes(src) {
  const m = src.match(/^\s*timeout-minutes:\s*(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

describe('qa-runner-driver-checks job budget (SHY-0329)', () => {
  test('the driver-checks job declares a timeout at all', () => {
    // A job with no ceiling would hang for the runner's 6-hour default rather
    // than failing usefully. The fix is a bigger budget, not no budget.
    expect(declaredTimeoutMinutes(workflowSource())).toEqual(expect.any(Number));
  });

  test('the budget exceeds a cold Playwright install plus the job’s own steps', () => {
    // The defect, in one assertion. At 10 minutes the install alone consumed
    // the entire budget and the job was cancelled 23 seconds after it finished.
    const declared = declaredTimeoutMinutes(workflowSource());
    expect(declared).toBeGreaterThan(COLD_PLAYWRIGHT_INSTALL_MINUTES + JOB_STEPS_HEADROOM_MINUTES);
  });

  test('the browser set still covers all three desktop engines --check-drivers asserts on', () => {
    // Trimming the install would fit the old budget but silently narrow the
    // diagnostic: --check-drivers expects chromium, firefox AND webkit to
    // report 'ok' on ubuntu. The budget was wrong, not the browser set.
    // Anchor on the `run:` DIRECTIVE, not on the substring "playwright
    // install" — which prose can contain, and does: the comment explaining
    // this job's budget mentions the install command by name, and an earlier
    // draft of this test matched that comment instead of the command. Same
    // trap SHY-0328's pinning test documents ("the FORCING assignment, not a
    // mention in a comment"): documenting a change must not break the test
    // that guards it.
    const src = workflowSource();
    const install = src
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('run:') && l.includes('playwright install'));
    expect(install).toBeDefined();
    for (const engine of ['chromium', 'firefox', 'webkit']) {
      expect(install).toContain(engine);
    }
    // --with-deps pulls the apt packages headless WebKit needs; without it
    // WebKit fails to launch rather than reporting a clean 'fail'.
    expect(install).toContain('--with-deps');
  });
});
