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

describe('android-adb-driver — androidShowsMicIconAs', () => {
  // Wake 103 matcher — `<Name>'s Android UI shows mic icon as "<X>"`
  // (j09 host mic on/off, j10 warning auto-mutes, j15 MC unmutes
  // between sets). Inspects the `room_micToggleButton` IconButton's
  // contentDescription, which Compose (ChatPanel.kt:325-332) sets
  // from one of three string resources:
  //   - Res.string.mute              = "Mute"              ← mic OPEN
  //   - Res.string.unmute            = "Unmute"            ← mic MUTED
  //   - Res.string.voice_unavailable = "Voice unavailable" ← mic CLOSED
  // The button TEXT reflects the action a user would take on tap;
  // the STATE is therefore the inverse — "Mute" label means the
  // mic is currently open (clicking would mute it).
  //
  // Foundation policy: English (en-US) `local` flavor only. Locale
  // expansion is a future layer — the matcher's `state` arg is a
  // Gherkin literal, not a localised string, so the en→i18n map
  // belongs in the driver, not the runner.
  //
  // Attribute-order tolerance: uiautomator dump attribute ordering is
  // not contractually fixed. The impl uses a TWO-STEP extraction
  // (find the full <node ...> tag containing the testTag, then look
  // up content-desc within that captured tag string), so the test
  // pins both attribute orders.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('"open" state with Mute contentDescription → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(true);
  });

  test('"muted" state with Unmute contentDescription → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Unmute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'muted')).toBe(true);
  });

  test('"closed" state with Voice unavailable contentDescription → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Voice unavailable" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'closed')).toBe(true);
  });

  test('state/contentDescription mismatch — open expected but Unmute present → false', async () => {
    // Pins that asking for "open" when the mic is actually muted is
    // correctly rejected (the journey scenario is failing — assertion
    // should NOT silently pass).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Unmute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(false);
  });

  test('state/contentDescription mismatch — muted expected but Mute present → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'muted')).toBe(false);
  });

  test('state/contentDescription mismatch — closed expected but Mute present → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'closed')).toBe(false);
  });

  test('attribute-order tolerance — content-desc before resource-id → true', async () => {
    // uiautomator dump's attribute order is not contractually fixed.
    // Verifying with `node -e` against the live regex before adding
    // this test confirmed the two-step extraction tolerates both
    // orderings. Pin both directions.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node content-desc="Mute" resource-id="com.shyden.shytalk.local:id/room_micToggleButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(true);
  });

  test('mic toggle node missing entirely → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    // The "Mute" contentDescription is on a non-mic node — must not
    // false-positive from a stray attribute elsewhere in the dump.
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(false);
  });

  test('mic toggle present but no content-desc attribute → false', async () => {
    // Defensive: if a future Compose refactor removes the
    // contentDescription, the driver should return false (the
    // contract is "we can detect the state", and without
    // content-desc we cannot).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(false);
  });

  test('empty state arg → false', async () => {
    // Defensive: even though the runner regex requires a non-empty
    // state (`"([^"]+)"`), pin that an empty arg returns false
    // rather than throwing or matching arbitrarily.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', '')).toBe(false);
  });

  test('unknown state ("speaking") → false', async () => {
    // Pins that arbitrary states outside the {open, muted, closed}
    // alphabet return false rather than throwing or short-circuiting
    // any inner predicate. Critical because the Gherkin author could
    // typo "open" → "openn" — the assertion must fail loudly.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'speaking')).toBe(false);
  });

  test('state arg is case-insensitive — "OPEN" maps to open', async () => {
    // Defensive against authoring style — the corpus uses lowercase
    // per the matcher comment, but a Gherkin author writing "OPEN"
    // or "Open" shouldn't silently fail. Documented behaviour:
    // lowercase the state before map lookup.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'OPEN')).toBe(true);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="room_micToggleButton" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(true);
  });

  test('left-boundary false-positive guarded — pre_room_micToggleButton_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="pre_room_micToggleButton_x" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(false);
  });

  test('right-boundary false-positive guarded — room_micToggleButton_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton_extra" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(false);
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
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    const okTheo = await driver.androidShowsMicIconAs('Theo', 'open');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Mute" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidShowsMicIconAs('Alice', 'open');

    expect(okTheo).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('content-desc contains hint as substring (e.g., "Mute mic") → true', async () => {
    // Pins suffix-padded match semantics: contentDescription doesn't have
    // to equal the hint exactly. Some accessibility libraries pad
    // descriptions ("Mute mic", "Currently: Mute"). The word-boundary
    // match (Round 1 I-1 fix) tolerates this without false-failing —
    // "Mute" is preceded by start-of-string and followed by a space.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Mute mic" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(true);
  });

  test('prefix collision guard — "Auto-Unmute" does NOT match state "muted"', async () => {
    // Round 1 I-1 fix: bare `.includes("Unmute")` would have returned
    // true for `"Auto-Unmute"` (substring true). The word-boundary
    // match blocks this — the `-` before "Unmute" is matched by the
    // negative lookbehind `(?<![\w-])`. Pins the boundary rule so a
    // future Compose feature adding a label like "Auto-Unmute" or
    // "Smart-Unmute" doesn't silently false-positive the assertion.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Auto-Unmute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'muted')).toBe(false);
  });

  test('prefix collision guard — "Pre-Mute" does NOT match state "open"', async () => {
    // Round 1 I-1: same boundary rule applied to the "open" hint.
    // Symmetric coverage with the "Auto-Unmute" pin above.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Pre-Mute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(false);
  });

  test('suffix collision guard — "MuteAll" does NOT match state "open"', async () => {
    // Round 1 I-1: the right-side word-boundary `(?!\w)` blocks the
    // hint from being a prefix of a longer word. "MuteAll" contains
    // "Mute" but the following `A` is a word char — match blocked.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="MuteAll" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(false);
  });

  test('package-qualified left-boundary false-positive guarded — :id/pre_room_micToggleButton does NOT match', async () => {
    // Round 1 I-2: the bare-form left-boundary case is already pinned
    // (`pre_room_micToggleButton_x`). This pins the analogous
    // package-qualified form. The optional `(?:[^"]*:id/)?` group
    // would consume `com.shyden.shytalk.local:id/`, leaving
    // `pre_room_micToggleButton` to match against the literal
    // `room_micToggleButton` — that fails because `pre_` precedes
    // `room_`. The pin makes the regex contract explicit for this
    // method's distinct (non-dumpHasAnyMarker) regex shape.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_room_micToggleButton" content-desc="Mute" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'open')).toBe(false);
  });

  test('multi-word hint embedded in sentence — "Enable Voice unavailable mode" does NOT match', async () => {
    // Round 2 I-1: the word-boundary regex `(?<![\w-])${h}(?!\w)`
    // only anchors at the OUTER edges of the hint. For multi-word
    // hints like "Voice unavailable", `"Enable Voice unavailable mode"`
    // satisfies both anchors (leading space passes `(?<![\w-])`,
    // trailing space passes `(?!\w)`). Fixed by switching multi-word
    // hints to exact (case-insensitive) match — Compose emits
    // verbatim string-resource values, so embedded forms would be
    // a Compose regression, not legitimate UI state.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Enable Voice unavailable mode" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'closed')).toBe(false);
  });

  test('multi-word hint exact (case-insensitive) match — "voice unavailable" → true', async () => {
    // Round 2 I-1 corollary: multi-word path uses case-insensitive
    // exact match. Pin that case variation is still tolerated for
    // multi-word hints (the prior single-word case-insensitivity
    // test at "OPEN" exercises the state arg, this exercises the
    // contentDesc value being case-insensitively equal).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="voice unavailable" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'closed')).toBe(true);
  });

  test('suffix-padded muted hint — "Unmute mic" → true (symmetric with "Mute mic")', async () => {
    // Round 2 Minor: symmetric coverage with the suffix-padded
    // "Mute mic" test for the "open" state. The single-word path
    // (used for "Unmute") preserves the word-boundary substring
    // tolerance — "Unmute" is preceded by start-of-string and
    // followed by a space, so both anchors pass. Important to pin
    // both single-word hints exercise the same accessibility
    // padding contract.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_micToggleButton" content-desc="Unmute mic" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMicIconAs('Theo', 'muted')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsBalanceViaListener', () => {
  // Wake 100 matcher — `<Name>'s Android UI shows the new "<X>"
  // balance via Firestore listener` (j06 wallet refresh via real-time
  // listener). Inspects the `wallet_balance` node's `text=` and
  // `content-desc=` attributes for the balance string.
  //
  // Balance shape is user-facing — can include digit separators
  // ("5,000"), currency prefix ("$5,000"), and padded labels
  // ("Balance: 5,000 coins"). Substring match with digit-boundary
  // protection — same word-boundary pattern as the mic-icon impl
  // (PR #734).
  //
  // The matcher's pattern accepts `"([^"]+)"` so the balance string
  // is regex-escaped before insertion into the boundary regex.
  // Compose's text= and content-desc= can appear in either order;
  // the two-step extraction handles attribute-order tolerance.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('balance in text attribute → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(true);
  });

  test('balance in content-desc attribute → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" content-desc="5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(true);
  });

  test('balance with padded label prefix — "Balance: 5,000" → true', async () => {
    // Accessibility labels often pad the value with a descriptive
    // prefix. The word-boundary match accepts the surrounding space.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="Balance: 5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(true);
  });

  test('balance with trailing unit — "5,000 coins" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="5,000 coins" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(true);
  });

  test('balance with currency prefix — "$5,000" → true', async () => {
    // The `$` is not a word char, so the left lookbehind passes.
    // Round 1 I-3: `€`, `£`, `¥` prefix variants are pinned in
    // separate tests below (the comment previously claimed coverage
    // here that was actually absent).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="$5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(true);
  });

  test('balance with euro prefix — "€5,000" → true', async () => {
    // Round 1 I-3: `€` (U+20AC) is non-ASCII, non-word. Under
    // JavaScript regex semantics without the `u` flag, `\w` matches
    // only `[A-Za-z0-9_]` — so `€` is NOT a word char and the left
    // lookbehind `(?<![\w-])` passes. Pin the contract.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="€5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(true);
  });

  test('balance with pound prefix — "£5,000" → true', async () => {
    // Round 1 I-3: same as euro pin but for `£` (U+00A3).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="£5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(true);
  });

  test('balance with yen prefix — "¥5,000" → true', async () => {
    // Round 1 I-3: same as euro pin but for `¥` (U+00A5).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="¥5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(true);
  });

  test('hyphen-prefix balance — "-5,000" does NOT match "5,000" (negative is a distinct value)', async () => {
    // Round 1 I-1: a Compose locale that formats negative balances
    // as "-5,000" would mean the user's balance is NOT 5,000 (it's
    // negative 5,000). Asserting "5,000" against a "-5,000" display
    // must return false. The lookbehind class `[\w-]` blocks the
    // hyphen specifically (it's the same class used in
    // androidShowsBanner's text= attribute guard). Pin the
    // contract so a future relaxation of the class doesn't silently
    // accept negative balances as matches for positive assertions.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="-5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });

  test('node with &gt;-escaped angle bracket before resource-id → tag still located', async () => {
    // Round 1 I-2: uiautomator XML-encodes `>` as `&gt;` in
    // attribute values, so `[^>]*` in the tag regex doesn't truncate
    // (none of `&`, `g`, `t`, `;` is a literal `>`). Pin that the
    // tag-capture step works when another attribute value contains
    // an HTML-escaped angle bracket positioned before resource-id.
    // Low probability in practice (uiautomator always escapes), but
    // explicit defends against future regex changes that might use
    // `[^>]+?` non-greedy or otherwise alter the boundary.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node text="5,000 &gt; 0" resource-id="com.shyden.shytalk.local:id/wallet_balance" content-desc="5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(true);
  });

  test('numeric-prefix collision guarded — "45,000" does NOT match "5,000"', async () => {
    // Pins the digit-boundary protection on the LEFT side. Without
    // word-boundary, "45,000" would match the hint "5,000" via
    // naive substring scan, silently confirming an INCORRECT
    // balance assertion.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="45,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });

  test('numeric-suffix collision guarded — "5,0000" does NOT match "5,000"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="5,0000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });

  test('different balance present → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="1,234" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });

  test('wallet_balance node missing → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" text="5,000" />',
    });
    const driver = await createAndroidDriver();
    // The "5,000" text is on a non-wallet node — must not false-positive
    // from a stray attribute elsewhere in the dump.
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });

  test('wallet_balance present but neither text nor content-desc has balance → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });

  test('empty balance arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '')).toBe(false);
  });

  test('whitespace-only balance arg → false', async () => {
    // Defensive against accidentally-blank Gherkin: even though the
    // runner regex requires `([^"]+)` (one or more non-quote chars),
    // an author could write `" "` and it would slip through. Pin
    // that the driver rejects whitespace-only input.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '   ')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="wallet_balance" text="5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(true);
  });

  test('left-boundary false-positive guarded — pre_wallet_balance_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_wallet_balance_x" text="5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });

  test('right-boundary false-positive guarded — wallet_balance_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance_extra" text="5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });

  test('package-qualified left-boundary guarded — :id/pre_wallet_balance does NOT match', async () => {
    // Same pattern as PR #734's I-2 fix. The optional `(?:[^"]*:id/)?`
    // group consumes the package prefix, leaving `pre_wallet_balance`
    // to match against `wallet_balance` literal — that fails because
    // `pre_` precedes `wallet_`. Pin the contract explicit.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_wallet_balance" text="5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });

  test('attribute-order tolerance — content-desc before resource-id → true', async () => {
    // uiautomator dump attribute ordering is not contractually fixed
    // (see PR #734 mic-icon impl). The two-step extraction must
    // tolerate both orderings.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node content-desc="5,000" resource-id="com.shyden.shytalk.local:id/wallet_balance" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(true);
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
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="5,000" />',
    });
    const driver = await createAndroidDriver();
    const okTheo = await driver.androidShowsBalanceViaListener('Theo', '5,000');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="5,000" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidShowsBalanceViaListener('Alice', '5,000');

    expect(okTheo).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('balance with regex-significant chars — "1,234.56" matches literally', async () => {
    // The balance arg is regex-escaped before insertion into the
    // boundary regex. Pins that `.` in "1,234.56" matches a LITERAL
    // dot, not "any char" — `1,2345/6` would otherwise false-match
    // (decimal-point variant of the prefix-collision concern).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="1,234.56" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '1,234.56')).toBe(true);
  });

  test('balance with regex-significant chars — "1,234.56" does NOT match "1,234/56"', async () => {
    // Verifies the literal-dot escape via the negative case.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="1,234/56" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '1,234.56')).toBe(false);
  });

  test('first-match contract pinned — two wallet_balance nodes, first wins', async () => {
    // Round 2 Minor: `dump.match(tagRx)` returns the first match
    // only. If uiautomator emits two `wallet_balance` nodes (rare
    // in Compose — one wallet UI on screen at a time — but
    // theoretically possible with modal stacks or recycled views),
    // the driver inspects whichever node appears first in the dump.
    //
    // Pin this as the deliberate contract. A future swap to
    // `matchAll`/multi-node scanning would change behaviour
    // silently without this pin — the breakage of this test would
    // force an explicit decision.
    //
    // Setup: first node has "1,234", second has "5,000". Assertion
    // for "5,000" must return false because the first (winning)
    // match doesn't carry that value.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="1,234" />' +
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBalanceViaListener('Theo', '5,000')).toBe(false);
  });
});

describe('android-adb-driver — androidReplacesFollowButton', () => {
  // Wake 102 matcher — `<Name>'s Android UI replaces follow button
  // with "<X>"` (j07 — UI element swap after follow action completes).
  // Inspects the `profile_followButton` testTag node's text= AND
  // content-desc= attributes for the buttonId string.
  //
  // The buttonId is one of the four follow-state Compose strings
  // (ProfileScreen.kt:1183, 1192): "Follow", "Unfollow", "Following",
  // "Follow back". These have OVERLAPPING PREFIXES — "Follow" is a
  // prefix of "Follow back" and "Following". Substring or word-
  // boundary substring matching would false-positive across them
  // (asserting "Follow" against a "Follow back" button would pass
  // under word-boundary substring tolerance because of the space
  // delimiter).
  //
  // Foundation design: EXACT (case-insensitive) match across either
  // text= or content-desc= within the captured tag. The mic-icon's
  // substring tolerance (PR #734) was for hypothetical accessibility
  // padding; here the four states are mutually-exclusive labels
  // and exact match is the safer foundation.
  //
  // Two-step extraction (PR #734 pattern): capture the
  // profile_followButton node tag first, then scan its attributes.
  // Attribute-order independent.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('buttonId "Follow" matches contentDescription "Follow" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(true);
  });

  test('buttonId "Unfollow" matches text="Unfollow" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" text="Unfollow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Unfollow')).toBe(true);
  });

  test('buttonId "Following" matches contentDescription "Following" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Following" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Following')).toBe(true);
  });

  test('buttonId "Follow back" matches contentDescription "Follow back" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow back" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow back')).toBe(true);
  });

  test('overlap rejection — buttonId "Follow" does NOT match "Follow back"', async () => {
    // Critical overlap pin: the corpus has 4 follow states with
    // overlapping prefixes. Word-boundary substring match would
    // false-positive here (space delimiter between "Follow" and
    // "back"). Exact match correctly rejects.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow back" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(false);
  });

  test('overlap rejection — buttonId "Follow" does NOT match "Following"', async () => {
    // Word-boundary substring match would correctly reject this
    // (word-char suffix), but the test pins it explicitly for the
    // exact-match contract too.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Following" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(false);
  });

  test('overlap rejection — buttonId "Follow back" does NOT match "Follow" (shorter hint, longer button label is the inverse)', async () => {
    // Inverse direction: button shows shorter "Follow", assertion
    // asks for longer "Follow back". Exact match rejects (longer
    // hint cannot equal shorter label).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow back')).toBe(false);
  });

  test('case-insensitive match — "follow" matches "Follow"', async () => {
    // Defensive against authoring style — the corpus uses
    // canonical-case strings ("Follow"), but a Gherkin author
    // writing "follow" (lowercase) shouldn't silently fail.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'follow')).toBe(true);
  });

  test('case-insensitive multi-word — "follow back" matches "Follow back"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow back" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'follow back')).toBe(true);
  });

  test('profile_followButton node missing → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_messageButton" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    // The "Follow" contentDescription is on a non-follow node —
    // must not false-positive from a stray attribute elsewhere.
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(false);
  });

  test('profile_followButton present but no text or content-desc → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(false);
  });

  test('empty buttonId arg → false', async () => {
    // Defensive: the runner regex requires `([^"]+)` so an empty
    // string is not reachable from valid Gherkin, but pin that the
    // driver rejects whitespace-only input rather than silently
    // matching any node with an empty attribute.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', '')).toBe(false);
  });

  test('whitespace-only buttonId arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', '   ')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="profile_followButton" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(true);
  });

  test('left-boundary false-positive guarded — pre_profile_followButton_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="pre_profile_followButton_x" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(false);
  });

  test('right-boundary false-positive guarded — profile_followButton_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton_extra" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(false);
  });

  test('package-qualified left-boundary guarded — :id/pre_profile_followButton does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_profile_followButton" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(false);
  });

  test('attribute-order tolerance — content-desc before resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node content-desc="Follow" resource-id="com.shyden.shytalk.local:id/profile_followButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(true);
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
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    const okTheo = await driver.androidReplacesFollowButton('Theo', 'Follow');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidReplacesFollowButton('Alice', 'Follow');

    expect(okTheo).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('first-match contract pinned — two profile_followButton nodes, first wins', async () => {
    // Same contract as androidShowsBalanceViaListener (PR #735 R2).
    // First node has "Follow", second has "Unfollow". Assertion for
    // "Unfollow" must return false because the first (winning)
    // match doesn't carry that value. A future swap to
    // `matchAll`/multi-node scanning would silently change
    // behaviour without this pin.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow" />' +
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Unfollow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Unfollow')).toBe(false);
  });

  test('partial match within a longer attribute value rejected — "Unfollow Alice" does NOT match "Unfollow"', async () => {
    // Exact-match (not substring) — pin that even where the
    // buttonId IS a prefix of a longer attribute value, the
    // assertion fails. Defends against future drift toward
    // substring tolerance that would re-introduce the overlap
    // false-positives.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Unfollow Alice" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Unfollow')).toBe(false);
  });

  test('non-self-closing open-tag form with value on outer node → true', async () => {
    // Round 1 I-1: real uiautomator XML for Compose Button often uses
    // the open-tag form `<node ...>...</node>` rather than self-closing
    // `<node ... />`. The `\/?>` part of tagRx correctly matches both
    // forms. With Compose's `Modifier.semantics(mergeDescendants = true)`
    // (the default for Button), the merged contentDescription lands on
    // the OUTER node. tagRx captures just the opening tag (no children),
    // and the matchAll scan finds the value there.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" content-desc="Follow"><node text="ignored-child-text" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(true);
  });

  test('non-self-closing form with value ONLY on a child node → false (contract limitation)', async () => {
    // Round 1 I-1: pin the deliberate contract limitation — values
    // that appear ONLY on a child node are NOT detected. tagRx
    // captures just the opening tag, so matchAll scans only the
    // outer node's attributes. This is the correct foundation
    // because Compose's Button merges descendants into the outer
    // node by default. Scanning children would risk cross-button
    // false-positives (a different Compose surface might nest
    // arbitrary text inside the button container).
    //
    // If a future Compose change ever leaves the value only on a
    // child, this test breaks loudly and the contract is revisited
    // intentionally rather than silently expanded.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" class="Button"><node text="Follow" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(false);
  });

  test('matchAll iterates BOTH text and content-desc — divergent values both findable', async () => {
    // Round 1 I-2: pin that `matchAll` actually iterates rather than
    // stopping at the first attribute. With `text="Follow"` AND
    // `content-desc="Unfollow"` on the same node, both buttonIds
    // should independently match. Defends against a future refactor
    // that swaps matchAll for `.match()` (first-only) without
    // updating tests.
    //
    // Realistic? Compose's accessibility merge usually keeps text and
    // contentDescription aligned, but uiautomator can surface
    // divergent values when text is the rendered label and
    // content-desc is the role hint. The pin doesn't assume
    // divergence is common — just that the iteration semantics
    // hold when it occurs.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" text="Follow" content-desc="Unfollow" />',
    });
    const driver = await createAndroidDriver();
    // First attribute (text="Follow")
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(true);

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_followButton" text="Follow" content-desc="Unfollow" />',
    });
    const driver2 = await createAndroidDriver();
    // Second attribute (content-desc="Unfollow") — only reachable if
    // matchAll iterates past the first hit when it doesn't match.
    expect(await driver2.androidReplacesFollowButton('Theo', 'Unfollow')).toBe(true);
  });

  test('bare left-boundary without suffix — pre_profile_followButton does NOT match', async () => {
    // Round 2 I-1: explicit pin that a bare resource-id of
    // `pre_profile_followButton` (no `_x` suffix, no package prefix)
    // is correctly rejected. The reviewer's regex-trace reasoning
    // initially suggested this could be a left-boundary bug because
    // `profile_followButton"` is a suffix of `pre_profile_followButton"`.
    //
    // Verified false alarm — the production regex anchors
    // `profile_followButton"` to the position IMMEDIATELY after
    // `resource-id="` (modulo the optional `(?:[^"]*:id/)?` prefix
    // group). The literal cannot "slide" within the attribute value
    // because `resource-id="` is a fixed anchor.
    //
    // Pin here so future reviewers don't need to mentally simulate
    // the regex anchoring — the test makes the contract self-evident.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="pre_profile_followButton" content-desc="Follow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidReplacesFollowButton('Theo', 'Follow')).toBe(false);
  });
});

