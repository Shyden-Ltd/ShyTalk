/**
 * Pass-17 regression tests for the buildCascadeFailure helper.
 *
 * Centralises the 4 previously-duplicated cascade-fallback literals in
 * reports.js + admin-users.js. Two of them previously omitted
 * `rtdbEventsFailed` AND used a stale `'cascade_failed'` literal token —
 * silent shape drift that would break any cross-platform consumer
 * (admin client, future Kotlin/iOS) deserializing the response.
 *
 * These tests lock the wire shape so a future divergence on any field is
 * caught at unit-test time, not at runtime by a Kotlin client crashing on
 * a missing `rtdbEventsFailed: 0` field.
 */

// firebase.js process.exit's without FIREBASE_DATABASE_URL — mock it out so
// importing evict-suspended-user.js doesn't kill the test runner.
jest.mock('../../src/utils/firebase', () => ({
  db: { doc: jest.fn(), collection: jest.fn(), batch: jest.fn() },
  rtdb: { ref: jest.fn() },
}));
jest.mock('../../src/utils/firestore-helpers', () => ({
  queryDocs: jest.fn(async () => []),
}));

const { buildCascadeFailure } = require('../../src/utils/evict-suspended-user');

describe('buildCascadeFailure (Pass-17 cascade contract unifier)', () => {
  it('returns the canonical superset shape with all 7 keys (parity with success path per Pass-19)', () => {
    const result = buildCascadeFailure(new Error('boom'), 'cascade_failed');
    expect(Object.keys(result).sort()).toEqual(
      [
        'error',
        'failedRoomIds',
        'partial',
        'roomsClosed',
        'roomsUpdated',
        'rtdbEventsFailed',
        'userDocFailed',
      ].sort(),
    );
  });

  it('partial=true regardless of error phase', () => {
    expect(buildCascadeFailure(new Error('x'), 'cascade_failed').partial).toBe(true);
    const phaseErr = Object.assign(new Error('user'), { phase: 'user_doc' });
    expect(buildCascadeFailure(phaseErr, 'cascade_failed').partial).toBe(true);
  });

  it('userDocFailed reflects err.phase exactly', () => {
    const noPhase = buildCascadeFailure(new Error('x'), 'cascade_failed');
    expect(noPhase.userDocFailed).toBe(false);

    const phaseErr = Object.assign(new Error('user gone'), { phase: 'user_doc' });
    expect(buildCascadeFailure(phaseErr, 'cascade_failed').userDocFailed).toBe(true);

    // Unknown phase tag → false (only 'user_doc' is recognised).
    const otherPhase = Object.assign(new Error('x'), { phase: 'other_phase' });
    expect(buildCascadeFailure(otherPhase, 'cascade_failed').userDocFailed).toBe(false);
  });

  it('zero counts on roomsClosed, roomsUpdated, rtdbEventsFailed, failedRoomIds (cascade aborted before counting)', () => {
    const result = buildCascadeFailure(new Error('x'), 'cascade_failed');
    expect(result.roomsClosed).toBe(0);
    expect(result.roomsUpdated).toBe(0);
    expect(result.rtdbEventsFailed).toBe(0);
    expect(result.failedRoomIds).toEqual([]);
  });

  it('error token is the literal string passed in (caller chooses)', () => {
    expect(buildCascadeFailure(new Error('x'), 'cascade_failed').error).toBe('cascade_failed');
    expect(buildCascadeFailure(new Error('x'), 'custom_token').error).toBe('custom_token');
  });

  it('handles non-Error throws (frozen objects, primitives) without crashing', () => {
    // err might be a frozen Error (defensive guard in evict-suspended-user.js
    // skips phase-tagging, so phase is undefined).
    const frozen = Object.freeze(new Error('frozen'));
    const result = buildCascadeFailure(frozen, 'cascade_failed');
    expect(result.partial).toBe(true);
    expect(result.userDocFailed).toBe(false);

    // err might be a string (rare but possible).
    const stringErr = buildCascadeFailure('string error', 'cascade_failed');
    expect(stringErr.userDocFailed).toBe(false);

    // err might be null/undefined.
    expect(buildCascadeFailure(null, 'cascade_failed').userDocFailed).toBe(false);
    expect(buildCascadeFailure(undefined, 'cascade_failed').userDocFailed).toBe(false);
  });

  it('shape is JSON-serializable (no circular refs, no functions)', () => {
    const result = buildCascadeFailure(new Error('x'), 'cascade_failed');
    expect(() => JSON.stringify(result)).not.toThrow();
    const roundTrip = JSON.parse(JSON.stringify(result));
    expect(roundTrip).toEqual(result);
  });
});
