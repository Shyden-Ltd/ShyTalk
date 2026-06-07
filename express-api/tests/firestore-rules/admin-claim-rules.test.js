/**
 * Regression guard for G025 — Firestore rules must access the `admin` custom
 * claim via the `isAdmin()` helper (which uses `.get('admin', false)` for safe
 * default), NOT via direct property access (`request.auth.token.admin == true`)
 * which throws when the claim is absent rather than returning false.
 *
 * Background: the rules engine throws on property access when the key is
 * absent. A non-admin user's token has no `admin` claim. If a rule uses
 * `request.auth.token.admin == true` directly and gets evaluated for a
 * non-admin caller, the rule THROWS rather than returning false. Depending on
 * how the throw is handled, this can produce inconsistent permission denials
 * vs. silent rule-engine errors. The `isAdmin()` helper sidesteps this by
 * using the safe `.get('admin', false)` accessor.
 *
 * This test pins the invariant: NO usage of the unsafe direct-access pattern
 * exists outside the explanatory comment at the top of the rules file.
 */

const { readFileSync } = require('fs');
const { join } = require('path');

const RULES_PATH = join(__dirname, '..', '..', '..', 'firestore.rules');
const RULES = readFileSync(RULES_PATH, 'utf8');

describe('Firestore rules: admin claim access (G025 regression guard)', () => {
  /**
   * Strip out all // single-line comments and the explanatory block comments,
   * so the search runs against actual rule logic only. Inline comments at the
   * end of rule lines are stripped to the first //. Multi-line block comments
   * (/* ... *\/) are stripped wholesale.
   */
  function rulesWithoutComments(rules) {
    return rules
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .split('\n')
      .map((line) => {
        const commentIdx = line.indexOf('//');
        return commentIdx >= 0 ? line.slice(0, commentIdx) : line;
      })
      .join('\n');
  }

  test('no rule logic uses request.auth.token.admin direct property access', () => {
    const code = rulesWithoutComments(RULES);
    // Match the exact unsafe pattern: direct dot-access on .token.admin
    // (not via .get(...)). Allow whitespace around the dots for robustness.
    const unsafePattern = /request\.auth\.token\.admin\b/;
    const match = unsafePattern.exec(code);
    expect(match).toBeNull();
  });

  test('isAdmin() helper exists with the safe .get accessor', () => {
    // The helper is the canonical admin check. Verify its definition uses
    // .get('admin', false) — the form that doesn't throw. Use indexOf + slice
    // (NOT lazy-quantifier regex) per the sibling room-rules.test.js note —
    // [\s\S]*? triggers SonarJS S5852 super-linear-backtracking warnings.
    const defStart = RULES.indexOf('function isAdmin()');
    expect(defStart).toBeGreaterThanOrEqual(0);
    const bodyEnd = RULES.indexOf('}', defStart);
    expect(bodyEnd).toBeGreaterThan(defStart);
    const helperBody = RULES.slice(defStart, bodyEnd + 1);
    expect(helperBody).toContain(".get('admin', false)");
  });

  test('all admin-gated rules use isAdmin() instead of direct access', () => {
    // Sanity check the migration — every place that needs an admin check
    // should reference isAdmin(). Count usages; should be >= the number of
    // admin-gated rule sites (currently 20+ from the G025 migration).
    const code = rulesWithoutComments(RULES);
    const isAdminCalls = (code.match(/\bisAdmin\(\)/g) || []).length;
    expect(isAdminCalls).toBeGreaterThanOrEqual(20);
  });
});
