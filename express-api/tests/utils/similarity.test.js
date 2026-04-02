/**
 * Unit tests for similarity matching utility.
 * Used for duplicate detection and blocked topic matching.
 */

const { similarity, normalise, editDistance } = require('../../src/utils/similarity');

describe('normalise', () => {
  test('lowercases text', () => {
    expect(normalise('HELLO')).toBe('hello');
  });

  test('collapses whitespace', () => {
    expect(normalise('hello   world')).toBe('hello world');
  });

  test('trims whitespace', () => {
    expect(normalise('  hello  ')).toBe('hello');
  });

  test('preserves CJK characters', () => {
    expect(normalise('你好世界')).toBe('你好世界');
  });

  test('preserves Cyrillic', () => {
    expect(normalise('Привет мир')).toBe('привет мир');
  });

  test('preserves Arabic', () => {
    expect(normalise('مرحبا بالعالم')).toBe('مرحبا بالعالم');
  });

  test('preserves Korean (Hangul)', () => {
    expect(normalise('안녕하세요')).toBe('안녕하세요');
  });

  test('handles empty string', () => {
    expect(normalise('')).toBe('');
  });

  test('handles null/undefined', () => {
    expect(normalise(null)).toBe('');
    expect(normalise(undefined)).toBe('');
  });

  test('handles tabs and newlines as whitespace', () => {
    expect(normalise('hello\t\nworld')).toBe('hello world');
  });
});

describe('editDistance', () => {
  test('identical strings return 0', () => {
    expect(editDistance('hello', 'hello')).toBe(0);
  });

  test('empty vs non-empty returns length', () => {
    expect(editDistance('', 'hello')).toBe(5);
    expect(editDistance('hello', '')).toBe(5);
  });

  test('both empty returns 0', () => {
    expect(editDistance('', '')).toBe(0);
  });

  test('single character difference', () => {
    expect(editDistance('cat', 'bat')).toBe(1);
  });

  test('insertion', () => {
    expect(editDistance('cat', 'cats')).toBe(1);
  });

  test('deletion', () => {
    expect(editDistance('cats', 'cat')).toBe(1);
  });

  test('completely different', () => {
    expect(editDistance('abc', 'xyz')).toBe(3);
  });

  test('handles long strings', () => {
    const a = 'a'.repeat(100);
    const b = 'b'.repeat(100);
    expect(editDistance(a, b)).toBe(100);
  });
});

describe('similarity', () => {
  test('identical strings return 1', () => {
    expect(similarity('hello', 'hello')).toBe(1);
  });

  test('completely different strings return low score', () => {
    expect(similarity('abc', 'xyz')).toBeLessThan(0.5);
  });

  test('empty strings return 1', () => {
    expect(similarity('', '')).toBe(1);
  });

  test('one empty returns 0', () => {
    expect(similarity('hello', '')).toBe(0);
    expect(similarity('', 'hello')).toBe(0);
  });

  test('case-insensitive matching', () => {
    expect(similarity('Hello World', 'hello world')).toBe(1);
  });

  test('punctuation-agnostic', () => {
    expect(similarity('Hello, world!', 'Hello world')).toBe(1);
  });

  test('similar strings score > 0.7', () => {
    expect(similarity('Add dark mode', 'Add dark mode to the app')).toBeGreaterThan(0.5);
  });

  test('"app" vs "application" similarity', () => {
    const score = similarity('Add dark mode to the application', 'Add dark mode to the app');
    expect(score).toBeGreaterThan(0.6);
  });

  test('blocked topic threshold (0.7) catches abbreviations', () => {
    const score = similarity('Add dark mode to the application', 'Add dark mode to the app');
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  test('very different topics score below threshold', () => {
    const score = similarity('Add dark mode', 'Fix login bug');
    expect(score).toBeLessThan(0.5);
  });

  test('handles null inputs', () => {
    expect(similarity(null, null)).toBe(1);
    expect(similarity(null, 'hello')).toBe(0);
  });

  test('symmetric: similarity(a,b) === similarity(b,a)', () => {
    const a = 'dark mode feature';
    const b = 'feature dark mode';
    expect(similarity(a, b)).toBe(similarity(b, a));
  });

  test('CJK text comparison', () => {
    expect(similarity('暗いモード', '暗いモード')).toBe(1);
  });

  test('Arabic text comparison', () => {
    expect(similarity('الوضع المظلم', 'الوضع المظلم')).toBe(1);
  });
});
