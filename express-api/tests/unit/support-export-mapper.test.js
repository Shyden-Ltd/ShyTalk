/**
 * What a data export says about somebody's support tickets (SHY-0421).
 *
 * `data-export-builder.js` gathers backpack, gift wall, transactions,
 * warnings, conversations and their messages, rooms owned, reports filed,
 * suspension appeals, identity map, device bindings, suggestions and
 * notifications — and NOT `supportTickets`.
 *
 * A support ticket is a message somebody wrote about their own account. It is
 * their personal data by any reading, and it was the one queue the export
 * missed. Not a decision — drift: reports and appeals, the two other
 * user→admin queues, are both in there, so the intent was clearly to cover
 * everything somebody submits. Support tickets arrived later and nobody
 * extended the export; SHY-0396 then added a `messages` array of follow-ups to
 * the same documents, so the amount of their own writing that was missing grew.
 *
 * A data export is a legal answer to a subject access request. One that
 * silently omits a category is a wrong answer given with confidence, and the
 * person has no way to know it is incomplete.
 */

const { supportTicketForExport } = require('../../src/utils/support-export');

const ticket = (over) => ({
  id: 'tkt-1',
  userId: 50000010,
  message: 'My coins never arrived',
  category: 'payment',
  status: 'resolved',
  createdAt: 1_700_000_000_000,
  resolvedAt: 1_700_100_000_000,
  messages: [{ message: 'It happened again', createdAt: 1_700_050_000_000 }],
  attachments: [{ r2Key: 'support-tickets/50000010/a.png', contentType: 'image/png' }],
  ...over,
});

describe('supportTicketForExport', () => {
  test('carries the words the person wrote', () => {
    const out = supportTicketForExport(ticket());
    expect(out).toMatchObject({
      id: 'tkt-1',
      message: 'My coins never arrived',
      category: 'payment',
      status: 'resolved',
      createdAt: 1_700_000_000_000,
    });
  });

  test('includes their follow-ups, which are equally their own words', () => {
    // SHY-0396 added these. Leaving them out would omit the half of a
    // conversation the person actually wrote.
    expect(supportTicketForExport(ticket()).messages).toEqual([
      { message: 'It happened again', createdAt: 1_700_050_000_000 },
    ]);
  });

  test('a ticket with no follow-ups has an empty list, not a missing field', () => {
    expect(supportTicketForExport(ticket({ messages: undefined })).messages).toEqual([]);
  });

  test('the admin note is NOT exported', () => {
    // Deliberate, and the same line the other queues already draw: adminNote
    // is written by staff ABOUT the case, not by the person. It can also name
    // or characterise somebody else, and a support queue holds other people's
    // words.
    const out = supportTicketForExport(ticket({ adminNote: 'Refunded; watch this account' }));
    expect(out.adminNote).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('Refunded');
  });

  test('the staff member who resolved it is not exported either', () => {
    // Another person's identifier is their data, not the requester's.
    const out = supportTicketForExport(ticket({ resolvedBy: 'admin-firebase-uid' }));
    expect(out.resolvedBy).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('admin-firebase-uid');
  });

  test('attachments are REFERENCED, never embedded', () => {
    // The bytes are somebody else's photographs as often as their own, and an
    // export is a file that leaves our control. A key and a type say what was
    // attached without shipping it.
    const out = supportTicketForExport(ticket());
    expect(out.attachments).toEqual([
      { r2Key: 'support-tickets/50000010/a.png', contentType: 'image/png' },
    ]);
  });

  test('an attachment row keeps only what identifies it', () => {
    const out = supportTicketForExport(
      ticket({ attachments: [{ r2Key: 'k', contentType: 'image/png', scanVerdict: 'internal' }] }),
    );
    expect(out.attachments[0]).toEqual({ r2Key: 'k', contentType: 'image/png' });
  });

  test('an old ticket from before this shipped still exports', () => {
    // Nothing may depend on a field this story added.
    const legacy = { id: 'old', message: 'hi', createdAt: 1 };
    expect(supportTicketForExport(legacy)).toMatchObject({ id: 'old', message: 'hi' });
    expect(supportTicketForExport(legacy).messages).toEqual([]);
    expect(supportTicketForExport(legacy).attachments).toEqual([]);
  });

  test('a malformed row does not take the export down', () => {
    // One bad document must not cost somebody their whole subject access
    // response.
    expect(supportTicketForExport(null)).toBeNull();
    expect(supportTicketForExport('nonsense')).toBeNull();
  });
});
