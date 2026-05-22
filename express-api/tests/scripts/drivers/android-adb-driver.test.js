/**
 * android-adb-driver.js — driver-method unit tests
 *
 * Phase 4 of the journey-test framework build-out: per-method PRs
 * replace `false + log` stubs with real implementations. This file
 * is the test surface — each new method gets a describe block that
 * mocks `execSync` at module level and asserts the right `adb shell`
 * commands are issued + the right return value.
 *
 * Pattern (for future Phase 4 PRs to mirror):
 *   - jest.mock('child_process') with mockImplementation returning
 *     fixtures for `adb devices` + `cat /sdcard/dump.xml`
 *   - jest.useFakeTimers() so the driver's settle setTimeout(s) don't
 *     pay real wall-clock seconds (Round 1 review I-2 fix)
 *   - Build the driver via createAndroidDriver({ serial: 'emulator-5554' })
 *   - Call the new driver method (with jest.advanceTimersByTimeAsync
 *     if it awaits a settle delay)
 *   - Assert returned value + the exact `adb ... input tap X Y`
 *     coordinates were issued (centre of the dumped element)
 *
 * Tests run on Linux CI (no real device needed) — execSync is mocked
 * end-to-end, no spawn ever reaches the system shell.
 *
 * Mock fixture grounding: resource-ids in the mock XML use the SAME
 * Compose testTags that exist in
 *   shared/src/commonMain/kotlin/com/shyden/shytalk/feature/main/MainScreen.kt
 * (main_roomsTab / main_messagesTab / main_profileTab). A self-
 * referential mock (where the test fabricates an id that happens to
 * match whatever candidate the driver tries) proves nothing about
 * real-device behaviour. Round 1 review C-2 fix.
 */

jest.mock('child_process');

const { execSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const { createAndroidDriver } = require(
  path.join(REPO_ROOT, 'express-api/scripts/drivers/android-adb-driver'),
);

/**
 * Build a mock execSync responder driven by a cmd-substring → output
 * map. Each `pattern` is matched against the full shell-quoted
 * command string `adb()` produces ('adb' '-s' '<serial>' 'shell' '...').
 */
function mockExec(responses = {}) {
  execSync.mockImplementation((cmd) => {
    if (cmd === 'adb devices') {
      return responses['adb devices'] || 'List of devices attached\nemulator-5554\tdevice\n';
    }
    for (const [pattern, output] of Object.entries(responses)) {
      if (pattern === 'adb devices') continue;
      if (cmd.includes(pattern)) return output;
    }
    return '';
  });
}

/**
 * Helper: build a dump-XML response with one node carrying the
 * given resource-id + bounds. Defaults to the package-qualified
 * form Android Compose UIs produce.
 */
function dumpWithId(resourceId, bounds = '[0,1900][270,2100]') {
  return `<node resource-id="com.shyden.shytalk.local:id/${resourceId}" bounds="${bounds}" />`;
}

describe('android-adb-driver — androidNavigatesBackToTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Round 1 review I-2: fake timers so the driver's 500ms settle
    // doesn't pay real wall-clock time. With 4 success-path tests
    // each waiting 500ms, real timers would add 2 seconds per run —
    // compounds badly across the ~29 remaining Phase 4 PRs.
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Round 1 review C-1 + C-2: tests grounded to the REAL Compose
  // testTags in MainScreen.kt — main_roomsTab, main_messagesTab,
  // main_profileTab. These are the only three real tabs the matcher
  // would ever be called with via Wake 100.
  test('rooms tab — matches real main_roomsTab testTag', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_roomsTab', '[0,1900][270,2100]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidNavigatesBackToTab('Adam', 'rooms');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    // Centre of [0,1900][270,2100] = (135, 2000).
    expect(tapCall[0]).toContain("'135'");
    expect(tapCall[0]).toContain("'2000'");
  });

  test('messages tab — matches real main_messagesTab testTag', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_messagesTab', '[300,1900][600,2100]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidNavigatesBackToTab('Adam', 'messages');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'450'");
    expect(tapCall[0]).toContain("'2000'");
  });

  test('profile tab — matches real main_profileTab testTag', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_profileTab', '[600,1900][900,2100]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidNavigatesBackToTab('Adam', 'profile');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'750'");
    expect(tapCall[0]).toContain("'2000'");
  });

  test('case-insensitive — "Rooms" still resolves main_roomsTab', async () => {
    // The matcher's regex captures the literal tab name from the
    // feature file, which is conventionally lowercase but should
    // tolerate accidental capitalisation in scenarios.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_roomsTab'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidNavigatesBackToTab('Adam', 'Rooms');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
  });

  test('falls through to the bare-name candidate when main_<name>Tab has no match', async () => {
    // Future surfaces (non-main-nav, e.g. settings sub-tabs) may
    // use bare lowercased testTags. The driver tries main_<name>Tab
    // first; on no-match, tries bare name, etc.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('settings', '[100,500][400,700]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidNavigatesBackToTab('Adam', 'settings');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    // Centre of [100,500][400,700] = (250, 600).
    expect(tapCall[0]).toContain("'250'");
    expect(tapCall[0]).toContain("'600'");
    // Round 2 M-1: explicitly assert the fallthrough mechanic — 2
    // dump calls = 1 for the first-tried `main_settingsTab` (regex
    // miss) + 1 for the bare `settings` candidate (hit). Documents
    // intent so a future short-circuit refactor is caught.
    const dumpCalls = execSync.mock.calls.filter((c) => c[0].includes("'uiautomator' 'dump'"));
    expect(dumpCalls.length).toBe(2);
  });

  test('returns false when no candidate matches', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('unrelated_tag'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidNavigatesBackToTab('Adam', 'nonexistent');

    expect(ok).toBe(false);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeUndefined();
    // Round 2 M-2: the driver must try ALL 4 candidates before
    // giving up — main_nonexistentTab, nonexistent, tab_nonexistent,
    // bottomNav_nonexistent. Each candidate triggers one
    // androidUiDump (which is `uiautomator dump` + `cat`). 4 candidates
    // × 2 commands each = 8 calls per command type. Counting dump calls
    // catches a future short-circuit refactor that bails after 1 or 2
    // candidates.
    const dumpCalls = execSync.mock.calls.filter((c) => c[0].includes("'uiautomator' 'dump'"));
    expect(dumpCalls.length).toBe(4);
  });

  test('ignores the first arg (persona name) — same dump + different persona yields same result', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_roomsTab', '[0,1900][270,2100]'),
    });
    const driver = await createAndroidDriver();
    const pA = driver.androidNavigatesBackToTab('Adam', 'rooms');
    await jest.advanceTimersByTimeAsync(500);
    const okA = await pA;

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_roomsTab', '[0,1900][270,2100]'),
    });
    const driver2 = await createAndroidDriver();
    const pB = driver2.androidNavigatesBackToTab('Bea', 'rooms');
    await jest.advanceTimersByTimeAsync(500);
    const okB = await pB;

    expect(okA).toBe(true);
    expect(okB).toBe(true);
  });
});

