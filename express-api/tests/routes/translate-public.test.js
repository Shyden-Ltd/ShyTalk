/**
 * Public (anonymous) flow of the MERGED POST /api/translate (SHY-0072).
 *
 * The same route keeps the authenticated chat contract (pinned UNCHANGED
 * by tests/routes/translate.test.js — the characterization gate) and adds
 * this anonymous public-content flow: { texts[], target } → unified
 * string cache → provider chain → fail-silent English + missed[] +
 * X-Translation-Missed header + dedup'd JSONL miss-queue.
 *
 * Caller discrimination: requests WITHOUT an Authorization header skip
 * authMiddleware via the index.js skip-list and reach the route
 * anonymous; anonymous chat-shaped bodies ({text, targetLang}) must 401.
 */

const express = require('express');
const request = require('supertest');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ─── Mocks ───────────────────────────────────────────────────────
jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
      update: jest.fn().mockResolvedValue(),
    })),
  },
  FieldValue: { increment: jest.fn((n) => n) },
}));
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();
jest.mock('../../src/utils/log', () => ({
  warn: (...a) => mockLogWarn(...a),
  error: (...a) => mockLogError(...a),
  info: jest.fn(),
}));

const mockTranslateOne = jest.fn();
jest.mock('../../src/utils/translation-provider', () => ({
  translateOne: (...a) => mockTranslateOne(...a),
}));

let tmpDir;
let routerFresh;

function createApp() {
  const app = express();
  app.use(express.json());
  // Anonymous requests: no auth middleware (mirrors the index.js skip);
  // the route itself must handle the absence of req.auth.
  app.use('/api', routerFresh);
  return app;
}

beforeEach(() => {
  jest.resetModules();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-public-'));
  process.env.TRANSLATION_CACHE_SEED_PATH = path.join(tmpDir, 'seed.json');
  process.env.TRANSLATION_CACHE_RUNTIME_PATH = path.join(tmpDir, 'cache.json');
  process.env.TRANSLATION_MISS_QUEUE_PATH = path.join(tmpDir, 'miss-queue.jsonl');
  fs.writeFileSync(process.env.TRANSLATION_CACHE_SEED_PATH, '{}');
  mockTranslateOne
    .mockReset()
    .mockResolvedValue({ ok: true, translated: 'TRANSLATED', provider: 'gtx' });
  // Targets are drawn from the five supported locales (SHY-0289). The mock
  // returns the same marker whatever the target, so which one a test uses is
  // arbitrary — and the fresh tmpdir below means two tests sharing a target
  // cannot see each other's cache.
  // Fresh module per test so the route's cache/queue singletons bind to
  // this test's tmp paths (resetModules above clears the require cache).
  routerFresh = require('../../src/routes/translate');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.TRANSLATION_CACHE_SEED_PATH;
  delete process.env.TRANSLATION_CACHE_RUNTIME_PATH;
  delete process.env.TRANSLATION_MISS_QUEUE_PATH;
});

const post = (body) => request(createApp()).post('/api/translate').send(body);

