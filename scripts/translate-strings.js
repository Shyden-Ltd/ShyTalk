#!/usr/bin/env node
/**
 * Translate compose-resources string keys across all 19 non-EN locales.
 *
 * Strategy (per the project's translation-source rule):
 *   1. Try Google Translate's free public endpoint first
 *      (https://translate.googleapis.com/translate_a/single).
 *   2. On rate-limit / error, fall back to a `claude-translate.json`
 *      manifest the user can fill in, and tag those entries with
 *      `claude-translated` so a future re-run can replace them with
 *      Google output once the free quota is back.
 *
 * Provenance is tracked via XML comments adjacent to each translated
 * <string>:
 *   <!-- google-translated 2026-05-04 -->
 *   <string name="...">...</string>
 *
 * Usage:
 *   node scripts/translate-strings.js \
 *     --keys age_verif_submit_title,age_verif_step_explanation_title,... \
 *     --strings-en shared/src/commonMain/composeResources/values/strings.xml \
 *     --apply
 *
 * Without --apply, the script prints what it WOULD do.
 *
 * Re-translate-non-google mode:
 *   node scripts/translate-strings.js \
 *     --retranslate-claude \
 *     --apply
 *
 * Scans every locale file for <string> entries that do NOT have a
 * preceding `<!-- google-translated YYYY-MM-DD -->` comment, and
 * retranslates them via Google. This catches:
 *   - Strings explicitly tagged `<!-- claude-translated ... -->`.
 *   - Strings with no provenance tag at all (pre-rule baseline; per
 *     the translation-source rule, untagged == claude-translated by
 *     default).
 * Idempotent — already-google-tagged strings are skipped, so the run
 * can be resumed after a quota hit.
 */

const fs = require('node:fs');
const path = require('node:path');

const { googleTranslate, sleep, GOOGLE_QUOTA_EXHAUSTED } = require(
  path.join(__dirname, 'lib', 'google-translate.js'),
);

const LOCALES = [
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
const COMPOSE_RES_BASE = 'shared/src/commonMain/composeResources';

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { keys: [], stringsEn: null, apply: false, retranslateClaude: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--keys') out.keys = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--strings-en') out.stringsEn = argv[++i];
    else if (arg === '--apply') out.apply = true;
    else if (arg === '--retranslate-claude') out.retranslateClaude = true;
  }
  return out;
}

// ── XML parsing (regex-based — Compose strings.xml is line-oriented) ──

function readEnglishStrings(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const map = {};
  // Match <string name="key">value</string> across one line. Compose
  // strings.xml uses a simple flat layout — no CDATA, no plurals.
  const re = /<string\s+name="([^"]+)">([^<]*)<\/string>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    map[match[1]] = unescapeXml(match[2]);
  }
  return map;
}

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\\'/g, "'");
}

function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, "\\'");
}

// ── Locale file mutation ──────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Insert (or replace) a translated <string> in a locale file, tagged
 * with `<!-- ${source}-translated YYYY-MM-DD -->`.
 *
 * If the key already exists, replace its value AND any preceding
 * provenance comment. If new, append before `</resources>`.
 */
function upsertTranslation(localeXmlPath, key, translated, source) {
  let xml = fs.readFileSync(localeXmlPath, 'utf8');
  const escapedTranslation = escapeXml(translated);
  const provenance = `<!-- ${source}-translated ${TODAY} -->`;
  const stringLine = `<string name="${key}">${escapedTranslation}</string>`;

  const existingRe = new RegExp(
    `(?:    <!-- (?:google|claude)-translated [\\d-]+ -->\\n)?    <string name="${escapeRegex(key)}">[^<]*</string>`,
    'g',
  );
  if (existingRe.test(xml)) {
    xml = xml.replace(existingRe, `    ${provenance}\n    ${stringLine}`);
  } else {
    xml = xml.replace(/\n<\/resources>/, `\n    ${provenance}\n    ${stringLine}\n</resources>`);
  }
  fs.writeFileSync(localeXmlPath, xml);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Driver ────────────────────────────────────────────────────────

async function translateKeys(keys, englishMap, apply) {
  const claudeTodo = []; // entries that fell back to Claude
  let googleCount = 0;
  let skipCount = 0;

  for (const locale of LOCALES) {
    const localePath = path.join(COMPOSE_RES_BASE, `values-${locale}`, 'strings.xml');
    if (!fs.existsSync(localePath)) {
      console.warn(`  ! ${locale}: strings.xml missing — skipping locale`);
      continue;
    }
    for (const key of keys) {
      const enValue = englishMap[key];
      if (!enValue) {
        console.warn(`  ! ${key}: not found in EN — skipping`);
        skipCount++;
        continue;
      }
      try {
        const translated = await googleTranslate(enValue, locale);
        if (apply) upsertTranslation(localePath, key, translated, 'google');
        console.log(`  ✓ ${locale}/${key}: ${translated.slice(0, 60)}${translated.length > 60 ? '…' : ''}`);
        googleCount++;
      } catch (err) {
        if (err.message === GOOGLE_QUOTA_EXHAUSTED) {
          console.warn(`  ⚠ Google quota — fallback for ${locale}/${key}`);
          claudeTodo.push({ locale, key, en: enValue });
        } else {
          console.error(`  ✗ ${locale}/${key}: ${err.message}`);
          claudeTodo.push({ locale, key, en: enValue, error: err.message });
        }
      }
      // Polite rate-limit — Google's free endpoint is forgiving but a
      // 100ms delay keeps us comfortably below the soft cap.
      await sleep(100);
    }
  }

  return { googleCount, skipCount, claudeTodo };
}

// ── Retranslate non-Google scan ───────────────────────────────────
//
// Per the project rule: any string WITHOUT a `google-translated` tag
// is presumed Claude-translated and should be re-translated by Google
// when the free quota is available. This includes:
//   1. Strings explicitly tagged `<!-- claude-translated YYYY-MM-DD -->`.
//   2. Strings with NO preceding provenance comment at all (the bulk
//      of pre-existing translations done before the rule was set).
//
// Idempotent: strings with a `google-translated` tag are skipped, so
// re-running this is safe.

/**
 * Find every <string ...>...</string> in the locale file that does
 * NOT have an immediately-preceding `<!-- google-translated ... -->`
 * comment. Returns an array of { key, value } for those strings.
 */
function findNonGoogleStrings(xml) {
  const out = [];
  // Match every <string> entry. The regex is line-anchored so we can
  // look at the previous line for a provenance comment.
  const lines = xml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*<string\s+name="([^"]+)">([^<]*)<\/string>/);
    if (!m) continue;
    const key = m[1];
    const value = unescapeXml(m[2]);
    // Look at the previous non-blank line for a provenance tag.
    let provLine = null;
    for (let j = i - 1; j >= 0; j--) {
      const trimmed = lines[j].trim();
      if (trimmed === '') continue;
      if (trimmed.startsWith('<!--')) provLine = trimmed;
      break;
    }
    const isGoogleTagged = provLine && /^<!--\s*google-translated\b/.test(provLine);
    if (!isGoogleTagged) {
      out.push({ key, value });
    }
  }
  return out;
}

