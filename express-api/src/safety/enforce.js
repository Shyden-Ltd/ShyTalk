'use strict';

/**
 * SHY-0060 — the central age-gate enforcement primitive every gated endpoint
 * calls. It is the single place that ties together the operator flag, the
 * verdict engine, and the HTTP block shape (and, later, the safety-audit log),
 * so wiring a new endpoint is one call and the block contract can't drift.
 *
 *   const block = await checkFeatureAccess(db, Feature.X, senderData);
 *   if (block) return res.status(block.status).json(block.body);
 *
 * Returns null when access is permitted — either the operator flag is OFF
 * (the shipped default → NO enforcement at all) or the verdict is Allowed.
 *
 * The third argument may be the already-loaded user doc OR a lazy loader
 * `() => Promise<userData>`. The loader is awaited ONLY after the flag is
 * confirmed ON, so an endpoint that would otherwise have no reason to read
 * the user doc adds zero Firestore reads while the flag ships OFF.
 */

const { isAgeGatingEnabled } = require('./age-gating-flag');
const { evaluateFeatureAccess } = require('./feature-access');

const BLOCK_ERROR_ID = 'AGE_GATE_BLOCKED';
// Neutral English fallback only. The client renders the real, T&S-reviewed,
// localized copy from the structured `ageGate` fields — the server never
// ships user-facing wording (and never the engine's developer-facing reason
// string, which carries a feature CODE name).
const BLOCK_MESSAGE = 'This feature is not available for your account.';

function buildBlock(feature, verdict) {
  return {
    status: 403,
    body: {
      error: BLOCK_MESSAGE,
      errorId: BLOCK_ERROR_ID,
      ageGate: {
        feature,
        verdict: verdict.type,
        threshold: verdict.threshold,
        requiredVerification: verdict.requiredVerification ?? null,
      },
    },
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db Admin-SDK Firestore handle
 * @param {string} feature a Feature key (age-thresholds FEATURES)
 * @param {Object|(() => Promise<Object>)} userDataOrLoader the acting user's
 *   `users/<id>` doc data, or a lazy loader invoked only when the flag is ON
 * @param {number} [nowMs=Date.now()] clock for the age computation
 * @returns {Promise<null | { status: number, body: Object }>} null = allowed;
 *   otherwise the 403 status + structured body the caller sends verbatim.
 */
async function checkFeatureAccess(db, feature, userDataOrLoader, nowMs = Date.now()) {
  if (!(await isAgeGatingEnabled(db))) return null;
  const userData =
    typeof userDataOrLoader === 'function' ? await userDataOrLoader() : userDataOrLoader;
  const verdict = evaluateFeatureAccess(userData, feature, nowMs);
  if (verdict.type === 'Allowed') return null;
  return buildBlock(feature, verdict);
}

module.exports = { checkFeatureAccess, BLOCK_ERROR_ID };
