'use strict';

const {
  canAccess,
  conservativeThreshold,
  ALLOWED,
  VERIFICATION,
} = require('../../src/safety/safety-gate');

// SHY-0060 — the JS server port of the Kotlin SafetyGate. Behaviour mirrors
// SafetyGateTest.kt exactly (deterministic verified-age + ISO country in), so the
// server enforces the identical verdict the clients compute. Result shape:
//  { type: 'Allowed' }
//  { type: 'BlockedUnderAge', threshold, actualAge, requiredVerification }
//  { type: 'BlockedRegion', threshold, reason }

describe('SafetyGate.canAccess — allowed', () => {
  test('allows access when verified age equals the threshold', () => {
    expect(canAccess('DIRECT_MESSAGE_WITH_STRANGER', 18, 'GB')).toEqual(ALLOWED);
  });

  test('allows access when verified age exceeds the threshold', () => {
    expect(canAccess('DIRECT_MESSAGE_WITH_STRANGER', 40, 'GB')).toEqual(ALLOWED);
  });

  test('allows a COPPA-floor feature at exactly the floor age', () => {
    expect(canAccess('PUBLIC_ROOM_BROWSE', 13, 'GB')).toEqual(ALLOWED);
  });

  test('allows a 16-year-old to speak in voice rooms', () => {
    expect(canAccess('VOICE_ROOM_ACTIVE_SPEAKING', 16, 'GB')).toEqual(ALLOWED);
  });
});

describe('SafetyGate.canAccess — under-age (base threshold)', () => {
  test('blocks under-age access below the base threshold', () => {
    expect(canAccess('DIRECT_MESSAGE_WITH_STRANGER', 14, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: 14,
      requiredVerification: VERIFICATION.NONE,
    });
  });

  test('blocks a 17-year-old from gifting-send', () => {
    expect(canAccess('GIFTING_SEND', 17, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: 17,
      requiredVerification: VERIFICATION.NONE,
    });
  });

  test('blocks a 15-year-old from speaking in voice rooms', () => {
    expect(canAccess('VOICE_ROOM_ACTIVE_SPEAKING', 15, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 16,
      actualAge: 15,
      requiredVerification: VERIFICATION.NONE,
    });
  });
});

describe('SafetyGate.canAccess — region (GDPR Article 8)', () => {
  test('blocks with the region reason when a GDPR override lifts the bar above base', () => {
    const result = canAccess('SIGNUP', 14, 'DE');
    expect(result.type).toBe('BlockedRegion');
    expect(result.threshold).toBe(16);
  });

  test('allows access at the GDPR-elevated regional threshold', () => {
    expect(canAccess('SIGNUP', 16, 'DE')).toEqual(ALLOWED);
  });

  test('treats a sub-floor age in a GDPR region as under-age, not region', () => {
    expect(canAccess('SIGNUP', 12, 'DE')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 16,
      actualAge: 12,
      requiredVerification: VERIFICATION.NONE,
    });
  });
});

describe('SafetyGate.canAccess — unverified age', () => {
  test('requires re-verification when the age is unverified and the feature exceeds the floor', () => {
    expect(canAccess('DIRECT_MESSAGE_WITH_STRANGER', null, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: null,
      requiredVerification: VERIFICATION.REVERIFY,
    });
  });

  test('keeps COPPA-floor features open for a legacy unverified account', () => {
    expect(canAccess('PUBLIC_ROOM_BROWSE', null, 'GB')).toEqual(ALLOWED);
  });

  test('treats undefined verified age the same as null (unverified)', () => {
    expect(canAccess('DIRECT_MESSAGE_WITH_STRANGER', undefined, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: null,
      requiredVerification: VERIFICATION.REVERIFY,
    });
  });

  test('unverified age dominates even when the region is undetected', () => {
    expect(canAccess('DIRECT_MESSAGE_WITH_STRANGER', null, null)).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: null,
      requiredVerification: VERIFICATION.REVERIFY,
    });
  });
});

describe('SafetyGate.canAccess — region detection failure (conservative max)', () => {
  test('uses the conservative max threshold when the region is undetected (null)', () => {
    const result = canAccess('SIGNUP', 14, null);
    expect(result.type).toBe('BlockedRegion');
    expect(result.threshold).toBe(16);
  });

  test('treats an undefined country the same as null (conservative)', () => {
    const result = canAccess('SIGNUP', 14, undefined);
    expect(result.type).toBe('BlockedRegion');
    expect(result.threshold).toBe(16);
  });

  test('allows an undetected-region user who clears the conservative threshold', () => {
    expect(canAccess('SIGNUP', 16, null)).toEqual(ALLOWED);
  });
});

describe('SafetyGate.conservativeThreshold', () => {
  test('picks the GDPR max for signup', () => {
    expect(conservativeThreshold('SIGNUP')).toBe(16);
  });

  test('falls back to base for a feature without overrides', () => {
    expect(conservativeThreshold('GACHA_SPEND')).toBe(18);
  });

  test('for a COPPA-floor feature stays at the floor', () => {
    expect(conservativeThreshold('PUBLIC_ROOM_BROWSE')).toBe(13);
  });
});
