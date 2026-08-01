/**
 * Refuse to seed a field the product has never heard of.
 *
 * THE DOOR EVERY PHANTOM CAME THROUGH. A generic state-seed matcher —
 * `<Name> exists with a=1, b=2` — writes WHATEVER key=value pairs the step
 * names, with no check against the product at all. So any corpus author can
 * invent a field, and the write silently succeeds:
 *
 *   suspendedUntil        the product writes isSuspended + suspensionEndDate
 *   isAgeVerified         the product reads ageVerified — an 18+ gate
 *   isUnblockable         no such flag exists; block-check has no exemption
 *   micStates             mic state lives on seats.<i>.isMuted
 *   ownerUniqueId         rooms use ownerId
 *   privacyVersion        acceptance lives on users.acceptedLegalVersion
 *
 * Every one of those made a scenario look tested while it asserted nothing —
 * and several were SAFETY gates. Patching each is not enough; the door has to
 * close, or the next one arrives the same way.
 *
 * THE RULE IS DELIBERATELY WEAK, AND THAT IS THE POINT. It rejects names that
 * appear NOWHERE in product source. That cannot false-positive on a real
 * field, cannot go stale as the schema grows, and needs no curated list
 * anyone must remember to update.
 *
 * IT HAS ONE KNOWN BLIND SPOT, and it is the original bug. `suspendedUntil`
 * DOES exist in the product — as `ident.suspendedUntil` in the admin
 * identity-graph table (public/admin/js/tabs/users.js), on an identity-graph
 * entry rather than a user doc. A name can therefore be real somewhere and
 * still be fiction on the collection being seeded.
 *
 * So a second, per-collection list covers names known to be wrong on a
 * specific doc. It is short by design and each entry names what the product
 * actually uses — the point is to make the correction obvious, not to become
 * a schema. This repo has no single schema to validate against, and inventing
 * one here would create exactly the second source of truth that caused the
 * original problem.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');

/** Every surface that could legitimately read or write a Firestore field. */
const PRODUCT_ROOTS = [
  { dir: path.join(REPO, 'express-api/src'), exts: ['.js'] },
  { dir: path.join(REPO, 'shared/src'), exts: ['.kt'] },
  { dir: path.join(REPO, 'app/src'), exts: ['.kt'] },
  { dir: path.join(REPO, 'public'), exts: ['.js', '.html'] },
];

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^(node_modules|build|dist|\.git|coverage)$/.test(entry.name)) continue;
      walk(p, exts, out);
    } else if (exts.some((x) => entry.name.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}

let cachedIdentifiers = null;

/**
 * Every identifier that appears anywhere in product source.
 *
 * Built once per process and cached: the scan reads roughly 900 files, which
 * is cheap once and unacceptable per seeded field.
 */
function productIdentifiers() {
  if (cachedIdentifiers) return cachedIdentifiers;
  const identifiers = new Set();
  for (const { dir, exts } of PRODUCT_ROOTS) {
    for (const file of walk(dir, exts)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) identifiers.add(m[0]);
    }
  }
  const rules = path.join(REPO, 'firestore.rules');
  if (fs.existsSync(rules)) {
    for (const m of fs.readFileSync(rules, 'utf8').matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      identifiers.add(m[0]);
    }
  }
  cachedIdentifiers = identifiers;
  return identifiers;
}

/** Test seam: force the next call to re-scan. */
function resetCache() {
  cachedIdentifiers = null;
}

/**
 * Names that exist elsewhere in the product but are WRONG on a given
 * collection, mapped to what the product actually uses there.
 *
 * The blind-spot cover for the coarse check above. Every entry is a mistake
 * that has actually been made and cost real debugging.
 */
const WRONG_FOR_COLLECTION = {
  users: {
    // Real on identity-graph entries; never on a user doc. Cost months of a
    // suspension journey that never suspended anyone.
    suspendedUntil: 'isSuspended + suspensionEndDate',
    isAgeVerified: 'ageVerified',
    privacyVersion: 'acceptedLegalVersion',
    acceptedPrivacyVersion: 'acceptedLegalVersion',
  },
  rooms: {
    ownerUniqueId: 'ownerId',
    hostUid: 'ownerId',
    micStates: 'seats.<index>.isMuted',
  },
};

/**
 * Fields the HARNESS owns, which the product is not expected to know.
 *
 * Each carries state between steps and is read back by the harness alone; none
 * is a claim about product behaviour. Kept short and justified, because a long
 * list is how this guard would rot into decoration.
 */
const HARNESS_OWNED_FIELDS = new Set([
  // The DOB an admin would read off a submitted ID image. There is no image
  // upload in a journey run, so the value is carried here for the next step
  // to act on. Documented as runner-only at its write site.
  'dobOnId',
]);

/**
 * @param {string} field
 * @param {string} [collection] the doc's collection, e.g. 'users'
 * @returns {boolean} true if the product could plausibly read this field here
 */
function isKnownProductField(field, collection) {
  const name = String(field || '');
  if (!name) return false;
  if (HARNESS_OWNED_FIELDS.has(name)) return true;
  const wrongHere = collection && WRONG_FOR_COLLECTION[collection];
  if (wrongHere && Object.prototype.hasOwnProperty.call(wrongHere, name)) return false;
  return productIdentifiers().has(name);
}

/**
 * @param {string} field
 * @param {object|string} [opts] `{collection, context}`, or a context string
 * @returns {string|null} an error message, or null when the field is fine
 */
function rejectUnknownField(field, opts = {}) {
  const { collection, context = 'state-seed' } =
    typeof opts === 'string' ? { context: opts } : opts;
  if (isKnownProductField(field, collection)) return null;

  const wrongHere = collection && WRONG_FOR_COLLECTION[collection];
  if (wrongHere && wrongHere[field]) {
    return (
      `${context} writes "${field}" on ${collection}/, but the product uses ` +
      `${wrongHere[field]} there. Seeding the wrong name establishes nothing — ` +
      `the scenario then reports the PRODUCT as failing to honour state that ` +
      `was never applied.`
    );
  }
  return (
    `${context} writes "${field}", which appears nowhere in the product ` +
    `(express-api/src, shared/src, app/src, public/, firestore.rules). ` +
    `A field nothing reads establishes nothing: the scenario will pass or fail ` +
    `for reasons unrelated to what it claims to test. Use the name the product ` +
    `actually uses, or add it to HARNESS_OWNED_FIELDS with a reason if it is ` +
    `deliberately harness-only.`
  );
}

module.exports = {
  isKnownProductField,
  rejectUnknownField,
  productIdentifiers,
  resetCache,
  HARNESS_OWNED_FIELDS,
  WRONG_FOR_COLLECTION,
  PRODUCT_ROOTS,
};
