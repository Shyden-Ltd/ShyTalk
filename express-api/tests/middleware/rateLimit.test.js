const express = require('express');
const request = require('supertest');

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// The rateLimit middleware skips ALL limiters when NODE_ENV !== 'production'
// (rationale: a single Playwright suite easily exhausts 200 req/min/IP
// because all loopback connections share `::1`, and dev-sanity assertions
// on /api/health would deterministically 429). Production behaviour is
// the contract under test, so force NODE_ENV='production' for these tests.
let _originalNodeEnv;
beforeEach(() => {
  _originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  jest.clearAllMocks();
  jest.resetModules();
  // Re-apply the log mock after resetModules so the fresh rateLimit module picks it up
  jest.mock('../../src/utils/log', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));
});

afterEach(() => {
  if (_originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = _originalNodeEnv;
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
  app.get('/test', (req, res) => res.json({ success: true }));
  return app;
}

function createWriteApp() {
  const { writeLimiter } = freshLimiters();
  const app = express();
  app.use(writeLimiter);
  app.post('/message', (req, res) => res.json({ success: true }));
  return app;
}

function createSensitiveApp() {
  const { sensitiveLimiter } = freshLimiters();
  const app = express();
  app.use(sensitiveLimiter);
  app.post('/report', (req, res) => res.json({ success: true }));
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('generalLimiter', () => {
  test('allows requests under the limit', async () => {
    const app = createGeneralApp();
    const res = await request(app).get('/test').expect(200);
    expect(res.body.success).toBe(true);
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

    // Send 200 requests in batches to avoid socket exhaustion
    for (let batch = 0; batch < 10; batch++) {
      await Promise.all(Array.from({ length: 20 }, () => request(app).get('/test')));
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
    expect(res.body.success).toBe(true);
  });

  test('returns 429 when write limit (30) is exceeded', async () => {
    const app = createWriteApp();

    // Send 30 requests in batches to avoid socket exhaustion
    for (let batch = 0; batch < 3; batch++) {
      await Promise.all(Array.from({ length: 10 }, () => request(app).post('/message')));
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
    expect(res.body.success).toBe(true);
  });

  test('returns 429 when sensitive limit (5) is exceeded', async () => {
    const app = createSensitiveApp();

    await Promise.all(Array.from({ length: 5 }, () => request(app).post('/report')));

    const res = await request(app).post('/report').expect(429);
    expect(res.body.error).toBe('Rate limit exceeded for this operation');
  });

  test('logs a warning when sensitive rate limit is hit', async () => {
    const app = createSensitiveApp();

    await Promise.all(Array.from({ length: 5 }, () => request(app).post('/report')));

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

describe('admin exemption', () => {
  // These tests previously sent 210 / 10 parallel HTTP requests through supertest
  // to verify admin requests bypass rate limiting. Under load (full 4225-test
  // suite) those parallel batches caused ECONNRESET / socket hang up flake from
  // ephemeral port exhaustion. Now we invoke the limiter middleware directly
  // with a mock req/res/next — the skip function is the entire surface area we
  // care about, and calling it directly is deterministic.

  function invokeLimiter(limiter, req) {
    return new Promise((resolve, reject) => {
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        setHeader: jest.fn().mockReturnThis(),
        getHeader: jest.fn(),
        removeHeader: jest.fn(),
        end: jest.fn(),
      };
      const next = (err) => (err ? reject(err) : resolve({ skipped: true, res }));
      try {
        const ret = limiter(req, res, next);
        if (ret && typeof ret.then === 'function') ret.catch(reject);
        // If the limiter blocked the request it calls res.json without next()
        setImmediate(() => {
          if (res.json.mock.calls.length > 0 || res.status.mock.calls.length > 0) {
            resolve({ skipped: false, res });
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  test('admin users are exempt from generalLimiter', async () => {
    const { generalLimiter } = freshLimiters();
    const adminReq = {
      auth: { uid: 'admin-user', token: { admin: true } },
      ip: '127.0.0.1',
      method: 'GET',
      path: '/test',
      url: '/test',
      headers: {},
      get: () => undefined,
      // express-rate-limit reads these:
      app: { get: () => undefined },
      socket: { remoteAddress: '127.0.0.1' },
    };
    // 250+ invocations would normally trigger the 200/min limit — admin should bypass
    for (let i = 0; i < 250; i++) {
      const result = await invokeLimiter(generalLimiter, adminReq);
      expect(result.skipped).toBe(true);
    }
  });

  test('admin users are exempt from sensitiveLimiter', async () => {
    const { sensitiveLimiter } = freshLimiters();
    const adminReq = {
      auth: { uid: 'admin-user', token: { admin: true } },
      ip: '127.0.0.1',
      method: 'POST',
      path: '/report',
      url: '/report',
      headers: {},
      get: () => undefined,
      app: { get: () => undefined },
      socket: { remoteAddress: '127.0.0.1' },
    };
    // 10+ invocations would normally trigger the 5/min sensitive limit
    for (let i = 0; i < 10; i++) {
      const result = await invokeLimiter(sensitiveLimiter, adminReq);
      expect(result.skipped).toBe(true);
    }
  });

  test('non-admin users are still rate-limited on sensitiveLimiter', async () => {
    const { sensitiveLimiter } = freshLimiters();
    const app = express();
    // Inject non-admin auth
    app.use((req, _res, next) => {
      req.auth = { uid: 'regular-user', token: { admin: false } };
      next();
    });
    app.use(sensitiveLimiter);
    app.post('/report', (req, res) => res.json({ success: true }));

    await Promise.all(Array.from({ length: 5 }, () => request(app).post('/report')));

    // 6th request should be rate limited
    const res = await request(app).post('/report').expect(429);
    expect(res.body.error).toBe('Rate limit exceeded for this operation');
  });

  test('admin token missing (token: {}) is NOT exempt — gets rate-limited', async () => {
    const { sensitiveLimiter } = freshLimiters();
    const app = express();
    app.use((req, _res, next) => {
      req.auth = { uid: 'user-no-admin', token: {} };
      next();
    });
    app.use(sensitiveLimiter);
    app.post('/report', (req, res) => res.json({ success: true }));

    await Promise.all(Array.from({ length: 5 }, () => request(app).post('/report')));

    const res = await request(app).post('/report').expect(429);
    expect(res.body.error).toBe('Rate limit exceeded for this operation');
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
    app.post('/report', (req, res) => res.json({ success: true }));

    // Exhaust the limit for user-123
    await Promise.all(Array.from({ length: 5 }, () => request(app).post('/report')));

    // user-123 should be rate limited
    await request(app).post('/report').expect(429);

    // A different user on the same limiter instance should NOT be rate limited
    const app2 = express();
    app2.use((req, _res, next) => {
      req.auth = { uid: 'user-456' };
      next();
    });
    app2.use(sensitiveLimiter);
    app2.post('/report', (req, res) => res.json({ success: true }));

    // user-456 is a different key in the same store, so it should be allowed
    const res = await request(app2).post('/report').expect(200);
    expect(res.body.success).toBe(true);
  });

  test('falls back to IP when no auth uid', async () => {
    const { sensitiveLimiter } = freshLimiters();

    const app = express();
    // No auth middleware — req.auth is undefined, so keyGenerator uses req.ip
    app.use(sensitiveLimiter);
    app.post('/report', (req, res) => res.json({ success: true }));

    // Exhaust limit — all requests from same IP
    await Promise.all(Array.from({ length: 5 }, () => request(app).post('/report')));

    // Should be rate limited by IP
    const res = await request(app).post('/report').expect(429);
    expect(res.body.error).toBe('Rate limit exceeded for this operation');
  });
});

// Phase 2H finding #3: recoveryLimiter must trim+lowercase the email so
// `victim@x.com`, ` victim@x.com`, and `victim@x.com ` are ONE bucket, not
// three. Without `.trim()` an attacker could spam OTPs to a victim's inbox
// by cycling whitespace variants of the same email.
describe('recoveryLimiter — email normalisation', () => {
  function freshRecovery() {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    return require('../../src/middleware/rateLimit').recoveryLimiter;
  }

  function appFor(limiter) {
    const app = express();
    app.use(express.json());
    app.use('/recover', limiter);
    app.post('/recover', (_req, res) => res.json({ ok: true }));
    return app;
  }

  test('whitespace and case variants share one bucket', async () => {
    const limiter = freshRecovery();
    const app = appFor(limiter);

    // 3-per-24h limit. Exhaust with the canonical form first.
    for (let i = 0; i < 3; i++) {
      await request(app).post('/recover').send({ email: 'victim@example.com' }).expect(200);
    }
    // Whitespace variant — must hit the SAME bucket and 429.
    await request(app).post('/recover').send({ email: ' victim@example.com' }).expect(429);
    // Case variant — same bucket.
    await request(app).post('/recover').send({ email: 'VICTIM@example.com' }).expect(429);
    // Trailing whitespace — same bucket.
    await request(app).post('/recover').send({ email: 'victim@example.com ' }).expect(429);
  });

  test('non-string email body falls back to req.ip key (no crash)', async () => {
    const limiter = freshRecovery();
    const app = appFor(limiter);
    // Object-shaped body should not throw — keyGenerator returns req.ip.
    await request(app)
      .post('/recover')
      .send({ email: { not: 'a string' } })
      .expect(200);
  });
});

describe('non-production skip', () => {
  // Counter-test the suite-wide `process.env.NODE_ENV = 'production'` setup:
  // when NODE_ENV is anything other than 'production', ALL limiters become
  // no-ops. This is the contract that lets local dev / Playwright runs make
  // 1000+ calls without dev-sanity tests tripping a 429.

  function withNonProd(envValue, runWithApp) {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = envValue;
    jest.resetModules();
    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));
    const {
      generalLimiter,
      writeLimiter,
      sensitiveLimiter,
    } = require('../../src/middleware/rateLimit');
    const app = express();
    app.use(generalLimiter);
    app.use(writeLimiter);
    app.use(sensitiveLimiter);
    app.get('/probe', (req, res) => res.json({ ok: true }));
    return runWithApp(app).finally(() => {
      process.env.NODE_ENV = previous || 'production';
    });
  }

  test('NODE_ENV=local bypasses general/write/sensitive limiters', async () => {
    await withNonProd('local', async (app) => {
      // Make many more requests than ANY of the production limits combined
      // (general 200 + sensitive 5 = 205); all must succeed.
      for (let i = 0; i < 250; i++) {
        await request(app).get('/probe').expect(200);
      }
    });
  });

  test('NODE_ENV=test bypasses limiters', async () => {
    await withNonProd('test', async (app) => {
      const res = await request(app).get('/probe').expect(200);
      expect(res.body.ok).toBe(true);
    });
  });

  test('NODE_ENV unset (undefined) bypasses limiters', async () => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    jest.resetModules();
    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));
    const { generalLimiter } = require('../../src/middleware/rateLimit');
    const app = express();
    app.use(generalLimiter);
    app.get('/probe', (req, res) => res.json({ ok: true }));
    try {
      for (let i = 0; i < 250; i++) {
        await request(app).get('/probe').expect(200);
      }
    } finally {
      process.env.NODE_ENV = previous || 'production';
    }
  });
});

// Phase 2H finding #4: BoundedLruRateLimitStore.
describe('BoundedLruRateLimitStore — keyspace cap', () => {
  let store;
  beforeEach(() => {
    jest.isolateModules(() => {
      const rateLimitMod = require('../../src/middleware/rateLimit');
      const StoreClass = rateLimitMod.BoundedLruRateLimitStore;
      store = new StoreClass({ windowMs: 1000, maxKeys: 3 });
    });
  });

  test('evicts the oldest key when over the cap', async () => {
    await store.increment('a');
    await store.increment('b');
    await store.increment('c');
    expect(store._size()).toBe(3);
    await store.increment('d');
    expect(store._size()).toBe(3);
    expect(store.hits.has('a')).toBe(false);
    expect(store.hits.has('d')).toBe(true);
  });

  test('LRU touch keeps recently-accessed key alive', async () => {
    await store.increment('a');
    await store.increment('b');
    await store.increment('c');
    await store.increment('a');
    await store.increment('d');
    expect(store.hits.has('a')).toBe(true);
    expect(store.hits.has('b')).toBe(false);
    expect(store.hits.has('d')).toBe(true);
  });

  test('expired entry is replaced (not preserved across windowMs)', async () => {
    const result1 = await store.increment('exp');
    expect(result1.totalHits).toBe(1);
    const expiredEntry = store.hits.get('exp');
    expiredEntry.resetTime = new Date(Date.now() - 1);
    const result2 = await store.increment('exp');
    expect(result2.totalHits).toBe(1);
  });

  test('resetKey clears a single key; resetAll clears the whole store', async () => {
    await store.increment('x');
    await store.increment('y');
    await store.resetKey('x');
    expect(store.hits.has('x')).toBe(false);
    expect(store.hits.has('y')).toBe(true);
    await store.resetAll();
    expect(store._size()).toBe(0);
  });
});
