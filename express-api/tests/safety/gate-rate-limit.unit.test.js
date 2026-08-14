'use strict';

const {
  recordGateCheck,
  __resetGateRateLimit,
  MAX_PER_WINDOW,
  WINDOW_MS,
} = require('../../src/safety/gate-rate-limit');

// SHY-0060 — the per-user gate-check counter (AC86). Pure in-memory sliding
// window: MAX_PER_WINDOW checks/user/WINDOW_MS. Deterministic via an injected
// clock — no real timers.

beforeEach(() => __resetGateRateLimit());

describe('recordGateCheck — within the window', () => {
  test('the first check is allowed with count 1', () => {
    expect(recordGateCheck('u1', 0)).toEqual({ allowed: true, count: 1 });
  });

  test('the MAX-th check is still allowed', () => {
    let last;
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) last = recordGateCheck('u1', i);
    expect(last).toEqual({ allowed: true, count: MAX_PER_WINDOW });
  });

  test('the check just past MAX is the first denial', () => {
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) recordGateCheck('u1', i);
    expect(recordGateCheck('u1', MAX_PER_WINDOW)).toEqual({
      allowed: false,
      count: MAX_PER_WINDOW + 1,
    });
  });

  test('subsequent checks keep counting while denied (for once-per-window alerting)', () => {
    for (let i = 0; i < MAX_PER_WINDOW + 1; i += 1) recordGateCheck('u1', i);
    expect(recordGateCheck('u1', MAX_PER_WINDOW + 1)).toEqual({
      allowed: false,
      count: MAX_PER_WINDOW + 2,
    });
  });
});

describe('recordGateCheck — window rollover + isolation', () => {
  test('a full window later the count resets', () => {
    for (let i = 0; i < MAX_PER_WINDOW + 5; i += 1) recordGateCheck('u1', 0);
    expect(recordGateCheck('u1', WINDOW_MS)).toEqual({ allowed: true, count: 1 });
  });

  test('the window is a boundary: one ms short does NOT reset', () => {
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) recordGateCheck('u1', 0);
    expect(recordGateCheck('u1', WINDOW_MS - 1).allowed).toBe(false);
  });

  test('different users have independent budgets', () => {
    for (let i = 0; i < MAX_PER_WINDOW + 1; i += 1) recordGateCheck('u1', i);
    expect(recordGateCheck('u2', 0)).toEqual({ allowed: true, count: 1 });
  });

  test('numeric and string ids for the same user share one budget', () => {
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) recordGateCheck(42, i);
    expect(recordGateCheck('42', MAX_PER_WINDOW).allowed).toBe(false);
  });
});