describe('android-adb-driver — androidOpensTab', () => {
  // Wake 92 matcher (manual-qa-runner.js ~line 10755):
  //   `<Name> [P-NN] (cohort) opens the <X> tab on Android`
  // calls driver.androidOpensTab(name, tab). Mechanically identical
  // to Wake 100's androidNavigatesBackToTab — both tap the bottom-
  // nav tab with the given name. Kept as separate methods so
  // semantically-divergent behaviour (e.g. "open" might one day
  // launch a full screen, while "navigate back" stays a pure tab
  // tap) can land on the right method without API churn.
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('rooms tab — taps main_roomsTab via the shared main-nav helper', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_roomsTab', '[0,1900][270,2100]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidOpensTab('Marcus', 'rooms');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'135'");
    expect(tapCall[0]).toContain("'2000'");
  });

  test('home tab — case-insensitive lookup falls through to bare-name candidate', async () => {
    // The j17-teacher-classroom.feature scenario uses tab name "home",
    // which doesn't exist in MainScreen.kt (no main_homeTab). Driver
    // falls through to the bare-name candidate `home`. If the app ever
    // gains a Home tab with testTag `home` (not `main_homeTab`), this
    // test stays green.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('home', '[100,500][400,700]'),
    });
    const driver = await createAndroidDriver();
    const promise = driver.androidOpensTab('Marcus', 'home');
    await jest.advanceTimersByTimeAsync(500);
    const ok = await promise;

    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'250'");
    expect(tapCall[0]).toContain("'600'");
    // Same candidate iteration as androidNavigatesBackToTab — pinning
    // count enforces both methods stay on the shared helper.
    const dumpCalls = execSync.mock.calls.filter((c) => c[0].includes("'uiautomator' 'dump'"));
    expect(dumpCalls.length).toBe(2);
  });

  test('returns false when no candidate matches', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('unrelated_tag'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidOpensTab('Marcus', 'nonexistent');

    expect(ok).toBe(false);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeUndefined();
    // Round 1 I-1: same 4-candidate-exhaustion pin as the
    // androidNavigatesBackToTab no-match test. Catches a future
    // short-circuit refactor that bails after 1 or 2 candidates
    // on androidOpensTab specifically (the shared helper's
    // exhaustion is observable from both call sites).
    const dumpCalls = execSync.mock.calls.filter((c) => c[0].includes("'uiautomator' 'dump'"));
    expect(dumpCalls.length).toBe(4);
  });

  test('shared logic with androidNavigatesBackToTab — same dump, same tap centre', async () => {
    // Given identical dump XML and tab name, both methods produce
    // identical tap coordinates. Structural delegation (both call
    // the private `tapMainNavTab` helper) is verified by code
    // review — the helper is a private closure inaccessible to
    // external duplication. Round 1 I-2: prior comment overclaimed
    // this test "locks the share-an-implementation invariant" — it
    // doesn't (a copy-paste duplication would still pass). The
    // structural lock is the helper being private.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_messagesTab', '[300,1900][600,2100]'),
    });
    const driver = await createAndroidDriver();
    const pOpen = driver.androidOpensTab('Marcus', 'messages');
    await jest.advanceTimersByTimeAsync(500);
    const openOk = await pOpen;
    const openTap = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_messagesTab', '[300,1900][600,2100]'),
    });
    const driver2 = await createAndroidDriver();
    const pNav = driver2.androidNavigatesBackToTab('Marcus', 'messages');
    await jest.advanceTimersByTimeAsync(500);
    const navOk = await pNav;
    const navTap = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));

    expect(openOk).toBe(true);
    expect(navOk).toBe(true);
    // Same tap coordinates: centre of [300,1900][600,2100] = (450, 2000).
    expect(openTap[0]).toContain("'450'");
    expect(openTap[0]).toContain("'2000'");
    expect(navTap[0]).toContain("'450'");
    expect(navTap[0]).toContain("'2000'");
  });
});

