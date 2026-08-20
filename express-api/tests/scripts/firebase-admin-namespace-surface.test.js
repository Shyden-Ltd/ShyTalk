/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded binary `git` with literal argv (`ls-files`) to enumerate
 * TRACKED sources only — no user-controlled command and no PATH manipulation.
 * Matches the sibling pre-merge-check / check-story-frontmatter convention. */
/**
 * SHY-0371 — no code may reach for a firebase-admin member that no longer exists.
 *
 * firebase-admin 14 deleted the entire namespaced root surface. What remains is
 * only the app-lifecycle API:
 *
 *   AppErrorCode FirebaseAppError FirebaseError SDK_VERSION applicationDefault
 *   cert deleteApp getApp getApps initializeApp refreshToken
 *
 * `admin.credential`, `admin.auth`, `admin.firestore`, `admin.database`,
 * `admin.messaging`, `admin.appCheck`, `admin.app` and `admin.apps` are all
 * `undefined`, and the App object the SDK returns no longer carries
 * `.firestore()` / `.auth()` / `.database()` / `.messaging()` either.
 *
 * WHY THIS IS AN ALLOWLIST AND NOT A BLOCKLIST
 * --------------------------------------------
 * The 13->14 bump (#1520) fixed `admin.apps` and `admin.firestore`, and SHY-0369
 * then recorded that the bump was "checked and cleared ... no removed namespace
 * API remains anywhere". That was false: `admin.credential.cert()` was live at
 * utils/firebase.js:71 and crash-looped the dev API 37,572 times, and
 * `admin.appCheck()` was live in middleware/app-check.js. Both sweeps had
 * grepped the names ALREADY KNOWN to be gone. A blocklist can only find the
 * breakages you already thought of.
 *
 * So this test asks the installed SDK what it actually exports and flags
 * everything else — including members nobody has thought of yet, and including
 * whatever a future major removes next.
 *
 * It parses rather than greps: a regex over source cannot tell
 * `admin.credential` in code from the same text inside the explanatory comments
 * that sit directly above these very call sites.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parse } = require('@babel/parser');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const FIREBASE_UTIL = path.join(REPO_ROOT, 'express-api', 'src', 'utils', 'firebase.js');

/** The real, installed export surface — the only source of truth worth using. */
const ADMIN_ROOT_EXPORTS = new Set(Object.keys(require('firebase-admin')));

/** Service accessors that v14 removed from the App object initializeApp returns. */
const REMOVED_APP_ACCESSORS = new Set(['firestore', 'auth', 'database', 'messaging', 'storage']);

/** Depth-first walk over the AST. @babel/traverse is not a declared dependency here. */
function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else {
      walk(value, visit);
    }
  }
}

/** The string literal from `require('x')`, or null if this is not that call. */
function requireTarget(node) {
  if (
    node &&
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'require' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'StringLiteral'
  ) {
    return node.arguments[0].value;
  }
  return null;
}

/** Does `spec`, required from `fromFile`, resolve to utils/firebase.js? */
function isFirebaseUtil(spec, fromFile) {
  if (!spec.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(fromFile), spec);
  return resolved === FIREBASE_UTIL || `${resolved}.js` === FIREBASE_UTIL;
}

/** Same options as tests/helpers/test-isolation-analyzer.js — one parser, one convention. */
function parseSource(source) {
  return parse(source, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  });
}

/**
 * Every access to a removed member, across the repo.
 * @returns {{file: string, line: number, expression: string}[]}
 */
