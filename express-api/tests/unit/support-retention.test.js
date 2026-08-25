/**
 * When a support ticket's data stops being ours to keep (SHY-0436, SHY-0435).
 *
 * Support tickets carry more personal data than almost anything else in
 * ShyTalk: free text somebody wrote while upset, screenshots of private
 * conversations, photographs and video OF OTHER PEOPLE, and account or payment
 * details they were asked to evidence. Keeping that after the reason for
 * holding it has ended is exactly what storage limitation forbids.
 *
 * Two lifecycles, one set of rules:
 *
 *   SHY-0436  a ticket that was CLOSED seven days ago goes, and takes its
 *             attachments with it. Deleting the document alone would leave the
 *             objects referenced by nothing — the ticket's keys are the ONLY
 *             record of which objects belong to it, so they are collected
 *             BEFORE the document goes.
 *
 *   SHY-0435  bytes are uploaded the MOMENT a file is picked, before Send.
 *             Somebody who attaches evidence and then backs out never removes
 *             anything, so the object stays with no ticket carrying its key —
 *             unreferenced, and unreachable by any retention rule or erasure
 *             request. Abandonment is the MORE likely path: somebody upset
 *             enough to raise a safety report is exactly who may attach and
 *             then think better of it.
 *
 * Pure, so every boundary below is pinned without firebase or R2.
 */

const {
  CLOSED_TICKET_RETENTION_MS,
  ABANDONED_UPLOAD_GRACE_MS,
  closedTicketsDueForDeletion,
  abandonedUploadsDueForDeletion,
  attachmentKeysOf,
} = require('../../src/utils/support-retention');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const ticket = (over) => ({
  id: 't1',
  status: 'resolved',
  resolvedAt: NOW - 8 * DAY,
  ...over,
});

describe('the windows themselves', () => {
  test('a closed ticket is kept for exactly seven days', () => {
    // The operator's number. Long enough for somebody to say "that did not
    // actually fix it", short enough that a resolved matter stops being a
    // standing store of other people's images.
    expect(CLOSED_TICKET_RETENTION_MS).toBe(7 * DAY);
  });

  test('an abandoned upload is kept long enough to come back to', () => {
    // Returning to a half-written request must still find the evidence — the
    // form keeps attachments deliberately, and that behaviour is right. The
    // window has to be comfortably longer than a person's interruption and
    // still far short of forever.
    expect(ABANDONED_UPLOAD_GRACE_MS).toBeGreaterThanOrEqual(DAY);
    expect(ABANDONED_UPLOAD_GRACE_MS).toBeLessThanOrEqual(7 * DAY);
  });
});

describe('closedTicketsDueForDeletion', () => {
  test('a ticket closed longer ago than the window is due', () => {
    expect(closedTicketsDueForDeletion([ticket()], NOW).map((t) => t.id)).toEqual(['t1']);
  });

  test('a ticket closed inside the window is kept', () => {
    expect(closedTicketsDueForDeletion([ticket({ resolvedAt: NOW - 6 * DAY })], NOW)).toEqual([]);
  });

  test('an OPEN ticket is never due, however old', () => {
    // Age is not the trigger. A request somebody is still waiting on is not
    // rubbish, no matter how long we have taken over it.
    const old = ticket({ status: 'open', resolvedAt: null, createdAt: NOW - 400 * DAY });
    expect(closedTicketsDueForDeletion([old], NOW)).toEqual([]);
  });

  test('a resolved ticket with no resolvedAt is NOT deleted', () => {
    // Fail closed. Treating a missing timestamp as "closed long ago" would
    // delete somebody's data because a field was absent.
    expect(closedTicketsDueForDeletion([ticket({ resolvedAt: null })], NOW)).toEqual([]);
    expect(closedTicketsDueForDeletion([ticket({ resolvedAt: undefined })], NOW)).toEqual([]);
    expect(closedTicketsDueForDeletion([ticket({ resolvedAt: 'yesterday' })], NOW)).toEqual([]);
  });

  test('the boundary is not-yet at exactly seven days', () => {
    expect(closedTicketsDueForDeletion([ticket({ resolvedAt: NOW - 7 * DAY })], NOW)).toEqual([]);
    expect(
      closedTicketsDueForDeletion([ticket({ resolvedAt: NOW - 7 * DAY - 1 })], NOW),
    ).toHaveLength(1);
  });

  test('a malformed row is skipped, not crashed on', () => {
    expect(closedTicketsDueForDeletion([null, undefined, {}, ticket()], NOW)).toHaveLength(1);
  });
});

