const { createRequestLogger, sanitizeBody } = require('../../src/middleware/requestLogger');
const EventEmitter = require('events');

/**
 * Create a mock request object.
 */
function mockReq(overrides = {}) {
  return {
    method: 'GET',
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
});
