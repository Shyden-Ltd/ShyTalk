#!/usr/bin/env node
/**
 * Translate keys in public/admin/translations.js across all 20 non-EN
 * locales, mirroring the contract of scripts/translate-strings.js but
 * targeting the admin-panel JS object format instead of compose XML.
 *
 * The file is shaped like:
 *
 *   var ADMIN_TRANSLATIONS = {
 *     en: { key1: 'value1', key2: 'value2', ... },
 *     ar: { ... },
 *     ...
 *   };
 *
 * Locale blocks come in two flavours: multi-line (most languages) and
 * compact single-line (e.g. nl). The parser handles both because it
 * walks the source string char-by-char tracking brace depth + string +
 * comment state, never assuming newline structure.
 *
 * Provenance is tracked by a block comment immediately preceding the
 * inserted key:
 *
 *   ar: {
 *     existing: '...',
 *     // google-translated 2026-06-02
 *     new_key: 'translated',
 *   },
 *
 * Five keys carry semantic baggage machine translation can't preserve;
 * see TRANSLATION_OVERRIDES below.
 *
 * Usage:
 *   node scripts/translate-admin-strings.js \
 *     --file public/admin/translations.js \
 *     --keys tab_suggestions,tab_audit_log,... \
 *     [--apply]
 *
 *   # Discover the full missing-key set automatically
 *   node scripts/translate-admin-strings.js \
 *     --file public/admin/translations.js \
 *     --missing \
 *     [--apply]
 *
 * Without --apply the script reports what it WOULD do.
 */

const fs = require('node:fs');
const path = require('node:path');

const { googleTranslate, sleep, GOOGLE_QUOTA_EXHAUSTED } = require(
  path.join(__dirname, 'lib', 'google-translate.js'),
);

const LOCALES = [
  'ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'km', 'ko',
  'nl', 'pl', 'pt', 'ru', 'sv', 'th', 'tr', 'uk', 'vi', 'zh',
];

// Keys that must NOT be machine-translated. `null` means "copy en
// verbatim across every locale". The rationale lives next to each
// entry so a future developer adding a new acronym/preposition can
// follow the policy.
//
// When adding a NEW key to public/admin/translations.js whose en
// value is itself an acronym (URL, PIN, UUID, …), a single-letter
// preposition (at, in, by, …), or a semantically-overloaded word
// where machine translation has been observed to misrender it
// (Minor → "music key" or "small"; Override → "Moll" — see PR #968
// review), add an entry here so the bulk-translate run skips the
// Google call and uses the override value across every locale.
//
// For per-locale curated values (where each locale needs a different
// hand-translation — e.g. cohort terms like "Minor (underage)"), the
// current shape doesn't support that; those go in the file directly
// via a one-off upsert call with source='override' and a
// `// override-translated YYYY-MM-DD` provenance comment so future
// bulk re-runs preserve them.
const TRANSLATION_OVERRIDES = {
  DOB: null,    // English acronym for "date of birth" — universal in admin UI.
  ID: null,     // English acronym for "identifier" — universal in admin UI.
  at: null,     // Single-token English preposition; no portable translation absent context.
  system: null, // Collides with locale-specific "system" terms; verbatim is safer than guessing.
  method: null, // Same risk class as `system`; can be lifted per-locale after native review.
};

const TODAY = new Date().toISOString().slice(0, 10);

// ── Argv ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { file: null, keys: [], apply: false, missing: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file') out.file = argv[++i];
    else if (arg === '--keys') out.keys = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--apply') out.apply = true;
    else if (arg === '--missing') out.missing = true;
  }
  return out;
}

// ── Source-string walker (locale-aware brace-depth + strings + comments) ──

/**
 * Find the byte span [start, end] of one locale block's BODY (the
 * content strictly between `{` and `}`, not including the braces
 * themselves). Returns null if the locale header isn't found.
 *
 * Implementation: regex finds the locale header → we know the offset
 * of the opening `{` → walk forward, depth=1 after the `{`, tracking
 * string + comment state so braces inside `'...{...}...'` don't
 * count. When depth drops to 0 the byte just consumed was the
 * matching `}`.
 *
 * NOTE: the walker only recognises `'` / `"` string quotes; template
 * literals (backticks) would cause incorrect depth tracking if their
 * values contained `{` or `}`. The admin translations file does not
 * use template literals — if that changes, this function and
 * `stripCommentsPreservingStrings` need a backtick branch.
 */
