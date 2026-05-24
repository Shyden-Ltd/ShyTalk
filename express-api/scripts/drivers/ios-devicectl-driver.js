/**
 * iOS driver backed by `xcrun devicectl` — physical iPhone target.
 *
 * Replaces `ios-simctl-driver.js` (simulator-only) per the policy
 * shift: journey tests run on a real device over wireless, not on a
 * simulator (see feedback-ios-also-journey-tested.md). The simctl
 * driver is preserved in-tree for reference but the runner now
 * imports from this file.
 *
 * SCAFFOLD STATE: this is the Phase 5 root PR. The factory + method
 * name registry + stub methods are in place; real UI inspection
 * (devicectl + WDA / XCTest harness) lands in subsequent PRs that
 * convert each stub into a foundation presence-check method, mirror-
 * ing the Android cluster's pattern.
 *
 * Wiring contract:
 *   - `createIosDriver({ udid })` picks the first connected physical
 *     iPhone via `xcrun devicectl list devices` (defaults to the
 *     first device). If no device is connected, returns a driver with
 *     `_udid = null` rather than throwing — every method then returns
 *     false (consistent with the foundation contract).
 *   - Methods accept the persona name as their first arg (matcher
 *     convention).
 *
 * Tooling notes (`xcrun devicectl ...`):
 *   - `device list`                     — list connected devices
 *   - `device install app <bundleId>`   — install app
 *   - `device process launch <bundleId>`— launch app
 *   - `device info details`             — device metadata
 *   - For UI inspection on physical devices, devicectl alone is
 *     insufficient; this scaffold uses WebDriverAgent / XCTest as a
 *     future integration. Until that lands, `iosUiDump()` returns ''
 *     and every presence-check method returns false in real journeys.
 *
 * Foundation parity with android-adb-driver.js:
 *   - `iosUiDump()` is the rough equivalent of `androidUiDump()` —
 *     returns the current screen's XML tree (or '' if unavailable).
 *   - Each `iosShows*` / `iosTap*` method matches its Android sibling's
 *     arg list (1:1 with the runner-side dispatch).
 *   - Foundation methods will land via subsequent PRs as
 *     `<feature>_*` testTag presence-checks against `iosUiDump()`.
 */
const { execSync } = require('child_process');

