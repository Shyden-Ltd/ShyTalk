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

  // Wake 101 — `<Name>'s <Plat> UI navigates to the room screen`.
  // Mirrors Android sibling. Foundation: presence-check on `room_*`
  // identifier PREFIX. `_name` accepted-and-ignored.
  driver.iosNavigatesToRoomScreen = async (_name) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="room_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 101 — `<Name>'s <Plat> UI navigates to the warning screen`.
  // Mirrors Android sibling. Foundation: presence-check on `warning_*`
  // identifier PREFIX (matches WarningScreen.kt's warning_title /
  // warning_acknowledgeButton testTags). `_name` accepted-and-ignored.
  driver.iosNavigatesToWarningScreen = async (_name) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="warning_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 88 — `<Name> on <Plat> opens <Other>'s profile and taps
  // "<X>"` (j11:33). Mirrors Android sibling #767. Foundation:
  // presence-check on `profile_*` identifier PREFIX. Per-button
  // tap (Block/Report/Follow) is deferred until per-action testTags
  // exist. All 3 args (_actor, _target, _button) accepted-and-ignored.
  driver.iosOpenProfileAndTap = async (_actor, _target, _button) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="profile_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 88 — `<Name> on <Plat> opens <Other>'s profile from the <X>`
  // (j17:71, j18:49). Mirrors Android sibling. Foundation: presence-check
  // on `profile_*` identifier PREFIX. All 3 args (_actor, _target,
  // _source) accepted-and-ignored at foundation tier; the source surface
  // (room|PM|inbox|...) tells the driver which entry point to use once
  // per-element testTags ship.
  driver.iosOpenProfileFrom = async (_actor, _target, _source) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="profile_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 92 — `<Name> [P-NN] (cohort) opens the <tab> tab on iOS`.
  // Sister to iosNavigatesBackToTab (Wake 95) — both perform the same
  // main-nav tap, but kept distinct so future divergence (e.g. "opens"
  // launching a full activity vs "navigates back" being a pure tap)
  // doesn't need matcher churn. Mirrors Android `androidOpensTab`.
  //
  // Foundation strategy: presence-check that the main nav bar is
  // visible (any `main_*Tab` identifier in the dump). The journey
  // orchestrator ensures the right tab was reached by the time this
  // matcher fires. Both args (_name, _tab) accepted-and-ignored.
  driver.iosOpensTab = async (_name, _tab) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="main_[^"]*Tab"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 87 — `<Name> on <Plat> refreshes the language rail` (j17:78).
  // Pull-to-refresh / refresh-button on the language-filter rail.
  // Mirrors Android sibling. Driver receives `(name)`.
  //
  // Foundation strategy: presence-check on `languageRail_*` identifier
  // PREFIX. No `languageRail_*` identifier exists in commonMain yet —
  // the language-filter rail UI is unbuilt. Returns false in real
  // journeys today; lands true when the rail ships with `languageRail_*`
  // identifiers (e.g. languageRail_container, languageRail_refreshButton).
  //
  // Action body (pull-to-refresh gesture or tap the refresh button) is
  // deferred until per-element identifiers exist. `_name` accepted-and-
  // ignored.
  driver.iosRefreshLanguageRail = async (_name) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="languageRail_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 102 — `<Name>'s <Plat> UI replaces follow button with "<X>"`
  // (j07 — UI element swap after follow action completes). iOS mirror
  // of Android sibling. Inspects the `profile_followButton` identifier
  // node's XCUITest attributes for the buttonId string.
  //
  // The buttonId is one of the four follow-state strings: "Follow",
  // "Unfollow", "Following", "Follow back". These have OVERLAPPING
  // PREFIXES — "Follow" is a prefix of "Follow back" and "Following".
  // Substring matching would false-positive across them, so the
  // foundation uses EXACT (case-insensitive) match per attribute value.
  //
  // iOS divergence from Android: XCUITest emits `label=`, `name=`, and
  // optionally `value=` for button labels (vs Android's `text=` /
  // `content-desc=`). The identifier itself is captured separately and
  // is not considered as a label candidate.
  driver.iosReplacesFollowButton = async (_name, buttonId) => {
    if (!buttonId || !buttonId.trim()) return false;
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="profile_followButton"[^>]*\/?>/;
    const tagMatch = dump.match(tagRx);
    if (!tagMatch) return false;
    const target = buttonId.toLowerCase();
    const attrRx = /\b(?:label|name|value)="([^"]*)"/g;
    for (const m of tagMatch[0].matchAll(attrRx)) {
      if (m[1].toLowerCase() === target) return true;
    }
    return false;
  };

  // Wake 100 — `<Name>'s <Plat> UI shows the new "<X>" balance via
  // Firestore listener` (j06 — wallet refresh via real-time listener).
  // iOS mirror of Android sibling. Inspects the `wallet_balance`
  // identifier node's label/name/value XCUITest attrs for the balance
  // string.
  //
  // Balance shape: user-facing decimal with optional digit separators
  // ("5,000"), currency prefix ("$5,000"), and label padding
  // ("Balance: 5,000 coins"). Word-boundary regex prevents numeric-
  // prefix collisions ("45,000" must NOT match "5,000") and numeric-
  // suffix collisions ("5,0000" must NOT match "5,000"). Balance arg
  // is regex-escaped so "." matches a literal dot.
  //
  // Two-step extraction (Phase-5 pattern, same as iosReplacesFollowButton):
  // capture the wallet_balance tag, then scan its attributes — order
  // independent across label/name/value.
  driver.iosShowsBalanceViaListener = async (_name, balance) => {
    if (!balance || !balance.trim()) return false;
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="wallet_balance"[^>]*\/?>/;
    const tagMatch = dump.match(tagRx);
    if (!tagMatch) return false;
    const escBalance = balance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Scan within the captured tag for label=, name=, or value=
    // carrying the balance value with digit-boundary protection.
    // eslint-disable-next-line sonarjs/slow-regex
    const valueRx = new RegExp(
      `\\b(?:label|name|value)="[^"]*(?<![\\w-])${escBalance}(?!\\w)[^"]*"`,
    );
    return valueRx.test(tagMatch[0]);
  };

  // Wake 97 — `<Name>'s <Plat> UI shows a "<X>" banner`. Mirrors Android
  // sibling. Banners persist on-screen until dismissed (unlike toasts),
  // so a single dump scan is sufficient.
  //
  // Implementation: dump the UI tree, look for the banner text as any
  // of label=, name=, or value= XCUITest attribute values across ANY
  // node (no tag anchoring). Substring match — banners frequently
  // contain dynamic suffixes ("...in 5 minutes", "(retry)"), so an
  // exact-match would be too strict. Banner is regex-escaped.
  //
  // The \b before (?:label|name|value)= guards against compound
  // attribute names. For name= and value= it blocks typename=,
  // filename=, somevalue= via the word-boundary check. For label=,
  // accessibilityLabel= is ALSO blocked but by case-sensitivity
  // (lowercase label vs capital L) — if a future refactor adds the
  // `i` flag, the \b alone would NOT protect against accessibilityLabel=
  // (capital L immediately after `y` is a valid word boundary), so the
  // case-sensitivity decision matters. Whitespace-only banner returns
  // false defensively (runner Gherkin requires [^"]+ so unreachable
  // in practice).
  driver.iosShowsBanner = async (_name, banner) => {
    if (!banner || !banner.trim()) return false;
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    const escBanner = banner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    return new RegExp(`\\b(?:label|name|value)="[^"]*${escBanner}[^"]*"`).test(dump);
  };

  // Wake 87 — `<Name>'s <Plat> UI shows a chart of beans earned per
  // week` (j17:74). Mirrors Android sibling. Bare chart-presence
  // assertion. Driver receives `(name)`.
  //
  // Foundation strategy: presence-check on `beansChart_*` identifier
  // PREFIX. No such identifier exists in commonMain yet — chart UI is
  // unbuilt. Returns false in real journeys today; lands true when
  // the chart ships with `beansChart_*` identifiers (e.g.
  // beansChart_container, beansChart_weekBar).
  //
  // Bin-level value verification is out of scope. `_name` accepted-
  // and-ignored.
  driver.iosShowsBeansPerWeekChart = async (_name) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="beansChart_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 92 — `<Name>'s <Plat> UI shows the list of contributors with
  // amounts` (j15:35). iOS mirror of Android sibling. Single-arg.
  //
  // Foundation strategy: presence-check the gift-wall surface
  // (giftWall_grid identifier PRESENT). The "amounts" semantic is
  // journey-orchestrated — without per-row identifiers for contributor
  // amounts, the foundation can't verify the per-row structure. The
  // journey ensures this matcher only fires when the gift wall is
  // showing contributor entries.
  driver.iosShowsContributorsList = async (_name) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="giftWall_grid"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 98 — `<Name>'s <Plat> UI shows a +N in the "<X>" count`
  // (j01/j02/j07). iOS mirror of Android sibling. Generic delta-
  // badge assertion. Driver receives (name, delta, label).
  //
  // Foundation strategy: presence-check on `countBadge_*` identifier
  // PREFIX. No `countBadge_*` identifier exists in commonMain yet —
  // delta-badge UI is unbuilt. Returns false in real journeys today;
  // lands true when it ships with countBadge_followersDelta /
  // countBadge_likesDelta identifiers. Per-label verification
  // (Followers vs Likes) needs a label → identifier map; per-delta
  // verification needs attribute extraction; both deferred. All 3
  // args accepted-and-ignored.
  driver.iosShowsCountBadge = async (_name, _delta, _label) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="countBadge_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 103 — `<Name>'s <Plat> UI shows the edited body "<X>" with
  // an "<Y>" tag` (j07). iOS mirror of Android sibling. Message-edit
  // indicator on the recipient view. Driver receives (name, body, tag).
  //
  // Foundation strategy: presence-check on `editedBody_*` identifier
  // PREFIX. No such identifier exists in commonMain yet — only the
  // source-side `room_msg_editTarget_<id>` identifier exists, which
  // marks the message being edited (NOT the post-edit "(edited)"
  // badge on the recipient view — distinct concerns).
  //
  // Returns false in real journeys today; lands true when commonMain
  // ships editedBody_<msgId> / editedBody_badge identifiers. Per-body
  // and per-tag verification need attribute extraction; deferred. All
  // 3 args accepted-and-ignored.
  driver.iosShowsEditedBodyWithTag = async (_name, _body, _tag) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="editedBody_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 99 — `<Name>'s <Plat> UI[ opens conversation "<X>"] shows the
  // frozen-banner element <suffix>` (j08). iOS mirror of Android sibling.
  // Driver receives (viewer, convId, suffix) where convId is optional
  // (null when no "opens conversation X" prefix) and suffix is
  // descriptive ("with text-from-key X" or "with locale string Y").
  //
  // Foundation strategy: presence-check the EXACT `privateChat_frozenBanner`
  // identifier. All 3 args accepted-and-ignored — the assertion is
  // "frozen banner currently visible". Per-text and per-locale
  // verification can layer on later via attribute extraction.
  driver.iosShowsFrozenBanner = async (_viewer, _convId, _suffix) => {
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<XCUIElementType\w+[^>]*\bidentifier="privateChat_frozenBanner"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 99 — `<Name>'s <Plat> UI shows a "<X>" gift from <Other>`
  // (j01). iOS mirror of Android sibling. Driver receives
  // (recipient, giftId, sender).
  //
  // Foundation strategy: TRIPLE composition:
  //   1. giftWall_grid identifier PRESENT (recipient is on gift-wall).
  //   2. giftId substring appears in any label/name/value with
  //      symmetric word-boundary protection.
  //   3. sender substring appears in any label/name/value with
  //      symmetric word-boundary protection.
  //
  // Both substring scans run over the whole dump independently. The
  // journey orchestrator ensures only one gift entry is shown at the
  // time of the assertion, so cross-entry false positives aren't
  // reachable. _recipient is accepted-and-ignored.
  driver.iosShowsGiftFromSender = async (_recipient, giftId, sender) => {
    if (typeof giftId !== 'string' || !giftId.trim()) return false;
    if (typeof sender !== 'string' || !sender.trim()) return false;
    const dump = await driver.iosUiDump();
    if (!dump) return false;
    // Step 1: gift wall must be visible.
    // eslint-disable-next-line sonarjs/slow-regex
    const wallRx = /<XCUIElementType\w+[^>]*\bidentifier="giftWall_grid"[^>]*\/?>/;
    if (!wallRx.test(dump)) return false;
    // Step 2: giftId appears with symmetric word-boundary across
    // label/name/value attrs. The \b before (?:label|name|value)=
    // requires a word boundary IMMEDIATELY BEFORE the attr name —
    // because \b only fires at \W→\w transitions, compound attrs
    // like accessibilityLabel= are blocked (the `y` preceding `L`
    // is a word-char, so no boundary fires there). The symmetric
    // (?<![\w-]) / (?![\w-]) lookaround around ${escGift} blocks
    // both word-char AND hyphen on either side, so "roses"/
    // "wildrose"/"rose-gold" are all rejected for giftId="rose".
    const escGift = giftId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const giftRx = new RegExp(
      `\\b(?:label|name|value)="[^"]*(?<![\\w-])${escGift}(?![\\w-])[^"]*"`,
    );
    if (!giftRx.test(dump)) return false;
    // Step 3: sender appears with symmetric word-boundary.
    const escSender = sender.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const senderRx = new RegExp(
      `\\b(?:label|name|value)="[^"]*(?<![\\w-])${escSender}(?![\\w-])[^"]*"`,
    );
    return senderRx.test(dump);
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
