/**
 * Tests for src/utils/helpers.js
 *
 * Exported functions:
 * - generateId()   — returns a 20-char alphanumeric string from crypto.randomBytes
 * - now()          — returns Date.now() (current epoch ms)
 * - todayStr()     — returns YYYY-MM-DD for today
 * - yesterdayStr() — returns YYYY-MM-DD for yesterday
 * - getExtension() — maps a MIME type to a file extension string
 */

const {
  generateId,
  now,
  todayStr,
  yesterdayStr,
  getExtension,
} = require('../../src/utils/helpers');

// ─── generateId ───────────────────────────────────────────────────

describe('generateId()', () => {
  it('returns a string', () => {
    expect(typeof generateId()).toBe('string');
  });

  it('returns exactly 20 characters', () => {
    // 20 random bytes → 20 chars (one per byte, mapped via chars array)
    expect(generateId()).toHaveLength(20);
  });

  it('contains only alphanumeric characters', () => {
    const id = generateId();
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('generates unique values on repeated calls', () => {
    const ids = new Set(Array.from({ length: 100 }, generateId));
    // With 62^20 possible values, collision probability is negligible
    expect(ids.size).toBe(100);
  });

  it('does not contain special characters', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateId();
      expect(id).not.toMatch(/[^A-Za-z0-9]/);
    }
  });
});

// ─── now ──────────────────────────────────────────────────────────

describe('now()', () => {
  it('returns a number', () => {
    expect(typeof now()).toBe('number');
  });

  it('returns a value close to Date.now()', () => {
    const before = Date.now();
    const result = now();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('returns an integer (milliseconds, not fractional)', () => {
    // Date.now() always returns an integer
    expect(Number.isInteger(now())).toBe(true);
  });

  it('returns a value in the expected epoch millisecond range', () => {
    const result = now();
    // Must be after 2020-01-01 and before 2100-01-01
    expect(result).toBeGreaterThan(1577836800000); // 2020-01-01
    expect(result).toBeLessThan(4102444800000); // 2100-01-01
  });
});

// ─── todayStr ─────────────────────────────────────────────────────

describe('todayStr()', () => {
  it('returns a string', () => {
    expect(typeof todayStr()).toBe('string');
  });

  it('returns a date in YYYY-MM-DD format', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns today\'s date matching new Date().toISOString().split("T")[0]', () => {
    const expected = new Date().toISOString().split('T')[0];
    expect(todayStr()).toBe(expected);
  });

  it('returns a valid calendar date', () => {
    const str = todayStr();
    const [year, month, day] = str.split('-').map(Number);
    expect(year).toBeGreaterThanOrEqual(2024);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });
});

// ─── yesterdayStr ─────────────────────────────────────────────────

describe('yesterdayStr()', () => {
  it('returns a string', () => {
    expect(typeof yesterdayStr()).toBe('string');
  });

  it('returns a date in YYYY-MM-DD format', () => {
    expect(yesterdayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a date one day before todayStr()', () => {
    const today = new Date(todayStr());
    const yesterday = new Date(yesterdayStr());
    const diffMs = today.getTime() - yesterday.getTime();
    // Exactly 86400000 ms (1 day) apart
    expect(diffMs).toBe(86400000);
  });

  it('is strictly before today', () => {
    const today = todayStr();
    const yesterday = yesterdayStr();
    expect(yesterday < today).toBe(true);
  });

  it('is a valid calendar date', () => {
    const str = yesterdayStr();
    const [year, month, day] = str.split('-').map(Number);
    expect(year).toBeGreaterThanOrEqual(2024);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });
});

// ─── getExtension ─────────────────────────────────────────────────

describe('getExtension()', () => {
  // Image types
  it('returns "png" for image/png', () => {
    expect(getExtension('image/png')).toBe('png');
  });

  it('returns "webp" for image/webp', () => {
    expect(getExtension('image/webp')).toBe('webp');
  });

  it('returns "gif" for image/gif', () => {
    expect(getExtension('image/gif')).toBe('gif');
  });

  it('returns "jpg" for image/jpeg (fallback default)', () => {
    expect(getExtension('image/jpeg')).toBe('jpg');
  });

  it('returns "jpg" for image/jpg (fallback default)', () => {
    expect(getExtension('image/jpg')).toBe('jpg');
  });

  it('returns "jpg" for unknown image types (default fallback)', () => {
    expect(getExtension('image/bmp')).toBe('jpg');
  });

  // Video types
  it('returns "mp4" for video/mp4', () => {
    expect(getExtension('video/mp4')).toBe('mp4');
  });

  it('returns "mov" for video/quicktime', () => {
    expect(getExtension('video/quicktime')).toBe('mov');
  });

  it('returns "webm" for video/webm', () => {
    expect(getExtension('video/webm')).toBe('webm');
  });

  it('returns the video subtype for generic video/* types', () => {
    expect(getExtension('video/avi')).toBe('avi');
    expect(getExtension('video/ogg')).toBe('ogg');
  });

  it('returns a non-empty string for all handled types', () => {
    const types = [
      'image/png',
      'image/webp',
      'image/gif',
      'image/jpeg',
      'video/mp4',
      'video/quicktime',
      'video/webm',
    ];
    for (const type of types) {
      const ext = getExtension(type);
      expect(typeof ext).toBe('string');
      expect(ext.length).toBeGreaterThan(0);
    }
  });
});
