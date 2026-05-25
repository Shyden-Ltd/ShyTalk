/* eslint-disable sonarjs/pseudo-random -- test mock doc-id generation;
   not security-sensitive. */
/**
 * Tests for roadmap update notifications.
 *
 * When the public roadmap JSON changes (new features done, phases updated),
 * subscribers who opted into roadmapUpdate notifications must be notified
 * via their configured channels (email, push, inApp, systemMessage).
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
      batch: jest.fn(() => {
        const pending = [];
        return {
          set: jest.fn((ref, data) => {
            pending.push({ path: ref._path, data });
          }),
          commit: jest.fn(async () => {
            for (const { path, data } of pending) {
              store[path] = data;
            }
          }),
        };
      }),
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

jest.mock('../../src/utils/helpers', () => ({
  now: jest.fn(() => 1709913600000),
}));

const { _store, _reset } = require('../../src/utils/firebase');

beforeEach(() => {
  _reset();
  jest.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────

describe('notifyRoadmapSubscribers', () => {
  let notifyRoadmapSubscribers;

  beforeAll(() => {
    // The function we're testing — it should be exported from a module
    // that we'll create as part of the implementation
    notifyRoadmapSubscribers = require('../../src/utils/roadmap-notify').notifyRoadmapSubscribers;
  });

  it('creates notification queue entries for subscribers with roadmapUpdate.inApp enabled', async () => {
    // Arrange: subscriber with inApp enabled
    _store['subscriptions/user1'] = {
      uid: 'user1',
      channelPreferences: {
        roadmapUpdate: { email: false, push: false, inApp: true, systemMessage: false },
      },
    };

    // Act
    await notifyRoadmapSubscribers('New feature shipped: voice rooms!');

    // Assert: a notification queue entry was created
    const queueEntries = Object.entries(_store).filter(([k]) => k.startsWith('notificationQueue/'));
    expect(queueEntries.length).toBeGreaterThanOrEqual(1);

    const [, entry] = queueEntries[0];
    expect(entry.type).toBe('roadmapUpdate');
    expect(entry.uid).toBe('user1');
    expect(entry.status).toBe('queued');
    expect(entry.title).toContain('Roadmap');
    expect(entry.body).toContain('voice rooms');
  });

  it('creates notification with email channel when subscriber has roadmapUpdate.email enabled', async () => {
    _store['subscriptions/user2'] = {
      uid: 'user2',
      email: 'user2@test.com',
      channelPreferences: {
        roadmapUpdate: { email: true, push: false, inApp: true, systemMessage: false },
      },
    };

    await notifyRoadmapSubscribers('Phase 3 complete');

    const queueEntries = Object.entries(_store).filter(([k]) => k.startsWith('notificationQueue/'));
    expect(queueEntries.length).toBeGreaterThanOrEqual(1);

    const [, entry] = queueEntries[0];
    expect(entry.channels.email).toBe(true);
    expect(entry.email).toBe('user2@test.com');
  });

  it('does NOT create notifications for subscribers with roadmapUpdate disabled', async () => {
    _store['subscriptions/user3'] = {
      uid: 'user3',
      channelPreferences: {
        roadmapUpdate: { email: false, push: false, inApp: false, systemMessage: false },
      },
    };

    await notifyRoadmapSubscribers('Minor update');

    const queueEntries = Object.entries(_store).filter(([k]) => k.startsWith('notificationQueue/'));
    expect(queueEntries.length).toBe(0);
  });

  it('does NOT create notifications for subscribers without roadmapUpdate preference', async () => {
    _store['subscriptions/user4'] = {
      uid: 'user4',
      channelPreferences: {
        suggestionAccepted: { email: true, push: false, inApp: true, systemMessage: false },
      },
    };

    await notifyRoadmapSubscribers('Another update');

    const queueEntries = Object.entries(_store).filter(([k]) => k.startsWith('notificationQueue/'));
    expect(queueEntries.length).toBe(0);
  });

  it('handles multiple subscribers correctly', async () => {
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

    const queueEntries = Object.entries(_store).filter(([k]) => k.startsWith('notificationQueue/'));
    // userA (inApp) + userB (all channels) = 2 entries. userC opted out = 0.
    expect(queueEntries.length).toBe(2);
  });

  it('does not crash when there are no subscribers', async () => {
    // No subscriptions in store
    await expect(notifyRoadmapSubscribers('No one listening')).resolves.not.toThrow();
  });

  it('includes the update message in the notification body', async () => {
    _store['subscriptions/user5'] = {
      uid: 'user5',
      channelPreferences: {
        roadmapUpdate: { email: false, push: false, inApp: true, systemMessage: false },
      },
    };

    const message = 'Voice rooms are now live! Join a room and start chatting.';
    await notifyRoadmapSubscribers(message);

    const queueEntries = Object.entries(_store).filter(([k]) => k.startsWith('notificationQueue/'));
    expect(queueEntries[0][1].body).toBe(message);
  });
});
