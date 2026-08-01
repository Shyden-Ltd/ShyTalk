/**
 * A test may not assert on a field the product has never written.
 *
 * THE BUG THIS EXISTS TO PREVENT: j11 seeded `users/<id>.suspendedUntil` and
 * asserted on it for months. The product writes `isSuspended` +
 * `suspensionEndDate`; `suspendedUntil` has never existed. So every scenario
 * in the suspension journey ran against a user the API considered perfectly
 * active, then reported the PRODUCT as failing to enforce a suspension that
 * had never been applied.
 *
 * The harness, the corpus and the unit tests all agreed with EACH OTHER and
 * disagreed with the product — which is what a state-seed that mirrors a
 * route's writes, instead of calling it, always eventually buys you.
 *
 * Nothing could have caught it by reading the test, because the test was
 * self-consistent. It is only catchable by asking a question no individual
 * test can ask: does this field exist in the product at all?
 *
 * SCOPE. Product code means every surface that could read the field: the
 * Express API, the shared KMP module, the Android app, the web client, and
 * the Firestore rules. A field present in none of them is written by the
 * harness for the harness, and whatever it is meant to establish is not
 * established.
 */
const fs = require('fs');
const path = require('path');

// One definition of "phantom", shared with the RUNTIME guard in the seed
// matcher. Two definitions would drift, which is the failure this whole file
// exists to prevent.
const { isKnownProductField } = require('../../scripts/product-field-registry');

const REPO = path.resolve(__dirname, '../../..');

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

/** Every surface that could legitimately read a Firestore field. */
function productSource() {
  const files = [
    ...walk(path.join(REPO, 'express-api/src'), ['.js']),
    ...walk(path.join(REPO, 'shared/src'), ['.kt']),
    ...walk(path.join(REPO, 'app/src'), ['.kt']),
    ...walk(path.join(REPO, 'public'), ['.js', '.html']),
  ];
  const rules = path.join(REPO, 'firestore.rules');
  if (fs.existsSync(rules)) files.push(rules);
  return { text: files.map((f) => fs.readFileSync(f, 'utf8')).join('\n'), count: files.length };
}

/** Field names a test asserts on, and where. */
function assertedFields() {
  const found = new Map();
  const add = (name, file) => {
    if (!found.has(name)) found.set(name, new Set());
    found.get(name).add(path.basename(file));
  };
  // TEST FILES: only the read-back of the harness's own write is a claim
  // about state. `with field "X"` inside a test is usually ARBITRARY INPUT
  // being fed to an assertion matcher to prove the matcher works — the field
  // name there is test data, not an assertion that the product has it.
  for (const file of walk(path.join(REPO, 'express-api/tests'), ['.test.js'])) {
    // This file documents the pattern it detects, so it would otherwise
    // report its own examples as phantoms.
    if (path.basename(file) === path.basename(__filename)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/_docs\[[^\]]+\]\.([A-Za-z_][A-Za-z0-9_]*)([^\n]*)/g)) {
      // An assertion of ABSENCE proves the phantom is gone — it is the fix,
      // not the bug. Flagging it would push people to delete the very test
      // that pins the field stays unwritten.
      if (/toBeUndefined|toBeNull|not\.toBe/.test(m[2])) continue;
      add(m[1], file);
    }
  }

  // THE CORPUS: here `with field "X"` IS a claim about the product — a
  // journey scenario asserting the product wrote it. This is exactly where
  // `suspendedUntil` lived, so scanning only the tests would have missed the
  // bug that prompted this guard.
  for (const file of walk(path.join(REPO, 'journey-tests'), ['.feature'])) {
    const src = fs.readFileSync(file, 'utf8');
    // A feature explicitly marked as not built is ALLOWED to name fields the
    // product lacks — that is precisely what it is declaring. The tag is the
    // justification, and it is checked in its own right by
    // unimplemented-feature-tag.unit.test.js, so this cannot become a way to
    // hide a phantom in a shipped journey.
    if (src.includes('@unimplemented')) continue;
    for (const m of src.matchAll(/with field "([A-Za-z_][A-Za-z0-9_]*)"/g)) add(m[1], file);
    for (const m of src.matchAll(/\bhas ([a-z][A-Za-z0-9_]*)=/g)) add(m[1], file);
  }
  return found;
}

/**
 * Names that are deliberately not product fields.
 *
 * Kept SHORT and justified one by one. A long allowlist is how this guard
 * would rot into decoration — every entry must be a name whose whole purpose
 * is to be arbitrary.
 */
const NOT_PRODUCT_FIELDS = new Set([
  'existingField', // merge-semantics fixture: proves an unrelated field survives
  'staleField', // merge-semantics fixture: proves an unrelated field is untouched
]);

describe('the scan is not vacuous', () => {
  it('reads real product source across every surface', () => {
    const { count } = productSource();
    expect(count).toBeGreaterThan(500);
  });

  it('finds field assertions to check', () => {
    expect(assertedFields().size).toBeGreaterThan(20);
  });

  it('would notice an invented field', () => {
    // Mutation in miniature: the check must be capable of failing.
    const { text } = productSource();
    expect(text.includes('definitelyNotARealFirestoreFieldXyz')).toBe(false);
  });
});

describe('no test asserts on a field the product never writes', () => {
  const { text: product } = productSource();
  const phantoms = [...assertedFields().entries()]
    .filter(([name]) => !NOT_PRODUCT_FIELDS.has(name))
    // Delegated to the registry so the test and the runtime guard cannot
    // disagree about what counts as real. `product` is still read above to
    // keep the vacuity checks honest.
    .filter(([name]) => !isKnownProductField(name) && !product.includes(name))
    .map(([name, files]) => `${name} (asserted in ${[...files].join(', ')})`)
    .sort();

  it('has no phantom fields', () => {
    // Named in the failure so the fix needs no second command. Each entry is
    // a seed-Given writing something nothing reads — the state it claims to
    // establish is not established, and every scenario relying on it is
    // testing a fiction.
    expect(phantoms).toEqual([]);
  });
});

describe('the allowlist stays honest', () => {
  it('every entry is genuinely absent from the product', () => {
    // If one of these becomes a real field, it should be checked like any
    // other rather than sitting permanently exempt.
    const { text: product } = productSource();
    for (const name of NOT_PRODUCT_FIELDS) {
      expect(product.includes(name)).toBe(false);
    }
  });

  it('stays small — this is an exception list, not a suppression list', () => {
    expect(NOT_PRODUCT_FIELDS.size).toBeLessThanOrEqual(5);
  });
});
