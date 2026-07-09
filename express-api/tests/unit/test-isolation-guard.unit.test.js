/**
 * Structural guard: no test file may wipe shared emulator state that another
 * test file depends on.
 *
 * Jest parallelises test FILES against ONE Firestore/Auth emulator project. A
 * file that calls `clearCollection(db, 'users')` deletes documents a sibling
 * worker seeded moments ago — the assertions then pass or fail for reasons
 * unrelated to the code under test. SHY-0171 reproduced exactly this between
 * `tests/cron/testDataCleanup.test.js` and `tests/cron/accountDeletion.test.js`.
 *
 * The escape hatch is `FIRESTORE_TEST_NAMESPACE`: a suite that needs exclusive
 * access claims its own emulator project (see `src/utils/firebase.js`). It is
 * safe for any suite that does not resolve ID tokens — the Auth emulator binds
 * token verification to the project it was STARTED with, and nothing else.
 *
 * This guard fails LOUDLY at test time rather than letting the next wholesale
 * wipe become a mystery flake, which is SHY-0171's observability requirement.
 *
 * Scope: only suites that reach a REAL emulator. Pure unit tests (`*.unit.test.js`)
 * double Firebase and never touch one, so they are exempt — including this file,
 * whose own assertions necessarily name the very patterns it forbids.
 */

const fs = require('fs');
const path = require('path');

const TESTS_ROOT = path.join(__dirname, '..');
const rel = (f) => path.relative(path.join(TESTS_ROOT, '..'), f);

function allTestFiles(dir = TESTS_ROOT, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) allTestFiles(full, acc);
    else if (entry.name.endsWith('.test.js')) acc.push(full);
  }
  return acc;
}

/** Drop a trailing `//` comment, but never the `//` of a `http://` URL. */
function stripLineComment(line) {
  for (let i = line.indexOf('//'); i !== -1; i = line.indexOf('//', i + 2)) {
    if (i === 0 || line[i - 1] !== ':') return line.slice(0, i);
  }
  return line;
}

/**
 * Comments describe the rules; only code obeys or breaks them. Strip both
 * comment forms before matching, or a docblock explaining the invariant reads
 * as a violation of it.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(stripLineComment)
    .join('\n');
}

const WIPE_LIST_CONSTS = ['TOP_COLLECTIONS', 'TOP_LEVEL', 'GROUPS', 'SUB_GROUPS'];

/**
 * Collections a file wipes wholesale: the literal `clearCollection(db, 'users')`
 * plus the indirect `for (const c of TOP_LEVEL) clearCollection(db, c)`, resolved
 * by expanding the string-array constants those loops read from.
 */
function wipedCollections(code) {
  const wiped = new Set(
    [...code.matchAll(/clearCollection(?:Group)?\(db,\s*'([^']+)'/g)].map((m) => m[1]),
  );
  if (/clearCollection(?:Group)?\(db,\s*[a-z]/.test(code)) {
    for (const m of code.matchAll(/const\s+([A-Z_]+)\s*=\s*\[([^\]]*)\]/g)) {
      if (!WIPE_LIST_CONSTS.includes(m[1])) continue;
      for (const s of m[2].matchAll(/'([^']+)'/g)) wiped.add(s[1]);
    }
  }
  return wiped;
}

/** An ASSIGNMENT claims the namespace. Merely naming the variable does not. */
const isNamespaced = (code) => /process\.env\.FIRESTORE_TEST_NAMESPACE\s*=/.test(code);

/** A file "uses" a collection if it names it as a string or a path segment. */
function usesCollection(code, collection) {
  const esc = collection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`['"\`]${esc}[/'"\`]`).test(code);
}

/** Suites that hit a real emulator — the only ones this invariant governs. */
const emulatorFiles = allTestFiles()
  .filter((f) => !f.endsWith('.unit.test.js'))
  .map((f) => ({ file: rel(f), code: stripComments(fs.readFileSync(f, 'utf8')) }));

describe('test-isolation guard — a wholesale wipe requires an exclusive emulator project', () => {
  test('the scan sees real emulator suites, including wipers (the guard is not vacuous)', () => {
    expect(emulatorFiles.length).toBeGreaterThan(100);
    expect(
      emulatorFiles.filter(({ code }) => wipedCollections(code).size > 0).length,
    ).toBeGreaterThan(5);
    expect(emulatorFiles.filter(({ code }) => isNamespaced(code)).length).toBeGreaterThan(5);
  });

  test('no non-namespaced suite wipes a collection another non-namespaced suite uses', () => {
    const violations = [];

    for (const { file, code } of emulatorFiles) {
      if (isNamespaced(code)) continue;
      for (const collection of [...wipedCollections(code)].sort()) {
        const collaterals = emulatorFiles
          .filter((o) => o.file !== file && !isNamespaced(o.code))
          .filter((o) => usesCollection(o.code, collection))
          .map((o) => o.file);
        if (collaterals.length > 0) {
          violations.push(
            `${file} wipes '${collection}', also used by ${collaterals.length} other file(s): ` +
              `${collaterals.slice(0, 3).join(', ')}${collaterals.length > 3 ? ', …' : ''}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('no suite wipes the Auth accounts of the shared default project', () => {
    // `DELETE /emulator/v1/projects/demo-shytalk/accounts` deletes the Firebase
    // users behind every ID token a sibling suite just minted. A suite that
    // needs this must claim its own project and derive the URL from it.
    const offenders = emulatorFiles
      .filter(({ code }) => /projects\/demo-shytalk\/accounts/.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  test('a namespaced suite never resolves ID tokens (the one thing a namespace breaks)', () => {
    const offenders = emulatorFiles
      .filter(({ code }) => isNamespaced(code))
      .filter(({ code }) => /verifyIdToken|mintRealUser|createCustomToken/.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
