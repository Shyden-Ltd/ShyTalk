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

// Every remaining gated feature driven through canAccess directly (the parity
// pin covers their threshold VALUES; these cover their VERDICT behaviour).
describe('SafetyGate.canAccess — the remaining features', () => {
  test('PUBLIC_ROOM_ACTIVE_JOIN (13) — allowed at 13, blocked at 12, open for legacy unverified', () => {
    expect(canAccess('PUBLIC_ROOM_ACTIVE_JOIN', 13, 'GB')).toEqual(ALLOWED);
    expect(canAccess('PUBLIC_ROOM_ACTIVE_JOIN', 12, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 13,
      actualAge: 12,
      requiredVerification: VERIFICATION.NONE,
    });
    expect(canAccess('PUBLIC_ROOM_ACTIVE_JOIN', null, 'GB')).toEqual(ALLOWED);
  });

  test('DIRECT_MESSAGE_WITH_FOLLOWED_USER (13) — allowed at 13, blocked at 12, open for legacy unverified', () => {
    expect(canAccess('DIRECT_MESSAGE_WITH_FOLLOWED_USER', 13, 'GB')).toEqual(ALLOWED);
    expect(canAccess('DIRECT_MESSAGE_WITH_FOLLOWED_USER', 12, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 13,
      actualAge: 12,
      requiredVerification: VERIFICATION.NONE,
    });
    expect(canAccess('DIRECT_MESSAGE_WITH_FOLLOWED_USER', null, 'GB')).toEqual(ALLOWED);
  });

  test('GIFTING_RECEIVE (16) — allowed at 16, blocked at 15, REVERIFY when unverified', () => {
    expect(canAccess('GIFTING_RECEIVE', 16, 'GB')).toEqual(ALLOWED);
    expect(canAccess('GIFTING_RECEIVE', 15, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 16,
      actualAge: 15,
      requiredVerification: VERIFICATION.NONE,
    });
    expect(canAccess('GIFTING_RECEIVE', null, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 16,
      actualAge: null,
      requiredVerification: VERIFICATION.REVERIFY,
    });
  });

  test('PROFILE_MATURE_CONTENT (18) — allowed at 18, blocked at 17, REVERIFY when unverified', () => {
    expect(canAccess('PROFILE_MATURE_CONTENT', 18, 'GB')).toEqual(ALLOWED);
    expect(canAccess('PROFILE_MATURE_CONTENT', 17, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: 17,
      requiredVerification: VERIFICATION.NONE,
    });
    expect(canAccess('PROFILE_MATURE_CONTENT', null, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: null,
      requiredVerification: VERIFICATION.REVERIFY,
    });
  });

  test('GACHA_SPEND (18) — allowed at 18, blocked at 17, REVERIFY when unverified', () => {
    expect(canAccess('GACHA_SPEND', 18, 'GB')).toEqual(ALLOWED);
    expect(canAccess('GACHA_SPEND', 17, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: 17,
      requiredVerification: VERIFICATION.NONE,
    });
    expect(canAccess('GACHA_SPEND', null, 'GB')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: null,
      requiredVerification: VERIFICATION.REVERIFY,
    });
  });
});

// Regions that carry NO override fall back to the base threshold (only DE + NL
// elevate SIGNUP today). ES + US prove a recognised-but-unlisted region is not
// silently elevated — and that a 14-year-old who is region-blocked in DE is
// allowed to sign up in ES/US.
describe('SafetyGate.canAccess — regions without an override use the base', () => {
  test('a 14-year-old signs up in ES (no override → base 13)', () => {
    expect(canAccess('SIGNUP', 14, 'ES')).toEqual(ALLOWED);
  });

  test('a 14-year-old signs up in the US (no override → base 13)', () => {
    expect(canAccess('SIGNUP', 14, 'US')).toEqual(ALLOWED);
  });

  test('the same 14-year-old is region-blocked signing up in DE (override 16)', () => {
    expect(canAccess('SIGNUP', 14, 'DE')).toEqual({
      type: 'BlockedRegion',
      threshold: 16,
      reason: 'This region requires age 16 for SIGNUP',
    });
  });

  test('a non-SIGNUP feature is never elevated by a SIGNUP-only override (GIFTING_SEND in DE = base 18)', () => {
    expect(canAccess('GIFTING_SEND', 18, 'DE')).toEqual(ALLOWED);
    expect(canAccess('GIFTING_SEND', 17, 'DE')).toEqual({
      type: 'BlockedUnderAge',
      threshold: 18,
      actualAge: 17,
      requiredVerification: VERIFICATION.NONE,
    });
  });
});
