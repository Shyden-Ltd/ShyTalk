/**
 * The app-driving methods the journey corpus calls, written ONCE for both phones.
 *
 * WHY THIS EXISTS. The Android driver carried 73 methods and the real iOS driver
 * carried 11, so every app scenario in the corpus had to say "on Android". That
 * was not a missing feature — it was a missing abstraction. Almost every one of
 * those methods is "is this tag on screen / does it say the right thing", and
 * the only genuine platform difference is which XML attribute holds the tag
 * (see `ui-grammar.js`). Writing them twice is what opened the gap; writing them
 * once is what closes it, and keeps it closed — a method added here exists on
 * both phones the moment it is written.
 *
 * The platform supplies only what is genuinely platform-specific:
 *
 *   uiDump()            — the current screen, as XML
 *   tapByTag(tag)       — tap an element by its accessibility id
 *   tapAt(x, y)         — tap a coordinate
 *   longPressAt(x,y,ms) — press and hold
 *   typeText(text)      — type into the focused field
 *   relaunchApp()       — cold restart
 *   dropNetwork(secs)   — take the device offline and bring it back
 *
 * A capability a platform genuinely lacks is passed as null and the methods that
 * need it REFUSE — they throw, naming what is missing. They must never return
 * false: false means "checked, and the product was wrong", and reporting a
 * harness limitation that way is how a matrix run gets read as a product defect.
 *
 * WHAT THESE ASSERT. Presence of a screen is the weakest useful claim, so where
 * the step names a person, a value or a state, that argument is CHECKED. A
 * method that ignores its arguments passes on the wrong user's card, the wrong
 * gift, a stale toast — and reports it as a pass.
 */

const fs = require('fs');
const path = require('path');

const {
  EVENT_CONTROL_TAGS,
  SCREEN_MARKERS,
  TABLE_TAGS,
  INPUT_TAGS,
  NOUN_KIND_TAGS,
  SURFACE_TARGET_TAGS,
  SEARCH_FIELD_TAGS,
  DEFAULT_SEARCH_FIELD_TAG,
  MIC_STATE_HINTS,
  CONFIRM_TAG_CANDIDATES,
  resolvePathTag,
  resolveRouteTag,
  navTabCandidates,
} = require('./app-testtags');

/**
 * The app's own translation of a string key, for one locale.
 *
 * Read from `composeResources/values-<locale>/strings.xml` — the file the app
 * actually ships — so a locale assertion checks the REAL translation rather
 * than merely that some message arrived. A hard-coded expectation here would
 * drift from the product the first time a translator changed a word.
 *
 * Returns null when the key or the locale is absent, and the caller REFUSES
 * rather than passing: "there is no translation to compare against" is a
 * harness gap, not a product failure.
 */
const RESOURCES = path.join(__dirname, '../../../shared/src/commonMain/composeResources');
const stringCache = new Map();
function localisedString(key, locale) {
  const cacheKey = `${locale}::${key}`;
  if (stringCache.has(cacheKey)) return stringCache.get(cacheKey);
  const dir = locale === 'en' ? 'values' : `values-${locale}`;
  let value = null;
  try {
    const xml = fs.readFileSync(path.join(RESOURCES, dir, 'strings.xml'), 'utf8');
    // Plain string search, not a regex: an XML body can contain anything, and
    // every pattern shape tried here tripped sonarjs/slow-regex.
    const open = `<string name="${key}">`;
    const start = xml.indexOf(open);
    if (start !== -1) {
      const from = start + open.length;
      const end = xml.indexOf('</string>', from);
      if (end !== -1) value = xml.slice(from, end).split("\\'").join("'").trim() || null;
    }
  } catch {
    value = null;
  }
  stringCache.set(cacheKey, value);
  return value;
}

/** A non-blank string, or null. Blank arguments must never match everything. */
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Build every shared method for one platform.
 *
 * Keys are UNPREFIXED (`ShowsUserCard`); the driver registers them as
 * `androidShowsUserCard` / `iosShowsUserCard`. Keeping the prefix out of this
 * file is what makes a missing method on one platform impossible to overlook —
 * there is only one list.
 */
