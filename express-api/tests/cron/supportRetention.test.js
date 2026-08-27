/**
 * supportRetention.test.js — SHY-0436, against the real local stack.
 *
 * This cron deletes people's support tickets and the screenshots and videos
 * attached to them. Mocked query chains can only prove the SHAPE of a delete
 * call; for a garbage collector that removes evidence somebody sent us while
 * asking for help, only the real round trip is worth anything. So: real
 * Firestore emulator, real MinIO, objects PUT and then read back.
 *
 * The suite exists because of a defect it would have caught immediately.
 * `attachmentKeysOf` read `a.r2Key` while the create route writes a bare list
 * of keys, so the sweep collected NOTHING — which meant no attachment was ever
 * deleted at its retention date, and, far worse, the set of keys-in-use was
 * empty. An empty keys-in-use set makes every support object past the grace
 * window look abandoned, including evidence on tickets that are still open.
 * The module had no test of its own at the time.
 *
 * Isolation: its own Firestore namespace, and the support prefix is cleared
 * around every test.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';
process.env.FIRESTORE_TEST_NAMESPACE = 'support-retention';

const { CreateBucketCommand } = require('@aws-sdk/client-s3');
const { db } = require('../../src/utils/firebase');
const r2 = require('../../src/utils/r2');
const {
  sweepSupportRetention,
  deleteExpiredClosedTickets,
  deleteAbandonedUploads,
  referencedAttachmentKeys,
} = require('../../src/cron/supportRetention');
const { assertEmulatorReachable, clearCollection } = require('../helpers/firebase-emulator');

const PREFIX = 'support-tickets/';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const put = (key) => r2.putObject(key, Buffer.from('x'), 'image/jpeg');
const exists = async (key) => (await r2.listObjects(key)).includes(key);

async function clearSupportObjects() {
  const keys = await r2.listObjects(PREFIX);
  if (keys.length > 0) await r2.deleteObjects(keys);
}

/** A ticket exactly as `POST /support-tickets` writes one. */
const ticket = (id, over = {}) =>
  db.doc(`supportTickets/${id}`).set({
    userId: 10000009,
    message: 'Something went wrong.',
    category: 'other',
    attachments: [],
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
    createdAt: NOW,
    ...over,
  });

beforeAll(async () => {
  await assertEmulatorReachable();
  try {
    await r2.s3.send(new CreateBucketCommand({ Bucket: r2.bucketName }));
  } catch (err) {
    if (err.name !== 'BucketAlreadyOwnedByYou' && err.name !== 'BucketAlreadyExists') throw err;
  }
});

beforeEach(async () => {
  await clearCollection(db, 'supportTickets');
  await clearSupportObjects();
});

