/**
 * A driver that redefines a SHARED method silently discards it.
 *
 * Both drivers register the shared surface with:
 *
 *     for (const [name, impl] of Object.entries(sharedMethods)) {
 *       if (typeof driver[`android${name}`] === 'function') continue;   // <-- here
 *       driver[`android${name}`] = impl;
 *     }
 *
 * so a driver-local definition wins and NOTHING records that a shared
 * implementation was thrown away. The method still exists, still answers, still
 * appears in the declared list — it is simply a different implementation from
 * the one the shared tests cover.
 *
 * Measured 2026-08-02: **Android shadowed 86 of 104**. The shared layer exists
 * to let the corpus say "on the app" and be answered identically on both
 * phones; at 86/104 that is largely fiction on Android.
 *
 * It cost real time the same day. `ShowsNamedKind` was taught to resolve a
 * screen through SCREEN_MARKERS so j11's "shows the suspension screen" could
 * pass — verified green in the shared unit tests, and STILL failing on the
 * device, because android-adb-driver.js had its own copy holding a
 * single-entry map. The fix reached iOS and not the cell being measured.
 *
 * This does not delete the 86 — several are genuinely platform-specific and
 * removing them blind would be reckless. It FREEZES them, so the count can only
 * fall, and a NEW shadow has to be added here deliberately with a reason.
 */
const fs = require('fs');
const path = require('path');

const DRIVERS = path.join(__dirname, '../../../scripts/drivers');
const { SHARED_METHOD_NAMES } = require(path.join(DRIVERS, 'app-ui-methods'));

/** Shared names a driver file assigns itself, i.e. `driver.androidX = ...`. */
function shadowedBy(file, prefix) {
  const src = fs.readFileSync(path.join(DRIVERS, file), 'utf8');
  return SHARED_METHOD_NAMES.filter((n) =>
    new RegExp(`driver\\.${prefix}${n}\\s*=`).test(src),
  ).sort();
}

/**
 * FROZEN 2026-08-02. May only SHRINK.
 *
 * Each entry is a shared implementation the Android driver overrides. Removing
 * one means deleting the local copy and letting the shared version register —
 * which is what happened to `ShowsNamedKind`, the first name to leave this list.
 */
const ANDROID_SHADOWS = [
  'AdminShowsAppealText',
  'AdminShowsDashboardCounters',
  'AdminShowsNewReportInQueue',
  'AdminShowsRowCountInTable',
  'AdminShowsRowForWithStatus',
  'AdminShowsStat',
  'AdminShowsTableOf',
  'AlsoShowsInParticipantsList',
  'ApiPost',
  'ApproveSeatRequest',
  'AttemptBlock',
  'AttemptFollowViaProfile',
  'AttemptStartConversation',
  'ConfirmDialog',
  'ContinuesNormallyInRoom',
  'CreateRoomComposite',
  'DisablesInput',
  'ForceRefreshJwt',
  'ForceRefreshSecureToken',
  'GetLayoutDirection',
  'IsNoLongerInVoiceRoom',
  'IsStillInRoom',
  'JoinEventRoom',
  'KillAndRelaunch',
  'LongPressMessageAndTap',
  'LongPressSeat',
  'NavigatesBackToTab',
  'NavigatesToPath',
  'NavigatesToProfileScreen',
  'NavigatesToRoomScreen',
  'NavigatesToWarningScreen',
  'NetworkDropFor',
  'OpenProfileAndTap',
  'OpenProfileFrom',
  'OpensTab',
  'PerformAuthenticatedCall',
  'PickIdType',
  'PickTestImageBySize',
  'RefreshLanguageRail',
  'ReplacesFollowButton',
  'RetrySamePurchase',
  'ScanAllRenderedStrings',
  'SearchIn',
  'SelectFromFollowedPicker',
  'SelectGalleryImage',
  'SelectGiftRecipient',
  'SendMessageTo',
  'ShowsBalanceViaListener',
  'ShowsBanner',
  'ShowsBeansPerWeekChart',
  'ShowsContributorsList',
  'ShowsCountBadge',
  'ShowsEditedBodyWithTag',
  'ShowsGiftFromSender',
  'ShowsInAppGiftNotification',
  'ShowsInResults',
  'ShowsInSeatGrid',
  'ShowsInThread',
  'ShowsMessageInConversationThread',
  'ShowsMicIconAs',
  'ShowsNewGiftEntry',
  'ShowsNewUnreadConversation',
  'ShowsOfficialBadge',
  'ShowsOnlyMinorCohortInRankings',
  'ShowsPmThreadDirection',
  'ShowsRoomWarningBanner',
  'ShowsRoute',
  'ShowsSeatWithIndicator',
  'ShowsSecondOffensiveMessage',
  'ShowsStalkersDelta',
  'ShowsSystemPmFromOfficia',
  'ShowsToastAndNavigates',
  'ShowsToastAndNavigatesBack',
  'ShowsUserCard',
  'ShowsUserCardSkeletons',
  'ShowsWarningScreenOnRelaunch',
  'ShowsWarningScreenWithReason',
  'SignOut',
  'SignupWithDOB',
  'SubmitStarFeedback',
  'TapEventInviteAction',
  'TapFromSurface',
  'TapQuotedTarget',
  'TapQuotedTargetOrName',
  'TapRoomCard',
].sort();

