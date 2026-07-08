'use strict';

const fs = require('fs');
const path = require('path');
const {
  COPPA_FLOOR,
  SANITY_MAX,
  FEATURES,
  BASE,
  REGION_OVERRIDES,
  thresholdFor,
  validate,
} = require('../../src/safety/age-thresholds');

// SHY-0060 — the JS server mirror of the Kotlin AgeThresholds source of truth.
// These tests (a) pin the exact provisional contract and validator, and
// (b) PARITY-PIN the mirror to shared/.../AgeThresholds.kt so the two can never
// drift silently — a mismatch fails CI here.

describe('AgeThresholds (JS mirror) — contract', () => {
  test('every gated feature has a base threshold', () => {
    for (const feature of Object.keys(FEATURES)) {
      expect(BASE[feature]).toBeDefined();
    }
  });

  test('base thresholds match the provisional safety spec exactly', () => {
    expect(BASE.SIGNUP).toBe(13);
    expect(BASE.PUBLIC_ROOM_BROWSE).toBe(13);
    expect(BASE.PUBLIC_ROOM_ACTIVE_JOIN).toBe(13);
    expect(BASE.DIRECT_MESSAGE_WITH_FOLLOWED_USER).toBe(13);
    expect(BASE.DIRECT_MESSAGE_WITH_STRANGER).toBe(18);
    expect(BASE.VOICE_ROOM_ACTIVE_SPEAKING).toBe(16);
    expect(BASE.GIFTING_SEND).toBe(18);
    expect(BASE.GIFTING_RECEIVE).toBe(16);
    expect(BASE.PROFILE_MATURE_CONTENT).toBe(18);
    expect(BASE.GACHA_SPEND).toBe(18);
  });

  test('there are exactly 10 gated features', () => {
    expect(Object.keys(FEATURES)).toHaveLength(10);
    expect(Object.keys(BASE)).toHaveLength(10);
  });
});

describe('AgeThresholds (JS mirror) — thresholdFor', () => {
  test('Germany raises the signup threshold to 16 per GDPR Article 8', () => {
    expect(thresholdFor('SIGNUP', 'DE')).toBe(16);
  });

  test('a region without an override uses the base threshold', () => {
    expect(thresholdFor('SIGNUP', 'GB')).toBe(13);
  });

  test('an unrecognised country falls back to the base threshold', () => {
    expect(thresholdFor('SIGNUP', 'XX')).toBe(13);
  });

  test('a null country falls back to the base threshold', () => {
    expect(thresholdFor('SIGNUP', null)).toBe(13);
  });
});

describe('AgeThresholds (JS mirror) — validate', () => {
  test('the shipped config passes validation', () => {
    expect(validate()).toEqual([]);
  });

  test('rejects a base threshold below the COPPA floor of 13', () => {
    const errors = validate({ SIGNUP: 12 });
    expect(errors.some((e) => e.includes('SIGNUP') && e.includes('12'))).toBe(true);
  });

  test('rejects a base threshold above the sanity max of 21', () => {
    const errors = validate({ SIGNUP: 22 });
    expect(errors.some((e) => e.includes('SIGNUP') && e.includes('22'))).toBe(true);
  });

  test('flags a feature missing from the base map', () => {
    const errors = validate({ SIGNUP: 13 });
    expect(errors.some((e) => e.includes('GACHA_SPEND'))).toBe(true);
  });

  test('rejects an out-of-range region override', () => {
    const errors = validate(BASE, { DE: { SIGNUP: 25 } });
    expect(errors.some((e) => e.includes('DE') && e.includes('25'))).toBe(true);
  });
});

// --- Parity pin: the JS mirror MUST equal the Kotlin source of truth ---

describe('AgeThresholds (JS mirror) — parity with the Kotlin source of truth', () => {
  const KT = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../shared/src/commonMain/kotlin/com/shyden/shytalk/core/safety/AgeThresholds.kt',
    ),
    'utf8',
  );

  const between = (src, startMarker, endMarker) => {
    const start = src.indexOf(startMarker);
    const end = src.indexOf(endMarker, start + startMarker.length);
    return src.slice(start, end === -1 ? undefined : end);
  };

  test('JS BASE matches the Kotlin base map exactly', () => {
    const baseBlock = between(KT, 'val base', 'val regionOverrides');
    const ktBase = {};
    for (const m of baseBlock.matchAll(/Feature\.(\w+) to (\d+)/g)) {
      ktBase[m[1]] = Number(m[2]);
    }
    expect(Object.keys(ktBase).length).toBe(10); // parser sanity: found all entries
    expect(ktBase).toEqual(BASE);
  });

  test('JS REGION_OVERRIDES matches the Kotlin regionOverrides map exactly', () => {
    const regionBlock = between(KT, 'val regionOverrides', 'fun thresholdFor');
    const ktRegion = {};
    for (const m of regionBlock.matchAll(/"(\w+)" to mapOf\(Feature\.(\w+) to (\d+)\)/g)) {
      ktRegion[m[1]] = ktRegion[m[1]] || {};
      ktRegion[m[1]][m[2]] = Number(m[3]);
    }
    // Normalise the frozen JS object to a plain one for a structural compare.
    const jsRegion = JSON.parse(JSON.stringify(REGION_OVERRIDES));
    expect(Object.keys(ktRegion).length).toBeGreaterThan(0); // parser sanity
    expect(ktRegion).toEqual(jsRegion);
  });

  test('JS COPPA_FLOOR and SANITY_MAX match the Kotlin constants', () => {
    const ktFloor = Number(/COPPA_FLOOR = (\d+)/.exec(KT)[1]);
    const ktMax = Number(/SANITY_MAX = (\d+)/.exec(KT)[1]);
    expect(ktFloor).toBe(COPPA_FLOOR);
    expect(ktMax).toBe(SANITY_MAX);
  });
});
