#!/usr/bin/env node
// sync-shy-to-roadmap-data.mjs — regenerate public/roadmap-data.json from SHY .md frontmatter.
//
// Spec: .project/stories/SHY-0038-public-roadmap-gh-project-link.md
//
// AUTHORITATIVE for `phases[].items` + `currentlyWorkingOn` (any manual edit
// to those is stomped on next sync). PRESERVES the phase shell (titles +
// titleI18n + status + progress — phases are stable category containers,
// manually curated, not derived from SHYs).
//
// Hand-rolled frontmatter parser (per AC: no gray-matter, no js-yaml,
// no new npm dep). Keeps the entire script auditable in one file.
//
// Invoked by .github/workflows/sync-roadmap-data.yml on push-to-main when
// .project/stories/** changes. Also runnable locally + via workflow_dispatch.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { argv, exit } from 'node:process';

const FLAGS = parseArgs(argv.slice(2));

if (FLAGS.help) {
  printUsage();
  exit(0);
}

main();

// ============================================================== CLI

function parseArgs(args) {
  const out = {
    storiesDir: '.project/stories',
    dataFile: 'public/roadmap-data.json',
    frozenTime: null,
    verbose: false,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--help':
      case '-h':
        out.help = true;
        break;
      case '--stories-dir':
        out.storiesDir = args[++i];
        break;
      case '--data-file':
        out.dataFile = args[++i];
        break;
      case '--frozen-time':
        // Test-only: deterministic timestamp for byte-identical-output checks.
        out.frozenTime = args[++i];
        break;
      case '--verbose':
        out.verbose = true;
        break;
      default:
        process.stderr.write(`sync-shy-to-roadmap-data: unknown flag: ${a}\n`);
        exit(2);
    }
  }
  return out;
}

function printUsage() {
  process.stdout.write(
    `sync-shy-to-roadmap-data.mjs — regenerate public/roadmap-data.json from SHY .md frontmatter\n\n` +
      `Usage:\n` +
      `  node scripts/sync-shy-to-roadmap-data.mjs [--stories-dir <path>] [--data-file <path>] [--verbose]\n` +
      `  node scripts/sync-shy-to-roadmap-data.mjs --help\n\n` +
      `Flags:\n` +
      `  --stories-dir <path>   Default: .project/stories\n` +
      `  --data-file <path>     Default: public/roadmap-data.json\n` +
      `  --frozen-time <iso>    Test-only: use this ISO timestamp instead of now()\n` +
      `  --verbose              Print per-SHY parsing info to stderr\n` +
      `  --help, -h             Show this usage and exit 0\n\n` +
      `Exit codes:\n` +
      `  0   success\n` +
      `  2   usage error (unknown flag, missing arg)\n` +
      `  10  SHY parse error (missing title on public SHY, invalid phase, dup roadmap_ids)\n` +
      `  20  existing roadmap-data.json malformed or missing phases shell\n`,
  );
}

// ============================================================== frontmatter parser

function stripBOM(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
function normalize(s) {
  return stripBOM(s).replace(/\r\n/g, '\n');
}

function parseFrontmatter(content) {
  const normalized = normalize(content);
  // Frontmatter: starts with `---\n`, ends with `\n---\n`. Body follows.
  const fmRe = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = normalized.match(fmRe);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    // key: value — key is a-z0-9_, value is anything (trimmed).
    const m = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim();
    fm[key] = coerceValue(raw);
  }
  return { frontmatter: fm, body: normalized.slice(match[0].length) };
}

function coerceValue(raw) {
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Array form: [] or [a, b, c]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    return inner ? inner.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }
  return raw;
}

