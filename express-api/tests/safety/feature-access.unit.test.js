'use strict';

const { ageFromDob, evaluateFeatureAccess } = require('../../src/safety/feature-access');
const { ALLOWED, VERIFICATION } = require('../../src/safety/safety-gate');

// "Today" for deterministic ages, and a DOB that lands a user at exactly
// `years` old at that instant.
const NOW = Date.UTC(2026, 6, 8);
const dobForAge = (years) => Date.UTC(2026 - years, 6, 8);
const verified = (years, extra = {}) => ({
  ageVerified: true,
  dateOfBirth: dobForAge(years),
  ...extra,
});

// SHY-0060 — server-side numeric age from a date-of-birth (ms epoch). The
// server only had a boolean `isAtLeast18FromDob`; the per-feature engine needs
// the actual age in years. This mirrors that helper's calendar-aware UTC logic
// exactly (so `isAtLeast18FromDob(dob) === ageFromDob(dob) >= 18`) and is the
// server analog of Kotlin DateUtils.calculateAge. Pure — data in, integer out.

describe('ageFromDob — calendar-aware whole years (UTC)', () => {
  test('a plain multi-year gap counts whole years', () => {
    expect(ageFromDob(Date.UTC(2000, 0, 1), Date.UTC(2026, 0, 1))).toBe(26);
  });

  test('exactly the 18th birthday counts as 18', () => {
    // Born 2008-07-08; "today" 2026-07-08.
    expect(ageFromDob(Date.UTC(2008, 6, 8), Date.UTC(2026, 6, 8))).toBe(18);
  });

  test('the day before the 18th birthday is still 17', () => {
    // Born 2008-07-09; "today" 2026-07-08.
    expect(ageFromDob(Date.UTC(2008, 6, 9), Date.UTC(2026, 6, 8))).toBe(17);
  });

  test('the day after the 18th birthday is 18', () => {
    // Born 2008-07-07; "today" 2026-07-08.
    expect(ageFromDob(Date.UTC(2008, 6, 7), Date.UTC(2026, 6, 8))).toBe(18);
  });

  test('a Feb-29 birthday has not turned in a non-leap year until Mar 1', () => {
    const leapDob = Date.UTC(2008, 1, 29); // 2008-02-29
    expect(ageFromDob(leapDob, Date.UTC(2026, 1, 28))).toBe(17); // 2026-02-28
    expect(ageFromDob(leapDob, Date.UTC(2026, 2, 1))).toBe(18); // 2026-03-01
  });

  test('earlier month this year has not had the birthday yet', () => {
    // Born December; "today" is January of the same nominal year gap.
    expect(ageFromDob(Date.UTC(2005, 11, 25), Date.UTC(2026, 0, 5))).toBe(20);
  });
});

describe('evaluateFeatureAccess — verified age', () => {
  test('a verified adult is allowed the strictest base feature', () => {
    expect(evaluateFeatureAccess(verified(31), 'DIRECT_MESSAGE_WITH_STRANGER', NOW)).toEqual(
      ALLOWED,
    );
  });

  test('a verified 14-year-old is blocked from an 18+ feature (plain under-age)', () => {
    expect(evaluateFeatureAccess(verified(14), 'DIRECT_MESSAGE_WITH_STRANGER', NOW)).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: 14,
      requiredVerification: VERIFICATION.NONE,
    });
  });

  test('a verified 17-year-old is blocked from gacha spend', () => {
    expect(evaluateFeatureAccess(verified(17), 'GACHA_SPEND', NOW)).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: 17,
      requiredVerification: VERIFICATION.NONE,
    });
  });

  test('a verified 16-year-old may speak in voice rooms', () => {
    expect(evaluateFeatureAccess(verified(16), 'VOICE_ROOM_ACTIVE_SPEAKING', NOW)).toEqual(ALLOWED);
  });

  test('a verified 15-year-old is blocked from speaking in voice rooms', () => {
    expect(evaluateFeatureAccess(verified(15), 'VOICE_ROOM_ACTIVE_SPEAKING', NOW)).toEqual({
      type: 'BlockedUnderAge',
      threshold: 16,
      actualAge: 15,
      requiredVerification: VERIFICATION.NONE,
    });
  });
});

