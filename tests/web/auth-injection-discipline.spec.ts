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

/** Assignment to `window.shytalkAuth` (or any alias of it) — not a comparison. */
const DIRECT_ASSIGNMENT = /\bshytalkAuth\s*=\s*(?!=)/;

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

function specFiles(): string[] {
  return fs
    .readdirSync(WEB_TESTS_DIR)
    .filter((f) => f.endsWith('.spec.ts') && f !== SELF)
    .map((f) => path.join(WEB_TESTS_DIR, f))
    .sort();
}

test.describe('SHY-0279 — auth injection discipline', () => {
  test('the comment stripper actually strips (guards every rule below)', () => {
    const stripped = codeOnly('const a = 1; // window.shytalkAuth = {}\n/* shytalkAuth = {} */\nconst b = 2;');
    expect(DIRECT_ASSIGNMENT.test(stripped)).toBe(false);
    expect(DIRECT_ASSIGNMENT.test(codeOnly('w.shytalkAuth = { currentUser: null };'))).toBe(true);
    // A URL must survive: `//` inside `https://` is not a comment.
    expect(codeOnly('const u = "https://example.com/x";')).toContain('https://example.com/x');
  });

  test('the corpus is non-empty and the sanctioned assignment is findable', () => {
    // Vacuous-pass guard. If the directory scan or the pattern ever stopped
    // matching, every rule below would pass by finding nothing at all.
    const files = specFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(DIRECT_ASSIGNMENT.test(codeOnly(fs.readFileSync(HELPER, 'utf8')))).toBe(true);
    // The self-exclusion must name a file that exists — otherwise it is dead
    // config and this spec is quietly scanning itself.
    expect(fs.existsSync(path.join(WEB_TESTS_DIR, SELF))).toBe(true);
    expect(files.map((f) => path.basename(f))).not.toContain(SELF);
  });

  test('no spec assigns window.shytalkAuth directly', () => {
    // The helper waits for the page's own sign-in check to settle first;
    // a direct assignment cannot, because it has nothing to wait on.
    const offenders = specFiles()
      .filter((file) => DIRECT_ASSIGNMENT.test(codeOnly(fs.readFileSync(file, 'utf8'))))
      .map((file) => path.basename(file));
    expect(offenders).toEqual([]);
  });

  test('every spec that presents a signed-in visitor imports the gate', () => {
    const offenders = specFiles()
      .filter((file) => {
        const code = codeOnly(fs.readFileSync(file, 'utf8'));
        return code.includes('injectAuthState(') && !/from '\.\/helpers\/roadmap-auth'/.test(code);
      })
      .map((file) => path.basename(file));
    expect(offenders).toEqual([]);
  });

  test('no sleep is used to gate an injected signed-in visitor', () => {
    // Scoped deliberately to the auth race: a sleep placed right after an
    // injection is the old guesswork wearing a new hat. `shared-header.spec.ts`
    // slept 1000 ms after injecting, which GUARANTEED the page's resolution
    // won. The corpus's other sleeps are the sleeps-eradication story's.
    const offenders: string[] = [];
    for (const file of specFiles()) {
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
