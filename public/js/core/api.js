/**
 * Fetch wrapper with per-tab AbortController.
 * Configure once at app startup with configure(), then call apiCall() anywhere.
 */

let _apiBase = '';
let _getToken = () => Promise.resolve(null);
let _abortController = new AbortController();

export function configure({ apiBase, getToken }) {
  _apiBase = apiBase;
  _getToken = getToken;
}

export function resetAbortController() {
  _abortController.abort();
  _abortController = new AbortController();
}

export async function apiCall(method, path, body, { signal, skipTabAbort } = {}) {
  const token = await _getToken();
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}` },
    signal: signal || (skipTabAbort ? undefined : _abortController.signal),
  };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${_apiBase}${path}`, opts);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`HTTP ${res.status}: server returned non-JSON response`);
  }
  const data = await res.json();
  if (!res.ok) {
    // Whitelist specific structured fields onto the thrown Error so callers
    // can branch on typed-error codes (e.g. `err.code === 'CANNOT_OVERRIDE_REGULAR_USER'`)
    // without exposing the whole server response. Attaching the full body would
    // broaden the blast radius of any future code that logs `err.body` to a
    // third-party tracker or renders it into the DOM. `Error`'s constructor
    // stringifies object args to "[object Object]" so we extract fields explicitly.
    const errorField = data && data.error;
    const isTypedError = errorField && typeof errorField === 'object';
    const message =
      (typeof errorField === 'string' && errorField) ||
      (isTypedError && typeof errorField.message === 'string' && errorField.message) ||
      `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    if (isTypedError && typeof errorField.code === 'string') {
      err.code = errorField.code;
    }
    throw err;
  }
  return data;
}
