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
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
