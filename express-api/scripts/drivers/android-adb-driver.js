/**
 * Android driver backed by `adb` (shell + uiautomator).
 *
 * Exposes the ctx.uiDriver methods that manual-qa-runner.js matchers
 * call for Android scenarios. The current implementation is a SCAFFOLD:
 * every method name from the matcher contract is wired to a stub that
 * returns false + logs a clear "not implemented" message. As scenarios
 * are exercised end-to-end, methods get real implementations one at a
 * time (input tap, uiautomator dump, am start, intent broadcast).
 *
 * Wiring contract:
 *   - `createAndroidDriver({ serial })` selects which adb device to drive.
 *   - Defaults to `adb-3b402284-56nfBT._adb-tls-connect._tcp` (the
 *     wireless physical device the operator has connected). Falls back
 *     to the first emulator if that serial isn't visible.
 *   - Methods accept the persona name as their first arg (matcher
 *     convention).
 *
 * Tooling notes:
 *   - `adb shell input tap X Y`              — taps a coordinate
 *   - `adb shell uiautomator dump --compressed /sdcard/dump.xml &&
 *      adb pull /sdcard/dump.xml -`          — gets the view tree
 *   - `adb shell am start -n pkg/.Activity`  — launches activity
 *   - `adb shell am broadcast -a ...`        — broadcasts intent
 *
 * The driver doesn't currently know which Activity each "screen"
 * corresponds to — that mapping needs to come from the app's
 * navigation registry. For now, methods log "not implemented" and the
 * runner surfaces a finding listing the matcher and the missing call.
 */
const { execSync } = require('child_process');

function selectSerial(preferredSerial) {
  let devices;
  try {
    devices = execSync('adb devices', { encoding: 'utf8' });
  } catch (_e) {
    return null;
  }
  const lines = devices.split('\n').filter((l) => /\tdevice$/.test(l));
  if (lines.length === 0) return null;
  const serials = lines.map((l) => l.split('\t')[0]);
  if (preferredSerial && serials.includes(preferredSerial)) return preferredSerial;
  // Prefer wireless TLS-connect device, then emulator.
  const wireless = serials.find((s) => s.includes('_adb-tls-connect'));
  if (wireless) return wireless;
  const emulator = serials.find((s) => s.startsWith('emulator-'));
  if (emulator) return emulator;
  return serials[0];
}

/**
 * Method-name list the runner expects on ctx.uiDriver for Android
 * scenarios. Extracted by grepping `androidXxx:` patterns in
 * manual-qa-runner.js. Each name maps to a stub returning false +
 * log; real implementations replace stubs incrementally.
 */
const ANDROID_METHOD_NAMES = [
  // Wake 86-106 vocabulary (matcher contract):
  'androidAdminShowsAppealText',
  'androidAdminShowsDashboardCounters',
  'androidAdminShowsNewReportInQueue',
  'androidAdminShowsRowCountInTable',
  'androidAdminShowsRowForWithStatus',
  'androidAdminShowsStat',
  'androidAdminShowsTableOf',
  'androidAlsoShowsInParticipantsList',
  'androidApproveSeatRequest',
  'androidContinuesNormallyInRoom',
  'androidDisablesInput',
  'androidIsNoLongerInVoiceRoom',
  'androidIsStillInRoom',
  'androidJoinEventRoom',
  'androidNavigatesBackToTab',
  'androidNavigatesToPath',
  'androidNavigatesToProfileScreen',
  'androidNavigatesToRoomScreen',
  'androidNavigatesToWarningScreen',
  'androidOpenProfileAndTap',
  'androidOpenProfileFrom',
  'androidOpensTab',
  'androidRefreshLanguageRail',
  'androidReplacesFollowButton',
  'androidShowsBalanceViaListener',
  'androidShowsBanner',
  'androidShowsBeansPerWeekChart',
  'androidShowsContributorsList',
  'androidShowsCountBadge',
  'androidShowsEditedBodyWithTag',
  'androidShowsFrozenBanner',
  'androidShowsGiftFromSender',
  'androidShowsInAppGiftNotification',
  'androidShowsInResults',
  'androidShowsInSeatGrid',
  'androidShowsInThread',
  'androidShowsMessageInConversationThread',
  'androidShowsMicIconAs',
  'androidShowsNamedKind',
  'androidShowsNewGiftEntry',
  'androidShowsNewUnreadConversation',
  'androidShowsNonEmptyLocaleText',
  'androidShowsOfficialBadge',
  'androidShowsOnlyMinorCohortInRankings',
  'androidShowsOwnRankInTop',
  'androidShowsPmThreadDirection',
  'androidShowsRoomClosedSummary',
  'androidShowsRoomWarningBanner',
  'androidShowsSecondOffensiveMessage',
  'androidShowsSeatRequestNotification',
  'androidShowsSeatWithIndicator',
  'androidShowsStalkersDelta',
  'androidShowsSystemPmFromOfficia',
  'androidShowsToastAndNavigates',
  'androidShowsToastAndNavigatesBack',
  'androidShowsUserCard',
  'androidShowsUserCardSkeletons',
  'androidShowsWarningScreenOnRelaunch',
  'androidShowsWarningScreenWithReason',
  'androidShowsWelcomePmInLanguage',
  'androidSubmitStarFeedback',
  'androidTapFromSurface',
  // From cycle-10 failure histogram:
  'androidOpenScreen',
  'androidTapByTag',
  'androidSearchIn',
  'androidScanAllRenderedStrings',
];

function listMethods() {
  return [...new Set(ANDROID_METHOD_NAMES)].sort();
}

/**
 * Create an Android driver instance.
 *
 *   const driver = await createAndroidDriver();
 *   ctx.uiDriver = driver;
 *
 * Real implementations land per-scenario. Currently all methods
 * return false + log "not implemented" so the runner produces a
 * concrete finding for each step rather than crashing.
 */
