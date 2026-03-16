/**
 * Tests for src/utils/gcs.js — Good Character Score computation.
 *
 * computeDisplayScore(floor, lastDeductionMs):
 * - GCS starts at 100 and is deducted when a user receives a warning.
 * - Recovers at +2 per 30-day month from the floor value.
 * - Returns 100 when floor is null, undefined, or >= 100 (perfect score).
 * - Returns the floor when lastDeductionMs is falsy (no recovery yet).
 * - Caps the recovered score at 100.
 */

const { computeDisplayScore } = require('../../src/utils/gcs');

// ─── Helper ───────────────────────────────────────────────────────

/** Returns a timestamp N months in the past (approximated as 30 days/month). */
function monthsAgo(n) {
  return Date.now() - n * 30 * 24 * 60 * 60 * 1000;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('computeDisplayScore()', () => {
  // ── Perfect score scenarios ────────────────────────────────────

  describe('when floor is null or undefined (no deductions)', () => {
    it('returns 100 when floor is null', () => {
      expect(computeDisplayScore(null, monthsAgo(1))).toBe(100);
    });

    it('returns 100 when floor is undefined', () => {
      expect(computeDisplayScore(undefined, monthsAgo(1))).toBe(100);
    });
  });

  describe('when floor is 100 or above', () => {
    it('returns 100 when floor is exactly 100', () => {
      expect(computeDisplayScore(100, monthsAgo(1))).toBe(100);
    });

    it('returns 100 when floor is above 100 (edge case)', () => {
      expect(computeDisplayScore(110, monthsAgo(1))).toBe(100);
    });
  });

  // ── No recovery (lastDeductionMs is falsy) ─────────────────────

  describe('when lastDeductionMs is falsy', () => {
    it('returns the floor when lastDeductionMs is 0', () => {
      expect(computeDisplayScore(80, 0)).toBe(80);
    });

    it('returns the floor when lastDeductionMs is null', () => {
      expect(computeDisplayScore(80, null)).toBe(80);
    });

    it('returns the floor when lastDeductionMs is undefined', () => {
      expect(computeDisplayScore(80, undefined)).toBe(80);
    });

    it('returns the floor when lastDeductionMs is false', () => {
      expect(computeDisplayScore(60, false)).toBe(60);
    });
  });

  // ── Recovery over time ─────────────────────────────────────────

  describe('score recovery at +2 per month', () => {
    it('recovers by approximately 2 points after 1 month', () => {
      const floor = 80;
      const score = computeDisplayScore(floor, monthsAgo(1));
      // Should be floor + 2*1 = 82, allow ±1 for floating point timing
      expect(score).toBeGreaterThanOrEqual(81);
      expect(score).toBeLessThanOrEqual(83);
    });

    it('recovers by approximately 4 points after 2 months', () => {
      const floor = 80;
      const score = computeDisplayScore(floor, monthsAgo(2));
      // Should be floor + 2*2 = 84
      expect(score).toBeGreaterThanOrEqual(83);
      expect(score).toBeLessThanOrEqual(85);
    });

    it('recovers by approximately 10 points after 5 months', () => {
      const floor = 70;
      const score = computeDisplayScore(floor, monthsAgo(5));
      // Should be floor + 2*5 = 80
      expect(score).toBeGreaterThanOrEqual(79);
      expect(score).toBeLessThanOrEqual(81);
    });

    it('returns a rounded integer (Math.round applied)', () => {
      const floor = 75;
      // Use a non-round number of months to verify rounding
      const halfMonthAgo = Date.now() - 0.5 * 30 * 24 * 60 * 60 * 1000;
      const score = computeDisplayScore(floor, halfMonthAgo);
      expect(Number.isInteger(score)).toBe(true);
    });
  });

  // ── Cap at 100 ─────────────────────────────────────────────────

  describe('score cap at 100', () => {
    it('caps the recovered score at 100', () => {
      const floor = 95;
      const score = computeDisplayScore(floor, monthsAgo(10));
      // 95 + 2*10 = 115, should be capped at 100
      expect(score).toBe(100);
    });

    it('caps even a very low floor to 100 after enough time', () => {
      const floor = 50;
      const score = computeDisplayScore(floor, monthsAgo(30));
      // 50 + 2*30 = 110, capped at 100
      expect(score).toBe(100);
    });

    it('returns exactly 100 when recovery brings score to exactly 100', () => {
      const floor = 80;
      // 10 months: 80 + 20 = 100
      const score = computeDisplayScore(floor, monthsAgo(10));
      expect(score).toBe(100);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns the floor (not 0) when floor is 0 and no time has passed', () => {
      const justNow = Date.now();
      const score = computeDisplayScore(0, justNow);
      // At t=0, recovery is 0, so score = floor = 0
      expect(score).toBe(0);
    });

    it('handles a floor of 1 gracefully', () => {
      const score = computeDisplayScore(1, monthsAgo(0.1));
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('handles a floor of 99 (only 1 point below max)', () => {
      // After half a month, recovery = 2 * 0.5 = 1 → 99 + 1 = 100
      const halfMonthAgo = Date.now() - 0.5 * 30 * 24 * 60 * 60 * 1000;
      const score = computeDisplayScore(99, halfMonthAgo);
      expect(score).toBe(100);
    });

    it('returns a number (not NaN or Infinity)', () => {
      const score = computeDisplayScore(50, monthsAgo(5));
      expect(Number.isFinite(score)).toBe(true);
    });

    it('returns a value between 0 and 100 inclusive', () => {
      const testCases = [
        [100, monthsAgo(1)],
        [null, monthsAgo(1)],
        [80, monthsAgo(3)],
        [50, monthsAgo(0)],
        [0, monthsAgo(50)],
        [80, 0],
      ];
      for (const [floor, deductionMs] of testCases) {
        const score = computeDisplayScore(floor, deductionMs);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });
  });

  // ── Return type ────────────────────────────────────────────────

  describe('return type', () => {
    it('always returns a number', () => {
      expect(typeof computeDisplayScore(80, monthsAgo(1))).toBe('number');
      expect(typeof computeDisplayScore(null, monthsAgo(1))).toBe('number');
      expect(typeof computeDisplayScore(100, monthsAgo(1))).toBe('number');
      expect(typeof computeDisplayScore(80, 0)).toBe('number');
    });
  });
});