describe('android-adb-driver — androidShowsBanner', () => {
  // Wake 97 matcher (manual-qa-runner.js ~line 11646):
  //   `<Name>'s Android UI shows a "<X>" banner`
  // The matcher passes (name, bannerText) — driver returns true
  // if the UI dump contains the banner text as either a text=
  // or content-desc= attribute value (substring match, with
  // negative-lookbehind guarding against attribute-name suffix
  // false-positives like hint-text=). Banners persist on-screen
  // until dismissed, so a dump scan is sufficient.
  //
  // Round 1 review M-3: no fake-timer setup here — the
  // implementation has no setTimeout. Keeps the describe block
  // simpler and signals that not every Phase 4 method needs the
  // tab-tap pattern's settle delay.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns true when banner text appears in a text= attribute', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node text="Connection lost — retrying" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'Connection lost');

    expect(ok).toBe(true);
  });

  test('returns true when banner text appears in a content-desc= attribute', async () => {
    // Icon-only banners often carry the message in content-desc
    // (for screen-reader accessibility) rather than text.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node content-desc="You are offline" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'offline');

    expect(ok).toBe(true);
  });

  test('substring match — banner phrase matches within a longer text', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node text="Warning: your room will close in 5 minutes" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'room will close');

    expect(ok).toBe(true);
  });

  test('returns false when banner text is absent', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="Welcome to ShyTalk" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'Connection lost');

    expect(ok).toBe(false);
  });

  test('returns false when the UI dump fails (empty)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'anything');

    expect(ok).toBe(false);
  });

  test('regex-special characters in banner text are escaped correctly', async () => {
    // A banner containing characters that would have regex meaning
    // (parentheses, brackets, dots, asterisks) must still match
    // literally. Without escaping, "Loading (1/3)..." would fail
    // because `(`, `)`, `.` are regex metachars.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node text="Loading (1/3)... please wait" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'Loading (1/3)...');

    expect(ok).toBe(true);
  });

  test('attribute-suffix guard — error-text= does NOT match (sibling of hint-text=)', async () => {
    // Round 2 M-2: pin the lookbehind for the other false-positive-
    // prone attribute names mentioned in the comment. error-text=
    // is realistic: many EditText/TextInputLayout components emit
    // their validation error in this attribute.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node error-text="Network down" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'Network down');

    expect(ok).toBe(false);
  });

  test('attribute-suffix guard — sub-text= does NOT match (sibling of hint-text=)', async () => {
    // Round 2 M-2: third lookbehind regression case named in the
    // implementation comment.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node sub-text="Tap to retry" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'Tap to retry');

    expect(ok).toBe(false);
  });

  test('whitespace-only banner returns false (M-1: defence-in-depth)', async () => {
    // Round 2 M-1: defensive guard against scenario authoring bugs
    // that produce a non-empty but whitespace-only banner string.
    // The runner regex `[^"]+` prevents this from reaching the
    // driver via valid Gherkin, but defending in depth keeps the
    // contract clear if a future matcher relaxes its capture group.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="A short message" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', '   ');

    expect(ok).toBe(false);
  });

  test('attribute-suffix false-positive guarded — hint-text= does NOT match', async () => {
    // Round 1 review I-2: without the (?<![\w-]) negative lookbehind,
    // the regex would match `t-text="Connection lost"` inside
    // `hint-text="Connection lost"` because the `text` alternation
    // would match the trailing `text` of `hint-text`. The lookbehind
    // rejects the match — only top-level `text=` or `content-desc=`
    // attribute names count. Other false-positive-prone attribute
    // names in Android XML: sub-text, placeholder-text, error-text.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node hint-text="Connection lost" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', 'Connection lost');

    expect(ok).toBe(false);
  });

  test('empty banner string returns false (not "match any node with text=")', async () => {
    // Round 1 review M-2: a scenario asking for `""` banner is an
    // authoring bug. The prior implementation matched ANY node with
    // a text= or content-desc= attribute, silently returning true and
    // masking the scenario error. Explicit early-return guards this.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="Welcome to ShyTalk" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidShowsBanner('Adam', '');

    expect(ok).toBe(false);
    // Round 2 P-1: short-circuit verification — empty banner returns
    // BEFORE the UI dump is fetched. Pinning this means a future
    // refactor that accidentally moves the guard after the dump
    // (paying the adb round-trip cost on an empty-banner scenario
    // authoring bug) is caught.
    const dumpCalls = execSync.mock.calls.filter((c) => c[0].includes("'uiautomator' 'dump'"));
    expect(dumpCalls.length).toBe(0);
  });

  test('persona name is ignored — same banner + different persona yields same result', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="Connection lost" bounds="[0,100][1080,200]" />',
    });
    const driver = await createAndroidDriver();
    const okA = await driver.androidShowsBanner('Adam', 'Connection lost');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="Connection lost" bounds="[0,100][1080,200]" />',
    });
    const driver2 = await createAndroidDriver();
    const okB = await driver2.androidShowsBanner('Bea', 'Connection lost');

    expect(okA).toBe(true);
    expect(okB).toBe(true);
  });
});

