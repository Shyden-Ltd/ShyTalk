const express = require('express');
const request = require('supertest');

// ─── Firebase mock ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
    })),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
  },
}));

// ─── Fetch mock ──────────────────────────────────────────────────

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();

  // Default user doc: non-SuperShy, no translations today
  mockDocGet.mockResolvedValue({
    exists: true,
    data: () => ({
      isSuperShy: false,
      translationsToday: 0,
      translationDate: '',
    }),
  });

  // Default: successful translation
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        translatedText: 'Hola',
        detectedLanguage: { language: 'en' },
      }),
  });
});

afterAll(() => {
  global.fetch = originalFetch;
});

// ─── App setup ───────────────────────────────────────────────────

const translateRouter = require('../../src/routes/translate');

function createApp(uniqueId = 12345) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'firebase-uid', uniqueId };
    next();
  });
  app.use('/api', translateRouter);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('POST /api/translate', () => {
  test('returns 400 when text is missing', async () => {
    const app = createApp();
    await request(app).post('/api/translate').send({ targetLang: 'es' }).expect(400);
  });

  test('returns 400 when targetLang is missing', async () => {
    const app = createApp();
    await request(app).post('/api/translate').send({ text: 'Hello' }).expect(400);
  });

  test('returns 400 for invalid targetLang format', async () => {
    const app = createApp();
    await request(app)
      .post('/api/translate')
      .send({ text: 'Hello', targetLang: 'en"].foo["' })
      .expect(400, { error: 'Invalid language code' });
  });

  test('returns 400 for targetLang with special characters', async () => {
    const app = createApp();
    await request(app)
      .post('/api/translate')
      .send({ text: 'Hello', targetLang: '../etc' })
      .expect(400, { error: 'Invalid language code' });
  });

  test('accepts valid 2-letter targetLang', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/translate')
      .send({ text: 'Hello', targetLang: 'es' })
      .expect(200);
    expect(res.body.translatedText).toBe('Hola');
  });

  test('accepts valid language code with region', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/translate')
      .send({ text: 'Hello', targetLang: 'zh-CN' })
      .expect(200);
    expect(res.body.translatedText).toBe('Hola');
  });

  test('rejects invalid messagePath (path traversal)', async () => {
    const app = createApp();

    // This messagePath points to a user doc instead of a message doc
    const _res = await request(app)
      .post('/api/translate')
      .send({
        text: 'Hello',
        targetLang: 'es',
        messagePath: 'users/admin-user',
      })
      .expect(200);

    // Should NOT have tried to read the invalid path
    // The db.doc mock is called for user quota check, but not for the invalid messagePath
    const { db } = require('../../src/utils/firebase');
    const docCalls = db.doc.mock.calls.map((c) => c[0]);
    expect(docCalls).not.toContain('users/admin-user');
  });

  test('accepts valid messagePath (conversations)', async () => {
    // First call: parent doc for participant check
    // Second call: message doc cache check (no translations)
    // Third call: user doc for quota
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Parent conversation doc with participant
        return Promise.resolve({
          exists: true,
          data: () => ({ participantIds: [12345] }),
        });
      }
      if (callCount === 2) {
        return Promise.resolve({
          exists: true,
          data: () => ({ translations: {} }),
        });
      }
      return Promise.resolve({
        exists: true,
        data: () => ({ isSuperShy: false, translationsToday: 0, translationDate: '' }),
      });
    });

    const app = createApp();
    await request(app)
      .post('/api/translate')
      .send({
        text: 'Hello',
        targetLang: 'es',
        messagePath: 'conversations/conv-1/messages/msg-1',
      })
      .expect(200);

    const { db } = require('../../src/utils/firebase');
    const docCalls = db.doc.mock.calls.map((c) => c[0]);
    expect(docCalls).toContain('conversations/conv-1');
    expect(docCalls).toContain('conversations/conv-1/messages/msg-1');
  });

  test('accepts valid messagePath (rooms)', async () => {
    let callCount = 0;
    mockDocGet.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Parent room doc with participant
        return Promise.resolve({
          exists: true,
          data: () => ({ participantIds: [12345] }),
        });
      }
      if (callCount === 2) {
        return Promise.resolve({
          exists: true,
          data: () => ({ translations: {} }),
        });
      }
      return Promise.resolve({
        exists: true,
        data: () => ({ isSuperShy: false, translationsToday: 0, translationDate: '' }),
      });
    });

    const app = createApp();
    await request(app)
      .post('/api/translate')
      .send({
        text: 'Hello',
        targetLang: 'es',
        messagePath: 'rooms/room-1/messages/msg-1',
      })
      .expect(200);

    const { db } = require('../../src/utils/firebase');
    const docCalls = db.doc.mock.calls.map((c) => c[0]);
    expect(docCalls).toContain('rooms/room-1');
    expect(docCalls).toContain('rooms/room-1/messages/msg-1');
  });

  test('rejects messagePath with nested traversal', async () => {
    const app = createApp();
    await request(app)
      .post('/api/translate')
      .send({
        text: 'Hello',
        targetLang: 'es',
        messagePath: 'conversations/../users/admin',
      })
      .expect(200);

    const { db } = require('../../src/utils/firebase');
    const docCalls = db.doc.mock.calls.map((c) => c[0]);
    expect(docCalls).not.toContain('conversations/../users/admin');
  });

  test('translates successfully without messagePath', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/translate')
      .send({ text: 'Hello', targetLang: 'es' })
      .expect(200);

    expect(res.body.translatedText).toBe('Hola');
    expect(res.body.cached).toBe(false);
  });

  test('rejects text exceeding 5000 characters', async () => {
    const app = createApp();
    await request(app)
      .post('/api/translate')
      .send({ text: 'x'.repeat(5001), targetLang: 'es' })
      .expect(400);
  });

  test('increments counter for same-day translation (uses FieldValue.increment)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        isSuperShy: false,
        translationsToday: 5,
        translationDate: today,
      }),
    });

    const app = createApp();
    await request(app).post('/api/translate').send({ text: 'Hello', targetLang: 'es' }).expect(200);

    // Verify FieldValue.increment was called for the same-day counter update
    const { FieldValue } = require('../../src/utils/firebase');
    expect(FieldValue.increment).toHaveBeenCalledWith(1);
  });
});

describe('GET /api/translate/quota', () => {
  test('returns quota for regular user', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        isSuperShy: false,
        translationsToday: 10,
        translationDate: new Date().toISOString().slice(0, 10),
      }),
    });

    const app = createApp();
    const res = await request(app).get('/api/translate/quota').expect(200);

    expect(res.body.used).toBe(10);
    expect(res.body.limit).toBe(50);
    expect(res.body.unlimited).toBe(false);
  });

  test('returns unlimited for SuperShy user', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        isSuperShy: true,
        translationsToday: 100,
        translationDate: new Date().toISOString().slice(0, 10),
      }),
    });

    const app = createApp();
    const res = await request(app).get('/api/translate/quota').expect(200);

    expect(res.body.unlimited).toBe(true);
    expect(res.body.limit).toBe(-1);
  });
});
