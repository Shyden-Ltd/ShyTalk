const express = require('express');
const request = require('supertest');

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  // Re-apply the log mock after resetModules so the fresh rateLimit module picks it up
  jest.mock('../../src/utils/log', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));
});

// ─── App setup helpers ──────────────────────────────────────────

function freshLimiters() {
  return require('../../src/middleware/rateLimit');
}

function freshLog() {
  return require('../../src/utils/log');
}

function createGeneralApp() {
  const { generalLimiter } = freshLimiters();
  const app = express();
  app.use(generalLimiter);
  app.get('/test', (req, res) => res.json({ ok: true }));
  return app;
}

function createWriteApp() {
  const { writeLimiter } = freshLimiters();
  const app = express();
  app.use(writeLimiter);
  app.post('/message', (req, res) => res.json({ ok: true }));
  return app;
}

function createSensitiveApp() {
  const { sensitiveLimiter } = freshLimiters();
  const app = express();
  app.use(sensitiveLimiter);
  app.post('/report', (req, res) => res.json({ ok: true }));
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('generalLimiter', () => {
  test('allows requests under the limit', async () => {
    const app = createGeneralApp();
    const res = await request(app).get('/test').expect(200);
    expect(res.body.ok).toBe(true);
  });

  test('returns draft-7 rate limit headers', async () => {
    const app = createGeneralApp();
    const res = await request(app).get('/test').expect(200);

    // draft-7 uses combined RateLimit and RateLimit-Policy headers
    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.headers['ratelimit']).toBeDefined();
    // The combined header contains limit, remaining, and reset
    expect(res.headers['ratelimit']).toMatch(/limit=\d+/);
    expect(res.headers['ratelimit']).toMatch(/remaining=\d+/);
    expect(res.headers['ratelimit']).toMatch(/reset=\d+/);
  });

  test('does not return legacy X-RateLimit headers', async () => {
    const app = createGeneralApp();
    const res = await request(app).get('/test').expect(200);

    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
    expect(res.headers['x-ratelimit-reset']).toBeUndefined();
  });

  test('returns 429 when limit is exceeded', async () => {
    const app = createGeneralApp();

    // Send 200 requests (the limit)
    for (let i = 0; i < 200; i++) {
      await request(app).get('/test');
    }

    // The 201st request should be rate limited
    const res = await request(app).get('/test').expect(429);
    expect(res.body.error).toBe('Too many requests, please try again later');
  });
});

describe('writeLimiter', () => {
  test('allows requests under the limit', async () => {
    const app = createWriteApp();
    const res = await request(app).post('/message').expect(200);
    expect(res.body.ok).toBe(true);
  });

  test('returns 429 when write limit (30) is exceeded', async () => {
    const app = createWriteApp();

    for (let i = 0; i < 30; i++) {
      await request(app).post('/message');
    }

    const res = await request(app).post('/message').expect(429);
    expect(res.body.error).toBe('Too many requests, slow down');
  });

  test('returns draft-7 rate limit headers', async () => {
    const app = createWriteApp();
    const res = await request(app).post('/message').expect(200);

    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.headers['ratelimit']).toBeDefined();
  });
});

describe('sensitiveLimiter', () => {
  test('allows requests under the limit', async () => {
    const app = createSensitiveApp();
    const res = await request(app).post('/report').expect(200);
    expect(res.body.ok).toBe(true);
  });

  test('returns 429 when sensitive limit (5) is exceeded', async () => {
    const app = createSensitiveApp();

    for (let i = 0; i < 5; i++) {
      await request(app).post('/report');
    }

    const res = await request(app).post('/report').expect(429);
    expect(res.body.error).toBe('Rate limit exceeded for this operation');
  });

  test('logs a warning when sensitive rate limit is hit', async () => {
    const app = createSensitiveApp();

    for (let i = 0; i < 5; i++) {
      await request(app).post('/report');
    }

    await request(app).post('/report').expect(429);

    expect(freshLog().warn).toHaveBeenCalledWith(
      'rateLimit',
      'Sensitive rate limit hit',
      expect.objectContaining({
        path: '/report',
      }),
    );
  });

  test('returns draft-7 rate limit headers', async () => {
    const app = createSensitiveApp();
    const res = await request(app).post('/report').expect(200);

    expect(res.headers['ratelimit-policy']).toBeDefined();
    expect(res.headers['ratelimit']).toBeDefined();
  });
});

describe('keyGenerator', () => {
  test('uses authenticated uid when available', async () => {
    const { sensitiveLimiter } = freshLimiters();

    const app = express();
    // Inject mock auth before rate limiter — all requests use uid 'user-123'
    app.use((req, _res, next) => {
      req.auth = { uid: 'user-123' };
      next();
    });
    app.use(sensitiveLimiter);
    app.post('/report', (req, res) => res.json({ ok: true }));

    // Exhaust the limit for user-123
    for (let i = 0; i < 5; i++) {
      await request(app).post('/report');
    }

    // user-123 should be rate limited
    await request(app).post('/report').expect(429);

    // A different user on the same limiter instance should NOT be rate limited
    const app2 = express();
    app2.use((req, _res, next) => {
      req.auth = { uid: 'user-456' };
      next();
    });
    app2.use(sensitiveLimiter);
    app2.post('/report', (req, res) => res.json({ ok: true }));

    // user-456 is a different key in the same store, so it should be allowed
    const res = await request(app2).post('/report').expect(200);
    expect(res.body.ok).toBe(true);
  });

  test('falls back to IP when no auth uid', async () => {
    const { sensitiveLimiter } = freshLimiters();

    const app = express();
    // No auth middleware — req.auth is undefined, so keyGenerator uses req.ip
    app.use(sensitiveLimiter);
    app.post('/report', (req, res) => res.json({ ok: true }));

    // Exhaust limit — all requests from same IP
    for (let i = 0; i < 5; i++) {
      await request(app).post('/report');
    }

    // Should be rate limited by IP
    const res = await request(app).post('/report').expect(429);
    expect(res.body.error).toBe('Rate limit exceeded for this operation');
  });
});
