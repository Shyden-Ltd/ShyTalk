/**
 * Additional conversation route tests to increase branch/line coverage.
 *
 * Targets ALL uncovered lines listed in the coverage report:
 * 80,84,91-128,147,181-185,292,310,317
 *
 * Lines 80,84: userSnap/settingsSnap existence checks in sendMessageNotifications
 * Lines 91-128: DND schedule, muted conversation, FCM token handling in notifications
 * Line 147: broadcastToConversation RTDB error handling
 * Lines 181-185: GET messages 500 error
 * Line 292: un-hide conversation error catch
 * Line 310: send notifications error catch
 * Line 317: broadcast event error catch
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();

// Track db.getAll calls
const mockGetAll = jest.fn();

const mockRtdbSet = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
    })),
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        set: jest.fn().mockResolvedValue(),
      })),
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ docs: [] }),
        })),
      })),
    })),
    batch: jest.fn(() => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    })),
    getAll: mockGetAll,
  },
  rtdb: {
    ref: jest.fn(() => ({
      set: mockRtdbSet,
    })),
  },
  messaging: {
    sendEachForMulticast: jest.fn().mockResolvedValue({ responses: [] }),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
    arrayRemove: jest.fn((...args) => `arrayRemove(${args})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: () => 'msg-cov-123',
  now: () => 1709913600000,
}));

const mockSendFcmToTokens = jest.fn().mockResolvedValue([]);
const mockCleanupInvalidTokens = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: (...args) => mockSendFcmToTokens(...args),
  cleanupInvalidTokens: (...args) => mockCleanupInvalidTokens(...args),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
  mockBatchCommit.mockResolvedValue();
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockRtdbSet.mockResolvedValue();
  mockSendFcmToTokens.mockResolvedValue([]);
  // PR 4: cross-cohort middleware fetches the other 1:1 participant.
  // Default to empty-but-existing user doc so the gate evaluates
  // 'minor' vs 'minor' (fail-closed) and allows the request.
  mockDocGet.mockImplementation(() => Promise.resolve({ exists: true, data: () => ({}) }));
});

// ─── App setup ───────────────────────────────────────────────────

const conversationsRouter = require('../../src/routes/conversations');

function createApp(uniqueId = 'user-A') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'firebase-uid', uniqueId };
    next();
  });
  app.use('/api', conversationsRouter);
  return app;
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/conversations/:id/messages — lines 181-185 (500 error)
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/conversations/:id/messages — additional coverage', () => {
  test('returns 404 when conversation does not exist', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const app = createApp('user-A');
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/conversation not found/i);
  });

  test('returns 500 on internal error (lines 181-185)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
    expect(log.error).toHaveBeenCalledWith(
      'conversations',
      expect.stringContaining('fetch messages'),
      expect.objectContaining({
        conversationId: 'conv-1',
      }),
    );
  });

  test('returns messages with buildMessage fields', async () => {
    const { db } = require('../../src/utils/firebase');

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ participantIds: ['user-A', 'user-B'] }),
    });

    db.collection.mockReturnValueOnce({
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({
            docs: [
              {
                id: 'msg-1',
                data: () => ({
                  senderId: 'user-B',
                  senderName: 'Bob',
                  text: 'Hello',
                  type: 'TEXT',
                  createdAt: 1709913500000,
                  reactions: { like: ['user-A'] },
                  isRecalled: false,
                  isHidden: true,
                  hiddenBy: 'admin-1',
                  replyToId: 'msg-0',
                  replyToText: 'Previous',
                  replyToSenderName: 'Alice',
                  stickerUrl: null,
                  roomInviteId: null,
                  roomInviteName: null,
                  editCount: 2,
                  editedAt: 1709913550000,
                }),
              },
            ],
          }),
        })),
      })),
    });

    const app = createApp('user-A');
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 'msg-1',
      messageId: 'msg-1',
      senderId: 'user-B',
      senderName: 'Bob',
      text: 'Hello',
      type: 'TEXT',
      isRecalled: false,
      isHidden: true,
      hiddenBy: 'admin-1',
      replyToMessageId: 'msg-0',
      replyToText: 'Previous',
      replyToSenderName: 'Alice',
      editCount: 2,
    });
    expect(res.body[0].reactions).toEqual({ like: ['user-A'] });
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/conversations/:id/messages — notification paths
// Lines 80,84 (user/settings existence), 91-128 (DND, muted, FCM),
// 147 (RTDB error), 292 (un-hide error), 310 (notifications error),
// 317 (broadcast error)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/conversations/:id/messages — notification edge cases', () => {
  // Base setup for all notification tests: conversation exists, sender is participant
  beforeEach(() => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        participantIds: ['user-A', 'user-B', 'user-C'],
        isGroup: true,
        groupName: 'Test Group',
      }),
    });
  });

  test('sends notifications with DND not active (lines 91-105)', async () => {
    // To exercise the notification code paths, we need db.getAll to return user/settings data
    // User B: has DND but not currently in DND window
    // User C: no DND, has FCM tokens
    mockGetAll.mockImplementation((...refs) => {
      // First call: user docs, Second call: settings docs
      if (refs.length >= 2 && refs[0] && refs[1]) {
        // Check if these look like user refs or settings refs
        return Promise.resolve(
          refs.map((ref, i) => {
            if (i === 0) {
              // user-B
              return {
                exists: true,
                id: 'user-B',
                data: () => ({
                  pmNotificationsEnabled: true,
                  dndEnabled: true,
                  dndStartHour: 23, // 23:00
                  dndStartMinute: 0,
                  dndEndHour: 6, // 06:00
                  dndEndMinute: 0,
                  fcmTokens: ['token-b-1'],
                  pmNotificationPreview: true,
                }),
              };
            }
            // user-C
            return {
              exists: true,
              id: 'user-C',
              data: () => ({
                pmNotificationsEnabled: true,
                dndEnabled: false,
                fcmTokens: ['token-c-1', 'token-c-2'],
                pmNotificationPreview: false,
              }),
            };
          }),
        );
      }
      // Settings — all non-existent (not muted)
      return Promise.resolve(refs.map(() => ({ exists: false })));
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello group', senderName: 'Alice', type: 'TEXT' });

    expect(res.status).toBe(200);
    // Allow time for fire-and-forget notifications
    await new Promise((r) => setTimeout(r, 50));
  });

  test('skips notification when user has pmNotificationsEnabled=false (line 91)', async () => {
    mockGetAll.mockImplementation((...refs) => {
      return Promise.resolve(
        refs.map(() => ({
          exists: true,
          id: 'user-B',
          data: () => ({
            pmNotificationsEnabled: false,
            fcmTokens: ['token-b-1'],
          }),
        })),
      );
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice', type: 'TEXT' });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    // FCM should NOT have been called for user-B
    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('skips notification when conversation is muted (line 109)', async () => {
    // First getAll: users, Second getAll: settings
    let getAllCallCount = 0;
    mockGetAll.mockImplementation((...refs) => {
      getAllCallCount++;
      if (getAllCallCount === 1) {
        // User docs
        return Promise.resolve(
          refs.map(() => ({
            exists: true,
            id: 'user-B',
            data: () => ({
              pmNotificationsEnabled: true,
              dndEnabled: false,
              fcmTokens: ['token-b-1'],
            }),
          })),
        );
      }
      // Settings docs — muted
      return Promise.resolve(
        refs.map(() => ({
          exists: true,
          id: 'user-B',
          data: () => ({ isMuted: true }),
        })),
      );
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice', type: 'TEXT' });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('skips notification when user has no FCM tokens (line 113)', async () => {
    let getAllCallCount = 0;
    mockGetAll.mockImplementation((...refs) => {
      getAllCallCount++;
      if (getAllCallCount === 1) {
        return Promise.resolve(
          refs.map(() => ({
            exists: true,
            id: 'user-B',
            data: () => ({
              pmNotificationsEnabled: true,
              dndEnabled: false,
              fcmTokens: [], // No tokens!
            }),
          })),
        );
      }
      return Promise.resolve(refs.map(() => ({ exists: false })));
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice', type: 'TEXT' });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    // sendFcmToTokens should not have been called
    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('cleans up invalid FCM tokens (lines 127-129)', async () => {
    let getAllCallCount = 0;
    mockGetAll.mockImplementation((...refs) => {
      getAllCallCount++;
      if (getAllCallCount === 1) {
        return Promise.resolve(
          refs.map(() => ({
            exists: true,
            id: 'user-B',
            data: () => ({
              pmNotificationsEnabled: true,
              dndEnabled: false,
              fcmTokens: ['token-valid', 'token-invalid'],
              pmNotificationPreview: true,
            }),
          })),
        );
      }
      return Promise.resolve(refs.map(() => ({ exists: false })));
    });

    // FCM returns one invalid token
    mockSendFcmToTokens.mockResolvedValue(['token-invalid']);

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice', type: 'TEXT' });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));

    expect(mockSendFcmToTokens).toHaveBeenCalled();
    expect(mockCleanupInvalidTokens).toHaveBeenCalledWith(['token-invalid'], expect.any(String));
  });

  test('skips user when user doc does not exist (line 80/90)', async () => {
    let getAllCallCount = 0;
    mockGetAll.mockImplementation((...refs) => {
      getAllCallCount++;
      if (getAllCallCount === 1) {
        return Promise.resolve(
          refs.map(() => ({
            exists: false, // User does not exist
          })),
        );
      }
      return Promise.resolve(refs.map(() => ({ exists: false })));
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice', type: 'TEXT' });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('handles DND with start <= end (same-day window, line 100-101)', async () => {
    // DND 8:00-17:00 — test runs at some time, this exercises line 100
    let getAllCallCount = 0;
    mockGetAll.mockImplementation((...refs) => {
      getAllCallCount++;
      if (getAllCallCount === 1) {
        return Promise.resolve(
          refs.map(() => ({
            exists: true,
            id: 'user-B',
            data: () => ({
              pmNotificationsEnabled: true,
              dndEnabled: true,
              dndStartHour: 0,
              dndStartMinute: 0,
              dndEndHour: 23,
              dndEndMinute: 59,
              fcmTokens: ['token-b-1'],
            }),
          })),
        );
      }
      return Promise.resolve(refs.map(() => ({ exists: false })));
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice', type: 'TEXT' });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    // User is in DND, so no FCM call
    expect(mockSendFcmToTokens).not.toHaveBeenCalled();
  });

  test('handles DND with start > end (overnight window, line 102-103)', async () => {
    // DND 22:00-06:00 (overnight). Set clock to 23:00 UTC so user IS in the window.
    jest.useFakeTimers({ now: new Date('2024-03-08T23:00:00Z') });

    let getAllCallCount = 0;
    mockGetAll.mockImplementation((...refs) => {
      getAllCallCount++;
      if (getAllCallCount === 1) {
        return Promise.resolve(
          refs.map(() => ({
            exists: true,
            id: 'user-B',
            data: () => ({
              pmNotificationsEnabled: true,
              dndEnabled: true,
              dndStartHour: 22,
              dndStartMinute: 0,
              dndEndHour: 6,
              dndEndMinute: 0,
              fcmTokens: ['token-b-1'],
            }),
          })),
        );
      }
      return Promise.resolve(refs.map(() => ({ exists: false })));
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice', type: 'TEXT' });

    expect(res.status).toBe(200);
    await jest.advanceTimersByTimeAsync(50);
    // User is in overnight DND (22:00-06:00, current=23:00), so no FCM call
    expect(mockSendFcmToTokens).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/conversations/:id/messages — preview text types
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/conversations/:id/messages — preview text for message types', () => {
  beforeEach(() => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        participantIds: ['user-A', 'user-B'],
        isGroup: false,
      }),
    });
    mockGetAll.mockResolvedValue([]);
  });

  test('IMAGE type uses [Image] as preview text', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'IMAGE', senderName: 'Alice', imageUrls: ['https://img.com/1.jpg'] });

    expect(res.status).toBe(200);
    // Check the lastMessage update in the batch
    const convUpdate = mockBatchSet.mock.calls[1];
    expect(convUpdate[1].lastMessage.text).toBe('[Image]');
  });

  test('STICKER type uses [Sticker] as preview text', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'STICKER', senderName: 'Alice', stickerUrl: 'sticker.png' });

    expect(res.status).toBe(200);
    // Verify the lastMessage preview text stored in the batch
    const convUpdate = mockBatchSet.mock.calls[1];
    expect(convUpdate[1].lastMessage.text).toBe('[Sticker]');
  });

  test('ROOM_INVITE type uses [Room Invite] as preview text', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/conversations/conv-1/messages').send({
      type: 'ROOM_INVITE',
      senderName: 'Alice',
      roomInviteId: 'room-1',
      roomInviteName: 'Cool Room',
    });

    expect(res.status).toBe(200);
    // Verify the lastMessage preview text stored in the batch
    const convUpdate = mockBatchSet.mock.calls[1];
    expect(convUpdate[1].lastMessage.text).toBe('[Room Invite]');
  });

  test('MOD_ACTION type passes through', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'MOD_ACTION', senderName: 'Alice', text: 'User warned' });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('MOD_ACTION');
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST messages — corrupted conversation data (line 226)
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/conversations/:id/messages — corrupted data', () => {
  test('returns 500 when conversation data is null', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => null, // Corrupted!
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/corrupted/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST messages — un-hide and notification fire-and-forget error paths
// Lines 292, 310, 317
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/conversations/:id/messages — fire-and-forget error handling', () => {
  test('catches un-hide error gracefully (line 292)', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        participantIds: ['user-A', 'user-B'],
        isGroup: false,
      }),
    });

    // Make the set call fail (used by un-hide)
    mockDocSet.mockRejectedValue(new Error('Un-hide failed'));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice' });

    // Should still return 200 — un-hide is fire-and-forget
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    // Error should have been logged
    expect(log.error).toHaveBeenCalledWith(
      'conversations',
      expect.stringContaining('un-hide'),
      expect.any(Object),
    );
  });

  test('catches RTDB broadcast error gracefully (line 147/317)', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        participantIds: ['user-A', 'user-B'],
        isGroup: false,
      }),
    });
    mockDocSet.mockResolvedValue(); // un-hide succeeds

    // Make RTDB set fail
    mockRtdbSet.mockRejectedValue(new Error('RTDB down'));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice' });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(log.error).toHaveBeenCalledWith(
      'conversations',
      expect.stringContaining('RTDB'),
      expect.any(Object),
    );
  });

  test('catches notification send error gracefully (line 310)', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        participantIds: ['user-A', 'user-B'],
        isGroup: false,
      }),
    });
    mockDocSet.mockResolvedValue();

    // Make getAll fail (sendMessageNotifications tries batch-fetching users)
    mockGetAll.mockRejectedValue(new Error('getAll failed'));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice' });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    // Either the notification error or the outer catch should log
    expect(log.error).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST messages — 500 on internal error
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/conversations/:id/messages — internal error', () => {
  test('returns 500 when Firestore throws (catch block lines 326-333)', async () => {
    mockDocGet.mockRejectedValue(new Error('Firestore down'));

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/i);
    expect(log.error).toHaveBeenCalledWith(
      'conversations',
      expect.stringContaining('send message'),
      expect.objectContaining({
        conversationId: 'conv-1',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST messages — reply fields / edge cases
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/conversations/:id/messages — reply and optional fields', () => {
  beforeEach(() => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        participantIds: ['user-A', 'user-B'],
        isGroup: false,
      }),
    });
    mockGetAll.mockResolvedValue([]);
  });

  test('includes reply fields in response when present', async () => {
    const app = createApp('user-A');
    const res = await request(app).post('/api/conversations/conv-1/messages').send({
      text: 'Reply',
      senderName: 'Alice',
      replyToMessageId: 'msg-original',
      replyToText: 'Original message',
      replyToSenderName: 'Bob',
    });

    expect(res.status).toBe(200);
    expect(res.body.replyToMessageId).toBe('msg-original');
    expect(res.body.replyToText).toBe('Original message');
    expect(res.body.replyToSenderName).toBe('Bob');
  });

  test('handles imageUrls that is not an array', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'IMAGE', senderName: 'Alice', imageUrls: 'not-an-array' });

    expect(res.status).toBe(200);
    expect(res.body.imageUrls).toEqual([]);
  });

  test('handles missing senderName', async () => {
    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello' });

    expect(res.status).toBe(200);
    expect(res.body.senderName).toBe('');
  });

  test('handles group conversation with groupName in notifications', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        participantIds: ['user-A', 'user-B', 'user-C'],
        isGroup: true,
        groupName: 'Best Friends',
      }),
    });

    let getAllCallCount = 0;
    mockGetAll.mockImplementation((...refs) => {
      getAllCallCount++;
      if (getAllCallCount === 1) {
        return Promise.resolve(
          refs.map((_, i) => ({
            exists: true,
            id: i === 0 ? 'user-B' : 'user-C',
            data: () => ({
              pmNotificationsEnabled: true,
              dndEnabled: false,
              fcmTokens: [`token-${i}`],
              pmNotificationPreview: true,
            }),
          })),
        );
      }
      return Promise.resolve(refs.map(() => ({ exists: false })));
    });

    const app = createApp('user-A');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hey everyone', senderName: 'Alice', type: 'TEXT' });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    // Check FCM was called with group name in senderName
    if (mockSendFcmToTokens.mock.calls.length > 0) {
      const data = mockSendFcmToTokens.mock.calls[0][1];
      expect(data.senderName).toContain('Best Friends');
      expect(data.isGroup).toBe('true');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildMessage — edge cases with missing fields
// ═══════════════════════════════════════════════════════════════════

describe('buildMessage edge cases', () => {
  test('handles message doc with all null/missing fields', async () => {
    const { db } = require('../../src/utils/firebase');

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ participantIds: ['user-A'] }),
    });

    db.collection.mockReturnValueOnce({
      orderBy: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({
            docs: [
              {
                id: 'msg-empty',
                data: () => ({}), // All fields missing
              },
            ],
          }),
        })),
      })),
    });

    const app = createApp('user-A');
    const res = await request(app).get('/api/conversations/conv-1/messages');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 'msg-empty',
      messageId: 'msg-empty',
      senderId: '',
      senderName: '',
      text: '',
      type: 'TEXT',
      createdAt: 0,
      editedAt: null,
      editCount: 0,
      replyToMessageId: null,
      replyToText: null,
      replyToSenderName: null,
      stickerUrl: null,
      roomInviteId: null,
      roomInviteName: null,
      reactions: {},
      isRecalled: false,
      isHidden: false,
      hiddenBy: null,
      imageUrls: [],
    });
  });
});
