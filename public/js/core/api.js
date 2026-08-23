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

/**
 * Fetch a binary response the browser can render, as an object URL.
 *
 * `apiCall` cannot carry this: it insists on a JSON body and would throw on
 * every image. And an `<img src="/api/...">` cannot carry the bearer token, so
 * an authenticated media route reached that way answers 401 and the browser
 * draws a broken image with no error anybody sees.
 *
 * That is what happened to support-ticket attachments (SHY-0449): SHY-0420
 * moved them from public CDN URLs to an authenticated stream, the renderer kept
 * putting the path straight into `<img src>`, and no attachment has displayed
 * for a moderator since.
 *
 * The caller MUST revoke the returned URL when it is finished with it,
 * otherwise the bytes stay in memory for the life of the page.
 */
export async function fetchObjectUrl(path, { signal } = {}) {
  const token = await _getToken();
  const res = await fetch(`${_apiBase}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: signal || _abortController.signal,
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), contentType: blob.type || '' };
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
