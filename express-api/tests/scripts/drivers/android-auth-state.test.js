/**
 * classifyAndroidAuthState — pure-logic unit tests (SHY-0096, EPIC-0003 Phase 0)
 *
 * No-Stubs / Real-Only compliance: these fixtures are REAL uiautomator dumps
 * captured from the physical OnePlus CPH2653 (Android 16) on 2026-06-13 —
 * test DATA, not a mock collaborator. The classifier is a pure string→enum
 * function; the device/backend BEHAVIOUR it informs is proven on the real
 * gauntlet, not here. NO execSync mock is used.
 *
 * Fixtures (express-api/tests/scripts/drivers/fixtures/):
 *   - android-dump-picker.xml    — signed-out sign-in screen (persona_picker_open)
 *   - android-dump-legal-gate.xml — fresh-install legal acceptance (legal_continueButton)
 *   - android-dump-main.xml      — signed-in Rooms screen (main_roomsTab)
 *   - android-dump-splash.xml    — intro/splash screen (splash_continueButton)
 *   - android-dump-warning.xml   — moderation warning gate (warning_acknowledgeButton),
 *                                  captured 2026-06-13 on the OnePlus CPH2653 after
 *                                  androidSignOut switched to P-10 Theo (hasActiveWarning).
 *
 * The synthetic-tag cases below remain even with the real warning fixture in
 * place: they prove *precedence* (warning over signed_in, picker over signed_in),
 * which a single real dump can't — a real screen only ever shows one state at a
 * time, so the multi-tag tie-breaks need synthetic inputs.
 */

const fs = require('fs');
const path = require('path');
const { classifyAndroidAuthState } = require('../../../scripts/drivers/android-adb-driver');

const FX = path.join(__dirname, 'fixtures');
const fixture = (f) => fs.readFileSync(path.join(FX, f), 'utf8');

describe('classifyAndroidAuthState — real device-captured dumps', () => {
  // Value matrix: each real fixture → its exact expected classification.
  const cases = [
    ['android-dump-picker.xml', 'picker'],
    ['android-dump-legal-gate.xml', 'legal_gate'],
    ['android-dump-main.xml', 'signed_in'],
    ['android-dump-splash.xml', 'splash'],
    ['android-dump-warning.xml', 'warning'],
  ];
  test.each(cases)('fixture %s classifies as "%s"', (file, expected) => {
    expect(classifyAndroidAuthState(fixture(file))).toBe(expected);
  });
});

describe('classifyAndroidAuthState — branch + precedence (synthetic minimal dumps)', () => {
  const wrap = (tag) =>
    `<hierarchy><node resource-id="com.shyden.shytalk.local:id/${tag}" bounds="[0,0][1,1]" /></hierarchy>`;

  test('warning gate → "warning"', () => {
    expect(classifyAndroidAuthState(wrap('warning_acknowledgeButton'))).toBe('warning');
  });

  test('legal checkbox alone (no continue button yet) → "legal_gate"', () => {
    expect(classifyAndroidAuthState(wrap('legal_acceptTermsCheckbox'))).toBe('legal_gate');
  });

  test('signIn_googleButton alone (picker entry) → "picker"', () => {
    expect(classifyAndroidAuthState(wrap('signIn_googleButton'))).toBe('picker');
  });

  test('main_profileTab alone → "signed_in"', () => {
    expect(classifyAndroidAuthState(wrap('main_profileTab'))).toBe('signed_in');
  });

  test('splash intro → "splash"', () => {
    expect(classifyAndroidAuthState(wrap('splash_continueButton'))).toBe('splash');
  });

  // Precedence: a warning gate over a still-rendering splash must classify as
  // warning (the more-blocking state) so the caller signs out, not continues.
  test('warning + splash tags together → "warning" (warning takes precedence)', () => {
    const both = `<hierarchy>${wrap('warning_acknowledgeButton')}${wrap('splash_continueButton')}</hierarchy>`;
    expect(classifyAndroidAuthState(both)).toBe('warning');
  });

  // Precedence: a warning gate is shown OVER a signed-in session — it must win
  // so the caller signs out rather than treating the user as fully on main.
  test('warning + main tags together → "warning" (warning takes precedence)', () => {
    const both = `<hierarchy>${wrap('warning_acknowledgeButton')}${wrap('main_roomsTab')}</hierarchy>`;
    expect(classifyAndroidAuthState(both)).toBe('warning');
  });

  // Precedence: picker over signed_in (a stale main_* fragment must not mask a
  // visible picker on the sign-in screen).
  test('picker + main tags together → "picker" (picker takes precedence over signed_in)', () => {
    const both = `<hierarchy>${wrap('persona_picker_open')}${wrap('main_roomsTab')}</hierarchy>`;
    expect(classifyAndroidAuthState(both)).toBe('picker');
  });
});