function parseTitle(body) {
  // H1 form: `# SHY-NNNN: <title>` — capture the part after `: `
  const m = body.match(/^#\s+SHY-\d{4}:\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

// ============================================================== deterministic JSON output

/** Pretty-print JSON with 2-space indent + ALPHABETICALLY-sorted keys at every
 *  object level. Required so the sync workflow's `git diff --quiet` check only
 *  surfaces semantic changes, not noise from key-order or whitespace drift. */
function stablePretty(value, indent = '') {
  const next = indent + '  ';
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => next + stablePretty(v, next)).join(',\n')}\n${indent}]`;
  }
  // Object: sort keys for determinism. Drop keys whose values are `undefined` so the
  // output matches standard `JSON.stringify` semantics (avoid emitting `"key": null`
  // for what should be an absent key). N1 from reviewer.
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  if (keys.length === 0) return '{}';
  return (
    `{\n` +
    keys
      .map((k) => `${next}${JSON.stringify(k)}: ${stablePretty(value[k], next)}`)
      .join(',\n') +
    `\n${indent}}`
  );
}

// ============================================================== main

function main() {
  const storiesPath = resolve(FLAGS.storiesDir);
  const dataPath = resolve(FLAGS.dataFile);

  // 1. Load baseline (existing roadmap-data.json with phase shell).
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(dataPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`sync-shy-to-roadmap-data: failed to parse ${dataPath}: ${e.message}\n`);
    exit(20);
  }
  if (!baseline.phases || !Array.isArray(baseline.phases)) {
    process.stderr.write(`sync-shy-to-roadmap-data: ${dataPath} missing 'phases' array\n`);
    exit(20);
  }
  const validPhases = new Set(baseline.phases.map((p) => p.title));

  // 2. Read SHY corpus + EPIC corpus.
  const entries = readdirSync(storiesPath);
  const shyFiles = entries.filter((f) => /^SHY-\d{4}-.+\.md$/.test(f)).sort();
  const epicFiles = entries.filter((f) => /^EPIC-\d{4}-.+\.md$/.test(f));

  const publicShys = [];
  const roadmapIdsSeen = new Map(); // roadmap_id → first SHY file claiming it

  for (const file of shyFiles) {
    const content = readFileSync(join(storiesPath, file), 'utf8');
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      if (FLAGS.verbose) process.stderr.write(`[skip] ${file}: no frontmatter\n`);
      continue;
    }
    const fm = parsed.frontmatter;
    if (fm.public !== true) {
      if (FLAGS.verbose) process.stderr.write(`[skip] ${file}: public != true\n`);
      continue;
    }

    const title = parseTitle(parsed.body);
    if (!title) {
      process.stderr.write(
        `sync-shy-to-roadmap-data: ${file}: public:true SHY missing '# SHY-NNNN: <title>' H1 in body\n`,
      );
      exit(10);
    }
    // C2 from reviewer: explicit guard before phase lookup so absent-vs-empty-vs-invalid
    // each get a clear message (was: all collapsed into `invalid phase "undefined"`).
    if (!fm.phase || typeof fm.phase !== 'string') {
      process.stderr.write(
        `sync-shy-to-roadmap-data: ${file}: public:true SHY missing required 'phase' frontmatter field\n`,
      );
      exit(10);
    }
    if (!validPhases.has(fm.phase)) {
      process.stderr.write(
        `sync-shy-to-roadmap-data: ${file}: invalid phase "${fm.phase}" — must match one of: ${[...validPhases].join(', ')}\n`,
      );
      exit(10);
    }
    // I7 from reviewer: priority + created must be present (the sort comparator calls
    // .localeCompare on them and would throw an uncaught TypeError on undefined → exit 1
    // instead of the documented exit 10).
    if (!fm.priority || typeof fm.priority !== 'string') {
      process.stderr.write(
        `sync-shy-to-roadmap-data: ${file}: public:true SHY missing required 'priority' frontmatter field\n`,
      );
      exit(10);
    }
    if (!fm.created || typeof fm.created !== 'string') {
      process.stderr.write(
        `sync-shy-to-roadmap-data: ${file}: public:true SHY missing required 'created' frontmatter field\n`,
      );
      exit(10);
    }
    for (const rid of fm.roadmap_ids || []) {
      if (roadmapIdsSeen.has(rid)) {
        process.stderr.write(
          `sync-shy-to-roadmap-data: duplicate roadmap_id ${rid} in ${file} (also claimed by ${roadmapIdsSeen.get(rid)})\n`,
        );
        exit(10);
      }
      roadmapIdsSeen.set(rid, file);
    }

    publicShys.push({
      id: fm.id,
      status: fm.status,
      title,
      // SHY-0073: kebab slug from the filename — the renderer builds the
      // GitHub story link (blob/main/.project/stories/<id>-<slug>.md) from it.
      slug: file.replace(/^SHY-\d{4}-/, '').replace(/\.md$/, ''),
      // I1 from reviewer: `description` from optional `public_summary` frontmatter
      // (snake_case to match the hand-rolled parser's key regex). Auto-derivation
      // from the User Story body is deferred to SHY-0061 (renderer-side). Until
      // then, opt-in via explicit `public_summary:` frontmatter is the only path.
      description:
        typeof fm.public_summary === 'string' && fm.public_summary
          ? fm.public_summary
          : null,
      phase: fm.phase,
      priority: fm.priority,
      created: fm.created,
      epicId: typeof fm.epic === 'string' && fm.epic ? fm.epic : undefined,
      prUrl: typeof fm.pr === 'string' && fm.pr ? fm.pr : undefined,
    });
  }

  // 3. Sort: priority asc → created asc → ID asc (deterministic).
  publicShys.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority.localeCompare(b.priority);
    if (a.created !== b.created) return a.created.localeCompare(b.created);
    return a.id.localeCompare(b.id);
  });

  // 4. Group items by phase + collect currentlyWorkingOn.
  // Item shape matches spec AC line 58 + legacy phases[].features[] shape (so SHY-0061's
  // renderer can treat both arrays uniformly): { name, description, status, shyId,
  // epicId?, prUrl?, i18n: {} }. `description` is null when no public_summary is set
  // (opt-in); `i18n: {}` is the placeholder for SHY-0061+'s per-locale translations.
  const itemsByPhase = new Map();
  for (const p of baseline.phases) itemsByPhase.set(p.title, []);
  const currentlyWorkingOn = [];
  for (const s of publicShys) {
    const item = {
      name: s.title,
      description: s.description,
      shyId: s.id,
      slug: s.slug,
      status: s.status,
      i18n: {},
    };
    if (s.epicId) item.epicId = s.epicId;
    if (s.prUrl) item.prUrl = s.prUrl;
    itemsByPhase.get(s.phase).push(item);
    if (s.status === 'In Progress') currentlyWorkingOn.push(item);
  }

  // 5. Compose output. Phase shell preserved (titles, i18n, status, progress);
  //    only items[] is overwritten. _meta block added at top.
  //
  // E2E test gap caught: `new Date().toISOString()` on every run breaks
  // determinism — two consecutive runs produce different bytes, defeating the
  // workflow's `git diff --quiet` no-op guard (every run would commit).
  //
  // Fix: compose the output WITHOUT the timestamp first; compare to the
  // existing file's content (with its timestamp masked) — if semantically
  // identical, reuse the previous timestamp. Only stamp `now()` when there's
  // a real semantic change.
  const newPhases = baseline.phases.map((p) => ({
    ...p,
    items: itemsByPhase.get(p.title) || [],
  }));
  const TIMESTAMP_SENTINEL = '__GENERATED_AT_SENTINEL__';
  const skeleton = {
    _meta: {
      epicCount: epicFiles.length,
      generatedAt: TIMESTAMP_SENTINEL,
      generatedFrom: '.project/stories/',
      schemaVersion: 2,
      shyCount: publicShys.length,
    },
    currentlyWorkingOn,
    lastUpdated: TIMESTAMP_SENTINEL,
    phases: newPhases,
  };
  const skeletonRaw = stablePretty(skeleton) + '\n';

  // Compare to existing file with its timestamps masked.
  const existingRaw = readFileSync(dataPath, 'utf8');
  const existingSkeleton = existingRaw
    .replace(/"generatedAt": "[^"]*"/g, `"generatedAt": "${TIMESTAMP_SENTINEL}"`)
    .replace(/"lastUpdated": "[^"]*"/g, `"lastUpdated": "${TIMESTAMP_SENTINEL}"`);

  let generatedAt;
  if (existingSkeleton === skeletonRaw) {
    // No semantic change. Reuse the existing timestamp so the file stays
    // byte-identical (idempotent; workflow's git diff --quiet returns true).
    const m = existingRaw.match(/"generatedAt": "([^"]*)"/);
    generatedAt = (m && m[1]) || (FLAGS.frozenTime || new Date().toISOString());
  } else {
    // Real semantic change. Stamp fresh timestamp.
    generatedAt = FLAGS.frozenTime || new Date().toISOString();
  }

  const finalRaw = skeletonRaw.split(TIMESTAMP_SENTINEL).join(generatedAt);

  // 6. Write with stable, pretty-printed, key-sorted JSON.
  writeFileSync(dataPath, finalRaw);

  const epicSuffix = epicFiles.length === 1 ? '' : 's';
  const shySuffix = publicShys.length === 1 ? '' : 's';
  process.stdout.write(
    `[sync] regenerated ${FLAGS.dataFile} — ${publicShys.length} public SHY${shySuffix}, ${epicFiles.length} EPIC${epicSuffix}\n`,
  );
  exit(0);
}