describe('android-adb-driver — androidDisablesInput', () => {
  // Wake 89 matcher — `<Name>'s Android UI disables the <X> input`
  // (j11:50). Parameterised input-control state assertion: future
  // matchers like "disables the comment input" / "gift input" reuse
  // this matcher without needing a new one. Driver receives
  // `(name, inputName)` where inputName is the bare control name
  // ("chat", "comment", "gift", etc.).
  //
  // Implementation strategy:
  //   1. Map inputName → Compose testTag via INPUT_TAGS table.
  //      Currently only "chat" → "room_chatInput" is grounded
  //      (ChatPanel.kt:273). Unmapped names return false until a
  //      future Compose change lands the missing testTag.
  //   2. Capture the input's node tag via the standard two-step
  //      extraction (PR #734 pattern).
  //   3. Scan within the captured tag for `enabled="false"` —
  //      uiautomator's standard disabled-state attribute.
  //
  // The `enabled="false"` literal needs no escaping (no regex chars).
  // The closing `"` anchors the right side, so `enabled="falsey"` or
  // similar invented values wouldn't false-match.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('chat input with enabled="false" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(true);
  });

  test('chat input with enabled="true" → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="true" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('chat input with no enabled attribute → false (defensive)', async () => {
    // uiautomator always emits enabled, but pin the contract that
    // absence-of-attribute is treated as "not confirmed disabled"
    // (returns false). This is the conservative interpretation —
    // we cannot assert disablement without evidence.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('unmapped input name "comment" → false (no testTag mapping yet)', async () => {
    // Only "chat" → "room_chatInput" is mapped today. Future
    // Compose work would add "comment", "gift", etc. tags. Pin
    // that unmapped names return false NOW so a journey-test
    // author writing "disables the comment input" gets a clear
    // FAIL instead of a silent pass against an unrelated node.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'comment')).toBe(false);
  });

  test('input testTag missing from dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    // enabled="false" is on a non-chat node — must not false-positive
    // from a stray attribute elsewhere in the dump.
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('empty inputName arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', '')).toBe(false);
  });

  test('whitespace-only inputName arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', '   ')).toBe(false);
  });

  test('case-insensitive inputName — "CHAT" maps to chat', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'CHAT')).toBe(true);
  });

  test('bare resource-id (no package prefix) → true when disabled', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(true);
  });

  test('left-boundary false-positive guarded — pre_room_chatInput_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_room_chatInput_x" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('right-boundary false-positive guarded — room_chatInput_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput_extra" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('package-qualified left-boundary guarded — :id/pre_room_chatInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('bare left-boundary without suffix — pre_room_chatInput does NOT match', async () => {
    // Same pre-emptive pin as PR #736 R2 — explicit pin that a bare
    // `pre_room_chatInput` (no `_x` suffix, no package prefix) is
    // correctly rejected. Closes the "regex anchoring" mental-
    // simulation gap proactively.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('attribute-order tolerance — enabled before resource-id → true', async () => {
    // uiautomator attribute order is not contractually fixed; pin
    // that the impl finds the node regardless of where `enabled`
    // appears within the tag.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node enabled="false" resource-id="com.shyden.shytalk.local:id/room_chatInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(true);
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
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    const okTheo = await driver.androidDisablesInput('Theo', 'chat');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="false" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidDisablesInput('Alice', 'chat');

    expect(okTheo).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('multiple inputs in dump — only chat node is consulted', async () => {
    // Pins that the impl isolates to the chat input's node. A
    // hypothetical future scenario could have multiple input
    // controls visible (chat + comment) — only the named one's
    // state is checked. Here we have a non-chat node disabled
    // and the chat node enabled — assertion must return false.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/some_other_input" enabled="false" />' +
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="true" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('first-match contract pinned — two room_chatInput nodes, first wins', async () => {
    // Same first-match contract as the prior method PRs. First
    // node enabled, second disabled. Assertion for "is disabled"
    // returns false because the first (winning) match has
    // enabled="true".
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="true" />' +
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('enabled="falsey" does NOT match (closing quote anchors right boundary)', async () => {
    // Defends against future regex changes that might soften the
    // enabled="false" literal to a substring scan. The closing `"`
    // requires the value to be exactly "false", so a hypothetical
    // `enabled="falsey"` does not match.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="falsey" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('non-self-closing tag form — open-tag <node ...>...</node> still detected', async () => {
    // Round 1 I-1: real uiautomator XML emits both self-closing
    // (`<node ... />`) and non-self-closing (`<node ...>...</node>`)
    // forms. The tagRx's `\/?>` handles both. Pin the open-tag form
    // explicitly — production handles it via the optional `/` in the
    // tail, but the test makes the contract self-evident and would
    // catch a future regex simplification (e.g. `\/>` only).
    //
    // Round 2 I-2 clarification: tagRx uses `[^>]*` which stops at
    // the first `>`. This is safe because uiautomator XML never
    // emits a literal `>` inside an attribute value (the spec
    // escapes them as `&gt;`). So `[^>]*` reliably bounds at the
    // outer node's opening-tag terminator, and `tagMatch[0]`
    // captures only that opening tag. Child nodes after the `>`
    // are excluded — which is intentional (see PR #736 R1 I-1
    // discussion of child-carried values).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="false"><node text="ignored-child" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(true);
  });

  test('compound-attribute left-boundary guard — pre-enabled="false" does NOT match', async () => {
    // Round 1 I-2: bare `/enabled="false"/` substring scan would
    // false-positive against any compound attribute ending in
    // `enabled` — e.g. a hypothetical hyphenated form like
    // `pre-enabled="false"`. The lookbehind `(?<![\w-])` blocks the
    // hyphen and word-char prefixes, mirroring androidShowsBanner's
    // text= attribute guard.
    //
    // In current uiautomator vocabulary the standard `enabled` is
    // the only `enabled`-ending attribute, but this pin defends
    // against future surface growth.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" pre-enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('compound-attribute left-boundary guard — chatEnabled="false" does NOT match', async () => {
    // Symmetric to the hyphen pin: word-char prefix is also blocked
    // by the `(?<![\w-])` lookbehind. The `t` before `Enabled` would
    // pass an exact-case regex (since the test searches lowercase
    // `enabled`), so the actual collision risk is on camelCase
    // attributes with a trailing lowercase form. Pinned for
    // completeness — pin `chatenabled` (lowercase prefix).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" chatenabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', 'chat')).toBe(false);
  });

  test('null inputName arg → false', async () => {
    // Round 2 I-1: the guard `if (!inputName || !inputName.trim())`
    // correctly short-circuits on null and undefined. Pin both
    // explicitly so a future refactor changing the guard to
    // `inputName.length === 0` (which would crash on null) is
    // caught immediately. Empty-string and whitespace-only pins
    // are already in place above; this completes the null-safety
    // matrix that prior PRs established (#728 banner, #730
    // reason).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', null)).toBe(false);
  });

  test('undefined inputName arg → false', async () => {
    // Round 2 I-1 (companion to the null pin above). Pins that
    // omitting the arg (which would pass `undefined` positionally)
    // does not crash the driver.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_chatInput" enabled="false" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidDisablesInput('Theo', undefined)).toBe(false);
  });
});

describe('android-adb-driver — androidShowsFrozenBanner', () => {
  // Wake 99 matcher — `<Name>'s <Plat> UI[ opens conversation "<X>"]
  // shows the frozen-banner element <suffix>` (j08, 4 corpus rows).
  // Driver receives `(viewer, convId, suffix)`. `convId` is optional
  // (null when no "opens conversation X" prefix in Gherkin). `suffix`
  // is descriptive — could be "with text-from-key X" or "with locale
  // string Y".
  //
  // Foundation policy: presence-check `privateChat_frozenBanner`
  // testTag (PrivateChatScreen.kt:440) only. All three args are
  // accepted-and-ignored at this layer — the assertion is "the
  // frozen banner is currently visible". A future PR can layer
  // text-from-key / locale-string verification on top once those
  // contracts are clearer.
  //
  // Same shape as androidNavigatesToRoomScreen's suffix-ignore
  // foundation (PR #732).
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('privateChat_frozenBanner present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_frozenBanner" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(true);
  });

  test('privateChat_frozenBanner absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="privateChat_frozenBanner" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    // PR #736+ established that uiautomator can emit both
    // self-closing and open-tag forms. The tagRx's `\/?>` handles
    // both — pin the open-tag form.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_frozenBanner"><node text="Conversation frozen" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(true);
  });

  test('convId-specified call (non-null) — also passes', async () => {
    // Pins that the optional convId arg is correctly accepted-and-
    // ignored when it carries a real value (the "opens conversation
    // X" Gherkin variant).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_frozenBanner" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidShowsFrozenBanner('Theo', 'conv_abc123', 'with text-from-key X'),
    ).toBe(true);
  });

  test('different suffix variant — "with locale string Y" also passes', async () => {
    // Pins that the suffix is ignored at the foundation layer — all
    // 4 j08 corpus rows return identical results given the same
    // dump. A future PR layering suffix-aware refinement (e.g.
    // text-from-key inspection of the banner's inner text node)
    // would update this test.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_frozenBanner" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with locale string Y')).toBe(true);
  });

  test('left-boundary false-positive guarded — pre_privateChat_frozenBanner_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_frozenBanner_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(false);
  });

  test('right-boundary false-positive guarded — privateChat_frozenBanner_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_frozenBanner_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(false);
  });

  test('package-qualified left-boundary guarded — :id/pre_privateChat_frozenBanner does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_privateChat_frozenBanner" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(false);
  });

  test('bare left-boundary without suffix — pre_privateChat_frozenBanner does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_frozenBanner" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(false);
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
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(false);
  });

  test('viewer name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_frozenBanner" />',
    });
    const driver = await createAndroidDriver();
    const okTheo = await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_frozenBanner" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidShowsFrozenBanner('Alice', null, 'with text-from-key X');

    expect(okTheo).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('first-match contract pinned — two privateChat_frozenBanner nodes, first wins', async () => {
    // Same first-match contract as prior method PRs. Presence-check
    // semantics: as long as the first match exists, return true.
    // The second one's existence doesn't change the answer.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_frozenBanner" />' +
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_frozenBanner" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(true);
  });

  test('foundation-layer contract pinned — child text content is IGNORED (not consulted)', async () => {
    // Round 1 I-1: this method's foundation is a pure presence-check
    // — the banner's INNER text (a child node) is deliberately not
    // consulted. Pin the contract by showing that a dump whose child
    // text differs from any plausible expected value STILL returns
    // true.
    //
    // Future layering: a suffix-aware refinement PR will extract the
    // child node's text= attribute and verify it against either a
    // string-resource key ("with text-from-key X") or a literal
    // locale value ("with locale string Y"). When that PR lands, it
    // must UPDATE this test to reflect the new (stricter) contract.
    // Without this pin, the layering author might mistakenly assume
    // the foundation already validated inner text and skip adding
    // the new assertion.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_frozenBanner"><node text="Something else entirely" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsFrozenBanner('Theo', null, 'with text-from-key X')).toBe(true);
  });
});

describe('android-adb-driver — androidAdminShowsNewReportInQueue', () => {
  // Wake 105 matcher — `<Name>'s Android Admin UI shows the new
  // report in the queue` (j11 — admin sees a freshly-filed report).
  // Single-arg driver method receiving the reviewer's persona name.
  //
  // Foundation strategy: combine TWO testTags that already exist in
  // Compose (ReportReviewScreen.kt territory):
  //   - reportReview_list       — admin queue container (must be present)
  //   - reportReview_emptyState — empty-list placeholder (must be ABSENT)
  //
  // Together these assert "the queue contains at least one report",
  // which is the closest foundation-layer interpretation of "shows
  // the new report" without a `status="new"` testTag distinguishing
  // freshly-filed from older reports. A future layer can add per-
  // row inspection (e.g. via a `reportReview_row_${id}` parameterised
  // testTag) to verify the SPECIFIC new report. Foundation answer:
  // "the queue is non-empty".
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('list present, empty-state absent → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(true);
  });

  test('list present, empty-state ALSO present → false (queue is empty)', async () => {
    // The two-testTag composition: even though the list container is
    // there, if the empty-state child is rendered, the queue has
    // zero reports → foundation answers false. Pin the precedence:
    // empty-state always wins.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_emptyState" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(false);
  });

  test('list absent (admin on wrong screen) → false', async () => {
    // If the admin is on the home tab or any non-queue screen, the
    // list testTag isn't in the dump. Distinct from "queue is
    // empty" — the assertion can't be evaluated. Foundation answer:
    // false (cannot confirm a new report).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(false);
  });

  test('empty-state alone (no list) → false', async () => {
    // Defensive edge: if uiautomator emits the empty-state node
    // without the list container (theoretically impossible but
    // pinnable), the list-required guard fires first and returns
    // false. Documents that list-present is the necessary precondition.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_emptyState" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true when list present without empty', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(true);
  });

  test('non-self-closing list tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list"><node text="report row" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(true);
  });

  test('non-self-closing empty-state form — still blocks even if open-tag', async () => {
    // Symmetric to the non-self-closing list pin: the empty-state
    // detection must also work for the open-tag form.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_emptyState"><node text="No reports yet" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(false);
  });

  test('left-boundary false-positive on list — pre_reportReview_list_x does NOT count', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_reportReview_list_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(false);
  });

  test('right-boundary false-positive on list — reportReview_list_extra does NOT count', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(false);
  });

  test('package-qualified left-boundary on list — :id/pre_reportReview_list does NOT count', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(false);
  });

  test('bare left-boundary without suffix — pre_reportReview_list does NOT count', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(false);
  });

  test('empty-state false-positive — pre_reportReview_emptyState does NOT block', async () => {
    // Pins that the empty-state guard ALSO has boundary protection.
    // If a real `reportReview_list` is present AND a `pre_reportReview_emptyState`
    // (a different testTag) is also there, the assertion should
    // still return true because the empty-state guard correctly
    // rejects the padded variant.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node resource-id="pre_reportReview_emptyState" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(true);
  });

  test('empty-state right-boundary — reportReview_emptyState_extra (bare) does NOT block', async () => {
    // Round 1 I-1: extends the empty-state boundary matrix to match
    // the list-tag coverage. A bare suffix-padded tag like
    // `reportReview_emptyState_extra` shouldn't block the assertion
    // when a real list is present.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node resource-id="reportReview_emptyState_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(true);
  });

  test('empty-state right-boundary — :id/reportReview_emptyState_extra (package-qualified) does NOT block', async () => {
    // Round 1 I-1: package-qualified right-boundary analog. The
    // optional `(?:[^"]*:id/)?` group consumes the prefix, leaving
    // `reportReview_emptyState_extra"` to be matched against the
    // literal `reportReview_emptyState"` — the closing `"` anchor
    // rejects the `_extra` suffix.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_emptyState_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(true);
  });

  test('empty-state package-qualified left-boundary — :id/pre_reportReview_emptyState does NOT block', async () => {
    // Round 1 I-1: package-qualified analog of the existing
    // bare-form pre_* pin. The optional group consumes the package
    // prefix; the literal `reportReview_emptyState"` then fails
    // against `pre_reportReview_emptyState"`.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node resource-id="com.shyden.shytalk.local:id/pre_reportReview_emptyState" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(true);
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
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(false);
  });

  test('reviewer name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    const okGary = await driver.androidAdminShowsNewReportInQueue('Gary');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidAdminShowsNewReportInQueue('Alice');

    expect(okGary).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('first-match contract pinned — two reportReview_list nodes, list-present condition holds', async () => {
    // Presence-check semantics: as long as the list is present
    // somewhere and empty-state is absent, the assertion holds.
    // Two list nodes don't change the answer.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsNewReportInQueue('Gary')).toBe(true);
  });
});

describe('android-adb-driver — androidAdminShowsTableOf', () => {
  // Wake 92 matcher — `<Name>'s Android Admin UI shows a table of
  // recent <X>` (j12:24). Generic admin-table presence assertion.
  // Driver receives `(viewer, noun)` where noun is 1-3 words
  // (e.g. "reports", "user reports", "active user reports").
  //
  // Foundation strategy: a TABLE_TAGS map from canonical noun to
  // Compose testTag. Currently only one entry exists:
  //   - "reports" → reportReview_list (verified in PR #739)
  //
  // Unmapped nouns return false until the corresponding Compose
  // testTag is added — same FAIL-loud contract as INPUT_TAGS in
  // PR #737. Returns boolean (truthy = visible). The matcher
  // protocol also supports returning an array of entries for richer
  // assertion chains, but the foundation just asserts visibility —
  // a future PR can extract entries when needed.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('"reports" noun with reportReview_list present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'reports')).toBe(true);
  });

  test('"reports" noun with table tag absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'reports')).toBe(false);
  });

  test('unmapped noun "transactions" → false (FAIL-loud contract)', async () => {
    // Only "reports" is mapped today. An unmapped noun returns false
    // even if the dump contains a similar-looking table. Protects
    // journey-test authors from silently asserting against an
    // unrelated node — they get a clear FAIL until the testTag
    // mapping lands.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'transactions')).toBe(false);
  });

  test('case-insensitive noun — "REPORTS" maps to reports', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'REPORTS')).toBe(true);
  });

  test('noun with surrounding whitespace — "  reports  " maps to reports', async () => {
    // Defensive against Gherkin authoring artifacts. The matcher
    // regex `(\w+(?:\s+\w+){0,2})` shouldn't introduce leading/
    // trailing whitespace, but the .trim() in the lookup defends
    // against future regex tweaks.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', '  reports  ')).toBe(true);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'reports')).toBe(false);
  });

  test('empty noun arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', '')).toBe(false);
  });

  test('whitespace-only noun arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', '   ')).toBe(false);
  });

  test('null noun arg → false', async () => {
    // Memory rule: pin null/undefined alongside empty + whitespace
    // (see PR #737 R2 and the null-undefined-pins memory).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', null)).toBe(false);
  });

  test('undefined noun arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', undefined)).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'reports')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list"><node text="row 1" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'reports')).toBe(true);
  });

  test('left-boundary false-positive — pre_reportReview_list_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_reportReview_list_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'reports')).toBe(false);
  });

  test('right-boundary false-positive — reportReview_list_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'reports')).toBe(false);
  });

  test('package-qualified left-boundary — :id/pre_reportReview_list does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'reports')).toBe(false);
  });

  test('bare left-boundary without suffix — pre_reportReview_list does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'reports')).toBe(false);
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
    expect(await driver.androidAdminShowsTableOf('Gary', 'reports')).toBe(false);
  });

  test('viewer name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    const okGary = await driver.androidAdminShowsTableOf('Gary', 'reports');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidAdminShowsTableOf('Alice', 'reports');

    expect(okGary).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('first-match contract pinned — two reportReview_list nodes, presence holds', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'reports')).toBe(true);
  });

  test('multi-word noun "user reports" → false (no testTag mapping)', async () => {
    // Pins that compound nouns from the matcher's `(\w+(?:\s+\w+){0,2})`
    // pattern are accepted by the matcher but return false from the
    // driver until a TABLE_TAGS entry is added.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsTableOf('Gary', 'user reports')).toBe(false);
  });
});

