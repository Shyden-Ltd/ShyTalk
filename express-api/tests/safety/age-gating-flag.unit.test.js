'use strict';

const { resolveAgeGatingEnabled } = require('../../src/safety/age-gating-flag');

// SHY-0060 — the pure decision half of the default-OFF age-gating flag.
// `resolveAgeGatingEnabled(configData)` turns the raw `config/safety`
// Firestore doc data (or null when absent) into the boolean "is age-gating
// enforcement switched on?". It is deliberately STRICT: only a real boolean
// `true` enables gating. A mistyped operator value ("true", 1, "on") must
// NEVER silently flip a SAFETY gate — it reads as OFF, the safe default.
//
// Pure logic over plain data fixtures — no Firestore, no collaborator, so
// this is a genuine unit test (no test double involved at all).

describe('resolveAgeGatingEnabled — default OFF', () => {
  test('a null config doc (section absent) resolves to OFF', () => {
    expect(resolveAgeGatingEnabled(null)).toBe(false);
  });

  test('an undefined config doc resolves to OFF', () => {
    expect(resolveAgeGatingEnabled(undefined)).toBe(false);
  });

  test('a config doc without the flag field resolves to OFF', () => {
    expect(resolveAgeGatingEnabled({})).toBe(false);
  });

  test('a config doc with unrelated fields only resolves to OFF', () => {
    expect(resolveAgeGatingEnabled({ someOtherSetting: true })).toBe(false);
  });
});

describe('resolveAgeGatingEnabled — explicit boolean', () => {
  test('ageGatingEnabled === true resolves to ON', () => {
    expect(resolveAgeGatingEnabled({ ageGatingEnabled: true })).toBe(true);
  });

  test('ageGatingEnabled === false resolves to OFF', () => {
    expect(resolveAgeGatingEnabled({ ageGatingEnabled: false })).toBe(false);
  });
});

describe('resolveAgeGatingEnabled — strict (non-boolean never enables)', () => {
  test('the string "true" does NOT enable gating', () => {
    expect(resolveAgeGatingEnabled({ ageGatingEnabled: 'true' })).toBe(false);
  });

  test('the string "false" resolves to OFF', () => {
    expect(resolveAgeGatingEnabled({ ageGatingEnabled: 'false' })).toBe(false);
  });

  test('the number 1 does NOT enable gating', () => {
    expect(resolveAgeGatingEnabled({ ageGatingEnabled: 1 })).toBe(false);
  });

  test('the number 0 resolves to OFF', () => {
    expect(resolveAgeGatingEnabled({ ageGatingEnabled: 0 })).toBe(false);
  });

  test('the string "on" does NOT enable gating', () => {
    expect(resolveAgeGatingEnabled({ ageGatingEnabled: 'on' })).toBe(false);
  });

  test('null as the field value resolves to OFF', () => {
    expect(resolveAgeGatingEnabled({ ageGatingEnabled: null })).toBe(false);
  });
});
