/**
 * SHY-0396 — the words somebody ADDS to a request they already had open have to
 * reach the admin who reads it.
 *
 * Three halves, each fine on its own:
 *
 *   1. the client posts to `POST /support-tickets/{id}/messages`
 *   2. the API appends them to the ticket's `messages` array
 *   3. the admin panel renders them under the original message
 *
 * Halves 1 and 2 were built and tested first, and both were green while half 3
 * did not exist at all: `tabs/support.js` rendered `ticket.message` and
 * `ticket.adminNote` and nothing else. So choosing "it is the problem I already
 * reported" wrote the person's words into Firestore where no human would ever
 * see them -- which is the exact outcome SHY-0396 exists to prevent, arrived at
 * by a different route.
 *
 * Found by a journey audit against
 * `journey-tests/j38-asking-for-help-twice.feature`, scenario "An admin sees the
 * added words on the original request", which had no test behind it.
 *
 * See [[feedback-assert-the-seam-not-the-sides]] and
 * [[feedback-every-review-includes-a-journey-audit]].
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => {
  const p = path.join(repoRoot, rel);
  expect(fs.existsSync(p)).toBe(true);
  return fs.readFileSync(p, 'utf8');
};

/** Code only — a comment mentioning `messages` is not a render of them. */
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

const ADMIN_TAB = 'public/admin/js/tabs/support.js';
const ROUTE = 'express-api/src/routes/support-tickets.js';

describe('SHY-0396 — a follow-up message reaches the admin', () => {
  test('the API appends follow-ups to a field the ticket carries', () => {
    const route = codeOf(ROUTE);
    expect(route).toContain('/support-tickets/:id/messages');
    expect(route).toMatch(/messages:\s*FieldValue\.arrayUnion/);
  });

  test('the admin tab renders those follow-ups', () => {
    const tab = codeOf(ADMIN_TAB);
    expect(tab).toContain('ticket.messages');
  });

  /**
   * Anchored to the card's own `innerHTML`, not to the file. A whole-file
   * `contains` passes while the value is computed and then never placed in the
   * card -- the defect class `SupportFormWiringPinTest` was written for.
   */
  test('the follow-ups are actually placed in the card, not merely computed', () => {
    const tab = codeOf(ADMIN_TAB);
    const cardHtml = tab.split('card.innerHTML = `')[1];
    expect(cardHtml).toBeDefined();
    const template = cardHtml.split('`')[0];
    expect(template).toMatch(/followUps|messagesHtml/);
  });

  /**
   * A support queue holds whatever somebody typed. The original message is
   * escaped on the way in; a follow-up is the same untrusted text and must be
   * escaped by the same function, or SHY-0396 opens an XSS the original message
   * had already closed.
   */
  test('a follow-up is escaped exactly like the original message', () => {
    const tab = codeOf(ADMIN_TAB);
    // Anchored to the follow-up block itself. Splitting on `ticket.messages`
    // does NOT work: the name appears twice on the guard line
    // (`Array.isArray(ticket.messages) ? ticket.messages : []`), so the window
    // between them is four characters and the assertion could only ever fail.
    const followUpBlock = tab.split('const followUpsHtml')[1]?.split('const resolvedHtml')[0];
    expect(followUpBlock).toBeDefined();
    expect(followUpBlock).toContain('escapeHtml');
  });
});
