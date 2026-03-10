const express = require('express');
const request = require('supertest');

// ─── Mocks ──────────────────────────────────────────────────────

jest.mock('../../src/utils/r2', () => ({
  putObject: jest.fn().mockResolvedValue('https://images.shytalk.shyden.co.uk/test-key'),
  deleteObject: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/helpers', () => ({
  getExtension: jest.fn((mime) => {
    const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    return map[mime] || 'bin';
  }),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const r2 = require('../../src/utils/r2');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── App setup ──────────────────────────────────────────────────

const storageRouter = require('../../src/routes/storage');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'user-A' };
    next();
  });
  app.use('/api', storageRouter);
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('POST /api/storage/upload', () => {
  test('allows image/jpeg uploads', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('fake-image'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
    expect(r2.putObject).toHaveBeenCalled();
  });

  test('allows image/png uploads', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('fake-png'), { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
  });

  test('allows image/webp uploads', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'messages')
      .attach('file', Buffer.from('fake-webp'), { filename: 'photo.webp', contentType: 'image/webp' });

    expect(res.status).toBe(200);
  });

  test('rejects non-image MIME types (text/html)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'evil.html', contentType: 'text/html' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only image uploads/);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  test('rejects SVG uploads (XSS vector)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('<svg onload="alert(1)">'), { filename: 'evil.svg', contentType: 'image/svg+xml' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only image uploads/);
  });

  test('rejects application/pdf uploads', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('fake-pdf'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  test('rejects disallowed upload paths', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'admin-data')
      .attach('file', Buffer.from('img'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid upload path/);
  });

  test('returns 400 when file is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing file or path/);
  });
});