async function createAndroidDriver({ serial: preferred } = {}) {
  const serial = selectSerial(preferred);
  if (!serial) {
    throw new Error('No Android device connected (adb devices empty)');
  }
  const driver = { _serial: serial };

  function adb(args) {
    const cmd = ['adb', '-s', serial, ...args].map((a) => `'${a}'`).join(' ');
    return execSync(cmd, { encoding: 'utf8' });
  }
  driver.adb = adb;

  // Wire reverse port-forwards so wireless devices can reach
  // laptop-hosted local services (Express API, Firebase emulators,
  // LiveKit, MinIO). Without these, the app on a wireless device hits
  // a Technical-Difficulties screen because localhost on the DEVICE
  // is the device itself, not the laptop. Mirrors CLAUDE.md guidance
  // for "Android on physical device".
  for (const port of [3000, 7880, 9000, 8080, 9099, 9002]) {
    try {
      adb(['reverse', `tcp:${port}`, `tcp:${port}`]);
    } catch (e) {
      console.error(`[android-driver] adb reverse tcp:${port} failed: ${e.message}`);
    }
  }

  for (const methodName of listMethods()) {
    driver[methodName] = async (...args) => {
      console.error(
        `[android-driver] stub:${methodName}(${args.map((a) => JSON.stringify(a)).join(', ')}) — not implemented yet (device=${serial})`,
      );
      return false;
    };
  }

  // ── Real primitive implementations (override stubs) ─────────────────

  // Dump the current screen's view hierarchy via uiautomator. Returns
  // the raw XML string. Used by tag-targeted tap + assertion matchers
  // that scan for resource-id + bounds.
  driver.androidUiDump = async () => {
    try {
      adb(['shell', 'uiautomator', 'dump', '--compressed', '/sdcard/dump.xml']);
      const xml = adb(['shell', 'cat', '/sdcard/dump.xml']);
      return xml;
    } catch (e) {
      console.error(`[android-driver] androidUiDump failed: ${e.message}`);
      return '';
    }
  };

  // Tap at coordinate. Matchers compute (x, y) from the view dump's
  // bounds and call this primitive.
  driver.androidTap = async (x, y) => {
    try {
      adb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
      return true;
    } catch (e) {
      console.error(`[android-driver] androidTap(${x},${y}) failed: ${e.message}`);
      return false;
    }
  };

  // Dump the UI tree, find the bounds of the element with the given
  // resource-id (accepts short OR fully-qualified shapes), tap centre.
  // Returns true if found+tapped, false otherwise. Single-call replacement
  // for the dump+regex+tap dance many matchers do; future matchers should
  // call this instead of duplicating the logic.
  driver.androidTapByTag = async (tag) => {
    try {
      const dump = await driver.androidUiDump();
      const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // eslint-disable-next-line sonarjs/slow-regex
      const re = new RegExp(
        `resource-id="(?:[^"]*:id/)?${escTag}"[^<]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
      );
      const match = re.exec(dump);
      if (!match) return false;
      const [, x1, y1, x2, y2] = match.map((v, i) => (i === 0 ? v : Number(v)));
      const cx = Math.round((x1 + x2) / 2);
      const cy = Math.round((y1 + y2) / 2);
      return await driver.androidTap(cx, cy);
    } catch (e) {
      console.error(`[android-driver] androidTapByTag(${tag}) failed: ${e.message}`);
      return false;
    }
  };

  // Shared main-nav tab tapper used by both androidNavigatesBackToTab
  // (Wake 100, "<Name>'s Android UI navigates back to the <tab> tab")
  // and androidOpensTab (Wake 92, "<Name> [P-NN] (cohort) opens the
  // <tab> tab on Android"). Mechanically identical — both matchers
  // map to "tap the bottom-nav tab with the given name" — but kept
  // as separate driver methods so future divergence (e.g. "open" may
  // one day launch a full activity while "navigate back" stays a pure
  // tap) doesn't need API churn.
  //
  // Candidate testTag forms tried in order:
  //   1. `main_<lowered>Tab` — the ACTUAL pattern in
  //      shared/src/commonMain/kotlin/.../feature/main/MainScreen.kt
  //      lines 102/127/134: `main_roomsTab`, `main_messagesTab`,
  //      `main_profileTab`. This MUST be first — the others are
  //      fallbacks only.
  //   2-4. Generic fallbacks for any future surface that doesn't
  //      follow the main-nav convention.
  // First match wins.
  async function tapMainNavTab(label, tab) {
    const lowered = tab.toLowerCase();
    const candidates = [`main_${lowered}Tab`, lowered, `tab_${lowered}`, `bottomNav_${lowered}`];
    for (const candidate of candidates) {
      if (await driver.androidTapByTag(candidate)) {
        // Brief settle so the tab content can draw before subsequent
        // dump/tap calls. Mirrors androidOpenScreen's 1.5s wait but
        // shorter — tabs swap in-place without a full activity launch.
        await new Promise((r) => setTimeout(r, 500));
        return true;
      }
    }
    console.error(
      `[android-driver] ${label}(${tab}) — no testTag matched any of ${candidates.join(', ')}`,
    );
    return false;
  }

  driver.androidNavigatesBackToTab = async (_name, tab) =>
    tapMainNavTab('androidNavigatesBackToTab', tab);

  driver.androidOpensTab = async (_name, tab) => tapMainNavTab('androidOpensTab', tab);

  // Wake 97 — "<Name>'s Android UI shows a "<X>" banner". Generic
  // banner-text presence assertion. Banners persist on-screen until
  // dismissed (unlike toasts), so a single dump scan is sufficient.
  //
  // Implementation: dump the UI tree, look for the banner text as
  // either a `text=` or `content-desc=` attribute value (icon-only
  // banners often carry the message in content-desc for accessibility).
  // Substring match — banners frequently contain dynamic suffixes
  // ("...in 5 minutes", "(retry)"), so an exact-match would be too
  // strict. The banner-text input is regex-escaped to handle dynamic
  // characters in the assertion string itself (parens, dots, etc.).
  //
  // Round 1 review I-2 fix: the regex uses a `(?<![\w-])` negative
  // lookbehind before `(?:text|content-desc)=` so attribute names
  // like `hint-text=`, `sub-text=`, `error-text=` don't false-match
  // via their `text=` suffix. Only top-level `text=` and
  // `content-desc=` attributes (preceded by `<node `, whitespace,
  // or start-of-string — anything not a word char or hyphen) match.
  //
  // Round 1 review M-2: empty banner string returns false. A scenario
  // asking for `""` banner is a scenario authoring error; the prior
  // behaviour (matching any node with text="..." or content-desc="...")
  // would silently mask the bug.
  driver.androidShowsBanner = async (_name, banner) => {
    // Round 2 M-1: also guard against whitespace-only strings. A
    // banner of `'   '` would otherwise pass `!banner` and match
    // any node with 3+ consecutive spaces in its text attribute
    // — silent false positive. The runner regex requires `[^"]+`
    // so this isn't reachable from valid Gherkin, but cheap to
    // guard defensively.
    if (!banner || !banner.trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const escBanner = banner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    return new RegExp(`(?<![\\w-])(?:text|content-desc)="[^"]*${escBanner}[^"]*"`).test(dump);
  };

  // Generic "does the UI dump contain ANY of these resource-id
  // testTags?" predicate. Handles both the package-qualified form
  // (`resource-id="com.shyden.shytalk.local:id/<tag>"`) and the
  // bare form (`resource-id="<tag>"`). First match wins.
  //
  // Shared by every screen-presence assertion (room, warning, profile,
  // etc.). Centralising the regex means CRLF/quote/anchor concerns
  // live in one place and Phase 4 methods that follow can just pass
  // a marker list.
  function dumpHasAnyMarker(dump, markers) {
    // eslint-disable-next-line sonarjs/slow-regex
    return markers.some((m) => new RegExp(`resource-id="(?:[^"]*:id/)?${m}"`).test(dump));
  }

  // Room-screen markers (grounded to real Compose testTags):
  //   - room_seatGrid (RoomScreen.kt:718) — central body component
  //   - room_roomName (RoomToolbar.kt:60) — toolbar title
  //   - room_backButton (RoomToolbar.kt:84) — toolbar back button
  // Listing multiple defends against partial-render race conditions
  // (e.g. toolbar drawn but seat grid still loading).
  const ROOM_MARKERS = ['room_seatGrid', 'room_roomName', 'room_backButton'];
  function isInRoomScreen(dump) {
    return dumpHasAnyMarker(dump, ROOM_MARKERS);
  }

  // Warning-screen markers (WarningScreen.kt testTags):
  //   - warning_title (line 82)
  //   - warning_communityStandardsLink (line 112)
  //   - warning_acknowledgeButton (line 123)
  const WARNING_MARKERS = [
    'warning_title',
    'warning_communityStandardsLink',
    'warning_acknowledgeButton',
  ];
  function isOnWarningScreen(dump) {
    return dumpHasAnyMarker(dump, WARNING_MARKERS);
  }

  // Profile-screen markers (ProfileScreen.kt testTags):
  //   - profile_displayName (lines 507, 992) — title text
  //   - profile_walletButton (line 1146)
  //   - profile_followButton (lines 1179, 1188)
  //   - profile_messageButton (line 1198)
  const PROFILE_MARKERS = [
    'profile_displayName',
    'profile_walletButton',
    'profile_followButton',
    'profile_messageButton',
  ];
  function isOnProfileScreen(dump) {
    return dumpHasAnyMarker(dump, PROFILE_MARKERS);
  }

  // Wake 84 — "<Name>'s Android UI is still in the room".
  driver.androidIsStillInRoom = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    return isInRoomScreen(dump);
  };

  // Wake 105 — "<Name>'s Android UI is no longer in the voice room".
  // Inverse of androidIsStillInRoom. CRITICALLY: returns false (not
  // true) when the dump is empty — an empty dump means "can't
  // confirm", not "confirmed gone". Otherwise a dump failure would
  // incorrectly assert the user has left the room.
  driver.androidIsNoLongerInVoiceRoom = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    return !isInRoomScreen(dump);
  };

  // Wake 101 (first variant) — "<Name>'s Android UI navigates to the
  // warning screen". Presence assertion via WARNING_MARKERS.
  driver.androidNavigatesToWarningScreen = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    return isOnWarningScreen(dump);
  };

  // Wake 101 (second variant) — "<Name>'s Android UI shows the
  // warning screen again on next launch". Semantically distinct
  // from navigates-to (this is post-relaunch persistence), but
  // mechanically identical: assert the warning screen is currently
  // visible. Both methods share isOnWarningScreen via the marker
  // helper so the testTag contract stays in one place.
  driver.androidShowsWarningScreenOnRelaunch = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    return isOnWarningScreen(dump);
  };

  // Wake 102 — `<Name>'s Android UI shows the warning screen with
  // reason "<X>"`. j11 — punished user sees moderation reason.
  // TWO assertions in one method:
  //   1. The warning screen is currently visible (isOnWarningScreen)
  //   2. The reason text appears in some text= or content-desc=
  //      attribute (substring match, same shape as androidShowsBanner).
  // Both must hold. Reason is regex-escaped so dynamic chars (parens,
  // dots, ellipsis) match literally. Empty/whitespace-only reason
  // short-circuits to false.
  driver.androidShowsWarningScreenWithReason = async (_name, reason) => {
    if (!reason || !reason.trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    if (!isOnWarningScreen(dump)) return false;
    const escReason = reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    return new RegExp(`(?<![\\w-])(?:text|content-desc)="[^"]*${escReason}[^"]*"`).test(dump);
  };

  // Wake 96 — "<Name>'s Android UI navigates to the profile screen".
  // Presence assertion via PROFILE_MARKERS.
  driver.androidNavigatesToProfileScreen = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    return isOnProfileScreen(dump);
  };

  // Wake 99 — `<Name>'s Android UI navigates to the room screen
  // <suffix>`. j09 — 2 corpus rows with descriptive suffixes:
  //   - "with host seat occupied"
  //   - "as a non-seated participant"
  // The suffix is scenario-reader METADATA, not UI text. It would
  // never appear in a `text=`/`content-desc=` attribute, so attempting
  // to substring-match it into the dump would false-fail every call.
  // Driver asserts ROOM_MARKERS presence only and ignores the suffix.
  //
  // FUTURE: a follow-up PR can layer suffix-aware refinement on top
  // (e.g. for "with host seat occupied", additionally inspect the
  // seat-1 subtree for a non-empty avatar element). Done as a layer,
  // not a replacement, so the foundation assertion stays sound.
  driver.androidNavigatesToRoomScreen = async (_name, _suffix) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    return isInRoomScreen(dump);
  };

  // Wake 105 — "<Name>'s Android UI continues normally in the room"
  // (j10). Semantic: actor is unaffected by a mid-room moderation
  // event — still IN the room AND not on a warning screen. Composes
  // two existing predicates without introducing new markers.
  //
  // Precedence: warning beats room. If both ROOM_MARKERS and
  // WARNING_MARKERS appear in the same dump (rare — warning sheet
  // drawn over the still-mounted room), the user is NOT continuing
  // normally because the warning blocks interaction.
  //
  // FUTURE axis: "input disabled / frozen overlay while still in
  // room" has no Compose testTag yet — only `privateChat_frozenBanner`
  // exists, and that's the messaging surface, not the voice room.
  // Layer this third axis once the testTag lands (likely surfaced
  // during Phase 10 real journey-testing).
  driver.androidContinuesNormallyInRoom = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    if (isOnWarningScreen(dump)) return false;
    return isInRoomScreen(dump);
  };

  // Wake 103 — `<Name>'s Android UI shows mic icon as "<X>"` (j09
  // host mic on/off, j10 warning auto-mutes, j15 MC unmutes between
  // sets). Inspects the `room_micToggleButton` IconButton's
  // contentDescription (ChatPanel.kt:325-332) to determine state.
  //
  // The Compose contentDescription is the action a user would take
  // on tap, so the displayed STATE is the inverse:
  //   - contentDescription "Mute"              → mic is currently OPEN
  //   - contentDescription "Unmute"            → mic is currently MUTED
  //   - contentDescription "Voice unavailable" → mic is CLOSED
  //
  // Foundation policy: English (en-US) `local` flavor only.
  // Locale-aware expansion belongs in this map (driver-side), not
  // the runner — the Gherkin `state` arg is a stable literal.
  //
  // Attribute-order tolerance: uiautomator dump's attribute ordering
  // is not contractually fixed. The impl uses a TWO-STEP extraction:
  // first capture the full <node ...> tag containing the testTag,
  // then look for content-desc within that captured tag string.
  // This is order-independent and survives uiautomator version drift.
  const MIC_STATE_HINTS = {
    open: ['Mute'],
    muted: ['Unmute'],
    closed: ['Voice unavailable'],
  };
  driver.androidShowsMicIconAs = async (_name, state) => {
    if (!state) return false;
    const hints = MIC_STATE_HINTS[state.toLowerCase()];
    if (!hints) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?room_micToggleButton"[^>]*\/?>/;
    const tagMatch = dump.match(tagRx);
    if (!tagMatch) return false;
    const descMatch = tagMatch[0].match(/content-desc="([^"]*)"/);
    if (!descMatch) return false;
    const contentDesc = descMatch[1];
    // Round 1 I-1 fix: word-boundary match instead of bare
    // `.includes()`. Plain substring match was vulnerable to prefix
    // collisions — e.g. `"Auto-Unmute".includes("Unmute")` is true.
    //
    // Round 2 I-1 fix: conditional rule for multi-word hints. The
    // word-boundary regex `(?<![\w-])${h}(?!\w)` only anchors at
    // the OUTER edges of the hint string — so for a multi-word hint
    // like "Voice unavailable", a content-desc value of
    // "Enable Voice unavailable mode" matches (leading space passes
    // the left lookbehind, trailing space passes the right lookahead).
    // For multi-word hints, switch to exact (case-insensitive)
    // match: Compose emits stable literal strings, and any padded
    // form would be a regression in Compose, not an accessibility
    // tool's padding. Single-word hints retain the word-boundary
    // substring tolerance so accessibility-padded forms like
    // "Mute mic" / "Currently: Mute" still match.
    return hints.some((h) => {
      if (h.includes(' ')) {
        return contentDesc.toLowerCase() === h.toLowerCase();
      }
      const escH = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // eslint-disable-next-line sonarjs/slow-regex
      return new RegExp(`(?<![\\w-])${escH}(?!\\w)`).test(contentDesc);
    });
  };

  // Wake 100 — `<Name>'s Android UI shows the new "<X>" balance via
  // Firestore listener` (j06 — wallet refresh via real-time listener).
  // Inspects the `wallet_balance` node's `text=` and `content-desc=`
  // attributes for the balance string.
  //
  // Balance shape: user-facing decimal with optional digit separators
  // ("5,000"), currency prefix ("$5,000"), and label padding
  // ("Balance: 5,000 coins"). Word-boundary regex prevents numeric-
  // prefix collisions ("45,000" must NOT match "5,000") and numeric-
  // suffix collisions ("5,0000" must NOT match "5,000"). Same boundary
  // shape as androidShowsMicIconAs (PR #734) but applied across
  // text= AND content-desc= since either can carry the value.
  //
  // Balance arg is regex-escaped — a "." in "1,234.56" matches a
  // literal dot, not "any char" (decimal-point variant of the
  // numeric-collision concern).
  //
  // Two-step extraction (PR #734 pattern): capture the wallet_balance
  // node tag first, then scan its attributes. Attribute-order
  // independent.
  driver.androidShowsBalanceViaListener = async (_name, balance) => {
    if (!balance || !balance.trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?wallet_balance"[^>]*\/?>/;
    const tagMatch = dump.match(tagRx);
    if (!tagMatch) return false;
    const escBalance = balance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Scan within the captured tag for either text= or content-desc=
    // carrying the balance value with digit-boundary protection.
    // eslint-disable-next-line sonarjs/slow-regex
    const valueRx = new RegExp(`(?:text|content-desc)="[^"]*(?<![\\w-])${escBalance}(?!\\w)[^"]*"`);
    return valueRx.test(tagMatch[0]);
  };

  // Wake 102 — `<Name>'s Android UI replaces follow button with
  // "<X>"` (j07 — UI element swap after follow action completes).
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
  // padding; here the four states are mutually-exclusive labels and
  // exact match is the safer foundation. If a future surface
  // legitimately pads ("Follow • Alice"), this method's contract
  // needs an explicit revision, not silent drift.
  driver.androidReplacesFollowButton = async (_name, buttonId) => {
    if (!buttonId || !buttonId.trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?profile_followButton"[^>]*\/?>/;
    const tagMatch = dump.match(tagRx);
    if (!tagMatch) return false;
    const target = buttonId.toLowerCase();
    const attrRx = /(?:text|content-desc)="([^"]*)"/g;
    for (const m of tagMatch[0].matchAll(attrRx)) {
      if (m[1].toLowerCase() === target) return true;
    }
    return false;
  };

  // Wake 89 — `<Name>'s Android UI disables the <X> input` (j11:50).
  // Parameterised input-control state assertion. The inputName arg
  // is the bare control name ("chat", "comment", "gift", etc.),
  // mapped to a Compose testTag via INPUT_TAGS.
  //
  // Currently only "chat" → "room_chatInput" is grounded
  // (ChatPanel.kt:273). Unmapped names return false until a future
  // Compose change lands the missing testTag — better to FAIL the
  // assertion than silently match an unrelated node.
  //
  // Two-step extraction (PR #734 pattern): capture the input's node
  // tag first, then scan for `enabled="false"` within it. The
  // closing `"` anchors the right boundary so `enabled="falsey"` or
  // similar values don't false-match.
  const INPUT_TAGS = { chat: 'room_chatInput' };
  driver.androidDisablesInput = async (_name, inputName) => {
    if (!inputName || !inputName.trim()) return false;
    const tag = INPUT_TAGS[inputName.toLowerCase()];
    if (!tag) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = new RegExp(`<node[^>]*resource-id="(?:[^"]*:id\\/)?${tag}"[^>]*\\/?>`);
    const tagMatch = dump.match(tagRx);
    if (!tagMatch) return false;
    // Round 1 I-2: `(?<![\w-])` negative lookbehind blocks compound
    // attribute names ending in `enabled` (e.g. hyphenated forms
    // like `pre-enabled="false"`). Mirrors the boundary shape used
    // in androidShowsBanner's `text=` attribute guard. In current
    // uiautomator vocabulary the standard `enabled` is the only
    // such attribute, but the anchor defends against future surface
    // growth without cost.
    // eslint-disable-next-line sonarjs/slow-regex
    return /(?<![\w-])enabled="false"/.test(tagMatch[0]);
  };

  // Wake 99 — `<Name>'s Android UI[ opens conversation "<X>"] shows
  // the frozen-banner element <suffix>` (j08, 4 corpus rows). Driver
  // receives `(viewer, convId, suffix)` where convId is optional
  // (null when no "opens conversation X" prefix in the Gherkin) and
  // suffix is descriptive ("with text-from-key X" or "with locale
  // string Y").
  //
  // Foundation policy: presence-check `privateChat_frozenBanner`
  // testTag (PrivateChatScreen.kt:440) only. All three args are
  // accepted-and-ignored at this layer — the assertion is "the
  // frozen banner is currently visible". A future PR can layer
  // text-from-key / locale-string verification once those contracts
  // are clearer. Same shape as androidNavigatesToRoomScreen's
  // suffix-ignore foundation (PR #732).
  driver.androidShowsFrozenBanner = async (_viewer, _convId, _suffix) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?privateChat_frozenBanner"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 105 — `<Name>'s Android Admin UI shows the new report in
  // the queue` (j11). Single-arg assertion that the admin queue
  // contains at least one report. Foundation strategy combines two
  // Compose testTags from the ReportReview screen:
  //   - reportReview_list       — admin queue container (must be PRESENT)
  //   - reportReview_emptyState — empty-list placeholder (must be ABSENT)
  //
  // Together these answer "the queue is non-empty", which is the
  // closest foundation-layer interpretation of "shows the new
  // report" without a `status="new"` testTag distinguishing
  // freshly-filed from older reports. A future layer can add per-
  // row inspection (e.g. via a `reportReview_row_${id}` parameterised
  // testTag) to verify the SPECIFIC new report.
  //
  // Precedence: empty-state ALWAYS beats list-present. If both are
  // in the dump (theoretically impossible per Compose but pinnable),
  // the queue is considered empty and the assertion returns false.
  driver.androidAdminShowsNewReportInQueue = async (_reviewer) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const listRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?reportReview_list"[^>]*\/?>/;
    if (!listRx.test(dump)) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const emptyRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?reportReview_emptyState"[^>]*\/?>/;
    return !emptyRx.test(dump);
  };

  // Wake 92 — `<Name>'s Android Admin UI shows a table of recent
  // <X>` (j12:24). Generic admin-table presence assertion. The noun
  // arg can be 1-3 words per the matcher's `(\w+(?:\s+\w+){0,2})`
  // capture (e.g. "reports", "user reports", "active user reports").
  //
  // Foundation strategy: a TABLE_TAGS map from canonical noun to
  // Compose testTag. Currently only one entry exists:
  //   - "reports" → reportReview_list (the admin queue list)
  //
  // Unmapped nouns return false — same FAIL-loud contract as
  // INPUT_TAGS in androidDisablesInput (PR #737). Future Compose
  // work would add testTags for transactions/audits/users/etc.
  //
  // Returns boolean. The runner contract also accepts an array of
  // entries for richer assertion chains, but the foundation just
  // asserts visibility — a future PR can extract entries when
  // needed (e.g. for "each entry shows <fields>" follow-up steps).
  // TABLE_TAGS values are expected to be alphanumeric + underscore
  // only (Compose testTag convention). The defensive escape on `tag`
  // before regex interpolation defends against future entries that
  // might contain regex metacharacters (e.g. a hypothetical
  // "user-reports" with a hyphen, or worse, "report_list+" with a
  // `+`). Without the escape, the next entry could be a latent
  // regex-injection point.
  const TABLE_TAGS = { reports: 'reportReview_list' };
  driver.androidAdminShowsTableOf = async (_viewer, noun) => {
    if (!noun || !noun.trim()) return false;
    const tag = TABLE_TAGS[noun.trim().toLowerCase()];
    if (!tag) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = new RegExp(`<node[^>]*resource-id="(?:[^"]*:id\\/)?${escTag}"[^>]*\\/?>`);
    return tagRx.test(dump);
  };

  // Two matchers (Wake 32-ish) delegate to this method:
  //   `<P> on Android searches "<X>" in <screen>` → screen-scoped
  //   `<P> on Android types "<X>" into the search field` → active-screen (null)
  //
  // First action method in the cluster — instead of asserting state,
  // it performs a TAP + INPUT TEXT sequence. The runner doesn't
  // inspect the return value (always wraps in ok: true), but the
  // driver returns boolean for direct testability and for future
  // runner refactors that might surface failures.
  //
  // Foundation strategy: SEARCH_FIELD_TAGS map from canonical screen
  // name to Compose testTag. Currently one entry. Null screen falls
  // back to the same tag (active-screen typically means "the
  // currently visible search surface", which today is the new-
  // message composer).
  //
  // Text encoding: adb's `shell input text` splits on spaces by
  // default (each arg becomes a separate command). The standard
  // workaround is to encode spaces as `%s`. Non-space chars pass
  // through literally — no shell interpretation because adb()
  // single-quotes every arg.
  const SEARCH_FIELD_TAGS = { messages: 'newMessage_searchField' };
  const DEFAULT_SEARCH_FIELD_TAG = 'newMessage_searchField';
  driver.androidSearchIn = async (screen, text) => {
    // `typeof text !== 'string'` rejects null and undefined too
    // (typeof null === 'object'; typeof undefined === 'undefined').
    if (typeof text !== 'string' || !text.trim()) return false;
    // `!screen` matches null, undefined, and the empty string — all
    // route to the default field. Empty-string screen is unreachable
    // from valid Gherkin (matcher requires `\w+`), but the broad
    // check is defensive.
    const tag = !screen
      ? DEFAULT_SEARCH_FIELD_TAG
      : SEARCH_FIELD_TAGS[String(screen).trim().toLowerCase()];
    if (!tag) return false;
    const tapped = await driver.androidTapByTag(tag);
    if (!tapped) return false;
    try {
      // Round 1 C-1: text is the first USER-CONTROLLED free-form
      // string reaching adb() in the cluster. Prior methods passed
      // only known-safe values (numeric coords, alphanumeric tags).
      // adb() wraps each arg in single quotes; a single quote in
      // `text` (e.g. "O'Brien", "can't") would produce unbalanced
      // quotes and shell misparse.
      //
      // POSIX escape: replace ' with '\'' (close quote + escaped
      // literal quote + reopen quote). Inside the surrounding
      // single quotes that adb() adds, this round-trips correctly —
      // the device receives the literal text.
      //
      // KNOWN LIMITATION (Round 1 I-1): the literal sequence `%s` in
      // `text` is indistinguishable from an encoded space on the
      // device side — adb's `input text` decodes `%s` as a literal
      // space and has no `%%`-style escape. Searching for a string
      // containing `%s` will yield spaces at those positions. Not
      // fixable without a different keyboard-driver primitive
      // (e.g. uiautomator setText via UI Automator API) — separate PR.
      const quoteEscaped = text.replace(/'/g, "'\\''");
      const spaceEncoded = quoteEscaped.replace(/ /g, '%s');
      adb(['shell', 'input', 'text', spaceEncoded]);
      return true;
    } catch (e) {
      console.error(
        `[android-driver] androidSearchIn(${screen}, ${text}) input failed: ${e.message}`,
      );
      return false;
    }
  };

  // Wake 76 — `the test runner scans all rendered strings on
  // <Name>'s Android UI across N screens` (j13:60). Meta state-seed
  // method: collects every `text=` and `content-desc=` value from
  // the current uiautomator dump into an array, stored by the
  // runner on `ctx.scannedStrings` for follow-up assertion steps
  // (e.g. "no string has the en/strings.xml fallback when the
  // locale is X").
  //
  // Foundation policy: only scans the CURRENT screen. The `screens`
  // count is accepted-and-ignored — a future PR can add multi-
  // screen navigation (tap each main tab, dump, collect, repeat).
  // Even single-screen collection is useful for follow-up locale-
  // fallback assertions against the visible UI.
  //
  // Returns an array of unique non-empty trimmed string values.
  // Returns empty array on dump failure rather than null/undefined
  // — the runner stores the result on ctx and downstream steps
  // iterate it. A null/undefined return would force defensive
  // checks at every callsite.
  driver.androidScanAllRenderedStrings = async (_name, _screens) => {
    const dump = await driver.androidUiDump();
    if (!dump) return [];
    const collected = new Set();
    // Round 1 I-1 fix: the `(?<![\w-])` negative lookbehind blocks
    // compound attribute names ending in `text` (e.g. `hint-text=`,
    // `error-text=`, `sub-text=`). Without the guard, framework-
    // internal placeholder/error labels would pollute the scanned-
    // strings array and break downstream locale-fallback assertions.
    // Mirrors the boundary used in androidShowsBanner (line 308).
    // eslint-disable-next-line sonarjs/slow-regex
    const attrRx = /(?<![\w-])(?:text|content-desc)="([^"]*)"/g;
    for (const m of dump.matchAll(attrRx)) {
      const value = m[1].trim();
      if (value) collected.add(value);
    }
    return [...collected];
  };

  // Composite matcher Wake 86-ish — "<P1> on <plat1> and <P2> on
  // <plat2> both join the event room". Each platform's driver
  // receives just the persona name and joins whatever room is
  // currently visible (the journey orchestrator ensures only the
  // event room is in the list at this point).
  //
  // Foundation strategy: tap the FIRST `roomList_roomCard_*` node
  // found in the current uiautomator dump. This is the cluster's
  // first method using a PARAMETERISED testTag prefix-match
  // (vs. exact-match for INPUT_TAGS / TABLE_TAGS lookups). The
  // `[^"]*` wildcard suffix matches any room-id (Firestore-style
  // alphanumeric+hyphens) attached by HomeScreen.kt:155.
  //
  // If no room card is visible (empty rooms tab, or actor on a
  // different tab), returns false — the journey author gets a
  // clear FAIL.
  driver.androidJoinEventRoom = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // Round 1 I-1 refactor: use the TWO-STEP extraction pattern
    // established by androidShowsMicIconAs (line 502),
    // androidShowsBalanceViaListener (line 559), and
    // androidReplacesFollowButton (line 596). This is
    // ORDER-INDEPENDENT (handles bounds before or after resource-id
    // in the same tag) and structurally cannot match a child
    // node's bounds when the parent lacks them — `[^>]*` stays
    // within the opening tag, then bounds is scanned from the
    // captured tag string only. Sets the reference template for
    // subsequent parameterised-testTag methods in this cluster.
    //
    // Diverges from androidTapByTag (line 218) which still uses
    // the older `[^<]*?` pattern. That method works correctly
    // because uiautomator emits bounds AFTER resource-id (verified
    // standard order), but the two-step is the stricter
    // foundation for the rest of the cluster.
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?roomList_roomCard_[^"]*"[^>]*\/?>/;
    const tagMatch = dump.match(tagRx);
    if (!tagMatch) return false;
    const boundsMatch = tagMatch[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!boundsMatch) return false;
    const cx = Math.round((Number(boundsMatch[1]) + Number(boundsMatch[3])) / 2);
    const cy = Math.round((Number(boundsMatch[2]) + Number(boundsMatch[4])) / 2);
    return await driver.androidTap(cx, cy);
  };

  // Wake 99 — `<Name>'s Android UI navigates to "<Path>"` (j03+).
  // Generic path-based navigation assertion. Path is a web-style
  // URL like `/`, `/profile/42`, `/messages/abc`.
  //
  // Foundation strategy: PATH_TAGS map with prefix-resolver
  //   1. Exact match (handles `/` — must not greedy-match other paths)
  //   2. Prefix match: `/profile/42` → `/profile` mapping
  //
  // Currently 5 mappings, all grounded in existing Compose testTags:
  //   - "/"         → main_roomsTab            (root → rooms landing)
  //   - "/profile"  → profile_displayName       (any profile screen)
  //   - "/messages" → main_messagesTab          (messages tab)
  //   - "/wallet"   → wallet_balance            (wallet screen)
  //   - "/settings" → securitySettingsScreen    (settings landing)
  //
  // Unmapped paths return false — FAIL-loud contract (same as
  // INPUT_TAGS / TABLE_TAGS scaffolds).
  //
  // Foundation contract: PRESENCE check only. Tab paths assert the
  // tab BAR is visible (true on every main screen), so they're
  // looser than "user is on THIS tab specifically". A future PR
  // can tighten with `selected="true"` for tab paths.
  const PATH_TAGS = {
    '/': 'main_roomsTab',
    '/profile': 'profile_displayName',
    '/messages': 'main_messagesTab',
    '/wallet': 'wallet_balance',
    '/settings': 'securitySettingsScreen',
  };
  function resolvePathTag(path) {
    if (PATH_TAGS[path]) return PATH_TAGS[path];
    // Prefix match: longest-matching prefix wins. Exclude '/' from
    // prefix iteration (it's exact-only — otherwise every path
    // would prefix-match it).
    let best = null;
    for (const prefix of Object.keys(PATH_TAGS)) {
      if (prefix === '/') continue;
      if (path === prefix || path.startsWith(prefix + '/')) {
        if (!best || prefix.length > best.length) best = prefix;
      }
    }
    return best ? PATH_TAGS[best] : null;
  }
  driver.androidNavigatesToPath = async (_name, path) => {
    if (typeof path !== 'string' || !path.trim()) return false;
    const tag = resolvePathTag(path.trim());
    if (!tag) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = new RegExp(`<node[^>]*resource-id="(?:[^"]*:id\\/)?${escTag}"[^>]*\\/?>`);
    return tagRx.test(dump);
  };

  // Wake 100 — `<Name>'s Android UI shows the new "<X>" gift entry`
  // (j05 — gift-log entry on recipient view). Driver receives
  // `(name, giftId)` where giftId is the friendly name ("crown",
  // "rose", etc.) per the j05 corpus.
  //
  // Foundation strategy: two-step COMPOSITION (mirrors
  // androidAdminShowsNewReportInQueue from PR #739):
  //   1. giftWall_grid testTag must be PRESENT (user is on the
  //      gift-wall surface).
  //   2. giftId text appears anywhere in the dump with word-boundary
  //      protection — same regex shape as androidShowsBanner.
  //
  // The "new" semantic is journey-orchestrated — the test runs
  // RIGHT AFTER a gift is sent, so the latest entry IS the new one.
  // A future PR could layer per-row inspection (e.g.
  // `giftWall_entry_${giftId}` parameterised testTag) to verify
  // the specific entry rather than any text occurrence.
  driver.androidShowsNewGiftEntry = async (_name, giftId) => {
    if (typeof giftId !== 'string' || !giftId.trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // Step 1: gift wall must be visible
    // eslint-disable-next-line sonarjs/slow-regex
    const wallRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?giftWall_grid"[^>]*\/?>/;
    if (!wallRx.test(dump)) return false;
    // Step 2: giftId text appears with word-boundary protection
    // (same boundary shape as androidShowsBanner — blocks prefix
    // collisions like "Crowning" / "primrose" matching "crown" /
    // "rose"). Hint is regex-escaped for future gift IDs that
    // might contain dots, plus signs, etc.
    const escGift = giftId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Round 1 I-1 fix: SYMMETRIC inner boundaries. Original was
    // `(?<![\w-])...(?!\w)` — left blocks word + hyphen, right only
    // blocks word. Asymmetric: `text="crown-shaped"` false-matches
    // `crown` because hyphen passes the right lookahead.
    //
    // Fixed to `(?![\w-])` on the right — symmetric with the left
    // lookbehind. Now `crown-shaped` correctly does NOT match
    // `crown`, while `Adam sent crown today` (space-padded) still
    // does. Defends against compound gift labels like "rose-gold
    // pendant" false-matching the "rose" hint.
    // eslint-disable-next-line sonarjs/slow-regex
    const giftRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escGift}(?![\\w-])[^"]*"`,
    );
    return giftRx.test(dump);
  };

  // Wake 102 — `<Name>'s Android UI shows <Other> in seat N of the
  // seat grid` (j09). Driver receives `(viewer, target, seatNum)`.
  //
  // Foundation strategy: two-step composition (mirrors PR #745's
  // androidShowsNewGiftEntry):
  //   1. room_seatGrid testTag PRESENT (user is on the room screen).
  //   2. target's name appears in any text= or content-desc= with
  //      SYMMETRIC word-boundary protection (`(?<![\w-])` +
  //      `(?![\w-])` — same shape as PR #745 R1 fix).
  //
  // The seat-position semantic is journey-orchestrated until per-
  // seat testTags exist (Compose currently only tags the container
  // `room_seatGrid`, not individual seats). A future PR could
  // layer this with e.g. `room_seat_${seatNum}_displayName` for
  // stricter per-position verification.
  driver.androidShowsInSeatGrid = async (_viewer, target, _seatNum) => {
    if (typeof target !== 'string' || !target.trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // Step 1: seat-grid must be visible
    // eslint-disable-next-line sonarjs/slow-regex
    const gridRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?room_seatGrid"[^>]*\/?>/;
    if (!gridRx.test(dump)) return false;
    // Step 2: target name appears with symmetric word-boundary
    const escTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const targetRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escTarget}(?![\\w-])[^"]*"`,
    );
    return targetRx.test(dump);
  };

  // Wake 99 — `<Name>'s Android UI shows a "<X>" gift from <Other>`
  // (j01). Driver receives `(recipient, giftId, sender)`.
  //
  // Foundation strategy: TRIPLE composition (extends the double
  // composition from PR #745):
  //   1. giftWall_grid testTag PRESENT (recipient is on gift-wall).
  //   2. giftId text appears with symmetric word-boundary.
  //   3. sender text appears with symmetric word-boundary.
  //
  // Both substring scans run over the whole dump independently.
  // The journey orchestrator ensures only one gift entry is shown
  // at the time of the assertion, so cross-entry "match in
  // different entries" false positives aren't reachable. A future
  // PR could layer per-entry verification once Compose ships per-
  // entry testTags.
  driver.androidShowsGiftFromSender = async (_recipient, giftId, sender) => {
    if (typeof giftId !== 'string' || !giftId.trim()) return false;
    if (typeof sender !== 'string' || !sender.trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // Step 1: gift wall must be visible
    // eslint-disable-next-line sonarjs/slow-regex
    const wallRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?giftWall_grid"[^>]*\/?>/;
    if (!wallRx.test(dump)) return false;
    // Step 2: giftId appears with symmetric word-boundary
    const escGift = giftId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const giftRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escGift}(?![\\w-])[^"]*"`,
    );
    if (!giftRx.test(dump)) return false;
    // Step 3: sender appears with symmetric word-boundary
    const escSender = sender.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const senderRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escSender}(?![\\w-])[^"]*"`,
    );
    return senderRx.test(dump);
  };

  // Wake 105 — `<Name>'s Android UI shows the message in the
  // conversation thread` (j11). Single-arg. The matcher is
  // intentionally specific (NOT the Wake-100 generic in-thread
  // variant with a noun capture): "the message" refers to a
  // journey-orchestrated specific message that was just sent.
  //
  // Foundation strategy: assert the conversation thread is open
  // by checking `privateChat_messageInput` testTag presence. The
  // journey orchestrator ensures this matcher only fires AFTER a
  // specific message was sent, so "the message" being visible is
  // implied by the thread being open.
  //
  // A future PR could layer per-message verification once Compose
  // ships per-message testTags (currently only the input field has
  // a testTag). Same shape as PR #731's androidNavigatesToProfileScreen.
  driver.androidShowsMessageInConversationThread = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // eslint-disable-next-line sonarjs/slow-regex
    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?privateChat_messageInput"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 102 — `<Name>'s Android UI shows a new conversation with
  // <Other> highlighted as unread` (j07 — recipient's inbox shows
  // new unread conversation from sender). Driver receives
  // `(viewer, other)`.
  //
  // Foundation strategy: two-step composition (mirrors PR #745):
  //   1. main_messagesTab testTag PRESENT (viewer is in messages
  //      area — this assertion can't be made from anywhere else).
  //   2. other's name appears in text/content-desc with symmetric
  //      word-boundary protection.
  //
  // The "highlighted as unread" semantic is journey-orchestrated.
  // No per-row testTag exists for unread state today; a future PR
  // could layer this with e.g. `conversation_row_${id}_unread`.
  driver.androidShowsNewUnreadConversation = async (_viewer, other) => {
    if (typeof other !== 'string' || !other.trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // Step 1: messages tab visible
    // eslint-disable-next-line sonarjs/slow-regex
    const tabRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?main_messagesTab"[^>]*\/?>/;
    if (!tabRx.test(dump)) return false;
    // Step 2: other name appears with symmetric word-boundary
    const escOther = other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const otherRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escOther}(?![\\w-])[^"]*"`,
    );
    return otherRx.test(dump);
  };

  // Wake 98 — `<Name>'s Android Admin UI shows N row for "<X>" with
  // status "<Y>"` (j01/j04 admin-queue row presence). Driver
  // receives `(viewer, count, targetId, status)`.
  //
  // Foundation strategy: TRIPLE composition (mirrors PR #747's
  // androidShowsGiftFromSender):
  //   1. reportReview_list testTag PRESENT (admin queue visible)
  //   2. targetId text appears with symmetric word-boundary
  //   3. status text appears with symmetric word-boundary
  //
  // The COUNT (typically 1) is journey-orchestrated and ignored
  // at foundation — no per-row testTag exists for counting matching
  // rows. A future PR could layer this with `reportReview_row_${id}`
  // parameterised testTags.
  //
  // Cross-row pass-through (same as PR #747): if multiple rows
  // are visible with targetId in row-A and status in row-B, the
  // assertion passes. Journey orchestrator's responsibility to
  // ensure single-row context.
  driver.androidAdminShowsRowForWithStatus = async (_viewer, _count, targetId, status) => {
    if (typeof targetId !== 'string' || !targetId.trim()) return false;
    if (typeof status !== 'string' || !status.trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // Step 1: admin queue visible
    // eslint-disable-next-line sonarjs/slow-regex
    const listRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?reportReview_list"[^>]*\/?>/;
    if (!listRx.test(dump)) return false;
    // Step 2: targetId appears with symmetric word-boundary
    const escTarget = targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const targetRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escTarget}(?![\\w-])[^"]*"`,
    );
    if (!targetRx.test(dump)) return false;
    // Step 3: status appears with symmetric word-boundary
    const escStatus = status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // eslint-disable-next-line sonarjs/slow-regex
    const statusRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escStatus}(?![\\w-])[^"]*"`,
    );
    return statusRx.test(dump);
  };

  // Open named screen — launches the local-build app via MainActivity.
  // The app's AndroidManifest does NOT declare a `shytalk://` scheme
  // (only HTTPS auth deep-links per app/src/main/AndroidManifest.xml).
  // Without an in-app nav-via-intent mechanism, the best we can do is
  // launch the main activity and trust the app's startup routing to
  // land somewhere sensible (typically home or sign-in). Per-screen
  // navigation needs to be UI-driven (tap by uiautomator-dump tag) and
  // is the responsibility of higher-level matchers.
  //
  // Calling convention: single screen identifier (matchers pass one arg).
  // Aligned with iosOpenScreen — previous (name, screen) signature did
  // not match the matcher contract.
  driver.androidOpenScreen = async (screen) => {
    try {
      adb([
        'shell',
        'am',
        'start',
        '-n',
        'com.shyden.shytalk.local/com.shyden.shytalk.MainActivity',
      ]);
      // Brief settle so the activity has time to draw before subsequent
      // dump/tap calls. The 1.5s value mirrors what the existing
      // android-e2e tests use (see app/src/androidTest fixtures).
      await new Promise((r) => setTimeout(r, 1500));
      // Stash the requested screen on the driver so a future matcher
      // can use it as a hint when implementing real in-app navigation.
      driver._requestedScreen = screen;
      return true;
    } catch (e) {
      console.error(`[android-driver] androidOpenScreen(${screen}) failed: ${e.message}`);
      return false;
    }
  };

  driver.close = async () => {
    /* adb sessions are stateless; nothing to release */
  };

  return driver;
}

module.exports = { createAndroidDriver, listMethods, selectSerial, ANDROID_METHOD_NAMES };
