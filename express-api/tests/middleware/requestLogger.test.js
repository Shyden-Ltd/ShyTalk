const { createRequestLogger, sanitizeBody } = require('../../src/middleware/requestLogger');
const EventEmitter = require('events');

/**
 * Create a mock request object.
 */
function mockReq(overrides = {}) {
  return {
    method: 'GET',
    path: '/api/test',
    url: '/api/test',
    originalUrl: '/api/test',
    headers: {},
    body: {},
    auth: null,
    ...overrides,
  };
}

/**
 * Create a mock response object that emits 'finish'.
 */
function mockRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = jest.fn((key, value) => {
    res.headers[key] = value;
  });
  return res;
}

function mockLogger() {
  return { log: jest.fn() };
}

describe('requestLogger middleware', () => {
  test('skips logging for /api/health', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq({ path: '/api/health', url: '/api/health' });
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // Should not set up response logging
    res.emit('finish');
    expect(logger.log).not.toHaveBeenCalled();
  });

  test('does not skip logging for non-health paths', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq({ path: '/api/users', url: '/api/users' });
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);
    res.emit('finish');

    expect(logger.log).toHaveBeenCalledTimes(1);
  });

  test('calls next() immediately', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // Logger should NOT have been called yet (only on finish)
    expect(logger.log).not.toHaveBeenCalled();
  });

  test('sets x-request-trace-id response header (32 char hex)', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq();
    const res = mockRes();

    middleware(req, res, jest.fn());

    expect(res.setHeader).toHaveBeenCalledWith('x-request-trace-id', expect.any(String));
    const traceId = res.headers['x-request-trace-id'];
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  test('attaches traceIds to req object', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const sessionId = 'abc123session';
    const req = mockReq({ headers: { 'x-session-trace-id': sessionId } });
    const res = mockRes();

    middleware(req, res, jest.fn());

    expect(req.requestTraceId).toMatch(/^[0-9a-f]{32}$/);
    expect(req.sessionTraceId).toBe(sessionId);
  });

  test('logs on response finish with correct fields', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq({ method: 'POST', originalUrl: '/api/rooms/join' });
    const res = mockRes();
    res.statusCode = 200;

    middleware(req, res, jest.fn());
    res.emit('finish');

    expect(logger.log).toHaveBeenCalledTimes(1);
    const entry = logger.log.mock.calls[0][0];
    expect(entry.level).toBe('INFO');
    expect(entry.source).toBe('http');
    expect(entry.message).toMatch(/^POST \/api\/rooms\/join 200 \d+ms$/);
    expect(entry.requestTraceId).toMatch(/^[0-9a-f]{32}$/);
    expect(entry.context.method).toBe('POST');
    expect(entry.context.path).toBe('/api/rooms/join');
    expect(entry.context.statusCode).toBe(200);
  });

  test('logs ERROR level for 5xx responses', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq();
    const res = mockRes();
    res.statusCode = 500;

    middleware(req, res, jest.fn());
    res.emit('finish');

    expect(logger.log.mock.calls[0][0].level).toBe('ERROR');
  });

  test('logs WARN level for 4xx responses', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq();
    const res = mockRes();
    res.statusCode = 404;

    middleware(req, res, jest.fn());
    res.emit('finish');

    expect(logger.log.mock.calls[0][0].level).toBe('WARN');
  });

  test('logs INFO level for 2xx responses', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq();
    const res = mockRes();
    res.statusCode = 201;

    middleware(req, res, jest.fn());
    res.emit('finish');

    expect(logger.log.mock.calls[0][0].level).toBe('INFO');
  });

  test('sanitizes request body (strips password, token)', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq({
      body: {
        username: 'alice',
        password: 'secret123',
        token: 'tok_abc',
        idToken: 'id_tok_xyz',
        accessToken: 'at_123',
        refreshToken: 'rt_456',
        secret: 'shh',
        credential: 'cred_789',
        displayName: 'Alice',
      },
    });
    const res = mockRes();

    middleware(req, res, jest.fn());
    res.emit('finish');

    const body = logger.log.mock.calls[0][0].context.requestBody;
    expect(body.username).toBe('alice');
    expect(body.displayName).toBe('Alice');
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('token');
    expect(body).not.toHaveProperty('idToken');
    expect(body).not.toHaveProperty('accessToken');
    expect(body).not.toHaveProperty('refreshToken');
    expect(body).not.toHaveProperty('secret');
    expect(body).not.toHaveProperty('credential');
  });

  test('never throws if logger fails', () => {
    const logger = {
      log: jest.fn(() => {
        throw new Error('Logger exploded');
      }),
    };
    const middleware = createRequestLogger(logger);
    const req = mockReq();
    const res = mockRes();

    middleware(req, res, jest.fn());

    // Should not throw
    expect(() => res.emit('finish')).not.toThrow();
  });

  test('includes durationMs in context', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq();
    const res = mockRes();

    middleware(req, res, jest.fn());
    res.emit('finish');

    const ctx = logger.log.mock.calls[0][0].context;
    expect(typeof ctx.durationMs).toBe('number');
    expect(ctx.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('userId comes from req.auth.uid when available', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq({ auth: { uid: 'user_123' } });
    const res = mockRes();

    middleware(req, res, jest.fn());
    res.emit('finish');

    expect(logger.log.mock.calls[0][0].userId).toBe('user_123');
  });

  test('userId is null for pre-auth requests', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq();
    const res = mockRes();

    middleware(req, res, jest.fn());
    res.emit('finish');

    expect(logger.log.mock.calls[0][0].userId).toBeNull();
  });
});