describe('anonymous public flow — happy paths', () => {
  test('translates a batch, returns translations map, empty missed, header 0', async () => {
    const res = await post({ texts: ['Roadmap', 'Done'], target: 'id' });
    expect(res.status).toBe(200);
    expect(res.body.translations).toEqual({ Roadmap: 'TRANSLATED', Done: 'TRANSLATED' });
    expect(res.body.missed).toEqual([]);
    expect(res.headers['x-translation-missed']).toBe('0');
    expect(mockTranslateOne).toHaveBeenCalledTimes(2);
  });

  test('cache hit: second identical request makes NO provider calls', async () => {
    await post({ texts: ['Roadmap'], target: 'id' });
    mockTranslateOne.mockClear();
    const res = await post({ texts: ['Roadmap'], target: 'id' });
    expect(res.status).toBe(200);
    expect(res.body.translations.Roadmap).toBe('TRANSLATED');
    expect(mockTranslateOne).not.toHaveBeenCalled();
  });

  test('in-request dedupe: same text twice = one provider call', async () => {
    await post({ texts: ['Same', 'Same'], target: 'vi' });
    expect(mockTranslateOne).toHaveBeenCalledTimes(1);
  });

  test('mixed batch partial-fills from cache (only misses hit the provider)', async () => {
    await post({ texts: ['Cached'], target: 'th' });
    mockTranslateOne.mockClear();
    const res = await post({ texts: ['Cached', 'Fresh'], target: 'th' });
    expect(mockTranslateOne).toHaveBeenCalledTimes(1);
    expect(mockTranslateOne.mock.calls[0][0]).toBe('Fresh');
    expect(res.body.translations).toMatchObject({ Cached: 'TRANSLATED', Fresh: 'TRANSLATED' });
  });
});

describe('anonymous public flow — fail-silent contract', () => {
  test('full-chain failure: 200, English text, missed[], header, WARN, queue line', async () => {
    mockTranslateOne.mockResolvedValue({ ok: false, reason: 'gtx 503; libretranslate 500' });
    const res = await post({ texts: ['Roadmap'], target: 'vi' });
    expect(res.status).toBe(200);
    expect(res.body.translations.Roadmap).toBe('Roadmap');
    expect(res.body.missed).toEqual(['Roadmap']);
    expect(res.headers['x-translation-missed']).toBe('1');
    expect(mockLogWarn).toHaveBeenCalledWith(
      'translate',
      expect.stringContaining('provider'),
      expect.objectContaining({ target: 'vi' }),
    );
    const queue = fs
      .readFileSync(process.env.TRANSLATION_MISS_QUEUE_PATH, 'utf-8')
      .trim()
      .split('\n');
    expect(queue).toHaveLength(1);
    expect(JSON.parse(queue[0])).toMatchObject({ text: 'Roadmap', target: 'vi' });
  });

  test('partial failure: failed text English+missed, others translated, still 200', async () => {
    mockTranslateOne
      .mockResolvedValueOnce({ ok: true, translated: 'OK-1', provider: 'gtx' })
      .mockResolvedValueOnce({ ok: false, reason: 'both down' });
    const res = await post({ texts: ['Alpha', 'Beta'], target: 'th' });
    expect(res.status).toBe(200);
    expect(res.body.translations).toEqual({ Alpha: 'OK-1', Beta: 'Beta' });
    expect(res.body.missed).toEqual(['Beta']);
  });

  test('queue dedupe: repeated misses of the same text+target append exactly once', async () => {
    mockTranslateOne.mockResolvedValue({ ok: false, reason: 'down' });
    await post({ texts: ['Roadmap'], target: 'zh' });
    await post({ texts: ['Roadmap'], target: 'zh' });
    await post({ texts: ['Roadmap'], target: 'zh' });
    const queue = fs
      .readFileSync(process.env.TRANSLATION_MISS_QUEUE_PATH, 'utf-8')
      .trim()
      .split('\n');
    expect(queue).toHaveLength(1);
  });

  test('failed translations are NOT cached (next request retries the provider)', async () => {
    mockTranslateOne.mockResolvedValueOnce({ ok: false, reason: 'down' });
    await post({ texts: ['Retry'], target: 'vi' });
    mockTranslateOne.mockResolvedValueOnce({ ok: true, translated: '재시도', provider: 'gtx' });
    const res = await post({ texts: ['Retry'], target: 'vi' });
    expect(res.body.translations.Retry).toBe('재시도');
    expect(mockTranslateOne).toHaveBeenCalledTimes(2);
  });
});

