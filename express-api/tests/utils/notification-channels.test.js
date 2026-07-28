const mockSendEmail = jest.fn();
const mockSendFcmToTokens = jest.fn();
const mockSendSystemPm = jest.fn();
const mockDocUpdate = jest.fn();
const mockDoc = jest.fn(() => ({ update: mockDocUpdate }));
// The in-app channel writes a `notifications` doc (SHY-0246); the mock only
// stubbed db.doc before, because no code path used db.collection here.
const mockCollectionAdd = jest.fn();
const mockCollection = jest.fn(() => ({ add: mockCollectionAdd }));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
    collection: (...args) => mockCollection(...args),
  },
}));

jest.mock('../../src/utils/email', () => ({
  sendEmail: (...args) => mockSendEmail(...args),
}));

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: (...args) => mockSendFcmToTokens(...args),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: (...args) => mockSendSystemPm(...args),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { dispatchNotificationInline } = require('../../src/utils/notification-channels');
const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
  mockSendEmail.mockResolvedValue(undefined);
  mockSendFcmToTokens.mockResolvedValue([]);
  mockSendSystemPm.mockResolvedValue(undefined);
  mockDocUpdate.mockResolvedValue(undefined);
  mockCollectionAdd.mockResolvedValue({ id: 'notif-1' });
});

