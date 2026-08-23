/**
 * How often the walk reads the screen, and why it stopped reading it twice
 * for one tap (SHY-0447).
 *
 * Measured on the real OnePlus, 2026-08-23: one `uiautomator dump` costs
 * ~2280ms, and a J38 walk spent 164.5s of its 187s making 72 of them — 88% of
 * the run. iOS is 278ms for the same call, which is why the same journey takes
 * half as long there. It is not the sleeps; it is the looking.
 *
 * Of those 72, `tapId` made 16 and `tapResolved` made 22 — because `tapId`
 * dumps to FIND the control and then hands it to `tapResolved`, which dumps
 * AGAIN to re-resolve it. Nothing happens between those two calls. No tap, no
 * wait, no navigation: microseconds.
 *
 * The re-resolve exists for SHY-0441 — never tap a remembered coordinate,
 * because the screen may have moved since somebody looked. That reasoning is
 * about STALE information, and a tree taken a moment ago is not stale. So a
 * caller may hand over the tree it just took, and `tapResolved` uses it only
 * while it is still fresh — checked against when the tree was actually read,
 * not against the caller's word for it.
 */

const {
  tapResolved,
  dump,
  TREE_FRESH_MS,
  pollGap,
  POLL_FLOOR_MS,
  IOS_POLL_GAP_MS,
} = require('../../scripts/device-journey-runner');

const SEND_XML =
  '<hierarchy><node resource-id="support_send" class="android.widget.Button" ' +
  'text="Send" bounds="[40,300][380,380]" enabled="true" /></hierarchy>';

/** Counts how many times the walk asked the phone for the screen. */
function countingDevice() {
  return {
    kind: 'android',
    dumps: 0,
    taps: [],
    async dumpXml() {
      this.dumps += 1;
      return SEND_XML;
    },
    tap(x, y) {
      this.taps.push({ x, y });
    },
  };
}

describe('a tree knows when it was read', () => {
  test('dump stamps the tree it returns', async () => {
    const before = Date.now();
    const nodes = await dump(countingDevice());
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.takenAt).toBeGreaterThanOrEqual(before);
    expect(nodes.takenAt).toBeLessThanOrEqual(Date.now());
  });

  test('the freshness window is short enough to mean "nothing has happened"', () => {
    // It is not a cache. It exists to cover the microseconds between finding a
    // control and tapping it, so it must be far below the time any real
    // interaction takes.
    expect(TREE_FRESH_MS).toBeGreaterThan(0);
    expect(TREE_FRESH_MS).toBeLessThanOrEqual(1000);
  });
});

describe('tapResolved reads the screen once when it can', () => {
  test('on iOS a tree is never reused — it saves 278ms and costs correctness', async () => {
    const device = countingDevice();
    device.kind = 'ios';
    const nodes = await dump(device);
    await tapResolved(device, nodes[0], { label: '#support_send', nodes });
    expect(device.dumps).toBe(2);
  });

  test('a tree taken a moment ago is used, not re-read', async () => {
    const device = countingDevice();
    const nodes = await dump(device);
    expect(device.dumps).toBe(1);

    await tapResolved(device, nodes[0], { label: '#support_send', nodes });

    // THE POINT. Two dumps here is ~2.3 seconds of a phone doing nothing new.
    expect(device.dumps).toBe(1);
    expect(device.taps).toHaveLength(1);
  });

  test('a tree from before something happened is re-read', async () => {
    // The SHY-0441 guarantee, kept. Anything old enough that the screen could
    // have moved is not trusted, however confidently it is handed over.
    const device = countingDevice();
    const nodes = await dump(device);
    nodes.takenAt = Date.now() - (TREE_FRESH_MS + 500);

    await tapResolved(device, nodes[0], { label: '#support_send', nodes });

    expect(device.dumps).toBe(2);
  });

  test('an unstamped tree is never trusted', async () => {
    // A caller could hand over any array. Freshness is a fact about when the
    // phone was read, not a claim the caller gets to make.
    const device = countingDevice();
    const nodes = await dump(device);
    delete nodes.takenAt;

    await tapResolved(device, nodes[0], { label: '#support_send', nodes });

    expect(device.dumps).toBe(2);
  });

  test('with no tree offered it reads the screen, exactly as before', async () => {
    const device = countingDevice();
    const nodes = await dump(device);

    await tapResolved(device, nodes[0], '#support_send');

    expect(device.dumps).toBe(2);
  });

  test('a reused tree still gets the reachability check', async () => {
    // The saved dump must not cost the check it was taken for. A keyboard over
    // the control fails whether the tree was re-read or reused.
    const covered =
      '<hierarchy>' +
      '<node resource-id="support_send" class="android.widget.Button" text="Send" ' +
      'bounds="[40,300][380,380]" enabled="true" />' +
      '<node resource-id="" class="android.inputmethodservice.SoftInputWindow" ' +
      'bounds="[0,250][400,800]" enabled="true" />' +
      '</hierarchy>';
    const device = {
      kind: 'android',
      dumps: 0,
      taps: [],
      async dumpXml() {
        this.dumps += 1;
        return covered;
      },
      tap(x, y) {
        this.taps.push({ x, y });
      },
    };
    const nodes = await dump(device);
    const send = nodes.find((n) => n.id === 'support_send');

    await expect(tapResolved(device, send, { label: '#support_send', nodes })).rejects.toThrow(
      /cover|keyboard|reach/i,
    );
    expect(device.taps).toEqual([]);
  });
});

describe('the poll interval is a floor, not an addition', () => {
  // Every wait loop read the screen and THEN slept 700-800ms. On Android the
  // read alone is ~2280ms, so the sleep was 800ms of extra latency on top of a
  // phone that had already had two and a half seconds to settle. On iOS, where
  // a read is 278ms, it tripled the time to notice a control had appeared.
  //
  // The gap is now the time still owed to reach the floor, so a slow read pays
  // nothing and a fast one still leaves the device a breath between looks.

  const android = { kind: 'android' };

  test('a read slower than the floor waits no longer at all', async () => {
    const tickStarted = Date.now() - (POLL_FLOOR_MS + 900);
    const t = Date.now();
    await pollGap(tickStarted, android);
    expect(Date.now() - t).toBeLessThan(60);
  });

  test('a read faster than the floor is topped up to it', async () => {
    const tickStarted = Date.now();
    const t = Date.now();
    await pollGap(tickStarted, android);
    const waited = Date.now() - t;
    expect(waited).toBeGreaterThanOrEqual(POLL_FLOOR_MS - 25);
    expect(waited).toBeLessThan(POLL_FLOOR_MS + 250);
  });

  test('iOS keeps its old gap, because it never had the problem', async () => {
    // Android's read was 2332ms; iOS's is 278ms. Tightening the loop on iOS
    // bought almost nothing and cost twelve of thirteen journeys — the walk
    // arrived ahead of the UI on the platform that was already fast. The fix
    // is matched to the defect rather than applied everywhere.
    const t = Date.now();
    await pollGap(Date.now(), { kind: 'ios' });
    expect(Date.now() - t).toBeGreaterThanOrEqual(IOS_POLL_GAP_MS - 60);
  });

  test('the floor is low enough to notice a screen change promptly', () => {
    // The old 800ms was most of a second of not looking. This has to be well
    // under the time a person would call instant.
    expect(POLL_FLOOR_MS).toBeGreaterThan(0);
    expect(POLL_FLOOR_MS).toBeLessThanOrEqual(300);
  });
});
