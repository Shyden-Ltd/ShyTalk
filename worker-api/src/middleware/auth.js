/**
 * Firebase ID token verification middleware for Cloudflare Workers.
 *
 * Verifies Firebase Auth ID tokens by:
 * 1. Decoding the JWT header to find the key ID (kid)
 * 2. Fetching Google's public keys (cached in KV for 1 hour)
 * 3. Verifying the JWT signature using Web Crypto API
 * 4. Validating claims (iss, aud, exp, iat, sub)
 */

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CERTS_CACHE_KEY = 'firebase_certs';
const CERTS_CACHE_TTL = 3600; // 1 hour in seconds

/**
 * Import an X.509 certificate as a CryptoKey for RS256 verification.
 */
async function importPublicKey(pem) {
  const pemBody = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  // Parse the X.509 certificate to extract the public key
  // Cloudflare Workers support importKey with 'spki' format
  // We need to extract the SubjectPublicKeyInfo from the X.509 cert
  const spki = extractSPKI(binaryDer);

  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

/**
 * Extract SubjectPublicKeyInfo from an X.509 DER-encoded certificate.
 * This is a minimal ASN.1 parser that finds the SPKI within the cert.
 */
function extractSPKI(der) {
  // X.509 structure: SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
  // tbsCertificate: SEQUENCE { version, serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo, ... }
  // We need to find subjectPublicKeyInfo (the 7th element in tbsCertificate)

  let offset = 0;

  function readTag() {
    const tag = der[offset++];
    return tag;
  }

  function readLength() {
    let length = der[offset++];
    if (length & 0x80) {
      const numBytes = length & 0x7f;
      length = 0;
      for (let i = 0; i < numBytes; i++) {
        length = (length << 8) | der[offset++];
      }
    }
    return length;
  }

  function skipElement() {
    readTag();
    const len = readLength();
    offset += len;
  }

  function readElement() {
    const start = offset;
    readTag();
    const len = readLength();
    const end = offset + len;
    offset = end;
    return der.slice(start, end);
  }

  // Outer SEQUENCE
  readTag(); // 0x30
  readLength();

  // tbsCertificate SEQUENCE
  readTag(); // 0x30
  readLength();

  // version [0] EXPLICIT (optional — tagged)
  if (der[offset] === 0xa0) {
    skipElement();
  }

  // serialNumber
  skipElement();

  // signature AlgorithmIdentifier
  skipElement();

  // issuer
  skipElement();

  // validity
  skipElement();

  // subject
  skipElement();

  // subjectPublicKeyInfo — this is what we want
  const spki = readElement();
  return spki;
}

/**
 * Base64url decode
 */
function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - padded.length % 4) % 4);
  return Uint8Array.from(atob(padded + padding), c => c.charCodeAt(0));
}

/**
 * Fetch and cache Google's public keys for Firebase token verification.
 */
async function getPublicKeys(env) {
  // Try KV cache first
  if (env.KV) {
    const cached = await env.KV.get(CERTS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const response = await fetch(GOOGLE_CERTS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Google certs: ${response.status}`);
  }

  const certs = await response.json();

  // Cache in KV
  if (env.KV) {
    await env.KV.put(CERTS_CACHE_KEY, JSON.stringify(certs), { expirationTtl: CERTS_CACHE_TTL });
  }

  return certs;
}

/**
 * Verify a Firebase ID token and return the decoded payload.
 * Throws on invalid/expired tokens.
 */
async function verifyFirebaseToken(idToken, env) {
  if (!idToken) {
    throw new AuthError('No token provided', 401);
  }

  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new AuthError('Invalid token format', 401);
  }

  // Decode header and payload
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));

  // Validate algorithm
  if (header.alg !== 'RS256') {
    throw new AuthError('Invalid algorithm', 401);
  }

  // Validate claims
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new AuthError('FIREBASE_PROJECT_ID not configured', 500);
  }

  const now = Math.floor(Date.now() / 1000);

  if (payload.exp <= now) {
    throw new AuthError('Token expired', 401);
  }

  if (payload.iat > now + 300) { // 5 min clock skew tolerance
    throw new AuthError('Token issued in the future', 401);
  }

  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new AuthError('Invalid issuer', 401);
  }

  if (payload.aud !== projectId) {
    throw new AuthError('Invalid audience', 401);
  }

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new AuthError('Invalid subject', 401);
  }

  // Verify signature
  const kid = header.kid;
  if (!kid) {
    throw new AuthError('No key ID in token header', 401);
  }

  const certs = await getPublicKeys(env);
  const certPem = certs[kid];
  if (!certPem) {
    throw new AuthError('Unknown key ID', 401);
  }

  const publicKey = await importPublicKey(certPem);
  const signatureData = base64UrlDecode(parts[2]);
  const signedContent = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signatureData,
    signedContent
  );

  if (!valid) {
    throw new AuthError('Invalid signature', 401);
  }

  return payload;
}

/**
 * Custom error class for auth failures.
 */
class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

/**
 * Middleware: extracts and verifies the Firebase ID token from the
 * Authorization header. Sets `request.auth` with { uid, token }.
 *
 * Returns null on success (proceed), or a Response on failure.
 */
async function authMiddleware(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonError('Missing or invalid Authorization header', 401);
  }

  const idToken = authHeader.slice(7);

  try {
    const decoded = await verifyFirebaseToken(idToken, env);
    request.auth = {
      uid: decoded.sub,
      token: decoded,
    };
    return null; // success — continue to handler
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.message, err.status);
    }
    console.error('Auth error:', err);
    return jsonError('Authentication failed', 401);
  }
}

/**
 * Optional auth: same as authMiddleware but doesn't fail on missing token.
 * Sets request.auth = null if no token present.
 */
async function optionalAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    request.auth = null;
    return null;
  }
  return authMiddleware(request, env);
}

/**
 * Admin-only middleware: verifies the user has admin custom claim.
 * Must be called after authMiddleware.
 */
function requireAdmin(request) {
  if (!request.auth || !request.auth.token.admin) {
    return jsonError('Admin access required', 403);
  }
  return null;
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

module.exports = {
  authMiddleware,
  optionalAuth,
  requireAdmin,
  verifyFirebaseToken,
  AuthError,
};
