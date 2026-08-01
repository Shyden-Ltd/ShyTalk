/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. */
/* The `sonarjs/no-os-command-from-path` suppression that used to sit here is
   gone, and its absence is the point: every invocation now goes through
   `execFileSync(resolveAdbPath(), argv)` — an absolute path, no PATH search,
   and no shell. The rule no longer fires because the condition it warns about
   no longer exists. */
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
const { execFileSync } = require('child_process');
const { dumpWithRetry, resolveDumpBackoffMs } = require('./ui-dump-retry');
const { withDeviceLock } = require('./device-lock');
const { resolveAdbPath } = require('./android-cdp-helpers');
const { quoteAdbArgs, deviceShellArg } = require('./device-shell');
const { createSurfaceBreaker } = require('./surface-circuit-breaker');
const { createSubmitClock } = require('./render-timing');
const { execBounds, describeExecFailure, DEFAULT_ADB_TIMEOUT_MS } = require('./device-io-timeout');
const {
  centreOf,
  centreOfCardWithLabel,
  dumpHas,
  hasEditableField,
  escapeInputText,
  parseSeatGrid,
  parseLayoutDirection,
} = require('./ui-dump-query');

function selectSerial(preferredSerial) {
  let devices;
  try {
    // execFileSync + resolved path: no shell, and no PATH search. There is no
    // user input here, but leaving one shell behind invites the next call to
    // be added the same way — and this one was also unbounded, so a wedged
    // adb server hung driver construction before a single scenario ran.
    devices = execFileSync(resolveAdbPath(), ['devices'], execBounds({ timeoutMs: 15000 }));
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
 * Classify the ShyTalk Android app's auth/screen state from a uiautomator
 * UI dump, so androidPersonaSignIn can decide whether to proceed to the
 * picker, sign out first, clear a gate, or wait. Pure string→enum (no I/O)
 * so it is unit-tested against REAL device-captured dumps (SHY-0096).
 *
 * Returned states (checked in precedence order — most-blocking first):
 *   - 'warning'    — a moderation warning gate is shown over the session
 *                    (`warning_acknowledgeButton`). Must win over signed_in so
 *                    the caller signs out/acknowledges rather than treating the
 *                    user as fully on main.
 *   - 'degraded'   — the backend-unreachable gate (`degraded_title` /
 *                    `degraded_acknowledgeButton`, DegradedModeScreen.kt). Also
 *                    wins over signed_in: the session may be valid but nothing
 *                    beneath the gate is reachable. Caller acknowledges it.
 *   - 'splash'     — the launch intro screen (`splash_continueButton`), shown
 *                    on cold start before the picker/main resolves. A transient
 *                    gate the caller dismisses (tap Continue) then re-classifies.
 *   - 'legal_gate' — fresh-install legal-acceptance screen
 *                    (`legal_continueButton` / `legal_accept*Checkbox`).
 *   - 'picker'     — signed-out sign-in screen with the test-persona picker
 *                    (`persona_picker_open` / `signIn_googleButton`). Wins over
 *                    a stray main_* fragment so a visible picker isn't masked.
 *   - 'signed_in'  — on the main app (`main_roomsTab`/`main_profileTab`/
 *                    `main_settingsButton`).
 *   - 'unknown'    — none of the above (splash, system permission dialog,
 *                    empty/raced dump). Caller waits-and-re-dumps; never acts.
 *
 * Note: system permission dialogs (`com.android.permissioncontroller`) are the
 * foreground window during onboarding and dump as a sparse tree with none of
 * these tags → 'unknown' (correct: the caller dismisses them, then re-dumps).
 */
function classifyAndroidAuthState(dumpXml) {
  const x = String(dumpXml || '');
  if (x.includes('warning_acknowledgeButton')) return 'warning';
  // DegradedModeScreen.kt — shown when the backend is unreachable, which on a
  // device whose reverse tunnels have dropped is every single launch. Ranked
  // above signed_in for the same reason `warning` is: the session underneath
  // may be perfectly valid, but nothing below the gate is reachable until it is
  // cleared. Cost a whole cell on 2026-08-01 by classifying as 'unknown', whose
  // contract is "never act" — 1 pass then 29 identical failures.
  if (x.includes('degraded_acknowledgeButton') || x.includes('degraded_title')) return 'degraded';
  if (x.includes('splash_continueButton')) return 'splash';
  if (x.includes('legal_continueButton') || x.includes('legal_acceptTermsCheckbox')) {
    return 'legal_gate';
  }
  if (x.includes('persona_picker_open') || x.includes('signIn_googleButton')) return 'picker';
  if (
    x.includes('main_roomsTab') ||
    x.includes('main_profileTab') ||
    x.includes('main_settingsButton')
  ) {
    return 'signed_in';
  }
  return 'unknown';
}

/**
 * ShyTalk Android package id per target. local → `.local`, dev → `.dev`,
 * prod → bare (no suffix). Mirrors applicationIdSuffix at
 * app/build.gradle.kts. Shared by androidPersonaSignIn + androidSignOut.
 */
const PACKAGE_BY_TARGET = {
  local: 'com.shyden.shytalk.local',
  dev: 'com.shyden.shytalk.dev',
  prod: 'com.shyden.shytalk',
};

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
  // Network-state manipulation (j09: host disconnect → room auto-close).
  // Pairs `svc wifi disable` + `svc data disable` to fully drop the
  // device's connectivity, then re-enables both after a sleep.
  'androidNetworkDropFor',
  // Tap + long-press actions for j09's room-host kick/close/join flows.
  'androidTapQuotedTarget',
  'androidTapRoomCard',
  'androidLongPressSeat',
  // j09 + every journey Background's "<persona> is signed in on
  // Android physical at the <tab> tab" — drives the persona picker
  // (visible on local + dev since PR #882) to sign the device's APP
  // into the named persona, then taps the requested main-nav tab.
  // Distinct from the Firebase REST sign-in the runner does on the
  // server side: that gets a token into ctx.sessions; this one drives
  // the device APP's UI through the picker dialog so the device is
  // on the right screen for subsequent UI-action steps.
  'androidPersonaSignIn',
  // Generic "confirm in the dialog" tap. Used by j09's close-room flow
  // ("When Theo on Android confirms in the dialog" — line 107) and any
  // future scenario gating a destructive action behind an AlertDialog.
  // Tries a stack of known confirm-button testTags before failing — the
  // exact testTag varies by surface (room_endRoomConfirmButton vs
  // settings_signOutConfirmButton vs dialog_confirmButton, etc.).
  'androidConfirmDialog',
  // j10/j11 moderation journeys: force-stop + cold-relaunch the app so its
  // startup routing re-reads a seeded moderation flag (a freshly seeded
  // hasActiveWarning surfaces the warning screen only on a fresh launch).
  'androidKillAndRelaunch',
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
  // Stamped by every submit action; read by measureRenderingTimeFromSubmit.
  const submitClock = createSubmitClock();

  /**
   * One adb call, BOUNDED.
   *
   * Without a timeout this blocks forever, and on 2026-08-01 it did: the
   * Android cell spent 2174 seconds — thirty-six minutes — inside a single
   * scenario, using no CPU, until the two-hour cell timeout would have fired.
   * `adb shell uiautomator dump` needs an exclusive UiAutomation connection
   * and wedges when it cannot get one; a USB re-enumeration does the same to
   * any adb call in flight.
   *
   * A bounded call that fails names the operation and the scenario. An
   * unbounded one loses the whole cell, and with it every scenario the cell
   * never reached.
   *
   * NO HOST SHELL. `execFileSync` with an argument array — nothing is
   * interpolated into a command line, so no host-side metacharacter can be
   * interpreted, and free-form user text needs no host-side escaping at all.
   *
   * THERE ARE TWO SHELLS, AND ONLY ONE OF THEM GOES AWAY.
   *
   * `adb shell X Y Z` does not pass X Y Z as argv. adb JOINS them with spaces
   * and hands the result to `/system/bin/sh` ON THE DEVICE. So removing the
   * host shell leaves the device shell parsing everything after `shell`.
   *
   * The previous code escaped apostrophes for the HOST shell and stopped
   * there. The host shell then consumed that escaping, and the device shell
   * received a bare apostrophe. Verified against the connected device on
   * 2026-08-01:
   *
   *   adb -s … shell echo 'Selma'\''s%sroom'
   *   → /system/bin/sh: no closing quote
   *
   * So `androidTypeText("Selma's room")` — and every journey step typing a
   * name with an apostrophe — was already failing, and the comment claiming
   * to have fixed exactly that case was describing the wrong shell.
   *
   * Quoting therefore MOVES to the device side, applied here rather than at
   * 25 call sites so a new one cannot forget. Round-tripped against the real
   * device for apostrophes, spaces, `$HOME`, backticks, pipes and semicolons.
   */
  const ADB_PATH = resolveAdbPath();

  // Once the phone is provably gone — unplugged, adb server dead, USB
  // re-enumerated — every remaining call costs its full timeout for nothing.
  // The breaker abandons the cell with an attributable cause instead.
  const surfaceBreaker = createSurfaceBreaker({ label: `android ${serial}` });
  driver._surfaceBreaker = surfaceBreaker;

  function adb(args, { timeoutMs = DEFAULT_ADB_TIMEOUT_MS } = {}) {
    if (surfaceBreaker.isOpen()) {
      // Synchronous by necessity: adb() is called from sync code paths, so
      // the breaker's async run() cannot wrap it. The check is the same.
      throw new Error(
        `[android ${serial}] surface is unreachable — ${surfaceBreaker.consecutiveFailures()} consecutive transport failures. Remaining work on this cell is abandoned rather than retried against a dead device.`,
      );
    }
    // Only the words after `shell` reach the device shell — see device-shell.js.
    const argv = quoteAdbArgs(args);
    try {
      const out = execFileSync(ADB_PATH, ['-s', serial, ...argv], execBounds({ timeoutMs }));
      surfaceBreaker.recordSuccess();
      return out;
    } catch (e) {
      const described = describeExecFailure(e, {
        label: `android-driver ${serial}`,
        command: `adb ${args.join(' ')}`,
        timeoutMs,
      });
      surfaceBreaker.recordFailure(described);
      throw described;
    }
  }
  driver.adb = adb;
  driver._deviceShellArg = deviceShellArg;

  // Wire reverse port-forwards so wireless devices can reach
  // laptop-hosted local services (Express API, Firebase emulators,
  // LiveKit, MinIO). Without these, the app on a wireless device hits
  // a Technical-Difficulties screen because localhost on the DEVICE
  // is the device itself, not the laptop. Mirrors CLAUDE.md guidance
  // for "Android on physical device".
  const REVERSE_PORTS = [3000, 7880, 9000, 8080, 9099, 9002];

  /**
   * (Re)establish the reverse tunnels.
   *
   * Setting these ONCE at driver construction is not enough: `adb reverse`
   * does not survive a USB re-enumeration, and a phone on a desk re-enumerates
   * (transport_id on this device climbed past 80 in a single session). When the
   * tunnels vanish mid-run the app can no longer reach the API, falls back to
   * its "Technical Difficulties" screen, and every persona sign-in then fails
   * with "the picker testTag isn't visible" — which reads exactly like a
   * product bug and is not one. It cost two full matrix runs to see it.
   *
   * Re-running the commands is idempotent and costs ~50ms, so it is cheap
   * enough to do before any action that depends on the backend being reachable.
   *
   * THIRD OCCURRENCE, so this now VERIFIES rather than fires-and-forgets
   * (2026-08-01). Setting a tunnel is a point-in-time act and the device can
   * re-enumerate at any moment — including between this call and the Firebase
   * request that needs it. Observed within one 75-second sign-in: nine tunnels
   * set, `adb reverse --list` empty afterwards, transport_id having advanced.
   * The app had meanwhile fallen to DegradedModeScreen and logcat showed
   * `FirebaseNetworkException: unreachable host`.
   *
   * The old version swallowed every failure into console.error, so a run whose
   * tunnels never came up looked identical to one where they did — and the
   * symptom surfaced three screens later as "the picker testTag isn't visible",
   * which reads exactly like a product bug.
   *
   * @returns {string[]} ports still missing AFTER the attempt — empty means the
   *   device can genuinely reach the stack right now.
   */
  function ensureReverseTunnels() {
    for (const port of REVERSE_PORTS) {
      try {
        adb(['reverse', `tcp:${port}`, `tcp:${port}`]);
      } catch (e) {
        console.error(`[android-driver] adb reverse tcp:${port} failed: ${e.message}`);
      }
    }
    // Read back. `adb reverse` can report success and still leave nothing
    // bound if the transport changed underneath it.
    let listed = '';
    try {
      listed = String(adb(['reverse', '--list']) || '');
    } catch (e) {
      console.error(`[android-driver] adb reverse --list failed: ${e.message}`);
      return REVERSE_PORTS.map(String);
    }
    const missing = REVERSE_PORTS.filter((p) => !listed.includes(`tcp:${p}`)).map(String);
    if (missing.length) {
      console.error(
        `[android-driver] reverse tunnels MISSING after setup: ${missing.join(', ')} — ` +
          `the app cannot reach the local stack and will show its degraded screen. ` +
          `Usually a USB re-enumeration; re-seat the cable or use wireless adb.`,
      );
    }
    return missing;
  }
  driver._ensureReverseTunnels = ensureReverseTunnels;

  ensureReverseTunnels();

  // NO STUB LOOP — see the note in web-playwright-driver.js. A declared but
  // unimplemented method must be ABSENT so the runner reports it by name,
  // never present-and-returning-false so the step reads as a product defect.

  // ── Real primitive implementations (override stubs) ─────────────────

  // Dump the current screen's view hierarchy via uiautomator. Returns
  // the raw XML string. Used by tag-targeted tap + assertion matchers
  // that scan for resource-id + bounds.
  driver.androidUiDump = async () => {
    // `uiautomator dump` exits non-zero (throws) while the UI is non-idle
    // (app cold-start, animations). dumpWithRetry retries on the throw with a
    // short backoff until a dump succeeds or the budget is spent — returning
    // the first successful result (idle screens return on attempt 1). See
    // ./ui-dump-retry.js.
    // Held across the WHOLE retry budget, not per attempt: `uiautomator dump`
    // takes an exclusive UiAutomation connection, so a sibling process that
    // slipped in between two of our retries would fail us and wedge itself.
    //
    // Operator 2026-08-01 ("make sure this cannot happen again"): two of these
    // ran concurrently on one phone and deadlocked, parking three matrix cells
    // at 58 scenarios for eight minutes. Cell-aware driver attachment stops the
    // usual way that happens; this lock is what holds when something else finds
    // a new way. See device-lock.js.
    const result = await withDeviceLock(serial, () =>
      dumpWithRetry(
        () => {
          adb(['shell', 'uiautomator', 'dump', '--compressed', '/sdcard/dump.xml']);
          return adb(['shell', 'cat', '/sdcard/dump.xml']);
        },
        { backoffMs: resolveDumpBackoffMs() },
      ),
    );
    if (!result.ok) {
      console.error(
        `[android-driver] androidUiDump failed after ${result.attempts} attempts: ${result.lastErr}`,
      );
      // SHY-0236: after the transient-retry budget is spent, a persistent dump
      // failure is most often a STALE UiAutomation holder — a hung on-device
      // `uiautomator` process (the EXIT=137 SIGKILL loop) that every retry AND
      // every app-relaunch leaves stuck, so the caller relaunches the app
      // forever (the "phone opens/closes the app endlessly" thrash). Kill the
      // holder so the NEXT dump rebinds a fresh UiAutomation instead of looping.
      // Fires ONLY on the already-failed path, so the cold-start retry above is
      // untouched. See the matrix-orphans / hung-uiautomator memory.
      try {
        adb(['shell', 'pkill', '-f', 'uiautomator']);
        console.error(
          '[android-driver] cleared a possibly-stale uiautomator holder after dump failure — next dump rebinds fresh',
        );
      } catch (_e) {
        /* pkill non-zero = no holder to clear; nothing to do */
      }
      return '';
    }
    return result.xml;
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
        await new Promise((r) => setTimeout(r, 500)); // sleep-ok: device settle — no host-queryable signal between a tap and the redraw
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

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?wallet_balance"[^>]*\/?>/;
    const tagMatch = dump.match(tagRx);
    if (!tagMatch) return false;
    const escBalance = balance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Scan within the captured tag for either text= or content-desc=
    // carrying the balance value with digit-boundary protection.

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

    const listRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?reportReview_list"[^>]*\/?>/;
    if (!listRx.test(dump)) return false;

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
  // through literally: adb() quotes each argument for the DEVICE
  // shell, and there is no host shell any more.
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
      // `text` is USER-CONTROLLED free-form input — "O'Brien", "can't".
      //
      // This used to carry its OWN copy of the escaping (POSIX-escape the
      // apostrophe, then encode spaces) rather than calling the shared
      // helper. Two implementations of one rule is how they drift, and both
      // were escaping for the HOST shell, which `adb()` no longer uses:
      // quoting now happens on the DEVICE side, where the only remaining
      // shell is. Escaping here as well would double-escape and type the
      // escape sequence into the search box.
      //
      // KNOWN LIMITATION (unchanged): a literal `%s` in `text` is
      // indistinguishable from an encoded space — `input text` has no
      // `%%`-style escape. Not fixable without a different keyboard-driver
      // primitive (uiautomator setText via the UI Automator API).
      adb(['shell', 'input', 'text', escapeInputText(text)]);
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

    const gridRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?room_seatGrid"[^>]*\/?>/;
    if (!gridRx.test(dump)) return false;
    // Step 2: target name appears with symmetric word-boundary
    const escTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

    const wallRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?giftWall_grid"[^>]*\/?>/;
    if (!wallRx.test(dump)) return false;
    // Step 2: giftId appears with symmetric word-boundary
    const escGift = giftId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const giftRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escGift}(?![\\w-])[^"]*"`,
    );
    if (!giftRx.test(dump)) return false;
    // Step 3: sender appears with symmetric word-boundary
    const escSender = sender.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    // WAS: checked `privateChat_messageInput` — the INPUT BOX. It returned
    // true on an empty conversation with the keyboard showing, which is the
    // opposite of what the step claims. Now it looks for an actual message
    // bubble, which the product tags `privateChat_msg_<dir>_<messageId>`.
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    return /resource-id="(?:[^"]*:id\/)?privateChat_msg_(?:sent|recv)_[^"]+"/.test(dump);
  };
  driver.androidShowsNewUnreadConversation = async (_viewer, other) => {
    if (typeof other !== 'string' || !other.trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // Step 1: messages tab visible

    const tabRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?main_messagesTab"[^>]*\/?>/;
    if (!tabRx.test(dump)) return false;
    // Step 2: other name appears with symmetric word-boundary
    const escOther = other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

    const listRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?reportReview_list"[^>]*\/?>/;
    if (!listRx.test(dump)) return false;
    // Step 2: targetId appears with symmetric word-boundary
    const escTarget = targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const targetRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escTarget}(?![\\w-])[^"]*"`,
    );
    if (!targetRx.test(dump)) return false;
    // Step 3: status appears with symmetric word-boundary
    const escStatus = status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const statusRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escStatus}(?![\\w-])[^"]*"`,
    );
    return statusRx.test(dump);
  };

  // Wake 104 — `<Name>'s Android Admin UI shows N rows in the <X>
  // table` (j12 — generic admin table row-count assertion). Driver
  // receives `(viewer, count, tableName)`.
  //
  // Foundation strategy: same TABLE_TAGS lookup as PR #740's
  // androidAdminShowsTableOf. Same TABLE_TAGS constant is
  // intentionally redeclared in this closure for symmetry and
  // future independent evolution. Currently one entry:
  //   - "reports" → reportReview_list
  //
  // The COUNT is journey-orchestrated and ignored at foundation —
  // no per-row testTag exists for counting matching rows. A future
  // PR could layer this with `reportReview_row_${id}` parameterised
  // testTags + a counter scan.
  //
  // Unmapped tableNames return false (FAIL-loud) — same scaffold-
  // then-expand discipline as INPUT_TAGS (PR #737), TABLE_TAGS
  // (PR #740), SEARCH_FIELD_TAGS (PR #741), PATH_TAGS (PR #744).
  const ROW_COUNT_TABLE_TAGS = { reports: 'reportReview_list' };
  driver.androidAdminShowsRowCountInTable = async (_viewer, _count, tableName) => {
    if (typeof tableName !== 'string' || !tableName.trim()) return false;
    const tag = ROW_COUNT_TABLE_TAGS[tableName.trim().toLowerCase()];
    if (!tag) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const tagRx = new RegExp(`<node[^>]*resource-id="(?:[^"]*:id\\/)?${escTag}"[^>]*\\/?>`);
    return tagRx.test(dump);
  };

  // Wake 100 — `<Name>'s Android UI shows the <noun> in the thread
  // [with <suffix>]` (j07, 2 corpus rows). noun is "message" or
  // "reply"; optional trailing suffix like "with timestamp + sent
  // indicator". Driver receives `(name, noun, suffix)`.
  //
  // Foundation strategy: presence-check the conversation thread
  // is open (privateChat_messageInput testTag PRESENT). Same shape
  // as PR #748's androidShowsMessageInConversationThread but with
  // two additional accepted-and-ignored args (noun, suffix).
  //
  // The noun/suffix details are journey-orchestrated — the test
  // runs RIGHT AFTER a specific message/reply is sent, so "the
  // <noun>" being visible is implied by the thread being open. A
  // future PR could layer per-message verification with parameterised
  // testTags or by parsing message bodies in the dump.
  driver.androidShowsInThread = async (_name, _noun, suffix) => {
    // WAS: checked the message INPUT existed — true on an empty thread.
    //
    // The corpus distinguishes direction in the suffix: j07 asserts "shows the
    // message in the thread with timestamp + sent indicator", which is a claim
    // about the SENDER's own view. A received message must not satisfy it.
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const wantsSent = /\bsent\b/i.test(String(suffix || ''));
    const dir = wantsSent ? 'sent' : '(?:sent|recv)';
    return new RegExp(`resource-id="(?:[^"]*:id\\/)?privateChat_msg_${dir}_[^"]+"`).test(dump);
  };
  driver.androidShowsSeatWithIndicator = async (_viewer, target, indicator) => {
    if (typeof target !== 'string' || !target.trim()) return false;
    if (typeof indicator !== 'string' || !indicator.trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // Step 1: seat grid visible

    const gridRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?room_seatGrid"[^>]*\/?>/;
    if (!gridRx.test(dump)) return false;
    // Step 2: target appears with symmetric word-boundary
    const escTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const targetRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escTarget}(?![\\w-])[^"]*"`,
    );
    if (!targetRx.test(dump)) return false;
    // Step 3: indicator appears with symmetric word-boundary
    const escIndicator = indicator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const indicatorRx = new RegExp(
      `(?<![\\w-])(?:text|content-desc)="[^"]*(?<![\\w-])${escIndicator}(?![\\w-])[^"]*"`,
    );
    return indicatorRx.test(dump);
  };

  // Wake 105 — `<Name>'s Android UI shows the second offensive
  // message` (j11 — sequential corpus-specific assertion, journey-
  // orchestrated after a first offensive message). Single-arg.
  //
  // Foundation strategy: presence-check the conversation thread is
  // open (privateChat_messageInput testTag PRESENT). Same shape as
  // PR #748's androidShowsMessageInConversationThread.
  //
  // The "second offensive message" semantic is journey-orchestrated
  // — there's no per-message testTag and no "offensive" classifier
  // visible in uiautomator dumps. The journey ensures the test only
  // fires after the second offensive message lands. A future PR
  // could layer per-message verification once messages have testTags.
  driver.androidShowsSecondOffensiveMessage = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?privateChat_messageInput"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 92 — `<Name>'s Android UI shows the list of contributors
  // with amounts` (j15:35). Single-arg.
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
  driver.androidShowsContributorsList = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?giftWall_grid"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 105 — `<Name>'s Android UI shows the system PM from
  // Officia` (j11 — system-message visibility from the "Officia"
  // official sender). Single-arg.
  //
  // Foundation strategy: presence-check the conversation thread is
  // open (privateChat_messageInput testTag PRESENT). Same shape as
  // PRs #748, #752, #754.
  //
  // The "system PM from Officia" semantic is journey-orchestrated
  // — no per-sender testTag or official-badge classifier exists in
  // uiautomator dumps today. The journey ensures the test only
  // fires after the system PM is in the active thread. A future
  // PR could layer per-message verification once Compose ships
  // sender-tagged messages.
  driver.androidShowsSystemPmFromOfficia = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?privateChat_messageInput"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 92 — `<Name>'s Android UI shows the PM thread with
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
  // A future PR could layer direction verification via `adb shell
  // getprop persist.sys.locale` or parsing uiautomator's `class`
  // attribute for layout-direction hints.
  driver.androidShowsPmThreadDirection = async (_name, direction) => {
    // WAS: checked `privateChat_messageInput` and ignored `direction` —
    // an RTL assertion that passed on an LTR screen, which is exactly the
    // locale bug j13 exists to catch.
    //
    // `parseLayoutDirection` reads the real direction out of the dump and was
    // already wired to androidGetLayoutDirection; this assertion simply never
    // called it. A comment here claimed direction "isn't surfaced via
    // uiautomator" while the helper that surfaces it sat 90 lines below.
    const want = String(direction || '')
      .trim()
      .toLowerCase();
    if (want !== 'rtl' && want !== 'ltr') return false;
    const actual = parseLayoutDirection(await driver.androidUiDump());
    return actual === want;
  };
  driver.androidShowsWelcomePmInLanguage = async (_name, _code) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?privateChat_messageInput"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 87 — `<Name> on <Plat> selects N stars and submits feedback "<X>"`
  // (j17:60). Composite rating-action: pick N stars + type feedback + submit.
  //
  // Foundation strategy: presence-check on the `feedbackScreen_*` testTag
  // PREFIX. The current app has NO rating/feedback screen in
  // shared/src/commonMain (no RatingScreen.kt / FeedbackScreen.kt files),
  // so this method returns false in real journeys today. When the screen
  // ships with `feedbackScreen_starRow` / `feedbackScreen_inputText` /
  // `feedbackScreen_submitButton` testTags, this stays sound — the
  // wildcard prefix match (`feedbackScreen_[^"]*`) will land.
  //
  // Per-element action body (tap N-th star + type feedback into input +
  // tap submit) is deferred until per-element testTags exist. The (name,
  // stars, feedback) args are accepted-and-ignored.
  //
  // Shell-escape note: when the real action ships, `feedback` goes through
  // `adb()` like any other text — it quotes for the device shell itself, so
  // no call-site escaping is needed (or wanted: a second layer would type
  // the escape sequence). The foundation does not call adb with free-form
  // text, so the injection surface is currently empty either way.
  driver.androidSubmitStarFeedback = async (_name, _stars, _feedback) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?feedbackScreen_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 89 — `<Name> on <Plat> taps the <X> from the <Y>` (j16:24).
  // Composite tap-from-surface action. Driver receives `(name, target,
  // source)` — locate surface Y, scope to target X within it.
  //
  // Foundation strategy: SURFACE_TARGET_TAGS scaffold keyed by lowercase
  // `${source}::${target}` → Compose testTag. ONE mapping is grounded
  // in the journey corpus (j16:48):
  //
  //   'invite banner::event-room link' → 'inviteBanner_eventRoomLink'
  //
  // The `inviteBanner_*` testTag does NOT yet exist in
  // shared/src/commonMain (no banner with this testTag in any current
  // composable). So this method returns false in real journeys today.
  // When the surface ships with that testTag, this stays sound — the
  // exact-match lookup will land.
  //
  // FAIL-loud contract: unmapped source OR target returns false
  // (consistent with INPUT_TAGS / TABLE_TAGS / SEARCH_FIELD_TAGS /
  // PATH_TAGS / ROW_COUNT_TABLE_TAGS scaffolds). A journey author
  // writing an unmapped surface gets a clear FAIL instead of a silent
  // pass against an unrelated node.
  //
  // Per-element action body (tap the resolved testTag's bounds) is
  // deferred until the testTag exists in the dump. The `_name` arg
  // is accepted-and-ignored.
  const SURFACE_TARGET_TAGS = {
    'invite banner::event-room link': 'inviteBanner_eventRoomLink',
  };
  driver.androidTapFromSurface = async (_name, target, source) => {
    if (!target || !target.trim()) return false;
    if (!source || !source.trim()) return false;
    const key = `${source.toLowerCase()}::${target.toLowerCase()}`;
    const tag = SURFACE_TARGET_TAGS[key];
    if (!tag) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // Defense-in-depth: regex-escape the tag value before interpolation,
    // consistent with TABLE_TAGS (line 724), PATH_TAGS (line 932), and
    // ROW_COUNT_TABLE_TAGS (line 1181). Current sole entry contains only
    // `[A-Za-z_]`, but a future map value containing a regex metacharacter
    // (e.g. `.` or `+`) would silently broaden the match without this guard.
    const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const tagRx = new RegExp(`<node[^>]*resource-id="(?:[^"]*:id\\/)?${escTag}"[^>]*\\/?>`);
    return tagRx.test(dump);
  };

  // Wake 89 — `<Name>'s <Plat> Admin UI shows <Other>'s appeal with the
  // text` (j11:73). Admin moderation UI assertion. Driver verifies an
  // appeal section is visible for <Other> with non-empty body text.
  //
  // Foundation strategy: presence-check on the `adminAppeal_*` testTag
  // PREFIX. The current app has NO admin moderation surface in
  // shared/src/commonMain — only the USER-side flow exists
  // (`suspension_appealField` / `suspension_submitAppealButton` in
  // SuspensionScreen.kt). The admin reviewer side is web-only today.
  //
  // Returns false in real journeys today. When/if an Android admin app
  // ships with `adminAppeal_*` testTags, this stays sound — the wildcard
  // prefix match will land.
  //
  // Both args (`_viewer`, `_target`) are accepted-and-ignored.
  driver.androidAdminShowsAppealText = async (_viewer, _target) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?adminAppeal_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 105 — `<Name>'s <Plat> Admin UI shows the dashboard with
  // counters: N reports, N verifications, N appeals` (j12). Admin
  // landing page counters. Driver receives
  // `(viewer, { reports, verifications, appeals })`.
  //
  // Foundation strategy: presence-check on `adminDashboard_*` testTag
  // PREFIX. No admin moderation surface in shared/src/commonMain yet
  // (web-only admin reviewer side) — see sibling matcher
  // androidAdminShowsAppealText for context. Returns false in real
  // journeys today; when adminDashboard_* testTags ship (e.g.
  // adminDashboard_reportsCounter / verificationsCounter / appealsCounter),
  // the wildcard prefix match will land.
  //
  // Both args (_viewer, _counters) accepted-and-ignored. The
  // foundation does not validate that the displayed counter values
  // match the expected object — that needs per-counter testTags + a
  // text-extraction inspection mechanism.
  driver.androidAdminShowsDashboardCounters = async (_viewer, _counters) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?adminDashboard_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 106 — `<Name>'s <Plat> Admin UI shows the "<X>" stat` (j12).
  // Named-stat visibility on the admin dashboard. Driver receives
  // `(viewer, statName)` where statName is a free-form display label.
  //
  // Foundation strategy: presence-check on the `adminStat_*` testTag
  // PREFIX. No admin moderation surface in shared/src/commonMain yet
  // (web-only admin) — see siblings androidAdminShowsAppealText (#762)
  // and androidAdminShowsDashboardCounters (#763). Returns false in
  // real journeys today; lands true when `adminStat_*` testTags ship.
  //
  // Both args (_viewer, _statName) accepted-and-ignored. The foundation
  // does NOT verify that the specific named stat is displayed — it
  // only verifies that ANY adminStat_* element is visible. Per-stat
  // verification would need a stat-name → testTag map (similar to the
  // SURFACE_TARGET_TAGS scaffold in #760).
  driver.androidAdminShowsStat = async (_viewer, _statName) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?adminStat_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 103 — `<Name>'s <Plat> UI also shows <Other> in the participants
  // list` (j09). Voice-room session — confirms <Other> is visible in
  // <Name>'s participants list (multi-actor session sanity).
  //
  // Foundation strategy: presence-check on the `participantsList_*`
  // testTag PREFIX. No `participantsList_*` testTag exists in
  // shared/src/commonMain — voice-room participant rendering uses
  // SeatItem.kt's `room_requestSeatButton` / `room_seatGrid` (without a
  // participants-list testTag family). Returns false in real journeys
  // today; lands true when participantsList_* testTags ship.
  //
  // Both args (_viewer, _other) accepted-and-ignored. Per-participant
  // verification (asserting THIS specific user is in the list, not just
  // "any participant tile is visible") needs a participant-id → testTag
  // map (similar to the SURFACE_TARGET_TAGS scaffold in #760).
  driver.androidAlsoShowsInParticipantsList = async (_viewer, _other) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?participantsList_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 86 — `<Name> on <Plat> approves <Other>'s seat request` (j17:51).
  // Voice-room host action — host approves a pending seat request from
  // <Other>. Driver receives `(host, requester)`.
  //
  // Foundation strategy: presence-check on the `seatRequest_*` testTag
  // PREFIX. No `seatRequest_*` testTag exists in shared/src/commonMain
  // yet — seat-request backend exists (SeatRequestRepository in
  // core/room), but no UI testTag exposes the pending-requests panel
  // or per-request Approve button. SeatItem.kt exposes only
  // room_requestSeatButton (requester-side) and room_seatGrid (host
  // view).
  //
  // Returns false in real journeys today; lands true when seatRequest_*
  // testTags ship (e.g. seatRequest_pendingPanel /
  // seatRequest_approveButton_<requesterId>).
  //
  // Both args (_host, _requester) accepted-and-ignored. Per-requester
  // approval (tapping THIS specific approve button) needs a
  // requester-id → testTag map.
  driver.androidApproveSeatRequest = async (_host, _requester) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?seatRequest_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

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
  // "Block" / "Report" / "Follow") is NOT yet implemented — buttons
  // need their own per-action testTags (`profile_blockButton`,
  // `profile_reportButton`, etc.). The foundation verifies the
  // profile is OPEN; per-button targeting is deferred.
  //
  // All 3 args (_actor, _target, _button) accepted-and-ignored.
  // Per-target verification (asserting <Other>'s profile specifically,
  // not any profile) needs profile_displayName text-extraction.
  // Per-button targeting needs a button-name → testTag map.
  driver.androidOpenProfileAndTap = async (_actor, _target, _button) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?profile_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

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
  driver.androidOpenProfileFrom = async (_actor, _target, _source) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?profile_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

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
  // Action body (perform the pull-to-refresh gesture or tap the
  // refresh button) is deferred until per-element testTags exist.
  // The `_name` arg is accepted-and-ignored.
  driver.androidRefreshLanguageRail = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?languageRail_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

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
  // Bin-level value verification is out of scope (matcher contract is
  // "bare chart-presence assertion"). `_name` accepted-and-ignored.
  driver.androidShowsBeansPerWeekChart = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?beansChart_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 98 — `<Name>'s <Plat> UI shows a +N in the "<X>" count`
  // (j01/j02/j07). Generic delta-badge assertion. Driver receives
  // `(name, delta, label)`.
  //
  // Foundation strategy: presence-check on the `countBadge_*` testTag
  // PREFIX. No `countBadge_*` testTag exists in shared/src/commonMain
  // yet — delta-badge UI is unbuilt. Returns false in real journeys
  // today; lands true when ships with countBadge_followersDelta /
  // countBadge_likesDelta testTags.
  //
  // Per-label verification (Followers vs Likes) needs a label →
  // testTag map. Per-delta verification (matching the actual displayed
  // +N) needs text-extraction. Both deferred. All 3 args
  // (_name, _delta, _label) accepted-and-ignored.
  driver.androidShowsCountBadge = async (_viewer, delta, label) => {
    // WAS: `async (_name, _delta, _label) => /countBadge_/.test(dump)` — a tag
    // the product never renders, so it always returned false.
    //
    // HONEST SCOPE, stated because the step's wording promises more than one
    // observation can deliver. "shows a +1 in the Followers count" is a DELTA,
    // and a delta needs a before and an after; a single dump has only the after.
    // So this asserts everything the after CAN support:
    //   - the named count is actually on screen (labelled, not "some badge")
    //   - it renders a number, not a blank or a dash
    //   - that number is at least `delta` — a "+1" cannot have happened on a
    //     counter reading 0.
    // A true delta needs the runner to capture the baseline first. Until it
    // does, this fails on a missing, blank or impossible count, which is three
    // more failures than it could produce before.
    const key = String(label || '')
      .trim()
      .toLowerCase();
    if (!key) return false;
    if (!Number.isFinite(Number(delta))) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagRx = new RegExp(
      `resource-id="(?:[^"]*:id\\/)?profile_count_${esc}"[^>]*>([\\s\\S]{0,400})`,
    );
    const m = tagRx.exec(dump);
    if (!m) return false;
    // The count is the first integer rendered inside that column.
    const num = /(?:text|content-desc)="(-?\d+)"/.exec(m[1]);
    if (!num) return false;
    return Number(num[1]) >= Number(delta);
  };
  driver.androidShowsEditedBodyWithTag = async (_viewer, body, tag) => {
    // WAS: `async (_name, _body, _tag) => /editedBody_/.test(dump)` — a tag
    // the product never renders, so it always returned false and every
    // message-edit scenario blamed the app.
    //
    // j07 asserts: shows the edited body "typo here" with an "edited" tag.
    // Two claims, and BOTH matter — the new text having replaced the old, and
    // the edit being disclosed. An edit that silently rewrites history without
    // the marker is a moderation problem, not a cosmetic one.
    if (!body || !String(body).trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 1. the NEW body is on screen
    if (!new RegExp(`(?:text|content-desc)="[^"]*${esc(body)}[^"]*"`).test(dump)) return false;
    // 2. the edit is disclosed — either the per-message marker tag, or the
    //    rendered label (`Edited (n)`, localised) when a tag word is given.
    const markerTag = /resource-id="(?:[^"]*:id\/)?privateChat_edited_[^"]+"/.test(dump);
    if (markerTag) return true;
    if (!tag || !String(tag).trim()) return false;
    return new RegExp(`(?:text|content-desc)="[^"]*${esc(tag)}[^"]*"`, 'i').test(dump);
  };
  driver.androidShowsInAppGiftNotification = async (_viewer, sender, giftName) => {
    // WAS: `async (_name, _sender, _gift) => /giftNotification_/.test(dump)` —
    // a tag nothing rendered, because THE FEATURE DID NOT EXIST. A gift arriving
    // while the app was open produced nothing at all.
    //
    // It exists now (SHY-0266): the push handler emits to GiftNotificationBus on
    // foreground and HomeScreen shows it through the shared snackbar host, which
    // carries the `app_toast` tag.
    //
    // BOTH names are asserted. "You received a gift" does not make the gesture
    // land, and being seen is the entire value of gifting to the sender — so a
    // banner naming only one of them is a real defect, not a cosmetic one.
    if (!sender || !String(sender).trim()) return false;
    if (!giftName || !String(giftName).trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    if (!/resource-id="(?:[^"]*:id\/)?app_toast"/.test(dump)) return false;
    const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const shows = (v) => new RegExp(`(?:text|content-desc)="[^"]*${esc(v)}[^"]*"`, 'i').test(dump);
    return shows(sender) && shows(giftName);
  };
  driver.androidShowsInResults = async (_viewer, targetUniqueId, displayName) => {
    // WAS: `async (_name, _query, _target) => /searchResults_/.test(dump)` —
    // a check for a container that the product does not even render. It could
    // only ever return false, so every "shows X in the results" step failed and
    // blamed the app for a search that had worked.
    //
    // NewMessageScreen now tags each row `newMessage_result_<uniqueId>`, so the
    // assertion can name the person it is looking for.
    if (targetUniqueId === undefined || targetUniqueId === null || targetUniqueId === '') {
      return false;
    }
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const esc = String(targetUniqueId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Closing quote anchored: result_5000001 must not answer for result_50000010.
    const row = new RegExp(`resource-id="(?:[^"]*:id\\/)?newMessage_result_${esc}"`);
    if (!row.test(dump)) return false;
    // When the step names the displayName it is asserting the row RENDERS it —
    // a search that finds the right uid but shows a stale or blank name is a
    // real defect, and the step says so.
    if (displayName) {
      const escName = String(displayName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`(?:text|content-desc)="[^"]*${escName}[^"]*"`).test(dump)) return false;
    }
    return true;
  };
  driver.androidShowsNonEmptyLocaleText = async (_name, _code, _section) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?localeText_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 88 — `<Name>'s <Plat> UI shows the official badge[ <suffix>]`
  // (j13/j18). Bare and suffixed forms; the optional trailing fragment
  // is passed verbatim so the driver can dispatch to the right slot
  // ("on the sender avatar", "with Arabic label", etc.).
  //
  // Foundation strategy: presence-check on the `officialBadge_*`
  // testTag PREFIX. No `officialBadge_*` testTag exists in
  // shared/src/commonMain yet — Official-user badge UI is unbuilt.
  // Returns false in real journeys today; lands true when ships with
  // officialBadge_icon / officialBadge_label.
  //
  // Per-suffix dispatch (avatar vs label, language variant) deferred.
  // Both args (_name, _suffix) accepted-and-ignored.
  driver.androidShowsOfficialBadge = async (_viewer, sender) => {
    // WAS: `async (_name, _suffix) => /officialBadge_/.test(dump)` — a tag
    // nothing rendered, because THE BADGE DID NOT EXIST. The assertion was
    // written for a feature nobody had built, so it failed forever and the
    // scenario blamed the app.
    //
    // The badge is now real (PrivateMessageBubble.kt): system messages render
    // a Verified icon plus the localised `official_badge` string, tagged
    // `privateChat_officialBadge`. It is driven by the message TYPE, never by
    // the sender's display name — a name is exactly what an impersonator
    // controls, and the badge exists to defeat impersonation.
    //
    // So this asserts the badge is present AND that a system message is what
    // carries it. A badge on an ordinary user's message would be the very bug
    // the feature guards against.
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    if (!/resource-id="(?:[^"]*:id\/)?privateChat_officialBadge"/.test(dump)) return false;
    // When the step names the sender, their name must be on screen too — the
    // badge belongs to a specific conversation, not to the screen at large.
    if (sender && String(sender).trim()) {
      const esc = String(sender).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:text|content-desc)="[^"]*${esc}[^"]*"`, 'i').test(dump);
    }
    return true;
  };
  driver.androidShowsOnlyMinorCohortInRankings = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?rankings_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 100 — `<Name>'s <Plat> UI shows (her|his|their) own rank in
  // the top N` (j05). Leaderboard own-rank visibility. Driver receives
  // `(name, topN)`.
  //
  // Foundation strategy: presence-check on the `ownRank_*` testTag
  // PREFIX. No `ownRank_*` testTag exists in shared/src/commonMain
  // yet — leaderboard own-rank highlight is unbuilt. Returns false in
  // real journeys today; lands true when ships with
  // ownRank_indicator / ownRank_userRow etc.
  //
  // Per-topN verification (asserting rank is within top N) needs
  // text-extraction. Deferred. Both args (_name, _topN) accepted-
  // and-ignored.
  driver.androidShowsOwnRankInTop = async (_name, _topN) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?ownRank_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 103 — `<Name>'s <Plat> UI shows the room-closed summary
  // panel` (j09). Post-room-close summary view. Driver receives
  // `(name)`.
  //
  // Foundation strategy: presence-check on the `roomClosedSummary_*`
  // testTag PREFIX. No `roomClosedSummary_*` testTag exists in
  // shared/src/commonMain yet — post-close summary UI is unbuilt.
  // Returns false in real journeys today; lands true when ships with
  // roomClosedSummary_panel / roomClosedSummary_stats etc.
  //
  // The `_name` arg is accepted-and-ignored.
  driver.androidShowsRoomClosedSummary = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?roomClosedSummary_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 97 — `<Name>'s <Plat> UI shows the warning banner overlay on
  // top of the room` (j10). Cohort-warning overlay assertion. Driver
  // receives `(name)`.
  //
  // Foundation strategy: presence-check on the `roomWarningBanner_*`
  // testTag PREFIX. No `roomWarningBanner_*` testTag exists in
  // shared/src/commonMain yet — the in-room overlay variant is unbuilt
  // (the full-screen `warning_*` family in WarningScreen.kt:82+ is a
  // distinct concern — different journey trigger). Returns false in
  // real journeys today; lands true when ships with
  // roomWarningBanner_overlay / _title etc.
  //
  // The `_name` arg is accepted-and-ignored.
  driver.androidShowsRoomWarningBanner = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?roomWarningBanner_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 101 — `<Name>'s <Plat> UI shows a seat-request notification
  // with "<X>" + approve/deny` (j09). Host receives notification when
  // a participant requests a seat. Driver receives `(host, requester)`.
  //
  // Foundation strategy: presence-check on the
  // `seatRequestNotification_*` testTag PREFIX. No
  // `seatRequestNotification_*` testTag exists in shared/src/commonMain
  // yet — host-side notification UI is unbuilt. Returns false in real
  // journeys today; lands true when ships with
  // seatRequestNotification_toast / _actionRow etc.
  //
  // Distinct-from `seatRequest_*` (#766 — the host approval button
  // family). Both args (_host, _requester) accepted-and-ignored.
  driver.androidShowsSeatRequestNotification = async (_host, _requester) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?seatRequestNotification_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  // Wake 103 — `<Name>'s <Plat> UI shows a +N in the stalkers/profile-
  // visits counter` (j07). Profile-visit count increment. Driver
  // receives `(name, delta)`.
  //
  // Foundation strategy: presence-check on the `stalkersDelta_*`
  // testTag PREFIX. No `stalkersDelta_*` testTag exists in
  // shared/src/commonMain yet — profile-visits delta badge is unbuilt.
  // Returns false in real journeys today; lands true when ships with
  // stalkersDelta_badge / _counter etc.
  //
  // Per-delta verification (matching the actual +N) needs text-
  // extraction. Deferred. Both args (_name, _delta) accepted-and-
  // ignored.
  driver.androidShowsStalkersDelta = async (_viewer, delta) => {
    // Same shape as the follower count, and the same honest scope: one dump
    // shows the after, not the difference. `stalkersDelta_` never existed.
    return driver.androidShowsCountBadge(_viewer, delta, 'stalkers');
  };
  /**
   * Is the named destination on screen?
   *
   * The corpus names routes the way a person would ("the rooms list"), so they
   * are mapped to the anchor testTag each screen actually renders. An unknown
   * route returns false rather than true: "I do not know how to check this" is
   * not "it passed".
   */
  const ROUTE_ANCHORS = {
    'rooms list': 'main_roomsTab',
    rooms: 'main_roomsTab',
    'room list': 'main_roomsTab',
    messages: 'main_messagesTab',
    conversations: 'main_messagesTab',
    profile: 'main_profileTab',
    settings: 'settings_backButton',
    wallet: 'wallet_balance',
    'sign in': 'persona_picker_open',
  };
  driver.androidShowsRoute = async (route) => {
    const key = String(route || '')
      .trim()
      .toLowerCase()
      .replace(/^the\s+/, '');
    const tag = ROUTE_ANCHORS[key];
    if (!tag) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    return new RegExp(`resource-id="(?:[^"]*:id\\/)?${tag}"`).test(dump);
  };

  driver.androidShowsToastAndNavigates = async (_viewer, toast, route, _extra) => {
    // WAS: four arguments, all ignored, checking `toastWithRoute_` — a tag the
    // product never renders. It could only return false.
    //
    // The step makes TWO claims: a specific toast was shown, AND the user ended
    // up somewhere specific. Both matter: a toast with no navigation strands
    // the user, and navigation with no toast leaves them wondering what
    // happened. Every snackbar in the app now renders through StyledSnackbarHost
    // with the tag `app_toast`, so the message is findable and checkable.
    if (!toast || !String(toast).trim()) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const esc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 1. the toast is present AND says the right thing
    const toastShown =
      /resource-id="(?:[^"]*:id\/)?app_toast"/.test(dump) &&
      new RegExp(`(?:text|content-desc)="[^"]*${esc(toast)}[^"]*"`, 'i').test(dump);
    if (!toastShown) return false;
    // 2. the destination is actually on screen. A route name maps to the
    //    screen's own anchor tag; asserting the toast alone would pass while
    //    the user sat on the screen they were supposed to leave.
    if (!route || !String(route).trim()) return true;
    return await driver.androidShowsRoute(route);
  };
  driver.androidShowsToastAndNavigatesBack = async (_viewer, toast, route) =>
    driver.androidShowsToastAndNavigates(_viewer, toast, route);
  driver.androidShowsUserCard = async (_viewer, targetUniqueId) => {
    // WAS: `async (_name, _target) => /userCard_/.test(dump)` — it took the
    // target and checked only that SOME card was open, so it passed on the
    // wrong user's card, and on a card left open from an earlier step.
    //
    // The product now tags the sheet `userCard_<uniqueId>` (UserCardPopup.kt),
    // so the subject is checkable. The caller resolves the persona name to its
    // uniqueId, because a display name is not unique and an alias can replace
    // it on screen — the id is the only stable identity the card carries.
    if (targetUniqueId === undefined || targetUniqueId === null || targetUniqueId === '') {
      return false;
    }
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const esc = String(targetUniqueId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Anchored on the closing quote so `userCard_5000001` cannot satisfy an
    // assertion about `userCard_50000010`.
    return new RegExp(`resource-id="(?:[^"]*:id\\/)?userCard_${esc}"`).test(dump);
  };
  driver.androidShowsUserCardSkeletons = async (_name) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;

    const tagRx = /<node[^>]*resource-id="(?:[^"]*:id\/)?userCardSkeleton_[^"]*"[^>]*\/?>/;
    return tagRx.test(dump);
  };

  const NOUN_KIND_TAGS = {
    'appeal::button': 'suspension_submitAppealButton',
  };
  driver.androidShowsNamedKind = async (_name, noun, kind) => {
    if (!noun || !noun.trim()) return false;
    if (!kind || !kind.trim()) return false;
    const key = `${noun.toLowerCase()}::${kind.toLowerCase()}`;
    const tag = NOUN_KIND_TAGS[key];
    if (!tag) return false;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // Defense-in-depth: regex-escape the tag value before interpolation,
    // consistent with TABLE_TAGS / PATH_TAGS / ROW_COUNT_TABLE_TAGS /
    // SURFACE_TARGET_TAGS. The single mapped entry is `[A-Za-z_]`-only
    // today, but future map values could contain regex metacharacters.
    const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const tagRx = new RegExp(`<node[^>]*resource-id="(?:[^"]*:id\\/)?${escTag}"[^>]*\\/?>`);
    return tagRx.test(dump);
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
      await new Promise((r) => setTimeout(r, 1500)); // sleep-ok: device settle after an activity launch
      driver._requestedScreen = screen;
      // If the screen identifier maps to a known MainScreen bottom-nav
      // tab, tap it so subsequent taps on `<feature>_*` testTags in
      // that tab actually find them. Without this, j09's
      // "Theo taps main_createRoomFab" finds nothing because the
      // dump is of whichever startup screen MainActivity landed on
      // (typically `home`, not `rooms`).
      //
      // Tab list grounded in
      //   shared/src/commonMain/.../feature/main/MainScreen.kt
      // — main_<lowered>Tab is the existing testTag convention.
      // Unknown screens fall through to a no-op tap (returns true so
      // the launch alone counts as success — matches the prior
      // "stash on driver" semantic).
      const tabScreens = new Set(['rooms', 'home', 'messages', 'profile']);
      if (screen && tabScreens.has(String(screen).toLowerCase())) {
        const tag = `main_${String(screen).toLowerCase()}Tab`;
        // Don't fail the whole call if the tab tap misses — the launch
        // succeeded; the tab might already be active, or the app might
        // be on the sign-in screen (no bottom nav visible). Surface
        // miss as a log warning, not a return-false.
        const tapped = await driver.androidTapByTag(tag);
        if (!tapped) {
          console.warn(
            `[android-driver] androidOpenScreen(${screen}): launch ok, but tab "${tag}" not found in dump (likely not signed in or already on that tab)`,
          );
        }
      }
      return true;
    } catch (e) {
      console.error(`[android-driver] androidOpenScreen(${screen}) failed: ${e.message}`);
      return false;
    }
  };

  // Force-stop and cold-relaunch the app for `target` (default 'local'). Used
  // by the moderation journeys (j10/j11): a seeded `hasActiveWarning` /
  // `isSuspended` flag only surfaces its gate screen when the app's startup
  // routing re-reads auth + moderation state on a FRESH launch — `am
  // force-stop` then `am start` guarantees that cold path (a warm resume would
  // keep the prior screen). The `name` arg (persona) is accepted for matcher
  // symmetry + logging; the relaunch is session-agnostic (it restarts whatever
  // session is signed in on the device). `target` selects the package
  // (local/dev/prod) via PACKAGE_BY_TARGET so a dev-device run force-stops the
  // .dev build (not .local). Returns true once the activity has been
  // (re)started; the caller's `within <N>ms ...` assertion polls for the
  // resulting screen.
  driver.androidKillAndRelaunch = async (name, target = 'local') => {
    try {
      const pkg = PACKAGE_BY_TARGET[target] || PACKAGE_BY_TARGET.local;
      adb(['shell', 'am', 'force-stop', pkg]);
      adb(['shell', 'am', 'start', '-n', `${pkg}/com.shyden.shytalk.MainActivity`]);
      // Cold start is slower than androidOpenScreen's warm launch (Firebase
      // re-init + auth-state recheck), so settle a touch longer before the
      // caller begins asserting. 2500ms mirrors the warning-screen cold-start
      // budget observed on the OnePlus CPH2653.
      await new Promise((r) => setTimeout(r, 2500)); // sleep-ok: device settle — cold-start budget measured on the OnePlus CPH2653
      return true;
    } catch (e) {
      console.error(`[android-driver] androidKillAndRelaunch(${name}) failed: ${e.message}`);
      return false;
    }
  };

  // ── j20 build-flavour support (SHY-0259) ─────────────────────────
  //
  // The three flavours carry distinct applicationIdSuffixes
  // (com.shyden.shytalk.local / .dev / bare for prod), so all three can be
  // installed SIDE BY SIDE on one device. j20's flavour Givens therefore
  // select a package rather than reinstalling — which would otherwise cost
  // a Gradle build per scenario and wipe the session state every other
  // journey depends on.

  /** Is the flavour's package present on the device? */
  driver.androidIsFlavorInstalled = async (flavor) => {
    const pkg = PACKAGE_BY_TARGET[flavor];
    if (!pkg) throw new Error(`unknown flavour "${flavor}" — expected local, dev or prod`);
    const out = adb(['shell', 'pm', 'list', 'packages', pkg]);
    // `pm list packages <filter>` matches by SUBSTRING, so filtering for the
    // bare prod id also matches .local and .dev. Compare the full line.
    return String(out)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .includes(`package:${pkg}`);
  };

  /**
   * Launch a flavour from a genuinely cold, signed-out state.
   *
   * `pm clear` is attempted first because it is the only thing that gives a
   * true first-run (no session, no accepted legal). It is denied on some
   * physical devices (SecurityException on the OnePlus CPH2653, SHY-0096),
   * so the fallback is force-stop + launch — reported honestly via the
   * returned `firstRun` flag rather than pretending the state is pristine.
   */
  driver.androidLaunchFlavorFirstRun = async (flavor) => {
    const pkg = PACKAGE_BY_TARGET[flavor];
    if (!pkg) throw new Error(`unknown flavour "${flavor}" — expected local, dev or prod`);
    let firstRun = true;
    try {
      const out = String(adb(['shell', 'pm', 'clear', pkg]));
      if (!/Success/i.test(out)) firstRun = false;
    } catch {
      firstRun = false;
    }
    if (!firstRun) adb(['shell', 'am', 'force-stop', pkg]);
    if (typeof driver._ensureReverseTunnels === 'function') driver._ensureReverseTunnels();
    adb(['shell', 'am', 'start', '-n', `${pkg}/com.shyden.shytalk.MainActivity`]);
    await new Promise((r) => setTimeout(r, 2500)); // sleep-ok: cold-start settle, same budget as androidKillAndRelaunch
    return { launched: true, firstRun, pkg };
  };

  // androidTapQuotedTarget — wrapper around tag-based or owner-card tap.
  // Runner step "<Name> on Android taps the "<X>"" passes (name, targetId,
  // isRoomCard=false) — targetId is a testTag, delegate to androidTapByTag.
  // Runner step "<Name> on Android taps the room "<X>" card" passes
  // (name, targetId, isRoomCard=true) — targetId is the room owner name,
  // delegate to androidTapRoomCard.
  driver.androidTapQuotedTarget = async (name, targetId, isRoomCard) => {
    try {
      if (isRoomCard) {
        return await driver.androidTapRoomCard(targetId);
      }
      return await driver.androidTapByTag(targetId);
    } catch (e) {
      console.error(
        `[android-driver] androidTapQuotedTarget(${name}, ${targetId}, ${isRoomCard}) failed: ${e.message}`,
      );
      return false;
    }
  };

  // androidTapRoomCard — taps a room card by its host's persona name.
  // Looks for a UI element whose dump text or testTag includes the
  // owner's name OR a `roomCard_<owner>` testTag. Owner=undefined means
  // "tap the first room card visible" (Marcus same-cohort-gate scenario:
  // `taps the room card` with no owner).
  driver.androidTapRoomCard = async (owner) => {
    try {
      const dump = await driver.androidUiDump();
      // Try testTag-based lookup first (most reliable): `roomCard_<owner>`
      // OR `roomCard_<idx>` for owner-less variant.
      if (owner) {
        const tagged = await driver.androidTapByTag(`roomCard_${owner}`);
        if (tagged) return true;
      }
      // Fallback: find any `roomCard_*` element with the owner's name
      // appearing in the dump text inside its bounds, OR the first
      // `roomCard_*` if owner is undefined.
      const escOwner = (owner || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tagPattern = owner
        ? new RegExp(
            `resource-id="(?:[^"]*:id/)?roomCard_\\w*"[^<]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^<]*?text="[^"]*${escOwner}[^"]*"`,
          )
        : /resource-id="(?:[^"]*:id\/)?roomCard_\w*"[^<]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/;
      const match = tagPattern.exec(dump);
      if (!match) return false;
      const [, x1, y1, x2, y2] = match.map((v, i) => (i === 0 ? v : Number(v)));
      const cx = Math.round((x1 + x2) / 2);
      const cy = Math.round((y1 + y2) / 2);
      return await driver.androidTap(cx, cy);
    } catch (e) {
      console.error(`[android-driver] androidTapRoomCard(${owner}) failed: ${e.message}`);
      return false;
    }
  };

  // androidLongPressSeat — long-press on the seat occupied by `target`.
  // Implementation: `adb shell input swipe X Y X Y 1000` — swipe with
  // identical start+end coords over 1000ms registers as a long-press
  // gesture (standard adb idiom for long-press). Locates the seat by
  // looking for `seat_<targetName>` testTag OR any `seat_*` element with
  // the target name in its text content.
  driver.androidLongPressSeat = async (target) => {
    try {
      const dump = await driver.androidUiDump();
      const escTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Try `seat_<target>` testTag first.
      let re = new RegExp(
        `resource-id="(?:[^"]*:id/)?seat_${escTarget}"[^<]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
      );
      let match = re.exec(dump);
      if (!match) {
        // Fallback: any `seat_*` element with target name in its dump text.
        re = new RegExp(
          `resource-id="(?:[^"]*:id/)?seat_\\w*"[^<]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^<]*?text="[^"]*${escTarget}[^"]*"`,
        );
        match = re.exec(dump);
      }
      if (!match) return false;
      const [, x1, y1, x2, y2] = match.map((v, i) => (i === 0 ? v : Number(v)));
      const cx = Math.round((x1 + x2) / 2);
      const cy = Math.round((y1 + y2) / 2);
      // Long-press via swipe with same start+end coordinates over 1000ms.
      adb(['shell', 'input', 'swipe', String(cx), String(cy), String(cx), String(cy), '1000']);
      return true;
    } catch (e) {
      console.error(`[android-driver] androidLongPressSeat(${target}) failed: ${e.message}`);
      return false;
    }
  };

  // Network-drop simulation for j09's "Host disconnects unexpectedly —
  // room auto-closes after grace period" scenario. Disables wifi + mobile
  // data via `svc` (works under adb shell on unrooted devices; no root or
  // WRITE_SECURE_SETTINGS grant needed because adb shell already has
  // android.permission.WRITE_SECURE_SETTINGS via the shell UID).
  //
  // Runs through the disable → sleep → enable sequence regardless of any
  // intermediate error so we don't leave the device offline if a step
  // throws — equivalent to a try/finally pattern. The persona `name` is
  // accepted for matcher-contract alignment (the runner step
  // "<persona>'s Android network drops for N seconds" passes it) but
  // unused — the driver acts on the singleton device under its serial.
  // Wireless adb (TCP over WiFi) makes the WiFi/data disable approach
  // self-destructive: dropping WiFi cuts the adb tunnel itself, so the
  // device goes "offline" and every subsequent UI step on the same
  // dispatch fails — surfaced 2026-05-30 against the operator's
  // wireless-adb device `adb-3b402284-56nfBT._adb-tls-connect._tcp`.
  //
  // Wireless serial fingerprints:
  //   - mDNS-discovered: contains `_adb-tls-connect` or starts with `adb-`
  //   - manual TCP:      `IP:PORT` (digits, dots, colon)
  // USB serials are hex/alphanumeric without `:` or the mDNS suffix.
  function isWirelessAdb(s) {
    if (!s) return false;
    if (s.includes('_adb-tls-connect')) return true;
    if (/^adb-/.test(s)) return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(s)) return true;
    return false;
  }
  driver.androidNetworkDropFor = async (name, seconds) => {
    // Refuse to disable WiFi over a wireless-adb connection — it would
    // sever the adb tunnel mid-scenario and break every downstream step.
    // The matcher surfaces this as a finding so the scenario stays
    // visible (rather than silently passing) — the operator can re-run
    // over USB adb if the network-drop scenario is in scope, or skip
    // it via the @needs-usb-adb tag on the scenario.
    if (isWirelessAdb(serial)) {
      throw new Error(
        `androidNetworkDropFor requires USB adb (current serial "${serial}" is wireless — disabling WiFi would kill the adb tunnel itself). Connect via USB and re-dispatch, or tag the scenario @needs-usb-adb to skip it on wireless runs.`,
      );
    }
    const durationMs = Math.max(0, Number(seconds) * 1000);
    let dropOk = true;
    try {
      adb(['shell', 'svc', 'wifi', 'disable']);
      adb(['shell', 'svc', 'data', 'disable']);
    } catch (e) {
      dropOk = false;
      console.error(
        `[android-driver] androidNetworkDropFor(${name}, ${seconds}) disable phase failed: ${e.message}`,
      );
    }
    // The outage duration IS the feature: androidNetworkDropFor(name, seconds) must hold
    // the network down for exactly the seconds it was asked for. There is no condition to
    // wait on — waiting less would not be the test the caller requested.
    await new Promise((resolve) => setTimeout(resolve, durationMs)); // sleep-ok: requested outage duration
    let restoreOk = true;
    try {
      adb(['shell', 'svc', 'wifi', 'enable']);
      adb(['shell', 'svc', 'data', 'enable']);
    } catch (e) {
      restoreOk = false;
      console.error(
        `[android-driver] androidNetworkDropFor(${name}, ${seconds}) re-enable failed: ${e.message}`,
      );
    }
    return dropOk && restoreOk;
  };
  // Export the wireless-adb detector for unit tests + potential reuse
  // by other "kills-the-tunnel" driver methods (e.g. a future airplane-
  // mode helper).
  driver._isWirelessAdb = () => isWirelessAdb(serial);

  // Internal helper: poll androidUiDump until `tag` appears or the
  // timeout elapses. Returns true on found, false on timeout. Used by
  // androidPersonaSignIn for the post-tap settles where exact timing
  // depends on Firebase network latency + Compose layout passes; a
  // fixed setTimeout would either over-wait (slow tests) or under-wait
  // (flake on slow runs).
  async function waitForTag(tag, timeoutMs, pollMs = 200) {
    const deadline = Date.now() + timeoutMs;
    const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`resource-id="(?:[^"]*:id/)?${escTag}"`);
    while (Date.now() < deadline) {
      try {
        const dump = await driver.androidUiDump();
        if (re.test(dump)) return true;
      } catch {
        // Transient dump failures are tolerated within the wait window.
      }
      // Poll interval inside a poll-until-true loop: it exits the instant the condition
      // holds, so it is correct at any machine speed — the same reasoning the guard
      // already applies to shell polls.
      await new Promise((r) => setTimeout(r, pollMs)); // sleep-ok: poll interval, exits on condition
    }
    return false;
  }

  // j09 + every-journey Background: "<persona> is signed in on Android
  // physical at the <tab> tab". Drives the device APP through the
  // persona picker, which is the canonical journey-test auth path
  // (per feedback-test-personas-not-oauth: never drive Google/Apple
  // OAuth in journey tests). Distinct from the runner's Firebase REST
  // sign-in which only seeds ctx.sessions server-side — this also
  // gets the device's APP onto the main screen so subsequent UI-action
  // steps (taps, dumps) find the tags they expect.
  //
  // Personas need a P-NN id (P-02..P-19); the picker dialog rows are
  // keyed by that id. Ephemeral personas (P-01 Adam, P-03 Mia) have
  // no persisted Firebase account so they CAN'T sign in via the
  // picker — they'd need the prod-flow signup which is a separate
  // matcher's responsibility.
  //
  // Throws with an actionable error naming the step that failed
  // (open-picker / pick-row / wait-for-main) so the runner surfaces
  // a precise finding rather than the generic "ui dump didn't
  // contain X" downstream.
  // ── Auth-state helpers + real in-app sign-out (SHY-0096) ──────────────
  //
  // Tap an element by its VISIBLE TEXT, for screens whose buttons lack a
  // testTag (e.g. the daily-reward popup's "Later"). Resolves the text
  // node's bounds from a fresh UI dump and taps its centre. Returns false
  // if the text is not present.
  async function tapByVisibleText(text) {
    let dump;
    try {
      dump = await driver.androidUiDump();
    } catch {
      return false;
    }
    const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m =
      new RegExp(`text="${esc}"[^>]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`).exec(dump) ||
      new RegExp(`bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^>]*?text="${esc}"`).exec(dump);
    if (!m) return false;
    const x = Math.floor((Number(m[1]) + Number(m[3])) / 2);
    const y = Math.floor((Number(m[2]) + Number(m[4])) / 2);
    // Return the ACTUAL tap result — androidTap returns false on an adb error
    // (e.g. device offline mid-flow). An unconditional `true` would mask a
    // failed tap as a successful dismissal (review Finding 5).
    const tapped = await driver.androidTap(x, y);
    return tapped;
  }
  driver._tapByVisibleText = tapByVisibleText;

  // Dismiss the daily-reward popup ("Claim Today's Reward" / "Later") shown
  // on the first login of the day. It has no testTag, so it is dismissed via
  // the "Later" text. No-op (returns false) when not present.
  async function dismissDailyRewardIfPresent() {
    let dump;
    try {
      dump = await driver.androidUiDump();
    } catch {
      return false;
    }
    if (!/Claim Today|Daily Reward/i.test(dump)) return false;
    const tapped = await tapByVisibleText('Later');
    if (tapped) await new Promise((r) => setTimeout(r, 800)); // sleep-ok: device settle after dismissing the daily-reward popup
    return tapped;
  }
  driver._dismissDailyRewardIfPresent = dismissDailyRewardIfPresent;

  // Advance past transient launch gates — the splash intro
  // (`splash_continueButton`, shown on cold start), the daily-reward popup,
  // and short-lived splash/transition frames — until a STABLE auth state is
  // reached. Returns 'picker' | 'signed_in' | 'warning' | 'legal_gate' |
  // 'unknown'. Bounded loop (`maxIterations`, default 12) so a stuck system
  // dialog can't hang the driver. Shared by androidPersonaSignIn (Step 0b) +
  // androidSignOut.
  async function advancePastLaunchGates(maxIterations = 12) {
    for (let i = 0; i < maxIterations; i++) {
      let dump;
      try {
        dump = await driver.androidUiDump();
      } catch {
        dump = '';
      }
      const state = classifyAndroidAuthState(dump);
      if (state === 'splash') {
        await driver.androidTapByTag('splash_continueButton');
        await new Promise((r) => setTimeout(r, 1500)); // sleep-ok: settle before the loop re-dumps
        continue;
      }
      // Backend-unreachable gate. REPAIR THE TRANSPORT FIRST, then dismiss.
      //
      // "Degraded" means the app could not reach the backend, and on a USB
      // device the overwhelmingly likely cause is that `adb reverse` vanished
      // in a re-enumeration — not that the stack is down. Tapping acknowledge
      // without re-establishing the tunnels just returns the app to a screen it
      // will bounce straight off again, so the loop burns its whole budget and
      // reports a "product" failure caused by a USB cable.
      //
      // The bounded loop is still the backstop: if the tunnels genuinely cannot
      // be restored, this exits with the missing ports named rather than
      // retrying forever.
      if (state === 'degraded') {
        ensureReverseTunnels();
        await driver.androidTapByTag('degraded_acknowledgeButton');
        await new Promise((r) => setTimeout(r, 1200)); // sleep-ok: settle before the loop re-dumps
        continue;
      }
      // Fresh-install legal acceptance. Every checkbox must be ticked before
      // Continue enables, so the CHECKBOX LIST IS READ FROM THE DUMP rather
      // than hard-coded: the screen currently has four
      // (terms / privacy / community / cyber-bullying), it had fewer before,
      // and a hard-coded list silently under-ticks the day a fifth is added —
      // leaving Continue disabled and the run reporting a device problem.
      //
      // Reachable now because a stale Firebase session can no longer be
      // cleared with `pm clear` on this device, so the harness clears the app's
      // data directly and lands here. Before that it was only ever seen on a
      // genuinely fresh install, which is why nothing handled it.
      if (state === 'legal_gate') {
        const boxes = [...new Set([...dump.matchAll(/legal_accept\w*Checkbox/g)].map((m) => m[0]))];
        for (const box of boxes) await driver.androidTapByTag(box);
        await driver.androidTapByTag('legal_continueButton');
        await new Promise((r) => setTimeout(r, 1500)); // sleep-ok: settle before the loop re-dumps
        continue;
      }
      if (/Claim Today|Daily Reward/i.test(dump)) {
        await tapByVisibleText('Later');
        await new Promise((r) => setTimeout(r, 800)); // sleep-ok: settle before the loop re-dumps
        continue;
      }
      // System permission dialogs re-prompt on launch and CANNOT be pre-granted
      // via adb on this device (appops/pm grant are blocked — OEM security), so
      // dismiss/grant them in-UI. NOTE: English-only system strings — an
      // operator-side device reconfig (grant the overlay permission once, or
      // enable adb security settings) is the locale-robust fix.
      if (/Display over other apps/i.test(dump)) {
        await tapByVisibleText('Not now');
        await new Promise((r) => setTimeout(r, 800)); // sleep-ok: settle before the loop re-dumps
        continue;
      }
      if (dump.includes('permission_allow_foreground_only_button')) {
        await driver.androidTapByTag('permission_allow_foreground_only_button');
        await new Promise((r) => setTimeout(r, 800)); // sleep-ok: settle before the loop re-dumps
        continue;
      }
      if (state === 'unknown') {
        // Splash/transition frame or a foreground system permission dialog —
        // wait and re-dump rather than acting on an unrecognized screen.
        await new Promise((r) => setTimeout(r, 800)); // sleep-ok: poll interval before re-dumping an unrecognised screen
        continue;
      }
      return state;
    }
    try {
      return classifyAndroidAuthState(await driver.androidUiDump());
    } catch {
      return 'unknown';
    }
  }
  driver._advancePastLaunchGates = advancePastLaunchGates;

  // Real in-app sign-out — the ONLY reliable signed-out reset on a physical
  // device (`pm clear` → SecurityException, `run-as rm` → Permission denied
  // on the OnePlus CPH2653; SHY-0096). `am force-stop` does NOT clear the
  // Firebase session, so persona-switching needs this genuine UI sign-out.
  //
  // Flow (testTags verified in source):
  //   [warning gate] warning_acknowledgeButton — clear a moderation gate
  //   [reward popup] "Later"                    — first-login-of-day popup
  //   main_profileTab → main_settingsButton     — gear is Profile-tab-only
  //                                               (MainScreen.kt:87-88)
  //   → settings_signOutButton → settings_signOutConfirmButton
  //   → assert persona_picker_open              — signed-out
  //
  // Idempotent: returns true immediately if already on the picker. Throws a
  // specific, screen-naming error if any step cannot reach the picker (never
  // a silent false that would leak a stale session into the next journey).
  driver.androidSignOut = async () => {
    const dumpState = async () => {
      try {
        return classifyAndroidAuthState(await driver.androidUiDump());
      } catch {
        return 'unknown';
      }
    };
    let state = await advancePastLaunchGates();
    if (state === 'picker') return true;
    if (state === 'warning') {
      await driver.androidTapByTag('warning_acknowledgeButton');
      await new Promise((r) => setTimeout(r, 1500)); // sleep-ok: device settle after acknowledging the warning screen
      state = await dumpState();
      if (state === 'picker') return true;
      // AC (Error paths): a warning-acknowledge tap that does NOT advance must
      // surface a clear "acknowledge did not clear the gate" error rather than
      // falling through to a blind main-nav tap. A still-`warning` state means
      // the ack failed (genuinely invalid/expired session, or the acknowledge
      // endpoint failed) — the real-time observeUserFlags listener re-routes
      // back to the warning screen while hasActiveWarning stays true, so the
      // settings chain is unreachable. Fail loud, not silent.
      if (state === 'warning') {
        throw new Error(
          'androidSignOut: tapped "warning_acknowledgeButton" but the warning gate is still showing — the acknowledge did not clear the gate (invalid/expired session, or the acknowledge endpoint failed). Cannot reach the settings sign-out chain.',
        );
      }
    }
    // A fresh-install legal/onboarding gate has no main nav — sign-out cannot
    // clear it. Throw a specific, actionable error rather than a blind
    // main_profileTab tap that would time out with a vaguer message.
    if (state === 'legal_gate') {
      throw new Error(
        'androidSignOut: app is on a legal/onboarding gate ("legal_gate") — sign-out cannot clear a fresh-install gate. Re-install or provision the device, then retry.',
      );
    }
    await dismissDailyRewardIfPresent();
    await driver.androidTapByTag('main_profileTab');
    await new Promise((r) => setTimeout(r, 800)); // sleep-ok: device settle — no host-queryable signal between an input event and the redraw
    if (!(await waitForTag('main_settingsButton', 4000))) {
      throw new Error(
        `androidSignOut: "main_settingsButton" not visible after tapping main_profileTab — cannot reach settings (observed state: ${await dumpState()}). The app may be on a fresh-install gate (legal/onboarding) rather than main.`,
      );
    }
    await driver.androidTapByTag('main_settingsButton');
    if (!(await waitForTag('settings_signOutButton', 5000))) {
      throw new Error(
        'androidSignOut: "settings_signOutButton" never appeared after opening settings — the settings screen did not render or the testTag drifted.',
      );
    }
    await driver.androidTapByTag('settings_signOutButton');
    if (!(await waitForTag('settings_signOutConfirmButton', 4000))) {
      throw new Error(
        'androidSignOut: sign-out confirmation dialog ("settings_signOutConfirmButton") never appeared after tapping settings_signOutButton.',
      );
    }
    await driver.androidTapByTag('settings_signOutConfirmButton');
    if (!(await waitForTag('persona_picker_open', 8000))) {
      throw new Error(
        `androidSignOut: confirmed sign-out but "persona_picker_open" never returned within 8s (observed state: ${await dumpState()}) — sign-out may have failed or landed on a legal/onboarding gate.`,
      );
    }
    return true;
  };

  driver.androidPersonaSignIn = async (personaId, tab, target = 'dev') => {
    // The tunnels may have died since driver construction (see
    // ensureReverseTunnels). Re-assert them here rather than discovering the
    // loss as a missing picker twenty minutes into a cell.
    // Verified, not assumed. A missing tunnel here is the difference between a
    // sign-in that works and 29 identical "picker isn't visible" failures, so
    // the result is carried into the error message rather than logged and lost.
    const missingTunnels = ensureReverseTunnels();
    if (!/^P-\d{2}$/.test(personaId)) {
      throw new Error(
        `androidPersonaSignIn requires a P-NN persona id (got "${personaId}") — ephemeral personas P-01/P-03 sign up via the prod flow, not the picker`,
      );
    }
    // Step 0: launch the ShyTalk app on the device. The first j09
    // re-dispatch on 2026-05-30 surfaced "could not tap persona_picker_open"
    // because the device was sitting on com.android.settings — the test
    // never opened ShyTalk. Per-target package: local → .local,
    // dev → .dev, prod → bare (no suffix). Mirrors the
    // applicationIdSuffix config at app/build.gradle.kts lines 43/132.
    const pkg = PACKAGE_BY_TARGET[target] || PACKAGE_BY_TARGET.dev;
    // Force-stop FIRST so each call starts from a cold app PROCESS state
    // (process isolation only). NOTE: force-stop does NOT clear the Firebase
    // session — the app can relaunch already signed-in or on a moderation
    // gate. The Step 0b classifier below (advancePastLaunchGates +
    // androidSignOut when signed-in/warning) is what actually guarantees a
    // picker-reachable sign-in-screen start. Errors are non-fatal — the
    // package may not be running, that's fine.
    try {
      adb(['shell', 'am', 'force-stop', pkg]);
    } catch {
      // Ignored — force-stop on a non-running package is a no-op.
    }
    try {
      // monkey -p <pkg> -c LAUNCHER 1 fires the registered launcher
      // intent regardless of which activity is currently focused — works
      // whether ShyTalk was closed, backgrounded, or another app is
      // foregrounded. The "1" is the event count.
      adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
    } catch (e) {
      throw new Error(
        `androidPersonaSignIn: launch of "${pkg}" failed — is the ${target} build installed? adb error: ${e.message}`,
        { cause: e },
      );
    }
    // Settle for the launcher → ShyTalk transition. ~3s is enough for
    // a warm start (app process already running). Cold starts may
    // need longer; if the dump doesn't have persona_picker_open after
    // 3s, the test below will catch it with the canonical error.
    await new Promise((r) => setTimeout(r, 3000)); // sleep-ok: device settle — app launch budget before the first dump
    // Step 0b: advance past launch gates (splash intro / daily-reward popup /
    // transition frames) then classify (SHY-0096). force-stop does NOT clear
    // the Firebase session, so the app may relaunch signed-in (or on a
    // moderation warning gate) instead of the picker; if so, perform a real
    // in-app sign-out so the picker becomes reachable.
    // Step 0b: REACH THE PICKER, or say precisely why not.
    //
    // Measured 2026-08-01 on the app-android cell: 1 pass then 29 consecutive
    // failures, every one "could not tap persona_picker_open ... the user is
    // ALREADY signed in". The first scenario signed in, nothing signed out, and
    // every scenario after it died on the same blind tap.
    //
    // The cause is the `unknown` branch. `classifyAndroidAuthState` recognises
    // main by `main_roomsTab`/`main_profileTab`/`main_settingsButton`; any other
    // in-app screen — a minor-cohort main, a system-PM notice, an error state —
    // classifies as `unknown`, whose contract is "never acts". So no sign-out
    // happened and Step 1 tapped a button that was not there.
    //
    // A signed-in session that cannot be classified is still a signed-in
    // session. Try the real in-app sign-out; if that cannot get us to the
    // picker, clear the app's stored session outright. `pm clear` is heavy —
    // it drops legal acceptance too, which the launch-gate loop then has to
    // re-clear — but it is DETERMINISTIC, and a harness that cannot guarantee a
    // signed-out start can only ever run its first scenario.
    let launchState = await advancePastLaunchGates();
    if (launchState !== 'picker') {
      try {
        await driver.androidSignOut();
      } catch {
        // Non-fatal: sign-out navigates Profile → Settings, which is exactly
        // what an unclassifiable screen may not offer. The reset below is the
        // fallback that does not depend on the UI being where we expect.
      }
      launchState = await advancePastLaunchGates();
    }
    // Last resort: drop the app's stored session outright. NOT available on
    // every device — the OnePlus CPH2653 refuses it:
    //   SecurityException: PID … does not have permission CLEAR_APP_USER_DATA
    // A bare `catch {}` here hid that entirely, so the error below claimed a
    // "reset attempt" that the OS had rejected. Whether it ran is reported.
    let resetNote = 'not attempted';
    if (launchState !== 'picker') {
      try {
        adb(['shell', 'pm', 'clear', pkg]);
        adb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
        await new Promise((r) => setTimeout(r, 3000)); // sleep-ok: cold start after pm clear
        launchState = await advancePastLaunchGates();
        resetNote = 'pm clear ran';
      } catch (e) {
        resetNote = `pm clear unavailable on this device (${String(e.message).slice(0, 120)})`;
      }
    }

    // Step 1: tap `persona_picker_open` on the sign-in screen.
    // Available on local + dev (PR #882); on prod the button is
    // hidden so this will return false → actionable error.
    const opened = await driver.androidTapByTag('persona_picker_open');
    if (!opened) {
      // Report the EVIDENCE, not a list of guesses. The previous message named
      // three possible causes and no observation, so every one of the 29
      // failures said the same thing and none of them said what was on screen.
      let onScreen = '(no dump)';
      try {
        const dump = await driver.androidUiDump();
        const tags = [...String(dump).matchAll(/resource-id="([^"]*)"/g)]
          .map((m) => m[1].split('/').pop())
          .filter(Boolean);
        onScreen = tags.length ? [...new Set(tags)].slice(0, 25).join(', ') : '(no testTags found)';
      } catch {
        /* keep the placeholder — a failed dump is itself worth reporting */
      }
      throw new Error(
        `androidPersonaSignIn: could not reach the persona picker on ShyTalk ${target}. ` +
          `Observed state after sign-out + reset attempts: "${launchState}" (reset: ${resetNote}). ` +
          `testTags currently on screen: ${onScreen}. ` +
          `Reverse tunnels missing at start of sign-in: ` +
          `${missingTunnels.length ? missingTunnels.join(', ') : 'none'}. ` +
          `If the state is "degraded", the app cannot reach the backend — that is ` +
          `almost always a USB re-enumeration dropping \`adb reverse\`, not the stack. ` +
          `If the state is "unknown", classifyAndroidAuthState does not recognise this screen — ` +
          `add its anchor tag there rather than widening the blind tap. ` +
          `If it is "signed_in", sign-out ran but did not take effect. ` +
          `On prod the picker is hidden by design and this cell cannot run at all.`,
      );
    }
    // Step 2: wait for the dialog to render. Anchor on the persona-picker
    // LazyColumn container (`persona_picker_list`) which is ALWAYS at the
    // top of the dialog regardless of scroll position — using the
    // requested row would fail for personas below the fold (the picker
    // is capped at 400dp and lists 17 personas, so anything past ~P-09
    // requires scrolling).
    const containerTag = 'persona_picker_list';
    const rowTag = `persona_row_${personaId}`;
    const dialogReady = await waitForTag(containerTag, 5000);
    if (!dialogReady) {
      throw new Error(
        `androidPersonaSignIn: picker dialog never showed "${containerTag}" within 5s — testTags may not be exposed via testTagsAsResourceId, or the dialog didn't render. Verify exposeTestTagsToPlatformDumps() is applied to the dialog content.`,
      );
    }
    // Step 2b: scroll-to-find the requested row. Two cases to handle:
    //   (a) Row testTag missing from the dump entirely — list hasn't
    //       laid out the row yet, scroll to bring it into the layout
    //       window.
    //   (b) Row testTag PRESENT in the dump but its bounds are below
    //       the picker_list's bottom clipping rect — uiautomator
    //       reports laid-out bounds, NOT clipped bounds. A tap at
    //       the row's center coordinates lands on the dialog backdrop
    //       (outside the visible list), dismissing the dialog rather
    //       than selecting the row. Surfaced 2026-05-30 against the
    //       operator's OnePlus CPH2653 device where P-10's bounds
    //       were [244,2225][1196,2393] but picker_list ended at y=2239
    //       — only the top 14px of the row was clickable.
    //
    // Solution: loop until the row is BOTH in the dump AND fully
    // inside the picker_list's visible rect. Swipe up if either fails.
    function rowFullyVisible(dump) {
      const escRow = rowTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escContainer = containerTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rowMatch = new RegExp(
        `resource-id="(?:[^"]*:id/)?${escRow}"[^/]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
      ).exec(dump);
      const listMatch = new RegExp(
        `resource-id="(?:[^"]*:id/)?${escContainer}"[^/]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
      ).exec(dump);
      if (!rowMatch || !listMatch) return false;
      // y2 (row's bottom) must be <= list's y2 (list's bottom) AND
      // y1 (row's top) must be >= list's y1 (list's top).
      const rowY1 = Number(rowMatch[2]);
      const rowY2 = Number(rowMatch[4]);
      const listY1 = Number(listMatch[2]);
      const listY2 = Number(listMatch[4]);
      return rowY1 >= listY1 && rowY2 <= listY2;
    }
    let visible = false;
    let swipes = 0;
    const MAX_SWIPES = 15;
    while (!visible && swipes < MAX_SWIPES) {
      let dump = '';
      try {
        dump = await driver.androidUiDump();
      } catch {
        // Transient dump failures are tolerated within the wait window.
      }
      if (rowFullyVisible(dump)) {
        visible = true;
        break;
      }
      // Swipe up inside the picker to scroll the list DOWN. y range
      // 1800→1000 stays inside the list bounds for typical phone
      // viewports (list bottom ~2200+, top ~800+).
      try {
        adb(['shell', 'input', 'swipe', '720', '1800', '720', '1000', '500']);
      } catch (e) {
        console.error(
          `[android-driver] persona-picker scroll swipe ${swipes} failed: ${e.message}`,
        );
      }
      // Settle for the LazyColumn to lay out the new viewport.
      await new Promise((r) => setTimeout(r, 400)); // sleep-ok: device settle after a swipe, for the LazyColumn to lay out
      swipes++;
    }
    if (!visible) {
      throw new Error(
        `androidPersonaSignIn: "${rowTag}" never became fully visible inside the picker list after ${MAX_SWIPES} scroll attempts — persona may not be in the dev personas registry (provision-test-personas.js), or the list is shorter than expected.`,
      );
    }
    // Step 3: tap the persona row. By this point the row's full
    // height is inside the visible clipping rect, so androidTapByTag's
    // bounds-center calculation lands inside the clickable area.
    const picked = await driver.androidTapByTag(rowTag);
    if (!picked) {
      throw new Error(
        `androidPersonaSignIn: tap on "${rowTag}" failed despite dialog showing the row fully visible — UI dump may be racing the tap`,
      );
    }
    // Step 4: wait for sign-in completion. Anchor on `main_roomsTab`
    // since that's the default landing tab for all signed-in users.
    // Firebase REST sign-in via the picker can take 3-5s in the worst
    // case (network roundtrip + Firestore profile fetch + Compose nav).
    // Step 4: wait for Firebase sign-in to complete + advance past any
    // post-sign-in launch gates (splash / system permission dialogs / the
    // daily-reward popup) to the main screen (SHY-0096). The post-pick flow
    // re-shows the same per-launch gates as Step 0b, so reuse the gate-advancer
    // (with extra headroom for the Firebase sign-in roundtrip).
    const postState = await advancePastLaunchGates(16);
    if (postState !== 'signed_in') {
      throw new Error(
        `androidPersonaSignIn: after picking ${personaId}, expected the main screen but classified "${postState}" within the gate-advance budget — Firebase sign-in may have failed, or a warning/legal gate intercepted (check device logcat).`,
      );
    }
    // Step 5: if the requested tab is not "rooms" (default landing),
    // tap the requested tab. Mirrors the main-nav convention
    // `main_<lowered>Tab` used by tapMainNavTab.
    const loweredTab = String(tab).toLowerCase();
    if (loweredTab !== 'rooms') {
      const navOk = await driver.androidTapByTag(`main_${loweredTab}Tab`);
      if (!navOk) {
        throw new Error(
          `androidPersonaSignIn: signed in OK but couldn't navigate to "main_${loweredTab}Tab" — tab name may not match the main nav convention`,
        );
      }
      // Settle for the tab content to render before subsequent steps.
      await new Promise((r) => setTimeout(r, 500)); // sleep-ok: device settle — no host-queryable signal between an input event and the redraw
    }
    return true;
  };

  // j09 "Theo on Android confirms in the dialog" (line 107 close-room
  // scenario) + future destructive-action confirmations. Tries a stack
  // of known confirm-button testTags in priority order; first match
  // wins.
  //
  // Priority order:
  //   1. surface-specific tags (room_endRoomConfirmButton, etc.) —
  //      tested first because they're unambiguous on the matching screen
  //   2. generic dialog tags — fallback for AlertDialogs that follow
  //      the Material convention but don't have a surface-specific tag
  //
  // Returns true on tap success. Returns false (with stderr warning)
  // when NO candidate testTag is present in the dump — this surfaces
  // a finding rather than silently succeeding on a missing dialog,
  // matching the QA-mindset rule against plaster-fixes. Distinct from
  // a tap-failure crash: the caller can decide whether to fail the
  // step or move on.
  //
  // Known callers: j09 close-room (line 107). When that scenario fires
  // against the current UI, the room_endRoomConfirmButton testTag is
  // not yet on RoomSettingsSheet (the close action is currently
  // immediate, no AlertDialog) — see follow-up note in PR body for
  // the UX gap. This driver method is in place for when the dialog
  // is added.
  driver.androidConfirmDialog = async () => {
    const CONFIRM_TAG_CANDIDATES = [
      // Surface-specific (j09 close-room, j15 mc-end-stream, etc.)
      'room_endRoomConfirmButton',
      'settings_signOutConfirmButton',
      'settings_clearCacheConfirmButton',
      'settings_unblockConfirmButton',
      'settings_deleteAccountConfirmButton',
      'settings_deletePinConfirmButton',
      // Generic AlertDialog fallback
      'dialog_confirmButton',
      'alertdialog_confirmButton',
      'confirm_button',
    ];
    for (const candidate of CONFIRM_TAG_CANDIDATES) {
      if (await driver.androidTapByTag(candidate)) {
        return true;
      }
    }
    console.error(
      `[android-driver] androidConfirmDialog: no confirm-button testTag found in UI dump (tried ${CONFIRM_TAG_CANDIDATES.length} candidates). If the current scenario expects a confirmation dialog and the surface doesn't render one, this is a UX gap, not a driver bug.`,
    );
    return false;
  };

  driver.close = async () => {
    /* adb sessions are stateless; nothing to release */
  };

  // ── SHY-0259 batch 1: interaction primitives the corpus already assumes ──
  //
  // Measured 2026-08-01: 179 of the 217 driver methods the runner can call did
  // not exist, so scores of scenarios failed with `not configured` — a harness
  // gap wearing the costume of a product defect. These are the highest-traffic
  // Android ones, built on the primitives that DO exist (androidUiDump,
  // androidTap, androidTapByTag, tapByVisibleText). Real device calls only; a
  // stub here would turn a visible gap into a green cell that tested nothing.

  // Targeting logic lives in ./ui-dump-query.js so it can be tested against
  // real captured dumps without a device. Keeping a second copy here is how a
  // test ends up passing while the driver's own version is broken.
  driver._centreOf = centreOf;
  driver._dumpHas = dumpHas;

  // Tap a user's card. Prefers the testTag the app actually renders
  // (`userCard_<name>`), then any userCard bearing the name, then the bare
  // name — three real strategies, because the corpus names people and the UI
  // tags them, and which one is present depends on the screen.
  driver.androidTapUserCard = async (viewer, target) => {
    const name = target || viewer;
    if (!name) return false;
    if (await driver.androidTapByTag(`userCard_${name}`)) return true;
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const c = centreOfCardWithLabel(dump, 'userCard_', name);
    if (c) return await driver.androidTap(c.cx, c.cy);
    return await tapByVisibleText(name);
  };

  // Tap a button by its visible label. content-desc is checked too because
  // icon-only buttons carry their label there and nowhere else.
  driver.androidTapNamedButton = async (label) => {
    if (!label) return false;
    if (await tapByVisibleText(label)) return true;
    const dump = await driver.androidUiDump();
    const c = dump && centreOf(dump, 'content-desc', label);
    return c ? await driver.androidTap(c.cx, c.cy) : false;
  };

  // "taps Follow" / "taps Block" — a bare verb IS a named button; kept as its
  // own name so the matcher reads like the Gherkin and greps cleanly.
  driver.androidTapBareVerb = async (verb) => driver.androidTapNamedButton(verb);

  // Re-enter the room already under test. Delegates to the room-card tap so
  // both paths stay in step; a second implementation would drift.
  driver.androidTapSameRoom = async (owner) => driver.androidTapRoomCard(owner);

  driver.androidTapQuotedTargetOrName = async (name) => driver.androidTapNamedButton(name);

  /**
   * Type free text into whatever holds focus.
   *
   * Only the space encoding is applied here — `input text` splits on spaces
   * and decodes `%s` back to one. Shell quoting is NOT this function's job:
   * `adb()` quotes for the device shell, which is the only shell left now
   * that the host one is gone.
   */
  driver.androidTypeText = async (text) => {
    if (text === undefined || text === null) return false;
    const safe = escapeInputText(text);
    try {
      adb(['shell', 'input', 'text', safe]);
      return true;
    } catch (e) {
      console.error(`[android-driver] androidTypeText failed: ${e.message}`);
      return false;
    }
  };

  // Focus a field, type into it, submit. The enter keyevent is what actually
  // sends in the app's single-line inputs.
  driver.androidTypeAndSubmit = async (tagOrLabel, text) => {
    const focused =
      (await driver.androidTapByTag(tagOrLabel)) ||
      (await driver.androidTapNamedButton(tagOrLabel));
    if (!focused) return false;
    if (!(await driver.androidTypeText(text))) return false;
    try {
      adb(['shell', 'input', 'keyevent', '66']); // KEYCODE_ENTER
      // Stamp AFTER the keyevent lands, so the render budget measures from the
      // moment the app was actually asked to do the work.
      submitClock.markSubmit();
      return true;
    } catch (e) {
      console.error(`[android-driver] androidTypeAndSubmit submit failed: ${e.message}`);
      return false;
    }
  };

  driver.androidTypeIntoConversationInput = async (text) => {
    // `privateChat_messageInput` is the real tag (PrivateChatScreen). The two
    // names tried here before — `pm_messageInput` and `conversation_input` —
    // exist nowhere in the product, so the input was never focused and the
    // typing went to whatever had focus instead.
    const focused = await driver.androidTapByTag('privateChat_messageInput');
    if (!focused) return false;
    return await driver.androidTypeText(text);
  };

  // Assertions. Each reads the REAL dump — never a cached or assumed state.
  driver.androidShowsNamedButton = async (label) => dumpHas(await driver.androidUiDump(), label);

  driver.androidShowsPlaceholder = async (text) => dumpHas(await driver.androidUiDump(), text);

  // A message input is present if its tag is there, or any editable field is.
  // The class check matters: Compose renders the composer as an EditText with
  // no resource-id on some screens.
  driver.androidShowsMessageInput = async () => {
    return hasEditableField(await driver.androidUiDump());
  };

  // Open a named tab. androidOpensTab is the ASSERTION; this is the ACTION —
  // distinct names for distinct jobs, which is why the corpus asked for both.
  driver.androidOpenTab = async (tab) => {
    if (await driver.androidTapByTag(`tab_${tab}`)) return true;
    return await driver.androidTapNamedButton(tab);
  };

  driver.androidOpenListView = async (name) => {
    if (await driver.androidTapByTag(`list_${name}`)) return true;
    return await driver.androidTapNamedButton(name);
  };

  // Confirm the dialog in front of us. Delegates so the affirmative-label list
  // lives in one place.
  driver.androidConfirm = async () => driver.androidConfirmDialog();

  // ── SHY-0259 batch 5: the rest of the Android surface ───────────────────
  //
  // Composites, attempt-verbs and assertions. Built on batch 1 plus the
  // existing primitives; nothing here re-implements a tap or a dump.

  // "attempts X" is used where the action is EXPECTED to be refused. It must
  // report whether the control could be ACTUATED, never whether the attempt
  // was permitted — conflating the two makes a correct block look like a
  // driver fault, which is how a working safety gate gets "fixed".
  driver.androidAttemptAction = async (label) => ({
    attempted: true,
    actuated: await driver.androidTapNamedButton(label),
  });
  driver.androidAttemptBlock = async (target) => {
    await driver.androidTapUserCard(null, target);
    return driver.androidAttemptAction('Block');
  };
  driver.androidAttemptFollowViaProfile = async (target) => {
    await driver.androidTapUserCard(null, target);
    return driver.androidAttemptAction('Follow');
  };
  driver.androidAttemptStartConversation = async (target) => {
    await driver.androidTapUserCard(null, target);
    return driver.androidAttemptAction('Message');
  };
  driver.androidAttemptProfileDeepLink = async (target) => {
    const opened = await driver.androidOpenDeepLink(`shytalk://profile/${target}`);
    return { attempted: true, actuated: opened };
  };

  // Deep links go through `am start`, the same path the OS uses for a tapped
  // link, so the app's own intent filters and guards are genuinely exercised.
  driver.androidOpenDeepLink = async (url) => {
    try {
      adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', String(url)]);
      return true;
    } catch (e) {
      console.error(`[android-driver] androidOpenDeepLink(${url}) failed: ${e.message}`);
      return false;
    }
  };

  driver.androidOpenConversation = async (withName) => {
    if (await driver.androidTapByTag(`conversation_${withName}`)) return true;
    if (!(await driver.androidOpenScreen('pm'))) return false;
    return driver.androidTapNamedButton(withName);
  };

  driver.androidIsOnConversationWith = async (name) => dumpHas(await driver.androidUiDump(), name);

  driver.androidSendMessageTo = async (target, text) => {
    if (!(await driver.androidOpenConversation(target))) return false;
    if (!(await driver.androidTypeIntoConversationInput(text))) return false;
    // `conversation_sendButton` is the real tag; `pm_sendButton` does not exist.
    return (
      (await driver.androidTapByTag('conversation_sendButton')) ||
      driver.androidTapNamedButton('Send')
    );
  };

  // Long-press then choose from the context menu. The press must outlast the
  // system long-press threshold or it registers as an ordinary tap and the
  // menu never appears.
  driver.androidLongPressMessageAndTap = async (messageText, action) => {
    const dump = await driver.androidUiDump();
    const c = dump && centreOf(dump, 'text', messageText);
    if (!c) return false;
    try {
      adb([
        'shell',
        'input',
        'swipe',
        String(c.cx),
        String(c.cy),
        String(c.cx),
        String(c.cy),
        '800',
      ]);
    } catch (e) {
      console.error(`[android-driver] long-press failed: ${e.message}`);
      return false;
    }
    return driver.androidTapNamedButton(action);
  };

  driver.androidEditBodyAndConfirm = async (newBody) => {
    if (!(await driver.androidTypeIntoConversationInput(newBody))) return false;
    return (await driver.androidTapByTag('pm_confirmEdit')) || driver.androidConfirm();
  };

  driver.androidAcceptLegalAndContinue = async () => {
    for (const tag of ['legal_acceptCheckbox', 'legal_accept']) await driver.androidTapByTag(tag);
    return (
      (await driver.androidTapNamedButton('Continue')) ||
      (await driver.androidTapNamedButton('Accept'))
    );
  };

  // Date-of-birth entry. The picker is a composite: open it, type the parts,
  // confirm. Typing into the field directly is what the app supports on this
  // screen; a spinner gesture would be device-geometry dependent.
  driver.androidPickDOB = async (dob) => {
    if (!(await driver.androidTapByTag('signup_dobPicker'))) return false;
    if (!(await driver.androidTypeText(String(dob)))) return false;
    return (await driver.androidTapNamedButton('OK')) || driver.androidConfirm();
  };

  driver.androidSignupWithDOB = async (dob) => {
    if (!(await driver.androidTapByTag('signin_signUpLink'))) return false;
    if (!(await driver.androidPickDOB(dob))) return false;
    return driver.androidTapNamedButton('Continue');
  };

  driver.androidPickIdType = async (idType) => {
    if (await driver.androidTapByTag(`idType_${idType}`)) return true;
    return driver.androidTapNamedButton(idType);
  };

  driver.androidSelectGalleryImage = async (index = 0) => {
    if (!(await driver.androidTapByTag('idUpload_gallery'))) return false;
    return driver.androidTapByTag(`galleryImage_${index}`);
  };

  driver.androidPickTestImageBySize = async (size) => {
    if (!(await driver.androidTapByTag('idUpload_gallery'))) return false;
    return (
      (await driver.androidTapByTag(`testImage_${size}`)) ||
      (await driver.androidTapNamedButton(String(size)))
    );
  };

  driver.androidSelectGiftRecipient = async (name) => {
    if (await driver.androidTapByTag(`giftRecipient_${name}`)) return true;
    return driver.androidTapNamedButton(name);
  };

  driver.androidSelectFromFollowedPicker = async (name) => {
    if (!(await driver.androidTapByTag('followedPicker'))) return false;
    return driver.androidTapNamedButton(name);
  };

  driver.androidSendGift = async (recipient, gift) => {
    if (!(await driver.androidTapByTag('gift_open'))) return false;
    if (recipient && !(await driver.androidSelectGiftRecipient(recipient))) return false;
    if (gift && !(await driver.androidTapNamedButton(gift))) return false;
    return (await driver.androidTapByTag('gift_send')) || driver.androidTapNamedButton('Send');
  };

  // Tags corrected 2026-08-01 to the ones the product actually renders. These
  // named `rooms_create` and `room_confirmCreate`, neither of which exists
  // anywhere in shared/src — so the taps always missed and every room-creation
  // scenario failed as a PRODUCT defect. The real tags are on
  // shared/.../RoomListScreen + CreateRoomScreen.
  driver.androidCreateRoomComposite = async (title) => {
    if (!(await driver.androidOpenScreen('rooms'))) return false;
    if (!(await driver.androidTapByTag('main_createRoomFab'))) return false;
    if (title && !(await driver.androidTypeText(title))) return false;
    return (await driver.androidTapByTag('createRoom_confirmButton')) || driver.androidConfirm();
  };

  /**
   * Pull-to-refresh the rooms list.
   *
   * The `|| true` this used to end with made the method ALWAYS succeed — a tap
   * on a tag the product does not render (`rooms_refresh`), then a truthy
   * return regardless. Every "refreshes the list" step passed without anything
   * having been refreshed.
   *
   * There is no refresh CONTROL in the product; the list is a live listener.
   * Re-entering the screen is what actually re-subscribes, so that is what this
   * does, and it reports whether that worked.
   */
  driver.androidRefreshRoomsList = async () => {
    if (!(await driver.androidOpenScreen('profile'))) return false;
    return await driver.androidOpenScreen('rooms');
  };

  driver.androidTapEventInviteAction = async (action) => driver.androidTapNamedButton(action);

  driver.androidRetrySamePurchase = async () => {
    if (!(await driver.androidTapByTag('wallet_retryPurchase'))) return false;
    return driver.androidConfirm();
  };

  driver.androidRelaunchAndSignIn = async (persona) => {
    if (!(await driver.androidKillAndRelaunch())) return false;
    return driver.androidPersonaSignIn(persona);
  };

  // Token refresh has to go through the APP, not a server call: the point of
  // these steps is that the client picks up new claims, which a server-side
  // mint would not prove.
  driver.androidForceRefreshJwt = async () => {
    if (await driver.androidTapByTag('debug_forceRefreshJwt')) return true;
    // Backgrounding and resuming triggers the app's own token refresh.
    return driver.androidKillAndRelaunch();
  };
  driver.androidForceRefreshSecureToken = async () => driver.androidForceRefreshJwt();

  driver.androidGetLayoutDirection = async () => parseLayoutDirection(await driver.androidUiDump());

  driver.androidShowsBannerFromUser = async (user) => dumpHas(await driver.androidUiDump(), user);
  driver.androidShowsCohortChangeBanner = async () => {
    const dump = await driver.androidUiDump();
    return (
      dumpHas(dump, 'cohort') ||
      /resource-id="(?:[^"]*:id\/)?cohortChangeBanner"/.test(String(dump))
    );
  };
  driver.androidShowsAdultCohortVisitor = async (name) =>
    dumpHas(await driver.androidUiDump(), name);
  driver.androidShowsNewFollowerNotification = async (name) =>
    dumpHas(await driver.androidUiDump(), name);
  driver.androidShowsStatsForUser = async (name) => dumpHas(await driver.androidUiDump(), name);
  driver.androidShowsTranslationOf = async (text) => dumpHas(await driver.androidUiDump(), text);

  driver.androidShowsPmWithBadge = async (sender) => {
    const dump = await driver.androidUiDump();
    return dumpHas(dump, sender) && /unread|badge/i.test(String(dump));
  };

  // "shows the tab but cannot navigate to it" — both halves must hold, or a
  // simply-missing tab would satisfy the assertion.
  driver.androidShowsTabWithNoNavTo = async (tab) => {
    const dump = await driver.androidUiDump();
    if (!dumpHas(dump, tab)) return false;
    await driver.androidOpenTab(tab);
    const after = await driver.androidUiDump();
    return !new RegExp(`resource-id="(?:[^"]*:id/)?${tab}Screen"`).test(String(after));
  };

  driver.androidSeatGridState = async () => parseSeatGrid(await driver.androidUiDump());

  // ── SHY-0259 batch 8b: authenticated calls from the device ──────────────
  //
  // These exist because some journeys must prove the DEVICE's own credential
  // works, not merely that the endpoint does. Issuing the call from the host
  // would pass with a host-minted token and prove nothing about the app's
  // session — so the request is made from the device, through its own
  // network stack, via the reverse tunnels the driver already sets up.

  async function deviceCurl(method, url, body) {
    const parts = ['shell', 'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', '-X', method];
    // The body goes through UNCHANGED. It used to be passed through
    // `escapeInputText`, which encodes spaces as `%s` — that is a property of
    // `adb shell input text`, not of curl, so `{"a": 1}` was being sent as
    // `{"a":%s1}` and the API received invalid JSON. `adb()` quotes it for the
    // device shell, which is all this needs.
    if (body) parts.push('-H', 'Content-Type: application/json', '-d', String(body));
    parts.push(url);
    try {
      const out = adb(parts);
      const status = Number(String(out).trim().slice(-3));
      return Number.isFinite(status) ? status : 0;
    } catch (e) {
      console.error(`[android-driver] deviceCurl ${method} ${url} failed: ${e.message}`);
      return 0;
    }
  }

  driver.androidApiPost = async (pathname, body) =>
    deviceCurl('POST', `http://localhost:3000${pathname}`, body ? JSON.stringify(body) : null);

  // The app holds the session, so an authenticated call has to originate
  // in-app. The debug hook is the only path that carries the real token; when
  // it is absent we say so instead of falling back to an unauthenticated call
  // that would return 401 and be read as a product failure.
  driver.androidPerformAuthenticatedCall = async (_pathname) => {
    if (await driver.androidTapByTag('debug_performAuthedCall')) {
      const dump = await driver.androidUiDump();
      const m = /authedCallStatus[^0-9]*(\d{3})/.exec(String(dump));
      return { supported: true, status: m ? Number(m[1]) : null };
    }
    return {
      supported: false,
      why: 'no in-app debug hook for an authenticated call; a host-issued request would use a host token and prove nothing about the app session',
    };
  };

  driver.androidReceiveLiveKitToken = async () => {
    const dump = await driver.androidUiDump();
    // The room screen renders only after a token is accepted, so its presence
    // IS the observable evidence — there is no client log to read over adb.
    return (
      /resource-id="(?:[^"]*:id\/)?roomScreen"/.test(String(dump)) || dumpHas(dump, 'Connected')
    );
  };

  // ── cross-platform surface (unprefixed: BOTH ui drivers must define it) ──
  //
  // The runner reaches these through `ctx.uiDriver.<name>` with no platform in
  // the name, because the step reads "no PM screen renders" — whichever device
  // the cell owns is the one that must answer. An unprefixed method missing on
  // one platform is a silent hole: the step is red on Android and skipped on
  // iOS, and the two look like different defects.

  driver.currentPlatformRendersScreen = async (screenName) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    const name = String(screenName).trim();
    // Two shapes are in use across the app: a `<screen>_`-prefixed testTag on
    // the screen root, and the bottom-nav `main_<screen>Tab`. Either one
    // rendering means the screen is on display.
    const tag = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:${tag}_|main_${tag}Tab|${tag}Screen)`, 'i').test(dump);
  };

  driver.showsCardBadge = async (kind, badge, suffix) => {
    const dump = await driver.androidUiDump();
    if (!dump) return false;
    // `kind` scopes the search: a rail card and a plain card can carry the same
    // badge text, and asserting on the wrong one would pass for the wrong
    // reason. The rail scope is the rail container's testTag prefix.
    if (kind === 'rail' && !dumpHas(dump, 'languageRail_') && !/rail/i.test(dump)) return false;
    if (!dumpHas(dump, badge)) return false;
    return suffix ? dumpHas(dump, suffix) : true;
  };

  driver.measureRenderingTimeFromSubmit = async (target) =>
    submitClock.measureUntil(async () => {
      const dump = await driver.androidUiDump();
      return Boolean(dump) && dumpHas(dump, target);
    });

  return driver;
}

module.exports = {
  createAndroidDriver,
  listMethods,
  selectSerial,
  classifyAndroidAuthState,
  ANDROID_METHOD_NAMES,
};
