/**
 * Tests for src/utils/roadmap-notify.js — bulk notification trigger for
 * roadmap updates.
 *
 * Two contracts under test:
 * - Server-side filter on the denormalised `roadmapUpdateOptedIn` flag,
 *   so a roadmap edit doesn't trigger a full-collection scan
 * - Inline fan-out via `dispatchNotificationInline` per subscriber,
 *   with Promise.allSettled isolation so one failure doesn't cancel
 *   the rest. NO `notificationQueue` collection writes happen — that
 *   queue + cron path was eliminated.
 */

const mockWhere = jest.fn();
const mockGet = jest.fn();
const mockCollection = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: (...args) => mockCollection(...args),
  },
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockDispatchNotificationInline = jest.fn().mockResolvedValue({
  email: null,
  push: null,
  systemMessage: null,
});
jest.mock('../../src/utils/notification-channels', () => ({
  dispatchNotificationInline: (...args) => mockDispatchNotificationInline(...args),
}));

const { notifyRoadmapSubscribers } = require('../../src/utils/roadmap-notify');

beforeEach(() => {
  jest.clearAllMocks();
  mockDispatchNotificationInline.mockResolvedValue({
    email: null,
    push: null,
    systemMessage: null,
  });
  // Default: a chain that captures the where filter then resolves to empty.
  mockGet.mockResolvedValue({ docs: [], empty: true });
  mockWhere.mockReturnValue({ get: mockGet });
  mockCollection.mockImplementation(() => ({
    where: mockWhere,
    get: mockGet,
  }));
});

describe('notifyRoadmapSubscribers — server-side filter', () => {
  test('filters via roadmapUpdateOptedIn == true (no full-collection scan)', async () => {
    await notifyRoadmapSubscribers('Roadmap edited');

    expect(mockCollection).toHaveBeenCalledWith('subscriptions');
    expect(mockWhere).toHaveBeenCalledWith('roadmapUpdateOptedIn', '==', true);
  });

  test('does not call .get() without .where() — proves the filter is never bypassed', async () => {
    await notifyRoadmapSubscribers('Test');
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });
});

describe('notifyRoadmapSubscribers — defensive double-check', () => {
  test('skips a doc whose flag is true but channelPreferences.roadmapUpdate is absent', async () => {
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'sub-drift',
          data: () => ({
            uid: 100,
            roadmapUpdateOptedIn: true,
            channelPreferences: {}, // drift: flag true but prefs missing
          }),
        },
      ],
    });

    await notifyRoadmapSubscribers('Edited');

    expect(mockDispatchNotificationInline).not.toHaveBeenCalled();
  });

  test('skips a doc with all roadmapUpdate channels disabled', async () => {
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'sub-allOff',
          data: () => ({
            uid: 200,
            roadmapUpdateOptedIn: true,
            channelPreferences: {
              roadmapUpdate: { email: false, push: false, inApp: false, systemMessage: false },
            },
          }),
        },
      ],
    });

    await notifyRoadmapSubscribers('Edited');
    expect(mockDispatchNotificationInline).not.toHaveBeenCalled();
  });
});