describe('android-adb-driver — androidIsStillInRoom', () => {
  // Wake 84 matcher (manual-qa-runner.js ~line 9433):
  //   `<Name>'s Android UI is still in the room`
  // Returns true if any of the room-screen markers appears in the
  // UI dump. Markers grounded to real Compose testTags:
  //   shared/.../feature/room/RoomScreen.kt:718 (room_seatGrid)
  //   shared/.../feature/room/components/RoomToolbar.kt:60 (room_roomName)
  //   shared/.../feature/room/components/RoomToolbar.kt:84 (room_backButton)
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('room_seatGrid present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" bounds="[0,200][1080,1200]" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsStillInRoom('Adam')).toBe(true);
  });

  test('room_roomName present → true (toolbar marker)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_roomName" bounds="[100,50][800,150]" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsStillInRoom('Adam')).toBe(true);
  });

  test('room_backButton present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_backButton" bounds="[0,50][100,150]" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsStillInRoom('Adam')).toBe(true);
  });

  test('returns false when none of the room markers are present', async () => {
    // User left the room — dump shows home-screen markers (roomList_emptyState
    // from HomeScreen.kt) instead of room ones.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomList_emptyState" bounds="[0,200][1080,1200]" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsStillInRoom('Adam')).toBe(false);
  });

  test('returns false when UI dump is empty (driver failure)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsStillInRoom('Adam')).toBe(false);
  });

  test('substring false-positive guarded — partial-match in unrelated id does NOT match', async () => {
    // Both regex boundaries enforced:
    //   LEFT: the pattern starts with literal `resource-id="` then
    //     either `[^"]*:id/` or empty. With empty, the marker must
    //     be at attribute-start (right after `="`).
    //   RIGHT: literal `"` follows the marker. `_other"` between
    //     marker and `"` breaks the match.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="something_room_seatGrid_other" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsStillInRoom('Adam')).toBe(false);
  });

  test('left-prefix-only false positive — "unrelated_room_seatGrid" does NOT match (Round 1 I-1)', async () => {
    // Marker at attribute-end (right-quote boundary holds) but with
    // a leading prefix and no :id/. The optional `[^"]*:id/` group
    // can't consume `unrelated_` (no `:id/` to consume against), so
    // it matches empty and the marker is required at attribute-start
    // — but the attribute starts with `unrelated_`. Mismatch.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="unrelated_room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsStillInRoom('Adam')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true (Round 1 M-1)', async () => {
    // Some emulator dumps emit `resource-id="room_seatGrid"` without
    // the `com.shyden.shytalk.local:id/` package prefix (older
    // uiautomator or non-standard build variants). The optional
    // `[^"]*:id/` group's empty alternative handles this — pin the
    // empty-branch behaviour with this test.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="room_seatGrid" bounds="[0,0][100,100]" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsStillInRoom('Adam')).toBe(true);
  });

  test('persona name is ignored — same dump, different persona yields same result', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    const okA = await driver.androidIsStillInRoom('Adam');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver2 = await createAndroidDriver();
    const okB = await driver2.androidIsStillInRoom('Bea');

    expect(okA).toBe(true);
    expect(okB).toBe(true);
  });
});

describe('android-adb-driver — androidIsNoLongerInVoiceRoom', () => {
  // Wake 105 matcher (manual-qa-runner.js ~line 12893):
  //   `<Name>'s Android UI is no longer in the voice room`
  // Returns true if NONE of the room-screen markers appears in the
  // dump. Critically: empty dump returns FALSE (not true) — can't
  // confirm the user has left without evidence.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('no room markers in dump → true (user has left)', async () => {
    // Dump shows home-screen markers, no room.kt markers.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomList_emptyState" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsNoLongerInVoiceRoom('Adam')).toBe(true);
  });

  test('room_seatGrid present → false (still in room)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsNoLongerInVoiceRoom('Adam')).toBe(false);
  });

  test('room_roomName present → false (still in room)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_roomName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsNoLongerInVoiceRoom('Adam')).toBe(false);
  });

  test('room_backButton present → false (still in room) — Round 1 I-1', async () => {
    // Round 1 I-1: independently pin all three markers from the
    // androidIsNoLongerInVoiceRoom side. Without this, a future
    // refactor that drops room_backButton from the shared marker
    // list would only fail androidIsStillInRoom's tests, not this
    // method's — leaving the negative-assertion contract incomplete.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_backButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsNoLongerInVoiceRoom('Adam')).toBe(false);
  });

  test('empty dump → false (CANNOT CONFIRM — defends against false positives)', async () => {
    // An empty dump (driver dump failure or transient state) is
    // ambiguous — the user could be anywhere. The safe answer for
    // 'no longer in room' is FALSE: we cannot confirm departure.
    // This pairs with androidIsStillInRoom also returning false on
    // empty dump — both methods err on the side of "can't confirm".
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsNoLongerInVoiceRoom('Adam')).toBe(false);
  });

  test('paired with androidIsStillInRoom — both false on empty dump (not opposites)', async () => {
    // Both methods return FALSE when the dump is empty. This is
    // intentional — the answer to both 'still in room' and 'no
    // longer in room' is 'unknown' rather than asymmetric default.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidIsStillInRoom('Adam')).toBe(false);
    expect(await driver.androidIsNoLongerInVoiceRoom('Adam')).toBe(false);
  });

  test('paired with androidIsStillInRoom — opposite values on populated dump', async () => {
    // On a non-empty dump, the two methods MUST return opposite
    // values via the shared isInRoomScreen helper.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    const stillIn = await driver.androidIsStillInRoom('Adam');
    const noLonger = await driver.androidIsNoLongerInVoiceRoom('Adam');
    expect(stillIn).toBe(true);
    expect(noLonger).toBe(false);
  });

  test('persona name is ignored — same dump, different persona yields same result', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomList_emptyState" />',
    });
    const driver = await createAndroidDriver();
    const okA = await driver.androidIsNoLongerInVoiceRoom('Adam');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomList_emptyState" />',
    });
    const driver2 = await createAndroidDriver();
    const okB = await driver2.androidIsNoLongerInVoiceRoom('Bea');

    expect(okA).toBe(true);
    expect(okB).toBe(true);
  });
});

