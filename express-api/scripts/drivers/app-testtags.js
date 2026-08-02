/**
 * The testTag vocabulary the journey corpus speaks, in ONE place.
 *
 * WHY IT CAN BE SHARED AT ALL. ShyTalk's UI is Compose Multiplatform — the
 * screens live in `shared/src/commonMain` and both platforms render the SAME
 * `Modifier.testTag(...)` calls. So `room_seatGrid` is not an Android tag that
 * iOS happens to copy; it is one tag, compiled twice. A per-driver copy of these
 * tables would be two transcriptions of a single fact, and the moment one drifts
 * a scenario passes on one phone and fails on the other for no product reason.
 *
 * These tables also translate corpus ENGLISH into tags. A scenario says "the
 * rooms list" or "the chat input" because that is how a person describes it; the
 * mapping from that phrase to `main_roomsTab` belongs here, not in a driver.
 *
 * An unknown key always resolves to undefined and the caller returns false.
 * "I do not know how to check this" must never read as "checked, and it passed".
 */

/** Screens are identified by ANY of several anchors, not one. */
const SCREEN_MARKERS = {
  // Listing several defends against a partial render — the toolbar can be drawn
  // while the seat grid is still loading, and a single-anchor check would call
  // that "not in the room".
  room: ['room_seatGrid', 'room_roomName', 'room_backButton'],
  warning: ['warning_title', 'warning_communityStandardsLink', 'warning_acknowledgeButton'],
  // The moderation gate ABOVE warning. j11 asserts the app shows it "with
  // reason, end date, and appeal button", and it was reported absent while
  // demonstrably on the device — nothing had ever mapped the screen name, so
  // the assertion answered false about a screen it never looked for.
  suspension: [
    'suspension_title',
    'suspension_appealField',
    'suspension_submitAppealButton',
    'suspension_signOutButton',
  ],
  // Reached on a fresh install and after any data clear. Its checkboxes are
  // declared as `checkboxTestTag = "..."` parameters rather than modifier calls,
  // which is also why a tag scan looking only for `testTag("…")` missed them.
  'legal acceptance': [
    'legal_acceptTermsCheckbox',
    'legal_acceptPrivacyCheckbox',
    'legal_acceptCommunityCheckbox',
    'legal_acceptCyberBullyingCheckbox',
    'legal_continueButton',
  ],
  profile: [
    'profile_displayName',
    'profile_walletButton',
    'profile_followButton',
    'profile_messageButton',
  ],
};

/** Corpus route names → the anchor tag that screen renders. */
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

/** Deep-link paths → the anchor tag that destination renders. */
const PATH_TAGS = {
  '/': 'main_roomsTab',
  '/profile': 'profile_displayName',
  '/messages': 'main_messagesTab',
  '/wallet': 'wallet_balance',
  '/settings': 'securitySettingsScreen',
};

/**
 * Event-host controls, by the words the corpus uses for them.
 *
 * The screen tags Start and End separately because they are not the same act:
 * one opens a room to an audience, the other retires it and freezes what
 * everybody earned.
 */
const EVENT_CONTROL_TAGS = {
  'start event': 'eventHost_startButton',
  start: 'eventHost_startButton',
  'end event': 'eventHost_endEventButton',
  end: 'eventHost_endEventButton',
  'schedule event': 'scheduleEvent_confirmButton',
  'new event': 'schedule_newEventButton',
  'event-room link': 'inviteBanner_eventRoomLink',
};

const TABLE_TAGS = { reports: 'reportReview_list' };
const INPUT_TAGS = { chat: 'room_chatInput' };
const NOUN_KIND_TAGS = { 'appeal::button': 'suspension_submitAppealButton' };
const SURFACE_TARGET_TAGS = { 'invite banner::event-room link': 'inviteBanner_eventRoomLink' };
const SEARCH_FIELD_TAGS = { messages: 'newMessage_searchField' };
const DEFAULT_SEARCH_FIELD_TAG = 'newMessage_searchField';

/**
 * What the mic button SAYS in each state.
 *
 * The button's tag is the same in every state, so the tag alone proves nothing —
 * the label is the only thing that distinguishes "open" from "muted", and a
 * check that skipped it would pass on a muted mic while asserting it was live.
 */
const MIC_STATE_HINTS = {
  open: ['Mute'],
  muted: ['Unmute'],
  closed: ['Voice unavailable'],
};

/**
 * Confirm buttons, most specific first.
 *
 * The app names its confirmations after what they confirm rather than sharing
 * one generic tag, so a "tap confirm" step has to try each. Order matters: the
 * generic fallbacks are last so a screen carrying both is resolved to the
 * specific one.
 */
const CONFIRM_TAG_CANDIDATES = [
  'room_endRoomConfirmButton',
  'settings_signOutConfirmButton',
  'settings_clearCacheConfirmButton',
  'settings_unblockConfirmButton',
  'settings_deleteAccountConfirmButton',
  'settings_deletePinConfirmButton',
  'dialog_confirmButton',
  'alertdialog_confirmButton',
  'confirm_button',
];

/**
 * Resolve a deep-link path to its anchor tag.
 *
 * Longest-matching PREFIX wins, so `/profile/50000010` resolves through
 * `/profile`. `/` is exact-only — as a prefix it would match every path and
 * every destination would look like the rooms list.
 */
function resolvePathTag(path) {
  if (!path) return null;
  if (PATH_TAGS[path]) return PATH_TAGS[path];
  let best = null;
  for (const [prefix, tag] of Object.entries(PATH_TAGS)) {
    if (prefix === '/') continue;
    if (path.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) {
      best = { prefix, tag };
    }
  }
  return best ? best.tag : null;
}

/** Resolve a corpus route name ("the rooms list") to its anchor tag. */
function resolveRouteTag(route) {
  const key = String(route || '')
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '');
  return ROUTE_ANCHORS[key] || null;
}

/** Candidate tags for a bottom-nav tab, in the order they are worth trying. */
function navTabCandidates(tab) {
  const lowered = String(tab || '')
    .trim()
    .toLowerCase();
  if (!lowered) return [];
  return [`main_${lowered}Tab`, lowered, `tab_${lowered}`, `bottomNav_${lowered}`];
}

module.exports = {
  EVENT_CONTROL_TAGS,
  SCREEN_MARKERS,
  ROUTE_ANCHORS,
  PATH_TAGS,
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
};
