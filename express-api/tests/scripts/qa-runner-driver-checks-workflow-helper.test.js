'use strict';

/**
 * qa-runner-driver-checks-workflow-helper.test.js — SHY-0329
 *
 * Direct tests for the workflow readers. They exist because the readers are
 * what every bracket assertion depends on: if `declaredTimeoutMinutes` returns
 * the wrong number, or null, the floor and ceiling tests go red (or worse,
 * green) for reasons that have nothing to do with the budget.
 *
 * Driven with synthetic sources rather than the real file, so the failure modes
 * can be exercised on demand. `jest.config.js` collects coverage only from
 * `src/**`, so a test helper's branches are invisible to any coverage gate —
 * these are the only backstop it has.
 */

const {
  driverChecksJobSection,
  declaredTimeoutMinutes,
  runLineContaining,
  workflowSource,
} = require('../_helpers/qa-runner-driver-checks-workflow');

const REAL_JOB = `name: whatever

jobs:
  driver-checks:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium firefox webkit
`;

describe('declaredTimeoutMinutes', () => {
  test('reads the job-level budget', () => {
    expect(declaredTimeoutMinutes(REAL_JOB)).toBe(25);
  });

  test('tolerates a trailing comment on the same line', () => {
    // Demonstrated fragility of the previous regex: its `\s*$` anchor could not
    // pass a `#`, so `timeout-minutes: 25  # note` returned NULL and reddened
    // every bracket test — for an edit that changes nothing about the budget.
    const src = REAL_JOB.replace(
      'timeout-minutes: 25',
      'timeout-minutes: 25  # raised by SHY-0329',
    );
    expect(declaredTimeoutMinutes(src)).toBe(25);
  });

  test('returns null when the job declares no timeout at all', () => {
    // The branch no standing test reached before. A silent null is worse than a
    // wrong number, because "declares a timeout at all" is what catches it.
    const src = REAL_JOB.replace('    timeout-minutes: 25\n', '');
    expect(declaredTimeoutMinutes(src)).toBeNull();
  });

  test('returns null when the driver-checks job is absent entirely', () => {
    expect(declaredTimeoutMinutes('jobs:\n  something-else:\n    timeout-minutes: 5\n')).toBeNull();
  });

  test('reads THIS job’s budget, not an earlier job’s', () => {
    // The unscoped regex returned the FIRST match in the file, so a job added
    // above driver-checks would silently hijack every assertion with no test
    // failing to announce it.
    const src = `jobs:
  something-else:
    timeout-minutes: 5
  driver-checks:
    timeout-minutes: 25
`;
    expect(declaredTimeoutMinutes(src)).toBe(25);
  });

  test('ignores a STEP-level timeout inside the job', () => {
    // A step budget is not the job budget; conflating them would let a job with
    // no ceiling pass because one of its steps had one.
    const src = `jobs:
  driver-checks:
    runs-on: ubuntu-latest
    steps:
      - name: A step with its own budget
        timeout-minutes: 3
        run: echo hi
`;
    expect(declaredTimeoutMinutes(src)).toBeNull();
  });
});

describe('driverChecksJobSection', () => {
  test('stops at the next top-level job key', () => {
    const src = `jobs:
  driver-checks:
    timeout-minutes: 25
  later-job:
    timeout-minutes: 99
`;
    const section = driverChecksJobSection(src);
    expect(section).toContain('timeout-minutes: 25');
    expect(section).not.toContain('99');
  });

  test('returns empty string when the job is missing', () => {
    expect(driverChecksJobSection('jobs:\n  other:\n')).toBe('');
  });
});

describe('runLineContaining', () => {
  test('finds the run: directive', () => {
    expect(runLineContaining(REAL_JOB, 'playwright install')).toContain('--with-deps');
  });

  test('does NOT match a comment that merely mentions the command', () => {
    // The exact bug this helper exists to prevent: an earlier draft matched the
    // comment explaining the fix instead of the command being asserted on.
    const src = `jobs:
  driver-checks:
    steps:
      - name: Install
        # a cold npx playwright install of three engines costs ~10 minutes
        run: echo not-the-install
`;
    expect(runLineContaining(src, 'playwright install')).toBeUndefined();
  });
});

describe('the real workflow file', () => {
  test('is readable and contains the driver-checks job', () => {
    // Guards the path itself: a repo reorganisation that moves the workflow
    // would otherwise make every bracket test fail with a confusing ENOENT.
    expect(driverChecksJobSection(workflowSource())).toContain('timeout-minutes:');
  });
});