describe('attachmentKeysOf', () => {
  test('collects every key a ticket carries', () => {
    // Collected BEFORE the document goes: the ticket is the only record of
    // which objects belong to it.
    //
    // The shape is a plain array of R2 keys, which is what
    // `POST /support-tickets` writes. This fixture previously used
    // `[{ r2Key }]`, a shape the product never produces, and every assertion
    // here passed while the real sweep collected NOTHING -- see the seam test
    // at the bottom of this file.
    expect(
      attachmentKeysOf({
        attachments: ['support-tickets/1/a.png', 'support-tickets/1/b.mp4'],
      }),
    ).toEqual(['support-tickets/1/a.png', 'support-tickets/1/b.mp4']);
  });

  test('a ticket with no attachments yields nothing, not a crash', () => {
    expect(attachmentKeysOf({})).toEqual([]);
    expect(attachmentKeysOf(null)).toEqual([]);
    expect(attachmentKeysOf({ attachments: 'not-an-array' })).toEqual([]);
  });

  test('rows without a key are dropped rather than deleting undefined', () => {
    // Same invented `{ r2Key }` shape as the fixture above; both passed while
    // the sweep read nothing.
    expect(attachmentKeysOf({ attachments: ['a', undefined, '', null] })).toEqual(['a']);
  });
});

describe('abandonedUploadsDueForDeletion', () => {
  const object = (over) => ({
    key: 'support-tickets/50000010/x.png',
    lastModified: NOW - 5 * DAY,
    ...over,
  });

  test('an unreferenced object past the grace window is due', () => {
    const due = abandonedUploadsDueForDeletion([object()], new Set(), NOW);
    expect(due).toEqual(['support-tickets/50000010/x.png']);
  });

  test('an object a ticket still references is NEVER due', () => {
    // The whole safety of this sweep. A referenced key belongs to somebody's
    // live request and deleting it destroys their evidence.
    const referenced = new Set(['support-tickets/50000010/x.png']);
    expect(abandonedUploadsDueForDeletion([object()], referenced, NOW)).toEqual([]);
  });

  test('a recent upload is left alone, so coming back still finds it', () => {
    expect(
      abandonedUploadsDueForDeletion([object({ lastModified: NOW - 60_000 })], new Set(), NOW),
    ).toEqual([]);
  });

  test('an object with no timestamp is kept, not guessed at', () => {
    // Fail closed again: no age means no evidence it is abandoned.
    expect(
      abandonedUploadsDueForDeletion([object({ lastModified: null })], new Set(), NOW),
    ).toEqual([]);
    expect(
      abandonedUploadsDueForDeletion([object({ lastModified: 'old' })], new Set(), NOW),
    ).toEqual([]);
  });

  test('only support-ticket objects are ever considered', () => {
    // The sweep lists a prefix, but a bug in the caller must not let it reach
    // avatars or room covers.
    const stray = object({ key: 'avatars/50000010/photo.png', lastModified: NOW - 90 * DAY });
    expect(abandonedUploadsDueForDeletion([stray], new Set(), NOW)).toEqual([]);
  });

  test('a Date lastModified is understood as well as a number', () => {
    const asDate = object({ lastModified: new Date(NOW - 5 * DAY) });
    expect(abandonedUploadsDueForDeletion([asDate], new Set(), NOW)).toHaveLength(1);
  });
});

// ─── The seam ───────────────────────────────────────────────────

describe('the sweep reads the shape the create route writes', () => {
  /**
   * The defect this exists for: `attachmentKeysOf` read `a.r2Key` while
   * `POST /support-tickets` writes a plain array of keys. Every unit test
   * passed, because every fixture used the invented shape.
   *
   * Two consequences, the second much worse than the first:
   *   1. no attachment was ever deleted at its retention date;
   *   2. `referencedAttachmentKeys()` returned an EMPTY set, and an empty set
   *      of keys-in-use means every support object past the 3-day grace looks
   *      abandoned — including evidence on tickets that are still open.
   *
   * So the fixture is no longer written by hand. It is read out of the route.
   */
  const fs = require('node:fs');
  const path = require('node:path');

  const routeSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'routes', 'support-tickets.js'),
    'utf-8',
  );

  test('the create route still writes attachments as a bare list of keys', () => {
    // If this changes shape, the assertion below is measuring the wrong thing
    // and must be revisited rather than quietly re-passing.
    expect(routeSource).toContain('attachments: attachments.keys');
    expect(routeSource).toMatch(/@returns \{\{ok: true, keys: string\[\]\}/);
  });

  test('a ticket built the way the route builds one yields its keys', () => {
    const asWrittenByTheRoute = {
      attachments: ['support/10000009/a.jpg', 'support/10000009/b.mp4'],
    };
    expect(attachmentKeysOf(asWrittenByTheRoute)).toEqual([
      'support/10000009/a.jpg',
      'support/10000009/b.mp4',
    ]);
  });

  test('and therefore live evidence is excluded from the abandoned sweep', () => {
    // The consequence, asserted end to end rather than inferred: an object
    // belonging to an OPEN ticket must survive however old it is.
    const openTicket = { attachments: ['support/10000009/live.jpg'] };
    const referenced = new Set(attachmentKeysOf(openTicket));
    const veryOld = [{ key: 'support/10000009/live.jpg', lastModified: 0 }];
    expect(abandonedUploadsDueForDeletion(veryOld, referenced, NOW)).toEqual([]);
  });
});