describe('dispatchNotificationInline — email channel', () => {
  test('sends email when channels.email is true and email is present', async () => {
    const result = await dispatchNotificationInline({
      channels: { email: true },
      email: 'user@example.com',
      title: 'Hi',
      body: 'Hello there',
      uid: 1,
    });

    expect(mockSendEmail).toHaveBeenCalledWith('user@example.com', 'Hi', '<p>Hello there</p>');
    expect(result.email).toBe('sent');
  });

  test('uses fallback subject when title is missing', async () => {
    await dispatchNotificationInline({
      channels: { email: true },
      email: 'user@example.com',
      body: 'Body',
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      'user@example.com',
      'ShyTalk Notification',
      '<p>Body</p>',
    );
  });

  test('returns failed and logs error when sendEmail throws', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP down'));

    const result = await dispatchNotificationInline({
      channels: { email: true },
      email: 'user@example.com',
      title: 'Hi',
      body: 'Hello',
      uid: 1,
    });

    expect(result.email).toBe('failed');
    expect(log.error).toHaveBeenCalledWith(
      'notification-channels',
      'Email send failed',
      expect.objectContaining({ uid: 1, error: 'SMTP down' }),
    );
  });

  test('skips email when channels.email is false (returns null)', async () => {
    const result = await dispatchNotificationInline({
      channels: { email: false },
      email: 'user@example.com',
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(result.email).toBeNull();
  });

  test('skips email when email address is missing (no recipient)', async () => {
    const result = await dispatchNotificationInline({
      channels: { email: true },
      email: null,
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(result.email).toBeNull();
  });
});

describe('dispatchNotificationInline — push channel', () => {
  test('sends FCM when channels.push is true and pushToken is present', async () => {
    const result = await dispatchNotificationInline({
      channels: { push: true },
      pushToken: 'token-abc',
      type: 'roadmapUpdate',
      title: 'Roadmap',
      body: 'New thing',
      relatedId: 'rid-1',
      uid: 1,
    });

    expect(mockSendFcmToTokens).toHaveBeenCalledWith(['token-abc'], {
      type: 'roadmapUpdate',
      title: 'Roadmap',
      body: 'New thing',
      relatedId: 'rid-1',
    });
    expect(result.push).toBe('sent');
  });

  test('clears invalid pushToken on subscriptions doc when FCM returns invalid tokens', async () => {
    mockSendFcmToTokens.mockResolvedValueOnce(['token-abc']);

    const result = await dispatchNotificationInline({
      channels: { push: true },
      pushToken: 'token-abc',
      uid: 'user123',
    });

    expect(mockDoc).toHaveBeenCalledWith('subscriptions/user123');
    expect(mockDocUpdate).toHaveBeenCalledWith({ pushToken: null });
    expect(result.push).toBe('sent');
  });

  test('does not touch subscriptions when no invalid tokens', async () => {
    mockSendFcmToTokens.mockResolvedValueOnce([]);

    await dispatchNotificationInline({
      channels: { push: true },
      pushToken: 'token-good',
      uid: 'user123',
    });

    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('does not crash when invalid-token cleanup write fails (best-effort)', async () => {
    mockSendFcmToTokens.mockResolvedValueOnce(['token-bad']);
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore down'));

    const result = await dispatchNotificationInline({
      channels: { push: true },
      pushToken: 'token-bad',
      uid: 'user123',
    });

    // Push itself still counts as sent — the cleanup is best-effort.
    expect(result.push).toBe('sent');
    expect(log.warn).toHaveBeenCalledWith(
      'notification-channels',
      'Failed to clear invalid pushToken (best-effort)',
      expect.objectContaining({ uid: 'user123', error: 'Firestore down' }),
    );
  });

  test('returns failed when sendFcmToTokens throws', async () => {
    mockSendFcmToTokens.mockRejectedValueOnce(new Error('FCM 503'));

    const result = await dispatchNotificationInline({
      channels: { push: true },
      pushToken: 'token',
      uid: 1,
    });

    expect(result.push).toBe('failed');
    expect(log.error).toHaveBeenCalledWith(
      'notification-channels',
      'FCM send failed',
      expect.objectContaining({ uid: 1, error: 'FCM 503' }),
    );
  });

  test('skips push when channels.push is false', async () => {
    const result = await dispatchNotificationInline({
      channels: { push: false },
      pushToken: 'token',
    });

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
    expect(result.push).toBeNull();
  });

  test('skips push when pushToken is missing', async () => {
    const result = await dispatchNotificationInline({
      channels: { push: true },
      pushToken: null,
    });

    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
    expect(result.push).toBeNull();
  });
});

describe('dispatchNotificationInline — systemMessage channel', () => {
  test('sends system PM when channels.systemMessage is true and uid is present', async () => {
    const result = await dispatchNotificationInline({
      channels: { systemMessage: true },
      uid: 42,
      body: 'You have a message',
    });

    expect(mockSendSystemPm).toHaveBeenCalledWith('42', 'You have a message');
    expect(result.systemMessage).toBe('sent');
  });

  test('falls back to title when body is missing', async () => {
    await dispatchNotificationInline({
      channels: { systemMessage: true },
      uid: 42,
      title: 'Title-only',
    });

    expect(mockSendSystemPm).toHaveBeenCalledWith('42', 'Title-only');
  });

  test('falls back to default text when both body and title are missing', async () => {
    await dispatchNotificationInline({
      channels: { systemMessage: true },
      uid: 42,
    });

    expect(mockSendSystemPm).toHaveBeenCalledWith('42', 'You have a new notification');
  });

  test('returns failed when sendSystemPm throws', async () => {
    mockSendSystemPm.mockRejectedValueOnce(new Error('PM service down'));

    const result = await dispatchNotificationInline({
      channels: { systemMessage: true },
      uid: 42,
      body: 'Test',
    });

    expect(result.systemMessage).toBe('failed');
    expect(log.error).toHaveBeenCalledWith(
      'notification-channels',
      'System PM failed',
      expect.objectContaining({ uid: 42, error: 'PM service down' }),
    );
  });

  test('skips system PM when channels.systemMessage is false', async () => {
    const result = await dispatchNotificationInline({
      channels: { systemMessage: false },
      uid: 42,
    });

    expect(mockSendSystemPm).not.toHaveBeenCalled();
    expect(result.systemMessage).toBeNull();
  });

  test('skips system PM when uid is missing', async () => {
    const result = await dispatchNotificationInline({
      channels: { systemMessage: true },
      uid: null,
      body: 'No uid',
    });

    expect(mockSendSystemPm).not.toHaveBeenCalled();
    expect(result.systemMessage).toBeNull();
  });
});

describe('dispatchNotificationInline — multi-channel + edge cases', () => {
  test('all three channels fire when all three are enabled', async () => {
    const result = await dispatchNotificationInline({
      channels: { email: true, push: true, systemMessage: true },
      email: 'u@example.com',
      pushToken: 'token',
      uid: 7,
      title: 'Multi',
      body: 'Multi-channel',
    });

    expect(mockSendEmail).toHaveBeenCalled();
    expect(mockSendFcmToTokens).toHaveBeenCalled();
    expect(mockSendSystemPm).toHaveBeenCalled();
    expect(result).toEqual({
      email: 'sent',
      push: 'sent',
      systemMessage: 'sent',
      // SHY-0246 added a fourth channel; not requested here, so null.
      inApp: null,
    });
  });

  test('one channel failing does not block the others', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP down'));

    const result = await dispatchNotificationInline({
      channels: { email: true, push: true, systemMessage: true },
      email: 'u@example.com',
      pushToken: 'token',
      uid: 7,
    });

    expect(result.email).toBe('failed');
    expect(result.push).toBe('sent');
    expect(result.systemMessage).toBe('sent');
  });

  test('no channels enabled → all nulls, no side effects', async () => {
    const result = await dispatchNotificationInline({
      channels: {},
      email: 'u@example.com',
      pushToken: 'token',
      uid: 7,
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
    expect(mockSendSystemPm).not.toHaveBeenCalled();
    expect(result).toEqual({
      email: null,
      push: null,
      systemMessage: null,
      inApp: null,
    });
  });

  test('handles a fully-missing notif object without throwing', async () => {
    const result = await dispatchNotificationInline(undefined);

    expect(result).toEqual({
      email: null,
      push: null,
      systemMessage: null,
      inApp: null,
    });
  });

  test('logs structured info line at the end with correlation ID', async () => {
    await dispatchNotificationInline({
      channels: { email: true },
      email: 'u@example.com',
      uid: 7,
      type: 'roadmapUpdate',
    });

    expect(log.info).toHaveBeenCalledWith(
      'notification-channels',
      'Notification dispatched',
      expect.objectContaining({
        correlationId: expect.stringMatching(/^notif-\d+-[0-9a-f]+$/),
        uid: 7,
        type: 'roadmapUpdate',
        results: expect.any(Object),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// SHY-0246 — the in-app channel
//
// This block replaces a test titled "inApp channel flag is accepted in
// payload but has no dispatch side effect", which asserted the DEFECT as
// intended behaviour. Its stated rationale — that "in-app notifications are
// surfaced by clients reading their own paths, not by server-side dispatch" —
// is false: the only in-app inbox is GET /api/notifications, which reads the
// `notifications` collection by `uid`, and nothing wrote a doc for these.
// Because the shipped DEFAULT roadmap preference is in-app only
// (routes/subscriptions.js:21), every default-configured subscriber was
// dispatched and received nothing on any channel, while the dispatcher
// returned success and logged "Notification dispatched".
// ═══════════════════════════════════════════════════════════════

describe('dispatchNotificationInline — inApp channel', () => {
  test('writes a notifications doc when channels.inApp is true and uid is present', async () => {
    const result = await dispatchNotificationInline({
      channels: { inApp: true },
      uid: 42,
      type: 'roadmapUpdate',
      title: 'Roadmap Update',
      body: 'We shipped voice rooms',
      relatedId: 'sug-9',
    });

    expect(mockCollection).toHaveBeenCalledWith('notifications');
    expect(mockCollectionAdd).toHaveBeenCalledTimes(1);
    // Shape must match what the inbox reads (suggestions-notifications.js:29
    // filters on `uid`) and what existing rows carry (suggestions.js:1422).
    expect(mockCollectionAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        // RAW uid (42, not '42'): the inbox query
        // .where('uid','==',req.auth.uniqueId) is type-sensitive and
        // auth.js:90 resolves uniqueId via parseInt.
        uid: 42,
        userId: 42,
        recipientUid: 42,
        type: 'roadmapUpdate',
        title: 'Roadmap Update',
        body: 'We shipped voice rooms',
        relatedId: 'sug-9',
        isRead: false,
        createdAt: expect.any(Number),
      }),
    );
    expect(result.inApp).toBe('sent');
  });

  test('skips the in-app write when channels.inApp is false', async () => {
    const result = await dispatchNotificationInline({
      channels: { inApp: false },
      uid: 42,
      body: 'nope',
    });

    expect(mockCollectionAdd).not.toHaveBeenCalled();
    expect(result.inApp).toBeNull();
  });

  test('skips the in-app write when uid is missing (no addressee)', async () => {
    const result = await dispatchNotificationInline({
      channels: { inApp: true },
      body: 'nobody to address',
    });

    expect(mockCollectionAdd).not.toHaveBeenCalled();
    expect(result.inApp).toBeNull();
  });

  test('returns failed and logs when the notifications write throws', async () => {
    mockCollectionAdd.mockRejectedValueOnce(new Error('firestore down'));

    const result = await dispatchNotificationInline({
      channels: { inApp: true },
      uid: 42,
      body: 'boom',
    });

    expect(result.inApp).toBe('failed');
    expect(log.error).toHaveBeenCalledWith(
      'notification-channels',
      expect.stringContaining('In-app'),
      expect.objectContaining({ uid: 42, error: 'firestore down' }),
    );
  });

  test('a failing in-app write does not block the other channels', async () => {
    mockCollectionAdd.mockRejectedValueOnce(new Error('firestore down'));

    const result = await dispatchNotificationInline({
      channels: { inApp: true, email: true, push: true, systemMessage: true },
      uid: 42,
      email: 'u@example.com',
      pushToken: 'tok',
      body: 'still deliver the rest',
    });

    expect(result.inApp).toBe('failed');
    expect(result.email).toBe('sent');
    expect(result.push).toBe('sent');
    expect(result.systemMessage).toBe('sent');
  });

  test('the DEFAULT roadmap preference (in-app only) actually delivers something', async () => {
    // routes/subscriptions.js:21 ships this exact preference object. Before
    // SHY-0246 this combination produced no side effect whatsoever, so the
    // default configuration was a guaranteed silent no-op.
    const result = await dispatchNotificationInline({
      channels: { email: false, push: false, inApp: true, systemMessage: false },
      uid: 7,
      type: 'roadmapUpdate',
      title: 'Roadmap Update',
      body: 'Something changed',
    });

    expect(mockCollectionAdd).toHaveBeenCalledTimes(1);
    expect(result.inApp).toBe('sent');
    // and specifically NOT via a channel the user did not ask for
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
    expect(mockSendSystemPm).not.toHaveBeenCalled();
  });
});