async function retranslateClaudeStrings(apply) {
  const englishMap = readEnglishStrings(
    path.join(COMPOSE_RES_BASE, 'values', 'strings.xml'),
  );
  let total = 0;
  let upgraded = 0;
  let quotaHit = false;
  for (const locale of LOCALES) {
    if (quotaHit) {
      console.warn(`Stopping early — Google quota exhausted. Resume later.`);
      break;
    }
    const localePath = path.join(COMPOSE_RES_BASE, `values-${locale}`, 'strings.xml');
    if (!fs.existsSync(localePath)) continue;
    const xml = fs.readFileSync(localePath, 'utf8');
    const candidates = findNonGoogleStrings(xml);
    if (candidates.length === 0) continue;
    console.log(`${locale}: ${candidates.length} non-google entries`);
    for (const { key } of candidates) {
      total++;
      const en = englishMap[key];
      if (!en) {
        // Locale has a key with no EN counterpart — leave it alone
        // (it might be a locale-specific string with no translation
        // intent, or a stale row pending cleanup).
        console.warn(`  ! ${locale}/${key}: EN missing — skip`);
        continue;
      }
      try {
        const translated = await googleTranslate(en, locale);
        if (apply) upsertTranslation(localePath, key, translated, 'google');
        upgraded++;
        if (upgraded % 50 === 0) console.log(`  ↑ ${locale} progress: ${upgraded}/${total}`);
      } catch (err) {
        if (err.message === GOOGLE_QUOTA_EXHAUSTED) {
          console.warn(`  ⚠ Google quota — stopping. Resume with same command later.`);
          quotaHit = true;
          break;
        }
        console.warn(`  ⚠ ${locale}/${key}: keeping (${err.message})`);
      }
      await sleep(100);
    }
  }
  return { total, upgraded, quotaHit };
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (args.retranslateClaude) {
    console.log(`Retranslate-claude mode (apply=${args.apply}):`);
    const { total, upgraded } = await retranslateClaudeStrings(args.apply);
    console.log(`Found ${total} claude-translated entries; ${upgraded} upgraded to google.`);
    return;
  }

  if (!args.stringsEn || args.keys.length === 0) {
    console.error(
      'Usage: node scripts/translate-strings.js --keys k1,k2 --strings-en path/to/values/strings.xml [--apply]\n' +
        '       node scripts/translate-strings.js --retranslate-claude [--apply]',
    );
    process.exit(2);
  }

  const englishMap = readEnglishStrings(args.stringsEn);
  console.log(
    `Translating ${args.keys.length} keys × ${LOCALES.length} locales (apply=${args.apply}):`,
  );
  const { googleCount, skipCount, claudeTodo } = await translateKeys(
    args.keys,
    englishMap,
    args.apply,
  );
  console.log(`\nDone. google: ${googleCount}, skipped: ${skipCount}, claude-fallback: ${claudeTodo.length}`);
  if (claudeTodo.length > 0) {
    const todoPath = path.resolve('translate-claude-todo.json');
    fs.writeFileSync(todoPath, JSON.stringify(claudeTodo, null, 2));
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
  parseArgs,
  readEnglishStrings,
  unescapeXml,
  escapeXml,
  upsertTranslation,
  googleTranslate,
  findNonGoogleStrings,
  retranslateClaudeStrings,
  translateKeys,
};
