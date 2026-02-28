/**
 * Shared utilities for the ShyTalk Worker API.
 */

/**
 * Create a JSON response.
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Create a JSON error response.
 */
function jsonError(message, status = 400) {
  return json({ error: message }, status);
}

/**
 * Generate a random ID (used for document IDs like Firestore auto-IDs).
 */
function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

/**
 * Current time in Unix milliseconds.
 */
function now() {
  return Date.now();
}

/**
 * Today's date as YYYY-MM-DD string.
 */
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Yesterday's date as YYYY-MM-DD string.
 */
function yesterdayStr() {
  return new Date(Date.now() - 86400000).toISOString().split('T')[0];
}

/**
 * Parse the request body as JSON. Returns null on failure.
 */
async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Extract route params from a URL path using a pattern.
 * Pattern: "/api/users/:uid/backpack/:giftId"
 * Returns: { uid: "abc", giftId: "xyz" } or null if no match.
 */
function matchRoute(pattern, pathname) {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

/**
 * Simple router class for organizing Worker routes.
 */
class Router {
  constructor() {
    this.routes = [];
  }

  get(path, handler) { this.routes.push({ method: 'GET', path, handler }); }
  post(path, handler) { this.routes.push({ method: 'POST', path, handler }); }
  put(path, handler) { this.routes.push({ method: 'PUT', path, handler }); }
  patch(path, handler) { this.routes.push({ method: 'PATCH', path, handler }); }
  delete(path, handler) { this.routes.push({ method: 'DELETE', path, handler }); }

  /**
   * Match an incoming request against registered routes.
   * Returns { handler, params } or null.
   */
  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchRoute(route.path, pathname);
      if (params !== null) {
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}

/**
 * Extract R2 key from a public CDN URL.
 */
function extractR2Key(url) {
  const prefix = 'https://images.shytalk.shyden.co.uk/';
  if (!url || !url.startsWith(prefix)) return null;
  return url.slice(prefix.length);
}

/**
 * CORS preflight response.
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function corsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

module.exports = {
  json,
  jsonError,
  generateId,
  now,
  todayStr,
  yesterdayStr,
  parseBody,
  matchRoute,
  Router,
  extractR2Key,
  corsHeaders,
  corsResponse,
};