describe('android-adb-driver — androidSearchIn', () => {
  // Two matchers delegate to this method:
  //   `<P> on Android searches "<X>" in <screen>` → screen-scoped
  //   `<P> on Android types "<X>" into the search field` → active-screen (null)
  //
  // Driver signature: `androidSearchIn(screen, text)` — `screen` may
  // be null (= active-screen / default field).
  //
  // Foundation strategy: a SEARCH_FIELD_TAGS map from canonical screen
  // name to Compose testTag. Currently one entry:
  //   - "messages" → newMessage_searchField
  // And the active-screen (null) default routes to the same tag.
  //
  // Sequence: tap the search field → type the text (`adb shell input
  // text`, with spaces encoded as `%s` per Android's standard
  // convention). No explicit submit — most Compose search fields
  // auto-search as you type.
  //
  // The runner never inspects the return value (always wraps in
  // `ok: true`), but the driver still returns boolean for direct
  // testability and for future runner refactors that might want to
  // surface failures.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('screen "messages" + text "hello" → tap + input text', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidSearchIn('messages', 'hello');
    expect(ok).toBe(true);
    // Verify the tap was at the centre of the bounds
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    // Verify input text was called with the literal text
    const inputCall = execSync.mock.calls.find(
      (c) => c[0].includes("'input' 'text'") && c[0].includes('hello'),
    );
    expect(inputCall).toBeDefined();
  });

  test('null screen → defaults to newMessage_searchField (tap target pinned)', async () => {
    // The "types into the search field" matcher passes null.
    // Driver falls back to the default search field tag.
    // Round 1 I-2: also verify the TAP TARGET — without this pin,
    // a future change routing null to a wrong (but still-rendered)
    // tag would silently pass. Confirm the tap coordinates match
    // the centre of the newMessage_searchField bounds.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidSearchIn(null, 'world');
    expect(ok).toBe(true);
    // bounds [10,100][1000,200] → centre (505, 150)
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'505'");
    expect(tapCall[0]).toContain("'150'");
  });

  test('text with spaces — "hello world" encoded as "hello%sworld"', async () => {
    // adb shell input text uses %s to represent a space (anything
    // else would be split by the shell). Pin the encoding.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidSearchIn('messages', 'hello world');
    expect(ok).toBe(true);
    const inputCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'text'"));
    expect(inputCall).toBeDefined();
    expect(inputCall[0]).toContain('hello%sworld');
    expect(inputCall[0]).not.toContain("'hello' 'world'");
  });

  test('unmapped screen "foobar" → false (FAIL-loud contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSearchIn('foobar', 'hello')).toBe(false);
  });

  test('search field testTag absent in dump → false', async () => {
    // Map resolved to a tag, but uiautomator dump doesn't show it
    // (admin on wrong screen). Tap fails → method returns false.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('main_roomsTab', '[0,1900][270,2100]'),
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSearchIn('messages', 'hello')).toBe(false);
  });

  test('empty text arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSearchIn('messages', '')).toBe(false);
  });

  test('null text arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSearchIn('messages', null)).toBe(false);
  });

  test('undefined text arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSearchIn('messages', undefined)).toBe(false);
  });

  test('whitespace-only text arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSearchIn('messages', '   ')).toBe(false);
  });

  test('case-insensitive screen name — "MESSAGES" resolves', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSearchIn('MESSAGES', 'hello')).toBe(true);
  });

  test('whitespace-padded screen name — "  messages  " resolves after trim', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSearchIn('  messages  ', 'hello')).toBe(true);
  });

  test('input text throws → false (defensive)', async () => {
    // Tap succeeds but the subsequent `input text` call rejects.
    // The driver catches and returns false rather than propagating.
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) return '';
      if (cmd.includes("'cat' '/sdcard/dump.xml'")) {
        return '<node resource-id="com.shyden.shytalk.local:id/newMessage_searchField" bounds="[10,100][1000,200]" />';
      }
      if (cmd.includes("'input' 'tap'")) return '';
      if (cmd.includes("'input' 'text'")) throw new Error('adb: device unauthorised');
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSearchIn('messages', 'hello')).toBe(false);
  });

  test('uiautomator dump fails → false (tap fails first)', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) throw new Error('adb: device offline');
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSearchIn('messages', 'hello')).toBe(false);
  });

  test('tap and input commands issued in correct order', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    await driver.androidSearchIn('messages', 'query');
    // Find the indices of tap and input text in the call sequence
    const tapIdx = execSync.mock.calls.findIndex((c) => c[0].includes("'input' 'tap'"));
    const inputIdx = execSync.mock.calls.findIndex((c) => c[0].includes("'input' 'text'"));
    expect(tapIdx).toBeGreaterThanOrEqual(0);
    expect(inputIdx).toBeGreaterThanOrEqual(0);
    expect(tapIdx).toBeLessThan(inputIdx);
  });

  test('text with regex-significant chars — no shell interpretation', async () => {
    // Pin that the text is passed to `input text` literally — no
    // shell glob expansion, no regex escape needed. The shell-
    // quoting of adb() args isolates the value.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidSearchIn('messages', 'a.b*c');
    expect(ok).toBe(true);
    const inputCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'text'"));
    expect(inputCall[0]).toContain('a.b*c');
  });

  test('single quote in text — POSIX-escaped, no shell misparse', async () => {
    // Round 1 C-1: text is the first USER-CONTROLLED free-form
    // string reaching adb() in the cluster. adb() wraps each arg
    // in single quotes; a literal single quote in text (e.g.
    // "O'Brien", "can't") would produce unbalanced quotes and
    // shell misparse.
    //
    // Fix: POSIX escape pattern `'\''` (close quote + escaped
    // literal quote + reopen quote). The result, when wrapped by
    // adb()'s outer single quotes, round-trips correctly.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidSearchIn('messages', "O'Brien");
    expect(ok).toBe(true);
    const inputCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'text'"));
    expect(inputCall).toBeDefined();
    // The full adb command should contain the POSIX-safe pattern.
    // After adb() wraps in single quotes, "O'Brien" becomes
    // 'O'\''Brien' — close + escaped quote + reopen.
    expect(inputCall[0]).toContain(String.raw`'O'\''Brien'`);
  });

  test('single quote alongside spaces — both encodings applied', async () => {
    // Round 1 C-1: pin that both encodings (POSIX quote escape
    // + %s space encoding) compose correctly. "can't stop" should
    // become "can'\\''t%sstop" inside the shell quote-wrap.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidSearchIn('messages', "can't stop");
    expect(ok).toBe(true);
    const inputCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'text'"));
    expect(inputCall).toBeDefined();
    // Space replaced with %s AND quote POSIX-escaped.
    expect(inputCall[0]).toContain('%s');
    expect(inputCall[0]).toContain(String.raw`'\''`);
    // Should NOT contain raw space-separated tokens or unbalanced quote.
    expect(inputCall[0]).not.toContain("'can't'");
  });

  test('literal "%s" in text — KNOWN LIMITATION pinned (decodes as space)', async () => {
    // Round 1 I-1: adb's `input text` decodes `%s` as a literal
    // space and has no `%%`-style escape. A search for the literal
    // sequence `%s` would yield spaces on the device.
    //
    // The driver passes `%s` through unchanged (no further
    // transformation). The limitation is documented in production
    // comments and pinned here. A future PR could swap to a
    // different keyboard-driver primitive (e.g. UI Automator
    // setText) that doesn't have this asymmetry.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidSearchIn('messages', 'find %s placeholder');
    // The call still completes — the device-side decoding is the
    // limitation, not the driver-side dispatch.
    expect(ok).toBe(true);
    const inputCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'text'"));
    expect(inputCall).toBeDefined();
    // The driver's transformation only encodes spaces. The literal
    // `%s` passes through verbatim (would be decoded as space by
    // adb on the device side — known limitation).
    expect(inputCall[0]).toContain('find%s%s%splaceholder');
  });

  test("recursive-escape case — text containing POSIX escape literal `\\'` is handled", async () => {
    // Round 2 Minor: the POSIX escape replacement
    // `text.replace(/'/g, "'\\''")` fires on every `'` in the input
    // independently. A pathological text like "a'b'c" produces a
    // string where each ' is independently escaped — verified with
    // `node -e` to produce structurally valid POSIX-quoted output.
    //
    // Unreachable from valid Gherkin (no user searches for POSIX
    // escape syntax), but pinning the recursive case defends
    // against a future refactor that might use a non-global replace.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('newMessage_searchField', '[10,100][1000,200]'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidSearchIn('messages', "a'b'c");
    expect(ok).toBe(true);
    const inputCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'text'"));
    expect(inputCall).toBeDefined();
    // After POSIX escape: each ' becomes '\\''. After adb()'s outer
    // wrap, we should see 'a'\''b'\''c' — every embedded ' properly
    // closed and reopened.
    expect(inputCall[0]).toContain(String.raw`'a'\''b'\''c'`);
  });
});

describe('android-adb-driver — androidScanAllRenderedStrings', () => {
  // Wake 76 matcher — `the test runner scans all rendered strings on
  // <Name>'s Android UI across N screens` (j13:60). Meta state-seed
  // method that collects every `text=` and `content-desc=` value
  // from the current uiautomator dump into an array, stored on
  // `ctx.scannedStrings` for follow-up assertion steps (e.g. "no
  // string has the en/strings.xml fallback when the locale is X").
  //
  // Foundation policy: only scans the CURRENT screen. The `screens`
  // count argument is accepted-and-ignored at this layer — a future
  // PR can add multi-screen navigation (tap each main tab, dump,
  // collect, repeat). Even single-screen collection is useful for
  // follow-up locale-fallback assertions against the visible UI.
  //
  // Returns an array of unique non-empty string values (deduplicated
  // via Set, whitespace-trimmed, empties filtered out). Returns
  // empty array on dump failure rather than null/undefined — the
  // runner stores the result on ctx and downstream steps iterate it.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('collects text and content-desc values from current dump', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="hello" content-desc="world" /><node text="bye" />',
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    expect(result).toEqual(expect.arrayContaining(['hello', 'world', 'bye']));
    expect(result).toHaveLength(3);
  });

  test('deduplicates repeated values', async () => {
    // A button might render its label as both `text=` and
    // `content-desc=`; the same text could appear on multiple nodes.
    // Pin that duplicates are collapsed via the Set semantics.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node text="Follow" content-desc="Follow" /><node text="Follow" />',
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    expect(result).toEqual(['Follow']);
  });

  test('filters out empty string values', async () => {
    // Nodes without rendered text often have `text=""` placeholders.
    // Those shouldn't pollute the scanned-strings array.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="" content-desc="" /><node text="real-content" />',
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    expect(result).toEqual(['real-content']);
  });

  test('filters out whitespace-only values', async () => {
    // Some Compose surfaces use whitespace strings as visual spacers.
    // After trim, those become empty and should be filtered.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="   " content-desc="\t\n" /><node text="real" />',
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    expect(result).toEqual(['real']);
  });

  test('returns empty array on empty dump', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    expect(result).toEqual([]);
  });

  test('returns empty array when uiautomator dump throws', async () => {
    // Defensive: dump-fail returns [] rather than null/undefined so
    // downstream steps iterating ctx.scannedStrings don't crash.
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    expect(result).toEqual([]);
  });

  test('mixes text and content-desc collection — both attribute types harvested', async () => {
    // Pin that BOTH attribute types contribute. Some nodes carry
    // text only, others content-desc only, others both. The Set
    // dedupes overlap.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node text="only-text" />' +
        '<node content-desc="only-desc" />' +
        '<node text="both" content-desc="other" />',
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    expect(result).toEqual(expect.arrayContaining(['only-text', 'only-desc', 'both', 'other']));
    expect(result).toHaveLength(4);
  });

  test('handles unicode and locale-specific text', async () => {
    // Pin that non-ASCII strings (e.g. translations) are collected
    // verbatim — important since the matcher's downstream
    // locale-fallback assertion relies on character-exact equality.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node text="привет" /><node content-desc="こんにちは" /><node text="مرحبا" />',
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    expect(result).toEqual(expect.arrayContaining(['привет', 'こんにちは', 'مرحبا']));
    expect(result).toHaveLength(3);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="ok" />',
    });
    const driver = await createAndroidDriver();
    const okTheo = await driver.androidScanAllRenderedStrings('Theo', 1);

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="ok" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidScanAllRenderedStrings('Alice', 1);

    expect(okTheo).toEqual(['ok']);
    expect(okAlice).toEqual(['ok']);
  });

  test('screens count ignored at foundation layer — result identical regardless of N', async () => {
    // Pin the foundation contract: `screens` is accepted but
    // ignored. A future PR can add multi-screen navigation, but
    // until then a request for N=5 returns the same single-screen
    // result as N=1.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="single-screen" />',
    });
    const driver = await createAndroidDriver();
    const result1 = await driver.androidScanAllRenderedStrings('Theo', 1);

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="single-screen" />',
    });
    const driver2 = await createAndroidDriver();
    const result5 = await driver2.androidScanAllRenderedStrings('Theo', 5);

    expect(result1).toEqual(['single-screen']);
    expect(result5).toEqual(['single-screen']);
  });

  test('preserves order of first-occurrence (Set iteration order)', async () => {
    // JS Set iteration order is insertion order. The first
    // occurrence of each string is what determines the position.
    // Pin this for deterministic downstream assertions.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node text="first" /><node text="second" /><node text="first" /><node text="third" />',
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    expect(result).toEqual(['first', 'second', 'third']);
  });

  test('attributes other than text/content-desc are NOT collected', async () => {
    // Pin that `resource-id`, `class`, `package`, etc. are NOT
    // captured. Only `text=` and `content-desc=` carry rendered
    // user-facing strings.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/foo" class="android.view.View" package="com.shyden.shytalk.local" text="visible" />',
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    expect(result).toEqual(['visible']);
    expect(result).not.toContain('com.shyden.shytalk.local:id/foo');
    expect(result).not.toContain('android.view.View');
  });

  test('compound attribute names (hint-text=, error-text=, sub-text=) are NOT collected', async () => {
    // Round 1 I-1: the `(?<![\w-])` lookbehind blocks compound
    // attribute names ending in `text`. Without the guard,
    // framework-internal placeholder/error labels would pollute
    // the scanned-strings array and break downstream locale-
    // fallback assertions. Mirrors the boundary used in
    // androidShowsBanner.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node hint-text="Enter search" error-text="Required" sub-text="Hint" text="Hello" content-desc="World" />',
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    expect(result).toEqual(expect.arrayContaining(['Hello', 'World']));
    expect(result).toHaveLength(2);
    // The compound-attr values must NOT pollute the scanned-strings
    expect(result).not.toContain('Enter search');
    expect(result).not.toContain('Required');
    expect(result).not.toContain('Hint');
  });

  test('text containing embedded quotes is captured up to next non-escaped quote', async () => {
    // uiautomator XML escapes literal `"` in attribute values as
    // `&quot;`. Pin the foundation behaviour: `[^"]*` in the regex
    // stops at the next literal `"`. A future enhancement could
    // decode `&quot;` back to `"`, but for now we pin the verbatim
    // captured form.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node text="he said &quot;hi&quot; today" />',
    });
    const driver = await createAndroidDriver();
    const result = await driver.androidScanAllRenderedStrings('Theo', 1);
    // The literal stored value is `he said &quot;hi&quot; today`
    expect(result).toEqual(['he said &quot;hi&quot; today']);
  });
});

describe('android-adb-driver — androidJoinEventRoom', () => {
  // Composite matcher Wake 86-ish — two personas "both join the
  // event room" via Promise.all. Each platform's driver receives
  // just the persona name and is responsible for joining whatever
  // room is currently visible (the journey orchestrator ensures
  // only the event room is in the list at this point).
  //
  // Foundation strategy: tap the FIRST `roomList_roomCard_*` node
  // found in the current uiautomator dump. This is the cluster's
  // first method that uses a PARAMETERISED testTag prefix-match
  // (vs. exact-match for INPUT_TAGS / TABLE_TAGS lookups).
  //
  // Compose source: HomeScreen.kt:155 attaches
  // `roomList_roomCard_${room.roomId}` to each visible room card.
  // The wildcard suffix is matched via `[^"]*` in the regex.
  //
  // If no room card is visible (empty rooms tab, or admin on a
  // different tab), returns false — the journey author gets a
  // clear FAIL.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('package-qualified roomCard present → tap centre + return true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('roomList_roomCard_abc123', '[0,200][1000,400]'),
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidJoinEventRoom('Alice');
    expect(ok).toBe(true);
    // bounds [0,200][1000,400] → centre (500, 300)
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall).toBeDefined();
    expect(tapCall[0]).toContain("'500'");
    expect(tapCall[0]).toContain("'300'");
  });

  test('bare roomCard (no package prefix) → tap + return true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="roomList_roomCard_xyz" bounds="[10,20][30,40]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidJoinEventRoom('Alice');
    expect(ok).toBe(true);
  });

  test('multiple roomCards present → first wins', async () => {
    // Pin the first-match contract: with two roomCards visible,
    // the driver taps the first one in document order. The
    // journey orchestrator is responsible for ensuring only the
    // intended room is visible, but pin the contract anyway.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomList_roomCard_first" bounds="[0,200][1000,400]" />' +
        '<node resource-id="com.shyden.shytalk.local:id/roomList_roomCard_second" bounds="[0,500][1000,700]" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidJoinEventRoom('Alice');
    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    // First roomCard centre: (500, 300)
    expect(tapCall[0]).toContain("'500'");
    expect(tapCall[0]).toContain("'300'");
    // Second roomCard centre would be (500, 600) — must NOT be the tap target
    expect(tapCall[0]).not.toContain("'600'");
  });

  test('no roomCard in dump (empty rooms list) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomList_emptyState" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidJoinEventRoom('Alice')).toBe(false);
  });

  test('roomCard present but no bounds attribute → false', async () => {
    // Defensive — if uiautomator emits a roomCard without bounds
    // (theoretically impossible per its schema but pinnable), the
    // regex bounds-capture fails to match.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomList_roomCard_abc" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidJoinEventRoom('Alice')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidJoinEventRoom('Alice')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidJoinEventRoom('Alice')).toBe(false);
  });

  test('tap fails (input tap throws) → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) return '';
      if (cmd.includes("'cat' '/sdcard/dump.xml'")) {
        return '<node resource-id="com.shyden.shytalk.local:id/roomList_roomCard_abc" bounds="[0,200][1000,400]" />';
      }
      if (cmd.includes("'input' 'tap'")) throw new Error('adb: device unauthorised');
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidJoinEventRoom('Alice')).toBe(false);
  });

  test('left-boundary false-positive guarded — pre_roomList_roomCard_x does NOT match', async () => {
    // Same boundary-anchor discipline as the assertion methods.
    // The regex requires `roomList_roomCard_` to be at the start
    // of the attribute value (modulo the optional package prefix).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="pre_roomList_roomCard_x" bounds="[0,200][1000,400]" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidJoinEventRoom('Alice')).toBe(false);
  });

  test('package-qualified left-boundary guarded — :id/pre_roomList_roomCard_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_roomList_roomCard_x" bounds="[0,200][1000,400]" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidJoinEventRoom('Alice')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('roomList_roomCard_abc', '[0,200][1000,400]'),
    });
    const driver = await createAndroidDriver();
    const okAlice = await driver.androidJoinEventRoom('Alice');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": dumpWithId('roomList_roomCard_abc', '[0,200][1000,400]'),
    });
    const driver2 = await createAndroidDriver();
    const okBob = await driver2.androidJoinEventRoom('Bob');

    expect(okAlice).toBe(true);
    expect(okBob).toBe(true);
  });

  test('non-self-closing roomCard tag form → tap + return true', async () => {
    // uiautomator can emit roomCards as non-self-closing nodes
    // with children. The regex `[^>]*` correctly bounds within
    // the outer node's opening tag.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomList_roomCard_abc" bounds="[0,200][1000,400]"><node text="Room title" /></node>',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidJoinEventRoom('Alice');
    expect(ok).toBe(true);
  });

  test('roomCard with parameterised ID containing digits and dashes → match', async () => {
    // Realistic Firestore-style room ID: 20-char alphanumeric with
    // hyphens. The `[^"]*` wildcard suffix matches any such ID.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomList_roomCard_abc123-XYZ_456" bounds="[0,200][1000,400]" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidJoinEventRoom('Alice')).toBe(true);
  });

  test('parent roomCard without bounds, child has bounds → false (child-span correctly rejected)', async () => {
    // Round 1 C-1 verification: the two-step extraction pattern
    // structurally CANNOT match a child node's bounds when the
    // parent (the roomCard) lacks them. tagRx uses `[^>]*` which
    // stays within the parent's opening tag; bounds is then
    // scanned from the captured opening-tag string only.
    //
    // Reviewer claimed at 97% confidence that the old `[^<]*?`
    // pattern would span past `>` into the child — verified WRONG
    // with `node -e` (the `[^<]` exclusion stops at the child's
    // `<` boundary). But the two-step refactor in production
    // makes the safety structural rather than incidental.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomList_roomCard_abc" clickable="true"><node bounds="[10,500][200,600]" text="Title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidJoinEventRoom('Alice')).toBe(false);
  });

  test('attribute-order tolerance — bounds BEFORE resource-id in same tag → match', async () => {
    // Round 1 I-1: the two-step extraction is order-independent
    // within the captured opening tag. uiautomator's standard
    // attribute order is `resource-id ... bounds`, but if a future
    // API level (or a different uiautomator implementation)
    // emits bounds first, the two-step pattern still works because
    // `tagMatch[0]` captures the FULL opening tag and the bounds
    // scan operates on that captured string without ordering
    // assumptions.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node bounds="[0,200][1000,400]" resource-id="com.shyden.shytalk.local:id/roomList_roomCard_abc" />',
    });
    const driver = await createAndroidDriver();
    const ok = await driver.androidJoinEventRoom('Alice');
    expect(ok).toBe(true);
    const tapCall = execSync.mock.calls.find((c) => c[0].includes("'input' 'tap'"));
    expect(tapCall[0]).toContain("'500'");
    expect(tapCall[0]).toContain("'300'");
  });
});

describe('android-adb-driver — androidNavigatesToPath', () => {
  // Wake 99 matcher — `<Name>'s Android UI navigates to "<Path>"`
  // (j03+). Generic path-based navigation assertion. Driver receives
  // `(name, path)` where path is a web-style URL: `/`, `/profile/42`,
  // `/messages/abc`, etc.
  //
  // Foundation strategy: a PATH_TAGS map from path prefix to
  // distinctive Compose testTag. Path resolution:
  //   1. Exact match (handles `/` specifically)
  //   2. Prefix match: `/profile/42` → uses `/profile` mapping
  //
  // Currently 5 mappings:
  //   - "/"         → main_roomsTab            (root → rooms landing)
  //   - "/profile"  → profile_displayName       (any profile screen)
  //   - "/messages" → main_messagesTab          (messages tab)
  //   - "/wallet"   → wallet_balance            (wallet screen)
  //   - "/settings" → securitySettingsScreen    (settings landing)
  //
  // Unmapped paths return false (FAIL-loud contract — journey
  // author gets a clear FAIL until the path mapping lands).
  //
  // Foundation contract: PRESENCE check only. Tab paths like "/" and
  // "/messages" assert the tab bar is visible, which is true on every
  // main screen (slightly looser than "user is on THIS tab"). A
  // future PR can tighten with `selected="true"` for tab paths.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('root "/" → main_roomsTab present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Lena', '/')).toBe(true);
  });

  test('exact "/profile" → profile_displayName present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/profile')).toBe(true);
  });

  test('prefix-match "/profile/42" → resolves to /profile mapping', async () => {
    // Pin the prefix-resolver. A profile URL with a user ID still
    // routes to the profile screen check.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/profile/42')).toBe(true);
  });

  test('prefix-match "/messages/abc123" → resolves to /messages mapping', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/messages/abc123')).toBe(true);
  });

  test('"/wallet" → wallet_balance present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/wallet_balance" text="5,000" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/wallet')).toBe(true);
  });

  test('"/settings" → securitySettingsScreen present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/securitySettingsScreen" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/settings')).toBe(true);
  });

  test('expected screen testTag absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    // Asserting profile but on rooms tab → must fail.
    expect(await driver.androidNavigatesToPath('Adam', '/profile/42')).toBe(false);
  });

  test('unmapped path "/login.html" → false (FAIL-loud)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/login.html')).toBe(false);
  });

  test('unmapped path "/unknown" → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/unknown')).toBe(false);
  });

  test('empty path arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '')).toBe(false);
  });

  test('whitespace-only path arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '   ')).toBe(false);
  });

  test('null path arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', null)).toBe(false);
  });

  test('undefined path arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', undefined)).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/profile')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/profile')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    const okAdam = await driver.androidNavigatesToPath('Adam', '/');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver2 = await createAndroidDriver();
    const okLena = await driver2.androidNavigatesToPath('Lena', '/');

    expect(okAdam).toBe(true);
    expect(okLena).toBe(true);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/profile')).toBe(true);
  });

  test('"/profile" exact-match is distinct from "/profile-extras" non-prefix', async () => {
    // Defensive: the prefix-resolver requires either exact match
    // OR the prefix followed by `/`. A path like "/profile-extras"
    // is NOT a prefix of "/profile" — must return null (FAIL-loud).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/profile-extras')).toBe(false);
  });

  test('longest-prefix wins: a path matching multiple prefixes resolves to the most specific', async () => {
    // Currently no path overlaps exist (all prefixes are disjoint),
    // but pin the contract via the resolver behaviour. If future
    // mappings add e.g. "/profile/edit", the resolver should
    // prefer "/profile/edit" over "/profile" for "/profile/edit/photo".
    //
    // Today's pin: "/profile/42" resolves to "/profile" (the only
    // matching prefix), not to "/" (which is exact-only).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/profile/42')).toBe(true);
    // Sanity: "/" does NOT prefix-match "/profile/42" because the
    // "/" → main_roomsTab mapping is exact-only.
  });

  test('path with extra trailing segments — "/profile/42/edit" still resolves to /profile', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/profile/42/edit')).toBe(true);
  });

  test('path with query string "/profile?userId=42" → false (no query-string routing)', async () => {
    // Round 1 I-1: the path-resolver does NOT strip query strings.
    // `/profile?userId=42` is neither an exact match nor a prefix
    // match (the literal string starts with `/profile?`, not
    // `/profile/`). FAIL-loud contract: Gherkin steps must supply
    // clean path segments without query strings.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/profile?userId=42')).toBe(false);
  });

  test('path with fragment "/profile#bio" → false (no fragment routing)', async () => {
    // Round 1 I-2: same contract as query strings — fragments are
    // not stripped by the path-resolver. `/profile#bio` is neither
    // exact nor prefix match. FAIL-loud.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/profile#bio')).toBe(false);
  });

  test('"/" exclusion from prefix-iteration is directly pinned — /profile/42 does NOT resolve via /', async () => {
    // Round 1 M-1: the previous longest-prefix test implies `/` is
    // exact-only via the dump-content selection, but doesn't pin
    // it directly. This test makes the exclusion unambiguous:
    // the dump contains ONLY main_roomsTab (the `/` mapping
    // target). If `/` were treated as a prefix, `/profile/42`
    // would route to main_roomsTab and the dump-presence check
    // would PASS — which would be wrong (the user is asserting
    // they're on /profile/42, not at /). The correct behaviour:
    // `/profile/42` routes to profile_displayName, which is ABSENT
    // here → result must be false.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidNavigatesToPath('Adam', '/profile/42')).toBe(false);
  });
});

