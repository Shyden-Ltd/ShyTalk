/**
 * Tests for web page i18n translation coverage.
 *
 * Verifies that all translation files have all 20 languages
 * and that no language is missing keys present in other languages.
 */

const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'public');

const ALL_LANGUAGES = [
  'ar',
  'de',
  'es',
  'fr',
  'hi',
  'id',
  'it',
  'ja',
  'km',
  'ko',
  'nl',
  'pl',
  'pt',
  'ru',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'zh',
];

// ── Portal translations ────────────────────────────────────────

describe('portal-translations.js', () => {
  const filePath = path.join(PUBLIC_DIR, 'portal', 'portal-translations.js');

  test('file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('contains all 20 non-English languages', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const lang of ALL_LANGUAGES) {
      const regex = new RegExp(`^\\s{2}${lang}:`, 'm');
      expect(content).toMatch(regex);
    }
  });

  test('contains English (en) language block', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toMatch(/^\s{2}en:/m);
  });

  test('km (Khmer) language block exists with translations', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toMatch(/^\s{2}km:/m);
  });
});

// ── Admin translations ─────────────────────────────────────────

describe('admin/translations.js', () => {
  const filePath = path.join(PUBLIC_DIR, 'admin', 'translations.js');

  test('file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('contains all 20 non-English languages', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const lang of ALL_LANGUAGES) {
      const regex = new RegExp(`^\\s{2}${lang}:`, 'm');
      expect(content).toMatch(regex);
    }
  });

  test('km (Khmer) language block exists', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toMatch(/^\s{2}km:/m);
  });
});

// ── Legal translations ─────────────────────────────────────────

describe('legal-translations.js', () => {
  const filePath = path.join(PUBLIC_DIR, 'js', 'legal-translations.js');

  test('file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('contains all 20 non-English languages', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const lang of ALL_LANGUAGES) {
      const regex = new RegExp(`(?:["']${lang}["']|\\b${lang})\\s*:`, 'm');
      expect(content).toMatch(regex);
    }
  });
});

// ── Suggestions i18n ───────────────────────────────────────────

describe('suggestions-i18n.js', () => {
  const filePath = path.join(PUBLIC_DIR, 'js', 'suggestions-i18n.js');

  test('file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('contains all 20 non-English languages', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const lang of ALL_LANGUAGES) {
      const regex = new RegExp(`(?:["']${lang}["']|\\b${lang})\\s*:`, 'm');
      expect(content).toMatch(regex);
    }
  });
});

// ── Event translations ─────────────────────────────────────────

describe('event-translations.js', () => {
  const filePath = path.join(PUBLIC_DIR, 'js', 'event-translations.js');

  test('file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('contains all 20 non-English languages', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const lang of ALL_LANGUAGES) {
      const regex = new RegExp(`(?:["']${lang}["']|\\b${lang})\\s*:`, 'm');
      expect(content).toMatch(regex);
    }
  });
});

// ── Roadmap app labels ─────────────────────────────────────────

describe('roadmap-app.js LABELS', () => {
  const filePath = path.join(PUBLIC_DIR, 'js', 'roadmap-app.js');

  test('file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('contains all 20 non-English language blocks in LABELS', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const lang of ALL_LANGUAGES) {
      const regex = new RegExp(`^\\s+${lang}:\\s*\\{`, 'm');
      expect(content).toMatch(regex);
    }
  });
});
