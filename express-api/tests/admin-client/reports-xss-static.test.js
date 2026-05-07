/**
 * Static regression test for Phase 2I finding #1: numeric user-controlled
 * fields landing in admin reports innerHTML must always be passed through
 * escapeHtml(). reports.js is an ES module imported directly by the
 * browser — no Jest/jsdom harness is set up for it — so this test does a
 * source scan instead of an in-DOM render. It is intentionally narrow:
 * the goal is to prevent the specific regression class where a developer
 * adds a new innerHTML interpolation of a number from the API response
 * and forgets escapeHtml because "numbers are safe".
 *
 * The threat model assumes a malicious or corrupted Firestore aggregation
 * could land a string-with-HTML in a field the admin panel reads via
 * /api/reports. Defense-in-depth: escape every user-controlled value
 * regardless of its expected type.
 */
const fs = require('fs');
const path = require('path');

const REPORTS_JS = fs.readFileSync(
  path.resolve(__dirname, '../../../public/admin/js/tabs/reports.js'),
  'utf8',
);

describe('reports.js — XSS prevention on user-controlled numeric fields', () => {
  // Each entry: a substring the file must NOT contain. We assert each
  // dangerous pattern is absent. If a future edit re-introduces one, the
  // test fails with the line context.
  const DANGEROUS_PATTERNS = [
    // Bare ${user.reportCount} interpolation
    '${user.reportCount}',
    // Bare ${gcsScore} interpolation (line 416 — same XSS class via
    // user.gcsDisplayScore from the API response)
    '} ${gcsScore}',
    // Bare ${user.warningCount} (was already escaped, but lock it in)
    '${user.warningCount}',
    // Defensive: don't allow raw user.uniqueId interpolation either —
    // the file already escapes it via escapeHtml(String(...)).
    'data-navigate-uid="${user.uniqueId',
  ];

  for (const pattern of DANGEROUS_PATTERNS) {
    test(`reports.js does NOT contain dangerous pattern: ${pattern}`, () => {
      const idx = REPORTS_JS.indexOf(pattern);
      if (idx === -1) {
        expect(idx).toBe(-1);
        return;
      }
      // Show the offending line to make the failure actionable.
      const line = REPORTS_JS.substring(0, idx).split('\n').length;
      const offendingLine = REPORTS_JS.split('\n')[line - 1];
      throw new Error(
        `reports.js line ${line} contains unescaped pattern \`${pattern}\`:\n  ${offendingLine.trim()}\n` +
          `Wrap the value in escapeHtml(String(...)) — the helper is imported from /js/core/ui.js.`,
      );
    });
  }

  test('every "reportCount" template substitution uses escapeHtml', () => {
    // Find all `${...reportCount...}` substitutions and ensure each
    // contains "escapeHtml" within the interpolation braces.
    const substitutions = REPORTS_JS.match(/\$\{[^}]*reportCount[^}]*\}/g) || [];
    expect(substitutions.length).toBeGreaterThan(0); // sanity — file does use reportCount
    for (const sub of substitutions) {
      // Comparisons (e.g. user.reportCount !== 1) are fine — they evaluate
      // to a boolean that gets stringified, but the boolean cannot contain
      // attacker-controlled HTML. The dangerous case is when the value
      // itself reaches innerHTML directly.
      const isComparison = /(?:!==|===|<|>|<=|>=)\s*\d/.test(sub);
      if (isComparison) continue;
      expect(sub).toMatch(/escapeHtml/);
    }
  });

  test('every "gcsScore" template substitution uses escapeHtml or a helper function', () => {
    const substitutions = REPORTS_JS.match(/\$\{[^}]*gcsScore[^}]*\}/g) || [];
    expect(substitutions.length).toBeGreaterThan(0);
    for (const sub of substitutions) {
      // Helper-function wrappers (_gcsClass, _gcsEmoji) are safe — they
      // map a number to a known class name or emoji, not raw input.
      const isHelperCall = /_gcs(Class|Emoji)\s*\(/.test(sub);
      if (isHelperCall) continue;
      expect(sub).toMatch(/escapeHtml/);
    }
  });
});
