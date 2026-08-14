/**
 * serverHealth.unit.test.js — EPIC-0003 / SHY-0120 slice 6 (pure-logic unit).
 *
 * `detectPm2Restarts` is the restart-delta computation extracted from
 * serverHealth's PM2 branch (operator-approved Option A). It is PURE: given a
 * parsed `pm2 jlist` array + the last-known restart counts (mutated in place),
 * it returns the processes with NEW restarts. No real collaborator — these are
 * direct assertions on the function with REAL data arrays (no execFile mock,
 * no doubles). The live `execFile`/emulator boundary is covered by the
 * integration suite (serverHealth.test.js). A genuine PM2 restart between runs
 * is not CI-inducible, so this delta logic is verified here at the unit level.
 *
 * NODE_ENV=local only keeps the transitive require chain (log → firebase)
 * pointed at the emulator config; the Admin SDK initialises lazily and these
 * tests never touch it.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'local';

const { detectPm2Restarts } = require('../../src/cron/serverHealth');

const proc = (name, restartTime) => ({ name, pm2_env: { restart_time: restartTime } });

describe('detectPm2Restarts (pure restart-delta logic)', () => {
  test('flags a process whose restart count increased from a positive baseline', () => {
    const last = { api: 3 };

    const result = detectPm2Restarts([proc('api', 5)], last);

    expect(result).toEqual([{ name: 'api', newRestarts: 2, total: 5 }]);
    expect(last.api).toBe(5); // baseline advanced
  });

  test('does NOT flag the first sighting (lastKnown 0) but records the baseline', () => {
    const last = {};

    const result = detectPm2Restarts([proc('api', 4)], last);

    expect(result).toEqual([]); // fresh server start must not alert
    expect(last.api).toBe(4); // baseline recorded for next run
  });

  test('does NOT flag a recorded-0 baseline that increases to 1 (first restart after fresh start is absorbed), but advances the baseline', () => {
    // Distinct from the first-sighting case above: here lastKnown was explicitly
    // recorded as 0 on a prior run. The `lastKnown > 0` guard means even a real
    // 0→1 increase does not alert — it just advances the baseline so the NEXT
    // increase (1→2) will. Pins the documented "fresh start never alerts" contract
    // against a future `lastKnown >= 0` regression.
    const last = { api: 0 };

    const result = detectPm2Restarts([proc('api', 1)], last);

    expect(result).toEqual([]); // increase, but lastKnown was 0 → no alert
    expect(last.api).toBe(1); // baseline advanced; a subsequent 1→2 WILL alert
  });

  test('does not flag a process whose restart count is unchanged', () => {
    const last = { api: 2 };

    const result = detectPm2Restarts([proc('api', 2)], last);

    expect(result).toEqual([]);
    expect(last.api).toBe(2);
  });

  test('does not flag a DECREASED count (e.g. pm2 resurrect) but records the new lower value', () => {
    const last = { api: 9 };

    const result = detectPm2Restarts([proc('api', 4)], last);

    expect(result).toEqual([]); // only increases are restarts
    expect(last.api).toBe(4);
  });

  test('tracks multiple processes independently — only the increased one is flagged', () => {
    const last = { 'api-prod': 5, 'api-dev': 2 };

    const result = detectPm2Restarts([proc('api-prod', 7), proc('api-dev', 2)], last);

    expect(result).toEqual([{ name: 'api-prod', newRestarts: 2, total: 7 }]);
    expect(last).toEqual({ 'api-prod': 7, 'api-dev': 2 });
  });

  test('returns every restarted process when several crossed their baselines', () => {
    const last = { a: 1, b: 10 };

    const result = detectPm2Restarts([proc('a', 3), proc('b', 12)], last);

    expect(result).toEqual([
      { name: 'a', newRestarts: 2, total: 3 },
      { name: 'b', newRestarts: 2, total: 12 },
    ]);
  });

  test('skips a process that has no pm2_env and does NOT record it', () => {
    const last = {};

    const result = detectPm2Restarts([{ name: 'no-env' }, proc('with-env', 0)], last);

    expect(result).toEqual([]);
    expect(last).not.toHaveProperty('no-env'); // skipped, not recorded
    expect(last['with-env']).toBe(0);
  });

  test('treats restart_time 0 as a baseline (no alert)', () => {
    const last = {};

    const result = detectPm2Restarts([proc('fresh', 0)], last);

    expect(result).toEqual([]);
    expect(last.fresh).toBe(0);
  });

  test('defaults a missing restart_time to 0', () => {
    const last = {};

    const result = detectPm2Restarts([{ name: 'x', pm2_env: {} }], last);

    expect(result).toEqual([]);
    expect(last.x).toBe(0);
  });

  test('an empty process list yields no restarts and leaves counts untouched', () => {
    const last = { api: 5 };

    const result = detectPm2Restarts([], last);

    expect(result).toEqual([]);
    expect(last).toEqual({ api: 5 });
  });
});
