/**
 * Tests for src/utils/totp-crypto.js
 *
 * Exported functions:
 * - encryptSecret(plaintext) → "iv:ciphertext:tag" (hex-encoded, AES-256-GCM)
 * - decryptSecret(encryptedString) → original plaintext
 *
 * Key is read lazily from TOTP_ENCRYPTION_KEY env var (64 hex chars = 32 bytes)
 * on the first encrypt/decrypt call. Missing/invalid key throws at call time,
 * not at module load, so a misconfigured dev env can't take down the whole API.
 */

const VALID_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

// ─── Lazy key validation (on first encrypt/decrypt call) ──────────

describe('lazy key validation', () => {
  const originalKey = process.env.TOTP_ENCRYPTION_KEY;

  afterEach(() => {
    // Restore env and purge module cache so each test gets a fresh load + cache
    if (originalKey === undefined) {
      delete process.env.TOTP_ENCRYPTION_KEY;
    } else {
      process.env.TOTP_ENCRYPTION_KEY = originalKey;
    }
    jest.resetModules();
  });

  it('module loads successfully when TOTP_ENCRYPTION_KEY is missing', () => {
    delete process.env.TOTP_ENCRYPTION_KEY;
    expect(() => require('../../src/utils/totp-crypto')).not.toThrow();
  });

  it('module loads successfully when TOTP_ENCRYPTION_KEY is invalid', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'too-short';
    expect(() => require('../../src/utils/totp-crypto')).not.toThrow();
  });

  it('encryptSecret throws a clear error when key is missing', () => {
    delete process.env.TOTP_ENCRYPTION_KEY;
    jest.resetModules();
    const { encryptSecret } = require('../../src/utils/totp-crypto');
    expect(() => encryptSecret('anything')).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it('decryptSecret throws a clear error when key is missing', () => {
    delete process.env.TOTP_ENCRYPTION_KEY;
    jest.resetModules();
    const { decryptSecret } = require('../../src/utils/totp-crypto');
    expect(() => decryptSecret('aa:bb:cc')).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it('encryptSecret throws when key is too short', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'a'.repeat(62);
    jest.resetModules();
    const { encryptSecret } = require('../../src/utils/totp-crypto');
    expect(() => encryptSecret('anything')).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it('encryptSecret throws when key is too long', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'a'.repeat(66);
    jest.resetModules();
    const { encryptSecret } = require('../../src/utils/totp-crypto');
    expect(() => encryptSecret('anything')).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it('encryptSecret succeeds when key is exactly 64 hex chars', () => {
    process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
    jest.resetModules();
    const { encryptSecret } = require('../../src/utils/totp-crypto');
    expect(() => encryptSecret('JBSWY3DPEHPK3PXP')).not.toThrow();
  });
});

// ─── Helpers — load module with a known valid key ──────────────────

function loadWithKey(key) {
  process.env.TOTP_ENCRYPTION_KEY = key;
  jest.resetModules();
  return require('../../src/utils/totp-crypto');
}

// ─── encryptSecret ────────────────────────────────────────────────

describe('encryptSecret()', () => {
  beforeEach(() => {
    process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
  });

  it('returns a string', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    expect(typeof encryptSecret('JBSWY3DPEHPK3PXP')).toBe('string');
  });

  it('returns exactly three colon-separated parts (iv:ciphertext:tag)', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const result = encryptSecret('JBSWY3DPEHPK3PXP');
    const parts = result.split(':');
    expect(parts).toHaveLength(3);
  });

  it('all three parts are non-empty hex strings', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const result = encryptSecret('JBSWY3DPEHPK3PXP');
    const [iv, ciphertext, tag] = result.split(':');
    expect(iv).toMatch(/^[0-9a-f]+$/i);
    expect(ciphertext).toMatch(/^[0-9a-f]+$/i);
    expect(tag).toMatch(/^[0-9a-f]+$/i);
  });

  it('IV is 24 hex chars (12 bytes)', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const [iv] = encryptSecret('JBSWY3DPEHPK3PXP').split(':');
    expect(iv).toHaveLength(24);
  });

  it('auth tag is 32 hex chars (16 bytes)', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const parts = encryptSecret('JBSWY3DPEHPK3PXP').split(':');
    expect(parts[2]).toHaveLength(32);
  });

  it('two encryptions of the same plaintext produce different ciphertexts (IV uniqueness)', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const a = encryptSecret('JBSWY3DPEHPK3PXP');
    const b = encryptSecret('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
  });

  it('two different secrets produce different ciphertexts', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const a = encryptSecret('SECRET_ONE');
    const b = encryptSecret('SECRET_TWO');
    expect(a).not.toBe(b);
  });
});

// ─── decryptSecret ────────────────────────────────────────────────

describe('decryptSecret()', () => {
  it('round-trip: decrypting an encrypted secret returns the original plaintext', () => {
    const { encryptSecret, decryptSecret } = loadWithKey(VALID_KEY);
    const original = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptSecret(original);
    expect(decryptSecret(encrypted)).toBe(original);
  });

  it('round-trip works for arbitrary UTF-8 secrets', () => {
    const { encryptSecret, decryptSecret } = loadWithKey(VALID_KEY);
    const secrets = ['AAAA BBBB CCCC', 'short', 'a'.repeat(100), '12345678901234567890'];
    for (const secret of secrets) {
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
    }
  });

  it('throws when decrypting with a different key (wrong key)', () => {
    const { encryptSecret } = loadWithKey(VALID_KEY);
    const encrypted = encryptSecret('JBSWY3DPEHPK3PXP');

    const DIFFERENT_KEY = 'b'.repeat(64);
    const { decryptSecret: decryptWithWrongKey } = loadWithKey(DIFFERENT_KEY);
    expect(() => decryptWithWrongKey(encrypted)).toThrow();
  });

  it('throws when the encrypted string is malformed (missing parts)', () => {
    const { decryptSecret } = loadWithKey(VALID_KEY);
    expect(() => decryptSecret('onlyone')).toThrow();
    expect(() => decryptSecret('only:two')).toThrow();
  });

  it('throws when the encrypted string is tampered (corrupted ciphertext)', () => {
    const { encryptSecret, decryptSecret } = loadWithKey(VALID_KEY);
    const [iv, , tag] = encryptSecret('JBSWY3DPEHPK3PXP').split(':');
    // Replace ciphertext with garbage of same length
    const garbage = 'deadbeef'.repeat(4);
    expect(() => decryptSecret(`${iv}:${garbage}:${tag}`)).toThrow();
  });
});
