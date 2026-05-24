/**
 * Sonar source-encoding regression pin.
 *
 * SonarCloud's source-encoding probe rejects files containing the
 * Unicode replacement character (codepoint 0xFFFD). Its presence in
 * a source file is taken as a sign of an upstream decoding error and
 * surfaces as: `Invalid character encountered in file <path> at line
 * <n> for encoding UTF-8`.
 *
 * Triggered by: PR #827's pre-push Sonar scan flagged
 * `manual-qa-runner.test.js` at line 13858 because the comment
 * documenting Wake 74 (the matcher that asserts no rendered text
 * contains the codepoint) included the literal codepoint inside a
 * parenthetical. The comment was rewritten to reference the codepoint
 * textually (`0xFFFD`) instead of embedding the literal character.
 *
 * Failure mode without this pin: a future PR that explains the
 * codepoint in a NEW source file by pasting the literal character
 * into a comment or string would re-introduce the same Sonar
 * warning. Sonar warnings are HARD failures per the operator's
 * global rule (2026-05-24).
 *
 * Coverage:
 *   - Every .js / .mjs / .cjs / .ts / .tsx file under
 *     express-api/src + express-api/tests is free of the literal
 *     0xFFFD codepoint. Runtime references via `String.fromCharCode`
 *     or JS string-escape sequences (backslash-u-F-F-F-D inside a
 *     string literal) are SAFE — they are ASCII characters on disk
 *     that JS resolves to the codepoint only at runtime — so the
 *     Wake 74 matcher can still reason about the codepoint via an
 *     escape.
 *
 * Self-reference note: this test file itself MUST NOT contain the
 * literal codepoint anywhere — not in comments, not in string
 * literals. The needle below is constructed at runtime via
 * String.fromCharCode so the on-disk file is pure ASCII.
 */

const fs = require('fs');
const path = require('path');

const EXPRESS_API_ROOT = path.resolve(__dirname, '../..');
// Constructed at runtime — keeps this file's on-disk bytes pure
// ASCII so it doesn't trip Sonar's own probe (and so the test
// doesn't flag itself as an offender).
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'coverage') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(js|mjs|cjs|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('Sonar source-encoding contract — no literal U+FFFD in source', () => {
  let offenders;
  beforeAll(() => {
    const files = [
      ...walk(path.join(EXPRESS_API_ROOT, 'src')),
      ...walk(path.join(EXPRESS_API_ROOT, 'tests')),
    ];
    offenders = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      if (!src.includes(REPLACEMENT_CHAR)) continue;
      // R4 review I-1: a file may contain the codepoint on multiple
      // lines. The earlier `indexOf` form only reported the first
      // line, forcing the developer to iterate fix → re-run → fix
      // again. Collect EVERY occurrence so a single failure message
      // is actionable end-to-end.
      const hitLines = src
        .split('\n')
        .map((l, i) => (l.includes(REPLACEMENT_CHAR) ? i + 1 : null))
        .filter((n) => n !== null);
      offenders.push(`${path.relative(EXPRESS_API_ROOT, file)}:${hitLines.join(',')}`);
    }
  });

  test('no source file contains the literal U+FFFD codepoint', () => {
    // If this fails: replace the literal character in the offending
    // file with either the textual reference `0xFFFD` (for prose) or
    // a runtime construction `String.fromCharCode(0xfffd)` / JS
    // escape sequence in a string literal (for code that needs to
    // compare against the actual codepoint at runtime). Escape
    // sequences and fromCharCode are ASCII on disk and don't trip
    // Sonar's encoding probe.
    expect(offenders).toEqual([]);
  });
});