function findLocaleBlockSpan(src, locale) {
  const headerRe = new RegExp(`^  ${locale}\\s*:\\s*\\{`, 'm');
  const m = headerRe.exec(src);
  if (!m) return null;
  const openBrace = m.index + m[0].length - 1; // index of the `{`
  let i = openBrace + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === "'" || c === '"') {
      // Skip past the string literal — handle backslash escapes.
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      // Line comment.
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      // Block comment.
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  // i now points one past the closing `}`. Body span is (openBrace+1, i-1).
  return { bodyStart: openBrace + 1, bodyEnd: i - 1 };
}

/**
 * Strip JS comments from a string while leaving string literals
 * intact. Used so the key-extraction regex doesn't see `// foo: bar`
 * inside a comment as a real key.
 *
 * NOTE: this implementation handles `'` and `"` strings; template
 * literals (backticks) are not currently supported because the admin
 * translations file does not use them and walking nested ${} inside
 * a backtick string requires recursive parsing that's out of scope.
 * If a future entry uses a template literal in value position, both
 * this stripper and findLocaleBlockSpan would mis-track depth — add
 * a guard then.
 */
function stripCommentsPreservingStrings(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        out += src[i];
        if (src[i] === '\\') { out += src[i + 1] || ''; i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Like `stripCommentsPreservingStrings` but replaces each comment
 * character with a space, so the output has the same length as the
 * input. Lets upsert run its regex against a comment-free view while
 * still using the resulting match index to splice the RAW body
 * — without this, a regex match inside a comment would corrupt the
 * file by replacing comment text instead of the real entry.
 */
function blankCommentsPreservingOffsets(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        out += src[i];
        if (src[i] === '\\') { out += src[i + 1] || ''; i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      // Replace `//` and the comment body (up to but not including
      // the newline) with spaces of equal length.
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      // Replace `/* ... */` with spaces of equal length, preserving
      // embedded newlines so line numbers stay aligned for any
      // debugging that uses them.
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < src.length) { out += '  '; i += 2; }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Decode a JS single-or-double quoted string literal (including the
 * surrounding quotes) into its raw string value. Handles common
 * escapes (`\\'`, `\\"`, `\\\\`, `\\n`, `\\t`, `\\r`, `\\uXXXX`).
 * The quote handling lets us read mixed-quoting source like
 * `msg: "the user's profile"` alongside `other: 'plain'`.
 *
 * Truncated `\\uXXX` (fewer than 4 hex digits) throws rather than
 * silently producing `\\u0000` from `parseInt('', 16) === NaN`.
 */
function decodeJsStringLiteral(lit) {
  const quote = lit[0];
  if ((quote !== "'" && quote !== '"') || lit[lit.length - 1] !== quote) {
    throw new Error(`Not a quoted string literal: ${lit.slice(0, 40)}`);
  }
  const body = lit.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { out += c; continue; }
    const next = body[++i];
    if (next === 'n') out += '\n';
    else if (next === 't') out += '\t';
    else if (next === 'r') out += '\r';
    else if (next === 'u') {
      const hex = body.slice(i + 1, i + 5);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
        throw new Error(`Truncated or invalid \\uXXXX escape near offset ${i}: ${JSON.stringify(hex)}`);
      }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else {
      // \', \", \\, and any other \x — pass through the next char.
      out += next;
    }
  }
  return out;
}

/**
 * Match `identifier: '...'` or `identifier: "..."` pairs in a
 * comment-free body. The string literal alternation matches escape
 * sequences via `(?:[^'\\]|\\.)*` so apostrophes and quotes survive.
 */
const KEY_VALUE_RE = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;

/**
 * Parse the full ADMIN_TRANSLATIONS object — returns
 * `{ en: { key: value, ... }, ar: {...}, ... }`. Locales absent from
 * the file (shouldn't happen for our 21-locale corpus) are simply
 * omitted from the result.
 */
function parseAdminTranslations(src) {
  const out = {};
  const locales = ['en', ...LOCALES];
  for (const locale of locales) {
    const span = findLocaleBlockSpan(src, locale);
    if (!span) continue;
    const body = src.substring(span.bodyStart, span.bodyEnd);
    const stripped = stripCommentsPreservingStrings(body);
    const dict = {};
    let m;
    KEY_VALUE_RE.lastIndex = 0;
    while ((m = KEY_VALUE_RE.exec(stripped)) !== null) {
      dict[m[1]] = decodeJsStringLiteral(m[2]);
    }
    out[locale] = dict;
  }
  return out;
}

// ── Upsert ────────────────────────────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Insert or replace one (key, value) pair inside a locale block.
 * Adds a `// ${source}-translated YYYY-MM-DD` provenance comment
 * preceding the new entry. The new entry is always written on its own
 * line; existing entries (single-line or multi-line) keep their
 * format.
 *
 * Throws if the locale block isn't found — better to fail loud than
 * silently no-op and leave the file underwritten.
 */
function upsertAdminTranslation(src, locale, key, value, source) {
  const span = findLocaleBlockSpan(src, locale);
  if (!span) {
    throw new Error(`upsertAdminTranslation: locale "${locale}" block not found`);
  }
  const body = src.substring(span.bodyStart, span.bodyEnd);

  const literal = JSON.stringify(value); // JSON-safe double-quoted form.
  const provenance = `// ${source}-translated ${TODAY}`;
  const newEntry = `\n    ${provenance}\n    ${key}: ${literal},`;

  // Match existing occurrence (optionally with prior provenance) so a
  // re-run replaces in place rather than duplicating. The literal
  // alternation mirrors KEY_VALUE_RE so the regex survives whatever
  // quote style the existing value uses. The provenance prefix list
  // includes every source we emit (`google`, `claude`, `override`) so
  // re-runs that flip source never orphan a stale comment.
  const existingRe = new RegExp(
    `(?:\\s*\\/\\/\\s*(?:google|claude|override)-translated\\s+\\d{4}-\\d{2}-\\d{2})?` +
      `\\s*\\b${escapeRegex(key)}\\s*:\\s*` +
      `(?:'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")\\s*,?`,
  );

  // Run the existence test against a comment-blanked view so a
  // section header like `// example: 'placeholder'` can't false-match
  // an actual entry. Because blanking preserves offsets, the match's
  // start/end index can be used to splice the RAW body.
  const blanked = blankCommentsPreservingOffsets(body);
  const m = existingRe.exec(blanked);

  let newBody;
  if (m) {
    // Replace the matched span in raw body. Use the indices from
    // `blanked` because offsets are preserved 1:1.
    newBody = body.substring(0, m.index) + newEntry + body.substring(m.index + m[0].length);
  } else {
    // Splice before the trailing whitespace/newline (so the closing
    // `}` keeps its original indent on the next line).
    const trailingWs = body.match(/\s*$/)[0];
    const head = body.substring(0, body.length - trailingWs.length);
    // Ensure the previous entry has a trailing comma so JS-parses cleanly.
    const headWithComma = /[,{]\s*$/.test(head) ? head : head.replace(/(\S)(\s*)$/, '$1,$2');
    newBody = `${headWithComma}${newEntry}\n  `;
  }

  return src.substring(0, span.bodyStart) + newBody + src.substring(span.bodyEnd);
}

// ── Diff ──────────────────────────────────────────────────────────

/**
 * Return `{ locale: [missingKey, ...], ... }` for each non-en locale
 * that lacks any en key. Empty locales (full parity) are omitted from
 * the result so the caller can short-circuit on `Object.keys === 0`.
 */
function findMissingKeys(parsed, locales) {
  if (!parsed.en) {
    throw new Error('findMissingKeys: en block missing from parsed map');
  }
  const enKeys = Object.keys(parsed.en);
  const out = {};
  for (const locale of locales) {
    const localeKeys = new Set(Object.keys(parsed[locale] || {}));
    const missing = enKeys.filter((k) => !localeKeys.has(k));
    if (missing.length > 0) out[locale] = missing;
  }
  return out;
}

// ── Driver ────────────────────────────────────────────────────────

/**
 * Translate `keys` for every locale in `locales`, writing the result
 * back to `filePath` when `apply=true`. `googleTranslateFn` is
 * injected for tests; in production it's the real adapter from
 * scripts/lib/google-translate.js.
 *
 * Per-key flow:
 *   1. If the key has an override entry, use it (verbatim en for
 *      `null`, fixed string otherwise) — never call Google.
 *   2. Otherwise call Google; on success, upsert with `google` source.
 *   3. On 429 (`GOOGLE_QUOTA_EXHAUSTED`), spool the (locale, key, en)
 *      tuple into the claude-todo manifest for later upsert by a
 *      human translator. The script does NOT block on a 429 — it
 *      keeps trying the remaining locales because some have higher
 *      per-IP quotas than others; the manifest aggregates whatever
 *      didn't make it through.
 */
async function translateAdminKeys({
  filePath,
  keys,
  locales,
  apply,
  googleTranslateFn = googleTranslate,
  log = console.log,
}) {
  let src = fs.readFileSync(filePath, 'utf8');
  const parsed = parseAdminTranslations(src);
  const englishMap = parsed.en || {};

  let googleCount = 0;
  let overrideCount = 0;
  let skipCount = 0;
  const claudeTodo = [];

  for (const locale of locales) {
    for (const key of keys) {
      const enValue = englishMap[key];
      if (enValue === undefined) {
        log(`  ! ${key}: not found in EN — skipping`);
        skipCount++;
        continue;
      }

      // Override path — never hit the network.
      if (Object.prototype.hasOwnProperty.call(TRANSLATION_OVERRIDES, key)) {
        const override = TRANSLATION_OVERRIDES[key];
        const value = override === null ? enValue : override;
        if (apply) {
          src = upsertAdminTranslation(src, locale, key, value, 'override');
        }
        log(`  = ${locale}/${key}: (override) ${value}`);
        overrideCount++;
        continue;
      }

      try {
        const translated = await googleTranslateFn(enValue, locale);
        if (apply) {
          src = upsertAdminTranslation(src, locale, key, translated, 'google');
        }
        log(`  ✓ ${locale}/${key}: ${translated.slice(0, 60)}${translated.length > 60 ? '…' : ''}`);
        googleCount++;
      } catch (err) {
        if (err.message === GOOGLE_QUOTA_EXHAUSTED) {
          log(`  ⚠ Google quota — fallback ${locale}/${key}`);
          claudeTodo.push({ locale, key, en: enValue });
        } else {
          log(`  ✗ ${locale}/${key}: ${err.message}`);
          claudeTodo.push({ locale, key, en: enValue, error: err.message });
        }
      }
      await sleep(100);
    }
  }

  if (apply) {
    fs.writeFileSync(filePath, src);
  }

  return { googleCount, overrideCount, skipCount, claudeTodo };
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (!args.file) {
    console.error(
      'Usage: node scripts/translate-admin-strings.js --file path/to/translations.js \\\n' +
        '         (--keys k1,k2 | --missing) [--apply]',
    );
    process.exit(2);
  }

  const src = fs.readFileSync(args.file, 'utf8');
  const parsed = parseAdminTranslations(src);

  let keys = args.keys;
  if (args.missing) {
    const missing = findMissingKeys(parsed, LOCALES);
    // Union across locales — re-translate per (locale, key) is fine,
    // the upsert path is idempotent.
    const union = new Set();
    for (const list of Object.values(missing)) for (const k of list) union.add(k);
    keys = [...union];
    console.log(`--missing: ${keys.length} unique keys across ${Object.keys(missing).length} locales`);
  }

  if (keys.length === 0) {
    console.log('No keys to translate.');
    return;
  }

  console.log(
    `Translating ${keys.length} keys × ${LOCALES.length} locales (apply=${args.apply}):`,
  );
  const result = await translateAdminKeys({
    filePath: args.file,
    keys,
    locales: LOCALES,
    apply: args.apply,
  });
  console.log(
    `\nDone. google: ${result.googleCount}, override: ${result.overrideCount}, ` +
      `skipped: ${result.skipCount}, claude-fallback: ${result.claudeTodo.length}`,
  );
  if (result.claudeTodo.length > 0) {
    const todoPath = path.resolve('translate-admin-claude-todo.json');
    fs.writeFileSync(todoPath, JSON.stringify(result.claudeTodo, null, 2));
    console.log(`Claude-todo manifest written to ${todoPath}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
  });
}

module.exports = {
  LOCALES,
  TRANSLATION_OVERRIDES,
  parseArgs,
  parseAdminTranslations,
  upsertAdminTranslation,
  findMissingKeys,
  translateAdminKeys,
  findLocaleBlockSpan,
  stripCommentsPreservingStrings,
  blankCommentsPreservingOffsets,
  decodeJsStringLiteral,
};
