const { requireSystemAuth } = require('../../src/middleware/system-auth');

describe('requireSystemAuth', () => {
  let req;
  let res;
  let next;
  let originalSecret;

  beforeEach(() => {
    originalSecret = process.env.SYSTEM_SHARED_SECRET;
    req = {
      path: '/system/sweep-account-deletions',
      get: jest.fn().mockReturnValue(''),
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.SYSTEM_SHARED_SECRET;
    } else {
      process.env.SYSTEM_SHARED_SECRET = originalSecret;
    }
  });

  test('returns 503 when SYSTEM_SHARED_SECRET is not configured', () => {
    delete process.env.SYSTEM_SHARED_SECRET;

    requireSystemAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: 'System authentication not configured',
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when Authorization header is missing', () => {
    process.env.SYSTEM_SHARED_SECRET = 'correct-secret';
    req.get.mockReturnValue('');

    requireSystemAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing bearer token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when Authorization header is not a Bearer token', () => {
    process.env.SYSTEM_SHARED_SECRET = 'correct-secret';
    req.get.mockReturnValue('Basic dXNlcjpwYXNz');

    requireSystemAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing bearer token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when bearer token is shorter than secret', () => {
    process.env.SYSTEM_SHARED_SECRET = 'correct-secret';
    req.get.mockReturnValue('Bearer too-short');

    requireSystemAuth(req, res, next);

    // HMAC compare path means no length-mismatch fast-exit: both
    // wrong-length and wrong-content tokens go through the same
    // constant-time compare and end here.
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid bearer token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when bearer token is longer than secret', () => {
    process.env.SYSTEM_SHARED_SECRET = 'correct-secret';
    req.get.mockReturnValue('Bearer correct-secret-with-extra-bytes-appended');

    requireSystemAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid bearer token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when bearer token matches length but not value', () => {
    process.env.SYSTEM_SHARED_SECRET = 'correct-secret';
    req.get.mockReturnValue('Bearer wrong-secret!');

    requireSystemAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid bearer token' });
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next() when bearer token matches secret exactly', () => {
    process.env.SYSTEM_SHARED_SECRET = 'correct-secret';
    req.get.mockReturnValue('Bearer correct-secret');

    requireSystemAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('accepts case-insensitive Bearer prefix', () => {
    process.env.SYSTEM_SHARED_SECRET = 'correct-secret';
    req.get.mockReturnValue('bearer correct-secret');

    requireSystemAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('uses lowercase "authorization" header lookup (Express normalises)', () => {
    process.env.SYSTEM_SHARED_SECRET = 'correct-secret';
    // Pin the lowercase-only invariant — if the source switches to
    // 'Authorization', this mock returns '' (the default) and the test
    // will fail.
    req.get.mockImplementation((header) =>
      header === 'authorization' ? 'Bearer correct-secret' : '',
    );

    requireSystemAuth(req, res, next);

    expect(req.get).toHaveBeenCalledWith('authorization');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('handles non-ASCII secrets correctly', () => {
    process.env.SYSTEM_SHARED_SECRET = 'sécret-with-unicodé';
    req.get.mockReturnValue('Bearer sécret-with-unicodé');

    requireSystemAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('tolerates extra whitespace after Bearer', () => {
    process.env.SYSTEM_SHARED_SECRET = 'correct-secret';
    req.get.mockReturnValue('Bearer    correct-secret');

    requireSystemAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