describe('classifyAndroidAuthState — unknown / degenerate inputs', () => {
  test('empty hierarchy → "unknown"', () => {
    expect(classifyAndroidAuthState('<hierarchy></hierarchy>')).toBe('unknown');
  });
  test('empty string → "unknown"', () => {
    expect(classifyAndroidAuthState('')).toBe('unknown');
  });
  test('null → "unknown" (no throw)', () => {
    expect(classifyAndroidAuthState(null)).toBe('unknown');
  });
  test('undefined → "unknown" (no throw)', () => {
    expect(classifyAndroidAuthState(undefined)).toBe('unknown');
  });
  test('unrelated system-dialog dump → "unknown"', () => {
    expect(
      classifyAndroidAuthState(
        '<hierarchy><node resource-id="com.android.permissioncontroller:id/permission_allow_button" /></hierarchy>',
      ),
    ).toBe('unknown');
  });
});

/**
 * THE DEGRADED-MODE SCREEN — the state that cost a whole cell.
 *
 * Measured 2026-08-01. `app-android` produced 1 pass then 29 consecutive
 * failures, all "could not tap persona_picker_open". The classifier recognises
 * main by main_roomsTab / main_profileTab / main_settingsButton and returns
 * 'unknown' for anything else, and 'unknown' means "never act" — so no sign-out
 * ran and the next step tapped a button that was not on screen.
 *
 * What WAS on screen only became visible once the error reported evidence
 * instead of guesses:
 *
 *   Observed state: "unknown"
 *   testTags currently on screen: degraded_title, degraded_acknowledgeButton
 *
 * That is `DegradedModeScreen.kt`, a real product screen shown when the backend
 * is unreachable — which, on a device whose reverse tunnels have dropped, is
 * every launch. A screen the harness cannot name is a screen it cannot leave.
 */
describe('classifyAndroidAuthState — degraded mode', () => {
  test('recognises the degraded screen by its acknowledge button', () => {
    expect(
      classifyAndroidAuthState('<node resource-id="com.x:id/degraded_acknowledgeButton"/>'),
    ).toBe('degraded');
  });

  test('recognises it by its title too, so a mid-render dump still classifies', () => {
    expect(classifyAndroidAuthState('<node resource-id="com.x:id/degraded_title"/>')).toBe(
      'degraded',
    );
  });

  test('degraded wins over signed_in — the gate is ON TOP of the session', () => {
    // Same precedence reason as `warning`: the session may well be valid, but
    // nothing beneath the gate is reachable until it is cleared.
    const dump = '<node resource-id="a/degraded_title"/><node resource-id="a/main_roomsTab"/>';
    expect(classifyAndroidAuthState(dump)).toBe('degraded');
  });

  test("the sign-in screen's OWN unreachable state is degraded, not unknown", () => {
    // There are TWO backend-unreachable screens, and the classifier only knew
    // one. `SignInScreen.kt` renders its own "Unable to Connect" with a
    // `signIn_retryConnection` button — no `degraded_*` tag anywhere on it — so
    // it fell through to `unknown`, whose documented contract is "never acts".
    //
    // Observed 2026-08-02: the gauntlet's pre-flight refused to start with
    // "the Android app is not on a sign-in-capable screen", and every recovery
    // path declined to touch it because `unknown` means wait-and-re-dump.
    //
    // What actually puts the app there is a STALE SESSION, not a network fault.
    // AuthViewModel.retryConnection() only sets isBackendUnreachable while
    // `authRepository.isAuthenticated`; after an emulator restart the signed-in
    // user no longer exists, so its calls fail and the app reports the failure
    // as connectivity. Both device and host could reach :3000 (HTTP 200) the
    // whole time.
    expect(classifyAndroidAuthState('<node resource-id="com.x:id/signIn_retryConnection"/>')).toBe(
      'degraded',
    );
  });

  test('degraded outranks picker when the sign-in screen shows its error', () => {
    // The retry screen IS the sign-in screen, so `signIn_googleButton` can be
    // in the same tree. Classifying that as `picker` would send the driver
    // tapping `persona_picker_open` on a screen that cannot open a dialog.
    const dump =
      '<node resource-id="a/signIn_googleButton"/><node resource-id="a/signIn_retryConnection"/>';
    expect(classifyAndroidAuthState(dump)).toBe('degraded');
  });

  test('a moderation warning still outranks degraded', () => {
    // Warning is the more specific gate and has its own acknowledge flow.
    const dump =
      '<node resource-id="a/warning_acknowledgeButton"/><node resource-id="a/degraded_title"/>';
    expect(classifyAndroidAuthState(dump)).toBe('warning');
  });

  test('the picker still classifies as picker when no gate is present', () => {
    // Guard against the new branch swallowing the state it sits next to.
    expect(classifyAndroidAuthState('<node resource-id="a/persona_picker_open"/>')).toBe('picker');
  });

  test('a dump merely MENTIONING degradation is not the degraded screen', () => {
    // Anchored on testTags, never on prose: a room named "degraded" must not
    // send the driver into a recovery flow.
    expect(classifyAndroidAuthState('<node text="service degraded"/>')).toBe('unknown');
  });
});

