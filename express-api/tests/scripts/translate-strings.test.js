/**
 * Unit tests for the Google-first translate-strings.js script.
 * Mocks `fetch` so the test never hits Google Translate; pins the
 * provenance-tag insertion / replacement logic + the untagged-as-
 * Claude scan semantics.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let tmpDir;
let scriptPath;

beforeAll(() => {
  scriptPath = path.resolve(__dirname, '../../../scripts/translate-strings.js');
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  jest.resetModules();
  delete global.fetch;
});

function loadScript() {
  // Re-require so the module reads CWD fresh — the script reads
  // COMPOSE_RES_BASE relative to process.cwd().
  delete require.cache[scriptPath];
  return require(scriptPath);
}

// ─── findNonGoogleStrings ────────────────────────────────────────

describe('findNonGoogleStrings (untagged + claude-tagged)', () => {
  test('untagged <string> is returned (untagged == claude per the rule)', () => {
    const xml = `<resources>
    <string name="key1">Bonjour</string>
</resources>
`;
    const { findNonGoogleStrings } = jest.requireActual('../../../scripts/translate-strings.js');
    expect(findNonGoogleStrings(xml)).toEqual([{ key: 'key1', value: 'Bonjour' }]);
  });

  test('claude-tagged <string> is returned', () => {
    const xml = `<resources>
    <!-- claude-translated 2026-05-04 -->
    <string name="key2">Hola</string>
</resources>
`;
    const { findNonGoogleStrings } = jest.requireActual('../../../scripts/translate-strings.js');
    expect(findNonGoogleStrings(xml)).toEqual([{ key: 'key2', value: 'Hola' }]);
  });

  test('google-tagged <string> is SKIPPED (idempotent re-runs)', () => {
    const xml = `<resources>
    <!-- google-translated 2026-05-04 -->
    <string name="key3">Hallo</string>
</resources>
`;
    const { findNonGoogleStrings } = jest.requireActual('../../../scripts/translate-strings.js');
    expect(findNonGoogleStrings(xml)).toEqual([]);
  });

  test('mixed file returns only non-google entries', () => {
    const xml = `<resources>
    <string name="bare">untagged</string>
    <!-- claude-translated 2026-04-01 -->
    <string name="claude_old">claude-only</string>
    <!-- google-translated 2026-05-01 -->
    <string name="google_done">already-google</string>
    <string name="bare2">also-untagged</string>
</resources>
`;
    const { findNonGoogleStrings } = jest.requireActual('../../../scripts/translate-strings.js');
    expect(findNonGoogleStrings(xml)).toEqual([
      { key: 'bare', value: 'untagged' },
      { key: 'claude_old', value: 'claude-only' },
      { key: 'bare2', value: 'also-untagged' },
    ]);
  });
});

// ─── upsertTranslation ────────────────────────────────────────────

describe('upsertTranslation', () => {
  test('inserts a new <string> + provenance comment before </resources>', () => {
    const localePath = path.join(tmpDir, 'strings.xml');
    fs.writeFileSync(
      localePath,
      `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="other">existing</string>
</resources>
`,
    );
    const { upsertTranslation } = loadScript();
    upsertTranslation(localePath, 'newkey', 'Texte traduit', 'google');
    const result = fs.readFileSync(localePath, 'utf8');
    expect(result).toContain('<!-- google-translated ');
    expect(result).toContain('<string name="newkey">Texte traduit</string>');
    // Existing key untouched
    expect(result).toContain('<string name="other">existing</string>');
  });

  test('replaces an existing <string> AND its preceding provenance comment', () => {
    const localePath = path.join(tmpDir, 'strings.xml');
    fs.writeFileSync(
      localePath,
      `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- claude-translated 2026-04-01 -->
    <string name="key">old-value</string>
</resources>
`,
    );
    const { upsertTranslation } = loadScript();
    upsertTranslation(localePath, 'key', 'new-google-value', 'google');
    const result = fs.readFileSync(localePath, 'utf8');
    // The claude tag is replaced, not duplicated.
    expect(result.match(/claude-translated/g)).toBeNull();
    expect(result).toContain('<!-- google-translated ');
    expect(result).toContain('<string name="key">new-google-value</string>');
    // No duplicate string entry.
    expect((result.match(/<string name="key">/g) || []).length).toBe(1);
  });

  test('escapes XML-sensitive characters but NOT the apostrophe', () => {
    const localePath = path.join(tmpDir, 'strings.xml');
    fs.writeFileSync(
      localePath,
      `<?xml version="1.0" encoding="utf-8"?>
<resources>
</resources>
`,
    );
    const { upsertTranslation } = loadScript();
    upsertTranslation(localePath, 'key', `5 < 10 & it's true`, 'google');
    const result = fs.readFileSync(localePath, 'utf8');
    // SHY-0271: this assertion used to demand `it\'s`, which made the suite
    // GREEN on the exact defect the operator later read off the screen — the
    // test pinned the bug as the contract. Compose Multiplatform does not
    // unescape `\'`, so the backslash rendered.
    expect(result).toContain("5 &lt; 10 &amp; it's true");
    expect(result).not.toContain("\\'");
  });
});

// ─── escapeXml / unescapeXml (SHY-0271) ───────────────────────────
//
// Both were exported "for testing" and neither had a single direct test. The
// untested one wrote a visible backslash into 221 strings across 18 locales.

describe('escapeXml', () => {
  test('leaves an apostrophe alone', () => {
    const { escapeXml } = loadScript();
    expect(escapeXml("Driver's license")).toBe("Driver's license");
  });

  test('escapes the three characters XML actually requires', () => {
    const { escapeXml } = loadScript();
    expect(escapeXml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  test('leaves typographic quotes and ellipses alone', () => {
    // The zh corpus carried `\u201c` / `\u201d`; escaping those is the same
    // mistake wearing a different character.
    const { escapeXml } = loadScript();
    expect(escapeXml('\u201cquoted\u201d and\u2026')).toBe('\u201cquoted\u201d and\u2026');
  });

  test('handles the empty string', () => {
    const { escapeXml } = loadScript();
    expect(escapeXml('')).toBe('');
  });

  test('never emits a backslash, whatever it is given', () => {
    // The general property. A future escape added to this function would have
    // to break this test on its way to the screen.
    const { escapeXml } = loadScript();
    const samples = [
      "it's",
      'a & b',
      '<tag>',
      '\u201cq\u201d',
      'plain',
      "multiple ' apostrophes '",
    ];
    expect(samples.map(escapeXml).filter((v) => v.includes('\\'))).toEqual([]);
  });
});

describe('unescapeXml', () => {
  test('normalises a legacy escaped apostrophe on read', () => {
    // Retained deliberately: the corpus was full of `\'` before SHY-0271, and
    // reading one back must still yield a clean apostrophe.
    const { unescapeXml } = loadScript();
    expect(unescapeXml("Driver\\'s license")).toBe("Driver's license");
  });

  test('reverses the entity escapes', () => {
    const { unescapeXml } = loadScript();
    expect(unescapeXml('a &amp; b &lt; c &gt; d')).toBe('a & b < c > d');
  });

  test('round-trips with escapeXml', () => {
    const { escapeXml, unescapeXml } = loadScript();
    const samples = ["Driver's license", 'a & b < c > d', '\u201cquoted\u201d', 'plain text', ''];
    samples.forEach((s) => expect(unescapeXml(escapeXml(s))).toBe(s));
  });
});

// ─── readEnglishStrings ───────────────────────────────────────────

describe('readEnglishStrings', () => {
  test('parses one <string> entry per line', () => {
    const localePath = path.join(tmpDir, 'strings.xml');
    fs.writeFileSync(
      localePath,
      `<resources>
    <string name="a">A value</string>
    <string name="b">Another</string>
    <string name="escaped">Pre &amp; post</string>
</resources>
`,
    );
    const { readEnglishStrings } = loadScript();
    expect(readEnglishStrings(localePath)).toEqual({
      a: 'A value',
      b: 'Another',
      escaped: 'Pre & post',
    });
  });
});

// ─── googleTranslate (with fetch mock) ────────────────────────────

describe('googleTranslate', () => {
  test('returns the translated text from the public endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [[['Bonjour le monde', 'Hello world', null, null]]],
    });
    const { googleTranslate } = loadScript();
    const out = await googleTranslate('Hello world', 'fr');
    expect(out).toBe('Bonjour le monde');
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = fetch.mock.calls[0][0];
    expect(url).toContain('tl=fr');
    expect(url).toContain('q=Hello%20world');
  });

  test('maps zh → zh-CN for Google compatibility', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [[['你好', 'Hello', null, null]]],
    });
    const { googleTranslate } = loadScript();
    await googleTranslate('Hello', 'zh');
    expect(fetch.mock.calls[0][0]).toContain('tl=zh-CN');
  });

  test('throws GOOGLE_QUOTA_EXHAUSTED on HTTP 429', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    const { googleTranslate } = loadScript();
    await expect(googleTranslate('Hello', 'fr')).rejects.toThrow('GOOGLE_QUOTA_EXHAUSTED');
  });

  test('joins multi-segment translations', async () => {
    // Long inputs come back as multiple sub-arrays. Make sure we
    // concatenate them rather than dropping all but the first.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        [
          ['First sentence. ', 'First.', null, null],
          ['Second sentence.', 'Second.', null, null],
        ],
      ],
    });
    const { googleTranslate } = loadScript();
    const out = await googleTranslate('First. Second.', 'fr');
    expect(out).toBe('First sentence. Second sentence.');
  });
});

// ─── parseArgs ────────────────────────────────────────────────────

describe('parseArgs', () => {
  test('parses --keys, --strings-en, --apply', () => {
    const { parseArgs } = loadScript();
    const args = parseArgs([
      'node',
      'translate.js',
      '--keys',
      'k1,k2,k3',
      '--strings-en',
      'path/to/en.xml',
      '--apply',
    ]);
    expect(args).toEqual({
      keys: ['k1', 'k2', 'k3'],
      stringsEn: 'path/to/en.xml',
      apply: true,
      retranslateClaude: false,
    });
  });

  test('parses --retranslate-claude flag', () => {
    const { parseArgs } = loadScript();
    const args = parseArgs(['node', 'translate.js', '--retranslate-claude']);
    expect(args.retranslateClaude).toBe(true);
    expect(args.apply).toBe(false);
  });
});
