'use strict';

const { isAgeClaimTampered } = require('../../src/safety/tamper-check');

// SHY-0060 — the pure tamper predicate. A client's asserted age is compared to
// the server's DOB-derived age; a difference of MORE THAN 1 year is tamper (the
// ±1 tolerance absorbs client/server timezone + birthday-boundary drift, since
// both derive from the same DOB). The claim never feeds the gate — this is an
// abuse signal only. Pure — numbers in, boolean out, no collaborator.

describe('isAgeClaimTampered — within tolerance is NOT tamper', () => {
  test('an exact match is not tamper', () => {
    expect(isAgeClaimTampered(15, 15)).toBe(false);
  });

  test('claimed one year over is within tolerance', () => {
    expect(isAgeClaimTampered(16, 15)).toBe(false);
  });

  test('claimed one year under is within tolerance', () => {
    expect(isAgeClaimTampered(14, 15)).toBe(false);
  });
});

describe('isAgeClaimTampered — beyond tolerance IS tamper', () => {
  test('claimed two years over is tamper', () => {
    expect(isAgeClaimTampered(17, 15)).toBe(true);
  });

  test('the BDD143 case (claimed 19, record 15) is tamper', () => {
    expect(isAgeClaimTampered(19, 15)).toBe(true);
  });

  test('claiming far younger than the record is also tamper', () => {
    expect(isAgeClaimTampered(10, 15)).toBe(true);
  });
});

describe('isAgeClaimTampered — non-numeric inputs never trip', () => {
  test('an undefined claim is not tamper (no assertion made)', () => {
    expect(isAgeClaimTampered(undefined, 15)).toBe(false);
  });

  test('a NaN claim is not tamper', () => {
    expect(isAgeClaimTampered(Number.NaN, 15)).toBe(false);
  });

  test('a non-numeric server age is not tamper (nothing to compare)', () => {
    expect(isAgeClaimTampered(19, undefined)).toBe(false);
  });

  test('a string claim is not tamper', () => {
    expect(isAgeClaimTampered('19', 15)).toBe(false);
  });

  // Non-finite claims are treated as "no valid claim", not tamper. They cannot
  // arrive through the wired path anyway — JSON.parse never yields Infinity/NaN
  // — and the gate ignores claimedAge regardless, so nothing is bypassed.
  test('a positive-infinity claim is not tamper (treated as no valid claim)', () => {
    expect(isAgeClaimTampered(Number.POSITIVE_INFINITY, 15)).toBe(false);
  });

  test('a negative-infinity claim is not tamper', () => {
    expect(isAgeClaimTampered(Number.NEGATIVE_INFINITY, 15)).toBe(false);
  });

  test('an infinite server age is not tamper (nothing sane to compare)', () => {
    expect(isAgeClaimTampered(19, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
