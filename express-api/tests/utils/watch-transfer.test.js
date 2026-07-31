/**
 * watch-transfer.test.js — SHY-0258
 *
 * "User watches suggestion that gets merged: watch transferred to original"
 * was a `test.todo` with an empty body, and its own comment admitted the gap:
 * "the subscription endpoint needs to handle the transfer". Meanwhile it
 * reported green.
 *
 * The behaviour matters because its absence is invisible. A merged suggestion
 * is terminal — it never updates again — so a watch left pointing at it is a
 * subscription to silence. The person is not told, nothing errors, and from
 * the outside the feature looks like it works.
 *
 * Real Firestore emulator: these are assertions about array-membership after
 * concurrent field updates, which is precisely where a double would agree with
 * whatever the test expected.
 */
const PRIOR_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'local';

const { db } = require('../../src/utils/firebase');
const { assertEmulatorReachable } = require('../helpers/firebase-emulator');
const { transferWatchers } = require('../../src/utils/watch-transfer');

const RUN = `shy258w-w${process.env.JEST_WORKER_ID || '0'}-${Date.now().toString(36)}`;
let seq = 0;
const createdSubs = [];

const DUPLICATE = `${RUN}-dup`;
const ORIGINAL = `${RUN}-orig`;

async function seedWatcher(watched) {
  seq += 1;
  const id = `${RUN}-sub${seq}`;
  await db.collection('subscriptions').doc(id).set({
    uid: id,
    watchedSuggestions: watched,
    watchedFeatures: [],
  });
  createdSubs.push(id);
  return id;
}

async function watchedBy(id) {
  const doc = await db.collection('subscriptions').doc(id).get();
  return doc.data().watchedSuggestions;
}

beforeAll(async () => {
  await assertEmulatorReachable();
});

afterEach(async () => {
  await Promise.all(createdSubs.map((id) => db.collection('subscriptions').doc(id).delete()));
  createdSubs.length = 0;
});

afterAll(() => {
  process.env.NODE_ENV = PRIOR_NODE_ENV;
});

describe('a watched suggestion that gets merged', () => {
  test('the watcher ends up watching the original instead', async () => {
    const sub = await seedWatcher([DUPLICATE]);

    expect(await transferWatchers(DUPLICATE, ORIGINAL)).toBe(1);

    const watched = await watchedBy(sub);
    expect(watched).toContain(ORIGINAL);
    expect(watched).not.toContain(DUPLICATE);
  });

  test('every watcher is moved, not just the first', async () => {
    const a = await seedWatcher([DUPLICATE]);
    const b = await seedWatcher([DUPLICATE]);
    const c = await seedWatcher([DUPLICATE]);

    expect(await transferWatchers(DUPLICATE, ORIGINAL)).toBe(3);

    for (const sub of [a, b, c]) {
      expect(await watchedBy(sub)).toEqual([ORIGINAL]);
    }
  });

  test('other watches are left alone', async () => {
    // The transfer must not be a reset. Someone following several suggestions
    // keeps the rest of their list.
    const other = `${RUN}-unrelated`;
    const sub = await seedWatcher([DUPLICATE, other]);

    await transferWatchers(DUPLICATE, ORIGINAL);

    const watched = await watchedBy(sub);
    expect(watched).toContain(other);
    expect(watched).toContain(ORIGINAL);
    expect(watched).not.toContain(DUPLICATE);
  });

  test('someone already watching BOTH ends up watching the original once', async () => {
    // The duplicate-watch case: arrayUnion converges, so the merge cannot
    // produce two entries for one suggestion.
    const sub = await seedWatcher([DUPLICATE, ORIGINAL]);

    await transferWatchers(DUPLICATE, ORIGINAL);

    expect(await watchedBy(sub)).toEqual([ORIGINAL]);
  });

  test('replaying the merge changes nothing', async () => {
    // Retries and double-clicks happen. The second run finds no watchers of
    // the duplicate and is a no-op, rather than corrupting anyone's list.
    const sub = await seedWatcher([DUPLICATE]);

    await transferWatchers(DUPLICATE, ORIGINAL);
    expect(await transferWatchers(DUPLICATE, ORIGINAL)).toBe(0);

    expect(await watchedBy(sub)).toEqual([ORIGINAL]);
  });

  test('somebody who was not watching the duplicate is untouched', async () => {
    const bystander = await seedWatcher([`${RUN}-something-else`]);

    await transferWatchers(DUPLICATE, ORIGINAL);

    expect(await watchedBy(bystander)).toEqual([`${RUN}-something-else`]);
  });
});

describe('transfers that should do nothing', () => {
  test('no watchers means no work', async () => {
    expect(await transferWatchers(`${RUN}-nobody-watches`, ORIGINAL)).toBe(0);
  });

  test('merging a suggestion into itself is refused', async () => {
    // Guard against the degenerate case: an arrayRemove followed by an
    // arrayUnion of the SAME id would briefly unwatch everybody, and a failure
    // between the two would leave them unwatched permanently.
    const sub = await seedWatcher([DUPLICATE]);

    expect(await transferWatchers(DUPLICATE, DUPLICATE)).toBe(0);
    expect(await watchedBy(sub)).toEqual([DUPLICATE]);
  });

  test('a missing id is refused rather than guessed at', async () => {
    expect(await transferWatchers(null, ORIGINAL)).toBe(0);
    expect(await transferWatchers(DUPLICATE, null)).toBe(0);
    expect(await transferWatchers(undefined, undefined)).toBe(0);
  });
});
