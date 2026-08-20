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
 * `undefined`, and the App object the SDK returns carries only `name` and
 * `options` — every `.firestore()` / `.auth()` / `.database()` accessor is gone.
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
 * whatever a future major removes next. The App side is an allowlist for the
 * same reason: `name` and `options` are what survives, so anything else is a
 * finding without having to predict which accessor someone reaches for.
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
const EXPRESS_API = path.join(REPO_ROOT, 'express-api');
const FIREBASE_UTIL = path.join(EXPRESS_API, 'src', 'utils', 'firebase.js');

/** The real, installed export surface — the only source of truth worth using. */
const ADMIN_ROOT_EXPORTS = new Set(Object.keys(require('firebase-admin')));

/**
 * What an App instance still carries on 14. Verified against
 * node_modules/firebase-admin/lib/app/core.d.ts, which declares `name` and
 * `options` and no service accessors at all. An allowlist, so `app.storage()`,
 * `app.remoteConfig()` and every other accessor nobody has thought of are
 * findings without being enumerated.
 */
const APP_ALLOWED_MEMBERS = new Set(['name', 'options']);

/** Factories on `firebase-admin/app` whose return value IS an App instance. */
const APP_FACTORIES = new Set(['initializeApp', 'getApp']);

/**
 * Keys that never contain a child node worth visiting. `leadingComments` etc.
 * carry parsed comment nodes, which the sibling walker in
 * tests/helpers/test-isolation-analyzer.js also skips.
 */
const SKIP_KEYS = new Set([
  'loc',
  'range',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
]);

/**
 * Iterative depth-first walk. Deliberately not recursive: the sibling walker in
 * tests/helpers/test-isolation-analyzer.js was made iterative so a
 * pathologically deep AST cannot overflow the stack, and this one scans the
 * whole repository.
 */
function walk(root, visit) {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node.type !== 'string') continue;
    visit(node);
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') stack.push(child);
        }
      } else if (value && typeof value.type === 'string') {
        stack.push(value);
      }
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
 * The property name a MemberExpression reads, or a sentinel for one that cannot
 * be resolved statically.
 * @returns {{name: string, dynamic: boolean}|null}
 */
function memberName(node) {
  if (!node.computed) {
    return node.property.type === 'Identifier'
      ? { name: node.property.name, dynamic: false }
      : null;
  }
  if (node.property.type === 'StringLiteral') return { name: node.property.value, dynamic: false };
  // `admin[someVar]` cannot be checked, and silently ignoring it is how a
  // detector launders absence of evidence into evidence of absence.
  return { name: '<computed>', dynamic: true };
}

/**
 * Every access to a removed member in one file.
 * Shared by the repo scan and the detector self-test, so the self-test
 * exercises the REAL logic instead of a copy that can drift from it.
 * @returns {{line: number, expression: string}[]}
 */
