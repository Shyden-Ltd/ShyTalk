/**
 * A driver may not look for a testTag the product never renders.
 *
 * Operator 2026-08-01: "viewing a screen isn't enough, you need to test the
 * functionalities behave as expected" / "there's definitely gaps in the app
 * testing... you need to find and fill them".
 *
 * THE FAILURE MODE. `androidCreateRoomComposite` tapped `rooms_create` and then
 * `room_confirmCreate`. Neither string appears anywhere in `shared/src`. The
 * product renders `main_createRoomFab` and `createRoom_confirmButton`. So the
 * taps missed, the room was never created, and every room-creation scenario was
 * recorded as a PRODUCT defect — for years of runs, pointing at the app.
 *
 * This is the exact mirror of the phantom FIELD problem closed this morning:
 *   - a phantom field is WRITTEN and nothing reads it  → the scenario asserts
 *     nothing and passes.
 *   - a phantom tag is READ and nothing renders it     → the scenario fails and
 *     blames the product.
 * One manufactures false confidence, the other manufactures false defects.
 * Both come from the harness inventing a name and never checking.
 *
 * THE RULE IS DELIBERATELY WEAK, as with the field registry: a tag is fine if
 * it appears ANYWHERE in the product's rendered tags. That cannot false-positive
 * on a real tag, needs no curated list, and does not go stale as screens grow.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const DRIVERS = path.join(REPO, 'express-api/scripts/drivers');

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/^(build|node_modules|\.git)$/.test(e.name)) continue;
      walk(p, exts, out);
    } else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

/** Every testTag / accessibility identifier the product actually renders. */
let cached = null;
function productTags() {
  if (cached) return cached;
  const tags = new Set();
  for (const f of walk(path.join(REPO, 'shared/src'), ['.kt'])) {
    const src = fs.readFileSync(f, 'utf8');
    // `testTag("literal")` — the common form.
    for (const m of src.matchAll(/testTag\("([^"]+)"\)/g)) {
      // `roomList_roomCard_${room.roomId}` — the interpolation is per-instance;
      // the stable part is what a driver can match on.
      tags.add(m[1].replace(/\$\{[^}]*\}/g, '').replace(/\$\w+/g, ''));
    }
    // A tag PASSED INTO a shared composable is still a rendered tag. The four
    // legal checkboxes are declared `checkboxTestTag = "legal_acceptTermsCheckbox"`
    // and applied inside the shared row, so the call-form scan above never saw
    // them — and a first version of the corpus check below duly reported four
    // perfectly real, on-screen controls as phantom. The driver classifies live
    // devices off `legal_acceptTermsCheckbox` every run, which is exactly the
    // contradiction that gives this away: measure the code, not one of its
    // shapes.
    // The identifier is matched as ONE unambiguous token and the
    // "…TestTag"-ness decided in JS. Writing it as `[A-Za-z]*[Tt]estTag[A-Za-z]*`
    // puts two unbounded quantifiers either side of the literal, which can split
    // a long identifier many ways — sonarjs/slow-regex flags it, correctly.
    for (const m of src.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s*=\s*"([^"]+)"/g)) {
      if (!/testtag$/i.test(m[1])) continue;
      tags.add(m[2].replace(/\$\{[^}]*\}/g, '').replace(/\$\w+/g, ''));
    }
    // A tag chosen by a CONDITIONAL is still a rendered tag. One control can do
    // two jobs — the private-chat send button becomes `pm_confirmEdit` while an
    // edit is in flight — and a pattern that only understood a bare literal
    // reported BOTH of its tags as never rendered. The scanner has to describe
    // the code, not one of its shapes.
    for (const m of src.matchAll(/testTag\(\s*(?:\n|.){0,400}?\)\s*,/g)) {
      const chunk = m[0];
      if (!/\bif\s*\(|\bwhen\s*[({]/.test(chunk)) continue;
      for (const lit of chunk.matchAll(/"([A-Za-z][A-Za-z0-9_]*)"/g)) {
        tags.add(lit[1].replace(/\$\{[^}]*\}/g, '').replace(/\$\w+/g, ''));
      }
    }
  }
  for (const f of walk(path.join(REPO, 'iosApp'), ['.swift'])) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/accessibilityIdentifier\s*=\s*"([^"]+)"/g))
      tags.add(m[1]);
  }
  cached = tags;
  return tags;
}

