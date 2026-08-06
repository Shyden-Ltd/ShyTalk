/**
 * Type-immune helpers for the shared counters/uniqueId document.
 *
 * Root cause (2026-07-10): a teardown "restore" read the top doc of
 * orderBy('uniqueId','desc') — Firestore type-orders strings AFTER numbers,
 * so a single string-typed uniqueId doc anywhere poisons the counter with a
 * string; `+ 1` on it then CONCATENATES ("33331" + 1 === "333311") and every
 * subsequently minted user carries a string uniqueId that the number-typed
 * searches can never match. THREE call sites shared the same document with
 * copy-pasted arithmetic (the test-helpers allocator + teardown, the
 * production signup mint in routes/users.js, and cron/testDataCleanup); this
 * module is their single arbiter so a fourth divergent copy cannot appear.
 */

// A trustworthy uniqueId-ish value: a positive safe integer, or a pure-digit
// string of one (coerced for sequence continuity). Anything else — booleans,
// null, NaN, Infinity, fractions, exponent strings, unsafe-range values —
// returns null and the caller picks its fallback.
function coercePositiveSafeInteger(raw) {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === 'string' && /^[1-9][0-9]*$/.test(raw)) {
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

// Next id from a raw counter value. `base` is the restart point when the raw
// value is untrusted; `floor` (optional) additionally clamps trusted-but-low
// values up (the signup mint never issues below MIN_UNIQUE_ID).
function nextUniqueIdFrom(raw, { base, floor = 0 }) {
  let current = coercePositiveSafeInteger(raw);
  if (current === null) current = base;
  if (current < floor) current = floor;
  return current + 1;
}

// Repair/restore the counter after deleting users: raise-only, doc-only
// transaction. The candidate comes from the highest remaining user; a
// string-typed top doc gives NO information about the true numeric max
// (strings sort after ALL numbers in the desc order), so only a genuine
// positive safe integer is trusted — otherwise the base. The transaction
// never lowers a live counter below what a concurrent allocation already
// advanced it to (lowering would reissue an id the concurrent setup just
// handed out). Deliberately reads ONLY the counter doc inside the tx — the
// users query stays outside so the conflict set stays a single document.
async function restoreUniqueIdCounter(db, { base = 100000000 } = {}) {
  const maxSnap = await db.collection('users').orderBy('uniqueId', 'desc').limit(1).get();
  const rawMax = maxSnap.empty ? undefined : maxSnap.docs[0].data().uniqueId;
  const candidate =
    typeof rawMax === 'number' && Number.isSafeInteger(rawMax) && rawMax > 0 ? rawMax : base;
  const counterRef = db.doc('counters/uniqueId');
  await db.runTransaction(async (t) => {
    const snap = await t.get(counterRef);
    const live = coercePositiveSafeInteger(snap.exists ? snap.data().value : undefined);
    const value = live !== null && live > candidate ? live : candidate;
    t.set(counterRef, { value }, { merge: true });
  });
}

module.exports = { coercePositiveSafeInteger, nextUniqueIdFrom, restoreUniqueIdCounter };