describe('android-adb-driver — androidNavigatesToWarningScreen', () => {
  // Wake 101 matcher (manual-qa-runner.js ~line 12240):
  //   `<Name>'s Android UI navigates to the warning screen`
  // Returns true if any of the WarningScreen.kt testTags is in
  // the UI dump. Grounded markers:
  //   warning_title (WarningScreen.kt:82)
  //   warning_communityStandardsLink (WarningScreen.kt:112)
  //   warning_acknowledgeButton (WarningScreen.kt:123)
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('warning_title present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToWarningScreen('Adam')).toBe(true);
  });

  test('warning_communityStandardsLink present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_communityStandardsLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToWarningScreen('Adam')).toBe(true);
  });

  test('warning_acknowledgeButton present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_acknowledgeButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToWarningScreen('Adam')).toBe(true);
  });

  test('no warning markers → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToWarningScreen('Adam')).toBe(false);
  });

  test('empty dump → false (cannot confirm)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToWarningScreen('Adam')).toBe(false);
  });

  test('substring false-positive guarded — pre_warning_title does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_warning_title_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToWarningScreen('Adam')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="warning_title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToWarningScreen('Adam')).toBe(true);
  });

  test('persona name is ignored — same dump, different persona yields same result', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver = await createAndroidDriver();
    const okA = await driver.androidNavigatesToWarningScreen('Adam');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver2 = await createAndroidDriver();
    const okB = await driver2.androidNavigatesToWarningScreen('Bea');

    expect(okA).toBe(true);
    expect(okB).toBe(true);
  });
});

describe('android-adb-driver — androidShowsWarningScreenOnRelaunch', () => {
  // Wake 101 (second variant, manual-qa-runner.js ~line 12268):
  //   `<Name>'s Android UI shows the warning screen again on next launch`
  // Semantically distinct from androidNavigatesToWarningScreen
  // (this is post-relaunch persistence) but mechanically identical:
  // assert the warning screen is currently visible. Both methods
  // share the same WARNING_MARKERS via isOnWarningScreen.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('warning_title present → true (after relaunch)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenOnRelaunch('Adam')).toBe(true);
  });

  test('warning_acknowledgeButton present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_acknowledgeButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenOnRelaunch('Adam')).toBe(true);
  });

  // Round 1 I-1: independently pin the third WARNING_MARKER from this
  // method's perspective. Symmetric with the Wake 101 first-variant
  // suite (PR #728) which tests all three.
  test('warning_communityStandardsLink present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_communityStandardsLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenOnRelaunch('Adam')).toBe(true);
  });

  test('no warning markers → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenOnRelaunch('Adam')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenOnRelaunch('Adam')).toBe(false);
  });

  // Round 1 I-2: bare resource-id (no package prefix) coverage from
  // this method's perspective — symmetric with the first Wake 101
  // variant's suite.
  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="warning_title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenOnRelaunch('Adam')).toBe(true);
  });

  // Round 1 I-3: right-boundary false-positive guard — `pre_warning_title_x`
  // has the marker as a substring but with both left and right
  // padding. The regex correctly rejects.
  test('substring false-positive guarded — pre_warning_title_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_warning_title_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenOnRelaunch('Adam')).toBe(false);
  });

  // Round 1 P-1: persona name invariance — symmetric with every
  // other method's suite in this file.
  test('persona name is ignored — same dump, different persona yields same result', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver = await createAndroidDriver();
    const okA = await driver.androidShowsWarningScreenOnRelaunch('Adam');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver2 = await createAndroidDriver();
    const okB = await driver2.androidShowsWarningScreenOnRelaunch('Bea');

    expect(okA).toBe(true);
    expect(okB).toBe(true);
  });

  test('paired with androidNavigatesToWarningScreen — same dump yields same result', async () => {
    // Both methods route through isOnWarningScreen via the shared
    // dumpHasAnyMarker helper. Locks the invariant that they remain
    // synchronised — a future divergence in one without the other
    // would be a contract violation.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver = await createAndroidDriver();
    const navigates = await driver.androidNavigatesToWarningScreen('Adam');
    const relaunch = await driver.androidShowsWarningScreenOnRelaunch('Adam');
    expect(navigates).toBe(true);
    expect(relaunch).toBe(true);
  });
});