function analyzeSource(source, absolutePath) {
  const ast = parseSource(source);
  const findings = [];

  /** Identifiers bound to the firebase-admin root object. */
  const adminBindings = new Set();
  /** Identifiers bound to an App instance produced by the ADMIN sdk. */
  const appBindings = new Set();
  /** Local names of admin App factories, e.g. `const { initializeApp } = require('firebase-admin/app')`. */
  const adminFactoryNames = new Set();

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || !node.init) return;
    const target = requireTarget(node.init);
    if (!target) return;

    if (target === 'firebase-admin') {
      if (node.id.type === 'Identifier') {
        adminBindings.add(node.id.name);
        return;
      }
      // `const { credential } = require('firebase-admin')` — the same bug spelled
      // as a destructure. Checked here, at the declaration, because there is no
      // `admin.` member access to catch later.
      if (node.id.type === 'ObjectPattern') {
        for (const property of node.id.properties) {
          if (property.type !== 'ObjectProperty' || property.key.type !== 'Identifier') continue;
          const key = property.key.name;
          if (!ADMIN_ROOT_EXPORTS.has(key)) {
            findings.push({
              line: property.loc.start.line,
              expression: `{ ${key} } = require('firebase-admin')`,
            });
          } else if (APP_FACTORIES.has(key) && property.value.type === 'Identifier') {
            adminFactoryNames.add(property.value.name);
          }
        }
      }
      return;
    }

    if (target === 'firebase-admin/app' && node.id.type === 'ObjectPattern') {
      for (const property of node.id.properties) {
        if (
          property.type === 'ObjectProperty' &&
          property.key.type === 'Identifier' &&
          APP_FACTORIES.has(property.key.name) &&
          property.value.type === 'Identifier'
        ) {
          adminFactoryNames.add(property.value.name);
        }
      }
      return;
    }

    // `const { admin } = require('../utils/firebase')` re-exports the SAME root
    // object, so it carries exactly the same risk.
    if (isFirebaseUtil(target, absolutePath) && node.id.type === 'ObjectPattern') {
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
    }
  });

  // Second pass for App bindings: needs adminBindings/adminFactoryNames complete,
  // because `admin.initializeApp(...)` and a destructured `initializeApp(...)`
  // both produce an App and either may be declared before its own import is seen.
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || !node.init) return;
    if (node.init.type !== 'CallExpression' || node.id.type !== 'Identifier') return;
    const callee = node.init.callee;
    // Scoped deliberately to the ADMIN sdk: the client firebase SDK also exports
    // `initializeApp`, and its App object is a different shape entirely.
    const isAdminFactory =
      (callee.type === 'Identifier' && adminFactoryNames.has(callee.name)) ||
      (callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        adminBindings.has(callee.object.name) &&
        callee.property.type === 'Identifier' &&
        APP_FACTORIES.has(callee.property.name));
    if (isAdminFactory) appBindings.add(node.id.name);
  });

  walk(ast, (node) => {
    if (node.type !== 'MemberExpression') return;
    const member = memberName(node);
    if (!member) return;

    // `require('firebase-admin').credential` — no intermediate variable, so no
    // binding to match. The codebase already writes this idiom for subpaths.
    if (requireTarget(node.object) === 'firebase-admin') {
      if (member.dynamic || !ADMIN_ROOT_EXPORTS.has(member.name)) {
        findings.push({
          line: node.loc.start.line,
          expression: `require('firebase-admin').${member.name}`,
        });
      }
      return;
    }

    if (node.object.type !== 'Identifier') return;
    const objectName = node.object.name;

    if (adminBindings.has(objectName)) {
      if (member.dynamic || !ADMIN_ROOT_EXPORTS.has(member.name)) {
        findings.push({
          line: node.loc.start.line,
          expression: `${objectName}.${member.name}`,
        });
      }
    } else if (appBindings.has(objectName)) {
      if (member.dynamic || !APP_ALLOWED_MEMBERS.has(member.name)) {
        findings.push({
          line: node.loc.start.line,
          expression: `${objectName}.${member.name}()`,
        });
      }
    }
  });

  return findings;
}

