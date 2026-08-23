/**
 * SHY-0387 — an attachment somebody sends has to reach the admin who reads it.
 *
 * Three separate halves have to agree, and each is fine on its own:
 *
 *   1. the client sends storage KEYS with the ticket
 *   2. the API turns those keys into short-lived links
 *   3. the admin panel renders those links as image or video
 *
 * A test on any one of them passes while the chain is broken. That is exactly how
 * SHY-0400 survived: the admin panel's `<video>` branch was correct, the picker
 * was correct for images, and nothing compared them.
 *
 * See [[feedback-assert-the-seam-not-the-sides]].
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => {
  const p = path.join(repoRoot, rel);
  expect(fs.existsSync(p)).toBe(true);
  return fs.readFileSync(p, 'utf8');
};
/**
 * Code only — comments AND imports stripped.
 *
 * Imports matter here: the first version of this test asserted only that
 * `renderEvidence` appeared somewhere in the tab, and deleting the CALL left it
 * green, because `import { renderEvidence }` still matched. An import declares
 * that something is available, not that anybody uses it — the same near-miss
 * `AppCheckWiringPinTest` records for `APP_CHECK_HEADER`. Found by mutation.
 */
const codeOf = (rel) =>
  read(rel)
    .split('\n')
    .filter((l) => {
      const t = l.trimStart();
      return (
        !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('import ')
      );
    })
    .join('\n');

const ROUTE = 'express-api/src/routes/support-tickets.js';
const ADMIN_TAB = 'public/admin/js/tabs/support.js';
const ADMIN_RENDERER = 'public/admin/js/tabs/users.js';

describe('support attachments: stored key → viewed, never downloaded', () => {
  test('the API serves attachments through a view route', () => {
    const route = codeOf(ROUTE);

    expect(route).toContain('attachments');
    expect(route).toMatch(/attachments\/:index/);
  });

  test('no signed download URL is minted for an attachment', () => {
    // SHY-0420. A signed GET URL is a download link, and this route hands it
    // to a moderator for an arbitrary stranger's file — often a photograph of
    // a real person, sometimes of abuse. Once it is on their machine we have
    // no further say in it. It should be viewable and not retrievable.
    const route = codeOf(ROUTE);

    expect(route).not.toMatch(/getSignedGetUrl/);
  });

  test('the view route serves inline, and says not to sniff it', () => {
    const route = codeOf(ROUTE);

    expect(route).toMatch(/Content-Disposition['"`],\s*['"`]inline/);
    expect(route).toMatch(/X-Content-Type-Options/);
  });

  test('the admin panel asks for them', () => {
    const tab = codeOf(ADMIN_TAB);

    expect(tab).toMatch(/support-tickets\/\$\{[^}]+\}\/attachments|attachments/);
  });

  test('the admin panel renders them with the renderer that handles VIDEO', () => {
    const tab = codeOf(ADMIN_TAB);
    const renderer = codeOf(ADMIN_RENDERER);

    // The shared renderer, not a second one. A second renderer beside it is
    // precisely how SHY-0400's video branch became unreachable.
    // The CALL, not the import.
    expect(tab).toMatch(/renderEvidence\(/);
    expect(renderer).toContain('isVideoUrl');
    expect(renderer).toMatch(/<video/);
  });

  test('a failure to load attachments is shown, not swallowed', () => {
    const tab = codeOf(ADMIN_TAB);

    // An attachment that silently fails to appear looks exactly like a ticket
    // that never had one, and a moderator would act unaware evidence exists.
    // Anchored to the loader itself: a `catch` anywhere in the file would
    // otherwise satisfy this, including one that swallows.
    const loader = tab.substring(tab.indexOf('async function loadAttachments'));
    expect(loader.length).toBeGreaterThan(0);
    expect(loader).toMatch(/catch\s*\(/);
    expect(loader).toMatch(/could not be loaded/i);
  });
});
