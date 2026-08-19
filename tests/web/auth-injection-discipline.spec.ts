/**
 * SHY-0279 — no web spec may race the page's own sign-in check.
 *
 * Fixing the seven checks that failed would leave the trap armed: all twelve
 * sites that assign `window.shytalkAuth` are racy, and the other five pass
 * only because their assertion happens to land inside the margin. The margin
 * is machine speed, so "passes today" says nothing about tomorrow's runner.
 *
 * These are structural checks over the spec corpus itself. They read the
 * files rather than execute them, so they hold for specs that are currently
 * skipped, quarantined, or only run on one project.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const WEB_TESTS_DIR = __dirname;
const HELPER = path.join(WEB_TESTS_DIR, 'helpers', 'roadmap-auth.ts');
const AUTH_MODULE = path.resolve(WEB_TESTS_DIR, '../../public/js/roadmap-auth.js');

/**
 * Ways a file can PUT the page into an auth state. All are equally racy: the
 * page's own resolution replaces `window.shytalkAuth` wholesale, so mutating a
 * sub-property is erased just as completely as replacing the whole object.
 *
 * Deliberately NOT included: `Object.defineProperty(window, 'shytalkAuth', …)`.
 * `roadmap-auth.spec.ts` uses it to WRAP the global and observe writes, and
 * `auth-state-known-contract.spec.ts` uses it to record publications — neither
 * puts a visitor on the page, and banning it would flag observation as
 * injection.
 *
 * Limit worth naming: a file that aliases the global first (`const a =
 * window.shytalkAuth; a.currentUser = …`) is not matched by any text rule.
 * The recursive scan below is the real defence — it means such a helper cannot
 * hide in a subdirectory the way it could when only flat `*.spec.ts` was read.
 */
const ASSIGNMENT_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['whole-object assignment', /\bshytalkAuth\s*=\s*(?!=)/],
  // Scoped to the STATE keys. `roadmap-auth.spec.ts` overrides
  // `shytalkAuth.signInWithGoogle` to intercept OAuth — a method swap, not a
  // visitor, and that spec already re-applies it through a late-binding setter
  // so the page's wholesale replace cannot drop it. Flagging it would make
  // this rule something to work around rather than obey.
  ['sub-property assignment', /\bshytalkAuth\s*\.\s*(currentUser|profile|authStateKnown)\s*=\s*(?!=)/],
  ['bracket-notation assignment', /\[\s*['"]shytalkAuth['"]\s*\]\s*=\s*(?!=)/],
];

const assignsAuthState = (code: string) => ASSIGNMENT_PATTERNS.some(([, re]) => re.test(code));

/**
 * Strip `//` and block comments so a rule never matches prose ABOUT the
 * pattern instead of the pattern itself. Every file below is checked with
 * this applied; `the comment stripper actually strips` proves it works, so a
 * silently broken stripper cannot make these checks vacuous.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * This file is excluded from its own scan: it quotes the banned patterns
 * verbatim in its self-proof, so a detector that scanned it would report
 * itself forever. The exclusion is by exact basename — a new spec cannot
 * slip through it by accident.
 */
const SELF = 'auth-injection-discipline.spec.ts';

/**
 * The gate itself — the one file allowed to assign the global, because it is
 * the only one that waits for the page's own resolution first.
 */
const SANCTIONED_WRITER = path.join('helpers', 'roadmap-auth.ts');

/**
 * Walk `tests/web/` RECURSIVELY, not just its top level.
 *
 * A flat `*.spec.ts` scan had a hole big enough to drive the original bug back
 * through: a new `helpers/quick-signin.ts` doing a raw assignment is not a
 * `.spec.ts` and does not live at the top level, so neither the assignment rule
 * nor the import rule would ever have seen it — and specs calling it would look
 * perfectly clean. Every `.ts` under this tree is now in scope.
 */
function scannedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const rel = path.relative(WEB_TESTS_DIR, full);
        if (rel !== SELF && rel !== SANCTIONED_WRITER) out.push(full);
      }
    }
  };
  walk(WEB_TESTS_DIR);
  return out.sort();
}

const rel = (file: string) => path.relative(WEB_TESTS_DIR, file);

