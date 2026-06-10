/**
 * Two-layer disk translation cache (SHY-0072).
 *
 *  - SEED  (committed, read-only at runtime): src/data/translation-cache-seed.json
 *    — written only by Claude backfill PRs draining the miss queue.
 *  - RUNTIME (gitignored, created on first write): data/translation-cache.json
 *    — populated by translate-on-first-view; wins over seed on collision.
 *
 * Keys: `sha256(text):target`. Disk, NOT Firestore — free-tier quota is a
 * real constraint and this cache is hot. Runtime writes are atomic
 * (write `.tmp`, rename). A corrupt layer never crashes boot: that layer
 * loads empty with an ERROR log (fail-open to re-translation, fail-silent
 * to users).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const log = require('./log');

const os = require('node:os');

const DEFAULT_SEED = path.join(__dirname, '..', 'data', 'translation-cache-seed.json');
// Under Jest, an un-overridden runtime path falls back to a per-process
// tmpdir so test runs never pollute the repo's data/ dir or each other.
let testDefaultDir = null;
function defaultRuntimePath() {
  if (process.env.NODE_ENV === 'test') {
    if (!testDefaultDir) testDefaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcache-default-'));
    return path.join(testDefaultDir, 'translation-cache.json');
  }
  return path.join(__dirname, '..', '..', 'data', 'translation-cache.json');
}

function keyOf(text, target) {
  return `${crypto.createHash('sha256').update(text).digest('hex')}:${target}`;
}

function loadLayer(p, label) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (err) {
    log.error('translate', `translation cache ${label} unreadable — starting that layer empty`, {
      path: p,
      error: err.message,
    });
  }
  return {};
}

function createTranslationCache({
  seedPath = DEFAULT_SEED,
  runtimePath = defaultRuntimePath(),
} = {}) {
  const runtime = loadLayer(runtimePath, 'runtime');
  // Merged view: seed under runtime (runtime wins).
  const mem = { ...loadLayer(seedPath, 'seed'), ...runtime };

  return {
    /** @returns {string|null} cached translation or null on miss */
    get(text, target) {
      const v = mem[keyOf(text, target)];
      return v === undefined ? null : v;
    },

    /** Persist a translation: memory + atomic runtime-file write. */
    set(text, target, translated) {
      const k = keyOf(text, target);
      mem[k] = translated;
      runtime[k] = translated;
      fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
      const tmp = `${runtimePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(runtime));
      fs.renameSync(tmp, runtimePath);
    },

    /** Entry count across both layers (future 50K-entries WARN hook). */
    size() {
      return Object.keys(mem).length;
    },
  };
}

module.exports = { createTranslationCache };