/**
 * Tags a driver TAPS or WAITS FOR by exact name.
 *
 * Only the call-by-name forms, never a regex fragment: extracting an identifier
 * out of `resource-id="(?:[^"]*:id\/)?roomList_roomCard_[^"]*"` produced
 * `roomCard_` in a first attempt at this check and reported a perfectly correct
 * tag as phantom. A guard that cries wolf gets deleted.
 */
function tagsUsedByName() {
  const found = new Map();
  const CALLS =
    /(?:androidTapByTag|iosTapByTag|webTapByTag|waitForTag|xcuiIdentifierPresent)\(\s*'([^']+)'/g;
  for (const f of walk(DRIVERS, ['.js'])) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(CALLS)) {
      if (!found.has(m[1])) found.set(m[1], new Set());
      found.get(m[1]).add(path.basename(f));
    }
  }
  return found;
}

/** A driver tag is present if the product renders it, or a tag starting with it. */
function renderedByProduct(tag) {
  const tags = productTags();
  if (tags.has(tag)) return true;
  for (const p of tags) if (p.startsWith(tag) || tag.startsWith(p)) return true;
  return false;
}

/**
 * FROZEN 2026-08-01. May only SHRINK.
 *
 * Each is a tag a driver taps that the product does not render. Two different
 * causes, and they need different fixes — which is why they are listed rather
 * than silently allowed:
 *
 *   - the FEATURE is not instrumented: the screen exists but has no testTag, so
 *     the fix is to add one to the Compose source.
 *   - the FEATURE does not exist: the scenario is describing something unbuilt,
 *     and the honest fix is `@unimplemented` or deleting the step.
 *
 * Either way the current state is a scenario that fails and blames the product.
 */
