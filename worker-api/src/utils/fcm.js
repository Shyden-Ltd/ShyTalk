/**
 * FCM HTTP v1 API utility for sending push notifications from Cloudflare Workers.
 *
 * Uses Google's FCM HTTP v1 API with service account JWT authentication.
 * Requires Wrangler secrets:
 *   - FCM_SERVICE_ACCOUNT_EMAIL
 *   - FCM_SERVICE_ACCOUNT_PRIVATE_KEY (RSA PEM)
 *   - FIREBASE_PROJECT_ID
 */

// Module-scope access token cache
let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Base64url-encode a string or ArrayBuffer.
 */
function base64url(input) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);

  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Import a PEM-encoded RSA private key for JWT signing.
 */
async function importPrivateKey(pem) {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Get an OAuth2 access token for the FCM API.
 * Signs a JWT with the service account private key, then exchanges it
 * at Google's token endpoint. Caches for 55 minutes (tokens last 60 min).
 */
async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid
  if (cachedAccessToken && Date.now() < tokenExpiresAt) {
    return cachedAccessToken;
  }

  const email = env.FCM_SERVICE_ACCOUNT_EMAIL;
  const privateKeyPem = env.FCM_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !privateKeyPem) {
    throw new Error('FCM service account credentials not configured');
  }

  // Build JWT
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const signingInput = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));

  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );

  const jwt = signingInput + '.' + base64url(signature);

  // Exchange JWT for access token
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get access token: ${response.status} ${text}`);
  }

  const tokenData = await response.json();
  cachedAccessToken = tokenData.access_token;
  // Cache for 55 minutes (tokens last 60 min)
  tokenExpiresAt = Date.now() + 55 * 60 * 1000;

  return cachedAccessToken;
}

/**
 * Send a data-only FCM message to a single token.
 * Returns { success: boolean, invalidToken: boolean }.
 */
async function sendFcmNotification(env, token, data) {
  const accessToken = await getAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          data: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v)])
          ),
        },
      }),
    }
  );

  if (response.ok) {
    return { success: true, invalidToken: false };
  }

  const errorBody = await response.json().catch(() => ({}));
  const errorCode = errorBody?.error?.details?.[0]?.errorCode
    || errorBody?.error?.code;

  // Token is invalid/expired — should be cleaned up
  const isInvalid = errorCode === 'UNREGISTERED'
    || errorCode === 'INVALID_ARGUMENT'
    || response.status === 404;

  if (isInvalid) {
    return { success: false, invalidToken: true };
  }

  console.error(`FCM send failed: ${response.status}`, JSON.stringify(errorBody));
  return { success: false, invalidToken: false };
}

/**
 * Send a data-only FCM message to multiple tokens.
 * Returns a list of invalid tokens that should be cleaned up.
 */
async function sendFcmToTokens(env, tokens, data) {
  if (!tokens || tokens.length === 0) return [];

  const results = await Promise.allSettled(
    tokens.map(token => sendFcmNotification(env, token, data))
  );

  const invalidTokens = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value.invalidToken) {
      invalidTokens.push(tokens[i]);
    }
  });

  return invalidTokens;
}

/**
 * Remove invalid FCM tokens from user docs in Firestore.
 * Tokens are stored as an array field `fcmTokens` on each user doc.
 *
 * @param {object} env - Worker env bindings
 * @param {string[]} invalidTokens - Tokens that FCM rejected
 * @param {string} userId - The user ID whose doc contains these tokens
 */
async function cleanupInvalidTokens(env, invalidTokens, userId) {
  if (!invalidTokens || invalidTokens.length === 0 || !userId) return;

  const { getDoc, updateDoc } = require('./firestore');
  const user = await getDoc(env, `users/${userId}`);
  if (!user) return;

  const currentTokens = user.fcmTokens || [];
  const cleaned = currentTokens.filter(t => !invalidTokens.includes(t));

  if (cleaned.length !== currentTokens.length) {
    await updateDoc(env, `users/${userId}`, { fcmTokens: cleaned });
    console.log(`Cleaned ${currentTokens.length - cleaned.length} invalid tokens for user ${userId}`);
  }
}

module.exports = {
  getAccessToken,
  sendFcmNotification,
  sendFcmToTokens,
  cleanupInvalidTokens,
};