describe('android-adb-driver — androidShowsWarningScreenWithReason', () => {
  // Wake 102 matcher (manual-qa-runner.js ~line 12542):
  //   `<Name>'s Android UI shows the warning screen with reason "<X>"`
  // Two-step assertion: (1) warning screen is visible, (2) reason
  // text appears in a text= or content-desc= attribute. Both must
  // hold.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('warning screen + reason text both present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />' +
        '<node text="You sent offensive messages" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenWithReason('Adam', 'offensive messages')).toBe(
      true,
    );
  });

  test('reason in content-desc= attribute → true (accessibility-only message)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />' +
        '<node content-desc="Account suspended for harassment" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidShowsWarningScreenWithReason('Adam', 'suspended for harassment'),
    ).toBe(true);
  });

  test('reason text present but no warning screen → false (gate fails)', async () => {
    // The reason text appears in a non-warning UI (e.g. home toast).
    // Both conditions must hold; reason alone is insufficient.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />' +
        '<node text="You sent offensive messages" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenWithReason('Adam', 'offensive messages')).toBe(
      false,
    );
  });

  test('warning screen present but no reason text → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />' +
        '<node text="Generic warning text" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenWithReason('Adam', 'specific reason')).toBe(false);
  });

  test('empty reason string → false + no dump call (short-circuit)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenWithReason('Adam', '')).toBe(false);
    // Round 1 I-1: pin the short-circuit invariant. Empty reason
    // must return false BEFORE the adb dump round-trip — saves a
    // call that can't change the answer. Matches the equivalent
    // pin on androidShowsBanner.
    const dumpCalls = execSync.mock.calls.filter((c) => c[0].includes("'uiautomator' 'dump'"));
    expect(dumpCalls.length).toBe(0);
  });

  test('whitespace-only reason string → false + no dump call (short-circuit)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenWithReason('Adam', '   ')).toBe(false);
    // Round 1 I-1: same short-circuit pin for whitespace-only.
    const dumpCalls = execSync.mock.calls.filter((c) => c[0].includes("'uiautomator' 'dump'"));
    expect(dumpCalls.length).toBe(0);
  });

  test('empty dump → false (cannot confirm either condition)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenWithReason('Adam', 'anything')).toBe(false);
  });

  test('regex-special characters in reason text escaped correctly', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />' +
        '<node text="Severity (1/3) — temporary ban" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenWithReason('Adam', 'Severity (1/3)')).toBe(true);
  });

  test('attribute-suffix false-positive guarded — hint-text= does NOT match the reason', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />' +
        '<node hint-text="You sent offensive messages" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWarningScreenWithReason('Adam', 'offensive messages')).toBe(
      false,
    );
  });

  test('persona name ignored — same dump, different persona yields same result', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />' +
        '<node text="You sent offensive messages" />',
    });
    const driver = await createAndroidDriver();
    const okA = await driver.androidShowsWarningScreenWithReason('Adam', 'offensive messages');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />' +
        '<node text="You sent offensive messages" />',
    });
    const driver2 = await createAndroidDriver();
    const okB = await driver2.androidShowsWarningScreenWithReason('Bea', 'offensive messages');

    expect(okA).toBe(true);
    expect(okB).toBe(true);
  });
});

describe('android-adb-driver — androidNavigatesToProfileScreen', () => {
  // Wake 96 matcher — `<Name>'s Android UI navigates to the profile screen`.
  // Presence assertion via 4 real ProfileScreen.kt testTags:
  //   profile_displayName (507, 992), profile_walletButton (1146),
  //   profile_followButton (1179, 1188), profile_messageButton (1198).
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('profile_displayName present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToProfileScreen('Adam')).toBe(true);
  });

  test('profile_walletButton present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_walletButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToProfileScreen('Adam')).toBe(true);
  });

  test('profile_followButton present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToProfileScreen('Adam')).toBe(true);
  });

  test('profile_messageButton present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_messageButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToProfileScreen('Adam')).toBe(true);
  });

  test('no profile markers → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToProfileScreen('Adam')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToProfileScreen('Adam')).toBe(false);
  });

  test('substring false-positive guarded — pre_profile_displayName_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_profile_displayName_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToProfileScreen('Adam')).toBe(false);
  });

  test('right-boundary false-positive guarded — profile_displayName_extra does NOT match', async () => {
    // Round 1 minor: isolate the right-side padding case from the
    // both-sides case above. Pins that the closing-quote anchor
    // alone (no left-prefix help) correctly rejects suffix-padded
    // tags. Important because the optional `[^"]*:id/` group's
    // package-qualified form is exercised here too.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToProfileScreen('Adam')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToProfileScreen('Adam')).toBe(true);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    const okA = await driver.androidNavigatesToProfileScreen('Adam');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver2 = await createAndroidDriver();
    const okB = await driver2.androidNavigatesToProfileScreen('Bea');

    expect(okA).toBe(true);
    expect(okB).toBe(true);
  });
});

