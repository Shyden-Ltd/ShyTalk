/**
 * Static regression test for Phase 2I finding #2: when the admin rapidly
 * switches users (search A → search B before A's loaders finish), the
 * older user's API responses landed AFTER the newer user's and overwrote
 * the displayed DOM (last-write-wins on the same elements like
 * #report-history-list, #warning-history-list, #backpack-grid, etc).
 *
 * Fix: each loader compares its `uid` parameter to the module-level
 * `currentUid` immediately after the await resolves and BEFORE any DOM
 * mutation. If they no longer match, the loader bails — its result is
 * discarded.
 *
 * users.js is an ES module imported directly by the browser — no
 * Jest/jsdom harness is set up for it — so this test does a source scan
 * to assert each known loader has the guard.
 */
const fs = require('fs');
const path = require('path');

const USERS_JS = fs.readFileSync(
  path.resolve(__dirname, '../../../public/admin/js/tabs/users.js'),
  'utf8',
);

// Each entry: [function name, the unique line within the function that
// MUST be immediately followed by the uid !== currentUid guard].
// We pick a unique substring from the function (its first await call)
// and verify the next non-blank statement is the guard.
const LOADERS = [
  {
    name: 'loadReportHistory',
    awaitMarker: 'apiCall("GET", "/api/reports?status=resolved&userId=" + uid)',
  },
  { name: 'loadWarningHistory', awaitMarker: 'await apiCall("GET", url)' },
  { name: 'loadBackpack', awaitMarker: 'apiCall("GET", "/api/users/" + uid + "/backpack")' },
  { name: 'populateBansSection', awaitMarker: 'apiCall("GET", `/api/admin/devices/user/${uid}`)' },
  {
    name: 'populateDeviceBindingCard',
    awaitMarker: 'apiCall("GET", `/api/admin/devices/user/${uid}`)',
  },
  { name: 'loadStalkers', awaitMarker: 'apiCall("GET", "/api/user/" + uid + "/stalkers")' },
];

describe('users.js — stale-write guard on rapid user switch', () => {
  test('populateFormFull passes `uid` (not module currentUid) to loadStalkers', () => {
    // Symmetry with the other loaders in the same Promise.all. Using
    // currentUid here would be doubly racy because currentUid can be
    // mutated by populateForm before this fan-out.
    expect(USERS_JS).toMatch(/loadStalkers\(uid\)/);
    expect(USERS_JS).not.toMatch(/loadStalkers\(currentUid\)/);
  });

  for (const { name, awaitMarker } of LOADERS) {
    test(`${name} bails on stale uid before mutating DOM`, () => {
      const idx = USERS_JS.indexOf(awaitMarker);
      expect(idx).toBeGreaterThan(-1); // sanity — marker must exist
      // Take the next ~200 chars after the marker; the guard must
      // appear before any innerHTML / appendChild / textContent /
      // _backpackItems = / loadedData. assignment.
      const after = USERS_JS.substring(idx, idx + 400);
      const guardIdx = after.indexOf('uid !== currentUid');
      expect(guardIdx).toBeGreaterThan(-1);
      // Ensure the guard appears BEFORE any DOM-mutation token
      const mutationTokens = [
        'innerHTML',
        'appendChild',
        '_backpackItems =',
        '_warningLastTimestamp =',
      ];
      for (const tok of mutationTokens) {
        const tokIdx = after.indexOf(tok);
        if (tokIdx === -1) continue;
        expect(guardIdx).toBeLessThan(tokIdx);
      }
    });
  }

  test('the guard message comment is present at every site (regression-friendly grep)', () => {
    const matches = USERS_JS.match(/admin switched users mid-load — drop stale write/g) || [];
    expect(matches.length).toBe(LOADERS.length);
  });
});