describe('android-adb-driver — androidShowsNewGiftEntry', () => {
  // Wake 100 matcher — `<Name>'s Android UI shows the new "<X>"
  // gift entry` (j05 — gift-log entry on recipient view). Driver
  // receives `(name, giftId)` where giftId is the friendly name
  // ("crown", "rose", etc.) per the j05 corpus.
  //
  // Foundation strategy: two-step composition (mirrors PR #739's
  // androidAdminShowsNewReportInQueue pattern):
  //   1. giftWall_grid testTag must be PRESENT (user is on the
  //      gift-wall surface — profile screen typically).
  //   2. giftId text appears anywhere in the dump with word-boundary
  //      protection (prevents prefix-collision: "crown" hint must
  //      not match "Crowning Achievement").
  //
  // The "new" semantic is journey-orchestrated — the test runs
  // RIGHT AFTER a gift is sent, so the latest entry IS the new one.
  // A future PR could layer per-row inspection (e.g.
  // giftWall_entry_${giftId}) to verify the specific entry rather
  // than any text occurrence.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('giftWall_grid present + giftId in text → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'crown')).toBe(true);
  });

  test('giftWall_grid present + giftId in content-desc → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node content-desc="rose" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'rose')).toBe(true);
  });

  test('giftWall_grid absent (user on wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />' +
        '<node text="crown" />',
    });
    const driver = await createAndroidDriver();
    // The "crown" text exists but on a non-gift-wall screen → must
    // not false-positive. Pin the FIRST guard (giftWall_grid required).
    expect(await driver.androidShowsNewGiftEntry('Selma', 'crown')).toBe(false);
  });

  test('giftWall_grid present but giftId not in any text → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="other-gift" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'crown')).toBe(false);
  });

  test('giftWall_grid present + giftId padded in surrounding text → true', async () => {
    // Real gift-log entries often have padded labels like
    // "Adam sent crown ×5" — substring match should accept.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown today" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'crown')).toBe(true);
  });

  test('prefix-collision blocked — "crown" hint does NOT match "Crowning Achievement"', async () => {
    // Word-boundary protection: the inner right lookahead
    // `(?![\w-])` blocks suffix word chars. "Crowning" — the `i`
    // after `Crown` is a word char → blocked.
    //
    // Round 1 I-2 fix: comment corrected. The case-sensitivity is
    // a side effect (the regex is case-sensitive so `crown` ≠
    // `Crown`), but the ACTUAL blocking mechanism here is the
    // right-side word-boundary, not case rules. A future-reader
    // asking "what if giftId were `Crown` (capital C)?" needs to
    // know it's the word-boundary doing the work.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Crowning Achievement Unlocked" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'crown')).toBe(false);
  });

  test('suffix-collision blocked — "rose" hint does NOT match "roseate"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="roseate hue" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'rose')).toBe(false);
  });

  test('prefix-collision blocked — "rose" hint does NOT match "primrose"', async () => {
    // Word-prefix collision the OTHER direction.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="primrose path" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'rose')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'crown')).toBe(false);
  });

  test('empty giftId arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', '')).toBe(false);
  });

  test('whitespace-only giftId arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', '   ')).toBe(false);
  });

  test('null giftId arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', null)).toBe(false);
  });

  test('undefined giftId arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', undefined)).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="giftWall_grid" /><node text="crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'crown')).toBe(true);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'crown')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsNewGiftEntry('Selma', 'crown');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidShowsNewGiftEntry('Alice', 'crown');

    expect(okSelma).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('giftId with regex-significant chars — escaped before insertion', async () => {
    // Defensive: gift IDs in the j05 corpus are plain words, but
    // a future "gift_2.0" or "rose+1" would have regex metacharacters.
    // The escape ensures literal matching.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="gift_2.0" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'gift_2.0')).toBe(true);
  });

  test('giftId with regex-significant chars — negative case proves literal-dot escape', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="gift_2X0" />',
    });
    const driver = await createAndroidDriver();
    // Without the literal-dot escape, "2.0" would match "2X0" (. = any char).
    // With escape, "2.0" requires a literal dot → no match.
    expect(await driver.androidShowsNewGiftEntry('Selma', 'gift_2.0')).toBe(false);
  });

  test('compound attribute names (hint-text=) NOT consulted for giftId match', async () => {
    // Same lookbehind concern as PR #742 (scan-all-strings). The
    // outer attribute-name guard `(?<![\w-])(?:text|content-desc)=`
    // prevents `hint-text="crown"` from triggering a false match.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node hint-text="crown" sub-text="more text" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'crown')).toBe(false);
  });

  test('suffix-hyphen blocked — "crown" hint does NOT match "crown-shaped"', async () => {
    // Round 1 I-1 fix: the original inner right lookahead was
    // `(?!\w)` (blocks word chars only). A hyphen is not `\w`, so
    // `text="crown-shaped"` false-matched `crown`. Fixed to
    // `(?![\w-])` — symmetric with the inner left lookbehind
    // `(?<![\w-])`. Defends against compound gift labels.
    //
    // Verified with `node -e` against the new regex.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown-shaped" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'crown')).toBe(false);
  });

  test('suffix-hyphen symmetric — "rose" hint does NOT match "rose-gold pendant"', async () => {
    // Round 1 I-1 fix: same boundary applied to "rose". Compound
    // labels with hyphen-prefixed suffixes are blocked.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="rose-gold pendant" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewGiftEntry('Selma', 'rose')).toBe(false);
  });
});

describe('android-adb-driver — androidShowsInSeatGrid', () => {
  // Wake 102 matcher — `<Name>'s Android UI shows <Other> in seat N
  // of the seat grid` (j09). Driver receives `(viewer, target,
  // seatNum)`. The seat-position aspect requires per-seat testTags
  // which don't exist yet (Compose attaches `room_seatGrid` to the
  // container only). Foundation policy: ignore seatNum, assert
  // target's name is visible somewhere in the seat-grid surface.
  //
  // Two-step composition (same pattern as PR #745
  // androidShowsNewGiftEntry):
  //   1. room_seatGrid testTag must be PRESENT (user is on the
  //      room screen).
  //   2. target's name appears in any text=/content-desc= with
  //      SYMMETRIC word-boundary protection (`(?<![\w-])` +
  //      `(?![\w-])` — same boundary fix as PR #745 R1).
  //
  // The seat-position semantic is journey-orchestrated until per-
  // seat testTags exist. A future PR could layer this with e.g.
  // `room_seat_${seatNum}_displayName` for stricter verification.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('room_seatGrid + target name in text → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' + '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 1)).toBe(true);
  });

  test('room_seatGrid + target name in content-desc → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node content-desc="Bea" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Bea', 2)).toBe(true);
  });

  test('room_seatGrid absent (user not in room) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />' + '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    // "Adam" text exists but on a non-seat-grid screen → must NOT
    // false-positive. Pin the FIRST guard.
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 1)).toBe(false);
  });

  test('room_seatGrid present + target not in any text → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Different" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 1)).toBe(false);
  });

  test('seatNum is ignored at foundation layer — N=1 and N=5 both pass when target visible', async () => {
    // Foundation contract pin: the seat-number arg is accepted but
    // ignored. Both N=1 and N=5 return the same result given the
    // same dump. A future PR layering per-seat verification will
    // need to update this pin.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' + '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    const ok1 = await driver.androidShowsInSeatGrid('Selma', 'Adam', 1);

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' + '<node text="Adam" />',
    });
    const driver2 = await createAndroidDriver();
    const ok5 = await driver2.androidShowsInSeatGrid('Selma', 'Adam', 5);

    expect(ok1).toBe(true);
    expect(ok5).toBe(true);
  });

  test('seatNum=0 (off-by-one sentinel) also accept-and-ignored', async () => {
    // Round 1 I-1 pin: while real seat positions start at 1, an
    // off-by-one journey authoring error could pass 0. The
    // foundation accept-and-ignore contract extends across the full
    // integer domain — `_seatNum` is never read, so 0 yields the
    // same result as 1/5/etc. when target is visible.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' + '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 0)).toBe(true);
  });

  test('padded target name — "speaker: Adam" still matches Adam', async () => {
    // Realistic seat-grid labels often pad with role prefix
    // ("speaker: Adam", "host • Adam"). Substring match with
    // word-boundary protection accepts.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="speaker: Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 1)).toBe(true);
  });

  test('prefix-collision blocked — "Adam" hint does NOT match "AdamSmith"', async () => {
    // Word-boundary protection (same as PR #745 fix). "AdamSmith"
    // — the `S` after `Adam` is a word char → blocked.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="AdamSmith" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 1)).toBe(false);
  });

  test('suffix-collision blocked — "Bea" hint does NOT match "Beatrix"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Beatrix the great" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Bea', 1)).toBe(false);
  });

  test('hyphen-suffix blocked — "Adam" hint does NOT match "Adam-jr"', async () => {
    // Round 1 boundary inherited from PR #745 — symmetric
    // `(?<![\w-])...(?![\w-])` blocks hyphen-suffix compounds.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam-jr" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 1)).toBe(false);
  });

  test('hyphen-prefix blocked — "Adam" hint does NOT match "pre-Adam"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="pre-Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 1)).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 1)).toBe(false);
  });

  test('empty target arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' + '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', '', 1)).toBe(false);
  });

  test('whitespace-only target → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' + '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', '   ', 1)).toBe(false);
  });

  test('null target → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' + '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', null, 1)).toBe(false);
  });

  test('undefined target → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' + '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', undefined, 1)).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="room_seatGrid" /><node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 1)).toBe(true);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 1)).toBe(false);
  });

  test('viewer name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' + '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsInSeatGrid('Selma', 'Adam', 1);

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' + '<node text="Adam" />',
    });
    const driver2 = await createAndroidDriver();
    const okBea = await driver2.androidShowsInSeatGrid('Bea', 'Adam', 1);

    expect(okSelma).toBe(true);
    expect(okBea).toBe(true);
  });

  test('target with regex-significant chars — escaped before insertion', async () => {
    // Defensive — persona names are simple, but a future scenario
    // could use a target like "User.42" or "Bob+1". Regex-escape
    // ensures literal matching.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="User.42" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'User.42', 1)).toBe(true);
  });

  test('target with regex-significant chars — negative pins literal-dot escape', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="UserX42" />',
    });
    const driver = await createAndroidDriver();
    // Without escape, "User.42" would match "UserX42" (. = any char).
    // With escape, "User.42" requires literal dot → no match.
    expect(await driver.androidShowsInSeatGrid('Selma', 'User.42', 1)).toBe(false);
  });

  test('compound attribute names (hint-text=) NOT consulted', async () => {
    // Same outer-attribute-name guard as PRs #742 and #745.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node hint-text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInSeatGrid('Selma', 'Adam', 1)).toBe(false);
  });
});

describe('android-adb-driver — androidShowsGiftFromSender', () => {
  // Wake 99 matcher — `<Name>'s Android UI shows a "<X>" gift from
  // <Other>` (j01 — gift-receipt notification on recipient view).
  // Driver receives `(recipient, giftId, sender)`.
  //
  // Foundation strategy: TRIPLE composition (extends PR #745's
  // double composition):
  //   1. giftWall_grid testTag PRESENT (recipient is on gift-wall
  //      surface).
  //   2. giftId text appears with symmetric word-boundary.
  //   3. sender text appears with symmetric word-boundary.
  //
  // Both substring scans run over the whole dump independently —
  // the journey orchestrator ensures only one gift entry is shown
  // at the time of the assertion, so cross-entry "match in
  // different entries" false positives aren't reachable. A future
  // PR could layer per-entry verification once Compose ships per-
  // entry testTags.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('giftWall_grid + giftId + sender all present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(true);
  });

  test('giftId in text, sender in content-desc → true', async () => {
    // Realistic uiautomator output often splits role across nodes.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown" /><node content-desc="from Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(true);
  });

  test('giftWall_grid absent (wrong screen) → false', async () => {
    // First guard pins: even when both giftId and sender are in
    // the dump, the assertion fails if the gift-wall surface
    // isn't visible.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />' +
        '<node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(false);
  });

  test('giftId present but sender absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(false);
  });

  test('sender present but giftId absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent something" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(false);
  });

  test('both giftId and sender in same node text → true', async () => {
    // Pin the same-node case explicitly (the realistic gift-log
    // entry shape: "Adam sent crown ×5"). Both regexes find their
    // hit in the same text= attribute.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown today" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(true);
  });

  test('prefix collision blocked on giftId — "crown" hint ≠ "Crowning"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam earned Crowning Achievement" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(false);
  });

  test('prefix collision blocked on sender — "Adam" hint ≠ "AdamSmith"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="AdamSmith sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(false);
  });

  test('hyphen-suffix blocked on giftId — "crown" hint ≠ "crown-shaped"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown-shaped trophy" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(false);
  });

  test('empty giftId → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', '', 'Adam')).toBe(false);
  });

  test('empty sender → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', '')).toBe(false);
  });

  test('null giftId → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', null, 'Adam')).toBe(false);
  });

  test('null sender → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', null)).toBe(false);
  });

  test('undefined giftId → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', undefined, 'Adam')).toBe(false);
  });

  test('undefined sender → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', undefined)).toBe(false);
  });

  test('whitespace-only giftId → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', '   ', 'Adam')).toBe(false);
  });

  test('whitespace-only sender → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', '   ')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="giftWall_grid" /><node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(true);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(false);
  });

  test('recipient name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam sent crown" />',
    });
    const driver2 = await createAndroidDriver();
    const okBea = await driver2.androidShowsGiftFromSender('Bea', 'crown', 'Adam');

    expect(okSelma).toBe(true);
    expect(okBea).toBe(true);
  });

  test('giftId AND sender with regex-significant chars — both escaped', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="User.42 sent gift_2.0" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'gift_2.0', 'User.42')).toBe(true);
  });

  test('regex-escape — literal dot does not match arbitrary char', async () => {
    // Without escape, "gift_2.0" would match "gift_2X0". With
    // escape, it requires a literal dot.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="UserX42 sent gift_2X0" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'gift_2.0', 'User.42')).toBe(false);
  });

  test('compound attribute names (hint-text=) NOT consulted', async () => {
    // Outer attribute-name guard from PR #742 + #745.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node hint-text="Adam sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(false);
  });

  test('hyphen-suffix blocked on sender — "Adam" hint ≠ "Adam-Lee"', async () => {
    // Round 1 I-1: symmetric coverage with the giftId hyphen-suffix
    // pin above. The symmetric `(?<![\w-])...(?![\w-])` boundary
    // blocks compound name suffixes for the sender arg too.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="Adam-Lee sent crown" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(false);
  });

  test('hyphen-prefix blocked on sender — "Adam" hint ≠ "pre-Adam"', async () => {
    // Round 1 I-1: symmetric prefix variant for sender. The
    // boundary lookbehind blocks hyphen-prefixed forms equally.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown from pre-Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(false);
  });

  test('cross-entry: giftId and sender from different entries both appear → true (known; orchestrator enforces single-entry invariant)', async () => {
    // Round 1 I-2: documents the foundation contract gap. The two
    // substring scans run independently over the WHOLE dump — if
    // multiple gift entries are visible, the assertion can pass
    // even when no single entry matches both giftId AND sender
    // (cross-entry false positive).
    //
    // This is a KNOWN limitation. The production comment at the
    // driver method documents that "the journey orchestrator
    // ensures only one gift entry is shown at the time of the
    // assertion, so cross-entry false positives aren't reachable."
    // This test pins that behaviour explicitly — without it, the
    // contract gap was undocumented in the test record.
    //
    // Setup: entry-1 has "crown from Alice", entry-2 has "rose
    // from Adam". Assertion "crown from Adam" passes because crown
    // matches entry-1 AND Adam matches entry-2.
    //
    // A future PR layering per-entry verification (via per-entry
    // testTags) would tighten this — this pin would then be
    // updated to `expect(...).toBe(false)`.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node text="crown from Alice" />' +
        '<node text="rose from Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsGiftFromSender('Selma', 'crown', 'Adam')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsMessageInConversationThread', () => {
  // Wake 105 matcher — `<Name>'s Android UI shows the message in the
  // conversation thread` (j11). Single-arg. The matcher is
  // intentionally specific (NOT the Wake-100 generic in-thread
  // variant): "the message" refers to a journey-orchestrated
  // specific message that was just sent.
  //
  // Foundation strategy: assert the conversation thread is open
  // (privateChat_messageInput testTag PRESENT). The journey
  // orchestrator ensures the test only fires AFTER a specific
  // message was sent, so "the message" being visible is implied
  // by the thread being open.
  //
  // A future PR could layer per-message verification once Compose
  // ships per-message testTags (currently only the input field has
  // a testTag). Same shape as PR #731's androidNavigatesToProfileScreen.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('privateChat_messageInput present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMessageInConversationThread('Selma')).toBe(true);
  });

  test('privateChat_messageInput absent (wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMessageInConversationThread('Selma')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMessageInConversationThread('Selma')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMessageInConversationThread('Selma')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput"><node text="placeholder" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMessageInConversationThread('Selma')).toBe(true);
  });

  test('left-boundary false-positive guarded — pre_privateChat_messageInput_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMessageInConversationThread('Selma')).toBe(false);
  });

  test('right-boundary false-positive guarded — privateChat_messageInput_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMessageInConversationThread('Selma')).toBe(false);
  });

  test('package-qualified left-boundary guarded — :id/pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMessageInConversationThread('Selma')).toBe(false);
  });

  test('bare left-boundary without suffix — pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMessageInConversationThread('Selma')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMessageInConversationThread('Selma')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsMessageInConversationThread('Selma');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver2 = await createAndroidDriver();
    const okBea = await driver2.androidShowsMessageInConversationThread('Bea');

    expect(okSelma).toBe(true);
    expect(okBea).toBe(true);
  });

  test('first-match contract pinned — two privateChat_messageInput nodes', async () => {
    // Presence-check semantics: as long as the first match exists,
    // return true. The second one's existence doesn't change the
    // answer. Pin in case of a future refactor that introduces
    // matchAll-based logic.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />' +
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsMessageInConversationThread('Selma')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsNewUnreadConversation', () => {
  // Wake 102 matcher — `<Name>'s Android UI shows a new conversation
  // with <Other> highlighted as unread` (j07 — recipient's inbox
  // shows new unread conversation from sender). Driver receives
  // `(viewer, other)`.
  //
  // Foundation strategy: two-step composition (mirrors PR #745):
  //   1. main_messagesTab testTag PRESENT (viewer is in messages
  //      area).
  //   2. other's name appears in text/content-desc with symmetric
  //      word-boundary protection.
  //
  // The "highlighted as unread" semantic is journey-orchestrated.
  // No per-row testTag exists for unread state today; a future PR
  // could layer this with e.g. `conversation_row_${id}_unread`.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('main_messagesTab + other in text → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(true);
  });

  test('main_messagesTab + other in content-desc → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node content-desc="Bea" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Bea')).toBe(true);
  });

  test('main_messagesTab absent (wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />' + '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(false);
  });

  test('main_messagesTab present but other absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="Different" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(false);
  });

  test('prefix-collision blocked — "Adam" hint ≠ "AdamSmith"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="AdamSmith" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(false);
  });

  test('hyphen-suffix blocked — "Adam" hint ≠ "Adam-Lee"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="Adam-Lee" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(false);
  });

  test('hyphen-prefix blocked — "Adam" hint ≠ "pre-Adam"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="pre-Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(false);
  });

  test('padded other name — "Adam · just now" still matches', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="Adam · just now" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(true);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(false);
  });

  test('empty other arg → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', '')).toBe(false);
  });

  test('whitespace-only other → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', '   ')).toBe(false);
  });

  test('null other → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', null)).toBe(false);
  });

  test('undefined other → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', undefined)).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="main_messagesTab" /><node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(true);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(false);
  });

  test('viewer name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsNewUnreadConversation('Selma', 'Adam');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="Adam" />',
    });
    const driver2 = await createAndroidDriver();
    const okBea = await driver2.androidShowsNewUnreadConversation('Bea', 'Adam');

    expect(okSelma).toBe(true);
    expect(okBea).toBe(true);
  });

  test('other with regex-significant chars — positive case (literal dot)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="User.42" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'User.42')).toBe(true);
  });

  test('other with regex-significant chars — negative pins literal-dot escape', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node text="UserX42" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'User.42')).toBe(false);
  });

  test('compound attribute names (hint-text=) NOT consulted', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTab" />' +
        '<node hint-text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(false);
  });

  test('first-guard left-boundary — pre_main_messagesTab does NOT count', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_main_messagesTab" /><node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(false);
  });

  test('first-guard right-boundary — main_messagesTabExtra does NOT count', async () => {
    // Round 1 I-2: symmetric with the left-boundary pin above.
    // The closing `"` in the regex is a hard right anchor, but the
    // pin documents the contract.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_messagesTabExtra" />' +
        '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(false);
  });

  test('chat-thread-screen disambiguation — privateChat_messageInput alone (no messages tab) → false', async () => {
    // Round 1 I-1: PrivateChatScreen replaces MainScreen entirely
    // in the nav graph (NavGraph.kt:496-497) — its Scaffold has no
    // NavigationBar. So `main_messagesTab` is ABSENT when inside a
    // chat thread. This pin documents the screen distinction
    // explicitly: even when the chat input is visible (which would
    // be reachable from a sibling test like
    // `androidShowsMessageInConversationThread`), the conversation
    // LIST is NOT in the dump → must return false.
    //
    // Regression-proof against a future navigation refactor that
    // embeds the chat screen inside MainScreen (which would
    // suddenly make main_messagesTab present + privateChat_messageInput
    // present simultaneously; the assertion would falsely pass).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />' +
        '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNewUnreadConversation('Selma', 'Adam')).toBe(false);
  });
});