describe('anonymous public flow — input rejection (400s)', () => {
  test.each([
    ['target en (no-op forbidden)', { texts: ['x'], target: 'en' }],
    ['unsupported locale', { texts: ['x'], target: 'xx' }],
    ['missing texts', { target: 'id' }],
    ['texts not an array', { texts: 'x', target: 'id' }],
    ['empty texts array', { texts: [], target: 'id' }],
    ['oversize text (>2000 chars)', { texts: ['y'.repeat(2001)], target: 'id' }],
    [
      'too many texts (>50)',
      { texts: Array.from({ length: 51 }, (_, i) => `t${i}`), target: 'id' },
    ],
  ])('%s → 400, provider never called', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(mockTranslateOne).not.toHaveBeenCalled();
  });

  test('anonymous CHAT-shaped body ({text, targetLang}) → 401, never served', async () => {
    const res = await post({ text: 'hi', targetLang: 'de' });
    expect(res.status).toBe(401);
    expect(mockTranslateOne).not.toHaveBeenCalled();
  });
});

describe('wiring pins', () => {
  test('the skip-list lets header-less POST /translate through', () => {
    // SHY-0143 moved the skip predicate out of index.js into
    // middleware/auth-skip.js so it could be unit-tested. The invariant is
    // unchanged and is not the name of the file it lives in — so this pin
    // follows it, and is now BEHAVIOURAL rather than a substring match, which
    // is strictly stronger: a commented-out condition would still satisfy the
    // old regex.
    const http = require('node:http');
    const { skipsAuth } = require('../../src/middleware/auth-skip');

    // A REAL request. These two lines used to pass PLAIN OBJECTS carrying
    // `headers` as an own key — the one shape a real request never has,
    // because `headers` is an accessor on `IncomingMessage.prototype`. That
    // is exactly how a `{ ...req }` copy inside the predicate 500'd every
    // POST /api/translate while this pin stayed green. Fixed in the unit
    // suite and missed here, which is the whole point of sweeping a fix
    // across the project rather than the file it was found in.
    const request = (headers) => {
      const req = new http.IncomingMessage(null);
      req.method = 'POST';
      req.path = '/translate';
      if (headers) req.headers = headers;
      return req;
    };

    expect(skipsAuth(request())).toBe(true);
    expect(skipsAuth(request({ authorization: 'Bearer x' }))).toBe(false);

    // And index.js must still consult it, or the predicate is decoration.
    // NOTE this line was green throughout the 500 — index.js DID call
    // `skipsAuth(req)`; the defect was inside the callee. Behaviour is what
    // catches that, which is why auth-skip-composition.test.js exists.
    const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'index.js'), 'utf-8');
    expect(src).toMatch(/skipsAuth\(req\)/);
  });

  test('GET /api/system/health exposes translationQueueLength (static pin on system.js)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'routes', 'system.js'),
      'utf-8',
    );
    expect(src).toContain('translationQueueLength');
  });
});

describe('rate limiting (writeLimiter wired exactly as index.js mounts it)', () => {
  // The middleware skips all limiters outside production, so this block
  // forces NODE_ENV='production'; the suite-level env overrides keep the
  // cache/queue on per-test tmp paths regardless.
  let originalEnv;
  beforeAll(() => {
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
  });
  afterAll(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  test('anonymous flow returns 429 after the 30/min budget from one IP', async () => {
    jest.resetModules();
    const { writeLimiter } = require('../../src/middleware/rateLimit');
    const router = require('../../src/routes/translate');
    const app = express();
    app.use(express.json());
    app.use('/api/translate', writeLimiter);
    app.use('/api', router);
    // 30 requests in batches (socket hygiene), 31st must be limited.
    for (let batch = 0; batch < 3; batch++) {
      await Promise.all(
        Array.from({ length: 10 }, () =>
          request(app)
            .post('/api/translate')
            .send({ texts: ['x'], target: 'id' }),
        ),
      );
    }
    const res = await request(app)
      .post('/api/translate')
      .send({ texts: ['x'], target: 'id' });
    expect(res.status).toBe(429);
  });
});
