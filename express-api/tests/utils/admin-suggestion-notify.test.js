/**
 * admin-suggestion-notify.test.js — SHY-0258
 *
 * "New suggestion submitted: admin notification created" was a `test.todo`
 * because there was no way to answer "who are the admins?". Admin status lives
 * only as a Firebase Auth custom claim, granted outside the API, so nothing in
 * Firestore recorded it and enumerating admins meant scanning every user.
 *
 * The directory is now built from traffic (utils/admin-directory.js): the auth
 * middleware records an admin each time it verifies a LIVE claim. That makes
 * the directory a CANDIDATE list rather than an authority, and the most
 * important behaviour in this file is the consequence — a demoted admin must
 * stop receiving alerts even though their row is still there.
 *
 * Real Firestore emulator: these are claims about which documents exist after
 * a fan-out, which a double would simply agree with.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const {
  ADMIN_COLLECTION,
  recordAdmin,
  forgetAdmin,
  listAdminUniqueIds,
} = require('../../src/utils/admin-directory');
const {
  notifyAdminsOfNewSuggestion,
  submitterSummary,
  SUMMARY_TITLE_CAP,
} = require('../../src/utils/admin-suggestion-notify');

const RUN = `shy258a-w${process.env.JEST_WORKER_ID || '0'}-${Date.now().toString(36)}`;
let seq = 0;
const touchedUids = [];
const touchedAdmins = [];

function nextAdmin() {
  seq += 1;
  const uid = `${RUN}-fuid${seq}`;
  const uniqueId = `${RUN}-u${seq}`;
  touchedAdmins.push(uid);
  touchedUids.push(uniqueId);
  return { uid, uniqueId };
}

async function inboxFor(uniqueId) {
  const snap = await db.collection('notifications').where('uid', '==', uniqueId).get();
  return snap.docs.map((d) => d.data());
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

afterEach(async () => {
  await Promise.all([
    ...touchedAdmins.map((uid) => db.collection(ADMIN_COLLECTION).doc(uid).delete()),
    ...touchedUids.map(async (uniqueId) => {
      const snap = await db.collection('notifications').where('uid', '==', uniqueId).get();
      await Promise.all(snap.docs.map((d) => d.ref.delete()));
    }),
  ]);
  touchedAdmins.length = 0;
  touchedUids.length = 0;
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

const alwaysAdmin = async () => true;
const neverAdmin = async () => false;

describe('the admin directory', () => {
  test('an admin verified by the auth path is recorded', async () => {
    const { uid, uniqueId } = nextAdmin();
    expect(await recordAdmin(uid, uniqueId)).toBe(true);

    const doc = await db.collection(ADMIN_COLLECTION).doc(uid).get();
    expect(doc.exists).toBe(true);
    expect(doc.data().uniqueId).toBe(uniqueId);
    expect(typeof doc.data().lastSeenAt).toBe('number');
  });

  test('recording the same admin twice does not duplicate them', async () => {
    const { uid, uniqueId } = nextAdmin();
    await recordAdmin(uid, uniqueId);
    await recordAdmin(uid, uniqueId);

    const snap = await db.collection(ADMIN_COLLECTION).where('uid', '==', uid).get();
    expect(snap.size).toBe(1);
  });

  test('a recorded admin is listed', async () => {
    const { uid, uniqueId } = nextAdmin();
    await recordAdmin(uid, uniqueId);

    expect(await listAdminUniqueIds(alwaysAdmin)).toContain(uniqueId);
  });

  test('a DEMOTED admin is not listed, and is dropped from the directory', async () => {
    // The whole reason the directory is a candidate list. A demotion is a claim
    // change this module never sees, so trusting the stored row would keep
    // notifying somebody whose admin rights were revoked.
    const { uid, uniqueId } = nextAdmin();
    await recordAdmin(uid, uniqueId);

    expect(await listAdminUniqueIds(neverAdmin)).not.toContain(uniqueId);
    expect((await db.collection(ADMIN_COLLECTION).doc(uid).get()).exists).toBe(false);
  });

  test('a verification outage EXCLUDES the candidate rather than trusting the row', async () => {
    // Fails closed. If we cannot confirm somebody is still an admin, the safe
    // answer is to skip them for this fan-out, not to widen the audience on
    // the strength of a stale record.
    const { uid, uniqueId } = nextAdmin();
    await recordAdmin(uid, uniqueId);
    const throwing = async () => {
      throw new Error('auth unavailable');
    };

    expect(await listAdminUniqueIds(throwing)).not.toContain(uniqueId);
  });

  test('forgetting an admin is idempotent', async () => {
    const { uid } = nextAdmin();
    expect(await forgetAdmin(uid)).toBe(true);
    expect(await forgetAdmin(uid)).toBe(true);
  });
});

describe('notifying admins of a new suggestion', () => {
  test('each admin gets an inbox notification', async () => {
    const a = nextAdmin();
    const b = nextAdmin();
    await recordAdmin(a.uid, a.uniqueId);
    await recordAdmin(b.uid, b.uniqueId);

    const sent = await notifyAdminsOfNewSuggestion({
      id: 'sugg-1',
      title: 'Add dark mode',
      submitterUniqueId: `${RUN}-someone-else`,
    });

    expect(sent).toBe(2);
    expect(await inboxFor(a.uniqueId)).toHaveLength(1);
    expect(await inboxFor(b.uniqueId)).toHaveLength(1);
  });

  test('the notification names the submitter and the suggestion', async () => {
    const a = nextAdmin();
    await recordAdmin(a.uid, a.uniqueId);

    await notifyAdminsOfNewSuggestion({
      id: 'sugg-42',
      title: 'Add dark mode',
      submitterUniqueId: '10000005',
    });

    const [notif] = await inboxFor(a.uniqueId);
    expect(notif.type).toBe('admin_new_suggestion');
    expect(notif.relatedId).toBe('sugg-42');
    expect(notif.body).toContain('10000005');
    expect(notif.body).toContain('Add dark mode');
  });

  test('an admin who submits the suggestion is not told about their own', async () => {
    const a = nextAdmin();
    await recordAdmin(a.uid, a.uniqueId);

    const sent = await notifyAdminsOfNewSuggestion({
      id: 'sugg-2',
      title: 'My own idea',
      submitterUniqueId: a.uniqueId,
    });

    expect(sent).toBe(0);
    expect(await inboxFor(a.uniqueId)).toHaveLength(0);
  });

  test('nobody outside the directory is notified', async () => {
    // The fan-out's audience is exactly the directory — it never invents a
    // recipient. Demotion itself is asserted for real at the directory
    // boundary ("a DEMOTED admin is not listed"); asserting it again here
    // would only re-test `isLiveAdmin`, which short-circuits to true under
    // Jest and would make the assertion vacuous rather than reassuring.
    const listed = nextAdmin();
    const unlisted = nextAdmin(); // deliberately NOT recorded
    await recordAdmin(listed.uid, listed.uniqueId);

    const sent = await notifyAdminsOfNewSuggestion({
      id: 'sugg-3',
      title: 't',
      submitterUniqueId: `${RUN}-other`,
    });

    expect(sent).toBe(1);
    expect(await inboxFor(listed.uniqueId)).toHaveLength(1);
    expect(await inboxFor(unlisted.uniqueId)).toHaveLength(0);
  });

  test('no admins means no work and no error', async () => {
    const sent = await notifyAdminsOfNewSuggestion({
      id: 'sugg-4',
      title: 't',
      submitterUniqueId: `${RUN}-nobody`,
    });
    expect(sent).toBe(0);
  });

  test('the same suggestion announced twice does not double up an admin inbox', async () => {
    // Rides on the SHY-0258 dedup: type + subject + recipient are identical, so
    // a retry (or a double-submit) collapses.
    const a = nextAdmin();
    await recordAdmin(a.uid, a.uniqueId);

    await notifyAdminsOfNewSuggestion({
      id: 'sugg-5',
      title: 't',
      submitterUniqueId: `${RUN}-other`,
    });
    await notifyAdminsOfNewSuggestion({
      id: 'sugg-5',
      title: 't',
      submitterUniqueId: `${RUN}-other`,
    });

    expect(await inboxFor(a.uniqueId)).toHaveLength(1);
  });
});

describe('the submitter summary', () => {
  test('identifies the submitter and quotes the title', () => {
    expect(submitterSummary('Add dark mode', '10000005')).toBe(
      'New suggestion from user 10000005: "Add dark mode"',
    );
  });

  test('a very long title is capped', () => {
    // The row lands in a store with a 90-day retention; an unbounded title
    // would let a submitter choose how much text every admin carries around.
    const summary = submitterSummary('x'.repeat(500), '1');
    expect(summary).toContain('x'.repeat(SUMMARY_TITLE_CAP));
    expect(summary).not.toContain('x'.repeat(SUMMARY_TITLE_CAP + 1));
  });

  test('a missing title does not produce "undefined"', () => {
    expect(submitterSummary(undefined, '1')).not.toContain('undefined');
  });
});