describe('evaluateFeatureAccess — unverified age (Reverify)', () => {
  test('ageVerified false → strict feature requires re-verification', () => {
    const user = { ageVerified: false, dateOfBirth: dobForAge(40) };
    expect(evaluateFeatureAccess(user, 'DIRECT_MESSAGE_WITH_STRANGER', NOW)).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: null,
      requiredVerification: VERIFICATION.REVERIFY,
    });
  });

  test('ageVerified absent entirely → treated as unverified', () => {
    const user = { dateOfBirth: dobForAge(40) };
    expect(evaluateFeatureAccess(user, 'DIRECT_MESSAGE_WITH_STRANGER', NOW)).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: null,
      requiredVerification: VERIFICATION.REVERIFY,
    });
  });

  test('unverified users keep COPPA-floor features (public room browse)', () => {
    const user = { ageVerified: false, dateOfBirth: dobForAge(40) };
    expect(evaluateFeatureAccess(user, 'PUBLIC_ROOM_BROWSE', NOW)).toEqual(ALLOWED);
  });

  test('ageVerified true but no DOB on record → treated as unverified (safe)', () => {
    const user = { ageVerified: true }; // anomalous record: verified yet no DOB
    expect(evaluateFeatureAccess(user, 'DIRECT_MESSAGE_WITH_STRANGER', NOW)).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: null,
      requiredVerification: VERIFICATION.REVERIFY,
    });
  });
});

describe('evaluateFeatureAccess — region (nationality → ISO alpha-2)', () => {
  test('a GDPR region raises the signup floor (Germany → 16)', () => {
    const result = evaluateFeatureAccess(verified(15, { nationality: 'DE' }), 'SIGNUP', NOW);
    expect(result).toEqual({
      type: 'BlockedRegion',
      threshold: 16,
      reason: 'This region requires age 16 for SIGNUP',
    });
  });

  test('a lowercase nationality is normalised to the alpha-2 override key', () => {
    const result = evaluateFeatureAccess(verified(15, { nationality: 'de' }), 'SIGNUP', NOW);
    expect(result.type).toBe('BlockedRegion');
    expect(result.threshold).toBe(16);
  });

  test('surrounding whitespace on nationality is trimmed before lookup', () => {
    const result = evaluateFeatureAccess(verified(15, { nationality: '  DE  ' }), 'SIGNUP', NOW);
    expect(result.type).toBe('BlockedRegion');
    expect(result.threshold).toBe(16);
  });

  test('a 16-year-old in a GDPR region clears the elevated threshold', () => {
    expect(evaluateFeatureAccess(verified(16, { nationality: 'DE' }), 'SIGNUP', NOW)).toEqual(
      ALLOWED,
    );
  });

  test('a recognised region without an override uses the base threshold', () => {
    expect(
      evaluateFeatureAccess(
        verified(14, { nationality: 'GB' }),
        'DIRECT_MESSAGE_WITH_STRANGER',
        NOW,
      ),
    ).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: 14,
      requiredVerification: VERIFICATION.NONE,
    });
  });
});

describe('evaluateFeatureAccess — region-detection failure (conservative max)', () => {
  test('blank nationality falls back to the conservative max (signup → 16)', () => {
    const result = evaluateFeatureAccess(verified(15, { nationality: '' }), 'SIGNUP', NOW);
    expect(result.type).toBe('BlockedRegion');
    expect(result.threshold).toBe(16);
  });

  test('whitespace-only nationality is treated as undetected (conservative)', () => {
    const result = evaluateFeatureAccess(verified(15, { nationality: '   ' }), 'SIGNUP', NOW);
    expect(result.type).toBe('BlockedRegion');
    expect(result.threshold).toBe(16);
  });

  test('missing nationality entirely falls back to the conservative max', () => {
    const result = evaluateFeatureAccess(verified(15), 'SIGNUP', NOW);
    expect(result.type).toBe('BlockedRegion');
    expect(result.threshold).toBe(16);
  });
});

describe('evaluateFeatureAccess — fail-fast on an unknown feature', () => {
  test('throws rather than silently mis-gating a typo’d feature constant', () => {
    expect(() => evaluateFeatureAccess(verified(20), 'NOT_A_REAL_FEATURE', NOW)).toThrow(
      /unknown feature/i,
    );
  });
});