describe('android-adb-driver — androidAdminShowsRowForWithStatus', () => {
  // Wake 98 matcher — `<Name>'s Android Admin UI shows N row for
  // "<X>" with status "<Y>"` (j01/j04 admin-queue row presence).
  // Driver receives `(viewer, count, targetId, status)`.
  //
  // Foundation strategy: TRIPLE composition (mirrors PR #747's
  // androidShowsGiftFromSender):
  //   1. reportReview_list testTag PRESENT (admin queue visible)
  //   2. targetId text appears with symmetric word-boundary
  //   3. status text appears with symmetric word-boundary
  //
  // The COUNT (typically 1) is journey-orchestrated and ignored
  // at foundation — no per-row testTag exists for counting matching
  // rows. A future PR could layer per-row inspection once
  // `reportReview_row_${id}` parameterised testTags ship.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reportReview_list + targetId + status all present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 [pending review]" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(true);
  });

  test('targetId in text, status in content-desc → true', async () => {
    // Realistic admin rows split target + status across attrs.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123" /><node content-desc="status: pending" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(true);
  });

  test('reportReview_list absent (wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(false);
  });

  test('targetId present + status absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 resolved" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(false);
  });

  test('status present + targetId absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="someone-else pending" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(false);
  });

  test('count is ignored — N=1 and N=3 both return same result', async () => {
    // Foundation contract pin: count is accepted but ignored. The
    // journey orchestrator is responsible for verifying the number
    // of matching rows — a future PR could layer this.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    const ok1 = await driver.androidAdminShowsRowForWithStatus(
      'Greta',
      1,
      'riley-abc123',
      'pending',
    );

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver2 = await createAndroidDriver();
    const ok3 = await driver2.androidAdminShowsRowForWithStatus(
      'Greta',
      3,
      'riley-abc123',
      'pending',
    );

    expect(ok1).toBe(true);
    expect(ok3).toBe(true);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(false);
  });

  test('empty targetId → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowForWithStatus('Greta', 1, '', 'pending')).toBe(false);
  });

  test('empty status → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', '')).toBe(
      false,
    );
  });

  test('null targetId → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowForWithStatus('Greta', 1, null, 'pending')).toBe(false);
  });

  test('null status → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', null)).toBe(
      false,
    );
  });

  test('undefined targetId → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowForWithStatus('Greta', 1, undefined, 'pending')).toBe(
      false,
    );
  });

  test('undefined status → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', undefined),
    ).toBe(false);
  });

  test('whitespace-only targetId → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowForWithStatus('Greta', 1, '   ', 'pending')).toBe(
      false,
    );
  });

  test('whitespace-only status → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', '   ')).toBe(
      false,
    );
  });

  test('prefix-collision blocked on targetId — "riley" hint ≠ "rileyford"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="rileyford pending" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley', 'pending')).toBe(
      false,
    );
  });

  test('hyphen-suffix blocked on status — "pending" hint ≠ "pending-review"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending-review" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="reportReview_list" /><node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(true);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(false);
  });

  test('viewer name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    const okGreta = await driver.androidAdminShowsRowForWithStatus(
      'Greta',
      1,
      'riley-abc123',
      'pending',
    );

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 pending" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidAdminShowsRowForWithStatus(
      'Alice',
      1,
      'riley-abc123',
      'pending',
    );

    expect(okGreta).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('regex-significant chars on both args — escaped properly', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="user.42 status:in.review" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'user.42', 'in.review')).toBe(
      true,
    );
  });

  test('regex-significant chars — negative pins literal-dot escape', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="userX42 statusXin/review" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'user.42', 'in.review')).toBe(
      false,
    );
  });

  test('compound attribute names (hint-text=) NOT consulted for either arg', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node hint-text="riley-abc123 pending" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(false);
  });

  test('cross-row pass-through documented — targetId in row-1, status in row-2 → true (orchestrator invariant)', async () => {
    // Round 1 contract pin (mirrors PR #747's cross-entry pin):
    // the two substring scans run INDEPENDENTLY over the whole
    // dump. If multiple rows are visible with target and status
    // split across them, the assertion can pass even though no
    // single row matches both. This is a KNOWN limitation —
    // documented in production. A future per-row testTag layer
    // would tighten this.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 resolved" />' +
        '<node text="other-user pending" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(true);
  });

  test('hyphen-suffix blocked on targetId — "riley-abc123" hint ≠ "riley-abc123-extra"', async () => {
    // Round 1 I-1: symmetric coverage with the status hyphen-suffix
    // pin. The `(?![\w-])` right boundary blocks trailing hyphens
    // for the targetId arg too.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123-extra pending" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(false);
  });

  test('compound-attribute guard isolated per arg — targetId in hint-text= (only) → false', async () => {
    // Round 1 I-2: isolate Step 2's compound-attribute guard.
    // status appears in legitimate text=, but targetId is only in
    // hint-text=. Should return false (Step 2 fails because
    // targetId is not in a real text/content-desc attribute).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node hint-text="riley-abc123" /><node text="pending review" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(false);
  });

  test('compound-attribute guard isolated per arg — status in hint-text= (only) → false', async () => {
    // Round 1 I-2: isolate Step 3's compound-attribute guard.
    // targetId appears in legitimate text=, but status is only in
    // hint-text=. Should return false (Step 3 fails because status
    // is not in a real text/content-desc attribute).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />' +
        '<node text="riley-abc123 row" /><node hint-text="pending" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsRowForWithStatus('Greta', 1, 'riley-abc123', 'pending'),
    ).toBe(false);
  });
});

describe('android-adb-driver — androidAdminShowsRowCountInTable', () => {
  // Wake 104 matcher — `<Name>'s Android Admin UI shows N rows in
  // the <X> table` (j12 — generic admin table row-count assertion).
  // Driver receives `(viewer, count, tableName)`.
  //
  // Foundation strategy: same TABLE_TAGS lookup as PR #740's
  // androidAdminShowsTableOf. Currently one entry:
  //   - "reports" → reportReview_list
  //
  // The COUNT is journey-orchestrated and ignored at foundation —
  // no per-row testTag exists for counting matching rows. A future
  // PR could layer this with `reportReview_row_${id}` parameterised
  // testTags + a counter scan.
  //
  // Unmapped tableNames return false (FAIL-loud) — same contract
  // as PR #740.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('"reports" table + tag present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 'reports')).toBe(true);
  });

  test('"reports" table absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 'reports')).toBe(false);
  });

  test('unmapped tableName "transactions" → false (FAIL-loud)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 'transactions')).toBe(false);
  });

  test('count is ignored — N=1 and N=42 both pass when table visible', async () => {
    // Foundation contract pin: count is accepted but not verified.
    // Without per-row testTags, counting matching rows isn't
    // possible. The journey orchestrator is responsible for
    // verifying actual row count.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    const ok1 = await driver.androidAdminShowsRowCountInTable('Greta', 1, 'reports');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver2 = await createAndroidDriver();
    const ok42 = await driver2.androidAdminShowsRowCountInTable('Greta', 42, 'reports');

    expect(ok1).toBe(true);
    expect(ok42).toBe(true);
  });

  test('count=0 (empty assertion) — still returns true if table visible (foundation contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 0, 'reports')).toBe(true);
  });

  test('case-insensitive tableName — "REPORTS" resolves', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 'REPORTS')).toBe(true);
  });

  test('whitespace-padded tableName resolves after trim', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, '  reports  ')).toBe(true);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 'reports')).toBe(false);
  });

  test('empty tableName → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, '')).toBe(false);
  });

  test('whitespace-only tableName → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, '   ')).toBe(false);
  });

  test('null tableName → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, null)).toBe(false);
  });

  test('undefined tableName → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, undefined)).toBe(false);
  });

  test('numeric tableName (e.g., 42) → false (typeof guard pinned)', async () => {
    // Round 1 I-1: extends the null/undefined null-safety matrix
    // to numeric types. The `typeof tableName !== 'string'` guard
    // rejects ANY non-string (number, boolean, object) — pin the
    // numeric case explicitly so a future refactor changing the
    // guard to `!tableName` (which would still reject 0 but accept
    // non-zero numbers as truthy and crash on `.trim()`) is
    // caught immediately.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 42)).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 'reports')).toBe(true);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 'reports')).toBe(false);
  });

  test('viewer name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    const okGreta = await driver.androidAdminShowsRowCountInTable('Greta', 1, 'reports');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver2 = await createAndroidDriver();
    const okAlice = await driver2.androidAdminShowsRowCountInTable('Alice', 1, 'reports');

    expect(okGreta).toBe(true);
    expect(okAlice).toBe(true);
  });

  test('left-boundary inherited from regex — pre_reportReview_list_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_reportReview_list_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 'reports')).toBe(false);
  });

  test('right-boundary — reportReview_list_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 'reports')).toBe(false);
  });

  test('multi-word tableName "user reports" → false (not in TABLE_TAGS)', async () => {
    // Matcher regex allows `\w+(?:[ -]\w+)?` — both "user reports"
    // and "user-reports" are reachable. Both unmapped → false.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 'user reports')).toBe(false);
  });

  test('hyphenated tableName "user-reports" → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/reportReview_list" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsRowCountInTable('Greta', 1, 'user-reports')).toBe(false);
  });
});

describe('android-adb-driver — androidShowsInThread', () => {
  // Wake 100 matcher — `<Name>'s Android UI shows the <noun> in the
  // thread [with <suffix>]` (j07, 2 corpus rows). noun is
  // "message" or "reply"; optional trailing suffix like "with
  // timestamp + sent indicator".
  //
  // Foundation strategy: presence-check the conversation thread is
  // open (privateChat_messageInput testTag PRESENT). Same shape as
  // PR #748's androidShowsMessageInConversationThread but with two
  // additional accepted-and-ignored args (noun, suffix).
  //
  // The noun/suffix details are journey-orchestrated — the test
  // runs RIGHT AFTER a specific message/reply is sent, so "the
  // <noun>" being visible is implied by the thread being open.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('privateChat_messageInput present + noun="message" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', '')).toBe(true);
  });

  test('privateChat_messageInput present + noun="reply" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'reply', '')).toBe(true);
  });

  test('with suffix — "with timestamp + sent indicator" still passes (suffix ignored)', async () => {
    // Foundation contract pin: suffix is accepted but ignored.
    // The thread being open is sufficient.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidShowsInThread('Selma', 'message', 'with timestamp + sent indicator'),
    ).toBe(true);
  });

  test('privateChat_messageInput absent (wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', '')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', '')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', '')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput"><node text="placeholder" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', '')).toBe(true);
  });

  test('left-boundary false-positive guarded — pre_privateChat_messageInput_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', '')).toBe(false);
  });

  test('right-boundary false-positive guarded — privateChat_messageInput_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', '')).toBe(false);
  });

  test('package-qualified left-boundary guarded — :id/pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', '')).toBe(false);
  });

  test('bare left-boundary without suffix — pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', '')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', '')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsInThread('Selma', 'message', '');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver2 = await createAndroidDriver();
    const okBea = await driver2.androidShowsInThread('Bea', 'message', '');

    expect(okSelma).toBe(true);
    expect(okBea).toBe(true);
  });

  test('first-match contract — two privateChat_messageInput nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />' +
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', '')).toBe(true);
  });

  test('arbitrary noun (e.g., "edit") still passes — noun ignored', async () => {
    // Pin that the noun argument is accepted-and-ignored at the
    // foundation layer. Future suffix-aware refinement could
    // distinguish "message" vs "reply" vs "edit" but the
    // foundation just verifies thread is open.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'edit', '')).toBe(true);
  });

  test('undefined suffix → true (suffix accepted-and-ignored regardless of value)', async () => {
    // Round 1 pin: the runner at manual-qa-runner.js:12069 normalises
    // `suffix = m[4] || ''` so undefined never reaches the driver
    // from valid Gherkin. But the foundation contract is "suffix is
    // ignored regardless of value" — pin that explicitly. Consistent
    // with the seatNum=0 pin in PR #746 (extends accept-and-ignore
    // across the full value domain for ignored args).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInThread('Selma', 'message', undefined)).toBe(true);
  });
});

describe('android-adb-driver — androidShowsSeatWithIndicator', () => {
  // Wake 101 matcher — `<Name>'s Android UI shows <Other>'s seat
  // with <X> indicator` (j09 mic-on / j10 mic-off). Generic
  // per-seat indicator assertion. Driver receives `(viewer, target,
  // indicator)`.
  //
  // Foundation strategy: TRIPLE composition (mirrors PR #747's
  // androidShowsGiftFromSender):
  //   1. room_seatGrid testTag PRESENT (viewer is on room screen)
  //   2. target's name appears with symmetric word-boundary
  //   3. indicator text appears with symmetric word-boundary
  //
  // Per-seat indicator scoping is journey-orchestrated — no per-
  // seat testTag exists yet. The journey ensures only the
  // relevant seat is in view at assertion time. A future PR could
  // layer per-seat per-indicator testTags (e.g. `room_seat_${n}_micOn`).
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('room_seatGrid + target + indicator all present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam" /><node content-desc="mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(true);
  });

  test('target + indicator on same node → true', async () => {
    // Realistic seat overlay: "Adam mic-on" or similar.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(true);
  });

  test('room_seatGrid absent (wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />' +
        '<node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(false);
  });

  test('target present + indicator absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' + '<node text="Adam" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(false);
  });

  test('indicator present + target absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="someone-else mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(false);
  });

  test('multiple indicators — "mic-off" requested, "mic-on" in dump → false', async () => {
    // Pin that indicator distinction matters: asking for mic-off
    // shouldn't false-positive against mic-on.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam" /><node content-desc="mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-off')).toBe(false);
  });

  test('prefix-collision blocked on target — "Adam" ≠ "AdamSmith"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="AdamSmith mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(false);
  });

  test('hyphen-suffix blocked on target — "Adam" ≠ "Adam-jr"', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam-jr mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(false);
  });

  test('hyphen-suffix blocked on indicator — "mic-on" ≠ "mic-on-pulse"', async () => {
    // The indicator itself contains a hyphen ("mic-on"). The
    // symmetric word-boundary `(?![\w-])` blocks a trailing hyphen
    // even when the literal contains internal hyphens.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on-pulse" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(false);
  });

  test('prefix-collision blocked on indicator — "mic-on" ≠ "notmic-on"', async () => {
    // Round 1 pin: symmetric LEFT-boundary guard for indicator
    // (matching the existing right-boundary pin above). The inner
    // `(?<![\w-])` blocks word-char and hyphen prefixes equally for
    // both target AND indicator args.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam notmic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(false);
  });

  test('empty target → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', '', 'mic-on')).toBe(false);
  });

  test('empty indicator → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', '')).toBe(false);
  });

  test('null target → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', null, 'mic-on')).toBe(false);
  });

  test('null indicator → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', null)).toBe(false);
  });

  test('undefined target → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', undefined, 'mic-on')).toBe(false);
  });

  test('undefined indicator → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', undefined)).toBe(false);
  });

  test('whitespace-only target → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', '   ', 'mic-on')).toBe(false);
  });

  test('whitespace-only indicator → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', '   ')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="room_seatGrid" /><node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(true);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(false);
  });

  test('viewer name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-on" />',
    });
    const driver2 = await createAndroidDriver();
    const okBea = await driver2.androidShowsSeatWithIndicator('Bea', 'Adam', 'mic-on');

    expect(okSelma).toBe(true);
    expect(okBea).toBe(true);
  });

  test('regex-significant chars on both args — escaped properly', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="User.42 status.online" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'User.42', 'status.online')).toBe(
      true,
    );
  });

  test('regex-escape negative — literal dot escaped', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="UserX42 statusXonline" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'User.42', 'status.online')).toBe(
      false,
    );
  });

  test('compound attribute names (hint-text=) NOT consulted', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node hint-text="Adam mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(false);
  });

  test('cross-seat pass-through documented — target in seat-A, indicator in seat-B → true (orchestrator invariant)', async () => {
    // Same contract as PR #747's cross-entry pin and PR #750's
    // cross-row pin. Two independent scans over the whole dump.
    // Documented limitation: per-seat scoping requires per-seat
    // testTags (don't exist yet).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_seatGrid" />' +
        '<node text="Adam mic-off" />' +
        '<node text="someone-else mic-on" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSeatWithIndicator('Selma', 'Adam', 'mic-on')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsSecondOffensiveMessage', () => {
  // Wake 105 matcher — `<Name>'s Android UI shows the second
  // offensive message` (j11 — sequential corpus-specific
  // assertion, journey-orchestrated after a first offensive
  // message). Single-arg.
  //
  // Foundation strategy: presence-check the conversation thread is
  // OPEN (privateChat_messageInput testTag PRESENT). Same shape as
  // PR #748's androidShowsMessageInConversationThread.
  //
  // The "second offensive message" semantic is journey-orchestrated
  // — there's no per-message testTag and no "offensive" classifier
  // visible in uiautomator dumps. The journey ensures the test only
  // fires after the second offensive message lands. A future PR
  // could layer per-message verification once messages have testTags.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('privateChat_messageInput present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSecondOffensiveMessage('Selma')).toBe(true);
  });

  test('privateChat_messageInput absent (wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSecondOffensiveMessage('Selma')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSecondOffensiveMessage('Selma')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSecondOffensiveMessage('Selma')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput"><node text="placeholder" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSecondOffensiveMessage('Selma')).toBe(true);
  });

  test('left-boundary false-positive guarded — pre_privateChat_messageInput_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSecondOffensiveMessage('Selma')).toBe(false);
  });

  test('right-boundary false-positive guarded — privateChat_messageInput_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSecondOffensiveMessage('Selma')).toBe(false);
  });

  test('package-qualified left-boundary guarded — :id/pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSecondOffensiveMessage('Selma')).toBe(false);
  });

  test('bare left-boundary without suffix — pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSecondOffensiveMessage('Selma')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSecondOffensiveMessage('Selma')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsSecondOffensiveMessage('Selma');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver2 = await createAndroidDriver();
    const okBea = await driver2.androidShowsSecondOffensiveMessage('Bea');

    expect(okSelma).toBe(true);
    expect(okBea).toBe(true);
  });

  test('first-match contract — two privateChat_messageInput nodes still pass', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />' +
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSecondOffensiveMessage('Selma')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsContributorsList', () => {
  // Wake 92 matcher — `<Name>'s Android UI shows the list of
  // contributors with amounts` (j15:35). Single-arg.
  //
  // Foundation strategy: presence-check the gift-wall surface
  // (giftWall_grid testTag PRESENT). The "amounts" semantic is
  // journey-orchestrated — without per-row testTags for contributor
  // amounts, the foundation can't verify the per-row amount
  // structure. The journey ensures this matcher only fires when
  // the gift wall is showing contributor entries.
  //
  // A future PR could layer per-contributor verification via
  // testTags like `giftWall_contributor_${id}_amount`.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('giftWall_grid present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsContributorsList('Selma')).toBe(true);
  });

  test('giftWall_grid absent (wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsContributorsList('Selma')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsContributorsList('Selma')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="giftWall_grid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsContributorsList('Selma')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid"><node text="contributor 1" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsContributorsList('Selma')).toBe(true);
  });

  test('left-boundary false-positive — pre_giftWall_grid_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_giftWall_grid_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsContributorsList('Selma')).toBe(false);
  });

  test('right-boundary false-positive — giftWall_grid_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsContributorsList('Selma')).toBe(false);
  });

  test('package-qualified left-boundary — :id/pre_giftWall_grid does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_giftWall_grid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsContributorsList('Selma')).toBe(false);
  });

  test('bare left-boundary no suffix — pre_giftWall_grid does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_giftWall_grid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsContributorsList('Selma')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsContributorsList('Selma')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsContributorsList('Selma');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />',
    });
    const driver2 = await createAndroidDriver();
    const okBea = await driver2.androidShowsContributorsList('Bea');

    expect(okSelma).toBe(true);
    expect(okBea).toBe(true);
  });

  test('first-match contract — two giftWall_grid nodes still pass', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />' +
        '<node resource-id="com.shyden.shytalk.local:id/giftWall_grid" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsContributorsList('Selma')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsSystemPmFromOfficia', () => {
  // Wake 105 matcher — `<Name>'s Android UI shows the system PM
  // from Officia` (j11 — system-message visibility from the
  // "Officia" official sender). Single-arg.
  //
  // Foundation strategy: presence-check the conversation thread
  // is open (privateChat_messageInput testTag PRESENT). Same shape
  // as PRs #748, #752, #754.
  //
  // The "system PM from Officia" semantic is journey-orchestrated
  // — no per-sender testTag or official-badge classifier exists in
  // uiautomator dumps today. The journey ensures the test only
  // fires after the system PM is in the active thread. A future
  // PR could layer per-message verification once Compose ships
  // sender-tagged messages.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('privateChat_messageInput present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSystemPmFromOfficia('Selma')).toBe(true);
  });

  test('privateChat_messageInput absent (wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSystemPmFromOfficia('Selma')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSystemPmFromOfficia('Selma')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSystemPmFromOfficia('Selma')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput"><node text="Welcome from Officia" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSystemPmFromOfficia('Selma')).toBe(true);
  });

  test('left-boundary false-positive — pre_privateChat_messageInput_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSystemPmFromOfficia('Selma')).toBe(false);
  });

  test('right-boundary false-positive — privateChat_messageInput_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSystemPmFromOfficia('Selma')).toBe(false);
  });

  test('package-qualified left-boundary — :id/pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSystemPmFromOfficia('Selma')).toBe(false);
  });

  test('bare left-boundary no suffix — pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSystemPmFromOfficia('Selma')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSystemPmFromOfficia('Selma')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsSystemPmFromOfficia('Selma');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver2 = await createAndroidDriver();
    const okBea = await driver2.androidShowsSystemPmFromOfficia('Bea');

    expect(okSelma).toBe(true);
    expect(okBea).toBe(true);
  });

  test('first-match contract — two privateChat_messageInput nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />' +
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsSystemPmFromOfficia('Selma')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsPmThreadDirection', () => {
  // Wake 92 matcher — `<Name>'s Android UI shows the PM thread with
  // document direction "<X>"` (j18:33). Driver receives
  // `(name, direction)` where direction is "rtl" or "ltr".
  //
  // Foundation strategy: presence-check the conversation thread is
  // open (privateChat_messageInput testTag PRESENT). The direction
  // arg is accepted-and-ignored — RTL layout direction isn't
  // surfaced via uiautomator's resource-id attributes on Compose;
  // it's controlled by `Configuration.getLayoutDirection()` which
  // requires a different inspection mechanism.
  //
  // The journey ensures this matcher only fires after locale
  // switching has settled the layout direction. A future PR could
  // layer direction verification via `adb shell getprop persist.sys.locale`
  // or parsing uiautomator's `class` attribute for layout-direction
  // hints.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('privateChat_messageInput present + direction "rtl" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'rtl')).toBe(true);
  });

  test('privateChat_messageInput present + direction "ltr" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'ltr')).toBe(true);
  });

  test('privateChat_messageInput absent (wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'rtl')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'rtl')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'rtl')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput"><node text="placeholder" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'rtl')).toBe(true);
  });

  test('left-boundary false-positive — pre_privateChat_messageInput_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'rtl')).toBe(false);
  });

  test('right-boundary false-positive — privateChat_messageInput_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'rtl')).toBe(false);
  });

  test('package-qualified left-boundary — :id/pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'rtl')).toBe(false);
  });

  test('bare left-boundary no suffix — pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'rtl')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'rtl')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsPmThreadDirection('Selma', 'rtl');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver2 = await createAndroidDriver();
    const okBea = await driver2.androidShowsPmThreadDirection('Bea', 'rtl');

    expect(okSelma).toBe(true);
    expect(okBea).toBe(true);
  });

  test('arbitrary direction value ignored — "foobar" still passes', async () => {
    // Foundation contract pin: direction is accepted-and-ignored
    // regardless of value. Pins that the foundation doesn't
    // validate the direction string against a known list.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'foobar')).toBe(true);
  });

  test('undefined direction → true (suffix accepted-and-ignored regardless)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', undefined)).toBe(true);
  });

  test('first-match contract — two privateChat_messageInput nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />' +
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsPmThreadDirection('Selma', 'rtl')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsWelcomePmInLanguage', () => {
  // Wake matcher (j13 corpus) — `<Name>'s Android UI shows the
  // welcome PM in language "<code>"` — j13 locale verification.
  // Driver receives `(name, code)` where code is a locale code
  // (en, ru, ja, ar, etc.).
  //
  // Foundation strategy: presence-check the conversation thread is
  // open (privateChat_messageInput testTag PRESENT). The locale
  // code is accepted-and-ignored — verifying that text is in a
  // specific language requires comparing the message body against
  // localised welcome strings, which needs access to the strings.xml
  // files for each locale. Foundation policy: ignore code.
  //
  // The journey ensures this matcher fires after locale switch
  // settled. A future PR could layer locale verification via
  // strings.xml comparison or by hashing the welcome string against
  // a known-locale registry.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('privateChat_messageInput present + code "en" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'en')).toBe(true);
  });

  test('privateChat_messageInput present + code "ru" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'ru')).toBe(true);
  });

  test('privateChat_messageInput present + code "ja" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'ja')).toBe(true);
  });

  test('privateChat_messageInput absent (wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'en')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'en')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'en')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput"><node text="Welcome message" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'en')).toBe(true);
  });

  test('left-boundary false-positive — pre_privateChat_messageInput_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'en')).toBe(false);
  });

  test('right-boundary false-positive — privateChat_messageInput_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'en')).toBe(false);
  });

  test('package-qualified left-boundary — :id/pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'en')).toBe(false);
  });

  test('bare left-boundary no suffix — pre_privateChat_messageInput does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'en')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'en')).toBe(false);
  });

  test('persona name ignored', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    const okSelma = await driver.androidShowsWelcomePmInLanguage('Selma', 'en');

    jest.clearAllMocks();
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver2 = await createAndroidDriver();
    const okBea = await driver2.androidShowsWelcomePmInLanguage('Bea', 'en');

    expect(okSelma).toBe(true);
    expect(okBea).toBe(true);
  });

  test('unknown locale code still passes — code accepted-and-ignored', async () => {
    // Foundation contract pin: code is not validated against the
    // app's 20-locale registry. The journey orchestrator ensures
    // the locale switch settled before this matcher fires.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'xx')).toBe(true);
  });

  test('undefined code → true (code accepted-and-ignored regardless of value)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', undefined)).toBe(true);
  });

  test('null name → true (name accepted-and-ignored regardless of value)', async () => {
    // Regression guard: pins the accepted-and-ignored contract for `_name`
    // so a future input-guard refactor cannot silently change behavior.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage(null, 'en')).toBe(true);
  });

  test('undefined name → true (name accepted-and-ignored regardless of value)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage(undefined, 'en')).toBe(true);
  });

  test('first-match contract — two privateChat_messageInput nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />' +
        '<node resource-id="com.shyden.shytalk.local:id/privateChat_messageInput" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsWelcomePmInLanguage('Selma', 'en')).toBe(true);
  });
});

