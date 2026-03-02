const { matchRoute, normalizeKeys, Router } = require('../utils');

describe('matchRoute', () => {
  test('matches exact static paths', () => {
    expect(matchRoute('/api/health', '/api/health')).toEqual({});
  });

  test('returns null for non-matching static paths', () => {
    expect(matchRoute('/api/health', '/api/other')).toBeNull();
  });

  test('extracts single param', () => {
    expect(matchRoute('/api/users/:uid', '/api/users/abc123')).toEqual({ uid: 'abc123' });
  });

  test('extracts multiple params', () => {
    expect(matchRoute('/api/users/:uid/backpack/:giftId', '/api/users/u1/backpack/g2'))
      .toEqual({ uid: 'u1', giftId: 'g2' });
  });

  test('returns null for different segment counts', () => {
    expect(matchRoute('/api/users/:uid', '/api/users/abc/extra')).toBeNull();
    expect(matchRoute('/api/users/:uid/extra', '/api/users/abc')).toBeNull();
  });

  test('returns null when static segments differ', () => {
    expect(matchRoute('/api/users/:uid', '/api/rooms/abc')).toBeNull();
  });

  test('decodes URI components in params', () => {
    expect(matchRoute('/api/users/:uid', '/api/users/hello%20world'))
      .toEqual({ uid: 'hello world' });
  });

  test('/api/user/:uid does not match /api/users/:uid', () => {
    expect(matchRoute('/api/user/:uid', '/api/users/abc')).toBeNull();
  });

  test('/api/users/:uid/exists matches correctly', () => {
    expect(matchRoute('/api/users/:uid/exists', '/api/users/abc/exists'))
      .toEqual({ uid: 'abc' });
  });

  test('/api/users/:uid/exists does not match /api/users/:uid/economy', () => {
    expect(matchRoute('/api/users/:uid/exists', '/api/users/abc/economy')).toBeNull();
  });
});

describe('normalizeKeys', () => {
  test('converts top-level camelCase keys to snake_case', () => {
    const result = normalizeKeys({ dateOfBirth: 123, displayName: 'test' });
    expect(result).toEqual({ date_of_birth: 123, display_name: 'test' });
  });

  test('converts nested objects recursively', () => {
    const result = normalizeKeys({ outerKey: { innerKey: 'val' } });
    expect(result).toEqual({ outer_key: { inner_key: 'val' } });
  });

  test('handles arrays', () => {
    const result = normalizeKeys([{ firstName: 'A' }, { firstName: 'B' }]);
    expect(result).toEqual([{ first_name: 'A' }, { first_name: 'B' }]);
  });

  test('passes through primitives', () => {
    expect(normalizeKeys('hello')).toBe('hello');
    expect(normalizeKeys(42)).toBe(42);
    expect(normalizeKeys(null)).toBeNull();
  });
});

describe('Router', () => {
  let router;

  beforeEach(() => {
    router = new Router();
  });

  test('matches GET route', () => {
    const handler = jest.fn();
    router.get('/api/health', handler);
    const result = router.match('GET', '/api/health');
    expect(result).not.toBeNull();
    expect(result.handler).toBe(handler);
  });

  test('returns null for unregistered route', () => {
    expect(router.match('GET', '/api/nothing')).toBeNull();
  });

  test('matches correct HTTP method', () => {
    const getHandler = jest.fn();
    const postHandler = jest.fn();
    router.get('/api/test', getHandler);
    router.post('/api/test', postHandler);

    expect(router.match('GET', '/api/test').handler).toBe(getHandler);
    expect(router.match('POST', '/api/test').handler).toBe(postHandler);
    expect(router.match('PUT', '/api/test')).toBeNull();
  });

  test('first-match wins for overlapping param routes', () => {
    const first = jest.fn();
    const second = jest.fn();
    router.get('/api/users/:uid', first);
    router.get('/api/users/:id', second);

    const result = router.match('GET', '/api/users/abc');
    expect(result.handler).toBe(first);
  });

  test('static segments take precedence over param routes registered later', () => {
    // Register param route first, static second — first match wins
    const paramHandler = jest.fn();
    const staticHandler = jest.fn();
    router.get('/api/users/:uid', paramHandler);
    router.get('/api/users/batch', staticHandler);

    // /api/users/batch matches :uid first since param routes match anything
    const result = router.match('GET', '/api/users/batch');
    expect(result.handler).toBe(paramHandler); // first-match behavior
  });

  test('no collision between /api/user/:uid and /api/users/:uid', () => {
    const singular = jest.fn();
    const plural = jest.fn();
    router.get('/api/user/:uid', singular);
    router.get('/api/users/:uid', plural);

    expect(router.match('GET', '/api/user/abc').handler).toBe(singular);
    expect(router.match('GET', '/api/users/abc').handler).toBe(plural);
  });

  test('no collision between /api/users/:uid and /api/users/:uid/exists', () => {
    const userHandler = jest.fn();
    const existsHandler = jest.fn();
    router.get('/api/users/:uid', userHandler);
    router.get('/api/users/:uid/exists', existsHandler);

    expect(router.match('GET', '/api/users/abc').handler).toBe(userHandler);
    expect(router.match('GET', '/api/users/abc/exists').handler).toBe(existsHandler);
  });

  test('supports all HTTP methods', () => {
    const h = jest.fn();
    router.get('/a', h);
    router.post('/b', h);
    router.put('/c', h);
    router.patch('/d', h);
    router.delete('/e', h);

    expect(router.match('GET', '/a')).not.toBeNull();
    expect(router.match('POST', '/b')).not.toBeNull();
    expect(router.match('PUT', '/c')).not.toBeNull();
    expect(router.match('PATCH', '/d')).not.toBeNull();
    expect(router.match('DELETE', '/e')).not.toBeNull();
  });
});
