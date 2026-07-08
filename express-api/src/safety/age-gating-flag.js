'use strict';

/**
 * SHY-0060 — the default-OFF operator feature flag that gates ALL
 * per-feature age-gating enforcement.
 *
 * The engine (age-thresholds.js + safety-gate.js) computes verdicts
 * unconditionally, but no call site ACTS on a verdict unless this flag is
 * switched ON. The flag ships OFF: the engine lands inert in production and
 * is activated later, once the final threshold values + legal/T&S sign-offs
 * are in. Turning it on is an operator toggle, not a redeploy.
 *
 * Storage mirrors the repo's remote-config idiom (autoModEnabled in
 * `config/moderation`, maintenanceMode in `config/app`): a boolean field
 * `ageGatingEnabled` on the Firestore `config/safety` doc, operator-writable
 * via the existing admin `PUT /config/safety` endpoint.
 *
 * Read cost: enforcement checks this flag on every gated action (DM, gift,
 * gacha, voice-join). A 60s process-cache (the alertManager idiom) collapses
 * that to ~1 Firestore read/min regardless of traffic — required by the $0
 * hosting constraint — at the cost of a bounded ≤60s lag on an operator flip.
 */

const log = require('../utils/log');

/** Mirrors alertManager's CONFIG_CACHE_TTL — 60s remote-config freshness. */
const CONFIG_CACHE_TTL_MS = 60 * 1000;
const SAFETY_CONFIG_DOC = 'config/safety';

// Process-scoped cache. `null` = never successfully loaded (distinct from a
// loaded `false`), so a cold process reads through instead of serving a
// phantom OFF. Jest workers are separate processes, so this never bleeds
// across workers; within a file, __resetAgeGatingFlagCache() isolates tests.
let cachedEnabled = null;
let cacheLoadedAt = 0;

/**
 * Pure decision: does the raw `config/safety` doc data (or null when the
 * section is absent) mean age-gating enforcement is switched ON?
 *
 * STRICT by design — only a real boolean `true` enables gating. A mistyped
 * operator value ("true", 1, "on") reads as OFF, the safe default, so a
 * fat-fingered config value can never silently flip a SAFETY gate.
 *
 * @param {Object|null|undefined} configData the `config/safety` doc data
 * @returns {boolean}
 */
function resolveAgeGatingEnabled(configData) {
  return configData?.ageGatingEnabled === true;
}

/**
 * Is age-gating enforcement switched ON right now? Reads `config/safety`
 * through a 60s process-cache and applies the strict resolver above.
 *
 * @param {FirebaseFirestore.Firestore} db Admin-SDK Firestore handle
 * @param {number} [nowMs=Date.now()] injectable clock (for deterministic
 *   TTL tests — a plain value, not a mocked timer)
 * @returns {Promise<boolean>}
 */
async function isAgeGatingEnabled(db, nowMs = Date.now()) {
  if (cachedEnabled !== null && nowMs - cacheLoadedAt < CONFIG_CACHE_TTL_MS) {
    return cachedEnabled;
  }
  try {
    const snap = await db.doc(SAFETY_CONFIG_DOC).get();
    cachedEnabled = resolveAgeGatingEnabled(snap.exists ? snap.data() : null);
    cacheLoadedAt = nowMs;
  } catch (err) {
    // A config-read failure must NEVER 500 a gated request — fail SAFE to
    // OFF (no enforcement). We keep any prior cached value and deliberately
    // do NOT bump cacheLoadedAt, so the next call retries the read rather
    // than pinning the error-default for a full TTL window.
    //
    // Not integration-tested against the real emulator: a genuine Firestore
    // read failure (network-unreachable / deadline-exceeded) can't be
    // induced deterministically mid-suite without bouncing the shared stack.
    // The safe-default VALUE is exhaustively pinned by the resolver's
    // null-data unit tests; this branch only routes a thrown read to it.
    log.error('age-gating-flag', 'config/safety read failed; defaulting OFF', {
      error: err?.message,
    });
    if (cachedEnabled === null) cachedEnabled = false;
  }
  return cachedEnabled;
}

/** Test-only: clear the process cache so a test observes a cold read. */
function __resetAgeGatingFlagCache() {
  cachedEnabled = null;
  cacheLoadedAt = 0;
}

module.exports = { resolveAgeGatingEnabled, isAgeGatingEnabled, __resetAgeGatingFlagCache };