describe('sanitizeBody', () => {
  test('returns non-object values as-is', () => {
    expect(sanitizeBody(null)).toBeNull();
    expect(sanitizeBody(undefined)).toBeUndefined();
    expect(sanitizeBody('string')).toBe('string');
  });

  test('strips sensitive keys case-insensitively', () => {
    const result = sanitizeBody({ Password: 'x', TOKEN: 'y', name: 'z' });
    expect(result).toEqual({ name: 'z' });
  });

  test('strips pin from request body', () => {
    const result = sanitizeBody({ pin: '1234', uniqueId: '10000001' });
    expect(result).not.toHaveProperty('pin');
    expect(result.uniqueId).toBe('10000001');
  });

  test('strips code from request body', () => {
    const result = sanitizeBody({ code: '482715', email: 'user@example.com' });
    expect(result).not.toHaveProperty('code');
    expect(result.email).toBe('user@example.com');
  });

  test('strips Pin and Code case-insensitively', () => {
    const result = sanitizeBody({ PIN: '5678', CODE: '999999', name: 'test' });
    expect(result).not.toHaveProperty('PIN');
    expect(result).not.toHaveProperty('CODE');
    expect(result.name).toBe('test');
  });
});

describe('requestLogger middleware — pin/code redaction end-to-end', () => {
  test('pin and code fields in request body are not present in logged output', () => {
    const logger = mockLogger();
    const middleware = createRequestLogger(logger);
    const req = mockReq({
      method: 'POST',
      originalUrl: '/api/auth/pin/verify',
      body: {
        pin: '1234',
        code: '482715',
        email: 'user@example.com',
        uniqueId: '10000001',
      },
    });
    const res = mockRes();

    middleware(req, res, jest.fn());
    res.emit('finish');

    const loggedBody = logger.log.mock.calls[0][0].context.requestBody;
    expect(loggedBody).not.toHaveProperty('pin');
    expect(loggedBody).not.toHaveProperty('code');
    expect(loggedBody.email).toBe('user@example.com');
    expect(loggedBody.uniqueId).toBe('10000001');
  });
});

// Phase 2H finding #6: nested credentials + extended denylist.
describe('sanitizeBody — recursion + extended denylist (Phase 2H finding #6)', () => {
  const { sanitizeBody } = require('../../src/middleware/requestLogger');

  test('strips nested password under a DTO wrapper', () => {
    const out = sanitizeBody({ user: { password: 'p', email: 'a@b.c' } });
    expect(out.user).not.toHaveProperty('password');
    expect(out.user.email).toBe('a@b.c');
  });

  test('strips nested idToken inside an array element', () => {
    const out = sanitizeBody({ batch: [{ idToken: 'eyJ', name: 'first' }] });
    expect(out.batch[0]).not.toHaveProperty('idToken');
    expect(out.batch[0].name).toBe('first');
  });

  test('strips passcode / otp / totp / verifier (previously missing)', () => {
    const out = sanitizeBody({
      passcode: '1234',
      otp: '5678',
      totp: '9012',
      verifier: 'sig',
      kept: 'ok',
    });
    expect(out).not.toHaveProperty('passcode');
    expect(out).not.toHaveProperty('otp');
    expect(out).not.toHaveProperty('totp');
    expect(out).not.toHaveProperty('verifier');
    expect(out.kept).toBe('ok');
  });

  test('strips clientSecret / apiKey / recoveryCode / appleSignedPayload', () => {
    const out = sanitizeBody({
      clientSecret: 'cs',
      apiKey: 'ak',
      recoveryCode: 'rc',
      appleSignedPayload: 'asp',
      keep: 1,
    });
    expect(out).not.toHaveProperty('clientSecret');
    expect(out).not.toHaveProperty('apiKey');
    expect(out).not.toHaveProperty('recoveryCode');
    expect(out).not.toHaveProperty('appleSignedPayload');
    expect(out.keep).toBe(1);
  });

  test('strips key with sensitive substring even when surrounded (idToken, refreshToken, oldPin, passwordHash)', () => {
    const out = sanitizeBody({
      idToken: 'a',
      refreshToken: 'b',
      oldPin: 'c',
      passwordHash: 'd',
      regular: 'e',
    });
    expect(out).not.toHaveProperty('idToken');
    expect(out).not.toHaveProperty('refreshToken');
    expect(out).not.toHaveProperty('oldPin');
    expect(out).not.toHaveProperty('passwordHash');
    expect(out.regular).toBe('e');
  });

  test('caps recursion at SANITIZE_DEPTH_LIMIT (DoS guard)', () => {
    // Build a 20-deep nested object — well past the cap of 8.
    let obj = { v: 'leaf' };
    for (let i = 0; i < 20; i++) obj = { wrap: obj };
    const out = sanitizeBody(obj);
    // Walk down until we hit a non-object — the cap returns `null` so we
    // can detect it. Anything deeper than the limit collapses to null.
    let cur = out;
    let depth = 0;
    while (cur && typeof cur === 'object' && cur.wrap !== undefined) {
      cur = cur.wrap;
      depth++;
      if (depth > 50) break; // safety against an infinite loop on regression
    }
    // Below the limit we keep returning objects; at the limit we get null.
    expect(cur).toBeNull();
    expect(depth).toBeLessThanOrEqual(20);
  });

  test('preserves non-object values (string/number/null) untouched', () => {
    expect(sanitizeBody('hello')).toBe('hello');
    expect(sanitizeBody(42)).toBe(42);
    expect(sanitizeBody(null)).toBeNull();
    expect(sanitizeBody(undefined)).toBeUndefined();
  });
});