/** iOS overrides far fewer, and the same rule applies. */
const IOS_SHADOWS = [
  'ConfirmDialog',
  'NetworkDropFor',
  'SearchIn',
  'ShowsMicIcon',
  'ShowsParticipantsList',
  'ShowsRoomScreen',
  'ShowsSeatGrid',
  'ShowsToast',
  'TapQuotedTarget',
  'TapRoomCard',
].sort();

describe('the scan is real', () => {
  it('reads a substantial shared surface', () => {
    // Calibration. If SHARED_METHOD_NAMES ever came back empty the checks below
    // would pass while comparing nothing — the failure mode this guards.
    expect(SHARED_METHOD_NAMES.length).toBeGreaterThan(50);
  });

  it('detects a shadow that is really there', () => {
    // ConfirmDialog is overridden on BOTH drivers, so a scanner returning
    // nothing is broken rather than lucky.
    expect(shadowedBy('android-adb-driver.js', 'android')).toContain('ConfirmDialog');
    expect(shadowedBy('ios-appium-driver.js', 'ios')).toContain('ConfirmDialog');
  });
});

describe('shared-method shadowing may only shrink', () => {
  it('Android adds no NEW override of a shared method', () => {
    const now = shadowedBy('android-adb-driver.js', 'android');
    const added = now.filter((n) => !ANDROID_SHADOWS.includes(n));
    // Named with the fix: delete the local copy so the shared one registers, or
    // add it here with a reason it must stay platform-specific.
    expect({ newlyShadowed: added }).toEqual({ newlyShadowed: [] });
  });

  it('iOS adds no NEW override of a shared method', () => {
    const now = shadowedBy('ios-appium-driver.js', 'ios');
    const added = now.filter((n) => !IOS_SHADOWS.includes(n));
    expect({ newlyShadowed: added }).toEqual({ newlyShadowed: [] });
  });

  it('the frozen lists contain nothing already removed', () => {
    // Keeps the baseline honest in the other direction: a name that has been
    // un-shadowed must leave the list, or the debt looks larger than it is and
    // the next reader cannot tell which entries are real.
    const androidStale = ANDROID_SHADOWS.filter(
      (n) => !shadowedBy('android-adb-driver.js', 'android').includes(n),
    );
    const iosStale = IOS_SHADOWS.filter(
      (n) => !shadowedBy('ios-appium-driver.js', 'ios').includes(n),
    );
    expect({ androidStale, iosStale }).toEqual({ androidStale: [], iosStale: [] });
  });

  it('ShowsNamedKind is NOT shadowed — screens resolve through the shared table', () => {
    // The one this guard was written for. j11 asserts "shows the suspension
    // screen"; the shared implementation answers it from SCREEN_MARKERS, and
    // the Android copy answered from a one-entry map that had never heard of
    // suspension. Pinned by name so it cannot quietly come back.
    expect(shadowedBy('android-adb-driver.js', 'android')).not.toContain('ShowsNamedKind');
    expect(shadowedBy('ios-appium-driver.js', 'ios')).not.toContain('ShowsNamedKind');
  });
});
