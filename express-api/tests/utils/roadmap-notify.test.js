/**
 * Tests for src/utils/roadmap-notify.js — bulk notification trigger for
 * roadmap updates.
 *
 * Phase 2A finding #2: previously the trigger read the entire subscriptions
 * collection on every roadmap edit, then filtered opted-in subscribers
 * client-side. The denormalised `roadmapUpdateOptedIn` flag now lets
 * Firestore filter server-side, eliminating the per-edit quota grenade.
 *
 * These tests pin both the wire format (the equality filter is on
 * `roadmapUpdateOptedIn`, not on missing-field tolerance) and the defensive
 * client-side double-check (so a doc whose flag has drifted from prefs
 * doesn't get notified anyway).
 */

const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);
const mockBatch = jest.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit }));

const mockWhere = jest.fn();
const mockGet = jest.fn();
const mockCollection = jest.fn();
const mockDoc = jest.fn(() => ({ id: 'auto-doc-id' }));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: (...args) => mockCollection(...args),
    batch: () => mockBatch(),
  },
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/helpers', () => ({
  now: jest.fn(() => 1700000000000),
}));

const { notifyRoadmapSubscribers } = require('../../src/utils/roadmap-notify');

beforeEach(() => {
  jest.clearAllMocks();
  // Default: a chain that captures the where filter then resolves to empty.
  mockGet.mockResolvedValue({ docs: [], empty: true });
  mockWhere.mockReturnValue({
    get: mockGet,
    doc: mockDoc,
  });
  mockCollection.mockImplementation(() => ({
    where: mockWhere,
    get: mockGet,
    doc: mockDoc,
  }));
});

describe('notifyRoadmapSubscribers — server-side filter (Phase 2A finding #2)', () => {
  test('filters via roadmapUpdateOptedIn == true (no full-collection scan)', async () => {
    await notifyRoadmapSubscribers('Roadmap edited');

    // The new wire format: server-side equality filter on the denormalised flag.
    expect(mockCollection).toHaveBeenCalledWith('subscriptions');
    expect(mockWhere).toHaveBeenCalledWith('roadmapUpdateOptedIn', '==', true);
  });

  test('does not call .get() WITHOUT a .where() — proves we never bypass the filter', async () => {
    // The previous (buggy) code did `db.collection('subscriptions').get()`
    // directly. After the fix, every call path must go through .where(...).
    // This test catches a regression that drops the filter.
    await notifyRoadmapSubscribers('Test');

    // mockCollection returns a chain whose .get is the same mock as
    // mockWhere().get. Either way, the assertion is that .where was hit.
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });
});

describe('notifyRoadmapSubscribers — defensive double-check', () => {
  test('skips a doc whose denormalised flag is true but prefs are absent (drift recovery)', async () => {
    mockGet.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'sub-drift',
          data: () => ({
            uid: 100,
            roadmapUpdateOptedIn: true,
            // channelPreferences absent or roadmapUpdate undefined
            channelPreferences: {},
          }),
        },
      ],
    });

    await notifyRoadmapSubscribers('Edited');

    // No notificationQueue set should have been written for this drifted doc.
    expect(mockBatchSet).not.toHaveBeenCalled();
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
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  test('writes a notificationQueue entry when the flag and prefs both confirm opt-in', async () => {
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

    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    const [, payload] = mockBatchSet.mock.calls[0];
    expect(payload).toMatchObject({
      type: 'roadmapUpdate',
      uid: 300,
      title: 'Roadmap Update',
      body: 'A new feature shipped',
      status: 'queued',
    });
    expect(payload.channels).toEqual({
      email: false,
      push: false,
      inApp: true,
      systemMessage: false,
    });
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  test('handles empty result set without throwing', async () => {
    mockGet.mockResolvedValueOnce({ empty: true, docs: [] });

    await expect(notifyRoadmapSubscribers('Empty')).resolves.toBeUndefined();
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
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
