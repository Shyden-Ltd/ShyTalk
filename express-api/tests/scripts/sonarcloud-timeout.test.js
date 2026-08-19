'use strict';

/**
 * sonarcloud-timeout.test.js — SHY-0355
 *
 * The SonarCloud job set `timeout-minutes: 15`. Under load it routinely took
 * LONGER, so GitHub cancelled it — and `PR Gate` treats `cancelled` as
 * `failure`. The pull request then showed every check passing, including
 * SonarCloud's own external `SonarCloud Code Analysis` result, while the gate
 * was red.
 *
 * Measured on PR #1812, both cancelled within twenty seconds of the ceiling:
 *   run 32210369314 — 03:45:16Z → 04:00:34Z = 15m18s
 *   run 32218316687 — 05:26:41Z → 05:41:44Z = 15m03s
 * A SUCCESSFUL run of the same job on the same PR took 9m37s.
 *
 * Same shape as SHY-0329 on the driver-checks job, and this test is modelled on
 * that one: read the REAL workflow file, so it cannot drift from what CI runs.
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const WORKFLOW = join(__dirname, '..', '..', '..', '.github', 'workflows', 'sonarcloud.yml');
const source = () => readFileSync(WORKFLOW, 'utf8');

/**
 * Observed cost of a SUCCESSFUL SonarCloud analysis, rounded up from the 9m37s
 * measured on PR #1812.
 *
 * Named rather than inlined so the assertion states WHY the budget must be what
 * it is. An analysis that outgrows the headroom fails here, on a developer's
 * machine, rather than as a cancelled job on somebody's pull request.
 */
const MEASURED_COST_MINUTES = 10;

/** Headroom over the measured cost. The 15m budget allowed ~5m and was not enough. */
const REQUIRED_HEADROOM_MINUTES = 10;

/** The `timeout-minutes` declared on the `sonarcloud` job, as a number. */
function declaredTimeoutMinutes() {
  // Anchor on the job so a timeout declared elsewhere in the file cannot satisfy this.
  const job = source().split(/^\s{2}sonarcloud:\s*$/m)[1];
  if (!job) throw new Error('sonarcloud job not found in the workflow');
  const m = job.match(/^\s*timeout-minutes:\s*(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

describe('SHY-0355 — the SonarCloud job has time to finish', () => {
  test('the SonarCloud job declares a timeout', () => {
    // A missing budget is its own hazard: a hung analysis would run to the
    // workflow-level maximum before anyone noticed.
    expect(declaredTimeoutMinutes()).toEqual(expect.any(Number));
  });

  test('the budget exceeds the measured cost with headroom', () => {
    // THE DEFECT, in one assertion. At 15 this fails: 10 + 10 = 20 > 15.
    expect(declaredTimeoutMinutes()).toBeGreaterThanOrEqual(
      MEASURED_COST_MINUTES + REQUIRED_HEADROOM_MINUTES,
    );
  });

  test('the budget is explained in the workflow, not left as a bare number', () => {
    // So the next person to touch it knows what it is protecting, rather than
    // trimming it back to "something that looks reasonable".
    const job = source().split(/^\s{2}sonarcloud:\s*$/m)[1];
    expect(job).toMatch(/SHY-0355/);
  });
});
