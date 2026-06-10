/**
 * Two-layer translation cache unit tests (SHY-0072).
 *
 * Layout (architect Concern 5): committed read-only seed
 * (src/data/translation-cache-seed.json, written only by Claude backfill
 * PRs) overlaid by a runtime-writable, gitignored cache
 * (data/translation-cache.json) — runtime wins on collision. Keys are
 * `sha256(text):target`. Runtime writes are atomic (write `.tmp` then
 * rename). A corrupt runtime file must never crash boot: empty cache +
 * ERROR log (fail-open to re-translation, fail-silent to users).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createTranslationCache } = require('../../src/utils/translation-cache');

const mockLogError = jest.fn();
jest.mock('../../src/utils/log', () => ({
  error: (...a) => mockLogError(...a),
  warn: jest.fn(),
  info: jest.fn(),
}));

const keyOf = (text, target) =>
  `${crypto.createHash('sha256').update(text).digest('hex')}:${target}`;

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcache-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function make({ seed, runtime } = {}) {
  const seedPath = path.join(dir, 'seed.json');
  const runtimePath = path.join(dir, 'runtime', 'cache.json');
  if (seed !== undefined)
    fs.writeFileSync(seedPath, typeof seed === 'string' ? seed : JSON.stringify(seed));
  if (runtime !== undefined) {
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.writeFileSync(runtimePath, typeof runtime === 'string' ? runtime : JSON.stringify(runtime));
  }
  return { cache: createTranslationCache({ seedPath, runtimePath }), seedPath, runtimePath };
}

describe('boot layering', () => {
  test('seed entries serve when runtime is absent', () => {
    const { cache } = make({ seed: { [keyOf('hello', 'de')]: 'Hallo' } });
    expect(cache.get('hello', 'de')).toBe('Hallo');
  });

  test('runtime overlays seed — runtime wins on collision', () => {
    const k = keyOf('hello', 'fr');
    const { cache } = make({ seed: { [k]: 'seed-Bonjour' }, runtime: { [k]: 'runtime-Bonjour' } });
    expect(cache.get('hello', 'fr')).toBe('runtime-Bonjour');
  });

  test('missing both files boots an empty cache without error', () => {
    const { cache } = make();
    expect(cache.get('hello', 'es')).toBeNull();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  test('corrupt runtime file: boots empty(+seed), logs ERROR, never throws', () => {
    const { cache } = make({ seed: { [keyOf('a', 'it')]: 'A' }, runtime: '{"truncated' });
    expect(cache.get('a', 'it')).toBe('A');
    expect(cache.get('b', 'it')).toBeNull();
    expect(mockLogError).toHaveBeenCalled();
  });
});

describe('writes', () => {
  test('set() persists durably — a fresh instance over the same files reads it back', () => {
    const { cache, seedPath, runtimePath } = make();
    cache.set('hello', 'ja', 'こんにちは');
    const reread = createTranslationCache({ seedPath, runtimePath });
    expect(reread.get('hello', 'ja')).toBe('こんにちは');
  });

  test('writes are atomic: no partial cache.json visible, tmp cleaned up after set', () => {
    const { cache, runtimePath } = make();
    cache.set('x', 'ko', 'y');
    const dirList = fs.readdirSync(path.dirname(runtimePath));
    expect(dirList).toContain('cache.json');
    expect(dirList.filter((f) => f.includes('.tmp'))).toEqual([]);
    // file parses cleanly
    expect(() => JSON.parse(fs.readFileSync(runtimePath, 'utf-8'))).not.toThrow();
  });

  test('set() creates the runtime directory on first write', () => {
    const { cache, runtimePath } = make();
    expect(fs.existsSync(path.dirname(runtimePath))).toBe(false);
    cache.set('p', 'pl', 'q');
    expect(fs.existsSync(runtimePath)).toBe(true);
  });

  test('seed file is never written at runtime', () => {
    const { cache, seedPath } = make({ seed: {} });
    const before = fs.statSync(seedPath).mtimeMs;
    cache.set('m', 'ru', 'n');
    expect(fs.statSync(seedPath).mtimeMs).toBe(before);
  });
});

describe('keying', () => {
  test('same text different locales are independent entries', () => {
    const { cache } = make();
    cache.set('hello', 'th', 'สวัสดี');
    expect(cache.get('hello', 'th')).toBe('สวัสดี');
    expect(cache.get('hello', 'tr')).toBeNull();
  });

  test('size() reports entry count across layers (for the future 50K warn)', () => {
    const { cache } = make({ seed: { [keyOf('a', 'uk')]: 'x' } });
    cache.set('b', 'vi', 'y');
    expect(cache.size()).toBe(2);
  });
});
