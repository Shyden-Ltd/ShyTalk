const { viewerIsBlocked, checkBlockRelationship } = require('../../src/utils/block-check');

describe('viewerIsBlocked', () => {
  test('returns true when target has blocked viewer', () => {
    expect(viewerIsBlocked(10000001, { blockedUserIds: [10000001, 10000002] })).toBe(true);
  });

  test('returns false when target has not blocked viewer', () => {
    expect(viewerIsBlocked(10000001, { blockedUserIds: [10000002] })).toBe(false);
  });

  test('returns false when target has no blockedUserIds field', () => {
    expect(viewerIsBlocked(10000001, {})).toBe(false);
  });

  test('returns false when target is null', () => {
    expect(viewerIsBlocked(10000001, null)).toBe(false);
  });

  test('returns false when target is undefined', () => {
    expect(viewerIsBlocked(10000001, undefined)).toBe(false);
  });

  test('handles string viewer id against numeric blocked ids', () => {
    expect(viewerIsBlocked('10000001', { blockedUserIds: [10000001] })).toBe(true);
  });

  test('handles numeric viewer id against string blocked ids', () => {
    expect(viewerIsBlocked(10000001, { blockedUserIds: ['10000001'] })).toBe(true);
  });

  test('returns false on empty blockedUserIds array', () => {
    expect(viewerIsBlocked(10000001, { blockedUserIds: [] })).toBe(false);
  });
});

describe('checkBlockRelationship', () => {
  test('returns null when neither side has blocked the other', () => {
    const sender = { blockedUserIds: [] };
    const recipient = { blockedUserIds: [] };
    expect(checkBlockRelationship(sender, recipient, 10000001, 10000002)).toBeNull();
  });

  test('returns error string when sender has blocked recipient', () => {
    const sender = { blockedUserIds: [10000002] };
    const recipient = { blockedUserIds: [] };
    expect(checkBlockRelationship(sender, recipient, 10000001, 10000002)).toMatch(/blocked/i);
  });

  test('returns error string when recipient has blocked sender', () => {
    const sender = { blockedUserIds: [] };
    const recipient = { blockedUserIds: [10000001] };
    expect(checkBlockRelationship(sender, recipient, 10000001, 10000002)).toMatch(/blocked/i);
  });

  test('handles mixed string/numeric id storage', () => {
    const sender = { blockedUserIds: ['10000002'] };
    const recipient = { blockedUserIds: [] };
    expect(checkBlockRelationship(sender, recipient, 10000001, 10000002)).toMatch(/blocked/i);
  });

  test('returns null when sender doc is null/undefined', () => {
    // Defensive: the gift-send path validates existence separately; this
    // predicate should not throw on a missing doc.
    expect(checkBlockRelationship(null, { blockedUserIds: [] }, 1, 2)).toBeNull();
    expect(checkBlockRelationship(undefined, { blockedUserIds: [] }, 1, 2)).toBeNull();
  });

  test('returns null when recipient doc is null/undefined', () => {
    expect(checkBlockRelationship({ blockedUserIds: [] }, null, 1, 2)).toBeNull();
    expect(checkBlockRelationship({ blockedUserIds: [] }, undefined, 1, 2)).toBeNull();
  });
});