afterAll(async () => {
  await clearCollection(db, 'supportTickets');
  await clearSupportObjects();
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

// ─── What the sweep believes is in use ──────────────────────────

describe('referencedAttachmentKeys', () => {
  test('finds the keys a real ticket carries', async () => {
    await ticket('t-open', { attachments: [`${PREFIX}10000009/live.jpg`] });
    const keys = await referencedAttachmentKeys();
    expect([...keys]).toEqual([`${PREFIX}10000009/live.jpg`]);
  });

  test('finds keys across several tickets', async () => {
    await ticket('t-1', { attachments: [`${PREFIX}10000009/a.jpg`] });
    await ticket('t-2', { attachments: [`${PREFIX}10000010/b.jpg`] });
    const keys = await referencedAttachmentKeys();
    expect([...keys].sort()).toEqual([`${PREFIX}10000009/a.jpg`, `${PREFIX}10000010/b.jpg`]);
  });

  test('is empty only when no ticket carries anything', async () => {
    await ticket('t-bare');
    expect([...(await referencedAttachmentKeys())]).toEqual([]);
  });
});

// ─── Evidence on a live ticket must survive ─────────────────────

describe('deleteAbandonedUploads', () => {
  test('an object belonging to an OPEN ticket survives, however old it looks', async () => {
    // The exact failure the empty keys-in-use set produced. `now` is pushed a
    // year forward so age cannot be the reason it survives.
    const live = `${PREFIX}10000009/live.jpg`;
    await put(live);
    await ticket('t-open', { attachments: [live] });

    await deleteAbandonedUploads(NOW + 365 * DAY);

    expect(await exists(live)).toBe(true);
  });

  test('an object no ticket references, past the grace window, is deleted', async () => {
    const orphan = `${PREFIX}10000009/never-sent.jpg`;
    await put(orphan);

    await deleteAbandonedUploads(NOW + 30 * DAY);

    expect(await exists(orphan)).toBe(false);
  });

  test('an object no ticket references, still inside the grace window, is kept', async () => {
    // Somebody who picked a file two minutes ago and has not pressed Send yet.
    const justPicked = `${PREFIX}10000009/still-typing.jpg`;
    await put(justPicked);

    await deleteAbandonedUploads(NOW);

    expect(await exists(justPicked)).toBe(true);
  });

  test('live and abandoned objects are told apart in the same run', async () => {
    const live = `${PREFIX}10000009/live.jpg`;
    const orphan = `${PREFIX}10000009/orphan.jpg`;
    await put(live);
    await put(orphan);
    await ticket('t-open', { attachments: [live] });

    await deleteAbandonedUploads(NOW + 30 * DAY);

    expect({ live: await exists(live), orphan: await exists(orphan) }).toEqual({
      live: true,
      orphan: false,
    });
  });
});

// ─── Closed tickets past their window ───────────────────────────

describe('deleteExpiredClosedTickets', () => {
  test('a resolved ticket past seven days goes, and takes its attachments', async () => {
    const key = `${PREFIX}10000009/old.jpg`;
    await put(key);
    await ticket('t-old', {
      status: 'resolved',
      resolvedAt: NOW - 8 * DAY,
      attachments: [key],
    });

    const result = await deleteExpiredClosedTickets(NOW);

    expect(result).toEqual({ tickets: 1, attachments: 1 });
    expect(await exists(key)).toBe(false);
    expect((await db.doc('supportTickets/t-old').get()).exists).toBe(false);
  });

  test('a resolved ticket inside the window stays, with its attachments', async () => {
    const key = `${PREFIX}10000009/recent.jpg`;
    await put(key);
    await ticket('t-recent', { status: 'resolved', resolvedAt: NOW - DAY, attachments: [key] });

    await deleteExpiredClosedTickets(NOW);

    expect(await exists(key)).toBe(true);
    expect((await db.doc('supportTickets/t-recent').get()).exists).toBe(true);
  });

  test('an OPEN ticket is never deleted, however old', async () => {
    await ticket('t-open', { createdAt: NOW - 400 * DAY });
    await deleteExpiredClosedTickets(NOW);
    expect((await db.doc('supportTickets/t-open').get()).exists).toBe(true);
  });
});

// ─── The whole sweep ────────────────────────────────────────────

describe('sweepSupportRetention', () => {
  test('clears what is due and leaves what is not, in one run', async () => {
    const live = `${PREFIX}10000009/live.jpg`;
    const orphan = `${PREFIX}10000009/orphan.jpg`;
    const expired = `${PREFIX}10000009/expired.jpg`;
    await Promise.all([put(live), put(orphan), put(expired)]);
    await ticket('t-open', { attachments: [live] });
    await ticket('t-expired', {
      status: 'resolved',
      resolvedAt: NOW - 8 * DAY,
      attachments: [expired],
    });

    await sweepSupportRetention(NOW + 30 * DAY);

    expect({
      live: await exists(live),
      orphan: await exists(orphan),
      expired: await exists(expired),
      openTicket: (await db.doc('supportTickets/t-open').get()).exists,
      expiredTicket: (await db.doc('supportTickets/t-expired').get()).exists,
    }).toEqual({
      live: true,
      orphan: false,
      expired: false,
      openTicket: true,
      expiredTicket: false,
    });
  });
});

// ─── Refusing to run rather than deleting everything ────────────

describe('the sweep will not run on an impossible keys-in-use set', () => {
  /**
   * Defence in depth for the class, not the instance.
   *
   * The defect above was a reader that returned nothing. The guard that would
   * have contained it does not depend on knowing WHY: if tickets carry
   * attachments and the keys-in-use set is nevertheless empty, the set cannot
   * be trusted, and a deletion sweep run against an untrustworthy exclusion
   * set deletes everything it was supposed to protect.
   *
   * Refusing is the safe answer. An unswept bucket costs storage; a swept one
   * costs somebody the evidence they sent while asking for help.
   */
  test('refuses when tickets carry attachments but nothing is referenced', async () => {
    const live = `${PREFIX}10000009/live.jpg`;
    await put(live);
    // A ticket whose attachments are stored in a shape the reader cannot see.
    await db.doc('supportTickets/t-unreadable').set({
      userId: 10000009,
      message: 'x',
      status: 'open',
      attachments: [{ someOtherShape: live }],
      createdAt: NOW,
    });

    await expect(deleteAbandonedUploads(NOW + 30 * DAY)).rejects.toThrow(/keys in use/i);
    expect(await exists(live)).toBe(true);
  });

  test('runs normally when no ticket carries an attachment at all', async () => {
    // Genuinely empty is not suspicious: nobody has attached anything.
    const orphan = `${PREFIX}10000009/orphan.jpg`;
    await put(orphan);
    await ticket('t-bare');

    await expect(deleteAbandonedUploads(NOW + 30 * DAY)).resolves.toEqual({ objects: 1 });
    expect(await exists(orphan)).toBe(false);
  });

  test('the whole sweep stops rather than continuing past the refusal', async () => {
    const live = `${PREFIX}10000009/live.jpg`;
    await put(live);
    await db.doc('supportTickets/t-unreadable').set({
      userId: 10000009,
      message: 'x',
      status: 'open',
      attachments: [{ someOtherShape: live }],
      createdAt: NOW,
    });

    await expect(sweepSupportRetention(NOW + 30 * DAY)).rejects.toThrow(/keys in use/i);
    expect(await exists(live)).toBe(true);
  });
});

// ─── A ticket that became a report — SHY-0438 / SHY-0439 ────────

describe('a converted ticket is not the support queue’s to delete', () => {
  /**
   * Its content is a moderation record now, and its attachments are that
   * report's evidence. Both survive this sweep however old they get; retention
   * follows the report from that point, which is what SHY-0438 promises when it
   * says attachments move by reference.
   *
   * Asserted rather than assumed. Today it holds because step 1 filters on
   * `status == 'resolved'` and step 2 sees the keys as referenced — an accident
   * of two unrelated conditions, which is precisely the kind of thing that
   * stops being true without anybody noticing.
   */
  const convertedTicket = (id, keys) =>
    db.doc(`supportTickets/${id}`).set({
      userId: 10000009,
      message: 'They kept messaging me after I asked them to stop.',
      category: 'safety',
      attachments: keys,
      status: 'converted_to_report',
      convertedToReportId: 'report-9',
      convertedAt: NOW - 400 * DAY,
      createdAt: NOW - 401 * DAY,
    });

  test('the ticket itself is not deleted, however long ago it was converted', async () => {
    await convertedTicket('t-converted', []);
    await sweepSupportRetention(NOW + 30 * DAY);
    expect((await db.doc('supportTickets/t-converted').get()).exists).toBe(true);
  });

  test('its evidence survives, because moderation is acting on it', async () => {
    const evidence = `${PREFIX}10000009/evidence.jpg`;
    await put(evidence);
    await convertedTicket('t-converted', [evidence]);

    await sweepSupportRetention(NOW + 365 * DAY);

    expect(await exists(evidence)).toBe(true);
  });

  test('an expired ordinary ticket beside it is still cleared', async () => {
    // The exclusion is specific, not a sweep that has quietly stopped working.
    const evidence = `${PREFIX}10000009/evidence.jpg`;
    const expired = `${PREFIX}10000009/expired.jpg`;
    await Promise.all([put(evidence), put(expired)]);
    await convertedTicket('t-converted', [evidence]);
    await ticket('t-expired', {
      status: 'resolved',
      resolvedAt: NOW - 8 * DAY,
      attachments: [expired],
    });

    await sweepSupportRetention(NOW + 30 * DAY);

    expect({ evidence: await exists(evidence), expired: await exists(expired) }).toEqual({
      evidence: true,
      expired: false,
    });
  });
});
