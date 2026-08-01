/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. */
/* The `sonarjs/no-os-command-from-path` suppression that used to sit here is
   gone, and its absence is the point: every call now goes through
   `execFileSync('/usr/bin/xcrun', argv)` — absolute path, no PATH search, no
   shell. The rule stopped firing because the condition disappeared. */
/**
 * iOS driver backed by `xcrun simctl`.
 *
 * Exposes the ctx.uiDriver methods that manual-qa-runner.js matchers
 * call for iOS scenarios. Real implementations of UI taps + reads
 * require an instrumentation framework (XCUITest, Appium, or
 * idb-companion); the scaffold here provides `openurl`, `launch`,
 * `screenshot`, `status_bar` and stubs for the rest.
 *
 * Wiring contract:
 *   - `createIosDriver({ udid })` picks a booted simulator; defaults
 *     to the first booted device (`xcrun simctl list devices booted`).
 *   - Methods accept the persona name as their first arg (matcher
 *     convention).
 *
 * Tooling notes:
 *   - `xcrun simctl openurl <udid> <url>`         — deep-link
 *   - `xcrun simctl launch <udid> <bundleId>`     — launch app
 *   - `xcrun simctl io <udid> screenshot <path>`  — screenshot
 *   - `xcrun simctl status_bar <udid> override`   — set status bar
 *   - `xcrun simctl spawn <udid> log stream`      — log capture
 *
 * For tap interactions we'd need an XCTest runner attached — that's a
 * substantial integration beyond scaffold scope. Methods that need
 * UI interaction return false + log; methods that only need openurl
 * (e.g., navigate to a deep-link path) get real implementations now.
 */
const { execFileSync } = require('child_process');
const { execBounds, describeExecFailure } = require('./device-io-timeout');
const { createSurfaceBreaker } = require('./surface-circuit-breaker');