/**
 * `androidShowsUserCard` must identify WHOSE card is open.
 *
 * Operator 2026-08-01: "fix the assertions and make sure they're doing the
 * right thing. 'it appears' isn't good enough."
 *
 * It used to be `async (_name, _target) => /userCard_/.test(dump)` — it took
 * the target and checked only that SOME card was on screen. It passed on the
 * wrong user's card, and on a card left open by an earlier step.
 *
 * The product now tags the sheet `userCard_${user.uniqueId}` (UserCardPopup.kt)
 * so the subject is checkable, and the runner resolves the persona name to that
 * id — a display name is neither unique nor stable, since a room alias replaces
 * it on screen.
 */
describe('androidShowsUserCard — identifies its subject', () => {
  const { createAndroidDriver } = require('../../../scripts/drivers/android-adb-driver');
  const dumpFor = (id) =>
    `<node resource-id="com.shyden.shytalk.local:id/userCard_${id}" bounds="[0,0][100,100]" />`;

  function driverWithDump(dump) {
    return createAndroidDriver({ serial: 'test' }).then((d) => {
      d.androidUiDump = async () => dump;
      return d;
    });
  }

  test('true for the card that IS the target', async () => {
    const d = await driverWithDump(dumpFor('50000010'));
    expect(await d.androidShowsUserCard('Bea', '50000010')).toBe(true);
  });

  test('FALSE for a different user’s card — the whole point', async () => {
    const d = await driverWithDump(dumpFor('50000099'));
    expect(await d.androidShowsUserCard('Bea', '50000010')).toBe(false);
  });

  test('a prefix does not satisfy a longer id', async () => {
    // `userCard_5000001` must not answer an assertion about `userCard_50000010`
    // — the anchored closing quote is what prevents it.
    const d = await driverWithDump(dumpFor('5000001'));
    expect(await d.androidShowsUserCard('Bea', '50000010')).toBe(false);
  });

  test('false when no card is open at all', async () => {
    const d = await driverWithDump('<node resource-id="a/main_roomsTab" />');
    expect(await d.androidShowsUserCard('Bea', '50000010')).toBe(false);
  });

  test('false when given no target, rather than passing vacuously', async () => {
    const d = await driverWithDump(dumpFor('50000010'));
    for (const bad of [undefined, null, '']) {
      expect(await d.androidShowsUserCard('Bea', bad)).toBe(false);
    }
  });
});

/**
 * The private-chat assertions checked the INPUT BOX, not the messages.
 *
 * All three of these read `privateChat_messageInput` — the text field you type
 * into. So "shows the message in the thread" returned true on an EMPTY
 * conversation with the keyboard up, which is the precise opposite of the claim.
 *
 * The product now tags each bubble `privateChat_msg_<sent|recv>_<messageId>`
 * (PrivateMessageBubble.kt), carrying identity and direction.
 */
