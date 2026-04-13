/**
 * TOTP secret encryption/decryption using AES-256-GCM.
 *
 * Encrypted format: "<iv_hex>:<ciphertext_hex>:<tag_hex>"
 *   - IV:         12 bytes (96 bits), randomly generated per encryption
 *   - Ciphertext: same length as plaintext, hex-encoded
 *   - Auth tag:   16 bytes (128 bits), hex-encoded
 *
 * Key source: TOTP_ENCRYPTION_KEY environment variable (64 hex chars = 32 bytes)
 *
 * Usage:
 *   const { encryptSecret, decryptSecret } = require('./totp-crypto');
 *   const stored = encryptSecret(rawBase32Secret);
 *   const raw    = decryptSecret(stored);
 */

'use strict';

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_HEX_LENGTH = 64; // 32 bytes × 2 hex chars each

// ─── Lazy key resolution ──────────────────────────────────────────
//
// Resolve (and validate) the TOTP_ENCRYPTION_KEY env var the first
// time an encrypt/decrypt call is made, not at module load. This
// isolates config errors to the TOTP endpoints — missing/invalid key
// fails those calls with a clear 500 instead of taking down the
// entire Express API on startup.

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const rawKey = process.env.TOTP_ENCRYPTION_KEY;
  if (!rawKey || rawKey.length !== KEY_HEX_LENGTH) {
    throw new Error(
      `TOTP_ENCRYPTION_KEY must be exactly ${KEY_HEX_LENGTH} hex characters (32 bytes). ` +
        `Got: ${rawKey ? rawKey.length : 0} characters.`,
    );
  }
  cachedKey = Buffer.from(rawKey, 'hex');
  return cachedKey;
}

// ─── encryptSecret ────────────────────────────────────────────────

/**
 * Encrypts a TOTP secret string using AES-256-GCM.
 *
 * @param {string} plaintext - The raw TOTP secret (e.g. BASE32 string).
 * @returns {string} Encrypted string in the format "iv:ciphertext:tag" (hex).
 */
function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  const tag = cipher.getAuthTag();

  return [iv.toString('hex'), ciphertext.toString('hex'), tag.toString('hex')].join(':');
}

// ─── decryptSecret ────────────────────────────────────────────────

/**
 * Decrypts an encrypted TOTP secret string produced by encryptSecret().
 *
 * @param {string} encryptedString - "iv:ciphertext:tag" (hex).
 * @returns {string} The original plaintext.
 * @throws {Error} If the format is invalid, the key is wrong, or the data is tampered.
 */
function decryptSecret(encryptedString) {
  const parts = encryptedString.split(':');

  if (parts.length !== 3) {
    throw new Error(
      `Invalid encrypted format. Expected "iv:ciphertext:tag", got ${parts.length} part(s).`,
    );
  }

  const [ivHex, ciphertextHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return plaintext.toString('utf8');
}

// ─── Exports ──────────────────────────────────────────────────────

module.exports = { encryptSecret, decryptSecret };