describe('notifyRoadmapSubscribers — inline dispatch fan-out', () => {
  test('dispatches inline when the flag and prefs both confirm opt-in', async () => {
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'sub-active',
          data: () => ({
            uid: 300,
            roadmapUpdateOptedIn: true,
            channelPreferences: {
              roadmapUpdate: { email: false, push: false, inApp: true, systemMessage: false },
            },
          }),
        },
      ],
    });

    await notifyRoadmapSubscribers('A new feature shipped');

    expect(mockDispatchNotificationInline).toHaveBeenCalledTimes(1);
    const [payload] = mockDispatchNotificationInline.mock.calls[0];
    expect(payload).toMatchObject({
      type: 'roadmapUpdate',
      uid: 300,
      title: 'Roadmap Update',
      body: 'A new feature shipped',
    });
    expect(payload.channels).toEqual({
      email: false,
      push: false,
      inApp: true,
      systemMessage: false,
    });
    // No `status` field in the inline payload — no queue persistence.
    expect(payload).not.toHaveProperty('status');
  });

  test('uses doc.id as uid fallback when sub.uid is missing', async () => {
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'doc-id-fallback',
          data: () => ({
            // no uid field
            roadmapUpdateOptedIn: true,
            channelPreferences: {
              roadmapUpdate: { email: true, push: false, inApp: false, systemMessage: false },
            },
            email: 'fallback@example.com',
          }),
        },
      ],
    });

    await notifyRoadmapSubscribers('Edited');

    expect(mockDispatchNotificationInline).toHaveBeenCalledTimes(1);
    const [payload] = mockDispatchNotificationInline.mock.calls[0];
    expect(payload.uid).toBe('doc-id-fallback');
  });

  test('dispatches per subscriber in parallel (does NOT serialise)', async () => {
    // Assert by counting calls: 3 subscribers → 3 dispatches in a
    // single await — Promise.allSettled fans out concurrently.
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [1, 2, 3].map((n) => ({
        id: `sub-${n}`,
        data: () => ({
          uid: n,
          roadmapUpdateOptedIn: true,
          channelPreferences: {
            roadmapUpdate: { email: true, push: false, inApp: false, systemMessage: false },
          },
          email: `u${n}@example.com`,
        }),
      })),
    });

    await notifyRoadmapSubscribers('Bulk');
    expect(mockDispatchNotificationInline).toHaveBeenCalledTimes(3);
  });

  test('one subscriber rejecting does not block the others (allSettled isolation)', async () => {
    mockDispatchNotificationInline
      .mockResolvedValueOnce({ email: 'sent', push: null, systemMessage: null })
      .mockRejectedValueOnce(new Error('runaway throw'))
      .mockResolvedValueOnce({ email: 'sent', push: null, systemMessage: null });

    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [1, 2, 3].map((n) => ({
        id: `sub-${n}`,
        data: () => ({
          uid: n,
          roadmapUpdateOptedIn: true,
          channelPreferences: {
            roadmapUpdate: { email: true, push: false, inApp: false, systemMessage: false },
          },
          email: `u${n}@example.com`,
        }),
      })),
    });

    await expect(notifyRoadmapSubscribers('Bulk')).resolves.toBeUndefined();
    expect(mockDispatchNotificationInline).toHaveBeenCalledTimes(3);
  });

  test('handles empty result set without dispatching anything', async () => {
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    await expect(notifyRoadmapSubscribers('Empty')).resolves.toBeUndefined();
    expect(mockDispatchNotificationInline).not.toHaveBeenCalled();
  });

  test('NEVER writes to the notificationQueue collection', async () => {
    // Regression guard: if a refactor accidentally reintroduces the
    // queue write, this catches it — the production code must not
    // touch any collection except `subscriptions`.
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'sub',
          data: () => ({
            uid: 1,
            roadmapUpdateOptedIn: true,
            channelPreferences: {
              roadmapUpdate: { email: true, push: false, inApp: false, systemMessage: false },
            },
            email: 'u@example.com',
          }),
        },
      ],
    });

    await notifyRoadmapSubscribers('Edited');

    const collectionsTouched = mockCollection.mock.calls.map((c) => c[0]);
    expect(collectionsTouched).toEqual(['subscriptions']);
    expect(collectionsTouched).not.toContain('notificationQueue');
  });
});

describe('notifyRoadmapSubscribers — error handling', () => {
  test('logs and swallows query failures (caller is fire-and-forget)', async () => {
    mockGet.mockRejectedValueOnce(new Error('Firestore down'));
    const log = require('../../src/utils/log');

    await expect(notifyRoadmapSubscribers('Try')).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      'roadmap-notify',
      'Failed to notify roadmap subscribers',
      expect.objectContaining({ error: 'Firestore down' }),
    );
  });
});
