/**
 * SHY-0456 — the core set that always runs.
 *
 * A green journey report only proves the paths it walked. The device runner's
 * fourteen journeys never created a room or opened a microphone, so "14/14 on
 * both devices" was offered as sign-off evidence for a voice platform without
 * once exercising voice rooms.
 *
 * These tests lock the guard that fixes it:
 *   - the core set is fixed, non-empty, and every id resolves to a real journey
 *   - the core set runs FIRST
 *   - a narrower `--journeys` selection cannot opt out of it
 *   - an unresolvable core set fails loudly rather than passing zero journeys
 *
 * They assert the SELECTION the runner actually performs, not a helper the
 * runner might ignore — plus a source anchor proving the old bare filter is
 * gone, so the caller cannot drift back to skipping the core set.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  CORE_JOURNEY_IDS,
  selectJourneys,
  buildJourneys,
} = require('../../scripts/device-journey-runner');

const RUNNER_SRC = path.join(__dirname, '..', '..', 'scripts', 'device-journey-runner.js');

/** Minimal journey stubs — selection is pure, it never calls `run`. */
const j = (id) => ({ id, title: `stub ${id}`, run: async () => {} });

describe('CORE_JOURNEY_IDS', () => {
  test('is a non-empty frozen list', () => {
    expect(Array.isArray(CORE_JOURNEY_IDS)).toBe(true);
    expect(CORE_JOURNEY_IDS.length).toBeGreaterThan(0);
    expect(Object.isFrozen(CORE_JOURNEY_IDS)).toBe(true);
  });

  test('covers sign-in, the room lifecycle, social, and the cohort wall', () => {
    // The operator chose this set on 2026-08-25. Changing it is a story of its
    // own, so it is pinned here rather than left to drift.
    expect([...CORE_JOURNEY_IDS].sort()).toEqual(['J-SMOKE', 'J02', 'J07', 'J08', 'J09'].sort());
  });

  test('has no duplicates', () => {
    expect(new Set(CORE_JOURNEY_IDS).size).toBe(CORE_JOURNEY_IDS.length);
  });

  test('every core id resolves to a journey the runner actually builds', () => {
    // The anchor that stops the core set silently emptying: rename or delete a
    // journey and this fails, instead of the set quietly selecting nothing.
    const built = buildJourneys({ reset: false, pkg: 'com.shyden.shytalk.local' });
    const builtIds = built.map((x) => x.id);
    for (const id of CORE_JOURNEY_IDS) {
      expect(builtIds).toContain(id);
    }
  });
});

describe('selectJourneys — the selection the runner performs', () => {
  const ALL = [j('J-SMOKE'), j('J02'), j('J04'), j('J07'), j('J08'), j('J09'), j('J38')];

  test('with no selection, returns every journey with the core set first', () => {
    const out = selectJourneys(ALL, null);
    expect(out.map((x) => x.id)).toHaveLength(ALL.length);
    const leading = out.slice(0, CORE_JOURNEY_IDS.length).map((x) => x.id);
    expect(new Set(leading)).toEqual(new Set(CORE_JOURNEY_IDS));
  });

  test('a narrow selection still runs the core set', () => {
    // The whole point: asking for one unrelated journey must not skip the core.
    const out = selectJourneys(ALL, ['J38']);
    const ids = out.map((x) => x.id);
    for (const core of CORE_JOURNEY_IDS) {
      expect(ids).toContain(core);
    }
    expect(ids).toContain('J38');
  });

  test('the core set runs before the selected journey', () => {
    const ids = selectJourneys(ALL, ['J38']).map((x) => x.id);
    const lastCore = Math.max(...CORE_JOURNEY_IDS.map((c) => ids.indexOf(c)));
    expect(lastCore).toBeLessThan(ids.indexOf('J38'));
  });

  test('a journey that is both core and selected appears exactly once', () => {
    const ids = selectJourneys(ALL, ['J09', 'J38']).map((x) => x.id);
    expect(ids.filter((x) => x === 'J09')).toHaveLength(1);
  });

  test('selecting only core journeys yields just the core set', () => {
    const ids = selectJourneys(ALL, ['J09']).map((x) => x.id);
    expect(new Set(ids)).toEqual(new Set(CORE_JOURNEY_IDS));
  });

  test('an unknown selected id is still an error, not a silent drop', () => {
    expect(() => selectJourneys(ALL, ['J-NOPE'])).toThrow(/J-NOPE/);
  });

  test('fails loudly when a core journey is missing from the corpus', () => {
    // An empty or partial core set must never pass quietly. `toEqual([])`
    // passing on a set of zero is exactly the failure this guards.
    const missingCore = ALL.filter((x) => x.id !== 'J09');
    expect(() => selectJourneys(missingCore, null)).toThrow(/J09/);
  });

  test('fails loudly on an empty corpus rather than selecting nothing', () => {
    // Asserts the MESSAGE, not merely "something threw". A bare .toThrow()
    // here passes when `selectJourneys` is undefined — it cannot tell a
    // correct rejection from a missing implementation.
    expect(() => selectJourneys([], null)).toThrow(/core journey/i);
  });
});

describe('isCoreJourney — what halts a run', () => {
  const { isCoreJourney } = require('../../scripts/device-journey-runner');

  test('recognises every core id', () => {
    for (const id of CORE_JOURNEY_IDS) {
      expect(isCoreJourney(id)).toBe(true);
    }
  });

  test('does not claim a non-core journey', () => {
    expect(isCoreJourney('J38')).toBe(false);
    expect(isCoreJourney(undefined)).toBe(false);
  });
});

describe('source anchors — the caller cannot drift back', () => {
  const src = fs.readFileSync(RUNNER_SRC, 'utf8');

  test('the old bare selection filter is gone', () => {
    // The line this story replaces. If it returns, a narrow --journeys run
    // silently skips the core set again and every test above still passes.
    expect(src).not.toMatch(
      /journeys\s*=\s*journeys\.filter\(\s*\(j\)\s*=>\s*opts\.journeys\.includes/,
    );
  });

  test('the runner routes selection through selectJourneys', () => {
    expect(src).toMatch(/selectJourneys\s*\(/);
  });

  test('--help names the core set and that it cannot be skipped', () => {
    expect(src).toMatch(/core set/i);
    expect(src).toMatch(/cannot be skipped|always runs|never skipped/i);
  });
});
