/**
 * SHY-0268 phantom-path audit — a journey may only assert against collections
 * that production actually writes.
 *
 * The failure this guards is subtle and was live in the corpus: the runner
 * seeded a top-level `messages` collection, the corpus asserted the same
 * top-level `messages` collection, and the two agreed with each other while
 * production wrote `conversations/{conversationId}/messages` throughout. The
 * journey proved only that the harness was self-consistent. Firestore has no
 * schema to catch it, and a green run looks identical either way.
 *
 * Ground truth is assembled from two independent sources so neither can drift
 * alone:
 *   1. firestore.rules — the declared collection hierarchy
 *   2. express-api/src  — ABSOLUTE `db.doc(...)` / `db.collection(...)` paths.
 *      Chained `someDoc.ref.collection('x')` is deliberately NOT counted: it
 *      is a subcollection of whatever the ref points at, and reading it as
 *      top-level is precisely what hid the `messages` phantom on the first
 *      pass of this audit.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CORPUS_DIR = path.join(REPO_ROOT, 'journey-tests');
const RULES = path.join(REPO_ROOT, 'firestore.rules');

/**
 * Collections asserted by journeys for features that do not exist in the
 * backend at all. j16 (event scheduling) and j17 (teacher lessons) are
 * written against an intended design; `express-api/src` has no `events` or
 * `lessons` collection, and firestore.rules declares neither.
 *
 * They are listed rather than silently tolerated so the debt reads as "this
 * journey describes something unbuilt", not as a passing test. Delete an
 * entry the moment its feature ships — the test below fails if an entry stops
 * being needed, so this list cannot rot.
 */
const UNBUILT_FEATURE_COLLECTIONS = [
  'events',
  'events/giftLedger',
  'lessons',
  'lessons/ratings',
  'users/eventInvites',
];

/** Declared collection hierarchy from firestore.rules. */
function rulesCollections() {
  const known = new Set();
  const stack = [];
  for (const line of fs.readFileSync(RULES, 'utf8').split('\n')) {
    const indent = line.length - line.trimStart().length;
    const m = /^\s*match \/([A-Za-z0-9_]+)\/\{/.exec(line);
    if (m) {
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      stack.push({ indent, name: m.group ? m.group(1) : m[1] });
      known.add(stack.map((s) => s.name).join('/'));
    } else if (/^\s*match \/databases/.test(line)) {
      stack.length = 0;
    }
  }
  return known;
}

/** Absolute Firestore paths written or read by the Express source. */
function expressCollections() {
  const known = new Set();
  const root = path.join(REPO_ROOT, 'express-api', 'src');
  // Walked in-process rather than shelled out to grep: no PATH dependency,
  // and the test stays portable.
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) scan(fs.readFileSync(full, 'utf8'));
    }
  };
  const scan = (text) => {
    // ABSOLUTE paths only — `db.collection(...)` / `rtdb.doc(...)`. A chained
    // `someDoc.ref.collection('x')` is a SUBcollection of whatever the ref
    // points at; counting it as top-level is what hid the phantom on the
    // first pass of this audit.
    const re = /\b(?:db|rtdb)\.(?:doc|collection|collectionGroup)\(\s*[`'"]([^`'"]+)[`'"]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const parts = m[1].split('/').filter((_, i) => i % 2 === 0);
      if (parts.length) known.add(parts.join('/'));
    }
  };
  walk(root);
  return known;
}

/** Collection paths the corpus asserts, with the file:line that asserts them. */
function assertedCollections() {
  const found = new Map();
  for (const file of fs.readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.feature'))) {
    const lines = fs.readFileSync(path.join(CORPUS_DIR, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Prose steps ("no doc has any entry in "followingIds" whose ...") name
      // a FIELD, not a collection. Only the database-assertion forms count.
      if (!/the database has .*(?:document|entries in|entry in) "/.test(line)) return;
      for (const m of line.matchAll(/(?:document|entries in|entry in) "([^"]+)"/g)) {
        let raw = m[1];
        // A star-prefixed path is a collection-group assertion; the target is
        // the collection name itself, wherever it is nested.
        const isGroup = raw.startsWith('*/');
        if (isGroup) raw = raw.slice(2);
        const parts = raw.split('/').filter((_, idx) => idx % 2 === 0);
        const col = parts.join('/');
        if (!col || /^[{<]/.test(col)) continue;
        if (!found.has(col)) found.set(col, []);
        found.get(col).push(`${file}:${i + 1}`);
      }
    });
  }
  return found;
}

/** A collection-group target is valid if ANY known path ends with that name. */
function isKnown(col, known) {
  if (known.has(col)) return true;
  return [...known].some((k) => k === col || k.endsWith(`/${col}`));
}

describe('journey corpus asserts only real Firestore collections', () => {
  const known = new Set([...rulesCollections(), ...expressCollections()]);

  test('ground truth was actually assembled (guard against a vacuous pass)', () => {
    expect(known.size).toBeGreaterThan(40);
    expect(known.has('users')).toBe(true);
    expect(known.has('conversations/messages')).toBe(true);
    // The phantom this audit was built around must NOT be in ground truth.
    expect(known.has('messages')).toBe(false);
  });

  test('the corpus scan finds assertions (guard against a vacuous pass)', () => {
    expect(assertedCollections().size).toBeGreaterThan(10);
  });

  test('no journey asserts a collection production never writes', () => {
    const phantoms = [];
    for (const [col, sites] of assertedCollections()) {
      if (UNBUILT_FEATURE_COLLECTIONS.includes(col)) continue;
      if (!isKnown(col, known)) phantoms.push(`${col} (e.g. ${sites[0]})`);
    }
    expect(phantoms.sort()).toEqual([]);
  });

  test('every unbuilt-feature entry is still actually asserted somewhere', () => {
    // Keeps the allowlist honest: an entry whose journey was rewritten or
    // whose feature shipped must be deleted, not left as a standing waiver.
    const asserted = assertedCollections();
    const stale = UNBUILT_FEATURE_COLLECTIONS.filter((c) => !asserted.has(c));
    expect(stale).toEqual([]);
  });

  test('no unbuilt-feature entry has quietly become real', () => {
    // If the feature ships, the waiver must be removed in the same change —
    // otherwise a real collection keeps a permanent exemption from the audit.
    const nowReal = UNBUILT_FEATURE_COLLECTIONS.filter((c) => isKnown(c, known));
    expect(nowReal).toEqual([]);
  });
});