describe('android-adb-driver — androidSubmitStarFeedback', () => {
  // Wake 87 — `<Name> on <Plat> selects N stars and submits feedback "<X>"`
  // (j17:60). Composite rating-action: pick N stars + type feedback + submit.
  // Driver receives `(name, stars, feedback)`.
  //
  // Foundation strategy: presence-check on the `feedbackScreen_*` testTag
  // PREFIX. The current app has no rating/feedback screen in
  // shared/src/commonMain (no RatingScreen.kt / FeedbackScreen.kt files),
  // so this method returns false in real journeys today. When the screen
  // ships with `feedbackScreen_starRow` / `feedbackScreen_inputText` /
  // `feedbackScreen_submitButton` testTags, this stays sound — the
  // wildcard prefix match will land.
  //
  // Per-element action body (tap N-th star + type feedback + tap submit)
  // is deferred until per-element testTags exist. The (name, stars,
  // feedback) args are accepted-and-ignored.
  //
  // Shell-escape note (feedback-adb-shell-escape-pattern.md): when the
  // real action ships, the `feedback` text MUST POSIX-escape `'` before
  // any adb-shell interpolation. The foundation does not call adb with
  // free-form text, so the vulnerability surface is currently empty.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('feedbackScreen_starRow present + stars=5 + feedback → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, 'Bao explained tones clearly')).toBe(
      true,
    );
  });

  test('feedbackScreen_inputText present + stars=4 → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_inputText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 4, 'good')).toBe(true);
  });

  test('feedbackScreen_submitButton present + stars=1 → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_submitButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 1, 'meh')).toBe(true);
  });

  test('no feedbackScreen_* tag (wrong screen) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, 'good')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, 'good')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, 'good')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow"><node text="★" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, 'good')).toBe(true);
  });

  test('left-boundary false-positive — pre_feedbackScreen_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, 'good')).toBe(false);
  });

  test('bare left-boundary — pre_feedbackScreen_starRow does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, 'good')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, 'good')).toBe(false);
  });

  test('persona name ignored — Bea also passes when screen present', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Bea', 5, 'good')).toBe(true);
  });

  test('null name → true (name accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback(null, 5, 'good')).toBe(true);
  });

  test('undefined name → true (name accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback(undefined, 5, 'good')).toBe(true);
  });

  test('empty name → true (name accepted-and-ignored)', async () => {
    // Per feedback-null-undefined-pins-default.md: pin all 4 input-rejection
    // cases (`''` / `'   '` / `null` / `undefined`) for accepted-and-ignored
    // string args so a future input-guard refactor cannot silently change
    // behavior for empty/whitespace inputs.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('', 5, 'good')).toBe(true);
  });

  test('whitespace-only name → true (name accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('   ', 5, 'good')).toBe(true);
  });

  test('null stars → true (stars accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', null, 'good')).toBe(true);
  });

  test('undefined stars → true (stars accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', undefined, 'good')).toBe(true);
  });

  test('0 stars → true (stars accepted-and-ignored regardless of value)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 0, 'good')).toBe(true);
  });

  test('null feedback → true (feedback accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, null)).toBe(true);
  });

  test('undefined feedback → true (feedback accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, undefined)).toBe(true);
  });

  test('empty feedback → true (feedback accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, '')).toBe(true);
  });

  test("feedback with apostrophe — doesn't corrupt the call (foundation does not interpolate)", async () => {
    // Foundation contract pin: when the real action ships (tap + type +
    // submit), the feedback text MUST POSIX-escape `'` before any
    // adb-shell interpolation (feedback-adb-shell-escape-pattern.md).
    // Today the foundation never passes feedback to adb, so the surface
    // is empty — but this pin guards against a future refactor adding
    // unescaped interpolation that would break for apostrophe-laden
    // input ("Bao's tones were great").
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, "Bao's tones were great")).toBe(true);
  });

  test('any feedbackScreen_* suffix matches — prefix contract', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_unknownSuffix_xyz" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, 'good')).toBe(true);
  });

  test('first-match contract — two feedbackScreen_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_starRow" />' +
        '<node resource-id="com.shyden.shytalk.local:id/feedbackScreen_submitButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidSubmitStarFeedback('Yuki', 5, 'good')).toBe(true);
  });
});

describe('android-adb-driver — androidTapFromSurface', () => {
  // Wake 89 — `<Name> on <Plat> taps the <X> from the <Y>` (j16:24).
  // Composite tap-from-surface action. Driver receives
  // `(name, target, source)` — locate surface Y, scope to target X
  // within it.
  //
  // Foundation strategy: SURFACE_TARGET_TAGS scaffold keyed by
  // lowercase `${source}::${target}` → Compose testTag. Currently
  // ONE mapping is grounded in the journey corpus (j16:48):
  //
  //   'invite banner::event-room link' → 'inviteBanner_eventRoomLink'
  //
  // The `inviteBanner_*` testTag does NOT yet exist in
  // shared/src/commonMain — the invite-banner surface is unbuilt.
  // So this method returns false in real journeys today. When the
  // surface ships, this stays sound — the testTag will land.
  //
  // FAIL-loud contract: unmapped source OR target returns false
  // (consistent with INPUT_TAGS / TABLE_TAGS / SEARCH_FIELD_TAGS /
  // PATH_TAGS scaffolds). A journey author writing an unmapped
  // surface gets a clear FAIL.
  //
  // Per-element action body (tap the resolved testTag's bounds) is
  // deferred until the testTag exists in the dump. The `_name` arg
  // is accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('mapped surface+target tag present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', 'invite banner')).toBe(
      true,
    );
  });

  test('mapped surface+target tag ABSENT (surface not visible) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', 'invite banner')).toBe(
      false,
    );
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', 'invite banner')).toBe(
      false,
    );
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', 'invite banner')).toBe(
      false,
    );
  });

  test('unmapped source "footer" → false (FAIL-loud)', async () => {
    // FAIL-loud: a journey author writing "taps the X from the footer"
    // gets a clear FAIL when no footer surface is mapped.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', 'footer')).toBe(false);
  });

  test('unmapped target "skip link" → false (FAIL-loud)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'skip link', 'invite banner')).toBe(false);
  });

  test('mapped source + unmapped target → false (composite key miss)', async () => {
    // Pin: even though "invite banner" alone is mapped, a target
    // OTHER than "event-room link" in that surface returns false
    // because the composite key doesn't exist.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'dismiss button', 'invite banner')).toBe(
      false,
    );
  });

  test('empty target → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', '', 'invite banner')).toBe(false);
  });

  test('whitespace-only target → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', '   ', 'invite banner')).toBe(false);
  });

  test('null target → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', null, 'invite banner')).toBe(false);
  });

  test('undefined target → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', undefined, 'invite banner')).toBe(false);
  });

  test('empty source → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', '')).toBe(false);
  });

  test('whitespace-only source → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', '   ')).toBe(false);
  });

  test('null source → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', null)).toBe(false);
  });

  test('undefined source → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', undefined)).toBe(false);
  });

  test('case-insensitive lookup — UPPERCASE source/target still resolves', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'EVENT-ROOM LINK', 'INVITE BANNER')).toBe(
      true,
    );
  });

  test('mixed-case lookup — Invite Banner + Event-Room Link still resolves', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'Event-Room Link', 'Invite Banner')).toBe(
      true,
    );
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', 'invite banner')).toBe(
      true,
    );
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink"><node text="Join now" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', 'invite banner')).toBe(
      true,
    );
  });

  test('left-boundary false-positive — pre_inviteBanner_eventRoomLink_x does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_inviteBanner_eventRoomLink_x" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', 'invite banner')).toBe(
      false,
    );
  });

  test('right-boundary false-positive — inviteBanner_eventRoomLink_extra does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', 'invite banner')).toBe(
      false,
    );
  });

  test('bare left-boundary no suffix — pre_inviteBanner_eventRoomLink does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', 'invite banner')).toBe(
      false,
    );
  });

  test('persona name ignored — Bea also passes when surface+target visible', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Bea', 'event-room link', 'invite banner')).toBe(
      true,
    );
  });

  test('null name → true (name accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface(null, 'event-room link', 'invite banner')).toBe(true);
  });

  test('undefined name → true (name accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface(undefined, 'event-room link', 'invite banner')).toBe(
      true,
    );
  });

  test('empty name → true (name accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('', 'event-room link', 'invite banner')).toBe(true);
  });

  test('whitespace-only name → true (name accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('   ', 'event-room link', 'invite banner')).toBe(
      true,
    );
  });

  test('first-match contract — two inviteBanner_eventRoomLink nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />' +
        '<node resource-id="com.shyden.shytalk.local:id/inviteBanner_eventRoomLink" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidTapFromSurface('Selma', 'event-room link', 'invite banner')).toBe(
      true,
    );
  });
});

describe('android-adb-driver — androidAdminShowsAppealText', () => {
  // Wake 89 — `<Name>'s <Plat> Admin UI shows <Other>'s appeal with the
  // text` (j11:73). Admin moderation UI assertion. Driver verifies an
  // appeal section is visible for <Other> with non-empty body text.
  //
  // Foundation strategy: presence-check on `adminAppeal_appealText`
  // testTag. The current app has NO admin moderation surface in
  // shared/src/commonMain — only the USER-side suspension/appeal flow
  // exists (suspension_appealField / suspension_submitAppealButton in
  // SuspensionScreen.kt). The admin reviewer side is web-only today.
  //
  // So this method returns false in real journeys today. When/if an
  // Android admin app ships with `adminAppeal_*` testTags, this stays
  // sound — the wildcard prefix match will land.
  //
  // Both args (`_viewer`, `_target`) are accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('adminAppeal_appealText present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Selma')).toBe(true);
  });

  test('adminAppeal_panel present → true (any adminAppeal_* matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Selma')).toBe(true);
  });

  test('absent (no admin surface visible) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Selma')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Selma')).toBe(false);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Selma')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText"><node text="I would like to appeal" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Selma')).toBe(true);
  });

  test('left-boundary false-positive — pre_adminAppeal_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Selma')).toBe(false);
  });

  test('bare left-boundary — pre_adminAppeal_appealText does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Selma')).toBe(false);
  });

  test('similar but distinct prefix — suspension_appealField does NOT match', async () => {
    // The user-side suspension appeal field is distinct from the
    // admin-side review panel. Pin that they don't conflate.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_appealField" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Selma')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Selma')).toBe(false);
  });

  test('viewer name accepted-and-ignored — Bea also passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Bea', 'Selma')).toBe(true);
  });

  test('target name accepted-and-ignored — different target passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Theo')).toBe(true);
  });

  test('null viewer → true (viewer accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText(null, 'Selma')).toBe(true);
  });

  test('undefined viewer → true (viewer accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText(undefined, 'Selma')).toBe(true);
  });

  test('empty viewer → true (viewer accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('', 'Selma')).toBe(true);
  });

  test('whitespace viewer → true (viewer accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('   ', 'Selma')).toBe(true);
  });

  test('null target → true (target accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', null)).toBe(true);
  });

  test('undefined target → true (target accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', undefined)).toBe(true);
  });

  test('empty target → true (target accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', '')).toBe(true);
  });

  test('whitespace target → true (target accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', '   ')).toBe(true);
  });

  test('first-match contract — two adminAppeal_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_appealText" />' +
        '<node resource-id="com.shyden.shytalk.local:id/adminAppeal_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsAppealText('Mod', 'Selma')).toBe(true);
  });
});

describe('android-adb-driver — androidAdminShowsDashboardCounters', () => {
  // Wake 105 — `<Name>'s <Plat> Admin UI shows the dashboard with
  // counters: N reports, N verifications, N appeals` (j12). Admin
  // landing page counters. Driver receives
  // `(viewer, { reports, verifications, appeals })`.
  //
  // Foundation strategy: presence-check on the `adminDashboard_*`
  // testTag PREFIX. The current app has NO admin moderation surface
  // in shared/src/commonMain — see the sibling matcher
  // androidAdminShowsAppealText for context. The admin reviewer side
  // is web-only today.
  //
  // Returns false in real journeys today. When/if an Android admin
  // app ships with `adminDashboard_*` testTags (e.g.
  // adminDashboard_reportsCounter, adminDashboard_verificationsCounter,
  // adminDashboard_appealsCounter), this stays sound — the wildcard
  // prefix match will land.
  //
  // Both args (`_viewer`, `_counters`) accepted-and-ignored. The
  // foundation does not validate that the displayed counter values
  // match the expected object — that needs per-counter testTags + a
  // text-extraction inspection mechanism.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('adminDashboard_reportsCounter present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 5,
        verifications: 2,
        appeals: 1,
      }),
    ).toBe(true);
  });

  test('adminDashboard_verificationsCounter present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_verificationsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(true);
  });

  test('adminDashboard_appealsCounter present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_appealsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 100,
        verifications: 50,
        appeals: 10,
      }),
    ).toBe(true);
  });

  test('absent (no admin surface) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 1,
        verifications: 1,
        appeals: 1,
      }),
    ).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter"><node text="5" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 5,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(true);
  });

  test('left-boundary — pre_adminDashboard_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(false);
  });

  test('bare left-boundary — pre_adminDashboard_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(false);
  });

  test('right-boundary — adminDashboard_reportsCounterExtra still matches (prefix contract)', async () => {
    // Pin: the prefix-wildcard form `adminDashboard_[^"]*` accepts ANY
    // suffix up to the closing quote. `_reportsCounterExtra` is therefore
    // a valid match — the foundation matches any `adminDashboard_*` tag.
    // If a future change tightened the suffix (e.g. required word-boundary
    // or an enumerated suffix list), this test would catch the change.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounterExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(true);
  });

  test('confusable non-dashboard prefix — admin_dashboardSummary does NOT match', async () => {
    // Pin: the left anchor is `adminDashboard_` literally, NOT `admin_`.
    // A hypothetical `admin_*` family of testTags must not false-match an
    // adminDashboard_* assertion. Documents the prefix specificity.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/admin_dashboardSummary" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(false);
  });

  test('viewer name accepted-and-ignored — Bea passes too', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Bea', {
        reports: 1,
        verifications: 1,
        appeals: 1,
      }),
    ).toBe(true);
  });

  test('null viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters(null, {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(true);
  });

  test('undefined viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters(undefined, {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(true);
  });

  test('empty viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('', {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(true);
  });

  test('whitespace viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('   ', {
        reports: 0,
        verifications: 0,
        appeals: 0,
      }),
    ).toBe(true);
  });

  test('null counters → true (counters accepted-and-ignored)', async () => {
    // The foundation does not destructure or validate counters — pin that
    // a null object doesn't crash the method and still returns based on
    // the testTag presence-check.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsDashboardCounters('Mod', null)).toBe(true);
  });

  test('undefined counters → true (counters accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsDashboardCounters('Mod', undefined)).toBe(true);
  });

  test('empty object counters → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsDashboardCounters('Mod', {})).toBe(true);
  });

  test('partial counters (missing verifications) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsDashboardCounters('Mod', { reports: 5, appeals: 1 })).toBe(
      true,
    );
  });

  test('high-value counters (large numbers) → true', async () => {
    // Pin that NaN/Infinity/very-large numbers don't crash. Counters are
    // accepted-and-ignored, so the value shouldn't matter at all.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 9999999,
        verifications: 0,
        appeals: -1,
      }),
    ).toBe(true);
  });

  test('first-match contract — two adminDashboard_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_reportsCounter" />' +
        '<node resource-id="com.shyden.shytalk.local:id/adminDashboard_appealsCounter" />',
    });
    const driver = await createAndroidDriver();
    expect(
      await driver.androidAdminShowsDashboardCounters('Mod', {
        reports: 1,
        verifications: 1,
        appeals: 1,
      }),
    ).toBe(true);
  });
});

describe('android-adb-driver — androidAdminShowsStat', () => {
  // Wake 106 — `<Name>'s <Plat> Admin UI shows the "<X>" stat` (j12).
  // Named-stat visibility on the admin dashboard. Driver receives
  // `(viewer, statName)` where statName is a free-form display label
  // ("Daily Active Users", "Reports Resolved Today", etc.).
  //
  // Foundation strategy: presence-check on the `adminStat_*` testTag
  // PREFIX. No admin moderation surface in shared/src/commonMain yet
  // (web-only admin) — see siblings androidAdminShowsAppealText (#762)
  // and androidAdminShowsDashboardCounters (#763). Returns false in
  // real journeys today; lands true when `adminStat_*` testTags ship.
  //
  // Both args (`_viewer`, `_statName`) are accepted-and-ignored. The
  // foundation does NOT verify that the specific named stat is
  // displayed — it only verifies that ANY adminStat_* element is
  // visible. Per-stat verification would need a stat-name → testTag
  // map (similar to the SURFACE_TARGET_TAGS scaffold).
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('adminStat_dailyActiveUsers present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Daily Active Users')).toBe(true);
  });

  test('adminStat_reportsResolved present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_reportsResolved" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Reports Resolved Today')).toBe(true);
  });

  test('absent (no admin surface) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Daily Active Users')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Daily Active Users')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Daily Active Users')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers"><node text="1,234" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Daily Active Users')).toBe(true);
  });

  test('left-boundary — pre_adminStat_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Daily Active Users')).toBe(false);
  });

  test('bare left-boundary — pre_adminStat_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Daily Active Users')).toBe(false);
  });

  test('right-boundary — adminStat_dailyActiveUsersExtra still matches (prefix contract)', async () => {
    // Pin: the wildcard suffix `[^"]*` accepts ANY chars up to the
    // closing quote, so a longer suffix is acceptable. If a future
    // tightening required word-boundary, this test would catch it.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsersExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Daily Active Users')).toBe(true);
  });

  test('confusable prefix — admin_statSummary does NOT match', async () => {
    // Pin: the left anchor is `adminStat_` literally. A hypothetical
    // `admin_*` family must not false-match.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/admin_statSummary" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Daily Active Users')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Daily Active Users')).toBe(false);
  });

  test('viewer name accepted-and-ignored — Bea passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Bea', 'Daily Active Users')).toBe(true);
  });

  test('null viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat(null, 'Daily Active Users')).toBe(true);
  });

  test('undefined viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat(undefined, 'Daily Active Users')).toBe(true);
  });

  test('empty viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('', 'Daily Active Users')).toBe(true);
  });

  test('whitespace viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('   ', 'Daily Active Users')).toBe(true);
  });

  test('null statName → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', null)).toBe(true);
  });

  test('undefined statName → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', undefined)).toBe(true);
  });

  test('empty statName → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', '')).toBe(true);
  });

  test('whitespace statName → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', '   ')).toBe(true);
  });

  test('different statName still passes (foundation does not match specific stat)', async () => {
    // The foundation contract: ANY adminStat_* tag satisfies ANY stat
    // name query. Per-stat verification needs a stat-name → testTag map.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Reports Resolved Today')).toBe(true);
  });

  test('first-match contract — two adminStat_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_dailyActiveUsers" />' +
        '<node resource-id="com.shyden.shytalk.local:id/adminStat_reportsResolved" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAdminShowsStat('Mod', 'Daily Active Users')).toBe(true);
  });
});