/** Tracked JS the scan covers, as repo-relative paths. */
function trackedSources() {
  return execFileSync('git', ['ls-files', '*.js', '*.cjs', '*.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean);
}

/** Should this file be parsed at all? Broad on purpose — see the comment inside. */
function isCandidate(source) {
  // Must not be able to produce a FALSE NEGATIVE: a sibling in src/utils
  // requires the re-exporting module as './firebase', which contains neither
  // 'firebase-admin' nor 'utils/firebase' — a narrower filter silently skipped a
  // dozen real files. Every specifier this analyser can match on contains
  // 'firebase', so that is the widest useful net; the AST decides the rest.
  return source.includes('firebase');
}

/** @returns {{findings: object[], unparseable: string[]}} */
function scanRepository() {
  const findings = [];
  const unparseable = [];

  for (const relative of trackedSources()) {
    const absolute = path.join(REPO_ROOT, relative);
    let source;
    try {
      source = fs.readFileSync(absolute, 'utf8');
    } catch {
      continue; // deleted-but-tracked during a rebase
    }
    if (!isCandidate(source)) continue;

    let fileFindings;
    try {
      // `errorRecovery` keeps a syntax error elsewhere in the file from aborting
      // the scan, but a RECOVERED parse is a partially-understood file — record
      // it rather than let the scan quietly cover less than it claims.
      const ast = parseSource(source);
      if (ast.errors && ast.errors.length > 0) {
        unparseable.push(`${relative} (${ast.errors.length} parse error(s))`);
        continue;
      }
      fileFindings = analyzeSource(source, absolute);
    } catch (e) {
      unparseable.push(`${relative} (${e.message})`);
      continue;
    }

    for (const f of fileFindings) {
      findings.push({ file: relative, line: f.line, expression: f.expression });
    }
  }

  return { findings, unparseable };
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
        path.join(EXPRESS_API, 'node_modules', 'firebase-admin', 'package.json'),
        'utf8',
      ),
    ).version;
    const lock = JSON.parse(fs.readFileSync(path.join(EXPRESS_API, 'package-lock.json'), 'utf8'));
    expect(installed).toBe(lock.packages['node_modules/firebase-admin'].version);
  });

  test('express-api holds the only firebase-admin install, so its surface is repo-wide', () => {
    // The scan covers root-level `scripts/` and `local/` too. Those are only
    // judged correctly against express-api's copy while it is the ONLY copy —
    // if a second install ever appears, this surface stops being authoritative
    // and the scan needs a per-directory resolution instead of failing quietly.
    expect(fs.existsSync(path.join(REPO_ROOT, 'node_modules', 'firebase-admin'))).toBe(false);
    const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const rootDeps = { ...rootPkg.dependencies, ...rootPkg.devDependencies };
    expect(rootDeps['firebase-admin']).toBeUndefined();
  });

  test('every candidate file actually parsed — the scan covers what it claims', () => {
    // `errorRecovery: true` means a malformed file yields a partial AST instead
    // of throwing. Without this assertion the scan could silently understand
    // less of the repo than it reports on.
    const { unparseable } = scanRepository();
    expect(unparseable).toEqual([]);
  });

  test('no source file reaches for a firebase-admin member that v14 removed', () => {
    const { findings } = scanRepository();
    const report = findings.map((f) => `${f.file}:${f.line}  ${f.expression}`);
    expect(report).toEqual([]);
  });

  test('the detector catches every shape the bug can take', () => {
    // Runs the REAL analyser, not a copy of its logic — a re-implementation here
    // would prove only that the copy works. An empty result from the repo scan
    // is trustworthy exactly as far as this test is.
    const shapes = [
      // the original outage, via a plain root binding
      ["const admin = require('firebase-admin');", 'admin.credential.cert({});'],
      // destructured straight off the root — no member access to catch later
      ["const { credential } = require('firebase-admin');", 'credential.cert({});'],
      // chained off an unbound require — the idiom this repo already uses
      ["require('firebase-admin').credential.cert({});"],
      // computed access
      ["const admin = require('firebase-admin');", "admin['credential'].cert({});"],
      // dynamic computed access cannot be resolved, so it must not pass silently
      ["const admin = require('firebase-admin');", 'admin[pick].cert({});'],
      // an accessor on the App object the admin SDK returns
      [
        "const { initializeApp } = require('firebase-admin/app');",
        'const app = initializeApp({});',
        'app.firestore();',
      ],
      // an App accessor nobody enumerated — the allowlist must still catch it
      [
        "const { initializeApp } = require('firebase-admin/app');",
        'const app = initializeApp({});',
        'app.remoteConfig();',
      ],
    ];

    const missed = shapes
      .map((lines) => lines.join('\n'))
      .filter((source) => analyzeSource(source, FIREBASE_UTIL).length === 0);

    expect(missed).toEqual([]);
  });

  test('the detector does not cry wolf on what v14 kept', () => {
    // A detector that flags everything is as useless as one that flags nothing.
    const source = [
      "const admin = require('firebase-admin');",
      "const { initializeApp, cert, getApps } = require('firebase-admin/app');",
      "const { getFirestore } = require('firebase-admin/firestore');",
      'admin.initializeApp({ credential: cert({}) });',
      'const app = initializeApp({}, "secondary");',
      'getFirestore(app);',
      'app.name;',
      'app.options;',
      'getApps().length;',
      // a client-SDK App is a different object; tracking must not reach it
      "const { initializeApp: initClient } = require('firebase/app');",
      'const clientApp = initClient({});',
      'clientApp.automaticDataCollectionEnabled;',
    ].join('\n');

    expect(analyzeSource(source, FIREBASE_UTIL)).toEqual([]);
  });
});
