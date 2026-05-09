/**
 * Tests for the age-verification FCM helper (PR 10).
 *
 * Pin the wire shape of each push (the Android handler dispatches by
 * the `type` field and PM-decision flags) plus the best-effort
 * semantics — missing user / no tokens / send error must NOT throw.
 */

const mockSendFcmToTokens = jest.fn();
const mockCleanupInvalidTokens = jest.fn().mockResolvedValue();
jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: (...args) => mockSendFcmToTokens(...args),
  cleanupInvalidTokens: (...args) => mockCleanupInvalidTokens(...args),
}));

const mockDocGet = jest.fn();
jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({ get: mockDocGet })),
  },
}));

const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
jest.mock('../../src/utils/log', () => ({
  warn: (...args) => mockLogWarn(...args),
  error: (...args) => mockLogError(...args),
  info: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const {
  sendAgeVerificationApprovedPush,
  sendAgeVerificationRejectedPush,
  sendAgeVerificationDobModifiedPush,
} = require('../../src/utils/age-verification-fcm');

function userWithTokens(tokens) {
  return {
    exists: true,
    data: () => ({ fcmTokens: tokens }),
  };
}

// ─── Approved ─────────────────────────────────────────────────────

describe('sendAgeVerificationApprovedPush', () => {
  test('sends data-only FCM with type=AGE_VERIF_APPROVED + targetUserId', async () => {
    mockDocGet.mockResolvedValue(userWithTokens(['tok-A', 'tok-B']));
    mockSendFcmToTokens.mockResolvedValue([]);

    const ok = await sendAgeVerificationApprovedPush(10000050);

    expect(ok).toBe(true);
    expect(mockSendFcmToTokens).toHaveBeenCalledWith(['tok-A', 'tok-B'], {
      type: 'AGE_VERIF_APPROVED',
      targetUserId: '10000050',
    });
  });

  test('returns true (and does NOT call FCM) when user has no fcmTokens', async () => {
    mockDocGet.mockResolvedValue(userWithTokens([]));
    const ok = await sendAgeVerificationApprovedPush(10000050);
    expect(ok).toBe(true);
    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('returns false when target user doc is missing', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    const ok = await sendAgeVerificationApprovedPush(10000050);
    expect(ok).toBe(false);
    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('best-effort cleanup of invalid tokens after send', async () => {
    mockDocGet.mockResolvedValue(userWithTokens(['tok-good', 'tok-bad']));
    mockSendFcmToTokens.mockResolvedValue(['tok-bad']);

    await sendAgeVerificationApprovedPush(10000050);

    expect(mockCleanupInvalidTokens).toHaveBeenCalledWith(['tok-bad'], 10000050);
  });

  test('cleanup failure is logged (not silently swallowed) but does not fail the push', async () => {
    mockDocGet.mockResolvedValue(userWithTokens(['tok-good', 'tok-bad']));
    mockSendFcmToTokens.mockResolvedValue(['tok-bad']);
    const cleanupErr = new Error('PERMISSION_DENIED');
    cleanupErr.code = 'permission-denied';
    mockCleanupInvalidTokens.mockRejectedValueOnce(cleanupErr);

    const ok = await sendAgeVerificationApprovedPush(10000050);
    // Yield once so the .catch handler attached to cleanup runs.
    await new Promise((resolve) => setImmediate(resolve));

    expect(ok).toBe(true); // push itself succeeded — only the cleanup failed
    expect(mockLogWarn).toHaveBeenCalledWith(
      'age-verification-fcm',
      'Stale-token cleanup failed',
      expect.objectContaining({
        targetUserId: 10000050,
        invalidCount: 1,
        error: 'PERMISSION_DENIED',
        code: 'permission-denied',
      }),
    );
  });

  test('swallows send errors and returns false (admin decision must not fail on push)', async () => {
    mockDocGet.mockResolvedValue(userWithTokens(['tok-A']));
    mockSendFcmToTokens.mockRejectedValue(new Error('FCM 503'));

    const ok = await sendAgeVerificationApprovedPush(10000050);

    expect(ok).toBe(false); // surface a flag for the partial-failure response
  });
});

// ─── Rejected ─────────────────────────────────────────────────────

describe('sendAgeVerificationRejectedPush', () => {
  test('forwards a reason preview (capped at 80 chars)', async () => {
    mockDocGet.mockResolvedValue(userWithTokens(['tok-A']));
    mockSendFcmToTokens.mockResolvedValue([]);

    const longReason = 'x'.repeat(200);
    await sendAgeVerificationRejectedPush(10000050, longReason);

    const data = mockSendFcmToTokens.mock.calls[0][1];
    expect(data.type).toBe('AGE_VERIF_REJECTED');
    expect(data.targetUserId).toBe('10000050');
    expect(data.reasonPreview).toHaveLength(80);
  });

  test('non-string reason becomes empty preview (defence against admin error)', async () => {
    mockDocGet.mockResolvedValue(userWithTokens(['tok-A']));
    mockSendFcmToTokens.mockResolvedValue([]);

    await sendAgeVerificationRejectedPush(10000050, undefined);

    const data = mockSendFcmToTokens.mock.calls[0][1];
    expect(data.reasonPreview).toBe('');
  });
});

// ─── DOB modified ─────────────────────────────────────────────────

describe('sendAgeVerificationDobModifiedPush', () => {
  test('becameVerified=true sends approve-style flag', async () => {
    mockDocGet.mockResolvedValue(userWithTokens(['tok-A']));
    mockSendFcmToTokens.mockResolvedValue([]);

    await sendAgeVerificationDobModifiedPush(10000050, true);

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(['tok-A'], {
      type: 'AGE_VERIF_DOB_MODIFIED',
      targetUserId: '10000050',
      becameVerified: 'true',
    });
  });

  test('becameVerified=false sends reject-style flag', async () => {
    mockDocGet.mockResolvedValue(userWithTokens(['tok-A']));
    mockSendFcmToTokens.mockResolvedValue([]);

    await sendAgeVerificationDobModifiedPush(10000050, false);

    const data = mockSendFcmToTokens.mock.calls[0][1];
    expect(data.becameVerified).toBe('false');
  });

  test('truthy non-boolean is normalised to true', async () => {
    mockDocGet.mockResolvedValue(userWithTokens(['tok-A']));
    mockSendFcmToTokens.mockResolvedValue([]);

    await sendAgeVerificationDobModifiedPush(10000050, 1);

    const data = mockSendFcmToTokens.mock.calls[0][1];
    expect(data.becameVerified).toBe('true');
  });
});