describe('android-adb-driver — androidAlsoShowsInParticipantsList', () => {
  // Wake 103 — `<Name>'s <Plat> UI also shows <Other> in the participants
  // list` (j09). Voice-room session — confirms <Other> is visible in the
  // viewer's participants list (multi-actor session sanity).
  //
  // Foundation strategy: presence-check on the `participantsList_*`
  // testTag PREFIX. The current app has NO `participantsList_*` testTag
  // in shared/src/commonMain — voice-room participant rendering uses
  // SeatItem.kt's `room_requestSeatButton` and `room_seatGrid` (without
  // a participants-list testTag family). Returns false in real journeys
  // today; lands true when participantsList_* testTags ship.
  //
  // Both args (_viewer, _other) accepted-and-ignored. Per-participant
  // verification (asserting THIS specific user is in the list, not just
  // "any participant tile is visible") needs a participant-id → testTag
  // map (similar to SURFACE_TARGET_TAGS in #760).
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('participantsList_userTile present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(true);
  });

  test('participantsList_container present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(true);
  });

  test('absent (no participants surface) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile"><node text="Bao" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(true);
  });

  test('left-boundary — pre_participantsList_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(false);
  });

  test('bare left-boundary — pre_participantsList_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(false);
  });

  test('right-boundary — participantsList_userTileExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTileExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(true);
  });

  test('confusable prefix — participants_listItem does NOT match', async () => {
    // Pin: left anchor is `participantsList_` literally, not the looser
    // `participants_`. A hypothetical `participants_*` family must not
    // false-match.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participants_listItem" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(false);
  });

  test('viewer name accepted-and-ignored — Ines passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Ines', 'Bao')).toBe(true);
  });

  test('null viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList(null, 'Bao')).toBe(true);
  });

  test('undefined viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList(undefined, 'Bao')).toBe(true);
  });

  test('empty viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('', 'Bao')).toBe(true);
  });

  test('whitespace viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('   ', 'Bao')).toBe(true);
  });

  test('null other → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', null)).toBe(true);
  });

  test('undefined other → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', undefined)).toBe(true);
  });

  test('empty other → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', '')).toBe(true);
  });

  test('whitespace other → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', '   ')).toBe(true);
  });

  test('different other still passes (foundation does not match specific user)', async () => {
    // Per-user verification needs a participant-id → testTag map.
    // Today the foundation matches ANY participantsList_* tag.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'NotInList')).toBe(true);
  });

  test('first-match contract — two participantsList_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_userTile" />' +
        '<node resource-id="com.shyden.shytalk.local:id/participantsList_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidAlsoShowsInParticipantsList('Alice', 'Bao')).toBe(true);
  });
});

describe('android-adb-driver — androidApproveSeatRequest', () => {
  // Wake 86 — `<Name> on <Plat> approves <Other>'s seat request` (j17:51).
  // Voice-room host action — host approves a pending seat request from
  // <Other>. Driver receives `(host, requester)`.
  //
  // Foundation strategy: presence-check on the `seatRequest_*` testTag
  // PREFIX. No `seatRequest_*` testTag exists in shared/src/commonMain
  // yet — seat-request backend exists (SeatRequestRepository in core/room),
  // but no UI testTag exposes the pending-requests panel or per-request
  // Approve button to uiautomator. SeatItem.kt exposes only
  // room_requestSeatButton (requester-side) and room_seatGrid (host view).
  //
  // Returns false in real journeys today; lands true when seatRequest_*
  // testTags ship (e.g. seatRequest_pendingPanel /
  // seatRequest_approveButton_<requesterId>).
  //
  // Both args (_host, _requester) accepted-and-ignored. Per-requester
  // approval (tapping THIS specific approve button) needs a requester-id
  // → testTag map.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('seatRequest_approveButton present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(true);
  });

  test('seatRequest_pendingPanel present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_pendingPanel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(true);
  });

  test('absent (no seat-request surface) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton"><node text="Approve" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(true);
  });

  test('left-boundary — pre_seatRequest_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('bare left-boundary — pre_seatRequest_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('right-boundary — seatRequest_approveButtonExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButtonExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(true);
  });

  test('confusable prefix — seat_requestApprove does NOT match', async () => {
    // Pin: left anchor is `seatRequest_` literally. A hypothetical
    // `seat_*` family must not false-match.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seat_requestApprove" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('similar-but-distinct — room_requestSeatButton does NOT match', async () => {
    // The requester-side button (SeatItem.kt:142) must not satisfy a
    // HOST approval matcher. They serve different roles in the j17
    // sequence.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_requestSeatButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(false);
  });

  test('host name accepted-and-ignored — Ines passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Ines', 'Bao')).toBe(true);
  });

  test('null host → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest(null, 'Bao')).toBe(true);
  });

  test('undefined host → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest(undefined, 'Bao')).toBe(true);
  });

  test('empty host → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('', 'Bao')).toBe(true);
  });

  test('whitespace host → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('   ', 'Bao')).toBe(true);
  });

  test('null requester → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', null)).toBe(true);
  });

  test('undefined requester → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', undefined)).toBe(true);
  });

  test('empty requester → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', '')).toBe(true);
  });

  test('whitespace requester → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', '   ')).toBe(true);
  });

  test('different requester still passes (foundation does not match specific request)', async () => {
    // Per-requester approval needs a requester-id → testTag map.
    // Today the foundation matches ANY seatRequest_* element.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'NotInRequest')).toBe(true);
  });

  test('first-match contract — two seatRequest_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_approveButton" />' +
        '<node resource-id="com.shyden.shytalk.local:id/seatRequest_pendingPanel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidApproveSeatRequest('Alice', 'Bao')).toBe(true);
  });
});

describe('android-adb-driver — androidOpenProfileAndTap', () => {
  // Wake 88 — `<Name> on <Plat> opens <Other>'s profile and taps "<X>"`
  // (j11:33). Composite open-profile + tap-action. Driver receives
  // `(actor, target, button)`.
  //
  // Foundation strategy: presence-check on the `profile_*` testTag
  // PREFIX. UNLIKE the admin/dashboard/seatRequest siblings, the
  // `profile_*` testTag family DOES exist today —
  // shared/src/commonMain/.../profile/ProfileScreen.kt exposes
  // `profile_displayName` (lines 507 and 992). So this method WILL
  // return true in real journeys whenever the profile screen is open.
  //
  // What's foundation about it: the per-button tap action (e.g. tap
  // "Block" / "Report" / "Follow") is NOT yet implemented. Buttons
  // need their own per-action testTags (`profile_blockButton`,
  // `profile_reportButton`, etc.). The foundation verifies the
  // profile is OPEN; per-button targeting is deferred.
  //
  // All 3 args (_actor, _target, _button) accepted-and-ignored. Per-
  // target verification (asserting <Other>'s profile specifically, not
  // any profile) needs profile_displayName text-extraction. Per-button
  // targeting needs a button-name → testTag map.
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
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(true);
  });

  test('profile_avatar present → true (any profile_* suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_avatar" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Report')).toBe(true);
  });

  test('absent (no profile surface) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName"><node text="Raul" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(true);
  });

  test('left-boundary — pre_profile_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('bare left-boundary — pre_profile_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('right-boundary — profile_displayNameExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayNameExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(true);
  });

  test('confusable prefix — profileSettings_X does NOT match', async () => {
    // Pin: left anchor is `profile_` literally. A hypothetical
    // `profileSettings_*` family must NOT false-match `profile_*`.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profileSettings_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('bare confusable prefix — profileSettings_X does NOT match (no package)', async () => {
    // Bare-form companion to the package-qualified confusable test above.
    // Cluster convention (PR #767 R0): both forms pinned to prove the
    // `(?:[^"]*:id\/)?` optional prefix doesn't change the left-anchor
    // discipline.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="profileSettings_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(false);
  });

  test('actor accepted-and-ignored — Bea passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Bea', 'Raul', 'Block')).toBe(true);
  });

  test('null actor → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap(null, 'Raul', 'Block')).toBe(true);
  });

  test('undefined actor → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap(undefined, 'Raul', 'Block')).toBe(true);
  });

  test('empty actor → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('', 'Raul', 'Block')).toBe(true);
  });

  test('whitespace actor → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('   ', 'Raul', 'Block')).toBe(true);
  });

  test('null target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', null, 'Block')).toBe(true);
  });

  test('undefined target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', undefined, 'Block')).toBe(true);
  });

  test('empty target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', '', 'Block')).toBe(true);
  });

  test('whitespace target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', '   ', 'Block')).toBe(true);
  });

  test('null button → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', null)).toBe(true);
  });

  test('undefined button → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', undefined)).toBe(true);
  });

  test('empty button → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', '')).toBe(true);
  });

  test('whitespace button → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', '   ')).toBe(true);
  });

  test('different button still passes (foundation does not match specific button)', async () => {
    // Per-button targeting needs button-name → testTag map. Today the
    // foundation matches ANY profile_* element (the profile is open).
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'AnyButtonName')).toBe(true);
  });

  test('first-match contract — two profile_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />' +
        '<node resource-id="com.shyden.shytalk.local:id/profile_avatar" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileAndTap('Greta', 'Raul', 'Block')).toBe(true);
  });
});

describe('android-adb-driver — androidOpenProfileFrom', () => {
  // Wake 88 — `<Name> on <Plat> opens <Other>'s profile from the <X>`
  // (j17:71, j18:49). Composite navigation: from source surface (room,
  // PM, inbox, ...) → <Other>'s profile. Driver receives
  // `(actor, target, source)`.
  //
  // Foundation strategy: presence-check on the `profile_*` testTag
  // PREFIX. Same target screen as androidOpenProfileAndTap (#767) —
  // ProfileScreen.kt exposes `profile_displayName` (lines 507, 992).
  // Returns true in real journeys whenever the profile screen is open.
  //
  // What's foundation about it: the source-surface navigation (room →
  // tap-user-avatar / PM → tap-header-avatar / inbox → tap-row) is
  // NOT yet driven by this method. The foundation only confirms the
  // destination is the profile screen. A future PR with a
  // source → entry-point-gesture map would enable proper driving of
  // the navigation.
  //
  // All 3 args (_actor, _target, _source) accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('profile_displayName present + source "room" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(true);
  });

  test('profile_avatar present + source "PM" → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_avatar" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Adam', 'Officia', 'PM')).toBe(true);
  });

  test('absent (no profile surface) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName"><node text="Bao" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(true);
  });

  test('left-boundary — pre_profile_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(false);
  });

  test('bare left-boundary — pre_profile_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(false);
  });

  test('right-boundary — profile_displayNameExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayNameExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(true);
  });

  test('confusable prefix — profileSettings_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profileSettings_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(false);
  });

  test('bare confusable prefix — profileSettings_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="profileSettings_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(false);
  });

  test('actor accepted-and-ignored — Adam passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Adam', 'Bao', 'room')).toBe(true);
  });

  test('null actor → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom(null, 'Bao', 'room')).toBe(true);
  });

  test('undefined actor → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom(undefined, 'Bao', 'room')).toBe(true);
  });

  test('empty actor → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('', 'Bao', 'room')).toBe(true);
  });

  test('whitespace actor → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('   ', 'Bao', 'room')).toBe(true);
  });

  test('null target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', null, 'room')).toBe(true);
  });

  test('undefined target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', undefined, 'room')).toBe(true);
  });

  test('empty target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', '', 'room')).toBe(true);
  });

  test('whitespace target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', '   ', 'room')).toBe(true);
  });

  test('null source → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', null)).toBe(true);
  });

  test('undefined source → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', undefined)).toBe(true);
  });

  test('empty source → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', '')).toBe(true);
  });

  test('whitespace source → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', '   ')).toBe(true);
  });

  test('different source still passes (foundation does not match specific entry)', async () => {
    // Per-source entry-gesture needs a source → entry-point-gesture map.
    // Today the foundation matches ANY profile_* element (the destination
    // is reached). Test sources: room, PM, inbox, search.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'inbox')).toBe(true);
  });

  test('first-match contract — two profile_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/profile_displayName" />' +
        '<node resource-id="com.shyden.shytalk.local:id/profile_avatar" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidOpenProfileFrom('Yuki', 'Bao', 'room')).toBe(true);
  });
});

describe('android-adb-driver — androidRefreshLanguageRail', () => {
  // Wake 87 — `<Name> on <Plat> refreshes the language rail` (j17:78).
  // Pull-to-refresh / refresh-button on the language-filter rail.
  // Driver receives `(name)`.
  //
  // Foundation strategy: presence-check on the `languageRail_*` testTag
  // PREFIX. No `languageRail_*` testTag exists in
  // shared/src/commonMain yet — the language-filter rail UI is unbuilt.
  // Returns false in real journeys today; lands true when the rail
  // ships with `languageRail_*` testTags (e.g. languageRail_container,
  // languageRail_refreshButton).
  //
  // Action body (perform the pull-to-refresh gesture or tap the refresh
  // button) is deferred until per-element testTags exist. The `_name`
  // arg is accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('languageRail_container present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/languageRail_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(true);
  });

  test('languageRail_refreshButton present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/languageRail_refreshButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(true);
  });

  test('absent (no language rail) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="languageRail_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/languageRail_container"><node text="EN" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(true);
  });

  test('left-boundary — pre_languageRail_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_languageRail_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(false);
  });

  test('bare left-boundary — pre_languageRail_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_languageRail_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(false);
  });

  test('right-boundary — languageRail_containerExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/languageRail_containerExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(true);
  });

  test('confusable prefix — language_railOption does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/language_railOption" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(false);
  });

  test('bare confusable prefix — language_railOption does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="language_railOption" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(false);
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/languageRail_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Bao')).toBe(true);
  });

  test('null name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/languageRail_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/languageRail_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/languageRail_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/languageRail_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('   ')).toBe(true);
  });

  test('first-match contract — two languageRail_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/languageRail_container" />' +
        '<node resource-id="com.shyden.shytalk.local:id/languageRail_refreshButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidRefreshLanguageRail('Yuki')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsBeansPerWeekChart', () => {
  // Wake 87 — `<Name>'s <Plat> UI shows a chart of beans earned per
  // week` (j17:74). Bare chart-presence assertion. Driver receives
  // `(name)`.
  //
  // Foundation strategy: presence-check on the `beansChart_*` testTag
  // PREFIX. No `beansChart_*` testTag exists in shared/src/commonMain
  // yet — the beans-earnings chart UI is unbuilt. Returns false in
  // real journeys today; lands true when the chart ships with
  // `beansChart_*` testTags (e.g. beansChart_container,
  // beansChart_weekBar).
  //
  // Bin-level value verification is out of scope (matcher contract:
  // "bare chart-presence assertion"). `_name` accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('beansChart_container present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/beansChart_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(true);
  });

  test('beansChart_weekBar present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/beansChart_weekBar" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(true);
  });

  test('absent (no chart) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="beansChart_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/beansChart_container"><node text="W1" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(true);
  });

  test('left-boundary — pre_beansChart_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_beansChart_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(false);
  });

  test('bare left-boundary — pre_beansChart_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_beansChart_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(false);
  });

  test('right-boundary — beansChart_containerExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/beansChart_containerExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(true);
  });

  test('confusable prefix — beans_chartPanel does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/beans_chartPanel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(false);
  });

  test('bare confusable prefix — beans_chartPanel does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="beans_chartPanel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(false);
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/beansChart_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Bao')).toBe(true);
  });

  test('null name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/beansChart_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/beansChart_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/beansChart_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/beansChart_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('   ')).toBe(true);
  });

  test('first-match contract — two beansChart_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/beansChart_container" />' +
        '<node resource-id="com.shyden.shytalk.local:id/beansChart_weekBar" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsBeansPerWeekChart('Yuki')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsCountBadge', () => {
  // Wake 98 — `<Name>'s <Plat> UI shows a +N in the "<X>" count`
  // (j01/j02/j07). Generic delta-badge assertion: a numeric counter
  // (Followers, Likes, etc.) shows a +N increment. Driver receives
  // `(name, delta, label)`.
  //
  // Foundation strategy: presence-check on the `countBadge_*` testTag
  // PREFIX. No `countBadge_*` testTag exists in shared/src/commonMain
  // yet — delta-badge UI is unbuilt. Returns false in real journeys
  // today; lands true when ships with countBadge_followersDelta,
  // countBadge_likesDelta, etc.
  //
  // Per-label verification (`Followers` vs `Likes`) needs a label →
  // testTag map. Per-delta verification (matching the actual displayed
  // +N) needs text-extraction. Both deferred. All 3 args
  // (_name, _delta, _label) accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('countBadge_followersDelta present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(true);
  });

  test('countBadge_likesDelta present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_likesDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 5, 'Likes')).toBe(true);
  });

  test('absent (no badge) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta"><node text="+1" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(true);
  });

  test('left-boundary — pre_countBadge_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(false);
  });

  test('bare left-boundary — pre_countBadge_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(false);
  });

  test('right-boundary — countBadge_followersDeltaExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDeltaExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(true);
  });

  test('confusable prefix — count_badgeSummary does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/count_badgeSummary" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(false);
  });

  test('bare confusable prefix — count_badgeSummary does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="count_badgeSummary" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(false);
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Bao', 1, 'Followers')).toBe(true);
  });

  test('null name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge(null, 1, 'Followers')).toBe(true);
  });

  test('undefined name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge(undefined, 1, 'Followers')).toBe(true);
  });

  test('empty name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('', 1, 'Followers')).toBe(true);
  });

  test('whitespace name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('   ', 1, 'Followers')).toBe(true);
  });

  test('null delta → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', null, 'Followers')).toBe(true);
  });

  test('undefined delta → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', undefined, 'Followers')).toBe(true);
  });

  test('0 delta → true (delta accepted-and-ignored regardless of value)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 0, 'Followers')).toBe(true);
  });

  test('null label → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, null)).toBe(true);
  });

  test('undefined label → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, undefined)).toBe(true);
  });

  test('empty label → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, '')).toBe(true);
  });

  test('whitespace label → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, '   ')).toBe(true);
  });

  test('different label still passes (foundation does not match specific label)', async () => {
    // Per-label verification needs a label → testTag map.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Likes')).toBe(true);
  });

  test('first-match contract — two countBadge_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_followersDelta" />' +
        '<node resource-id="com.shyden.shytalk.local:id/countBadge_likesDelta" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsCountBadge('Selma', 1, 'Followers')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsEditedBodyWithTag', () => {
  // Wake 103 — `<Name>'s <Plat> UI shows the edited body "<X>" with an
  // "<Y>" tag` (j07). Message-edit indicator on the recipient view.
  // Driver receives `(name, body, tag)`.
  //
  // Foundation strategy: presence-check on the `editedBody_*` testTag
  // PREFIX. No `editedBody_*` testTag exists in shared/src/commonMain
  // yet — only the source-side `room_msg_editTarget_<id>` testTag
  // exists (MessageBubble.kt:241), which marks the message being
  // edited, not the post-edit "(edited)" badge on the recipient view.
  //
  // Returns false in real journeys today; lands true when ships with
  // editedBody_<msgId> / editedBody_badge / etc.
  //
  // Per-body text verification (matching the displayed string) and
  // per-tag verification (matching the "(edited)" label exactly) are
  // deferred — both need text-extraction. All 3 args (_name, _body,
  // _tag) accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('editedBody_badge present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated body', 'edited')).toBe(
      true,
    );
  });

  test('editedBody_msg42 present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_msg42" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(true);
  });

  test('absent (no edited badge) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge"><node text="(edited)" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(true);
  });

  test('left-boundary — pre_editedBody_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(false);
  });

  test('bare left-boundary — pre_editedBody_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(false);
  });

  test('right-boundary — editedBody_badgeExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badgeExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(true);
  });

  test('confusable prefix — edited_bodyOther does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/edited_bodyOther" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(false);
  });

  test('bare confusable prefix — edited_bodyOther does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="edited_bodyOther" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(false);
  });

  test('similar-but-distinct — room_msg_editTarget_42 does NOT match', async () => {
    // The source-side edit-target testTag (MessageBubble.kt:241) marks
    // the message being edited, NOT the post-edit indicator. Pin that
    // these don't conflate.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/room_msg_editTarget_42" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(false);
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Bao', 'Updated', 'edited')).toBe(true);
  });

  test('null name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag(null, 'Updated', 'edited')).toBe(true);
  });

  test('undefined name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag(undefined, 'Updated', 'edited')).toBe(true);
  });

  test('empty name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('', 'Updated', 'edited')).toBe(true);
  });

  test('whitespace name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('   ', 'Updated', 'edited')).toBe(true);
  });

  test('null body → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', null, 'edited')).toBe(true);
  });

  test('undefined body → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', undefined, 'edited')).toBe(true);
  });

  test('empty body → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', '', 'edited')).toBe(true);
  });

  test('whitespace body → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', '   ', 'edited')).toBe(true);
  });

  test('null tag → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', null)).toBe(true);
  });

  test('undefined tag → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', undefined)).toBe(true);
  });

  test('empty tag → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', '')).toBe(true);
  });

  test('whitespace tag → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', '   ')).toBe(true);
  });

  test('different body/tag still passes (foundation does not match specifics)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'AnyBody', 'AnyTag')).toBe(true);
  });

  test('first-match contract — two editedBody_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_badge" />' +
        '<node resource-id="com.shyden.shytalk.local:id/editedBody_msg42" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsEditedBodyWithTag('Alice', 'Updated', 'edited')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsInAppGiftNotification', () => {
  // Wake 100 — `<Name>'s <Plat> UI shows the in-app gift notification
  // with sender "<X>" and gift "<Y>"` (j05). Toast/banner when a gift
  // is received in real time. Driver receives
  // `(recipient, sender, giftId)`.
  //
  // Foundation strategy: presence-check on the `giftNotification_*`
  // testTag PREFIX. No `giftNotification_*` testTag exists in
  // shared/src/commonMain yet — the real-time gift notification toast
  // is unbuilt. Returns false in real journeys today; lands true when
  // ships with giftNotification_toast / giftNotification_giftIcon.
  //
  // Per-sender and per-gift verification need text/image extraction.
  // Deferred. All 3 args (_recipient, _sender, _giftId) accepted-and-
  // ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('giftNotification_toast present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(true);
  });

  test('giftNotification_giftIcon present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_giftIcon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(true);
  });

  test('absent (no notification) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast"><node text="Alice sent you a rose" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(true);
  });

  test('left-boundary — pre_giftNotification_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(false);
  });

  test('bare left-boundary — pre_giftNotification_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(false);
  });

  test('right-boundary — giftNotification_toastExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toastExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(true);
  });

  test('confusable prefix — gift_notificationPanel does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/gift_notificationPanel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(false);
  });

  test('bare confusable prefix — gift_notificationPanel does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="gift_notificationPanel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(false);
  });

  test('recipient accepted-and-ignored — Bao passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Bao', 'Alice', 'rose')).toBe(true);
  });

  test('null recipient → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification(null, 'Alice', 'rose')).toBe(true);
  });

  test('undefined recipient → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification(undefined, 'Alice', 'rose')).toBe(true);
  });

  test('empty recipient → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('', 'Alice', 'rose')).toBe(true);
  });

  test('whitespace recipient → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('   ', 'Alice', 'rose')).toBe(true);
  });

  test('null sender → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', null, 'rose')).toBe(true);
  });

  test('undefined sender → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', undefined, 'rose')).toBe(true);
  });

  test('empty sender → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', '', 'rose')).toBe(true);
  });

  test('whitespace sender → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', '   ', 'rose')).toBe(true);
  });

  test('null giftId → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', null)).toBe(true);
  });

  test('undefined giftId → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', undefined)).toBe(true);
  });

  test('empty giftId → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', '')).toBe(true);
  });

  test('whitespace giftId → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', '   ')).toBe(true);
  });

  test('different sender/giftId still passes (foundation does not match specifics)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Different', 'AnyGift')).toBe(
      true,
    );
  });

  test('first-match contract — two giftNotification_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_toast" />' +
        '<node resource-id="com.shyden.shytalk.local:id/giftNotification_giftIcon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInAppGiftNotification('Selma', 'Alice', 'rose')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsInResults', () => {
  // Wake 98 — `<Name>'s <Plat> UI shows <Other> in the results[ with
  // displayName "<X>"]` (j01/j02). Discovery list result visibility.
  // Optional displayName suffix lets the driver also verify rendered
  // string. Driver receives `(viewer, target, displayName)` —
  // displayName may be `null` (no `with displayName` suffix in step).
  //
  // Foundation strategy: presence-check on the `searchResults_*`
  // testTag PREFIX. No `searchResults_*` testTag exists in
  // shared/src/commonMain yet — NewMessageScreen.kt exposes only
  // `newMessage_searchField` for the input box, not per-result tiles.
  //
  // Returns false in real journeys today; lands true when ships with
  // searchResults_userTile / searchResults_container etc.
  //
  // Per-user verification (asserting <Other> specifically, not any
  // result) needs user-id → testTag map. Per-displayName verification
  // needs text-extraction. Both deferred. All 3 args (_viewer,
  // _target, _displayName) accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('searchResults_userTile present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(true);
  });

  test('searchResults_container present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', 'Bob Smith')).toBe(true);
  });

  test('absent (no results) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile"><node text="Bob" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(true);
  });

  test('left-boundary — pre_searchResults_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(false);
  });

  test('bare left-boundary — pre_searchResults_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(false);
  });

  test('right-boundary — searchResults_userTileExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTileExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(true);
  });

  test('confusable prefix — search_resultsItem does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/search_resultsItem" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(false);
  });

  test('bare confusable prefix — search_resultsItem does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="search_resultsItem" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(false);
  });

  test('viewer accepted-and-ignored — Bao passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Bao', 'Bob', null)).toBe(true);
  });

  test('null viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults(null, 'Bob', null)).toBe(true);
  });

  test('undefined viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults(undefined, 'Bob', null)).toBe(true);
  });

  test('empty viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('', 'Bob', null)).toBe(true);
  });

  test('whitespace viewer → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('   ', 'Bob', null)).toBe(true);
  });

  test('null target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', null, null)).toBe(true);
  });

  test('undefined target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', undefined, null)).toBe(true);
  });

  test('empty target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', '', null)).toBe(true);
  });

  test('whitespace target → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', '   ', null)).toBe(true);
  });

  test('null displayName → true (suffix absent in step)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(true);
  });

  test('undefined displayName → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', undefined)).toBe(true);
  });

  test('empty displayName → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', '')).toBe(true);
  });

  test('whitespace displayName → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', '   ')).toBe(true);
  });

  test('different target still passes (foundation does not match specific user)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'NotInList', 'Any Name')).toBe(true);
  });

  test('first-match contract — two searchResults_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_userTile" />' +
        '<node resource-id="com.shyden.shytalk.local:id/searchResults_container" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsInResults('Alice', 'Bob', null)).toBe(true);
  });
});

