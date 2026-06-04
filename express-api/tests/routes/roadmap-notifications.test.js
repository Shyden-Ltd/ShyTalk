/* eslint-disable sonarjs/pseudo-random -- test mock doc-id generation;
   not security-sensitive. */
/**
 * Tests for roadmap update notifications.
 *
 * When the public roadmap JSON changes (new features done, phases updated),
 * subscribers who opted into roadmapUpdate notifications must be notified
 * via their configured channels (email, push, inApp, systemMessage).
 *
 * The dispatch path is INLINE — `notifyRoadmapSubscribers` calls
 * `dispatchNotificationInline` per subscriber via Promise.allSettled.
 * No persistent `notificationQueue` collection writes happen; the
 * cron-based queue mechanism was eliminated.
 */

// Firebase mock — imported values used by the mocked module below

// ── Mocks ──────────────────────────────────────────────────────
jest.mock('../../src/utils/firebase', () => {
  const store = {};
  const mockDoc = (path) => ({
    get: jest.fn(async () => ({
      exists: !!store[path],
      data: () => store[path] || null,
      id: path.split('/').pop(),
    })),
    set: jest.fn(async (data) => {
      store[path] = data;
    }),
    update: jest.fn(async (data) => {
      store[path] = { ...store[path], ...data };
    }),
  });

  const mockCollection = (name) => ({
    where: jest.fn().mockReturnThis(),
    get: jest.fn(async () => ({
      empty: !Object.keys(store).some((k) => k.startsWith(name + '/')),
      docs: Object.entries(store)
        .filter(([k]) => k.startsWith(name + '/'))
        .map(([k, v]) => ({
          id: k.split('/').pop(),
          data: () => v,
          ref: {
            update: jest.fn(async (d) => {
              store[k] = { ...store[k], ...d };
            }),
          },
        })),
    })),
    doc: jest.fn((id) => {
      const path = id
        ? `${name}/${id}`
        : `${name}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const d = mockDoc(path);
      d._path = path;
      return d;
    }),
  });

  return {
    db: {
      collection: jest.fn((name) => mockCollection(name)),
      doc: jest.fn((path) => mockDoc(path)),
    },
    _store: store,
    _reset: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
  };
});

jest.mock('../../src/utils/log', () => ({
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

const { _store, _reset } = require('../../src/utils/firebase');

beforeEach(() => {
  _reset();
  jest.clearAllMocks();
  mockDispatchNotificationInline.mockResolvedValue({
    email: null,
    push: null,
    systemMessage: null,
  });
});

// ── Tests ──────────────────────────────────────────────────────

describe('notifyRoadmapSubscribers', () => {
  let notifyRoadmapSubscribers;

  beforeAll(() => {
    notifyRoadmapSubscribers = require('../../src/utils/roadmap-notify').notifyRoadmapSubscribers;
  });

  it('dispatches inline for subscribers with roadmapUpdate.inApp enabled', async () => {
    _store['subscriptions/user1'] = {
      uid: 'user1',
      channelPreferences: {
        roadmapUpdate: { email: false, push: false, inApp: true, systemMessage: false },
      },
    };

    await notifyRoadmapSubscribers('New feature shipped: voice rooms!');

    expect(mockDispatchNotificationInline).toHaveBeenCalledTimes(1);
    const [payload] = mockDispatchNotificationInline.mock.calls[0];
    expect(payload.type).toBe('roadmapUpdate');
    expect(payload.uid).toBe('user1');
    expect(payload.title).toContain('Roadmap');
    expect(payload.body).toContain('voice rooms');
  });

  it('passes email channel flag and recipient when subscriber has roadmapUpdate.email enabled', async () => {
    _store['subscriptions/user2'] = {
      uid: 'user2',
      email: 'user2@test.com',
      channelPreferences: {
        roadmapUpdate: { email: true, push: false, inApp: true, systemMessage: false },
      },
    };

    await notifyRoadmapSubscribers('Phase 3 complete');

    expect(mockDispatchNotificationInline).toHaveBeenCalledTimes(1);
    const [payload] = mockDispatchNotificationInline.mock.calls[0];
    expect(payload.channels.email).toBe(true);
    expect(payload.email).toBe('user2@test.com');
  });

  it('does NOT dispatch for subscribers with all roadmapUpdate channels disabled', async () => {
    _store['subscriptions/user3'] = {
      uid: 'user3',
      channelPreferences: {
        roadmapUpdate: { email: false, push: false, inApp: false, systemMessage: false },
      },
    };

    await notifyRoadmapSubscribers('Minor update');

    expect(mockDispatchNotificationInline).not.toHaveBeenCalled();
  });

  it('does NOT dispatch for subscribers without a roadmapUpdate preference', async () => {
    _store['subscriptions/user4'] = {
      uid: 'user4',
      channelPreferences: {
        suggestionAccepted: { email: true, push: false, inApp: true, systemMessage: false },
      },
    };

    await notifyRoadmapSubscribers('Another update');

    expect(mockDispatchNotificationInline).not.toHaveBeenCalled();
  });

  it('handles multiple subscribers correctly (per-subscriber fan-out)', async () => {
    _store['subscriptions/userA'] = {
      uid: 'userA',
      channelPreferences: {
        roadmapUpdate: { email: false, push: false, inApp: true, systemMessage: false },
      },
    };
    _store['subscriptions/userB'] = {
      uid: 'userB',
      email: 'b@test.com',
      channelPreferences: {
        roadmapUpdate: { email: true, push: true, inApp: true, systemMessage: true },
      },
    };
    _store['subscriptions/userC'] = {
      uid: 'userC',
      channelPreferences: {
        roadmapUpdate: { email: false, push: false, inApp: false, systemMessage: false },
      },
    };

    await notifyRoadmapSubscribers('Big release');

    // userA (inApp) + userB (all channels) = 2 dispatches. userC opted out = 0.
    expect(mockDispatchNotificationInline).toHaveBeenCalledTimes(2);
  });

  it('does not crash when there are no subscribers', async () => {
    await expect(notifyRoadmapSubscribers('No one listening')).resolves.not.toThrow();
    expect(mockDispatchNotificationInline).not.toHaveBeenCalled();
  });

  it('includes the update message in the dispatch body', async () => {
    _store['subscriptions/user5'] = {
      uid: 'user5',
      channelPreferences: {
        roadmapUpdate: { email: false, push: false, inApp: true, systemMessage: false },
      },
    };

    const message = 'Voice rooms are now live! Join a room and start chatting.';
    await notifyRoadmapSubscribers(message);

    expect(mockDispatchNotificationInline).toHaveBeenCalledTimes(1);
    const [payload] = mockDispatchNotificationInline.mock.calls[0];
    expect(payload.body).toBe(message);
  });

  it('NEVER writes to the notificationQueue collection (regression guard)', async () => {
    // Without the queue + cron, the production code path must not
    // touch `notificationQueue` at all. If a refactor reintroduces
    // the queue write (e.g., by accident or by reverting), this
    // catches it — the only collection touched is `subscriptions`.
    _store['subscriptions/userQ'] = {
      uid: 'userQ',
      channelPreferences: {
        roadmapUpdate: { email: false, push: false, inApp: true, systemMessage: false },
      },
    };

    await notifyRoadmapSubscribers('Regression');

    const queueEntries = Object.entries(_store).filter(([k]) => k.startsWith('notificationQueue/'));
    expect(queueEntries).toHaveLength(0);
  });
});