describe('private-chat assertions check messages, not the input box', () => {
  const { createAndroidDriver } = require('../../../scripts/drivers/android-adb-driver');
  const INPUT_ONLY = '<node resource-id="com.x:id/privateChat_messageInput" bounds="[0,0][9,9]" />';
  const sent = (id) =>
    `<node resource-id="com.x:id/privateChat_msg_sent_${id}" bounds="[0,0][9,9]" />`;
  const recv = (id) =>
    `<node resource-id="com.x:id/privateChat_msg_recv_${id}" bounds="[0,0][9,9]" />`;

  const withDump = (dump) =>
    createAndroidDriver({ serial: 'test' }).then((d) => {
      d.androidUiDump = async () => dump;
      return d;
    });

  test('an empty thread is NOT a thread with a message — the original bug', async () => {
    const d = await withDump(INPUT_ONLY);
    expect(await d.androidShowsMessageInConversationThread('Adam')).toBe(false);
    expect(await d.androidShowsInThread('Adam', 'message', '')).toBe(false);
  });

  test('a real message bubble satisfies it', async () => {
    const d = await withDump(INPUT_ONLY + recv('m1'));
    expect(await d.androidShowsMessageInConversationThread('Adam')).toBe(true);
  });

  test('"with sent indicator" requires the SENDER\'s own message', async () => {
    // j07: "shows the message in the thread with timestamp + sent indicator" is
    // a claim about the sender's view. A received message must not satisfy it.
    const received = await withDump(INPUT_ONLY + recv('m1'));
    expect(
      await received.androidShowsInThread('Adam', 'message', 'with timestamp + sent indicator'),
    ).toBe(false);
    const ownMessage = await withDump(INPUT_ONLY + sent('m1'));
    expect(
      await ownMessage.androidShowsInThread('Adam', 'message', 'with timestamp + sent indicator'),
    ).toBe(true);
  });

  test('layout direction is actually compared, not assumed', async () => {
    // This asserted RTL by checking that a text field existed, so it passed on
    // an LTR screen — the exact locale bug j13 exists to catch.
    const ltr = await withDump('<node resource-id="a/x" bounds="[0,0][100,50]" />');
    ltr.androidUiDump = async () =>
      '<hierarchy rotation="0"><node bounds="[0,0][100,50]" /></hierarchy>';
    expect(await ltr.androidShowsPmThreadDirection('Lena', 'rtl')).toBe(false);
  });

  test('an unrecognised direction is refused rather than assumed true', async () => {
    const d = await withDump(INPUT_ONLY);
    for (const bad of ['', null, undefined, 'sideways']) {
      expect(await d.androidShowsPmThreadDirection('Lena', bad)).toBe(false);
    }
  });
});

/**
 * `androidShowsInResults` must name the person it is looking for.
 *
 * It was `(_name, _query, _target) => /searchResults_/.test(dump)` — a check
 * for a container the product does not render at all. So it could only ever
 * return false: every "shows X in the results" step failed, blaming the app for
 * a search that had actually worked.
 *
 * NewMessageScreen now tags each row `newMessage_result_<uniqueId>`.
 */
describe('androidShowsInResults — names its subject', () => {
  const { createAndroidDriver } = require('../../../scripts/drivers/android-adb-driver');
  const row = (id, name) =>
    `<node resource-id="com.x:id/newMessage_result_${id}" text="${name || ''}" bounds="[0,0][9,9]" />`;
  const withDump = (dump) =>
    createAndroidDriver({ serial: 'test' }).then((d) => {
      d.androidUiDump = async () => dump;
      return d;
    });

  test('true when the target is in the results', async () => {
    const d = await withDump(row('50000010', 'Alice'));
    expect(await d.androidShowsInResults('Adam', '50000010', null)).toBe(true);
  });

  test('FALSE when the search returned someone else', async () => {
    // The case the old version could not distinguish, because it never looked
    // at who was in the list.
    const d = await withDump(row('50000099', 'Vexa'));
    expect(await d.androidShowsInResults('Adam', '50000010', null)).toBe(false);
  });

  test('FALSE when the results are empty', async () => {
    const d = await withDump('<node resource-id="com.x:id/newMessage_searchField" />');
    expect(await d.androidShowsInResults('Adam', '50000010', null)).toBe(false);
  });

  test('a displayName in the step is asserted, not decoration', async () => {
    // A search that finds the right uid but renders a stale or blank name is a
    // real defect, and the step says so — so it must fail.
    const rightIdBlankName = await withDump(row('50000010', ''));
    expect(await rightIdBlankName.androidShowsInResults('Adam', '50000010', 'Alice')).toBe(false);
    const rightIdRightName = await withDump(row('50000010', 'Alice'));
    expect(await rightIdRightName.androidShowsInResults('Adam', '50000010', 'Alice')).toBe(true);
  });

  test('a shorter id does not satisfy a longer one', async () => {
    const d = await withDump(row('5000001', 'Alice'));
    expect(await d.androidShowsInResults('Adam', '50000010', null)).toBe(false);
  });

  test('no target is refused rather than passing vacuously', async () => {
    const d = await withDump(row('50000010', 'Alice'));
    for (const bad of [undefined, null, '']) {
      expect(await d.androidShowsInResults('Adam', bad, null)).toBe(false);
    }
  });
});