function selectUdid(preferredUdid) {
  let raw;
  try {
    // Bounded + shell-free. Unbounded, a wedged CoreSimulator service hangs
    // driver construction before a single scenario runs.
    raw = execFileSync('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'booted'], execBounds());
  } catch (_e) {
    return null;
  }
  const m = raw.match(/\(([0-9A-F-]{36})\)\s*\(Booted\)/i);
  if (preferredUdid) return preferredUdid;
  return m ? m[1] : null;
}

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
  if (!udid) {
    throw new Error('No booted iOS Simulator (xcrun simctl list devices booted is empty)');
  }
  const driver = { _udid: udid };

  // Bounded + breakered + shell-free, to the same standard as the adb driver.
  // Nothing loads this driver today, but an unbounded shell-string exec is a
  // trap left armed for whoever wires it back in.
  const surfaceBreaker = createSurfaceBreaker({ label: `simctl ${udid}` });
  driver._surfaceBreaker = surfaceBreaker;

  function simctl(args) {
    if (surfaceBreaker.isOpen()) {
      throw new Error(
        `[simctl ${udid}] surface is unreachable — ${surfaceBreaker.consecutiveFailures()} consecutive transport failures; remaining work is abandoned rather than retried.`,
      );
    }
    try {
      // execFileSync + argument array: no shell, so the udid and any other
      // value cannot be interpreted as shell syntax.
      const out = execFileSync('/usr/bin/xcrun', ['simctl', ...args.map(String)], execBounds());
      surfaceBreaker.recordSuccess();
      return out;
    } catch (e) {
      const described = describeExecFailure(e, {
        label: `simctl ${udid}`,
        command: `xcrun simctl ${args.join(' ')}`,
        timeoutMs: execBounds().timeout,
      });
      surfaceBreaker.recordFailure(described);
      throw described;
    }
  }
  driver.simctl = simctl;

  // NO STUB LOOP — see the note in web-playwright-driver.js. Nothing loads
  // this driver today, but the loop is the trap rather than the loading: if a
  // future change wires simctl back in, sixty-four declared-but-unimplemented
  // methods must fail loudly by name rather than silently returning false.

  // Real implementation: open named screen via deep-link.
  //
  // Calling convention: matchers pass the single screen identifier (e.g.,
  // "discovery", "wallet"). Earlier driver scaffolding used a two-arg
  // (persona, screen) signature that didn't match the matcher's actual
  // call, producing `shytalk://undefined` URLs and ~16 Blocker findings in
  // cycle 1. Single-arg form aligns with iosTap/androidOpenScreen.
  //
  // Caveat: the iOS app's Info.plist registers exactly one URL scheme
  // (the Google OAuth callback). There is no `shytalk://` scheme, so
  // simctl's openurl call will succeed at the shell level but the OS
  // surfaces a code=115 (LSApplicationWorkspaceErrorDomain) telling us
  // no app handles that scheme. We detect that and return a clear,
  // actionable error so the runner finding reads "deep-link unsupported,
  // use UI navigation" rather than a generic openurl failure.
  driver.iosOpenScreen = async (screen) => {
    try {
      // `2>&1` was shell redirection; stderr is captured directly instead so
      // no shell is needed and the udid cannot be interpreted as syntax.
      const out = String(
        execFileSync('/usr/bin/xcrun', ['simctl', 'openurl', udid, `shytalk://${screen}`], {
          ...execBounds(),
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
      if (/error 115|failed to open/i.test(out)) {
        console.error(
          `[ios-driver] iosOpenScreen(${screen}): shytalk:// scheme is not registered in Info.plist; ` +
            'use iosTapByTag-driven navigation instead of openurl',
        );
        return false;
      }
      return true;
    } catch (e) {
      console.error(`[ios-driver] iosOpenScreen(${screen}) failed: ${e.message}`);
      return false;
    }
  };

  // ── XCUITest remote-control bridge ─────────────────────────────────
  //
  // The runner sends JSON commands to /tmp/qa-cmd.jsonl inside the
  // simulator. A long-running XCUITest harness (see
  // iosApp/iosAppUITests/ManualQARemoteControl.swift) polls that file,
  // executes the command via XCUIApplication, and writes the result
  // to /tmp/qa-result.jsonl. We read it back via `simctl spawn cat`.
  //
  // Pre-requisite: the `iosAppUITests` UI testing bundle must be added
  // to the Xcode project AND running on the booted simulator before
  // these methods are called. Without it, every IPC call returns
  // false with a clear "harness not running" message.
  //
  // The bundle is launched outside the runner (typically by:
  //   xcodebuild test-without-building -workspace iosApp.xcworkspace \
  //     -scheme iosAppUITests \
  //     -destination 'platform=iOS Simulator,id=<UDID>'
  // ) so its lifetime is longer than any single scenario.
  async function sendXcuiCommand(payload, { timeoutMs = 8000 } = {}) {
    const json = JSON.stringify(payload);
    // Write command file inside the simulator.
    try {
      // The payload goes in on STDIN rather than through a bash heredoc, so
      // no host shell is involved and the JSON needs no escaping at all — the
      // previous form hand-escaped quotes into a `<<<` string, which is both
      // an injection surface and a corruption risk for any payload containing
      // a quote.
      execFileSync(
        '/usr/bin/xcrun',
        ['simctl', 'spawn', udid, 'sh', '-c', 'cat > /tmp/qa-cmd.jsonl'],
        { ...execBounds(), input: json },
      );
    } catch (e) {
      console.error(`[ios-driver] failed to write qa-cmd.jsonl: ${e.message}`);
      return null;
    }
    // Poll for result file existence + non-empty content.
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const out = String(
          execFileSync(
            '/usr/bin/xcrun',
            ['simctl', 'spawn', udid, 'sh', '-c', 'cat /tmp/qa-result.jsonl 2>/dev/null'],
            execBounds(),
          ),
        ).trim();
        if (out) {
          // Clear the result file so the next command's poll doesn't
          // see this one's payload again.
          try {
            execFileSync(
              '/usr/bin/xcrun',
              ['simctl', 'spawn', udid, 'sh', '-c', 'rm -f /tmp/qa-result.jsonl'],
              execBounds(),
            );
          } catch (_) {
            /* ignore */
          }
          return JSON.parse(out);
        }
      } catch (_) {
        /* still polling */
      }
      await new Promise((r) => setTimeout(r, 200)); // sleep-ok: poll interval, loop exits the instant the command answers
    }
    console.error(`[ios-driver] sendXcuiCommand timeout after ${timeoutMs}ms (op=${payload.op})`);
    return null;
  }
  driver._sendXcuiCommand = sendXcuiCommand;

  driver.iosTap = async (id) => {
    const r = await sendXcuiCommand({ op: 'tap', id });
    return r && r.ok === true;
  };
  driver.iosTapByTag = async (id) => driver.iosTap(id);

  driver.iosTypeText = async (id, text) => {
    const r = await sendXcuiCommand({ op: 'type', id, text });
    return r && r.ok === true;
  };

  driver.iosShowsText = async (text) => {
    const r = await sendXcuiCommand({ op: 'shows_text', text });
    return r && r.ok === true && r.data === 'true';
  };

  driver.iosUiDump = async () => {
    const r = await sendXcuiCommand({ op: 'dump', id: 'ui' });
    return r && r.ok === true ? r.data : '';
  };

  driver.close = async () => {
    /* simctl is stateless; nothing to release */
  };

  return driver;
}

module.exports = { createIosDriver, listMethods, selectUdid, IOS_METHOD_NAMES };