function findRemovedMemberAccesses() {
  const tracked = execFileSync('git', ['ls-files', '*.js', '*.cjs', '*.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean);

  const findings = [];

  for (const relative of tracked) {
    const absolute = path.join(REPO_ROOT, relative);
    let source;
    try {
      source = fs.readFileSync(absolute, 'utf8');
    } catch {
      continue; // deleted-but-tracked during a rebase
    }
    // Cheap pre-filter, deliberately broad. It must not be able to produce a
    // FALSE NEGATIVE: a sibling in src/utils requires the re-exporting module as
    // './firebase', which contains neither 'firebase-admin' nor 'utils/firebase'
    // — a narrower filter silently skipped a dozen real files. Any binding this
    // test cares about comes from a specifier containing 'firebase', so that is
    // the widest useful net; the AST decides everything after it.
    if (!source.includes('firebase')) continue;

    let ast;
    try {
      ast = parseSource(source);
    } catch {
      continue; // not parseable as JS (generated fixtures, templates)
    }

    /** Identifiers bound to the firebase-admin root object in this file. */
    const adminBindings = new Set();
    /** Identifiers bound to an App returned by initializeApp in this file. */
    const appBindings = new Set();

    walk(ast, (node) => {
      if (node.type !== 'VariableDeclarator' || !node.init) return;

      const target = requireTarget(node.init);
      if (target === 'firebase-admin' && node.id.type === 'Identifier') {
        adminBindings.add(node.id.name);
        return;
      }
      // `const { admin } = require('../utils/firebase')` re-exports the SAME
      // root object, so it carries exactly the same risk.
      if (target && isFirebaseUtil(target, absolute) && node.id.type === 'ObjectPattern') {
        for (const property of node.id.properties) {
          if (
            property.type === 'ObjectProperty' &&
            property.key.type === 'Identifier' &&
            property.key.name === 'admin' &&
            property.value.type === 'Identifier'
          ) {
            adminBindings.add(property.value.name);
          }
        }
        return;
      }
      // `const prodApp = admin.initializeApp(...)` / `initializeApp(...)`
      if (node.init.type === 'CallExpression' && node.id.type === 'Identifier') {
        const callee = node.init.callee;
        const isInit =
          (callee.type === 'Identifier' && callee.name === 'initializeApp') ||
          (callee.type === 'MemberExpression' &&
            callee.property.type === 'Identifier' &&
            callee.property.name === 'initializeApp');
        if (isInit) appBindings.add(node.id.name);
      }
    });

    if (adminBindings.size === 0 && appBindings.size === 0) continue;

    walk(ast, (node) => {
      if (node.type !== 'MemberExpression' || node.computed) return;
      if (node.object.type !== 'Identifier' || node.property.type !== 'Identifier') return;

      const objectName = node.object.name;
      const member = node.property.name;

      if (adminBindings.has(objectName) && !ADMIN_ROOT_EXPORTS.has(member)) {
        findings.push({
          file: relative,
          line: node.loc.start.line,
          expression: `${objectName}.${member}`,
        });
      } else if (appBindings.has(objectName) && REMOVED_APP_ACCESSORS.has(member)) {
        findings.push({
          file: relative,
          line: node.loc.start.line,
          expression: `${objectName}.${member}()`,
        });
      }
    });
  }

  return findings;
}

describe('SHY-0371 firebase-admin namespace surface', () => {
  test('the installed SDK matches the lockfile, so this suite tests what ships', () => {
    // A stale node_modules is what made the false "bump is cleared" call feel
    // evidence-backed: the working copy held 13.10.0 while the lockfile said
    // 14.2.0, so `admin.credential` probed as a real object locally.
    // Read the on-disk copy directly: firebase-admin's `exports` map does not
    // expose ./package.json, so require() cannot reach it — and the file on
    // disk is exactly the artefact whose staleness caused the problem.
    const installed = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'express-api', 'node_modules', 'firebase-admin', 'package.json'),
        'utf8',
      ),
    ).version;
    const lock = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'express-api', 'package-lock.json'), 'utf8'),
    );
    const locked = lock.packages['node_modules/firebase-admin'].version;
    expect(installed).toBe(locked);
  });

  test('no source file reaches for a firebase-admin member that v14 removed', () => {
    const findings = findRemovedMemberAccesses();
    const report = findings.map((f) => `${f.file}:${f.line}  ${f.expression}`);
    expect(report).toEqual([]);
  });

  test('the detector itself works — it flags a known-removed member', () => {
    // Without this, an empty result above could mean "the walker matched
    // nothing", which is exactly how the previous sweeps reported all-clear.
    const source = [
      "const admin = require('firebase-admin');",
      'const app = admin.initializeApp({});',
      'admin.credential.cert({});',
      'app.firestore();',
      'admin.initializeApp({});',
    ].join('\n');

    const ast = parseSource(source);
    const flagged = [];
    const adminBindings = new Set(['admin']);
    const appBindings = new Set(['app']);
    walk(ast, (node) => {
      if (node.type !== 'MemberExpression' || node.computed) return;
      if (node.object.type !== 'Identifier' || node.property.type !== 'Identifier') return;
      const objectName = node.object.name;
      const member = node.property.name;
      if (adminBindings.has(objectName) && !ADMIN_ROOT_EXPORTS.has(member)) flagged.push(member);
      else if (appBindings.has(objectName) && REMOVED_APP_ACCESSORS.has(member))
        flagged.push(member);
    });

    // `credential` and `firestore` are removed; `initializeApp` survives and
    // must NOT be flagged, or the detector would be crying wolf.
    expect(flagged.sort()).toEqual(['credential', 'firestore']);
  });
});
