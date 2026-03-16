const mockSendEachForMulticast = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  messaging: {
    sendEachForMulticast: mockSendEachForMulticast,
  },
  db: {
    doc: jest.fn(() => ({
      update: mockDocUpdate,
    })),
  },
  FieldValue: {
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

const { sendFcmToTokens, cleanupInvalidTokens } = require('../../src/utils/fcm');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendFcmToTokens', () => {
  test('returns empty array when no tokens provided', async () => {
    const result = await sendFcmToTokens([], { type: 'TEST' });
    expect(result).toEqual([]);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });

  test('returns empty array when tokens is null', async () => {
    const result = await sendFcmToTokens(null, { type: 'TEST' });
    expect(result).toEqual([]);
  });

  test('stringifies all data values', async () => {
    mockSendEachForMulticast.mockResolvedValue({ responses: [{ success: true }] });

    await sendFcmToTokens(['token-1'], { count: 42, flag: true });

    expect(mockSendEachForMulticast).toHaveBeenCalledWith({
      tokens: ['token-1'],
      data: { count: '42', flag: 'true' },
    });
  });

  test('returns invalid tokens for all recognized invalid codes', async () => {
    mockSendEachForMulticast.mockResolvedValue({
      responses: [
        { success: true },
        { error: { code: 'messaging/registration-token-not-registered' } },
        { error: { code: 'messaging/invalid-registration-token' } },
        { error: { code: 'messaging/sender-id-mismatch' } },
        { error: { code: 'messaging/invalid-argument' } },
        { error: { code: 'messaging/internal-error', message: 'transient' } }, // not invalid
      ],
    });

    const result = await sendFcmToTokens(
      ['good', 'expired', 'invalid', 'mismatch', 'bad-arg', 'error'],
      { type: 'TEST' },
    );

    expect(result).toEqual(['expired', 'invalid', 'mismatch', 'bad-arg']);
  });

  test('logs warning for unrecognized FCM error codes', async () => {
    const logModule = require('../../src/utils/log');
    const warnSpy = jest.spyOn(logModule, 'warn').mockImplementation(() => {});

    mockSendEachForMulticast.mockResolvedValue({
      responses: [{ error: { code: 'messaging/internal-error', message: 'Server error' } }],
    });

    await sendFcmToTokens(['token-1'], { type: 'TEST' });

    expect(warnSpy).toHaveBeenCalledWith(
      'fcm',
      expect.stringContaining('FCM send failed for token index 0'),
      expect.objectContaining({ code: 'messaging/internal-error' }),
    );

    warnSpy.mockRestore();
  });
});

describe('cleanupInvalidTokens', () => {
  test('does nothing when no invalid tokens', async () => {
    await cleanupInvalidTokens([], 'user-1');
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('does nothing when tokens is null', async () => {
    await cleanupInvalidTokens(null, 'user-1');
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('removes invalid tokens from user doc', async () => {
    await cleanupInvalidTokens(['bad-token-1', 'bad-token-2'], 'user-1');
    expect(mockDocUpdate).toHaveBeenCalled();
  });
});