describe('android-adb-driver — androidNavigatesToRoomScreen', () => {
  // Wake 99 matcher — `<Name>'s Android UI navigates to the room
  // screen <suffix>`. j09 — 2 corpus rows with descriptive suffixes:
  //   - "with host seat occupied"
  //   - "as a non-seated participant"
  // The suffix is scenario-reader metadata, NOT UI text — substring-
  // matching it into the dump would always fail (it never appears in
  // text=/content-desc= attributes). Driver asserts ROOM_MARKERS
  // presence only; suffix is accepted-and-ignored. Same 3 markers as
  // androidIsStillInRoom: room_seatGrid (RoomScreen.kt:718),
  // room_roomName (RoomToolbar.kt:60), room_backButton
  // (RoomToolbar.kt:84).
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('room_seatGrid present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Theo', 'with host seat occupied')).toBe(true);
  });

  test('room_roomName present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_roomName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Theo', 'with host seat occupied')).toBe(true);
  });

  test('room_backButton present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_backButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Theo', 'with host seat occupied')).toBe(true);
  });

  test('no room markers → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Theo', 'with host seat occupied')).toBe(
      false,
    );
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Theo', 'with host seat occupied')).toBe(
      false,
    );
  });

  test('left-boundary false-positive guarded — pre_room_seatGrid_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_room_seatGrid_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Theo', 'with host seat occupied')).toBe(
      false,
    );
  });

  test('right-boundary false-positive guarded — room_seatGrid_extra does NOT match', async () => {
    // Pins that the closing-quote anchor alone (no left-prefix help)
    // correctly rejects suffix-padded tags. Package-qualified form is
    // exercised here too — the `[^"]*:id/` optional group must not
    // swallow the boundary.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Theo', 'with host seat occupied')).toBe(
      false,
    );
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Theo', 'with host seat occupied')).toBe(true);
  });

  test('non-seated-participant suffix also accepted with same marker', async () => {
    // Pins that the suffix is ignored for assertion purposes — both
    // j09 corpus suffixes return identical results given the same
    // dump. If a future PR adds suffix-aware refinement (e.g. assert
    // host seat is occupied only when suffix says so), this test will
    // need updating to reflect the new contract.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Alice', 'as a non-seated participant')).toBe(
      true,
    );
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    const okTheo = await driver.androidNavigatesToRoomScreen('Theo', 'with host seat occupied');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidNavigatesToRoomScreen('Alice', 'with host seat occupied');

    expect(okTheo).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('empty suffix tolerated — does not throw, marker-only assertion holds', async () => {
    // Defensive: even though the runner regex requires a non-empty
    // suffix (`(.+)$`), pin that an accidentally-empty suffix doesn't
    // crash the driver. Matches the foundation policy that the suffix
    // is ignored for assertion.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Theo', '')).toBe(true);
  });

  test('package-qualified left-boundary guarded — :id/pre_room_seatGrid does NOT match', async () => {
    // Round 1 I-2: the bare-form left-boundary case is pinned above
    // (`pre_room_seatGrid_x`). This pins the package-qualified
    // analogue — `com.shyden.shytalk.local:id/pre_room_seatGrid` —
    // which exercises a different code path through the regex: the
    // optional `(?:[^"]*:id/)?` group consumes the package prefix
    // up through `:id/`, leaving `pre_room_seatGrid` to be matched
    // against the marker literal `room_seatGrid`. That match must
    // fail (it does — the marker is not a prefix-substring match;
    // it must be the FIRST chars after `:id/`).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Theo', 'with host seat occupied')).toBe(
      false,
    );
  });

  test('uiautomator dump throws → false (not undefined)', async () => {
    // Round 1 I-1: `androidUiDump` wraps the `uiautomator dump` and
    // `cat /sdcard/dump.xml` adb shell calls in a try/catch that
    // returns `''` on rejection. The driver method's `if (!dump)
    // return false` guard then fires. Without this test, if the
    // catch is ever refactored to re-throw or to return null, the
    // method silently returns `undefined` — and `executeStep` would
    // treat that as falsy-truthy ambiguously. Pin the contract:
    // a thrown adb call still yields a clean `false`.
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToRoomScreen('Theo', 'with host seat occupied')).toBe(
      false,
    );
  });
});