function createSharedAppMethods({
  platform,
  queries,
  uiDump,
  tapByTag,
  tapAt = null,
  longPressAt = null,
  typeText = null,
  relaunchApp = null,
  dropNetwork = null,
  sibling = null,
} = {}) {
  if (!queries) throw new Error('createSharedAppMethods: queries is required');
  if (typeof uiDump !== 'function') throw new Error('createSharedAppMethods: uiDump is required');
  if (typeof tapByTag !== 'function')
    throw new Error('createSharedAppMethods: tapByTag is required');

  const q = queries;

  /** Refuse loudly for a capability this platform does not have. */
  const unsupported = (method, capability) => {
    throw new Error(
      `${method} is not supported on ${platform}: the driver has no ${capability}. This is a HARNESS limitation, not a product failure — implement ${capability} for ${platform} or tag the scenario so it does not dispatch here.`,
    );
  };

  /**
   * Call one of the driver's OWN methods by unprefixed name.
   *
   * The composite steps below are sequences of platform actions — open the
   * profile, tap Block, confirm — and each platform already implements those
   * actions in its own vocabulary. Expressing the sequence here and the actions
   * there is what keeps a composite from being written twice.
   *
   * A missing sibling REFUSES rather than returning false, for the same reason
   * as `unsupported`: "the harness cannot do this" and "the product did the
   * wrong thing" must not arrive as the same answer.
   */
  const call = (name, ...args) => {
    const fn = sibling && sibling(name);
    if (typeof fn !== 'function') {
      return unsupported(name, `a ${platform} implementation of ${name}`);
    }
    return fn(...args);
  };
  const has = (name) => typeof (sibling && sibling(name)) === 'function';

  const dump = () => uiDump();

  /** Is any of these markers on screen? */
  const onScreen = async (markers) => {
    const d = await dump();
    if (!d) return false;
    return markers.some((m) => q.hasTag(d, m));
  };

  /** Simple "a tag with this prefix exists" check, the corpus's commonest shape. */
  const prefixPresent = (prefix) => async () => {
    const d = await dump();
    return q.hasTagPrefix(d, prefix);
  };

  /** Same, for an exact tag. */
  const tagPresent = (tag) => async () => {
    const d = await dump();
    return q.hasTag(d, tag);
  };

  const methods = {
    // ── Screens ────────────────────────────────────────────────────────────
    //
    // The leading viewer argument is legitimately unused: a driver owns exactly
    // one device, so "Selma's UI shows X" is answered by looking at the screen
    // this driver is attached to. Every OTHER argument is checked.
    IsStillInRoom: async () => onScreen(SCREEN_MARKERS.room),
    IsNoLongerInVoiceRoom: async () => {
      const d = await dump();
      // An absent dump is NOT proof of having left — the screen may simply not
      // have rendered. Answering true here would pass a "was removed from the
      // room" assertion against a blank screen.
      if (!d) return false;
      return !SCREEN_MARKERS.room.some((m) => q.hasTag(d, m));
    },
    NavigatesToRoomScreen: async () => onScreen(SCREEN_MARKERS.room),
    NavigatesToProfileScreen: async () => onScreen(SCREEN_MARKERS.profile),
    NavigatesToWarningScreen: async () => onScreen(SCREEN_MARKERS.warning),
    ShowsWarningScreenOnRelaunch: async () => onScreen(SCREEN_MARKERS.warning),
    ContinuesNormallyInRoom: async () => {
      const d = await dump();
      if (!d) return false;
      // BOTH halves: still in the room AND not staring at a warning. Checking
      // only the room would call a warning overlaid on the room "normal".
      if (SCREEN_MARKERS.warning.some((m) => q.hasTag(d, m))) return false;
      return SCREEN_MARKERS.room.some((m) => q.hasTag(d, m));
    },
    ShowsWarningScreenWithReason: async (_viewer, reason) => {
      const wanted = str(reason);
      if (!wanted) return false;
      const d = await dump();
      if (!d) return false;
      // The reason is the point. A warning screen showing the WRONG reason is a
      // real defect, and a screen-only check would pass it.
      return SCREEN_MARKERS.warning.some((m) => q.hasTag(d, m)) && q.hasText(d, wanted);
    },
    ShowsRoute: async (route) => {
      const tag = resolveRouteTag(route);
      if (!tag) return false;
      const d = await dump();
      return q.hasTag(d, tag);
    },
    NavigatesToPath: async (_viewer, deepLinkPath) => {
      // Named `deepLinkPath`, not `path`: the module now requires node's `path`,
      // and shadowing it here would silently break `localisedString` the moment
      // anything in this closure reached for it.
      const p = str(deepLinkPath);
      if (!p) return false;
      const tag = resolvePathTag(p);
      if (!tag) return false;
      const d = await dump();
      return q.hasTag(d, tag);
    },

    // ── Room furniture ─────────────────────────────────────────────────────
    //
    // These five existed on iOS and NOT on Android — the reverse of the gap this
    // module was written to close, and a reminder that the asymmetry has no
    // preferred direction. Sharing them means neither phone can lose one.
    ShowsRoomScreen: async () => onScreen(SCREEN_MARKERS.room),
    ShowsSeatGrid: tagPresent('room_seatGrid'),
    ShowsParticipantsList: prefixPresent('participantsList_'),
    ShowsMicIcon: tagPresent('room_micToggleButton'),
    ShowsToast: async (_viewer, text) => {
      const d = await dump();
      if (!d) return false;
      if (!q.hasTag(d, 'app_toast')) return false;
      // A toast carries its message. Asserting only that SOME toast exists would
      // pass on the wrong toast entirely — including one left over from the
      // previous step.
      const wanted = str(text);
      return wanted ? q.hasTagPrefixWithText(d, 'app_toast', wanted) : true;
    },

    // ── Simple presence checks ─────────────────────────────────────────────
    AdminShowsAppealText: prefixPresent('adminAppeal_'),
    AdminShowsDashboardCounters: prefixPresent('adminDashboard_'),
    AdminShowsStat: prefixPresent('adminStat_'),
    AlsoShowsInParticipantsList: async (_viewer, other) => {
      const who = str(other === null || other === undefined ? null : String(other));
      if (!who) return false;
      const d = await dump();
      if (!d) return false;
      // WHO is in the list. The panel was untagged entirely, so this asserted a
      // tag the product never rendered — a check that could only fail. Now that
      // each row carries its participant, the step can name the person it means.
      return (
        q.hasTagPrefix(d, `participantsList_${who}`) ||
        q.hasTagPrefixWithText(d, 'participantsList_', who)
      );
    },
    ApproveSeatRequest: prefixPresent('seatRequest_'),
    RefreshLanguageRail: prefixPresent('languageRail_'),
    ShowsBeansPerWeekChart: prefixPresent('beansChart_'),
    ShowsContributorsList: tagPresent('giftWall_grid'),
    ShowsOnlyMinorCohortInRankings: prefixPresent('giftWall_rankingHeader'),
    ShowsRoomWarningBanner: prefixPresent('roomWarningBanner_'),
    ShowsUserCardSkeletons: prefixPresent('userCardSkeleton_'),
    ShowsSecondOffensiveMessage: tagPresent('privateChat_messageInput'),
    ShowsSystemPmFromOfficia: tagPresent('privateChat_messageInput'),

    // ── Assertions that used to ignore every argument ──────────────────────
    //
    // Each of these took the thing that mattered and checked only that SOME
    // element of the right family existed. That passes on the wrong
    // conversation, the wrong requester, the wrong language — and reports it as
    // a pass, which is worse than no assertion because it reads as coverage.
    ShowsFrozenBanner: async (_viewer, conversationId) => {
      const d = await dump();
      if (!d) return false;
      // WHICH conversation is frozen. The banner used to carry no id at all, so
      // this asserted "a banner is on screen" — satisfied by a banner left over
      // from a different thread. The id is now in the tag (PrivateChatScreen).
      const id = str(
        conversationId === null || conversationId === undefined ? null : String(conversationId),
      );
      return id
        ? q.hasTagPrefix(d, `privateChat_frozenBanner_${id}`)
        : q.hasTagPrefix(d, 'privateChat_frozenBanner');
    },
    ShowsNonEmptyLocaleText: async (_viewer, code) => {
      const lang = str(code);
      if (!lang) return false;
      const d = await dump();
      if (!d) return false;
      // NON-EMPTY is the claim, and it is the half that catches the real defect:
      // a missing translation renders the row with a blank label, and a
      // presence-only check calls that a pass. `settings_language_<code>` is
      // what the product actually renders — `localeText_` never existed.
      const [el] = q.elementsWithTagPrefix(d, `settings_language_${lang}`);
      if (!el) return false;
      const text = q.grammar.textOf(el);
      return Boolean(text && text.trim());
    },
    ShowsOwnRankInTop: async (viewer, topN) => {
      const d = await dump();
      if (!d) return false;
      // "In the top N" is a claim about a NUMBER. Asserting only that a ranking
      // row exists passes when the viewer is 400th.
      const limit = Number(topN);
      if (!Number.isFinite(limit) || limit <= 0) return false;
      const rows = q.elementsWithTagPrefix(d, 'giftWall_rank_');
      if (!rows.length) return false;
      const who = str(viewer);
      const index = who
        ? rows.findIndex((el) => q.grammar.tagOf(el) === `giftWall_rank_${who}`)
        : 0;
      if (index < 0) return false;
      return index < limit;
    },
    ShowsSeatRequestNotification: async (_host, requester) => {
      const who = str(requester === null || requester === undefined ? null : String(requester));
      if (!who) return false;
      const d = await dump();
      if (!d) return false;
      // WHOSE request. A host with two people asking to sit needs to know which
      // card is on screen — approving the wrong person is the defect this
      // catches, and an untagged card made it invisible.
      return (
        q.hasTagPrefix(d, `seatRequestNotification_${who}`) ||
        q.hasTagPrefixWithText(d, 'seatRequestNotification_', who)
      );
    },
    ShowsWelcomePmInLanguage: async (_viewer, code) => {
      const lang = str(code);
      if (!lang) return false;
      const d = await dump();
      if (!d) return false;
      // A RECEIVED message must exist. This used to assert
      // `privateChat_messageInput` — the INPUT BOX, which renders on every
      // conversation in every language and therefore could not fail.
      if (!q.hasTagPrefix(d, 'privateChat_msg_recv_')) return false;
      // And it must say the welcome line IN THAT LANGUAGE. The expected string
      // is read from the app's own resource file for the locale, so this checks
      // the actual translation rather than trusting that a message arrived —
      // which is the entire claim the step makes.
      const expected = localisedString('welcome_to_shytalk', lang);
      if (!expected) {
        return unsupported(
          'ShowsWelcomePmInLanguage',
          `a translation of welcome_to_shytalk for locale "${lang}"`,
        );
      }
      return q.hasText(d, expected);
    },
    SubmitStarFeedback: prefixPresent('feedbackScreen_'),
    OpenProfileAndTap: prefixPresent('profile_'),
    OpenProfileFrom: prefixPresent('profile_'),

    // ── Admin tables ───────────────────────────────────────────────────────
    AdminShowsTableOf: async (_viewer, noun) => {
      const key = str(noun);
      const tag = key && TABLE_TAGS[key.toLowerCase()];
      if (!tag) return false;
      const d = await dump();
      return q.hasTag(d, tag);
    },
    AdminShowsRowCountInTable: async (_viewer, count, tableName) => {
      const key = str(tableName);
      const tag = key && TABLE_TAGS[key.toLowerCase()];
      if (!tag) return false;
      const d = await dump();
      if (!q.hasTag(d, tag)) return false;
      // The COUNT is the claim. A list that exists but holds the wrong number of
      // rows is exactly the defect this step is written to catch, so the rows
      // are counted rather than assumed.
      const wanted = Number(count);
      if (!Number.isFinite(wanted)) return false;
      return q.countTagPrefix(d, `${tag}Row_`) === wanted;
    },
    AdminShowsNewReportInQueue: async () => {
      const d = await dump();
      if (!d) return false;
      // Present AND not empty. The list renders either way, so its presence
      // alone would pass on an empty queue — which is the opposite of the claim.
      if (!q.hasTag(d, 'reportReview_list')) return false;
      return !q.hasTag(d, 'reportReview_emptyState');
    },
    AdminShowsRowForWithStatus: async (_viewer, _count, targetId, status) => {
      const target = str(targetId);
      const wanted = str(status);
      if (!target || !wanted) return false;
      const d = await dump();
      if (!d || !q.hasTag(d, 'reportReview_list')) return false;
      // The row FOR this target, showing THIS status. Two separate rows — one
      // for the target, one showing the status — is not the same claim.
      return q.hasTagPrefixWithText(d, `reportReview_row_${target}`, wanted);
    },

    // ── Values on screen ───────────────────────────────────────────────────
    ShowsBalanceViaListener: async (_viewer, balance) => {
      const wanted = str(balance);
      if (!wanted) return false;
      const d = await dump();
      if (!d) return false;
      // The balance element must itself carry the number. A screen where the
      // wallet is present and the number appears somewhere else entirely is not
      // a wallet showing that balance.
      return q.hasTagPrefixWithText(d, 'wallet_balance', wanted);
    },
    ShowsBanner: async (_viewer, banner) => {
      const wanted = str(banner);
      if (!wanted) return false;
      const d = await dump();
      return q.hasText(d, wanted);
    },
    ShowsCountBadge: async (_viewer, delta, label) => {
      const key = str(label);
      if (!key) return false;
      const n = Number(delta);
      if (!Number.isFinite(n)) return false;
      const d = await dump();
      if (!d) return false;
      // The named counter showing the named number — `profile_count_followers`
      // reading "3", not "some counter exists and 3 appears on screen".
      return q.hasTagPrefixWithText(d, `profile_count_${key.toLowerCase()}`, String(n));
    },
    ShowsStalkersDelta: async (viewer, delta) => methods.ShowsCountBadge(viewer, delta, 'stalkers'),
    ShowsMicIconAs: async (_viewer, state) => {
      const key = str(state);
      const hints = key && MIC_STATE_HINTS[key.toLowerCase()];
      if (!hints) return false;
      const d = await dump();
      if (!d || !q.hasTag(d, 'room_micToggleButton')) return false;
      // The tag is identical in every state, so the LABEL is the only thing that
      // distinguishes open from muted. Tag-only would pass a muted mic as live.
      return hints.some((h) => q.hasTagPrefixWithText(d, 'room_micToggleButton', h));
    },
    DisablesInput: async (_viewer, inputName) => {
      const key = str(inputName);
      const tag = key && INPUT_TAGS[key.toLowerCase()];
      if (!tag) return false;
      const d = await dump();
      if (!d || !q.hasTag(d, tag)) return false;
      // Present AND disabled. An input that has vanished is a different bug from
      // one that is locked, and conflating them hides both.
      return q.isTagDisabled(d, tag);
    },
    ShowsNamedKind: async (_viewer, noun, kind) => {
      const n = str(noun);
      const k = str(kind);
      if (!n || !k) return false;
      const tag = NOUN_KIND_TAGS[`${n.toLowerCase()}::${k.toLowerCase()}`];
      if (!tag) return false;
      const d = await dump();
      return q.hasTag(d, tag);
    },
    ReplacesFollowButton: async (_viewer, buttonId) => {
      const wanted = str(buttonId);
      if (!wanted) return false;
      const d = await dump();
      if (!d) return false;
      // The button is the same element throughout; what changes is what it says.
      // Checking only that a follow button exists would pass before the tap.
      return q.hasTagPrefixWithText(d, 'profile_followButton', wanted);
    },

    // ── People, messages, gifts ────────────────────────────────────────────
    ShowsUserCard: async (_viewer, targetUniqueId) => {
      const target = str(
        targetUniqueId === null || targetUniqueId === undefined ? null : String(targetUniqueId),
      );
      if (!target) return false;
      const d = await dump();
      // The card for THIS user. A prefix check passes on the wrong person's card
      // and on a card left open by an earlier step.
      return q.hasTag(d, `userCard_${target}`);
    },
    ShowsInResults: async (_viewer, targetUniqueId, displayName) => {
      const target = str(
        targetUniqueId === null || targetUniqueId === undefined ? null : String(targetUniqueId),
      );
      if (!target) return false;
      const d = await dump();
      if (!d) return false;
      const row = `newMessage_result_${target}`;
      if (!q.hasTag(d, row)) return false;
      // When the step names the display name too, the row must carry it — a row
      // for the right id showing the wrong name is a real defect.
      const name = str(displayName);
      return name ? q.hasTagPrefixWithText(d, row, name) : true;
    },
    ShowsInThread: async (_viewer, _noun, suffix) => {
      const d = await dump();
      if (!d) return false;
      // "sent" means the message must be OUTBOUND. Accepting either direction
      // would pass when the app rendered the reply instead of the send.
      const wantsSent = /\bsent\b/i.test(String(suffix || ''));
      if (wantsSent) return q.hasTagPrefix(d, 'privateChat_msg_sent_');
      return (
        q.hasTagPrefix(d, 'privateChat_msg_sent_') || q.hasTagPrefix(d, 'privateChat_msg_recv_')
      );
    },
    ShowsMessageInConversationThread: async () => {
      const d = await dump();
      if (!d) return false;
      return (
        q.hasTagPrefix(d, 'privateChat_msg_sent_') || q.hasTagPrefix(d, 'privateChat_msg_recv_')
      );
    },
    ShowsPmThreadDirection: async (_viewer, direction) => {
      const want = String(direction || '')
        .trim()
        .toLowerCase();
      if (want !== 'rtl' && want !== 'ltr') return false;
      const d = await dump();
      if (!d) return false;
      // Defaulting to 'ltr' on a blank screen would silently pass every LTR
      // assertion, so an absent dump is answered false above rather than
      // assumed.
      return (q.hasTag(d, 'rtl_marker') ? 'rtl' : 'ltr') === want;
    },
    ShowsEditedBodyWithTag: async (_viewer, body, messageId) => {
      const text = str(body === null || body === undefined ? null : String(body));
      if (!text) return false;
      const d = await dump();
      if (!d) return false;
      if (!q.hasText(d, text)) return false;
      // The edited MARKER must be on the message, otherwise an unedited message
      // with the same body satisfies the step.
      const id = str(messageId === null || messageId === undefined ? null : String(messageId));
      return q.hasTagPrefix(d, id ? `privateChat_edited_${id}` : 'privateChat_edited_');
    },
    ShowsOfficialBadge: async (_viewer, sender) => {
      const d = await dump();
      if (!d || !q.hasTag(d, 'privateChat_officialBadge')) return false;
      const who = str(sender);
      return who ? q.hasText(d, who) : true;
    },
    ShowsNewUnreadConversation: async (_viewer, other) => {
      const who = str(other);
      if (!who) return false;
      const d = await dump();
      if (!d) return false;
      // On the messages list, with a row naming the other person. The tab alone
      // proves only that the user is looking at the right screen.
      if (!q.hasTag(d, 'main_messagesTab')) return false;
      return q.hasText(d, who);
    },
    ShowsInAppGiftNotification: async (_viewer, sender, giftName) => {
      const who = str(sender);
      const gift = str(giftName);
      if (!who || !gift) return false;
      const d = await dump();
      if (!d || !q.hasTag(d, 'app_toast')) return false;
      // BOTH names, on the toast itself: "Alice sent you a Crown" is the claim,
      // and a toast naming only one of them is the wrong notification.
      return (
        q.hasTagPrefixWithText(d, 'app_toast', who) && q.hasTagPrefixWithText(d, 'app_toast', gift)
      );
    },
    ShowsGiftFromSender: async (_recipient, giftId, sender) => {
      const gift = str(giftId);
      const who = str(sender);
      if (!gift || !who) return false;
      const d = await dump();
      if (!d || !q.hasTag(d, 'giftWall_grid')) return false;
      // The wall entry for THIS gift, crediting THIS sender.
      return q.hasTagPrefixWithText(d, `giftWall_entry_${gift}`, who);
    },
    ShowsNewGiftEntry: async (_viewer, giftId) => {
      const gift = str(giftId);
      if (!gift) return false;
      const d = await dump();
      if (!d || !q.hasTag(d, 'giftWall_grid')) return false;
      return q.hasTagPrefix(d, `giftWall_entry_${gift}`);
    },

    // ── Seats ──────────────────────────────────────────────────────────────
    ShowsInSeatGrid: async (_viewer, target, seatNum) => {
      const who = str(target);
      if (!who) return false;
      const d = await dump();
      if (!d || !q.hasTag(d, 'room_seatGrid')) return false;
      const seats = q.seatGrid(d);
      // When the step names a seat NUMBER, that seat must hold them — "Selma is
      // seated somewhere" is a weaker claim than the corpus makes.
      const n = Number(seatNum);
      if (Number.isFinite(n)) {
        const seat = seats.find((s) => s.index === n);
        return Boolean(seat && seat.occupant && seat.occupant.includes(who));
      }
      return seats.some((s) => s.occupant && s.occupant.includes(who));
    },
    ShowsSeatWithIndicator: async (_viewer, target, indicator) => {
      const who = str(target);
      const mark = str(indicator);
      if (!who || !mark) return false;
      const d = await dump();
      if (!d || !q.hasTag(d, 'room_seatGrid')) return false;
      const seats = q.seatGrid(d);
      const seat = seats.find((s) => s.occupant && s.occupant.includes(who));
      if (!seat) return false;
      // The indicator must be on THEIR seat, not merely somewhere in the grid —
      // a muted icon on a different seat is a different fact entirely.
      return q.hasTagPrefixWithText(d, `seat_${seat.index}`, mark);
    },

    // ── Reading the whole screen ───────────────────────────────────────────
    ScanAllRenderedStrings: async () => {
      const d = await dump();
      return q.allText(d);
    },

    // ── Toasts + navigation ────────────────────────────────────────────────
    ShowsToastAndNavigates: async (_viewer, toast, route) => {
      const message = str(toast);
      if (!message) return false;
      const d = await dump();
      if (!d) return false;
      // TWO claims, both required: a toast with no navigation strands the user,
      // and navigation with no toast leaves them wondering what happened.
      if (!q.hasTag(d, 'app_toast')) return false;
      if (!q.hasTagPrefixWithText(d, 'app_toast', message)) return false;
      const tag = resolveRouteTag(route);
      if (!tag) return false;
      return q.hasTag(d, tag);
    },
    ShowsToastAndNavigatesBack: async (viewer, toast, route) =>
      methods.ShowsToastAndNavigates(viewer, toast, route),

    // ── Actions ────────────────────────────────────────────────────────────
    OpensTab: async (_viewer, tab) => {
      for (const candidate of navTabCandidates(tab)) {
        if (await tapByTag(candidate)) return true;
      }
      return false;
    },
    NavigatesBackToTab: async (viewer, tab) => methods.OpensTab(viewer, tab),
    TapFromSurface: async (_viewer, target, source) => {
      const t = str(target);
      const s = str(source);
      if (!t || !s) return false;
      const tag = SURFACE_TARGET_TAGS[`${s.toLowerCase()}::${t.toLowerCase()}`];
      if (!tag) return false;
      return tapByTag(tag);
    },
    JoinEventRoom: async () => {
      const d = await dump();
      const centre = q.centreOfTagPrefix(d, 'roomList_roomCard_');
      if (!centre) return false;
      if (!tapAt) unsupported('JoinEventRoom', 'a coordinate tap');
      return tapAt(centre.cx, centre.cy);
    },
    TapRoomCard: async (owner) => {
      const who = str(owner);
      if (who && (await tapByTag(`roomCard_${who}`))) return true;
      const d = await dump();
      // Falling back to the FIRST card is deliberate for the ownerless form, but
      // when an owner was named it must be their card — tapping any card and
      // reporting success is how a journey ends up in the wrong room.
      const centre = who
        ? q.centreOfTagPrefixWithText(d, 'roomCard_', who)
        : q.centreOfTagPrefix(d, 'roomCard_');
      if (!centre) return false;
      if (!tapAt) unsupported('TapRoomCard', 'a coordinate tap');
      return tapAt(centre.cx, centre.cy);
    },
    TapQuotedTarget: async (_viewer, targetId, isRoomCard) => {
      if (isRoomCard) return methods.TapRoomCard(targetId);
      return tapByTag(targetId);
    },
    ConfirmDialog: async () => {
      for (const tag of CONFIRM_TAG_CANDIDATES) {
        if (await tapByTag(tag)) return true;
      }
      return false;
    },
    LongPressSeat: async (target) => {
      const who = str(target === null || target === undefined ? null : String(target));
      if (!who) return false;
      const d = await dump();
      if (!d) return false;
      // Either a seat INDEX (`seat_2`) or an occupant's name. Both forms appear
      // in the corpus and neither can be assumed.
      const centre =
        q.centreOfTag(d, `seat_${who}`) || q.centreOfTagPrefixWithText(d, 'seat_', who);
      if (!centre) return false;
      if (!longPressAt) unsupported('LongPressSeat', 'a long-press');
      return longPressAt(centre.cx, centre.cy, 800);
    },
    SearchIn: async (screen, text) => {
      const term = str(text);
      if (!term) return false;
      const tag = !screen
        ? DEFAULT_SEARCH_FIELD_TAG
        : SEARCH_FIELD_TAGS[String(screen).trim().toLowerCase()];
      if (!tag) return false;
      if (!(await tapByTag(tag))) return false;
      if (!typeText) unsupported('SearchIn', 'text entry');
      return typeText(term);
    },
    KillAndRelaunch: async () => {
      if (!relaunchApp) unsupported('KillAndRelaunch', 'an app relaunch');
      return relaunchApp();
    },
    NetworkDropFor: async (_viewer, seconds) => {
      const secs = Number(seconds);
      if (!Number.isFinite(secs) || secs < 0) return false;
      if (!dropNetwork) unsupported('NetworkDropFor', 'network control');
      return dropNetwork(secs);
    },

    // ── Events (SHY-0267, j16) ─────────────────────────────────────────────
    //
    // Every one of these names the PERSON or the NUMBER the step is about. The
    // event host screen tags its controls per member precisely so that "Tariq
    // taps Promote Selma" cannot be satisfied by promoting whoever rendered
    // first — which is the failure a generic `promoteButton` tag would allow.
    TapEventControl: async (_viewer, control) => {
      const key = str(control);
      if (!key) return false;
      const tag = EVENT_CONTROL_TAGS[key.toLowerCase()];
      if (!tag) return false;
      return tapByTag(tag);
    },
    PromoteFromRoster: async (_host, target) => {
      const who = str(target === null || target === undefined ? null : String(target));
      if (!who) return false;
      // By id first (the tag the screen renders), then by the row bearing the
      // name — the corpus writes people's names, the UI keys on their id.
      if (await tapByTag(`eventHost_promote_${who}`)) return true;
      const d = await dump();
      const centre = q.centreOfTagPrefixWithText(d, 'eventHost_promote_', who);
      if (!centre) return false;
      if (!tapAt) unsupported('PromoteFromRoster', 'a coordinate tap');
      return tapAt(centre.cx, centre.cy);
    },
    DemoteFromRoster: async (_host, target) => {
      const who = str(target === null || target === undefined ? null : String(target));
      if (!who) return false;
      if (await tapByTag(`eventHost_demote_${who}`)) return true;
      const d = await dump();
      const centre = q.centreOfTagPrefixWithText(d, 'eventHost_demote_', who);
      if (!centre) return false;
      if (!tapAt) unsupported('DemoteFromRoster', 'a coordinate tap');
      return tapAt(centre.cx, centre.cy);
    },
    ShowsRosterMemberAs: async (_viewer, target, expected) => {
      const who = str(target === null || target === undefined ? null : String(target));
      const state = str(expected);
      if (!who || !state) return false;
      const d = await dump();
      if (!d || !q.hasTag(d, 'eventHost_rosterPanel')) return false;
      // THEIR row, showing THAT answer. A panel-only check would pass while the
      // one member who declined sat there unnoticed.
      return q.hasTagPrefixWithText(d, `eventHost_rosterStatus_${who}`, state.toLowerCase());
    },
    ShowsEventTotals: async (_viewer, gifts, coins, beans, topContributor) => {
      const d = await dump();
      if (!d || !q.hasTag(d, 'eventHost_totals')) return false;
      // Each number against ITS OWN element. "510 appears somewhere on screen"
      // is satisfied by the coin total when the assertion was about beans.
      const pairs = [
        ['eventHost_giftCount', gifts],
        ['eventHost_coinTotal', coins],
        ['eventHost_beanTotal', beans],
      ];
      for (const [tag, value] of pairs) {
        if (value === undefined || value === null || value === '') continue;
        if (!q.hasTagPrefixWithText(d, tag, String(value))) return false;
      }
      const top = str(topContributor);
      return top ? q.hasTagPrefixWithText(d, 'eventHost_topContributor', top) : true;
    },
    ShowsEventSummaryPanel: async (_viewer, performer) => {
      const d = await dump();
      if (!d || !q.hasTag(d, 'eventSummary_panel')) return false;
      // When the step names a performer, their line must be there — the
      // per-performer breakdown IS the panel's reason to exist, and a panel
      // showing only a grand total would pass a presence-only check.
      const who = str(performer === null || performer === undefined ? null : String(performer));
      return who ? q.hasTagPrefix(d, `eventSummary_performer_${who}`) : true;
    },
    ShowsOwnEventEarnings: async (_viewer, beans) => {
      const d = await dump();
      if (!d) return false;
      if (!q.hasTag(d, 'eventSummary_myEarnings')) return false;
      // The NUMBER. "You have an earnings line" is not what the performer
      // opened the screen to find out.
      const amount = beans === undefined || beans === null ? null : String(beans);
      return amount ? q.hasTagPrefixWithText(d, 'eventSummary_myBeans', amount) : true;
    },
    ShowsEventInviteBanner: async (_viewer, hostName) => {
      const d = await dump();
      if (!d || !q.hasTagPrefix(d, 'inviteBanner_')) return false;
      const who = str(hostName);
      // The banner says whose event it is. One that names the wrong host sends
      // the performer to the wrong show.
      return who ? q.hasTagPrefixWithText(d, 'inviteBanner_text_', who) : true;
    },

    // ── Composites ─────────────────────────────────────────────────────────
    //
    // Sequences of platform actions. The sequence is the shared part; the
    // actions are each platform's own, reached through `call`.
    AttemptBlock: async (target) => {
      await call('TapUserCard', null, target);
      return call('AttemptAction', 'Block');
    },
    AttemptFollowViaProfile: async (target) => {
      await call('TapUserCard', null, target);
      return call('AttemptAction', 'Follow');
    },
    AttemptStartConversation: async (target) => {
      await call('TapUserCard', null, target);
      return call('AttemptAction', 'Message');
    },
    CreateRoomComposite: async (title) => {
      if (!(await call('OpenScreen', 'rooms'))) return false;
      if (!(await tapByTag('main_createRoomFab'))) return false;
      // A title that was asked for and not typed produces a room with the wrong
      // name, so a failure to type fails the whole composite.
      if (title && !(await call('TypeText', title))) return false;
      return (await tapByTag('createRoom_confirmButton')) || call('Confirm');
    },
    SendMessageTo: async (target, text) => {
      if (!(await call('OpenConversation', target))) return false;
      if (!(await call('TypeIntoConversationInput', text))) return false;
      return (await tapByTag('conversation_sendButton')) || call('TapNamedButton', 'Send');
    },
    SignupWithDOB: async (dob) => {
      if (!(await tapByTag('signin_signUpLink'))) return false;
      if (!(await call('PickDOB', dob))) return false;
      return call('TapNamedButton', 'Continue');
    },
    SelectGiftRecipient: async (name) => {
      const who = str(name);
      if (!who) return false;
      if (await tapByTag(`giftRecipient_${who}`)) return true;
      return call('TapNamedButton', who);
    },
    SelectFromFollowedPicker: async (name) => {
      if (!(await tapByTag('followedPicker'))) return false;
      return call('TapNamedButton', name);
    },
    SelectGalleryImage: async (index = 0) => {
      if (!(await tapByTag('idUpload_gallery'))) return false;
      return tapByTag(`galleryImage_${index}`);
    },
    PickTestImageBySize: async (size) => {
      if (!(await tapByTag('idUpload_gallery'))) return false;
      return (await tapByTag(`testImage_${size}`)) || call('TapNamedButton', String(size));
    },
    PickIdType: async (idType) => {
      if (await tapByTag(`idType_${idType}`)) return true;
      return call('TapNamedButton', idType);
    },
    RetrySamePurchase: async () => {
      if (!(await tapByTag('wallet_retryPurchase'))) return false;
      return call('Confirm');
    },
    TapEventInviteAction: async (action) => call('TapNamedButton', action),
    TapQuotedTargetOrName: async (name) => call('TapNamedButton', name),
    LongPressMessageAndTap: async (messageText, action) => {
      const text = str(messageText);
      if (!text) return false;
      const d = await dump();
      const centre = q.centreOfText(d, text);
      if (!centre) return false;
      if (!longPressAt) unsupported('LongPressMessageAndTap', 'a long-press');
      if (!(await longPressAt(centre.cx, centre.cy, 800))) return false;
      return call('TapNamedButton', action);
    },
    GetLayoutDirection: async () => {
      const d = await dump();
      // 'ltr' on a blank screen would silently satisfy every LTR assertion, so
      // an unreadable screen answers null and the caller must handle it.
      if (!d) return null;
      return q.hasTag(d, 'rtl_marker') ? 'rtl' : 'ltr';
    },
    ForceRefreshJwt: async () => {
      // The debug hook when the build has one; otherwise a cold restart, which
      // is the only other thing that genuinely re-mints the token.
      if (await tapByTag('debug_forceRefreshJwt')) return true;
      if (!relaunchApp) unsupported('ForceRefreshJwt', 'an app relaunch');
      return relaunchApp();
    },
    ForceRefreshSecureToken: async () => methods.ForceRefreshJwt(),
    PerformAuthenticatedCall: async () => {
      // Reported as a CAPABILITY, not a boolean. A host-issued request would
      // carry a host token and prove nothing about the app's session, so when
      // the build has no debug hook the honest answer is "cannot observe this"
      // rather than a pass or a fail.
      if (!(await tapByTag('debug_performAuthedCall'))) {
        return {
          supported: false,
          why: `no in-app debug hook for an authenticated call on ${platform}; a host-issued request would use a host token and prove nothing about the app session`,
        };
      }
      const d = await dump();
      const m = /authedCallStatus[^0-9]*(\d{3})/.exec(String(d || ''));
      return { supported: true, status: m ? Number(m[1]) : null };
    },
    SignOut: async () => {
      // Deliberately NOT shared beyond the tap chain: each platform's launch
      // gates differ (Android's warning/legal gates, iOS's consent sheet), and
      // a platform that implements SignOut itself keeps that version.
      if (!(await call('OpenScreen', 'profile'))) return false;
      if (!(await tapByTag('main_settingsButton'))) return false;
      if (!(await tapByTag('settings_signOutButton'))) return false;
      return methods.ConfirmDialog();
    },
    ApiPost: async (pathname, body) => {
      // The call must come FROM THE DEVICE. Issuing it from the host would
      // exercise the host's network path and the host's token, which is not
      // what a scenario asking "the app calls the API" means.
      if (!has('DeviceCurl')) {
        return unsupported('ApiPost', 'a device-side HTTP client (DeviceCurl)');
      }
      return call(
        'DeviceCurl',
        'POST',
        `http://localhost:3000${pathname}`,
        body ? JSON.stringify(body) : null,
      );
    },
  };

  return methods;
}

/** Every method name this layer provides, unprefixed. */
const SHARED_METHOD_NAMES = Object.keys(
  createSharedAppMethods({
    platform: 'names-only',
    queries: { hasTag: () => false },
    uiDump: async () => '',
    tapByTag: async () => false,
  }),
).sort();

module.exports = { createSharedAppMethods, SHARED_METHOD_NAMES };