function selectUdid(preferredUdid) {
  if (preferredUdid) return preferredUdid;
  try {
    const raw = execSync('xcrun devicectl list devices 2>/dev/null', {
      encoding: 'utf8',
    });
    // devicectl output (Xcode 15+ / macOS 14+) emits the device list as
    // a fixed-width table:
    //   Name            Hostname                        Identifier                             State                Model
    //   -------------   -----------------------------   ------------------------------------   ------------------   ----
    //   Sean's iPhone   Seans-iPhone.coredevice.local   74563FF8-D1FC-567D-A6C1-7C8C3CEFE0C6   available (paired)   iPhone Air (iPhone18,4)
    //
    // The Identifier is an RFC-4122 UUID (8-4-4-4-12 hex with dashes,
    // total 36 chars). The State literal is `available` (with optional
    // `(paired)` / `(connected)` parenthetical) — NOT just `connected`
    // as earlier devicectl versions used. Accept both forms.
    //
    // We also tolerate the older 8-16 single-dash UDID format (e.g.
    // `00008110-001A2B3C4D5E6F70`) that some older devices still emit.
    const uuidRx =
      /([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\s+(?:available|connected)/i;
    const legacyRx = /([0-9A-F]{8}-[0-9A-F]{16})\s+(?:available|connected)/i;
    const uuidMatch = raw.match(uuidRx);
    if (uuidMatch) return uuidMatch[1];
    const legacyMatch = raw.match(legacyRx);
    return legacyMatch ? legacyMatch[1] : null;
  } catch (_e) {
    return null;
  }
}

// Copied from ios-simctl-driver.js — the runner dispatches these names
// for iOS scenarios. Each subsequent PR will replace the stub for one
// of these names with a foundation presence-check.
const IOS_METHOD_NAMES = [
  'iosAdminShowsAppealText',
  'iosAdminShowsDashboardCounters',
  'iosAdminShowsNewReportInQueue',
  'iosAdminShowsRowCountInTable',
  'iosAdminShowsRowForWithStatus',
  'iosAdminShowsStat',
  'iosAdminShowsTableOf',
  'iosAlsoShowsInParticipantsList',
  'iosApproveSeatRequest',
  'iosContinuesNormallyInRoom',
  'iosDisablesInput',
  'iosIsNoLongerInVoiceRoom',
  'iosIsStillInRoom',
  'iosJoinEventRoom',
  'iosNavigatesBackToTab',
  'iosNavigatesToPath',
  'iosNavigatesToProfileScreen',
  'iosNavigatesToRoomScreen',
  'iosNavigatesToWarningScreen',
  'iosOpenProfileAndTap',
  'iosOpenProfileFrom',
  'iosOpensTab',
  'iosRefreshLanguageRail',
  'iosReplacesFollowButton',
  'iosShowsBalanceViaListener',
  'iosShowsBanner',
  'iosShowsBeansPerWeekChart',
  'iosShowsContributorsList',
  'iosShowsCountBadge',
  'iosShowsEditedBodyWithTag',
  'iosShowsFrozenBanner',
  'iosShowsGiftFromSender',
  'iosShowsInAppGiftNotification',
  'iosShowsInResults',
  'iosShowsInSeatGrid',
  'iosShowsInThread',
  'iosShowsMessageInConversationThread',
  'iosShowsMicIconAs',
  'iosShowsNamedKind',
  'iosShowsNewGiftEntry',
  'iosShowsNewUnreadConversation',
  'iosShowsNonEmptyLocaleText',
  'iosShowsOfficialBadge',
  'iosShowsOnlyMinorCohortInRankings',
  'iosShowsOwnRankInTop',
  'iosShowsPmThreadDirection',
  'iosShowsRoomClosedSummary',
  'iosShowsRoomWarningBanner',
  'iosShowsSecondOffensiveMessage',
  'iosShowsSeatRequestNotification',
  'iosShowsSeatWithIndicator',
  'iosShowsStalkersDelta',
  'iosShowsSystemPmFromOfficia',
  'iosShowsToastAndNavigates',
  'iosShowsToastAndNavigatesBack',
  'iosShowsUserCard',
  'iosShowsUserCardSkeletons',
  'iosShowsWarningScreenOnRelaunch',
  'iosShowsWarningScreenWithReason',
  'iosShowsWelcomePmInLanguage',
  'iosSubmitStarFeedback',
  'iosTapFromSurface',
  'iosOpenScreen',
  'iosTapByTag',
  'iosSearchIn',
  'iosScanAllRenderedStrings',
];

function listMethods() {
  return [...new Set(IOS_METHOD_NAMES)].sort();
}

async function createIosDriver({ udid: preferred } = {}) {
  const udid = selectUdid(preferred);
  const driver = { _udid: udid };

  // Dump the current screen's view hierarchy. Foundation parity with
  // androidUiDump() — returns the raw XML string. Real implementation
  // is deferred until WebDriverAgent / XCTest harness is wired up;
  // until then, returns '' so every presence-check method below
  // returns false.
  driver.iosUiDump = async () => {
    // Future: spawn WDA, query /source endpoint, return XML.
    // For now: empty string ⇒ all presence-checks return false.
    return '';
  };

  // Stub registration loop. Each subsequent PR overrides one name
  // with a foundation presence-check (XCUITest dump format) that
  // mirrors the Android cluster's pattern but adapted to iOS's
  // identifier attribute. Until all names have foundation
  // implementations, every unimplemented stub returns false.
  for (const methodName of listMethods()) {
    driver[methodName] = async (..._args) => false;
  }

  // ── Foundation presence-check methods ─────────────────────────────
  //
  // Each iOS foundation method follows the Android cluster's pattern:
  // presence-check against `iosUiDump()` for a `<feature>_*` testTag
  // PREFIX. iOS-specific differences from Android:
  //   - XCUITest emits `<XCUIElementType... identifier="X" />` (no
  //     `resource-id` attribute, no `:id/` package qualifier).
  //   - The XML element tag varies (XCUIElementTypeButton,
  //     XCUIElementTypeOther, etc.) so the regex matches any
  //     `XCUIElementType\w+`.
  //
  // While `iosUiDump()` returns '' in the scaffold state, every
  // presence-check returns false in real journeys. When WDA / XCTest
  // integration lands, both `iosUiDump()` and these regexes start
  // doing real work.
  //
  // Wake 89 — `<Name>'s <Plat> Admin UI shows <Other>'s appeal with
  // the text` (j11:73). Same matcher as Android #762; iOS variant.
  // Returns false today (no admin UI on iOS, same as Android).
  driver.iosAdminShowsAppealText = async (_viewer, _target) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="adminAppeal_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 105 — `<Name>'s <Plat> Admin UI shows the dashboard with
  // counters: N reports, N verifications, N appeals` (j12). Mirrors
  // Android sibling #763. Foundation: presence-check on
  // `adminDashboard_*` XCUITest identifier PREFIX. Both args
  // (_viewer, _counters) accepted-and-ignored.
  driver.iosAdminShowsDashboardCounters = async (_viewer, _counters) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="adminDashboard_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 106 — `<Name>'s <Plat> Admin UI shows the "<X>" stat` (j12).
  // Mirrors Android sibling #764. Foundation: presence-check on
  // `adminStat_*` XCUITest identifier PREFIX. Both args (_viewer,
  // _statName) accepted-and-ignored.
  driver.iosAdminShowsStat = async (_viewer, _statName) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="adminStat_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 103 — `<Name>'s <Plat> UI also shows <Other> in the
  // participants list` (j09). Mirrors Android sibling #765. Foundation:
  // presence-check on `participantsList_*` XCUITest identifier PREFIX.
  // Both args (_viewer, _other) accepted-and-ignored.
  driver.iosAlsoShowsInParticipantsList = async (_viewer, _other) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="participantsList_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 86 — `<Name> on <Plat> approves <Other>'s seat request`
  // (j17:51). Mirrors Android sibling #766. Foundation:
  // presence-check on `seatRequest_*` XCUITest identifier PREFIX.
  // Both args (_host, _requester) accepted-and-ignored.
  driver.iosApproveSeatRequest = async (_host, _requester) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="seatRequest_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 90 — `<Name>'s <Plat> UI continues normally in the room`
  // (j10). Mirrors Android sibling. Composite predicate: still IN
  // the room AND NOT on a warning screen. Both axes are foundation
  // presence-checks on testTag prefixes.
  //
  // Precedence: warning beats room. If both ROOM_MARKERS and
  // WARNING_MARKERS appear, the user is NOT continuing normally
  // (warning blocks interaction).
  //
  // The `_name` arg is accepted-and-ignored.
  driver.iosContinuesNormallyInRoom = async (_name) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const warningRx = /<XCUIElementType\w+[^>]*\bidentifier="warning_[^"]*"[^>]*\/?>/;
    if (warningRx.test(dump)) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const roomRx = /<XCUIElementType\w+[^>]*\bidentifier="room_[^"]*"[^>]*\/?>/;
    return roomRx.test(dump);
  };

  // Wake 89 — `<Name>'s <Plat> UI disables the <X> input` (j11:50).
  // Mirrors Android sibling. Two-step extraction: lookup the input's
  // XCUITest identifier via INPUT_TAGS map, then scan for
  // `enabled="false"` within the captured element tag.
  //
  // The XCUITest attribute `enabled="false"` is the iOS equivalent
  // of uiautomator's same attribute (both expose a boolean enabled
  // state).
  // Wake 105 — `<Name>'s <Plat> UI is no longer in the voice room`.
  // Inverse of (future) iosIsStillInRoom. CRITICAL: returns false (not
  // true) when the dump is empty — empty dump means "can't confirm",
  // not "confirmed gone". This defensive matches the Android sibling.
  driver.iosIsNoLongerInVoiceRoom = async (_name) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const roomRx = /<XCUIElementType\w+[^>]*\bidentifier="room_[^"]*"[^>]*\/?>/;
    return !roomRx.test(dump);
  };

  // Wake 84 — `<Name>'s <Plat> UI is still in the room`. Mirrors
  // Android sibling. Presence-check on `room_*` testTag PREFIX.
  driver.iosIsStillInRoom = async (_name) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const roomRx = /<XCUIElementType\w+[^>]*\bidentifier="room_[^"]*"[^>]*\/?>/;
    return roomRx.test(dump);
  };

  // Wake 86 — `<P1> on <plat1> and <P2> on <plat2> both join the
  // event room` (j16). iOS variant mirroring Android sibling.
  // Foundation: presence-check on `roomList_roomCard_*` PREFIX (any
  // room card in current dump — the journey orchestrator ensures
  // only the event room is in the list at this point). The `_name`
  // arg is accepted-and-ignored.
  driver.iosJoinEventRoom = async (_name) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="roomList_roomCard_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 95 — `<Name>'s <Plat> UI navigates back to the <tab> tab`.
  // Android sibling physically taps a nav tab via bounds extraction;
  // iOS foundation cannot perform real taps (no XCUITest harness yet
  // in scaffold state). Instead, presence-check that the main nav
  // bar is visible (any `main_*Tab` identifier in the dump) — the
  // journey orchestrator ensures the right tab was reached by the
  // time this matcher fires.
  //
  // Both args (_name, _tab) accepted-and-ignored. Per-tab verification
  // (asserting THIS specific tab is selected, not just nav-bar
  // visible) needs `selected="true"` attribute extraction, deferred.
  driver.iosNavigatesBackToTab = async (_name, _tab) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="main_[^"]*Tab"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 99 — `<Name>'s <Plat> UI navigates to "<Path>"`. Generic
  // path-based navigation assertion. Mirrors Android sibling.
  //
  // Foundation strategy: IOS_PATH_TAGS map with prefix-resolver
  //   1. Exact match (handles `/` — must not greedy-match other paths)
  //   2. Longest-prefix match: `/profile/42` → `/profile` mapping
  //
  // 5 mappings, grounded in expected iOS testTag naming (mirroring
  // Android sibling PATH_TAGS):
  //   - "/"         → main_roomsTab
  //   - "/profile"  → profile_displayName
  //   - "/messages" → main_messagesTab
  //   - "/wallet"   → wallet_balance
  //   - "/settings" → securitySettingsScreen
  //
  // Unmapped paths return false — FAIL-loud (consistent with other
  // *_TAGS scaffolds). Both args (_name, path) — name accepted-and-
  // ignored; path REQUIRED and used in lookup.
  const IOS_PATH_TAGS = {
    '/': 'main_roomsTab',
    '/profile': 'profile_displayName',
    '/messages': 'main_messagesTab',
    '/wallet': 'wallet_balance',
    '/settings': 'securitySettingsScreen',
  };
  function resolveIosPathTag(path) {
    if (IOS_PATH_TAGS[path]) return IOS_PATH_TAGS[path];
    let best = null;
    for (const prefix of Object.keys(IOS_PATH_TAGS)) {
      if (prefix === '/') continue;
      if (path === prefix || path.startsWith(prefix + '/')) {
        if (!best || prefix.length > best.length) best = prefix;
      }
    }
    return best ? IOS_PATH_TAGS[best] : null;
  }
  driver.iosNavigatesToPath = async (_name, path) => {
    if (typeof path !== 'string' || !path.trim()) return false;
    const tag = resolveIosPathTag(path.trim());
    if (!tag) return false;
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = new RegExp(`<XCUIElementType\\w+[^>]*\\bidentifier="${escTag}"[^>]*\\/?>`);
    return tagRx.test(dump);
  };

  // Wake 101 — `<Name>'s <Plat> UI navigates to <Other>'s profile
  // screen`. Mirrors Android sibling. Foundation: presence-check on
  // `profile_*` identifier PREFIX. Both args (_name, _target)
  // accepted-and-ignored; per-target verification needs
  // profile_displayName text-extraction.
  driver.iosNavigatesToProfileScreen = async (_name, _target) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="profile_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  const IOS_INPUT_TAGS = { chat: 'room_chatInput' };
  driver.iosDisablesInput = async (_name, inputName) => {
    if (!inputName || !inputName.trim()) return false;
    const tag = IOS_INPUT_TAGS[inputName.toLowerCase()];
    if (!tag) return false;
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = new RegExp(`<XCUIElementType\\w+[^>]*\\bidentifier="${escTag}"[^>]*\\/?>`);
    const tagMatch = dump.match(tagRx);
    if (!tagMatch) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    return /(?<![\w-])enabled="false"/.test(tagMatch[0]);
  };

  driver.close = async () => {
    /* devicectl is stateless; nothing to release */
  };

  return driver;
}

module.exports = { createIosDriver, listMethods, selectUdid, IOS_METHOD_NAMES };