/**
 * `androidShowsEditedBodyWithTag` — both halves of the claim.
 *
 * j07: `shows the edited body "typo here" with an "edited" tag`. Two claims,
 * and both matter: the new text having replaced the old, AND the edit being
 * disclosed. An edit that silently rewrites history without the marker is a
 * moderation problem, not a cosmetic one.
 *
 * It used to check `editedBody_`, which the product never renders — so it
 * always returned false and every message-edit scenario blamed the app.
 */
describe('androidShowsEditedBodyWithTag — body AND disclosure', () => {
  const { createAndroidDriver } = require('../../../scripts/drivers/android-adb-driver');
  const withDump = (dump) =>
    createAndroidDriver({ serial: 'test' }).then((d) => {
      d.androidUiDump = async () => dump;
      return d;
    });
  const bodyNode = (t) => `<node text="${t}" bounds="[0,0][9,9]" />`;
  const marker = '<node resource-id="com.x:id/privateChat_edited_m1" text="Edited (1)" />';

  test('true when the new body is shown AND the edit is disclosed', async () => {
    const d = await withDump(bodyNode('typo here') + marker);
    expect(await d.androidShowsEditedBodyWithTag('Alice', 'typo here', 'edited')).toBe(true);
  });

  test('FALSE when the body is right but the edit is NOT disclosed', async () => {
    // The silent-rewrite case. This is the one that matters most and the one
    // the old implementation was structurally incapable of catching.
    const d = await withDump(bodyNode('typo here'));
    expect(await d.androidShowsEditedBodyWithTag('Alice', 'typo here', 'edited')).toBe(false);
  });

  test('FALSE when the edit marker is there but the body never changed', async () => {
    const d = await withDump(bodyNode('the original text') + marker);
    expect(await d.androidShowsEditedBodyWithTag('Alice', 'typo here', 'edited')).toBe(false);
  });

  test('the rendered label satisfies disclosure when no marker tag is present', async () => {
    // Web and older builds render `Edited (1)` without a per-message tag.
    const d = await withDump(bodyNode('typo here') + '<node text="Edited (1)" />');
    expect(await d.androidShowsEditedBodyWithTag('Alice', 'typo here', 'Edited')).toBe(true);
  });

  test('an empty body is refused rather than matching everything', async () => {
    const d = await withDump(bodyNode('anything') + marker);
    for (const bad of ['', '   ', null, undefined]) {
      expect(await d.androidShowsEditedBodyWithTag('Alice', bad, 'edited')).toBe(false);
    }
  });
});

/**
 * `androidShowsCountBadge` reads the NAMED count.
 *
 * It was `(_name, _delta, _label) => /countBadge_/.test(dump)` — a tag the
 * product never renders, so it always returned false.
 *
 * HONEST SCOPE, pinned here so nobody later mistakes it for a delta check:
 * "shows a +1 in the Followers count" is a difference, and a difference needs a
 * before and an after. One dump has only the after. So this asserts what the
 * after can support — the named count is on screen, renders a number, and that
 * number is at least the delta. A true delta needs the runner to capture a
 * baseline first.
 */
