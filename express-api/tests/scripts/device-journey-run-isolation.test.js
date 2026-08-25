/**
 * Per-run isolation for the on-device journeys (SHY-0432).
 *
 * J38 asserted on THREE fixed strings and cleaned up nothing. The final
 * step queried `where('message','==', typed)` for a constant and took
 * `snap.docs[0]` — so with any earlier run's leftovers present the query
 * was non-empty BY CONSTRUCTION. `snap.empty` could never fire, and the
 * `!== seededTicketId` check passed against a stranger's document. The
 * step could not fail for the reason it exists.
 *
 * Meanwhile the leftovers accumulated: 3 open for the iOS persona at
 * 14:08, 5 at 14:39, 6 by the evening, against a display cap of
 * MAX_OPEN_TICKETS_LISTED = 5. The journey was progressively hiding the
 * screen it is about.
 *
 * These are the pure halves of the fix. The device halves — that a run
 * actually passes twice in a row, and that the count stops growing —
 * belong to the on-device run.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  runTagFrom,
  j38Messages,
  staleJourneyTickets,
  personaUniqueId,
  accountOnDevice,
  JOURNEY_TICKET_PREFIX,
  MAX_OPEN_TICKETS_LISTED,
} = require('../../scripts/device-journey-runner');

describe('runTagFrom', () => {
  test('a tag is alphanumeric only, because it is typed through a shell', () => {
    // `input text` is a round trip through TWO shells. Spaces and colons
    // are the only punctuation this path has ever been proven with, and
    // the sentence around the tag supplies those. Anything else in the
    // tag is a quoting bug waiting to look like the product truncating
    // somebody's message.
    const tag = runTagFrom('local-2026-08-22T20-33-53-297Z');
    expect(tag).toMatch(/^[0-9a-zA-Z]+$/);
  });

  test('two runs never share a tag', () => {
    expect(runTagFrom('local-2026-08-22T20-33-53-297Z')).not.toBe(
      runTagFrom('local-2026-08-22T20-38-01-529Z'),
    );
  });

  test('an absent run id is refused rather than silently emptied', () => {
    // The whole defect returns if the tag can be empty: every message
    // collapses back to a constant and the journey loses its isolation
    // WITHOUT any error to say so.
    expect(() => runTagFrom(undefined)).toThrow(/run id/i);
    expect(() => runTagFrom('')).toThrow(/run id/i);
    expect(() => runTagFrom('---')).toThrow(/run id/i);
  });
});

describe('j38Messages', () => {
  const tag = runTagFrom('local-2026-08-22T20-33-53-297Z');
  const other = runTagFrom('local-2026-08-22T20-38-01-529Z');

  test('every asserted string carries the run tag', () => {
    const m = j38Messages(tag);
    expect(m.seed).toContain(tag);
    expect(m.typed).toContain(tag);
    expect(m.followUp).toContain(tag);
  });

  test('no two runs produce the same asserted string', () => {
    const a = j38Messages(tag);
    const b = j38Messages(other);
    expect(a.seed).not.toBe(b.seed);
    expect(a.typed).not.toBe(b.typed);
    expect(a.followUp).not.toBe(b.followUp);
  });

  test('the three strings differ from each other within one run', () => {
    const m = j38Messages(tag);
    expect(new Set([m.seed, m.typed, m.followUp]).size).toBe(3);
  });

  test('every string is typeable — spaces and colons only', () => {
    const m = j38Messages(tag);
    Object.entries(m).forEach(([name, text]) => {
      expect({ name, text }).toEqual({ name, text: expect.stringMatching(/^[0-9a-zA-Z :]+$/) });
    });
  });

  test('every ticket this journey raises is identifiable as its own', () => {
    // The sweep finds leftovers by this prefix. A message that does not
    // carry it is a ticket the cleanup would walk straight past.
    const m = j38Messages(tag);
    expect(m.seed.startsWith(JOURNEY_TICKET_PREFIX)).toBe(true);
    expect(m.typed.startsWith(JOURNEY_TICKET_PREFIX)).toBe(true);
    expect(m.followUp.startsWith(JOURNEY_TICKET_PREFIX)).toBe(true);
  });

  test('a tag that could not survive the shell is refused', () => {
    expect(() => j38Messages('has space')).toThrow(/tag/i);
    expect(() => j38Messages('quote"')).toThrow(/tag/i);
    expect(() => j38Messages('')).toThrow(/tag/i);
  });
});

describe('staleJourneyTickets', () => {
  const owner = '50000010';
  const stranger = '90000010';
  const keep = 'seeded-this-run';

  const ticket = (over) => ({
    id: 't1',
    userId: owner,
    message: `${JOURNEY_TICKET_PREFIX} run abc123: nobody can hear me`,
    ...over,
  });

  test('finds leftovers this persona left in earlier runs', () => {
    const found = staleJourneyTickets([ticket({ id: 'old-1' }), ticket({ id: 'old-2' })], {
      ownerId: owner,
      keepTicketId: keep,
    });
    expect(found.map((t) => t.id)).toEqual(['old-1', 'old-2']);
  });

  test('never touches another account, even for the same journey', () => {
    // Android and iOS walk at the same time on different personas. A
    // sweep that ignored ownership would resolve the other platform's
    // tickets mid-run and fail a walk that was working perfectly.
    const found = staleJourneyTickets([ticket({ id: 'theirs', userId: stranger })], {
      ownerId: owner,
      keepTicketId: keep,
    });
    expect(found).toEqual([]);
  });

  test('never touches a ticket this journey did not raise', () => {
    // Seeded fixtures and anything a human filed stay open. "Cleanup
    // touches only tickets this journey created" is the AC.
    const found = staleJourneyTickets(
      [ticket({ id: 'fixture', message: 'Somebody logged into my account' })],
      { ownerId: owner, keepTicketId: keep },
    );
    expect(found).toEqual([]);
  });

  test('never resolves the ticket this run just seeded', () => {
    const found = staleJourneyTickets([ticket({ id: keep })], {
      ownerId: owner,
      keepTicketId: keep,
    });
    expect(found).toEqual([]);
  });

  test('reads the id under either name the API uses', () => {
    // GET /api/support-tickets (admin) returns raw docs carrying `id`;
    // GET /api/support-tickets/mine/open maps the same field to
    // `ticketId`. Both are real shapes in this codebase.
    const found = staleJourneyTickets([{ ...ticket(), id: undefined, ticketId: 'via-mine' }], {
      ownerId: owner,
      keepTicketId: keep,
    });
    expect(found).toHaveLength(1);
    expect(found[0].ticketId).toBe('via-mine');
  });

  test('survives a malformed row rather than taking the run down', () => {
    const found = staleJourneyTickets(
      [null, undefined, {}, { userId: owner }, ticket({ id: 'real' })],
      { ownerId: owner, keepTicketId: keep },
    );
    expect(found.map((t) => t.id)).toEqual(['real']);
  });

  test('compares ownership across the number/string boundary', () => {
    // uniqueId arrives as a number from Firestore and as a string from
    // the API. A strict === between the two silently sweeps nothing.
    const found = staleJourneyTickets([ticket({ id: 'numeric', userId: 50000010 })], {
      ownerId: '50000010',
      keepTicketId: keep,
    });
    expect(found.map((t) => t.id)).toEqual(['numeric']);
  });

  test('an empty or absent list is not an error', () => {
    expect(staleJourneyTickets([], { ownerId: owner, keepTicketId: keep })).toEqual([]);
    expect(staleJourneyTickets(undefined, { ownerId: owner, keepTicketId: keep })).toEqual([]);
  });
});

describe('MAX_OPEN_TICKETS_LISTED', () => {
  test('the runner and the support API agree on the display cap', () => {
    // The runner cannot require the route module (it would pull in firebase),
    // so the number lives in two files. This is the thing that stops them
    // drifting: raise the cap server-side without touching the runner and
    // this reddens, instead of the journey quietly asserting the wrong bound.
    const route = path.join(__dirname, '..', '..', 'src', 'routes', 'support-tickets.js');
    const src = fs.readFileSync(route, 'utf8');
    const match = src.match(/const MAX_OPEN_TICKETS_LISTED = (\d+);/);
    // Anchor FIRST: if the constant is renamed or moved, this test must fail
    // loudly rather than pass on a null it never looked at.
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBe(MAX_OPEN_TICKETS_LISTED);
  });
});

describe('personaUniqueId', () => {
  test('resolves a seeded persona to the account the provisioner gives it', () => {
    expect(personaUniqueId('adult-power@shytalk.dev')).toBe(50000010);
    expect(personaUniqueId('minor-power@shytalk.dev')).toBe(60000010);
  });

  test('comes from the provisioning table, not a copy', () => {
    const { personas } = require('../../scripts/provision-test-personas');
    personas.forEach((p) => {
      expect({ email: p.email, uid: personaUniqueId(p.email) }).toEqual({
        email: p.email,
        uid: p.uniqueId,
      });
    });
  });

  test('an unknown persona is refused, never compared against undefined', () => {
    // An identity check that compares the device against `undefined` is worse
    // than none: the step still reports a pass.
    expect(() => personaUniqueId('nobody@shytalk.dev')).toThrow(/no seeded persona/i);
  });
});

describe('accountOnDevice', () => {
  const node = (text) => ({ text, id: '', cls: '', center: { x: 0, y: 0 } });

  test('reads the account out of the debug badge', () => {
    expect(accountOnDevice([node('ShyTalk Preview'), node('UID: 50000010 · adult')])).toBe(
      50000010,
    );
  });

  test('reads it with no cohort attached', () => {
    expect(accountOnDevice([node('UID: 60000010')])).toBe(60000010);
  });

  test('a signed-out badge reads as no account, not as a wrong one', () => {
    // "UID: -" is what the badge renders with nobody signed in. Parsing that
    // as a number would give NaN, and NaN !== expected reads in the report as
    // "signed in as the wrong person" for a phone that is signed in as nobody.
    expect(accountOnDevice([node('UID: -')])).toBeNull();
  });

  test('no badge at all reads as null', () => {
    expect(accountOnDevice([node('Contact support')])).toBeNull();
  });

  test('never matches an account id embedded in ordinary copy', () => {
    // A support ticket whose text happens to contain "UID: 12345" must not be
    // mistaken for the badge. The badge line STARTS with it.
    expect(accountOnDevice([node('my problem is UID: 12345 is wrong')])).toBeNull();
  });
});
