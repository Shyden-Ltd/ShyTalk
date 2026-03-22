const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();

const mockDocSet = jest.fn().mockResolvedValue();

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
  },
  rtdb: {
    ref: jest.fn(() => ({
      set: jest.fn().mockResolvedValue(),
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
  generateId: () => 'msg-123',
  now: () => 1709913600000,
}));

beforeEach(() => {
  jest.clearAllMocks();
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

// ─── Tests ───────────────────────────────────────────────────────

describe('GET /api/conversations/:id/messages', () => {
  test('handles non-numeric limit gracefully (no NaN)', async () => {
    const { db } = require('../../src/utils/firebase');

    // First call: db.doc() for participant check
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ participantIds: ['user-A', 'user-B'] }),
    });

    db.collection.mockReturnValueOnce({
      orderBy: jest.fn(() => ({
        limit: jest.fn((n) => {
          // Verify that n is a valid number, not NaN
          expect(Number.isNaN(n)).toBe(false);
          expect(typeof n).toBe('number');
          expect(n).toBeGreaterThan(0);
          return {
            get: jest.fn().mockResolvedValue({ docs: [] }),
          };
        }),
      })),
    });

    const app = createApp();
    await request(app).get('/api/conversations/conv-1/messages?limit=abc').expect(200);
  });

  test('respects MAX_MESSAGE_LIMIT of 200', async () => {
    const { db } = require('../../src/utils/firebase');

    // First call: db.doc() for participant check
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ participantIds: ['user-A', 'user-B'] }),
    });

    db.collection.mockReturnValueOnce({
      orderBy: jest.fn(() => ({
        limit: jest.fn((n) => {
          expect(n).toBeLessThanOrEqual(200);
          return {
            get: jest.fn().mockResolvedValue({ docs: [] }),
          };
        }),
      })),
    });

    const app = createApp();
    await request(app).get('/api/conversations/conv-1/messages?limit=9999').expect(200);
  });

  test('returns 403 when user is not a participant', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ participantIds: ['user-B', 'user-C'] }),
    });

    const app = createApp('user-A');
    await request(app).get('/api/conversations/conv-1/messages').expect(403);
  });
});

describe('POST /api/conversations/:id/messages', () => {
  beforeEach(() => {
    // Conversation doc exists with two participants
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ participantIds: ['user-A', 'user-B', 'real-user'], isGroup: false }),
    });
  });

  test('uses authenticated uid as senderId, ignoring body.senderId', async () => {
    const app = createApp('real-user');

    await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({
        senderId: 'impersonated-user',
        senderName: 'Attacker',
        text: 'Hello',
        type: 'TEXT',
      })
      .expect(200);

    // The message written to Firestore must use 'real-user', not 'impersonated-user'
    expect(mockBatchSet).toHaveBeenCalled();
    const writtenData = mockBatchSet.mock.calls[0][1];
    expect(writtenData.senderId).toBe('real-user');
    expect(writtenData.senderId).not.toBe('impersonated-user');
  });

  test('returns 400 when body is missing', async () => {
    const app = createApp();

    // Send request with no Content-Type header and empty body
    await request(app).post('/api/conversations/conv-1/messages').expect(400);
  });

  test('returns 404 when conversation does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });
    const app = createApp();

    await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello' })
      .expect(404);
  });

  test('returns message with correct fields on success', async () => {
    const app = createApp('user-A');

    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice' })
      .expect(200);

    expect(res.body.id).toBe('msg-123');
    expect(res.body.senderId).toBe('user-A');
    expect(res.body.text).toBe('Hello');
    expect(res.body.type).toBe('TEXT');
  });

  test('lastMessage uses createdAt field (not timestamp) for Kotlin compatibility', async () => {
    const app = createApp('user-A');

    await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Alice' })
      .expect(200);

    // The conversation doc update (second batch.set call) should use createdAt
    const convUpdate = mockBatchSet.mock.calls[1];
    const convData = convUpdate[1];
    expect(convData.lastMessage).toBeDefined();
    expect(convData.lastMessage.createdAt).toBe(1709913600000);
    expect(convData.lastMessage.timestamp).toBeUndefined();
    expect(convData.lastMessage.senderId).toBe('user-A');
    expect(convData.lastMessage.senderName).toBe('Alice');
    expect(convData.lastMessage.type).toBe('TEXT');
  });

  test('returns 403 when sender is not a participant', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ participantIds: ['user-B', 'user-C'], isGroup: false }),
    });

    const app = createApp('outsider');
    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: 'Outsider' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a participant/i);
  });

  test('rejects invalid message type with 400', async () => {
    const app = createApp('user-A');

    await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', type: 'INVALID_TYPE' })
      .expect(400);
  });

  test('truncates text exceeding max length', async () => {
    const app = createApp('user-A');
    const longText = 'x'.repeat(3000);

    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: longText, senderName: 'Alice' })
      .expect(200);

    // Server should truncate to 2000 chars
    expect(res.body.text.length).toBe(2000);
  });

  test('limits imageUrls to max 10', async () => {
    const app = createApp('user-A');
    const tooManyUrls = Array.from({ length: 15 }, (_, i) => `https://img.com/${i}.jpg`);

    await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ type: 'IMAGE', imageUrls: tooManyUrls, senderName: 'Alice' })
      .expect(200);

    const writtenData = mockBatchSet.mock.calls[0][1];
    expect(writtenData.imageUrls.length).toBe(10);
  });

  test('truncates senderName exceeding max length', async () => {
    const app = createApp('user-A');
    const longName = 'A'.repeat(100);

    const res = await request(app)
      .post('/api/conversations/conv-1/messages')
      .send({ text: 'Hello', senderName: longName })
      .expect(200);

    expect(res.body.senderName.length).toBe(50);
  });
});