describe('androidShowsCountBadge — reads the named count', () => {
  const { createAndroidDriver } = require('../../../scripts/drivers/android-adb-driver');
  const withDump = (dump) =>
    createAndroidDriver({ serial: 'test' }).then((d) => {
      d.androidUiDump = async () => dump;
      return d;
    });
  const col = (label, value) =>
    `<node resource-id="com.x:id/profile_count_${label}"><node text="${value}" /><node text="${label}" /></node>`;

  test('true when the named count is present and plausible', async () => {
    const d = await withDump(col('followers', '12'));
    expect(await d.androidShowsCountBadge('Alice', 1, 'Followers')).toBe(true);
  });

  test('FALSE when the count named by the step is not on screen', async () => {
    // Only "following" is rendered; the step asks about "followers".
    const d = await withDump(col('following', '12'));
    expect(await d.androidShowsCountBadge('Alice', 1, 'Followers')).toBe(false);
  });

  test('FALSE when the count is blank or a dash', async () => {
    // `Following (Private)` renders "-". A count that is not a number cannot
    // have been incremented, and the old check could not tell.
    for (const v of ['', '-', 'n/a']) {
      const d = await withDump(col('followers', v));
      expect(await d.androidShowsCountBadge('Alice', 1, 'Followers')).toBe(false);
    }
  });

  test('FALSE when the count is too small for the claimed increase', async () => {
    // "+3" cannot have happened on a counter reading 1.
    const d = await withDump(col('followers', '1'));
    expect(await d.androidShowsCountBadge('Alice', 3, 'Followers')).toBe(false);
  });

  test('a missing label or delta is refused, not assumed', async () => {
    const d = await withDump(col('followers', '12'));
    expect(await d.androidShowsCountBadge('Alice', 1, '')).toBe(false);
    expect(await d.androidShowsCountBadge('Alice', Number.NaN, 'Followers')).toBe(false);
  });

  test('stalkers delegates to the same check against its own count', async () => {
    const present = await withDump(col('stalkers', '4'));
    expect(await present.androidShowsStalkersDelta('Bea', 2)).toBe(true);
    const absent = await withDump(col('followers', '4'));
    expect(await absent.androidShowsStalkersDelta('Bea', 2)).toBe(false);
  });
});

/**
 * The toast assertions check the MESSAGE and the DESTINATION.
 *
 * `androidShowsToastAndNavigates` took four arguments and used none, checking
 * `toastWithRoute_` — never rendered. It could only return false.
 *
 * The step makes two claims and both matter: a toast with no navigation strands
 * the user, navigation with no toast leaves them wondering what happened.
 */
describe('toast assertions — message AND destination', () => {
  const { createAndroidDriver } = require('../../../scripts/drivers/android-adb-driver');
  const withDump = (dump) =>
    createAndroidDriver({ serial: 'test' }).then((d) => {
      d.androidUiDump = async () => dump;
      return d;
    });
  const toast = (msg) => `<node resource-id="com.x:id/app_toast" text="${msg}" />`;
  const roomsList = '<node resource-id="com.x:id/main_roomsTab" />';

  test('true when the right toast is shown AND the destination is reached', async () => {
    const d = await withDump(toast('Room closed by host') + roomsList);
    expect(await d.androidShowsToastAndNavigates('Ines', 'Room closed by host', 'rooms list')).toBe(
      true,
    );
  });

  test('FALSE when the toast is right but the user never left', async () => {
    // Stranded: the message appeared and nothing happened.
    const d = await withDump(
      toast('Room closed by host') + '<node resource-id="com.x:id/room_seatGrid" />',
    );
    expect(await d.androidShowsToastAndNavigates('Ines', 'Room closed by host', 'rooms list')).toBe(
      false,
    );
  });

  test('FALSE when navigation happened with NO toast', async () => {
    // The user is moved with no explanation — the other half of the bug.
    const d = await withDump(roomsList);
    expect(await d.androidShowsToastAndNavigates('Ines', 'Room closed by host', 'rooms list')).toBe(
      false,
    );
  });

  test('FALSE when a toast is shown but says something else', async () => {
    const d = await withDump(toast('Network error') + roomsList);
    expect(await d.androidShowsToastAndNavigates('Ines', 'Room closed by host', 'rooms list')).toBe(
      false,
    );
  });

  test('an unknown route is FALSE, not assumed true', async () => {
    // "I do not know how to check this" is not "it passed".
    const d = await withDump(toast('Room closed by host') + roomsList);
    expect(
      await d.androidShowsToastAndNavigates('Ines', 'Room closed by host', 'somewhere unmapped'),
    ).toBe(false);
  });

  test('navigatesBack shares the same contract', async () => {
    const good = await withDump(toast('Room closed by host') + roomsList);
    expect(
      await good.androidShowsToastAndNavigatesBack('Ines', 'Room closed by host', 'rooms list'),
    ).toBe(true);
    const noToast = await withDump(roomsList);
    expect(
      await noToast.androidShowsToastAndNavigatesBack('Ines', 'Room closed by host', 'rooms list'),
    ).toBe(false);
  });
});