test.describe('SHY-0279 — auth injection discipline', () => {
  test('the comment stripper actually strips (guards every rule below)', () => {
    const stripped = codeOnly('const a = 1; // window.shytalkAuth = {}\n/* shytalkAuth = {} */\nconst b = 2;');
    expect(assignsAuthState(stripped)).toBe(false);
    // A URL must survive: `//` inside `https://` is not a comment.
    expect(codeOnly('const u = "https://example.com/x";')).toContain('https://example.com/x');
  });

  // Every form is equally racy — the page replaces the whole object on
  // resolution, so mutating one property is erased just as completely.
  // Without these samples the rules could silently stop matching and the
  // "no offenders" results below would mean nothing.
  for (const [form, sample] of [
    ['whole-object', 'w.shytalkAuth = { currentUser: null };'],
    ['sub-property', 'window.shytalkAuth.currentUser = { uid: "x" };'],
    ['bracket-notation', "window['shytalkAuth'] = { currentUser: null };"],
  ] as const) {
    test(`${form} assignment is detected`, () => {
      expect(assignsAuthState(codeOnly(sample))).toBe(true);
    });
  }

  // Reading and observing are legitimate. A rule that flagged them would be
  // routed around rather than obeyed.
  for (const [form, sample] of [
    ['comparison', 'if (window.shytalkAuth === undefined) return;'],
    ['optional read', 'const k = window.shytalkAuth?.authStateKnown;'],
    ['observation via defineProperty', "Object.defineProperty(window, 'shytalkAuth', { get: () => held });"],
    ['sign-in method override', 'window.shytalkAuth.signInWithGoogle = () => {};'],
  ] as const) {
    test(`${form} is NOT treated as an assignment`, () => {
      expect(assignsAuthState(codeOnly(sample))).toBe(false);
    });
  }

  test('the corpus is non-empty and the sanctioned assignment is findable', () => {
    // Vacuous-pass guard. If the directory walk or the patterns ever stopped
    // matching, every rule below would pass by finding nothing at all.
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(assignsAuthState(codeOnly(fs.readFileSync(HELPER, 'utf8')))).toBe(true);
    // Both exclusions must name files that exist — otherwise they are dead
    // config, and this spec is quietly scanning itself or skipping nothing.
    expect(fs.existsSync(path.join(WEB_TESTS_DIR, SELF))).toBe(true);
    expect(fs.existsSync(path.join(WEB_TESTS_DIR, SANCTIONED_WRITER))).toBe(true);
    expect(files.map(rel)).not.toContain(SELF);
    expect(files.map(rel)).not.toContain(SANCTIONED_WRITER);
    // The walk must actually descend — a regression to a flat readdir would
    // silently stop covering `helpers/` and `fixtures/`.
    expect(files.some((f) => rel(f).includes(path.sep))).toBe(true);
  });

  test('nothing outside the gate assigns window.shytalkAuth', () => {
    // The gate waits for the page's own sign-in check to settle first;
    // a direct assignment cannot, because it has nothing to wait on.
    const offenders = scannedFiles()
      .filter((file) => assignsAuthState(codeOnly(fs.readFileSync(file, 'utf8'))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  test('every file that presents an auth state imports the gate', () => {
    const offenders = scannedFiles()
      .filter((file) => {
        const code = codeOnly(fs.readFileSync(file, 'utf8'));
        // Quote-agnostic: nothing lints `tests/web/**/*.ts`, so an editor's
        // double-quoted auto-import would otherwise be reported as an offender
        // for a difference that changes nothing.
        return code.includes('injectAuthState(') && !/from ['"].*helpers\/roadmap-auth['"]/.test(code);
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  test('no sleep is used to gate an injected signed-in visitor', () => {
    // Scoped deliberately to the auth race: a sleep placed right after an
    // injection is the old guesswork wearing a new hat. `shared-header.spec.ts`
    // slept 1000 ms after injecting, which GUARANTEED the page's resolution
    // won. The corpus's other sleeps are the sleeps-eradication story's.
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const lines = codeOnly(fs.readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('injectAuthState(')) return;
        const lookahead = lines.slice(i, i + 15).join('\n');
        if (lookahead.includes('waitForTimeout')) offenders.push(`${path.basename(file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test('the page can only conclude the sign-in state through one publisher', () => {
    // Closes the door rather than patching the holes: `authStateKnown` is set
    // in exactly ONE place, and that place publishes. Four paths in this
    // module reach a verdict — Firebase resolving, a placeholder API key, an
    // SDK init throw, and the 3 s config-never-loaded fallback. If any one of
    // them could set the flag WITHOUT publishing, every waiter on that path
    // would hang forever with no clue why.
    const code = codeOnly(fs.readFileSync(AUTH_MODULE, 'utf8'));
    const assignments = code.match(/authStateKnown\s*=\s*true/g) || [];
    expect(assignments).toHaveLength(1);

    const publisher = /function markAuthStateKnown\s*\([^)]*\)\s*\{([\s\S]*?)\n {2}\}/.exec(code);
    expect(publisher).not.toBeNull();
    expect(publisher![1]).toMatch(/authStateKnown\s*=\s*true/);
    expect(publisher![1]).toMatch(/updateGlobalAuth\s*\(\s*\)/);
  });

  test('the published auth object carries the resolution flag', () => {
    const code = codeOnly(fs.readFileSync(AUTH_MODULE, 'utf8'));
    const publish = /window\.shytalkAuth\s*=\s*\{([\s\S]*?)\n {4}\};/.exec(code);
    expect(publish).not.toBeNull();
    expect(publish![1]).toMatch(/authStateKnown:/);
  });
});
