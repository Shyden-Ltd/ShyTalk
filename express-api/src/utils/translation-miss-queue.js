/**
 * Translation miss-queue (SHY-0072): append-only JSONL of (text, target)
 * pairs the provider chain could not translate. Deduplicated on append
 * (same text+target queues once, surviving restarts via hydrate-on-boot).
 * Claude drains this via routine PRs that commit translations into the
 * cache SEED (the "fallback to claude" — build-time, $0).
 *
 * Length surfaces in GET /api/system/health as `translationQueueLength`
 * (computed lazily from the file so the reader never races the writer).
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// NUL separator: cannot appear in either field, so user-controlled text
// can never collide two distinct (text, target) pairs in the dedupe set.
const SEP = '\u0000';

// Under Jest, an un-overridden queue path falls back to a per-process
// tmpdir (same rationale as translation-cache's test default).
let testDefaultDir = null;
function defaultQueuePath() {
  if (process.env.NODE_ENV === 'test') {
    if (!testDefaultDir) testDefaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tqueue-default-'));
    return path.join(testDefaultDir, 'translation-miss-queue.jsonl');
  }
  return path.join(__dirname, '..', '..', 'data', 'translation-miss-queue.jsonl');
}

function createMissQueue({ queuePath = defaultQueuePath() } = {}) {
  const seen = new Set();
  try {
    if (fs.existsSync(queuePath)) {
      for (const line of fs.readFileSync(queuePath, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          seen.add(`${e.text}${SEP}${e.target}`);
        } catch {
          // A corrupt line never blocks queueing; backfill tooling skips it too.
        }
      }
    }
  } catch {
    // Unreadable queue file = start with an empty dedupe set; appends recreate it.
  }

  return {
    /** @returns {boolean} true if appended, false if deduplicated away */
    enqueue(text, target, reason) {
      const k = `${text}${SEP}${target}`;
      if (seen.has(k)) return false;
      seen.add(k);
      fs.mkdirSync(path.dirname(queuePath), { recursive: true });
      fs.appendFileSync(
        queuePath,
        `${JSON.stringify({ text, target, ts: new Date().toISOString(), reason })}\n`,
      );
      return true;
    },

    /** Lazily counted line length (admin backlog signal for /system/health). */
    length() {
      try {
        if (!fs.existsSync(queuePath)) return 0;
        return fs
          .readFileSync(queuePath, 'utf-8')
          .split('\n')
          .filter((l) => l.trim()).length;
      } catch {
        return 0;
      }
    },
  };
}

let defaultInstance = null;
/** Lazy singleton bound to env-overridable path (tests reset via resetModules). */
function getDefaultMissQueue() {
  if (!defaultInstance) {
    defaultInstance = createMissQueue({
      queuePath: process.env.TRANSLATION_MISS_QUEUE_PATH || defaultQueuePath(),
    });
  }
  return defaultInstance;
}

module.exports = { createMissQueue, getDefaultMissQueue };
