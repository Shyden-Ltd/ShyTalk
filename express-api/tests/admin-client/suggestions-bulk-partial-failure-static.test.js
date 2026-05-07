/**
 * Static regression test for Phase 2I finding #3: bulk approve/reject in
 * `public/admin/js/tabs/suggestions.js` previously used `Promise.all`,
 * which masks per-id partial failures (the success toast fires even when
 * some ids both-endpoints-fail). The fix uses `Promise.allSettled` and
 * counts succeeded/failed per id.
 *
 * suggestions.js is an ES module imported directly by the browser — no
 * Jest/jsdom harness is set up for it — so this test does a source scan
 * for the dangerous patterns and the fix-marker patterns.
 *
 * Per memory `[Partial-failure response contracts]`: routes/handlers that
 * silently aggregate per-id failures are themselves bugs, even when the
 * comment in the code says "tracked as follow-up".
 */
const fs = require('fs');
const path = require('path');

const SUGGESTIONS_JS = fs.readFileSync(
  path.resolve(__dirname, '../../../public/admin/js/tabs/suggestions.js'),
  'utf8',
);

describe('suggestions.js — bulk approve/reject must surface partial failures', () => {
  test('does NOT use Promise.all on bulk id arrays (use allSettled instead)', () => {
    // Match `Promise.all(ids.map(` or any `Promise.all(<list of api calls>)`
    // pattern that would reject on first failure. We allow Promise.all
    // for unrelated parallel-fetches like the dashboard data load on
    // line ~362, which intentionally short-circuits on any failure
    // because it's read-only.
    const dangerous = /Promise\.all\s*\(\s*ids\.map/;
    expect(SUGGESTIONS_JS).not.toMatch(dangerous);
  });

  test('uses Promise.allSettled in the bulk action helper', () => {
    expect(SUGGESTIONS_JS).toMatch(/Promise\.allSettled/);
  });

  test('counts failed ids and shows them in the toast', () => {
    // The helper must distinguish all-success / partial / all-failed.
    // Look for the three toast paths.
    expect(SUGGESTIONS_JS).toMatch(/failed for all/i);
    expect(SUGGESTIONS_JS).toMatch(/of \$\{ids\.length\}/);
    expect(SUGGESTIONS_JS).toMatch(/r\.status === 'rejected'/);
  });

  test('drops the "tracked as follow-up" deferral comments', () => {
    // The old code had inline comments saying the partial-failure
    // aggregation was a deferred follow-up. Per memory `[No deferring]`
    // those comments must not return.
    expect(SUGGESTIONS_JS).not.toMatch(/Tracked as follow-up: align bulk/);
    expect(SUGGESTIONS_JS).not.toMatch(/deferred per-id partial-failure/);
  });

  test('runBulkSuggestionAction helper is defined and used twice (approve + reject)', () => {
    const defLoc = SUGGESTIONS_JS.indexOf('async function runBulkSuggestionAction');
    expect(defLoc).toBeGreaterThan(-1);
    const callMatches = SUGGESTIONS_JS.match(/runBulkSuggestionAction\s*\(/g) || [];
    // 1 definition site + 2 call sites
    expect(callMatches.length).toBe(3);
  });
});
