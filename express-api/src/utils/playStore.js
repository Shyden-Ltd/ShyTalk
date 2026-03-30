/**
 * Google Play purchase verification via Android Publisher API.
 *
 * Uses google-auth-library (transitive dep of firebase-admin) to authenticate,
 * and native fetch to call the Android Publisher API v3.
 *
 * Usage:
 *   const { verifyProductPurchase, verifySubscription } = require('../utils/playStore');
 *   const purchase = await verifyProductPurchase(packageName, productId, token);
 */

const { GoogleAuth } = require('google-auth-library');
const log = require('./log');

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const BASE = 'https://androidpublisher.googleapis.com';
const API_PREFIX = '/androidpublisher/v3/applications';

/** Validate and encode a URL path segment to prevent path traversal. */
function safePathSegment(value, name) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${name} is required`);
  }
  if (value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`${name} contains invalid characters`);
  }
  return encodeURIComponent(value);
}

/** Build a Google Play API URL from pre-validated path segments. */
function buildApiUrl(segments) {
  const path = [API_PREFIX, ...segments].join('/');
  const url = new URL(path, BASE); // NOSONAR — segments are validated by safePathSegment()
  return url.href;
}

let authClient = null;

async function getAccessToken() {
  if (!authClient) {
    const auth = new GoogleAuth({ scopes: [SCOPE] });
    authClient = await auth.getClient();
  }
  const { token } = await authClient.getAccessToken();
  return token;
}

/**
 * Verify a one-time product purchase with the Google Play API.
 *
 * @param {string} packageName - App package name (e.g. 'com.shyden.shytalk')
 * @param {string} productId   - The in-app product ID
 * @param {string} token       - The purchase token from the client
 * @returns {Promise<object>}  - Parsed purchase response from Google
 * @throws {Error} If the purchase is invalid, already consumed, or API call fails
 */
async function verifyProductPurchase(packageName, productId, token) {
  const accessToken = await getAccessToken();
  const safePkg = safePathSegment(packageName, 'packageName');
  const safeProd = safePathSegment(productId, 'productId');
  const safeToken = safePathSegment(token, 'token');
  const url = buildApiUrl([safePkg, 'purchases', 'products', safeProd, 'tokens', safeToken]);

  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } }); // NOSONAR — URL segments validated by safePathSegment()

  if (!resp.ok) {
    const text = await resp.text();
    log.warn('playStore', 'Product purchase verification failed', {
      status: resp.status,
      productId,
      response: text,
    });
    throw new Error(`Google Play API returned ${resp.status}: ${text}`);
  }

  const data = await resp.json();

  if (data.purchaseState !== 0) {
    log.warn('playStore', 'Purchase not in purchased state', {
      productId,
      purchaseState: data.purchaseState,
    });
    throw new Error(`Purchase not in purchased state (purchaseState=${data.purchaseState})`);
  }

  if (data.consumptionState === 1) {
    log.warn('playStore', 'Purchase already consumed', {
      productId,
      orderId: data.orderId,
    });
    throw new Error('Purchase already consumed');
  }

  return data;
}

/**
 * Verify a subscription purchase with the Google Play API (v2).
 *
 * @param {string} packageName     - App package name
 * @param {string} subscriptionId  - The subscription product ID (unused in v2 URL but kept for logging)
 * @param {string} token           - The purchase token from the client
 * @returns {Promise<object>}      - Parsed subscription response from Google
 * @throws {Error} If the API call fails
 */
async function verifySubscription(packageName, subscriptionId, token) {
  const accessToken = await getAccessToken();
  const safePkg = safePathSegment(packageName, 'packageName');
  const safeToken = safePathSegment(token, 'token');
  const url = buildApiUrl([safePkg, 'purchases', 'subscriptionsv2', 'tokens', safeToken]);

  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } }); // NOSONAR — URL segments validated by safePathSegment()

  if (!resp.ok) {
    const text = await resp.text();
    log.warn('playStore', 'Subscription verification failed', {
      status: resp.status,
      subscriptionId,
      response: text,
    });
    throw new Error(`Google Play API returned ${resp.status}: ${text}`);
  }

  const data = await resp.json();

  const state = data.subscriptionState;
  if (state !== 'SUBSCRIPTION_STATE_ACTIVE' && state !== 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') {
    log.warn('playStore', 'Subscription not active', { packageName, subscriptionId, state });
    throw new Error(`Subscription not active (state=${state})`);
  }

  return data;
}

// Exposed for testing — allows resetting the cached auth client
function _resetAuthClient() {
  authClient = null;
}

module.exports = { verifyProductPurchase, verifySubscription, _resetAuthClient };
