/**
 * Firebase App Check attestation for the unauthenticated surface (SHY-0300).
 *
 * `GET /api/ban-status` is unauthenticated by necessity — a banned user has to
 * learn they are banned BEFORE routing, and at that moment there may be no
 * Firebase session. Its only protection was per-IP rate limiting, and the
 * concrete abuse that leaves open is quota starvation: the route resolves the
 * caller's ASN through ip-api, whose free tier is ~45 requests per minute per
 * CALLING ip, and this server has ONE egress ip shared by every user. Starve
 * that budget and `networkBanMatches` refuses every ASN-scoped ban for
 * everyone. SHY-0143 bounded it with negative caching and a 429 pause;
 * attestation removes the cheap way to reach it at all.
 *
 * ## The two failure directions
 *
 * This middleware is pulled in opposite directions and the classification
 * between them IS the design:
 *
 * - A caller presenting NO or a BAD token should be refused, or the control
 *   does nothing.
 * - A caller the verifier could not reach a verdict about must be ALLOWED.
 *   Play Integrity throttles, App Attest is unsupported on older devices, and
 *   Google has incidents. Refusing on those means a third party's bad minute
 *   locks every user out of an app that worked a minute ago — strictly worse
 *   than the abuse this prevents.
 *
 * So: `missing` and `invalid` are refusable; `error` never is. Anything the
 * classifier does not recognise is treated as `error`, because the cost of
 * wrongly passing one request is a fraction of the cost of wrongly refusing
 * all of them.
 *
 * ## Rollout
 *
 * Three modes, and the default is deliberately NOT the strict one. A deploy
 * that forgets the variable must not lock out every client that has yet to
 * ship attestation, so an unset — or misspelled — `APP_CHECK_MODE` lands on
 * `monitor`, which refuses nobody and records everything. The enforcement flip
 * is a config change, reversible in seconds, taken once the recorded attested
 * share says it is safe.
 */

const log = require('../utils/log');

const OFF = 'off';
const MONITOR = 'monitor';
const ENFORCE = 'enforce';
const MODES = [OFF, MONITOR, ENFORCE];

/** The header the Firebase client SDKs send. Lower-cased: Node normalises
 * incoming header names, and `req.headers` is keyed lower-case. */
const APP_CHECK_HEADER = 'x-firebase-appcheck';

/**
 * SDK error codes that mean THE TOKEN IS BAD, as opposed to "we could not
 * find out". Deliberately an allow-list: a code that is not on it is treated
 * as an infrastructure error and PASSES, so a future SDK adding a new failure
 * mode degrades toward availability rather than toward a lockout.
 */
const BAD_TOKEN_CODES = new Set(['app-check/invalid-argument', 'app-check/invalid-credential']);

const counts = { verified: 0, missing: 0, invalid: 0, error: 0, off: 0, refused: 0 };

/** Lazily bound so requiring this module never forces Firebase to initialise
 * — `index.js` pulls in middleware before the Admin SDK is configured in some
 * entry paths, and a top-level `admin.appCheck()` would throw there. */
let verifier = null;
function getVerifier() {
  if (!verifier) {
    const { admin } = require('../utils/firebase');
    verifier = (token) => admin.appCheck().verifyToken(token);
  }
  return verifier;
}

/** Test seam. The ONLY double allowed here: a valid App Check token can be
 * minted solely by a genuine attested install, so `verifyToken` succeeding is
 * not inducible at any test layer. Everything around it is the real module. */
function __setVerifierForTests(fn) {
  verifier = fn;
}

let warnedAboutMode = null;

/** @returns {'off'|'monitor'|'enforce'} */
function appCheckMode() {
  const raw = String(process.env.APP_CHECK_MODE || '')
    .trim()
    .toLowerCase();
  if (MODES.includes(raw)) return raw;
  // Never silent. A typo'd flip that quietly did nothing looks exactly like a
  // successful one, and the next person reads the dashboard as evidence.
  if (raw !== '' && warnedAboutMode !== raw) {
    warnedAboutMode = raw;
    log.warn(`[app-check] unrecognised APP_CHECK_MODE '${raw}' — falling back to '${MONITOR}'`);
  }
  return MONITOR;
}

/**
 * Classify the request's attestation. Never throws.
 *
 * @param {import('http').IncomingMessage} req the LIVE request — `headers` is
 *   a prototype accessor, so never hand this a spread copy.
 * @returns {Promise<{outcome: 'verified'|'missing'|'invalid'|'error', appId?: string}>}
 */
async function verifyAppCheckToken(req) {
  const token = String(req.headers?.[APP_CHECK_HEADER] || '').trim();
  // No token is NOT a bad token. Kept distinct because the rollout depends on
  // telling them apart: `missing` counts clients that have not updated yet,
  // `invalid` is a client sending something wrong. Folded together, the
  // enforcement decision rests on a number that cannot answer "is it safe".
  if (!token) return { outcome: 'missing' };

  try {
    const claims = await getVerifier()(token);
    // Fails CLOSED on an unrecognised success shape: a future SDK returning
    // something unexpected must not be read as a pass.
    if (!claims || !claims.appId) return { outcome: 'invalid' };
    return { outcome: 'verified', appId: claims.appId };
  } catch (err) {
    if (BAD_TOKEN_CODES.has(err?.code)) return { outcome: 'invalid' };
    // Not evidence the caller is illegitimate — see the header comment.
    log.error(`[app-check] verification failed for an infrastructure reason: ${err?.message}`);
    return { outcome: 'error' };
  }
}

/**
 * Express middleware. Mount it AHEAD of the rate limiter so an unattested
 * flood cannot spend a legitimate ip's allowance.
 */
async function appCheckMiddleware(req, res, next) {
  const mode = appCheckMode();

  if (mode === OFF) {
    req.appCheck = { outcome: OFF };
    counts.off += 1;
    return next();
  }

  const result = await verifyAppCheckToken(req);
  req.appCheck = result;
  counts[result.outcome] += 1;
  log.debug(`[app-check] ${req.method} ${req.path} appCheck: ${result.outcome}`);

  const refusable = result.outcome === 'missing' || result.outcome === 'invalid';
  if (mode === ENFORCE && refusable) {
    counts.refused += 1;
    // A code of its OWN. Conflating this with an auth failure would send the
    // client into a sign-in flow that cannot fix an attestation problem.
    return res.status(401).json({
      error: 'App Check attestation is required',
      code: 'app-check-required',
    });
  }

  return next();
}

/** A snapshot, so a caller cannot mutate the live counters. */
const appCheckCounters = () => ({ ...counts });

/** Test-only: the counters are module state and would otherwise leak across
 * files ([[feedback-test-isolation-no-leaks]]). */
function __resetCountersForTests() {
  Object.keys(counts).forEach((k) => {
    counts[k] = 0;
  });
}

module.exports = {
  APP_CHECK_HEADER,
  appCheckMiddleware,
  appCheckMode,
  appCheckCounters,
  verifyAppCheckToken,
  __setVerifierForTests,
  __resetCountersForTests,
};