const KNOWN_PHANTOM_TAGS = [
  // Debug affordances a release build deliberately does not ship. The shared
  // methods that reach for these fall back to a real alternative (a cold
  // relaunch) or report `supported: false` with a reason — they never answer
  // "the product is broken" because a debug hook is absent.
  'debug_forceRefreshJwt',
  'debug_performAuthedCall',
  // An OS permission dialog, not our UI. There is nothing for the product to
  // tag; it belongs to Android's permission controller.
  'permission_allow_foreground_only_button',
  // Controls the product genuinely has not built. VERIFIED 2026-08-02 by
  // searching shared/src for the screens themselves, not just the tags: there is
  // no email-signup screen (signin_signUpLink, signup_dobPicker), no ID-upload
  // screen (idUpload_gallery), no purchase-retry path (wallet_retryPurchase) and
  // no followed-users picker. Each is a real feature gap, not a naming one.
  //
  // That distinction is the point of checking. Seven names left this list on the
  // same day and NONE of them was unbuilt — they were built and untagged, which
  // reads identically in a dump.
  //
  // The rooms refresh was the clearest case: the driver's own comment said
  // "there is no refresh CONTROL in the product", and HomeScreen has had a
  // PullToRefreshBox the whole time. It was a gesture rather than a button, so a
  // search for a tappable tag found nothing and concluded wrongly.
  'followedPicker',
  'idUpload_gallery',
  'signin_signUpLink',
  'signup_dobPicker',
  'wallet_retryPurchase',

  // ── Found 2026-08-02 by the CORPUS scan below, which is new. ────────────────
  //
  // These were never invisible to the run — 14 of them failed on
  // 20260802-134434-local — but nothing STOPPED more being added, because the
  // driver-side scan above cannot see a tag that only exists as a step
  // argument. They are frozen here so the door is shut while they are worked
  // through; each is classified, because the class determines the fix and
  // guessing it is how `rooms_refresh` got wrongly called unbuilt for months.
  //
  // DRIFT — all six FIXED 2026-08-02 by renaming in the corpus, each verified
  // against the Compose source that renders it rather than by name similarity:
  //   google_sign_in_button    → signIn_googleButton      GoogleSignInButton.kt
  //   apple_sign_in_button     → signIn_appleButton       AppleSignInButton.kt
  //   conversation_inputField  → privateChat_messageInput PrivateChatScreen.kt
  //   pm_frozen_notice         → privateChat_pmLockedNotice
  //   pm_newConversationButton → main_newMessageFab       (onNavigateToNewMessage)
  //   room_closed_notice       → roomClosedSummary_panel  RoomClosedSummaryPanel.kt
  //
  // UNTAGGED — the FEATURE exists, the control just carries no testTag. Fix is
  // one line of Compose, not a corpus edit. Verified by searching for the
  // screens rather than the tags: Gacha is mentioned in 26 shared/src files and
  // AgeVerification in 9, so "the tag is missing" and "the feature is missing"
  // are very different statements here.
  'gacha_pull3Button',
  'main_gachaTab',
  'profile_ageVerificationEntry',
  'ageVerification_submitButton',
  'sendGift_confirmButton',
  'pm_send_button',
  'room_rejoin_button',
  //
  // UNBUILT — no such screen. `ScheduleEvent`, `Lesson` and `Classroom` match
  // ZERO files under shared/src/commonMain; the event-host feature that does
  // exist is `eventHost_*` and has no scheduling UI. The honest fix is
  // `@unimplemented` on the scenario or deleting the step, NOT a testTag.
  //
  // `wallet_sendGiftButton` was on the DRIFT list until it was checked properly.
  // It is not a rename: j01 walks wallet → send-gift → confirm, and the only
  // gift-send control in the app is `gift_send` inside BackpackSheet.kt, which
  // is a ROOM feature. The wallet screen has no gift entry at all
  // (wallet_balance / wallet_buyCoinsButton / wallet_transactionsButton). j05
  // runs the same flow on WEB via `/wallet#send-gift`, so the app is the side
  // that lacks it. Renaming it to gift_send would have made the scenario lie
  // about which flow it exercises.
  'wallet_sendGiftButton',
  'schedule_newEventButton',
  'scheduleEvent_confirmButton',
  'schedule_newLessonButton',
  'scheduleLesson_confirmButton',
  'signup_emailField',
  'signup_passwordField',
  'signup_createAccountButton',
  //
  // CORRECT BY ABSENCE — j20 asserts these are NOT shown, and they are not.
  // The single-account "Dev Sign-In" shortcut was removed 2026-06-01 (see
  // BuildVariant.isDevAffordancesVisible); `reject_and_dob_down` is an admin
  // ACTION name that reached a UI-tag step by mistake. Both still belong on
  // this list: a negative assertion against a tag that exists nowhere passes
  // without testing anything, which is the j02 age-verification trap.
  'dev_sign_in',
  'reject_and_dob_down',
];

describe('the scan is real', () => {
  it('reads a substantial product tag inventory', () => {
    // A vacuous scan would make every tag look phantom, or none.
    expect(productTags().size).toBeGreaterThan(100);
  });

  it('finds tags the drivers tap by name', () => {
    expect(tagsUsedByName().size).toBeGreaterThan(20);
  });

  it('recognises a real product tag as present', () => {
    expect(renderedByProduct('main_createRoomFab')).toBe(true);
    expect(renderedByProduct('createRoom_confirmButton')).toBe(true);
    expect(renderedByProduct('privateChat_messageInput')).toBe(true);
  });

  it('recognises an invented tag as absent', () => {
    // The four that were actually in the drivers until today.
    expect(renderedByProduct('rooms_create')).toBe(false);
    expect(renderedByProduct('room_confirmCreate')).toBe(false);
    expect(renderedByProduct('pm_sendButton')).toBe(false);
    expect(renderedByProduct('pm_messageInput')).toBe(false);
  });

  it('does not flag an interpolated tag as phantom', () => {
    // `roomList_roomCard_${room.roomId}` is rendered per room; a driver
    // matching the stable prefix is correct, and an earlier version of this
    // check called it phantom.
    expect(renderedByProduct('roomList_roomCard_')).toBe(true);
  });
});