/**
 * The official badge — implemented, then asserted.
 *
 * `androidShowsOfficialBadge` checked `officialBadge_`, which nothing rendered,
 * because THE BADGE DID NOT EXIST. The assertion had been written for a feature
 * nobody built, so it failed forever and the scenario blamed the app.
 *
 * It matters beyond tidiness: a system message carries real authority — age
 * decisions, suspensions, safety notices. Without a visible marker, any user who
 * names themselves "ShyTalk Official" is indistinguishable from the real thing.
 * So the badge is driven by the message TYPE, never by a display name, since a
 * name is exactly what an impersonator controls.
 */
describe('androidShowsOfficialBadge — a badge that now exists', () => {
  const { createAndroidDriver } = require('../../../scripts/drivers/android-adb-driver');
  const withDump = (dump) =>
    createAndroidDriver({ serial: 'test' }).then((d) => {
      d.androidUiDump = async () => dump;
      return d;
    });
  const badge = '<node resource-id="com.x:id/privateChat_officialBadge" text="Official" />';
  const from = (who) => `<node text="${who}" />`;

  test('true when the badge is rendered', async () => {
    const d = await withDump(badge);
    expect(await d.androidShowsOfficialBadge('Hayato', null)).toBe(true);
  });

  test('FALSE when no badge is present — an ordinary message must not pass', async () => {
    const d = await withDump('<node resource-id="com.x:id/privateChat_msg_recv_m1" text="hi" />');
    expect(await d.androidShowsOfficialBadge('Hayato', null)).toBe(false);
  });

  test('when the step names a sender, that sender must be on screen', async () => {
    const right = await withDump(badge + from('ShyTalk Official'));
    expect(await right.androidShowsOfficialBadge('Hayato', 'ShyTalk Official')).toBe(true);
    const wrongConversation = await withDump(badge + from('Vexa'));
    expect(await wrongConversation.androidShowsOfficialBadge('Hayato', 'ShyTalk Official')).toBe(
      false,
    );
  });
});

/**
 * `androidShowsInAppGiftNotification` — both names, or it is not the claim.
 *
 * It checked `giftNotification_`, a tag nothing rendered, because THE FEATURE
 * DID NOT EXIST: a gift arriving while the app was open produced nothing.
 * SHY-0266 built it; this asserts it.
 */
describe('androidShowsInAppGiftNotification — sender AND gift', () => {
  const { createAndroidDriver } = require('../../../scripts/drivers/android-adb-driver');
  const withDump = (dump) =>
    createAndroidDriver({ serial: 'test' }).then((d) => {
      d.androidUiDump = async () => dump;
      return d;
    });
  const banner = (text) => `<node resource-id="com.x:id/app_toast" text="${text}" />`;

  test('true when the banner names the sender and the gift', async () => {
    const d = await withDump(banner('Alice sent you a crown'));
    expect(await d.androidShowsInAppGiftNotification('Selma', 'Alice', 'crown')).toBe(true);
  });

  test('FALSE when the gift is named but the sender is not', async () => {
    // Being seen is the whole value of gifting to the sender, so an anonymous
    // banner is a real defect rather than a cosmetic one.
    const d = await withDump(banner('You received a crown'));
    expect(await d.androidShowsInAppGiftNotification('Selma', 'Alice', 'crown')).toBe(false);
  });

  test('FALSE when the sender is named but the gift is not', async () => {
    const d = await withDump(banner('Alice sent you something'));
    expect(await d.androidShowsInAppGiftNotification('Selma', 'Alice', 'crown')).toBe(false);
  });

  test('FALSE when no banner is on screen at all', async () => {
    const d = await withDump('<node resource-id="com.x:id/main_roomsTab" />');
    expect(await d.androidShowsInAppGiftNotification('Selma', 'Alice', 'crown')).toBe(false);
  });

  test('FALSE when the names appear but NOT in a banner', async () => {
    // "Alice" and "crown" elsewhere on screen — a conversation list, a gift
    // wall — must not satisfy an assertion about a notification.
    const d = await withDump('<node text="Alice sent you a crown" />');
    expect(await d.androidShowsInAppGiftNotification('Selma', 'Alice', 'crown')).toBe(false);
  });

  test('a missing argument is refused rather than passing vacuously', async () => {
    const d = await withDump(banner('Alice sent you a crown'));
    expect(await d.androidShowsInAppGiftNotification('Selma', '', 'crown')).toBe(false);
    expect(await d.androidShowsInAppGiftNotification('Selma', 'Alice', '')).toBe(false);
  });
});