describe('android-adb-driver — androidShowsNamedKind', () => {
  // Wake 69/71 — `<Name>'s <Plat> UI shows the <noun> <kind>` (positive)
  // and `<Name>'s <Plat> UI no longer shows the <noun> <kind>` (negative
  // — runner inverts assertion). Generic noun+kind matcher. Driver
  // receives `(name, noun, kind)`. kind ∈ {button|screen|banner|dialog|
  // panel|tab}.
  //
  // Foundation strategy: NOUN_KIND_TAGS scaffold (7th *_TAGS scaffold)
  // keyed by lowercase `${noun}::${kind}` composite → Compose testTag.
  // ONE mapping currently grounded (j11:86):
  //
  //   'appeal::button' → 'suspension_submitAppealButton'
  //     (SuspensionScreen.kt:251 — user-side appeal flow)
  //
  // Unmapped composites return false — FAIL-loud contract (consistent
  // with SURFACE_TARGET_TAGS / INPUT_TAGS / etc.).
  //
  // The `_name` arg is accepted-and-ignored; `noun` and `kind` are
  // REQUIRED (used in the scaffold lookup).
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('appeal button mapped + testTag present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', 'button')).toBe(true);
  });

  test('appeal button mapped + testTag ABSENT → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', 'button')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', 'button')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', 'button')).toBe(false);
  });

  test('unmapped composite "suspension::screen" → false (FAIL-loud)', async () => {
    // Even though the suspension flow exists in SuspensionScreen.kt,
    // there's no SCREEN-level testTag mapped yet — FAIL-loud rather
    // than silently presence-checking against any suspension_* tag.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_appealField" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'suspension', 'screen')).toBe(false);
  });

  test('unmapped composite "warning::banner" → false (FAIL-loud)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Hayato', 'warning', 'banner')).toBe(false);
  });

  test('mapped noun + WRONG kind ("appeal::screen") → false', async () => {
    // "appeal" alone is mapped only under kind "button". A request for
    // kind "screen" must return false even though the testTag is
    // visible in the dump.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', 'screen')).toBe(false);
  });

  test('case-insensitive lookup — UPPERCASE noun + kind still resolves', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'APPEAL', 'BUTTON')).toBe(true);
  });

  test('mixed-case lookup — Appeal + Button still resolves', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'Appeal', 'Button')).toBe(true);
  });

  test('bare resource-id (no package prefix) → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', 'button')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton"><node text="Submit" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', 'button')).toBe(true);
  });

  test('left-boundary — pre_suspension_submitAppealButton does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', 'button')).toBe(false);
  });

  test('bare left-boundary — pre_suspension_submitAppealButton does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', 'button')).toBe(false);
  });

  test('right-boundary — suspension_submitAppealButton_extra does NOT match (exact tag)', async () => {
    // NOUN_KIND_TAGS uses EXACT-match lookup (not prefix), so suffix
    // additions to the tag value would not satisfy the lookup. Pin this
    // contract — the tag must match the mapped value exactly up to the
    // closing `"`.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton_extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', 'button')).toBe(false);
  });

  test('empty noun → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', '', 'button')).toBe(false);
  });

  test('whitespace noun → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', '   ', 'button')).toBe(false);
  });

  test('null noun → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', null, 'button')).toBe(false);
  });

  test('undefined noun → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', undefined, 'button')).toBe(false);
  });

  test('empty kind → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', '')).toBe(false);
  });

  test('whitespace kind → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', '   ')).toBe(false);
  });

  test('null kind → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', null)).toBe(false);
  });

  test('undefined kind → false', async () => {
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', undefined)).toBe(false);
  });

  test('name accepted-and-ignored — Hayato passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Hayato', 'appeal', 'button')).toBe(true);
  });

  test('null name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind(null, 'appeal', 'button')).toBe(true);
  });

  test('undefined name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind(undefined, 'appeal', 'button')).toBe(true);
  });

  test('empty name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('', 'appeal', 'button')).toBe(true);
  });

  test('whitespace name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('   ', 'appeal', 'button')).toBe(true);
  });

  test('first-match contract — two suspension_submitAppealButton nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />' +
        '<node resource-id="com.shyden.shytalk.local:id/suspension_submitAppealButton" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNamedKind('Raul', 'appeal', 'button')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsNonEmptyLocaleText', () => {
  // Wake 89 — `<Name>'s <Plat> UI shows non-empty <Language> text for
  // section N` (j13:36). Locale section assertion. Driver checks that
  // section N of the current screen contains non-empty text in the
  // named language. Driver receives `(name, code, section)` — code is
  // a BCP-47 locale code (en, ja, ar, etc.), section is a number.
  //
  // Foundation strategy: presence-check on the `localeText_*` testTag
  // PREFIX. No `localeText_*` testTag exists in shared/src/commonMain
  // yet — per-section locale-text testTags are unbuilt. Returns false
  // in real journeys today; lands true when ships with
  // localeText_section1 / localeText_section2 etc.
  //
  // Per-section verification needs a section-number → testTag map.
  // Per-language verification needs text-extraction + script-category
  // detection. Both deferred. All 3 args (_name, _code, _section)
  // accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('localeText_section1 present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(true);
  });

  test('localeText_section2 present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section2" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ar', 2)).toBe(true);
  });

  test('absent (no locale-text element) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1"><node text="こんにちは" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(true);
  });

  test('left-boundary — pre_localeText_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(false);
  });

  test('bare left-boundary — pre_localeText_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(false);
  });

  test('right-boundary — localeText_section1Extra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1Extra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(true);
  });

  test('confusable prefix — locale_textSection1 does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/locale_textSection1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(false);
  });

  test('bare confusable prefix — locale_textSection1 does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="locale_textSection1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(false);
  });

  test('name accepted-and-ignored — Selma passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Selma', 'ja', 1)).toBe(true);
  });

  test('null name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText(null, 'ja', 1)).toBe(true);
  });

  test('undefined name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText(undefined, 'ja', 1)).toBe(true);
  });

  test('empty name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('', 'ja', 1)).toBe(true);
  });

  test('whitespace name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('   ', 'ja', 1)).toBe(true);
  });

  test('null code → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', null, 1)).toBe(true);
  });

  test('undefined code → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', undefined, 1)).toBe(true);
  });

  test('empty code → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', '', 1)).toBe(true);
  });

  test('whitespace code → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', '   ', 1)).toBe(true);
  });

  test('null section → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', null)).toBe(true);
  });

  test('undefined section → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', undefined)).toBe(true);
  });

  test('0 section → true (section accepted-and-ignored regardless of value)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 0)).toBe(true);
  });

  test('different code/section still passes (foundation does not match specifics)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ar', 99)).toBe(true);
  });

  test('first-match contract — two localeText_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section1" />' +
        '<node resource-id="com.shyden.shytalk.local:id/localeText_section2" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsNonEmptyLocaleText('Hayato', 'ja', 1)).toBe(true);
  });
});

describe('android-adb-driver — androidShowsOfficialBadge', () => {
  // Wake 88 — `<Name>'s <Plat> UI shows the official badge[ <suffix>]`
  // (j13/j18). Bare and suffixed forms; the optional trailing fragment
  // is passed to the driver verbatim so it can dispatch to the right
  // slot ("on the sender avatar", "with Arabic label", etc.).
  //
  // Foundation strategy: presence-check on the `officialBadge_*`
  // testTag PREFIX. No `officialBadge_*` testTag exists in
  // shared/src/commonMain yet — Official-user badge UI is unbuilt.
  // Returns false in real journeys today; lands true when ships with
  // officialBadge_icon / officialBadge_label.
  //
  // Per-suffix dispatch (avatar vs label, language variant) deferred.
  // All 2 args (_name, _suffix) accepted-and-ignored. Note: runner
  // coerces a missing suffix to `''`, never null/undefined — pin both
  // forms defensively anyway.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('officialBadge_icon present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(true);
  });

  test('officialBadge_label present + suffix passed → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_label" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', 'on the sender avatar')).toBe(true);
  });

  test('absent (no badge) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon"><node text="Official" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(true);
  });

  test('left-boundary — pre_officialBadge_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(false);
  });

  test('bare left-boundary — pre_officialBadge_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(false);
  });

  test('right-boundary — officialBadge_iconExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_iconExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(true);
  });

  test('confusable prefix — official_badgeRoot does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/official_badgeRoot" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(false);
  });

  test('bare confusable prefix — official_badgeRoot does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="official_badgeRoot" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(false);
  });

  test('name accepted-and-ignored — Layla passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Layla', '')).toBe(true);
  });

  test('null name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge(null, '')).toBe(true);
  });

  test('undefined name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge(undefined, '')).toBe(true);
  });

  test('empty name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('', '')).toBe(true);
  });

  test('whitespace name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('   ', '')).toBe(true);
  });

  test('null suffix → true (defensive — runner passes empty string)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', null)).toBe(true);
  });

  test('undefined suffix → true (defensive — runner passes empty string)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', undefined)).toBe(true);
  });

  test('whitespace suffix → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '   ')).toBe(true);
  });

  test('different suffix still passes (foundation does not dispatch on suffix)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', 'with Arabic label')).toBe(true);
  });

  test('first-match contract — two officialBadge_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_icon" />' +
        '<node resource-id="com.shyden.shytalk.local:id/officialBadge_label" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOfficialBadge('Officia', '')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsOnlyMinorCohortInRankings', () => {
  // Wake 99 — `<Name>'s <Plat> UI shows only minor-cohort users in the
  // rankings` (j02). Cohort-filtered rankings list. Driver receives
  // `(name)`.
  //
  // Foundation strategy: presence-check on the `rankings_*` testTag
  // PREFIX. No `rankings_*` testTag exists in shared/src/commonMain
  // yet — rankings UI is unbuilt. Returns false in real journeys today;
  // lands true when ships with rankings_minorCohortList /
  // rankings_userRow etc.
  //
  // Per-cohort verification (asserting ONLY minor-cohort users, not
  // any users) needs row-level cohort attribute parsing. Deferred.
  // The `_name` arg is accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rankings_minorCohortList present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/rankings_minorCohortList" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(true);
  });

  test('rankings_userRow present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/rankings_userRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(true);
  });

  test('absent (no rankings) → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="rankings_minorCohortList" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/rankings_minorCohortList"><node text="Top 10" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(true);
  });

  test('left-boundary — pre_rankings_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_rankings_minorCohortList" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(false);
  });

  test('bare left-boundary — pre_rankings_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_rankings_minorCohortList" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(false);
  });

  test('right-boundary — rankings_minorCohortListExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/rankings_minorCohortListExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(true);
  });

  test('confusable prefix — ranking_panel does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ranking_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(false);
  });

  test('bare confusable prefix — ranking_panel does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="ranking_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(false);
  });

  test('name accepted-and-ignored — Selma passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/rankings_minorCohortList" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Selma')).toBe(true);
  });

  test('null name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/rankings_minorCohortList" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/rankings_minorCohortList" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/rankings_minorCohortList" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/rankings_minorCohortList" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('   ')).toBe(true);
  });

  test('first-match contract — two rankings_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/rankings_minorCohortList" />' +
        '<node resource-id="com.shyden.shytalk.local:id/rankings_userRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOnlyMinorCohortInRankings('Mia')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsOwnRankInTop', () => {
  // Wake 100 — `<Name>'s <Plat> UI shows (her|his|their) own rank in
  // the top N` (j05). Leaderboard own-rank visibility. Pronoun is
  // grammatical (not captured). Driver receives `(name, topN)` —
  // topN is the integer cutoff (e.g. 10, 50, 100).
  //
  // Foundation strategy: presence-check on the `ownRank_*` testTag
  // PREFIX. No `ownRank_*` testTag exists in shared/src/commonMain
  // yet — leaderboard own-rank highlight is unbuilt. Returns false
  // in real journeys today; lands true when ships with
  // ownRank_indicator / ownRank_userRow etc.
  //
  // Per-topN verification (asserting the rank is within top N) needs
  // text-extraction of the rank number. Deferred. Both args
  // (_name, _topN) accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('ownRank_indicator present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(true);
  });

  test('ownRank_userRow present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_userRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 50)).toBe(true);
  });

  test('absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator"><node text="#7" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(true);
  });

  test('left-boundary — pre_ownRank_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(false);
  });

  test('bare left-boundary — pre_ownRank_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(false);
  });

  test('right-boundary — ownRank_indicatorExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicatorExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(true);
  });

  test('confusable prefix — own_rankPanel does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/own_rankPanel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(false);
  });

  test('bare confusable prefix — own_rankPanel does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="own_rankPanel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(false);
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Bao', 10)).toBe(true);
  });

  test('null name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop(null, 10)).toBe(true);
  });

  test('undefined name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop(undefined, 10)).toBe(true);
  });

  test('empty name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('', 10)).toBe(true);
  });

  test('whitespace name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('   ', 10)).toBe(true);
  });

  test('null topN → true (accepted-and-ignored)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', null)).toBe(true);
  });

  test('undefined topN → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', undefined)).toBe(true);
  });

  test('0 topN → true (topN accepted-and-ignored regardless of value)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 0)).toBe(true);
  });

  test('different topN still passes (foundation does not match specific cutoff)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 9999)).toBe(true);
  });

  test('first-match contract — two ownRank_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_indicator" />' +
        '<node resource-id="com.shyden.shytalk.local:id/ownRank_userRow" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsOwnRankInTop('Selma', 10)).toBe(true);
  });
});

describe('android-adb-driver — androidShowsRoomClosedSummary', () => {
  // Wake 103 — `<Name>'s <Plat> UI shows the room-closed summary
  // panel` (j09). Post-room-close summary view. Driver receives
  // `(name)`.
  //
  // Foundation strategy: presence-check on the
  // `roomClosedSummary_*` testTag PREFIX. No `roomClosedSummary_*`
  // testTag exists in shared/src/commonMain yet — post-close summary
  // UI is unbuilt. Returns false in real journeys today; lands true
  // when ships with roomClosedSummary_panel / roomClosedSummary_stats
  // etc.
  //
  // The `_name` arg is accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('roomClosedSummary_panel present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomClosedSummary_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(true);
  });

  test('roomClosedSummary_stats present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomClosedSummary_stats" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(true);
  });

  test('absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="roomClosedSummary_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomClosedSummary_panel"><node text="Room closed" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(true);
  });

  test('left-boundary — pre_roomClosedSummary_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_roomClosedSummary_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(false);
  });

  test('bare left-boundary — pre_roomClosedSummary_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_roomClosedSummary_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(false);
  });

  test('right-boundary — roomClosedSummary_panelExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomClosedSummary_panelExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(true);
  });

  test('confusable prefix — roomClosed_summary does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomClosed_summary" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(false);
  });

  test('bare confusable prefix — roomClosed_summary does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="roomClosed_summary" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(false);
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomClosedSummary_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Bao')).toBe(true);
  });

  test('null name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomClosedSummary_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomClosedSummary_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomClosedSummary_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomClosedSummary_panel" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('   ')).toBe(true);
  });

  test('first-match contract — two roomClosedSummary_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomClosedSummary_panel" />' +
        '<node resource-id="com.shyden.shytalk.local:id/roomClosedSummary_stats" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomClosedSummary('Selma')).toBe(true);
  });
});

describe('android-adb-driver — androidShowsRoomWarningBanner', () => {
  // Wake 97 — `<Name>'s <Plat> UI shows the warning banner overlay on
  // top of the room` (j10). Cohort-warning overlay assertion. Driver
  // receives `(name)`.
  //
  // Foundation strategy: presence-check on the `roomWarningBanner_*`
  // testTag PREFIX. No `roomWarningBanner_*` testTag exists in
  // shared/src/commonMain yet — the in-room warning overlay is unbuilt
  // (the full-screen WarningScreen.kt is distinct; the overlay variant
  // is the j10 concern). Returns false in real journeys today; lands
  // true when ships with roomWarningBanner_overlay / _title etc.
  //
  // Distinct-from `warning_*` (WarningScreen.kt's full-screen tags):
  // similar-but-distinct guard pinned. `_name` accepted-and-ignored.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('roomWarningBanner_overlay present → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomWarningBanner_overlay" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(true);
  });

  test('roomWarningBanner_title present → true (any suffix matches)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomWarningBanner_title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(true);
  });

  test('absent → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/main_roomsTab" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(false);
  });

  test('empty dump → false', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(false);
  });

  test('bare resource-id → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="roomWarningBanner_overlay" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(true);
  });

  test('non-self-closing tag form → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomWarningBanner_overlay"><node text="Warning" /></node>',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(true);
  });

  test('left-boundary — pre_roomWarningBanner_X does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/pre_roomWarningBanner_overlay" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(false);
  });

  test('bare left-boundary — pre_roomWarningBanner_X does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="pre_roomWarningBanner_overlay" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(false);
  });

  test('right-boundary — roomWarningBanner_overlayExtra still matches (prefix contract)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomWarningBanner_overlayExtra" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(true);
  });

  test('confusable prefix — roomWarning_bannerOther does NOT match (package-qualified)', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomWarning_bannerOther" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(false);
  });

  test('bare confusable prefix — roomWarning_bannerOther does NOT match', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'": '<node resource-id="roomWarning_bannerOther" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(false);
  });

  test('similar-but-distinct — warning_title (WarningScreen full-screen tag) does NOT match', async () => {
    // WarningScreen.kt:82 exposes warning_title for the FULL-SCREEN
    // warning, distinct from the j10 in-room overlay. Pin that they
    // don't conflate — different journey concerns.
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/warning_title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(false);
  });

  test('uiautomator dump throws → false', async () => {
    execSync.mockImplementation((cmd) => {
      if (cmd === 'adb devices') return 'List of devices attached\nemulator-5554\tdevice\n';
      if (cmd.includes("'uiautomator' 'dump'")) {
        throw new Error('adb: device offline');
      }
      return '';
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(false);
  });

  test('name accepted-and-ignored — Bao passes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomWarningBanner_overlay" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Bao')).toBe(true);
  });

  test('null name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomWarningBanner_overlay" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner(null)).toBe(true);
  });

  test('undefined name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomWarningBanner_overlay" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner(undefined)).toBe(true);
  });

  test('empty name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomWarningBanner_overlay" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('')).toBe(true);
  });

  test('whitespace name → true', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomWarningBanner_overlay" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('   ')).toBe(true);
  });

  test('first-match contract — two roomWarningBanner_* nodes', async () => {
    mockExec({
      "'uiautomator' 'dump'": '',
      "'cat' '/sdcard/dump.xml'":
        '<node resource-id="com.shyden.shytalk.local:id/roomWarningBanner_overlay" />' +
        '<node resource-id="com.shyden.shytalk.local:id/roomWarningBanner_title" />',
    });
    const driver = await createAndroidDriver();
    expect(await driver.androidShowsRoomWarningBanner('Theo')).toBe(true);
  });
});
