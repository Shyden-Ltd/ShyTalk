/* eslint-disable sonarjs/no-clear-text-protocols -- test URLs are intentionally HTTP */
const { configure, apiCall, resetAbortController } = require('../../../public/js/core/api');

// Mock global fetch
global.fetch = jest.fn();

const TEST_API_BASE = 'http://test:3000';

beforeEach(() => {
  jest.clearAllMocks();
  configure({ apiBase: TEST_API_BASE, getToken: () => Promise.resolve('test-token') });
});

function mockFetchOk(body = { success: true }, contentType = 'application/json') {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    json: () => Promise.resolve(body),
  });
}

function mockFetchError(status, body = { error: 'Bad request' }, contentType = 'application/json') {
  global.fetch.mockResolvedValue({
    ok: false,
    status,
    headers: { get: () => contentType },
    json: () => Promise.resolve(body),
  });
}

describe('apiCall', () => {
  test('1. sends correct method, URL, and Authorization header', async () => {
    mockFetchOk();
    await apiCall('GET', '/api/users');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://test:3000/api/users');
    expect(opts.method).toBe('GET');
    expect(opts.headers['Authorization']).toBe('Bearer test-token');
  });

  test('2. sends JSON Content-Type and stringified body when body is an object', async () => {
    mockFetchOk();
    await apiCall('POST', '/api/users', { name: 'Alice' });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe(JSON.stringify({ name: 'Alice' }));
  });

  test('3. does NOT set Content-Type when body is FormData', async () => {
    mockFetchOk();
    const form = new FormData();
    form.append('key', 'value');
    await apiCall('POST', '/api/upload', form);
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBeUndefined();
    expect(opts.body).toBe(form);
  });

  test('4. returns parsed JSON on success (200)', async () => {
    mockFetchOk({ id: 1, name: 'Alice' });
    const result = await apiCall('GET', '/api/users/1');
    expect(result).toEqual({ id: 1, name: 'Alice' });
  });

  test('5. throws Error with error message from response on non-ok status', async () => {
    mockFetchError(400, { error: 'Invalid input' });
    await expect(apiCall('POST', '/api/users', { name: '' })).rejects.toThrow('Invalid input');
  });

  test('5b. throws HTTP status fallback when response has no error field', async () => {
    mockFetchError(500, {});
    await expect(apiCall('GET', '/api/broken')).rejects.toThrow('HTTP 500');
  });

  test('5c. attaches status (but not body) to thrown error for string-error responses', async () => {
    mockFetchError(400, { error: 'Invalid input' });
    try {
      await apiCall('POST', '/api/users', { name: '' });
      throw new Error('expected apiCall to throw');
    } catch (err) {
      expect(err.message).toBe('Invalid input');
      expect(err.status).toBe(400);
      // Narrow contract: full body is NOT attached for ad-hoc string errors —
      // limits blast radius if a caller ever logs `err.body` to a tracker.
      expect(err.body).toBeUndefined();
      // No typed code → err.code must be absent
      expect(err.code).toBeUndefined();
    }
  });

  test('5d. extracts message and whitelisted code from nested error object (typed-error route)', async () => {
    const wireBody = {
      error: {
        code: 'CANNOT_OVERRIDE_REGULAR_USER',
        message: 'Cohort override can only be applied to staff or admin accounts.',
      },
    };
    mockFetchError(422, wireBody);
    try {
      await apiCall('POST', '/api/admin/users/u1/cohort-override', { cohort: 'minor' });
      throw new Error('expected apiCall to throw');
    } catch (err) {
      // Message is extracted from nested .error.message — NOT stringified to "[object Object]"
      expect(err.message).toBe('Cohort override can only be applied to staff or admin accounts.');
      expect(err.message).not.toContain('[object Object]');
      // Caller branches on the whitelisted err.code field, not err.body traversal
      expect(err.status).toBe(422);
      expect(err.code).toBe('CANNOT_OVERRIDE_REGULAR_USER');
      // Full body intentionally NOT attached — callers use the whitelisted fields
      expect(err.body).toBeUndefined();
    }
  });

  test('5e. falls back to HTTP status when nested error has neither string nor message field', async () => {
    // Edge case: error is an object but missing both string fallback and .message
    mockFetchError(500, { error: { code: 'UNKNOWN_FAILURE' } });
    try {
      await apiCall('GET', '/api/broken');
      throw new Error('expected apiCall to throw');
    } catch (err) {
      expect(err.message).toBe('HTTP 500');
      expect(err.status).toBe(500);
      // Whitelisted code still surfaces even when message is absent
      expect(err.code).toBe('UNKNOWN_FAILURE');
      expect(err.body).toBeUndefined();
    }
  });

  test('5f. handles null/non-object body without crashing on field extraction', async () => {
    // Defensive: server could return `null` JSON (unusual but valid)
    global.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(null),
    });
    try {
      await apiCall('GET', '/api/upstream');
      throw new Error('expected apiCall to throw');
    } catch (err) {
      expect(err.message).toBe('HTTP 502');
      expect(err.status).toBe(502);
      expect(err.code).toBeUndefined();
      expect(err.body).toBeUndefined();
    }
  });

  test('5g. ignores non-string code on typed error (avoids leaking arbitrary types via err.code)', async () => {
    // Hostile/buggy server returns { error: { code: <object> } } — extraction must reject non-strings
    mockFetchError(500, { error: { code: { evil: 'payload' }, message: 'boom' } });
    try {
      await apiCall('GET', '/api/edge');
      throw new Error('expected apiCall to throw');
    } catch (err) {
      expect(err.message).toBe('boom');
      expect(err.status).toBe(500);
      expect(err.code).toBeUndefined();
    }
  });

  test('6. throws when response content-type is not JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      json: () => Promise.resolve({}),
    });
    await expect(apiCall('GET', '/api/html')).rejects.toThrow('server returned non-JSON response');
  });

  test('7. apiCall uses AbortController signal by default', async () => {
    mockFetchOk();
    await apiCall('GET', '/api/items');
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.signal).toBeDefined();
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  test('8. apiCall skips AbortController when skipTabAbort is true', async () => {
    mockFetchOk();
    await apiCall('GET', '/api/items', null, { skipTabAbort: true });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.signal).toBeUndefined();
  });

  test('9. apiCall uses custom signal when provided', async () => {
    mockFetchOk();
    const customController = new AbortController();
    await apiCall('GET', '/api/items', null, { signal: customController.signal });
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.signal).toBe(customController.signal);
  });

  test('10. resetAbortController creates a new controller (old signal is aborted)', async () => {
    // Capture the old signal by making a call first
    mockFetchOk();
    await apiCall('GET', '/api/items');
    const [, optsBeforeReset] = global.fetch.mock.calls[0];
    const oldSignal = optsBeforeReset.signal;

    // Signal is not yet aborted
    expect(oldSignal.aborted).toBe(false);

    // Reset — this aborts the old controller and creates a new one
    resetAbortController();

    expect(oldSignal.aborted).toBe(true);

    // New call gets a new (non-aborted) signal
    jest.clearAllMocks();
    mockFetchOk();
    await apiCall('GET', '/api/items');
    const [, optsAfterReset] = global.fetch.mock.calls[0];
    const newSignal = optsAfterReset.signal;

    expect(newSignal).not.toBe(oldSignal);
    expect(newSignal.aborted).toBe(false);
  });

  test('11. configure sets apiBase correctly (URL prefix)', async () => {
    configure({ apiBase: 'http://other-host:9000', getToken: () => Promise.resolve('tok') });
    mockFetchOk();
    await apiCall('GET', '/ping');
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('http://other-host:9000/ping');
  });

  test('12. configure sets getToken correctly (token appears in Authorization header)', async () => {
    configure({ apiBase: 'http://test:3000', getToken: () => Promise.resolve('my-custom-token') });
    mockFetchOk();
    await apiCall('GET', '/secure');
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer my-custom-token');
  });
});