describe('android-adb-driver — androidContinuesNormallyInRoom', () => {
  // Wake 105 matcher — `<Name>'s Android UI continues normally in the
  // room` (j10). Semantically: actor is unaffected by a mid-room
  // moderation event — still in the room AND not pulled into a warning
  // screen. Composes two existing predicates from prior PRs:
  //   - isInRoomScreen  (ROOM_MARKERS present)
  //   - isOnWarningScreen (WARNING_MARKERS present)  → must be FALSE
  //
  // The third logical axis ("input disabled / frozen overlay while in
  // room") has no Compose testTag yet — verified via grep over
  // shared/src and app/src. Only `privateChat_frozenBanner` exists,
  // and that's the messaging surface, not the voice room. Foundation
  // policy: assert in-room AND not-on-warning only; layer the
  // frozen/disabled axis once a testTag for it lands.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('room_seatGrid present, no warning markers → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(true);
  });

  test('room_roomName present, no warning markers → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_roomName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(true);
  });

  test('room_backButton present, no warning markers → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_backButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(true);
  });

  test('not in room screen (only main_roomsTab visible) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(false);
  });

  test('on warning screen instead of room → false', async () => {
    // Post-eject typical state: user is no longer in the room because
    // the warning screen replaced the back-stack entry. ROOM_MARKERS
    // are absent, WARNING_MARKERS are present. Both predicates push
    // toward false.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(false);
  });

  test('room markers present AND warning markers present → false (warning wins)', async () => {
    // Rare but possible: a warning sheet drawn OVER the still-mounted
    // room. The user is NOT continuing normally — the warning blocks
    // interaction. Pin the precedence: warning beats room.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node resource-id="com.shyden.shytalk.local:id/warning_acknowledgeButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(true);
  });

  test('left-boundary false-positive guarded — pre_room_seatGrid_x does NOT count as in-room', async () => {
    // Same anti-substring discipline as the room-screen PRs. Confirms
    // the room-side of the composed predicate doesn't false-positive
    // on padded resource-ids.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_room_seatGrid_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(false);
  });

  test('right-boundary false-positive guarded — room_seatGrid_extra does NOT count as in-room', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver = await createAndroidDriver();
    const okTheo = await driver.androidContinuesNormallyInRoom('Theo');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidContinuesNormallyInRoom('Alice');

    expect(okTheo).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('uiautomator dump throws → false (not undefined)', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(false);
  });

  test('warning_communityStandardsLink alone (no room) → false', async () => {
    // The 3 WARNING_MARKERS are exercised individually elsewhere
    // (NavigatesToWarningScreen suite) but pinning a non-title
    // warning marker here too defends against future refactors that
    // might tighten the warning predicate to require warning_title
    // specifically. The "any of the warning markers" contract must
    // hold for the composed predicate.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_communityStandardsLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(false);
  });

  test('warning_title + room_seatGrid overlap → false (precedence pin for warning_title)', async () => {
    // Round 1 I-2 fix: the original "both present" overlap test pinned
    // the warning-beats-room precedence using warning_acknowledgeButton.
    // This pins the same precedence for warning_title — proving the
    // "any of the warning markers wins" contract on the OVERLAP branch
    // (not just the no-room branch the warning_title-alone test
    // exercises). Without this, a future refactor that special-cases
    // warning_title detection could silently break precedence for it
    // alone, and the existing tests would still pass.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(false);
  });

  test('warning_communityStandardsLink + room_seatGrid overlap → false (precedence pin)', async () => {
    // Round 1 I-2 fix: completes the WARNING_MARKERS × overlap-branch
    // coverage matrix. With this and the warning_title+room and
    // warning_acknowledgeButton+room cases, all 3 warning markers are
    // pinned in the overlap branch. No warning marker should ever lose
    // precedence to the room markers.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node resource-id="com.shyden.shytalk.local:id/warning_communityStandardsLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(false);
  });

  test('warning-side left-boundary under composition — pre_warning_title_x near room_seatGrid → true', async () => {
    // Round 1 I-1 fix: the room-side left boundary
    // (`pre_room_seatGrid_x`) was already pinned. This pins the
    // analogous warning-side boundary IN THE COMPOSED CONTEXT —
    // a padded warning ID (`pre_warning_title_x`) must NOT be
    // detected by isOnWarningScreen, leaving the room assertion
    // free to carry the result to true. Confirms the
    // dumpHasAnyMarker boundary rule holds for the WARNING marker
    // set under composition. A future refactor that splits
    // isOnWarningScreen into a helper with a different regex would
    // break this case silently without this pin.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node resource-id="pre_warning_title_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(true);
  });

  test('warning_acknowledgeButton alone (no room) → false', async () => {
    // Round 2 M-1: completes the standalone × WARNING_MARKERS matrix
    // for this describe block. `warning_title` and
    // `warning_communityStandardsLink` are pinned standalone above
    // (lines 1573, 1666), but `warning_acknowledgeButton` only
    // appears in the overlap branch — never isolated. This pin
    // isolates the "warning marker alone forces false" path for
    // the third marker. A future refactor that removed
    // warning_acknowledgeButton from WARNING_MARKERS would break
    // the overlap precedence pin but no standalone test would
    // catch that the acknowledgement-button marker was the sole
    // cause of the negative result.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_acknowledgeButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(false);
  });

  test('warning-side right-boundary under composition — warning_title_extra near room_seatGrid → true', async () => {
    // Round 2 M-2: the room-side right-boundary (`room_seatGrid_extra`)
    // is pinned. This pins the analogous warning-side right-boundary
    // under composition — a padded warning ID (`warning_title_extra`)
    // must NOT be detected by isOnWarningScreen, leaving the room
    // assertion to carry the result to true. The closing `"` is a
    // hard structural anchor in dumpHasAnyMarker's regex, but the
    // pin defends against future regex changes that might remove or
    // weaken that anchor on the warning marker set.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node resource-id="com.shyden.shytalk.local:id/warning_title_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidContinuesNormallyInRoom('Theo')).toBe(true);
  });
});
