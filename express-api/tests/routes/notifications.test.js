const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocUpdate = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      update: mockDocUpdate,
    })),
  },
  FieldValue: {
    arrayUnion: jest.fn((v) => `arrayUnion(${v})`),
    arrayRemove: jest.fn((v) => `arrayRemove(${v})`),
  },
}));

jest.mock('../../src/utils/log', () => ({
  error: jest.fn(),
}));

// ─── App setup ───────────────────────────────────────────────────

const notificationsRouter = require('../../src/routes/notifications');

function createApp(uniqueId = 12345) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'firebase-uid', uniqueId };
    next();
  });
  app.use('/api', notificationsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── POST /api/notifications/token ──────────────────────────────

describe('POST /api/notifications/token', () => {
  test('saves valid string token (200)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/notifications/token')
      .send({ token: 'fcm-token-abc123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const { db, FieldValue } = require('../../src/utils/firebase');
    expect(db.doc).toHaveBeenCalledWith('users/12345');
    expect(FieldValue.arrayUnion).toHaveBeenCalledWith('fcm-token-abc123');
    expect(mockDocUpdate).toHaveBeenCalledTimes(1);
  });

  test('rejects missing token (400)', async () => {
    const app = createApp();
    const res = await request(app).post('/api/notifications/token').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('rejects null token (400)', async () => {
    const app = createApp();
    const res = await request(app).post('/api/notifications/token').send({ token: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('rejects empty string token (400)', async () => {
    const app = createApp();
    const res = await request(app).post('/api/notifications/token').send({ token: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('rejects object token — prevents Firestore injection (400)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/notifications/token')
      .send({ token: { malicious: true } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('rejects array token (400)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/notifications/token')
      .send({ token: ['a', 'b'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('rejects numeric token (400)', async () => {
    const app = createApp();
    const res = await request(app).post('/api/notifications/token').send({ token: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('rejects token longer than 500 chars (400)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/notifications/token')
      .send({ token: 'a'.repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });
});

// ─── DELETE /api/notifications/token ────────────────────────────

describe('DELETE /api/notifications/token', () => {
  test('removes valid string token (200)', async () => {
    const app = createApp();
    const res = await request(app)
      .delete('/api/notifications/token')
      .send({ token: 'fcm-token-abc123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const { db, FieldValue } = require('../../src/utils/firebase');
    expect(db.doc).toHaveBeenCalledWith('users/12345');
    expect(FieldValue.arrayRemove).toHaveBeenCalledWith('fcm-token-abc123');
    expect(mockDocUpdate).toHaveBeenCalledTimes(1);
  });

  test('rejects missing token (400)', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/notifications/token').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('rejects object token — prevents Firestore injection (400)', async () => {
    const app = createApp();
    const res = await request(app)
      .delete('/api/notifications/token')
      .send({ token: { malicious: true } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('rejects empty string token (400)', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/notifications/token').send({ token: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('rejects token longer than 500 chars (400)', async () => {
    const app = createApp();
    const res = await request(app)
      .delete('/api/notifications/token')
      .send({ token: 'a'.repeat(501) });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });
});

// ─── PATCH /api/notifications/settings ──────────────────────────

describe('PATCH /api/notifications/settings', () => {
  test('updates valid settings (200)', async () => {
    const app = createApp();
    const res = await request(app)
      .patch('/api/notifications/settings')
      .send({ pmNotificationsEnabled: true, pmSoundEnabled: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockDocUpdate).toHaveBeenCalledWith({
      pmNotificationsEnabled: true,
      pmSoundEnabled: false,
    });
  });

  test('rejects unknown fields only (400)', async () => {
    const app = createApp();
    const res = await request(app)
      .patch('/api/notifications/settings')
      .send({ unknownField: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No valid fields/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('coerces truthy values to booleans', async () => {
    const app = createApp();
    await request(app)
      .patch('/api/notifications/settings')
      .send({ pmShowTimestamps: 'yes', pmShowDateSeparators: 0 })
      .expect(200);

    expect(mockDocUpdate).toHaveBeenCalledWith({
      pmShowTimestamps: true,
      pmShowDateSeparators: false,
    });
  });

  test('ignores disallowed fields alongside valid ones', async () => {
    const app = createApp();
    await request(app)
      .patch('/api/notifications/settings')
      .send({ pmNotificationsEnabled: true, isAdmin: true, coins: 9999 })
      .expect(200);

    expect(mockDocUpdate).toHaveBeenCalledWith({
      pmNotificationsEnabled: true,
    });
  });
});

// ─── Error paths ───────────────────────────────────────────────

describe('POST /api/notifications/token — error paths', () => {
  test('returns 500 when Firestore update fails', async () => {
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore unavailable'));
    const app = createApp();
    const res = await request(app).post('/api/notifications/token').send({ token: 'valid-token' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });
});

describe('DELETE /api/notifications/token — error paths', () => {
  test('returns 500 when Firestore update fails', async () => {
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore unavailable'));
    const app = createApp();
    const res = await request(app)
      .delete('/api/notifications/token')
      .send({ token: 'valid-token' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('rejects numeric token (400)', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/notifications/token').send({ token: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('rejects null token (400)', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/notifications/token').send({ token: null });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  test('rejects array token (400)', async () => {
    const app = createApp();
    const res = await request(app)
      .delete('/api/notifications/token')
      .send({ token: ['a', 'b'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-empty string/);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/notifications/settings — error paths', () => {
  test('returns 500 when Firestore update fails', async () => {
    mockDocUpdate.mockRejectedValueOnce(new Error('Firestore unavailable'));
    const app = createApp();
    const res = await request(app)
      .patch('/api/notifications/settings')
      .send({ pmNotificationsEnabled: true });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  test('accepts all five allowed fields', async () => {
    const app = createApp();
    const res = await request(app)
      .patch('/api/notifications/settings')
      .send({
        pmNotificationsEnabled: true,
        pmSoundEnabled: false,
        pmShowTimestamps: true,
        pmShowDateSeparators: false,
        pmNotificationPreview: true,
      })
      .expect(200);

    expect(res.body).toEqual({ success: true });
    expect(mockDocUpdate).toHaveBeenCalledWith({
      pmNotificationsEnabled: true,
      pmSoundEnabled: false,
      pmShowTimestamps: true,
      pmShowDateSeparators: false,
      pmNotificationPreview: true,
    });
  });

  test('coerces falsy values to false', async () => {
    const app = createApp();
    await request(app)
      .patch('/api/notifications/settings')
      .send({ pmNotificationsEnabled: 0, pmSoundEnabled: '', pmShowTimestamps: null })
      .expect(200);

    expect(mockDocUpdate).toHaveBeenCalledWith({
      pmNotificationsEnabled: false,
      pmSoundEnabled: false,
      pmShowTimestamps: false,
    });
  });
});
