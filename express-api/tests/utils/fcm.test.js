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

const {
  sendFcmToIdentifiers,
  sendFcmToTokens,
  cleanupInvalidTokens,
  getFcmCaptures,
  clearFcmCaptures,
} = require('../../src/utils/fcm');

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

describe('local-mode FCM capture buffer', () => {
  const prevEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'local';
    clearFcmCaptures();
  });
  afterEach(() => {
    process.env.NODE_ENV = prevEnv;
    clearFcmCaptures();
  });

  test('captures sends in local mode and returns empty invalid-tokens array', async () => {
    const result = await sendFcmToTokens(['t1'], { type: 'PM', title: 'hi' });
    expect(result).toEqual([]);
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();

    const caps = getFcmCaptures();
    expect(caps).toHaveLength(1);
    expect(caps[0].tokens).toEqual(['t1']);
    expect(caps[0].data).toEqual({ type: 'PM', title: 'hi' });
    expect(typeof caps[0].ts).toBe('number');
  });

  test('getFcmCaptures returns a defensive copy (callers cannot mutate buffer)', async () => {
    await sendFcmToTokens(['t1'], { type: 'PM' });
    const caps = getFcmCaptures();
    caps[0].tokens.push('mutated');
    caps[0].data.injected = 'oops';
    caps.push({ tokens: ['fake'], data: {}, ts: 0 });

    const fresh = getFcmCaptures();
    expect(fresh).toHaveLength(1);
    expect(fresh[0].tokens).toEqual(['t1']);
    expect(fresh[0].data).toEqual({ type: 'PM' });
  });

  test('clearFcmCaptures empties the buffer', async () => {
    await sendFcmToTokens(['t1'], { type: 'PM' });
    expect(getFcmCaptures()).toHaveLength(1);
    clearFcmCaptures();
    expect(getFcmCaptures()).toHaveLength(0);
  });
});

/**
 * SHY-0244 — addressing Firebase Installation IDs alongside FCM tokens.
 *
 * Firebase Messaging 25.1.0 (Android) and 12.18.0 (iOS) replace the
 * registration-token model with a V1 registration model whose identifier is
 * the Firebase Installation ID. On the client the two models are mutually
 * exclusive and switched by a manifest flag, so an app build speaks one or the
 * other.
 *
 * The SERVER has no such constraint. firebase-admin 14 takes `tokens` and
 * `fids` in the SAME `sendEachForMulticast` call, so a fleet part-way through
 * the rollover is addressable in one dispatch. That is what these tests pin.
 *
 * The two populations are stored in SEPARATE fields rather than one list of
 * mixed identifiers. The alternative — sniffing which is which by format —
 * would decide who receives a moderation notice on a string shape, and would
 * make reaping ambiguous: a rejected entry has to be removed from the array it
 * actually came from.
 */
describe('SHY-0244: dispatching to installation IDs', () => {
  test('fids are addressed through the fids field, not squeezed into tokens', async () => {
    mockSendEachForMulticast.mockResolvedValue({ responses: [{ success: true }] });

    await sendFcmToIdentifiers({ tokens: [], fids: ['fid-1'] }, { type: 'TEST' });

    expect(mockSendEachForMulticast).toHaveBeenCalledWith({
      fids: ['fid-1'],
      data: { type: 'TEST' },
    });
  });

  test('a half-migrated fleet is reached in ONE dispatch', async () => {
    // The whole reason the server needs no flag day. If this ever became two
    // calls, an upgrading fleet would cost double the fan-out.
    mockSendEachForMulticast.mockResolvedValue({
      responses: [{ success: true }, { success: true }],
    });

    await sendFcmToIdentifiers({ tokens: ['tok-1'], fids: ['fid-1'] }, { type: 'TEST' });

    expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(mockSendEachForMulticast).toHaveBeenCalledWith({
      tokens: ['tok-1'],
      fids: ['fid-1'],
      data: { type: 'TEST' },
    });
  });

  test('an empty array is OMITTED rather than sent as []', async () => {
    // `{ tokens: [], fids: [...] }` is not the same request as `{ fids: [...] }`
    // to the SDK, and an empty array is a plausible argument error.
    mockSendEachForMulticast.mockResolvedValue({ responses: [{ success: true }] });

    await sendFcmToIdentifiers({ tokens: [], fids: ['fid-1'] }, { type: 'TEST' });

    const sent = mockSendEachForMulticast.mock.calls[0][0];
    expect(Object.prototype.hasOwnProperty.call(sent, 'tokens')).toBe(false);
  });

  test('a rejected fid is reaped as a FID, not as a token', async () => {
    // The index mapping is the sharp edge. The SDK documents that "tokens are
    // processed first, followed by fids", so responses[0] is the token and
    // responses[1] is the fid. Reading that backwards would delete a LIVE
    // device and leave the dead one in place -- silently, since a reap has no
    // user-visible effect until somebody stops receiving notifications.
    mockSendEachForMulticast.mockResolvedValue({
      responses: [
        { success: true },
        { error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });

    const result = await sendFcmToIdentifiers(
      { tokens: ['live-token'], fids: ['dead-fid'] },
      { type: 'TEST' },
    );

    expect(result).toEqual({ invalidTokens: [], invalidFids: ['dead-fid'] });
  });

  test('a rejected token is reaped as a TOKEN when a fid follows it', async () => {
    // The mirror image, so a mapping that is wrong in the other direction
    // cannot pass either.
    mockSendEachForMulticast.mockResolvedValue({
      responses: [{ error: { code: 'messaging/invalid-registration-token' } }, { success: true }],
    });

    const result = await sendFcmToIdentifiers(
      { tokens: ['dead-token'], fids: ['live-fid'] },
      { type: 'TEST' },
    );

    expect(result).toEqual({ invalidTokens: ['dead-token'], invalidFids: [] });
  });

  test('nothing to send returns empty and never calls the SDK', async () => {
    const result = await sendFcmToIdentifiers({ tokens: [], fids: [] }, { type: 'TEST' });

    expect(result).toEqual({ invalidTokens: [], invalidFids: [] });
    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
  });
});
