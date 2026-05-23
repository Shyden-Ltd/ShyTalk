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
  // with a foundation presence-check (e.g.
  //   driver.iosShowsUserCard = async (_viewer, _target) => {
  //     const dump = await driver.iosUiDump();
  //     if (!dump) return false;
  //     const tagRx = /<XCUIElementTypeAny[^>]*identifier="(?:[^"]*:id\/)?userCard_[^"]*"[^>]*\/?>/;
  //     return tagRx.test(dump);
  //   };
  // until all names have foundation implementations.
  for (const methodName of listMethods()) {
    driver[methodName] = async (..._args) => false;
  }

  driver.close = async () => {
    /* devicectl is stateless; nothing to release */
  };

  return driver;
}

module.exports = { createIosDriver, listMethods, selectUdid, IOS_METHOD_NAMES };
