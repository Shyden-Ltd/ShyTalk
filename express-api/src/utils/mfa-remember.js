/**
 * SHY-0147 — per-browser "remember this browser" MFA token.
 *
 * WHY A TOKEN AND NOT THE EXISTING CLAIM
 * The portal already had a 24-hour MFA window, but it lived in the Firebase
 * custom claims `totpVerified` / `totpVerifiedAt` — which are attached to the
 * USER, not the browser. Verifying a code in one browser therefore skipped the
 * prompt in every other browser and on every other device. That is the gap this
 * closes: the value below is carried in an httpOnly cookie, so it cannot leave
 * the browser it was issued to, and it identifies that browser explicitly.
 *
 * SHAPE  uniqueId.browserId.epoch.expiresAt.signature
 *
 * Signed with HMAC-SHA256 over the payload, mirroring the established pattern
 * in `routes/data-export.js` rather than inventing a second one.
 *
 * REVOCATION without storing anything per token: the payload carries the user's
 * `epoch`. Bumping that single number (on sign-out, or by an admin) invalidates
 * every outstanding token for that user at once. No token list to keep, nothing
 * to clean up, and revocation cannot silently miss one.
 *
 * FAIL-CLOSED: every rejection path returns `{ valid: false, reason }`. Nothing
 * here throws on malformed input — a forged or truncated cookie must re-prompt
 * for MFA, never surface as a 500. Note `crypto.timingSafeEqual` throws when the
 * buffers differ in length, so length is checked BEFORE comparing.
 *
 * This token governs ONLY the authenticator re-prompt. It is not an access
 * grant: suspension, revocation and force-sign-out are re-evaluated on every
 * `/portal/me` call regardless of it.
 */
const crypto = require('node:crypto');

const MFA_REMEMBER_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

if (!process.env.MFA_REMEMBER_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('MFA_REMEMBER_SECRET is required in production');
}
const SECRET = process.env.MFA_REMEMBER_SECRET || 'dev-mfa-remember-secret';

/** Field separator. Chosen because none of the payload fields can contain it. */
const SEP = '.';
const SIG_HEX_LEN = 64; // sha256 hex

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

/**
 * Constant-time comparison that cannot throw.
 *
 * `crypto.timingSafeEqual` raises when the buffers differ in length, so a
 * malformed cookie would become a 500 instead of a re-prompt. Length is
 * compared first; that leaks only the length, which is fixed and public.
 */
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  if (!/^[0-9a-f]+$/.test(a) || !/^[0-9a-f]+$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** A fresh, unguessable per-browser identifier. */
function newBrowserId() {
  return 'b-' + crypto.randomBytes(16).toString('hex');
}

/**
 * @param {{uniqueId:number|string, browserId:string, epoch:number, now?:number, ttlMs?:number}} args
 * @returns {string} the cookie value
 */
function issueMfaRememberToken({ uniqueId, browserId, epoch, now, ttlMs }) {
  const issuedAt = typeof now === 'number' ? now : Date.now();
  const lifetime = typeof ttlMs === 'number' ? ttlMs : MFA_REMEMBER_DEFAULT_TTL_MS;
  const expiresAt = issuedAt + lifetime;
  const payload = [uniqueId, browserId, epoch, expiresAt].join(SEP);
  return payload + SEP + sign(payload);
}

/**
 * @returns {{valid:true, browserId:string}|{valid:false, reason:string}}
 *   reason is one of malformed | signature | expired | revoked
 */
function verifyMfaRememberToken(token, { uniqueId, epoch, now } = {}) {
  if (typeof token !== 'string' || token.length === 0) {
    return { valid: false, reason: 'malformed' };
  }
  const parts = token.split(SEP);
  if (parts.length !== 5) return { valid: false, reason: 'malformed' };

  const [rawUid, browserId, rawEpoch, rawExpiry, signature] = parts;
  if (signature.length !== SIG_HEX_LEN) return { valid: false, reason: 'malformed' };
  if (!/^\d+$/.test(rawExpiry)) return { valid: false, reason: 'malformed' };
  if (!browserId) return { valid: false, reason: 'malformed' };

  // Verify the signature over the payload AS IT ARRIVED, not over the values we
  // expect. This is what makes the reason codes truthful, and the Observability
  // AC depends on telling these apart: a token we genuinely issued before the
  // user's epoch was bumped still carries a VALID signature over its own
  // payload, so it must be reported as `revoked`. Signing over the expected
  // epoch instead would report every revoked token as a forgery.
  const expected = sign([rawUid, browserId, rawEpoch, rawExpiry].join(SEP));
  if (!safeEqualHex(signature, expected)) return { valid: false, reason: 'signature' };

  // Only meaningful once the signature is trusted.
  if (String(rawUid) !== String(uniqueId)) return { valid: false, reason: 'signature' };
  if (String(rawEpoch) !== String(epoch)) return { valid: false, reason: 'revoked' };

  const at = typeof now === 'number' ? now : Date.now();
  if (at >= Number(rawExpiry)) return { valid: false, reason: 'expired' };

  return { valid: true, browserId };
}

module.exports = {
  MFA_REMEMBER_DEFAULT_TTL_MS,
  issueMfaRememberToken,
  verifyMfaRememberToken,
  newBrowserId,
};