/**
 * Tags the CORPUS names, which no driver file ever mentions.
 *
 * This is the hole the driver-side scan above could not see. A step like
 *
 *     When Adam on the app taps "pm_newConversationButton"
 *
 * carries the tag as DATA into a generic matcher, so it appears in no `.js`
 * file and `tagsUsedByName()` is blind to it. Measured on run
 * 20260802-134434-local: 14 of the app phase's findings were corpus tags the
 * product has never rendered — `google_sign_in_button` (the app renders
 * `signIn_googleButton`), `conversation_inputField` (it is
 * `privateChat_messageInput`), and so on.
 *
 * Worse than failing: j02 asserts a minor "does NOT show
 * profile_ageVerificationEntry". A tag that exists NOWHERE can never show, so
 * that scenario passes without testing anything.
 *
 * CONSERVATIVE ON PURPOSE. `taps "X"` is overloaded — the driver falls back to
 * tapping visible TEXT, so `taps "Kick"` is a label, not a tag. Only the
 * unambiguous `with tag "X"` form is taken as-is; the overloaded forms are
 * accepted only when the literal looks like this codebase's tag convention
 * (lowercase start, an underscore). A guard that cries wolf gets deleted — the
 * note above `tagsUsedByName` was written after exactly that happened.
 */
function tagsUsedByCorpus() {
  const CORPUS = path.join(REPO, 'journey-tests');
  const found = new Map();
  const add = (tag, file) => {
    if (!found.has(tag)) found.set(tag, new Set());
    found.get(tag).add(file);
  };
  const looksLikeTag = (s) => /^[a-z][A-Za-z0-9]*_[A-Za-z0-9_]+$/.test(s);
  for (const f of fs.readdirSync(CORPUS).filter((n) => n.endsWith('.feature'))) {
    const src = fs.readFileSync(path.join(CORPUS, f), 'utf8');
    // Unambiguous: the step names the thing as a tag.
    for (const m of src.matchAll(/\bwith tag "([^"]+)"/g)) add(m[1], f);
    // Overloaded forms — only when it looks like a tag rather than a label.
    for (const m of src.matchAll(/\btaps "([^"]+)"/g)) {
      if (looksLikeTag(m[1])) add(m[1], f);
    }
    for (const m of src.matchAll(/\binto "([^"]+)"/g)) {
      if (looksLikeTag(m[1])) add(m[1], f);
    }
  }
  return found;
}

describe('the corpus names no tag the product never renders', () => {
  it('reads a substantial corpus tag inventory', () => {
    // Calibration. If the extraction silently stopped matching — a step-phrasing
    // change, a reformat — an empty set would make the check below pass while
    // testing nothing, which is the exact failure mode it exists to catch.
    expect(tagsUsedByCorpus().size).toBeGreaterThan(30);
  });

  it('no corpus tag is absent from the product', () => {
    const offenders = [...tagsUsedByCorpus().entries()]
      .filter(([tag]) => !renderedByProduct(tag))
      .filter(([tag]) => !KNOWN_PHANTOM_TAGS.includes(tag))
      .map(([tag, files]) => `${tag} (${[...files].join(', ')})`)
      .sort();
    expect({ corpusTagsTheProductNeverRenders: offenders }).toEqual({
      corpusTagsTheProductNeverRenders: [],
    });
  });
});

describe('the phantom-tag debt may only shrink', () => {
  it('no NEW driver tag is absent from the product', () => {
    const offenders = [...tagsUsedByName().entries()]
      .filter(([tag]) => !renderedByProduct(tag))
      .filter(([tag]) => !KNOWN_PHANTOM_TAGS.includes(tag))
      .map(([tag, files]) => `${tag} (${[...files].join(', ')})`)
      .sort();
    // Named in the failure, with the fix: use the tag the product renders, or
    // add a testTag to the screen.
    expect({ tagsTheProductNeverRenders: offenders }).toEqual({ tagsTheProductNeverRenders: [] });
  });

  it('the frozen list contains nothing already fixed', () => {
    // The staleness check has to span the SAME universe as the debt list, or it
    // reports every entry from the source it does not know about as "already
    // fixed" — which is how a shrink-only list gets emptied by accident. When
    // the corpus scan was added, all 23 of its entries looked stale to a check
    // that only read driver source.
    const used = new Set([...tagsUsedByName().keys(), ...tagsUsedByCorpus().keys()]);
    const stale = KNOWN_PHANTOM_TAGS.filter((t) => !used.has(t) || renderedByProduct(t));
    expect({ alreadyFixedButStillListed: stale }).toEqual({ alreadyFixedButStillListed: [] });
  });
});
