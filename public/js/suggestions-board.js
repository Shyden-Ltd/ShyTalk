/**
 * ShyTalk Suggestions Board
 *
 * Renders the interactive suggestions board:
 * - Suggestion cards with voting, tags, timestamps
 * - Sort (Most Voted / Newest), filter (status, tag, language), search
 * - Pagination
 * - Login-gated actions (vote, suggest, comment, subscribe)
 * - Suggestion submission with duplicate detection
 * - Subscribe modal with per-event channel toggles
 * - Comment section on accepted suggestions
 * - Error / empty / loading states
 *
 * Loaded after roadmap-app.js. Vanilla JS, no frameworks.
 */
(function () {
  "use strict";

  // ── Constants ──

  // Check isLocal BEFORE isDev — localhost matches both
  var isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var isDev = location.hostname.includes("dev") || isLocal;
  var API_BASE = isLocal ? "http://localhost:3000" : isDev ? "https://dev-api.shytalk.shyden.co.uk" : "https://api.shytalk.shyden.co.uk"; // localhost checked first

  var PAGE_SIZE = 10;
  var SEARCH_DEBOUNCE_MS = 300;
  var SEARCH_MIN_CHARS = 2;
  var TITLE_MAX = 80;
  var DESC_MAX = 5000;
  // Mirrors the server's MAX_VOTE_REASON_LENGTH so the field cannot accept
  // more than the API will keep.
  var MAX_VOTE_REASON = 500;
  // How many comments a card shows before offering "show more".
  var COMMENT_PAGE_SIZE = 10;
  var DUPLICATE_MIN_CHARS = 3;

  // ── Localised option lists ──
  //
  // These are FUNCTIONS, not arrays. Evaluated once at script load they froze
  // whatever locale was active then, so switching language re-rendered the board
  // with the old filter labels and no amount of re-rendering could fix it — the
  // strings had already been baked in (SHY-0252). Called per render, each picks
  // up the current locale.

  function statusOptions() {
    return [
    { value: "", label: sgT("allStatuses") },
    { value: "pending", label: sgT("pending") },
    { value: "accepted", label: sgT("accepted") },
    { value: "planned", label: sgT("planned") },
    { value: "completed", label: sgT("completed") },
    { value: "rejected", label: sgT("rejected") },
    ];
  }

  // These MUST be the server's `VALID_TAGS` (utils/suggestion-constants.js:6).
  // They used to be an invented set — voice/chat/moderation/ui/privacy/economy/
  // accessibility/other — of which only "social" was accepted, so eight of the
  // nine choices came back 400 "Invalid tag". A tag is required to enable
  // Submit, so picking any of them made it impossible to post a suggestion at
  // all (SHY-0248). The vocabulary is the roadmap's own phases, which is why
  // the labels reuse the phase strings.
  function tagOptions() {
    return [
    { value: "", label: sgT("allTags") },
    { value: "compliance", label: sgT("phaseCompliance") },
    { value: "platform", label: sgT("phasePlatform") },
    { value: "revenue", label: sgT("phaseRevenue") },
    { value: "social", label: sgT("phaseSocial") },
    { value: "quality-of-life", label: sgT("phaseQol") },
    { value: "entertainment", label: sgT("phaseEntertainment") },
    { value: "support", label: sgT("phaseSupport") },
    { value: "website", label: sgT("phaseWebsite") },
    ];
  }

  // Language names rendered in their NATIVE form so a user filtering by
  // a language always sees that language in its own script — convention
  // mirrors language-selector.js's LANGUAGES.native list and is the
  // standard pattern for language pickers (cf. Wikipedia language nav,
  // YouTube language selector, etc.).
  function langOptions() {
    return [
    { value: "", label: sgT("allLanguages") },
    { value: "en", label: "English" },
    { value: "ar", label: "العربية" },
    { value: "de", label: "Deutsch" },
    { value: "es", label: "Español" },
    { value: "fr", label: "Français" },
    { value: "hi", label: "हिन्दी" },
    { value: "id", label: "Bahasa Indonesia" },
    { value: "it", label: "Italiano" },
    { value: "ja", label: "日本語" },
    { value: "km", label: "ភាសាខ្មែរ" },
    { value: "ko", label: "한국어" },
    { value: "nl", label: "Nederlands" },
    { value: "pl", label: "Polski" },
    { value: "pt", label: "Português" },
    { value: "ru", label: "Русский" },
    { value: "sv", label: "Svenska" },
    { value: "th", label: "ไทย" },
    { value: "tr", label: "Türkçe" },
    { value: "uk", label: "Українська" },
    { value: "vi", label: "Tiếng Việt" },
    { value: "zh", label: "中文" },
    ];
  }

  // Labels for the notification events the SERVER knows about. The event list
  // itself is whatever `/api/subscriptions/me` returns — this map only names
  // them. Hardcoding the list here is what caused SHY-0248: the client invented
  // `newSuggestion`/`statusChange`/`commentReply`/`watchedUpdate`, which share
  // no key with the server's model, so anything saved landed under names
  // nothing reads. The server owns the vocabulary; we only translate it.
  var SUBSCRIBE_EVENT_LABELS = {
    roadmapUpdate: "subscribe_event_roadmap_update",
    suggestionAccepted: "subscribe_event_suggestion_accepted",
    suggestionPlanned: "subscribe_event_suggestion_planned",
    suggestionCompleted: "subscribe_event_suggestion_completed",
    suggestionRejected: "subscribe_event_suggestion_rejected",
    suggestionMerged: "subscribe_event_suggestion_merged",
    commentOnSuggestion: "subscribe_event_comment_on_suggestion",
  };

  /** Humanise an unlabelled key rather than rendering camelCase at someone. */
  function subscribeEventLabel(key) {
    var i18nKey = SUBSCRIBE_EVENT_LABELS[key];
    if (i18nKey) {
      var translated = sgT(i18nKey);
      if (translated !== i18nKey) return translated;
    }
    return key.replace(/([A-Z])/g, " $1").replace(/^./, function (c) {
      return c.toUpperCase();
    });
  }

  var SUBSCRIBE_CHANNELS = ["email", "push", "inApp", "systemMessage"];

  function channelLabels() {
    return {
    email: sgT("subscribe_channel_email"),
    push: sgT("subscribe_channel_push"),
    inApp: sgT("subscribe_channel_inapp"),
    systemMessage: sgT("subscribe_channel_system"),
    };
  }

  // ── State ──

  function phaseOptions() {
    return [
    { value: "", label: sgT("allPhases") },
    { value: "compliance", label: sgT("phaseCompliance") },
    { value: "platform", label: sgT("phasePlatform") },
    { value: "revenue", label: sgT("phaseRevenue") },
    { value: "social", label: sgT("phaseSocial") },
    // `quality-of-life`, not `qol` — the server's vocabulary again.
    { value: "quality-of-life", label: sgT("phaseQol") },
    { value: "entertainment", label: sgT("phaseEntertainment") },
    { value: "support", label: sgT("phaseSupport") },
    { value: "website", label: sgT("phaseWebsite") },
    ];
  }

  var state = {
    suggestions: [],
    totalCount: 0,
    currentPage: 1,
    sort: "votes",
    filterStatus: "",
    filterTag: "",
    filterLang: "",
    filterPhase: "",
    searchQuery: "",
    isLoading: false,
    error: null,
    // null = good standing (or signed out); otherwise { kind, reason }
    // as told to us by the server's ban gate (SHY-0149).
    standing: null,
    myVotes: {},
    // "Show only mine" is a VIEW, not a server filter: the list response
    // already carries submitterUid, so no extra request is needed.
    mineOnly: false,
    // suggestionId -> how many of its comments are currently shown.
    commentPages: {},
    subscriptionPrefs: null,
    watchList: [],
  };

  var searchTimer = null;
  var duplicateTimer = null;

  // ── Helpers ──

  function escapeHtml(str) {
    if (!str) return "";
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /**
   * Render text with bare URLs turned into links, safely.
   *
   * This takes the RAW text and does its own escaping, segment by segment. The
   * earlier version linkified text that had already been escaped, which is not
   * safe: `escapeHtml` builds a text node and reads `innerHTML`, so it escapes
   * `&`, `<` and `>` but leaves QUOTES intact — and the URL pattern stops only
   * at whitespace. A description containing
   *
   *     https://evil.example/x"onmouseover=alert(1)
   *
   * therefore produced `<a href="https://evil.example/x"onmouseover=alert(1)" …>`,
   * where the quote closes `href` and the remainder parses as an event handler.
   * Stored XSS on a public, user-submitted board.
   *
   * Two defences now, not one:
   *   · the candidate must parse as a real URL whose protocol is http(s), so
   *     `javascript:` and `data:` cannot become an href even if matched;
   *   · the href is attribute-encoded (quotes included) before insertion, so
   *     nothing in it can end the attribute early.
   *
   * `rel="noopener noreferrer"` severs the opener handle a `target="_blank"`
   * would otherwise hand the new page.
   */
  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function isHttpUrl(candidate) {
    try {
      var parsed = new URL(candidate);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (err) {
      return false;
    }
  }

  function renderTextWithLinks(text) {
    if (!text) return "";
    var pattern = /https?:\/\/[^\s<]+/g;
    var out = "";
    var lastIndex = 0;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      // Trailing punctuation belongs to the sentence, not the address.
      var raw = match[0].replace(/[.,:;"')\]]+$/, "");
      out += escapeHtml(text.slice(lastIndex, match.index));
      if (isHttpUrl(raw)) {
        out +=
          '<a href="' +
          escapeAttr(raw) +
          '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(raw) +
          "</a>";
      } else {
        out += escapeHtml(raw);
      }
      lastIndex = match.index + raw.length;
    }
    out += escapeHtml(text.slice(lastIndex));
    return out;
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function $$(sel) {
    return document.querySelectorAll(sel);
  }

  function getUser() {
    return window.shytalkAuth && window.shytalkAuth.currentUser
      ? window.shytalkAuth.currentUser
      : null;
  }

  function hasValidAccount() {
    // Tri-state profile contract (PR #655, see roadmap-auth.js):
    //   null   = Firebase auth fired, ShyTalk profile fetch in-flight (loading)
    //   object = full profile loaded
    //   false  = Firebase auth but no ShyTalk account
    // Treat any non-false profile as "valid for client-side gating" so a
    // click during the profile-fetch race window does not incorrectly route
    // an already-signed-in user to the login modal. The server still verifies
    // the Firebase ID token on every privileged write (apiFetch attaches the
    // Authorization header) — this is a UX/parity fix, never a security
    // relaxation. Pairs with roadmap-app.js bell handler + shared-header.js.
    var auth = window.shytalkAuth;
    return !!(auth && auth.profile !== false);
  }

  /**
   * The signed-in reader's ShyTalk uniqueId, or null.
   *
   * `window.shytalkAuth.profile` is tri-state (null = loading, object = loaded,
   * false = signed in with no ShyTalk account), so only an object carries an
   * id. Nothing on the board could answer "is this mine?" before this, which is
   * why a card never said so (SHY-0247).
   */
  function myUniqueId() {
    var auth = window.shytalkAuth;
    if (!auth || !auth.profile || auth.profile === false) return null;
    var id = auth.profile.uniqueId;
    return id === undefined || id === null ? null : id;
  }

  function getToken() {
    var user = getUser();
    if (!user || typeof user.getIdToken !== "function") {
      return Promise.resolve(null);
    }
    return user.getIdToken();
  }

  function requireAuth(action) {
    if (getUser() && hasValidAccount()) return true;
    showLoginPromptModal(action);
    return false;
  }

  function apiFetch(path, options) {
    options = options || {};
    var headers = options.headers || {};
    headers["Content-Type"] = "application/json";

    return getToken().then(function (token) {
      if (token) {
        headers["Authorization"] = "Bearer " + token;
      }
      return fetch(API_BASE + path, {
        method: options.method || "GET",
        headers: headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      }).then(function (res) {
        if (!res.ok) {
          return res
            .json()
            .catch(function () {
              return { error: "Request failed" };
            })
            .then(function (body) {
              // The server is the authority on standing (SHY-0149): every
              // auth-gated request runs the ban gate, so ANY 403 tells us
              // the answer — no separate "am I banned?" endpoint, and a
              // ban issued mid-session lands on the next call the page
              // makes.
              noteStandingFrom(res.status, body);
              var err = new Error(body.error || "Request failed");
              err.status = res.status;
              throw err;
            });
        }
        // A 200 clears our standing ONLY if the ban gate actually ran on this
        // request. Several suggestion reads are auth-exempt on the server
        // (public browsing) and answer 200 even for a banned user — treating
        // those as proof of good standing would make the blocked banner
        // vanish the moment they sorted or searched. Call sites opt in.
        if (token && options.gated) clearStanding();
        return res.json();
      });
    });
  }

  // ─── Account standing (server-authoritative) ──────────────────
  //
  // `state.standing` is null when the user is in good standing (or signed
  // out) and { kind: 'banned'|'suspended', reason } otherwise. It is only
  // ever set from a real server response — the page never decides on its
  // own who is banned.

  function noteStandingFrom(status, body) {
    if (status !== 403) return;
    var kind = null;
    if (body && body.code === "banned") kind = "banned";
    else if (body && body.error === "Account suspended") kind = "suspended";
    if (!kind) return;

    var changed = !state.standing || state.standing.kind !== kind;
    state.standing = { kind: kind, reason: (body && body.reason) || null };
    if (changed) renderBoard();
  }

  function clearStanding() {
    if (!state.standing) return;
    state.standing = null;
    renderBoard();
  }

  function canAct() {
    return !state.standing;
  }

  /**
   * Ask the server for our standing by making the auth-gated call the
   * board already needs. A 403 flows through noteStandingFrom(); anything
   * else means we may act. Signed-out visitors keep full read access.
   */
  function refreshStanding() {
    if (!getUser()) {
      clearStanding();
      return Promise.resolve();
    }
    return fetchSubscriptionPrefs().catch(function () {
      // Non-403 failures (offline, 500) must not lock a good-standing user
      // out of the UI — noteStandingFrom already handled the 403 case.
    });
  }

  /** The blocked banner shown to a banned or suspended user. */
  function standingBannerHtml() {
    if (!state.standing) return "";
    var msgKey =
      state.standing.kind === "banned" ? "standing_banned" : "standing_suspended";
    var html =
      '<div class="sg-standing-banner" role="alert" data-testid="standing-banner" ' +
      'data-standing="' + escapeHtml(state.standing.kind) + '">' +
      "<span>" + escapeHtml(sgT(msgKey)) + "</span>";
    if (state.standing.reason) {
      html +=
        '<span class="sg-standing-reason" data-testid="standing-reason">' +
        escapeHtml(sgT("standing_reason") + " " + state.standing.reason) +
        "</span>";
    }
    return html + "</div>";
  }

  function relativeTime(dateStr) {
    if (!dateStr) return "";
    // Use Intl.RelativeTimeFormat for locale-aware compact relative times
    // ("5m ago" / "5분 전" / "il y a 5 min"). All 20 supported locales have
    // browser-native formatting — no project-side translations needed.
    // Read the current language fresh on each call so the timestamp updates
    // when the user switches locale post-load.
    var lang = (window.ShyTalkLanguage && window.ShyTalkLanguage.get())
      || (navigator.language || "en").slice(0, 2);
    var rtf;
    try {
      rtf = new Intl.RelativeTimeFormat(lang, { style: "narrow", numeric: "auto" });
    } catch (e) {
      // Fallback for unsupported locales — RFT spec-compliant browsers
      // accept any BCP-47 tag, but be defensive.
      rtf = new Intl.RelativeTimeFormat("en", { style: "narrow", numeric: "auto" });
    }
    var now = Date.now();
    var then = new Date(dateStr).getTime();
    var diffSec = Math.floor((now - then) / 1000);
    // numeric:"auto" returns the locale's "now" / "지금" / etc. for 0-unit deltas.
    if (diffSec < 60) return rtf.format(0, "second");
    var diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return rtf.format(-diffMin, "minute");
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return rtf.format(-diffHr, "hour");
    var diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return rtf.format(-diffDay, "day");
    var diffMon = Math.floor(diffDay / 30);
    if (diffMon < 12) return rtf.format(-diffMon, "month");
    var diffYr = Math.floor(diffMon / 12);
    return rtf.format(-diffYr, "year");
  }

  function statusBadgeClass(status) {
    switch (status) {
      case "accepted":
        return "sg-badge--accepted";
      case "planned":
        return "sg-badge--planned";
      case "completed":
        return "sg-badge--completed";
      case "rejected":
        return "sg-badge--rejected";
      default:
        return "sg-badge--pending";
    }
  }

  /**
   * How many filters are narrowing the board right now.
   *
   * `searchQuery` counts: a search that matches nothing looks exactly like a
   * filter that matches nothing, and both are undone by the same button.
   */
  function activeFilterCount() {
    var n = 0;
    if (state.filterStatus) n++;
    if (state.filterTag) n++;
    if (state.filterLang) n++;
    if (state.filterPhase) n++;
    if (state.searchQuery) n++;
    return n;
  }

  function clearAllFilters() {
    state.filterStatus = "";
    state.filterTag = "";
    state.filterLang = "";
    state.filterPhase = "";
    state.searchQuery = "";
    state.page = 1;
    fetchSuggestions();
  }

  function isVotingDisabled(status) {
    return (
      status === "planned" || status === "completed" || status === "rejected"
    );
  }

  // ── API calls ──

  function fetchSuggestions() {
    state.isLoading = true;
    state.error = null;
    renderBoard();

    var params = "?page=" + state.currentPage + "&limit=" + PAGE_SIZE;
    params += "&sort=" + state.sort;
    if (state.filterStatus)
      params += "&status=" + encodeURIComponent(state.filterStatus);
    if (state.filterTag)
      params += "&tag=" + encodeURIComponent(state.filterTag);
    if (state.filterLang)
      params += "&lang=" + encodeURIComponent(state.filterLang);
    if (state.filterPhase)
      params += "&phase=" + encodeURIComponent(state.filterPhase);

    var path = state.searchQuery
      ? "/api/suggestions/search" +
        params +
        "&q=" +
        encodeURIComponent(state.searchQuery)
      : "/api/suggestions" + params;

    apiFetch(path)
      .then(function (data) {
        state.suggestions = data.suggestions || [];
        state.totalCount = data.total || 0;
        if (data.myVotes) {
          state.myVotes = data.myVotes;
        }
        state.isLoading = false;
        state.error = null;
        renderBoard();
      })
      .catch(function (err) {
        state.isLoading = false;
        state.error = err.message || "Failed to load suggestions";
        renderBoard();
      });
  }

  function submitVote(suggestionId, direction, reason, visibility) {
    if (!requireAuth("vote on suggestions")) return;

    var currentVote = state.myVotes[suggestionId];
    var method;
    var body;

    if (currentVote === direction) {
      // Toggle off
      method = "DELETE";
      body = undefined;
    } else {
      method = "POST";
      body = { direction: direction };
      if (reason) body.reason = reason;
      if (visibility) body.visibility = visibility;
    }

    apiFetch("/api/suggestions/" + suggestionId + "/vote", {
      method: method,
      body: body,
      gated: true,
    })
      .then(function (data) {
        if (method === "DELETE") {
          delete state.myVotes[suggestionId];
        } else {
          state.myVotes[suggestionId] = direction;
        }
        // Update the suggestion in-place
        for (var i = 0; i < state.suggestions.length; i++) {
          if (state.suggestions[i].id === suggestionId) {
            state.suggestions[i].score = data.score;
            state.suggestions[i].upvotes = data.upvotes;
            state.suggestions[i].downvotes = data.downvotes;
            break;
          }
        }
        renderBoard();
      })
      .catch(function (err) {
        showToast(
          sgT("toast_vote_failed") +
            ": " +
            (err.message || sgT("unknown_error")),
        );
      });
  }

  function submitSuggestion(title, description, tag, lang, contactOptIn) {
    return apiFetch("/api/suggestions", {
      method: "POST",
      body: {
        title: title,
        description: description,
        tag: tag,
        language: lang,
        contactOptIn: contactOptIn,
      },
      gated: true,
    });
  }

  function searchDuplicates(query) {
    return apiFetch(
      "/api/suggestions/search?q=" + encodeURIComponent(query) + "&limit=3",
    );
  }

  function checkBlockedTopics(query) {
    return apiFetch("/api/suggestions/blocked?q=" + encodeURIComponent(query));
  }

  function submitComment(suggestionId, text) {
    return apiFetch("/api/suggestions/" + suggestionId + "/comments", {
      method: "POST",
      body: { text: text },
      gated: true,
    });
  }

  // `gated: true` marks the routes the server runs the ban gate on, so a 200
  // from them is real evidence of good standing (see apiFetch).
  function fetchSubscriptionPrefs() {
    return apiFetch("/api/subscriptions/me", { gated: true });
  }

  // The server reads `channelPreferences` + `emailConsent` (routes/
  // subscriptions.js:73). Sending `preferences`/`gdprEmailConsent` — as this
  // did — matched neither, so every save returned 200 with the toggles silently
  // dropped and the UI still said "saved" (SHY-0248).
  function saveSubscriptionPrefs(channelPreferences) {
    return apiFetch("/api/subscriptions/me", {
      method: "PUT",
      // Enabling an email channel IS the consent, per the GDPR notice shown in
      // the modal; the server refuses email channels without it.
      body: { channelPreferences: channelPreferences, emailConsent: true },
      gated: true,
    });
  }

  // Server contract is `{ type, id }` — `{ suggestionId }` was rejected 400
  // "Type and ID required" on every bell click (SHY-0248).
  function watchSuggestion(suggestionId) {
    return apiFetch("/api/subscriptions/me/watch", {
      method: "POST",
      body: { type: "suggestion", id: suggestionId },
      gated: true,
    });
  }

  function unwatchSuggestion(suggestionId) {
    return apiFetch("/api/subscriptions/me/watch/" + encodeURIComponent(suggestionId), {
      method: "DELETE",
      gated: true,
    });
  }

  /** Resolve a watched id to a display title using whatever the board holds. */
  function watchListEntry(id) {
    for (var i = 0; i < state.suggestions.length; i++) {
      if (state.suggestions[i].id === id) {
        return { id: id, title: state.suggestions[i].title };
      }
    }
    return { id: id, title: null };
  }

  function isWatched(id) {
    for (var i = 0; i < state.watchList.length; i++) {
      if (state.watchList[i].id === id) return true;
    }
    return false;
  }

  /**
   * Adopt what `/api/subscriptions/me` returned.
   *
   * The field names matter: the server sends `channelPreferences` and
   * `watchedSuggestions`/`watchedFeatures`, NOT `preferences`/`watchList`.
   * Reading the wrong ones meant the modal always rendered defaults and an
   * empty watch list no matter what had been saved (SHY-0248).
   */
  function applySubscriptionState(prefs) {
    state.subscriptionPrefs = prefs.channelPreferences || {};
    var watched = (prefs.watchedSuggestions || []).concat(prefs.watchedFeatures || []);
    state.watchList = watched.map(watchListEntry);
  }

  // ── Toast ──

  var toastTimer = null;

  function showToast(msg) {
    var toast = document.getElementById("login-toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("visible");
    }, 3500);
  }

  // ── Login prompt modal ──

  /**
   * Ask, optionally, WHY — then cast the vote.
   *
   * The API has always accepted `reason` + `visibility` on a vote
   * (`POST /suggestions/:id/vote`), but nothing in the UI ever collected them,
   * so every vote arrived as a bare number and the board could never show why
   * anything was popular (SHY-0247).
   *
   * The reason is OPTIONAL by design: "Just vote" casts it with no reason, so
   * the modal never becomes a toll gate on voting.
   */
  function openVoteReasonModal(suggestionId, direction) {
    var existing = document.getElementById("sg-vote-reason-overlay");
    if (existing) existing.remove();

    var html =
      '<div class="sg-modal-overlay" id="sg-vote-reason-overlay" data-testid="vote-reason-modal">' +
      '<div class="sg-modal" role="dialog" aria-modal="true" aria-label="' +
      escapeHtml(sgT("voteReasonTitle")) +
      '">' +
      '<div class="sg-modal-header"><h3>' +
      escapeHtml(sgT("voteReasonTitle")) +
      "</h3>" +
      '<button class="sg-modal-close" data-testid="reason-close" aria-label="' +
      escapeHtml(sgT("close")) +
      '">&times;</button></div>' +
      '<div class="sg-modal-body">' +
      '<textarea class="sg-textarea" data-testid="reason-input" maxlength="' +
      MAX_VOTE_REASON +
      '" placeholder="' +
      escapeHtml(sgT("voteReasonPlaceholder")) +
      '"></textarea>' +
      '<div class="sg-reason-visibility">' +
      '<label><input type="radio" name="sg-reason-vis" value="public" data-testid="reason-public" checked> ' +
      escapeHtml(sgT("voteReasonPublic")) +
      "</label>" +
      '<label><input type="radio" name="sg-reason-vis" value="private" data-testid="reason-private"> ' +
      escapeHtml(sgT("voteReasonPrivate")) +
      "</label>" +
      "</div></div>" +
      '<div class="sg-modal-footer">' +
      '<button class="sg-btn" data-testid="reason-skip">' +
      escapeHtml(sgT("voteReasonSkip")) +
      "</button>" +
      '<button class="sg-btn sg-btn--primary" data-testid="reason-submit">' +
      escapeHtml(sgT("voteReasonSubmit")) +
      "</button>" +
      "</div></div></div>";

    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    var overlay = wrap.firstChild;
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
    }
    function cast(withReason) {
      var input = overlay.querySelector('[data-testid="reason-input"]');
      var priv = overlay.querySelector('[data-testid="reason-private"]');
      var reason = withReason ? (input.value || "").trim() : "";
      close();
      // An empty reason is still a valid vote — pass undefined so the request
      // body stays exactly as it was before this modal existed.
      submitVote(
        suggestionId,
        direction,
        reason || undefined,
        reason ? (priv.checked ? "private" : "public") : undefined,
      );
    }

    overlay
      .querySelector('[data-testid="reason-close"]')
      .addEventListener("click", close);
    overlay
      .querySelector('[data-testid="reason-skip"]')
      .addEventListener("click", function () {
        cast(false);
      });
    overlay
      .querySelector('[data-testid="reason-submit"]')
      .addEventListener("click", function () {
        cast(true);
      });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
  }

  /**
   * Confirm before withdrawing. Taking a suggestion back is not undoable, and
   * the buttons sit next to Edit, so a mis-tap must not be able to delete
   * someone's submission outright.
   */
  function openWithdrawConfirm(suggestionId) {
    var existing = document.getElementById("sg-confirm-overlay");
    if (existing) existing.remove();

    var html =
      '<div class="sg-modal-overlay" id="sg-confirm-overlay" data-testid="confirm-dialog">' +
      '<div class="sg-modal" role="dialog" aria-modal="true" aria-label="' +
      escapeHtml(sgT("withdrawConfirmTitle")) +
      '">' +
      '<div class="sg-modal-header"><h3>' +
      escapeHtml(sgT("withdrawConfirmTitle")) +
      "</h3></div>" +
      '<div class="sg-modal-body"><p>' +
      escapeHtml(sgT("withdrawConfirmBody")) +
      "</p></div>" +
      '<div class="sg-modal-footer">' +
      '<button class="sg-btn" data-testid="confirm-cancel">' +
      escapeHtml(sgT("cancel")) +
      "</button>" +
      '<button class="sg-btn sg-btn--primary" data-testid="confirm-withdraw">' +
      escapeHtml(sgT("withdrawSuggestion")) +
      "</button>" +
      "</div></div></div>";

    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    var overlay = wrap.firstChild;
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
    }
    overlay
      .querySelector('[data-testid="confirm-cancel"]')
      .addEventListener("click", close);
    overlay
      .querySelector('[data-testid="confirm-withdraw"]')
      .addEventListener("click", function () {
        close();
        apiFetch("/api/suggestions/" + suggestionId, {
          method: "DELETE",
          gated: true,
        })
          .then(function () {
            showToast(sgT("withdrawnToast"));
            fetchSuggestions();
          })
          .catch(function (err) {
            showToast(
              sgT("withdrawFailedToast") +
                ": " +
                (err.message || sgT("unknown_error")),
            );
          });
      });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
  }

  /**
   * The notification inbox.
   *
   * `GET /api/notifications` has existed all along, but the web board never
   * offered a way to read what it returns — replies to your comments and status
   * changes on suggestions you watch arrived nowhere (SHY-0247). Opened from
   * the toolbar; an empty inbox says so plainly rather than showing a blank box.
   */
  function openNotificationInbox() {
    if (!requireAuth("see your notifications")) return;

    var existing = document.getElementById("sg-notif-overlay");
    if (existing) existing.remove();

    var overlay = document.createElement("div");
    overlay.className = "sg-modal-overlay";
    overlay.id = "sg-notif-overlay";
    overlay.setAttribute("data-testid", "notif-inbox");
    overlay.innerHTML =
      '<div class="sg-modal" role="dialog" aria-modal="true" aria-label="' +
      escapeHtml(sgT("notifications")) +
      '">' +
      '<div class="sg-modal-header"><h3>' +
      escapeHtml(sgT("notifications")) +
      "</h3>" +
      '<button class="sg-modal-close" data-testid="notif-close" aria-label="' +
      escapeHtml(sgT("close")) +
      '">&times;</button></div>' +
      '<div class="sg-modal-body" data-testid="notif-body">' +
      '<p class="sg-text-muted">' +
      escapeHtml(sgT("loading")) +
      "</p></div></div>";
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
    }
    overlay
      .querySelector('[data-testid="notif-close"]')
      .addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });

    var body = overlay.querySelector('[data-testid="notif-body"]');
    apiFetch("/api/notifications", { gated: true })
      .then(function (data) {
        var items = (data && data.notifications) || [];
        if (items.length === 0) {
          body.innerHTML =
            '<p class="sg-notif-empty" data-testid="notif-empty">' +
            escapeHtml(sgT("notifAllCaughtUp")) +
            "</p>";
          return;
        }
        var html = '<ul class="sg-notif-list" data-testid="notif-list">';
        for (var i = 0; i < items.length; i++) {
          html +=
            '<li class="sg-notif-item' +
            (items[i].isRead ? "" : " sg-notif-item--unread") +
            '">' +
            escapeHtml(items[i].message || items[i].title || "") +
            "</li>";
        }
        body.innerHTML = html + "</ul>";
      })
      .catch(function (err) {
        // A failed load must SAY so — an empty box would read as "all caught
        // up", which is the opposite of the truth.
        body.innerHTML =
          '<p class="sg-notif-error" data-testid="notif-error">' +
          escapeHtml(
            sgT("notifLoadFailed") + ": " + (err.message || sgT("unknown_error")),
          ) +
          "</p>";
      });
  }

  function showLoginPromptModal(action) {
    var existing = document.getElementById("sg-login-modal-overlay");
    if (existing) existing.remove();

    var html =
      '<div class="sg-modal-overlay" id="sg-login-modal-overlay" data-testid="login-modal-overlay">' +
      '<div class="sg-modal" role="dialog" aria-modal="true" aria-label="'+escapeHtml(sgT("signInRequired"))+'">' +
      '<div class="sg-modal-header">' +
      "<h3>"+sgT("signInRequired")+"</h3>" +
      '<button class="sg-modal-close" data-testid="login-modal-close" aria-label="'+escapeHtml(sgT("close"))+'">&times;</button>' +
      "</div>" +
      '<div class="sg-modal-body">' +
      "<p>" +
      escapeHtml(sgT("signInTo")) +
      " " +
      escapeHtml(action || "perform this action") +
      ".</p>" +
      '<div class="auth-buttons" style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:16px 0;">' +
        '<button class="auth-google-btn" data-testid="auth-google-btn" aria-label="'+escapeHtml(sgT("signInGoogle"))+'" style="display:inline-flex;align-items:center;gap:10px;padding:10px 24px;background:#fff;color:#3c4043;border:1px solid #dadce0;border-radius:4px;font-size:14px;font-weight:500;cursor:pointer;min-height:44px;">' +
          '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>' +
          // The aria-label beside this was translated while the VISIBLE text
          // was hardcoded English — screen-reader users got German, everyone
          // else got English (SHY-0252).
          "<span>" + escapeHtml(sgT("signInGoogle")) + "</span>" +
        "</button>" +
        '<button class="auth-apple-btn" data-testid="auth-apple-btn" aria-label="'+escapeHtml(sgT("signInApple"))+'" style="display:inline-flex;align-items:center;gap:10px;padding:10px 24px;background:#000;color:#fff;border:none;border-radius:4px;font-size:14px;font-weight:500;cursor:pointer;min-height:44px;">' +
          '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="#fff" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.53-3.23 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>' +
          "<span>" + escapeHtml(sgT("signInApple")) + "</span>" +
        "</button>" +
      "</div>" +
      '<p style="color:var(--text-secondary,#888);font-size:0.8rem;text-align:center;">Don\'t have an account? Download ShyTalk to create one.</p>' +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>";

    document.body.insertAdjacentHTML("beforeend", html);

    var overlay = document.getElementById("sg-login-modal-overlay");
    var closeBtn = overlay.querySelector(".sg-modal-close");
    var modalContent = overlay.querySelector(".sg-modal");

    function close() {
      overlay.remove();
      document.removeEventListener("click", outsideClickHandler, true);
      document.removeEventListener("keydown", keyHandler);
    }

    // Wire up Google/Apple sign-in buttons
    // signInWithRedirect navigates away from the page entirely,
    // so no need to close the modal — the page reloads after auth.
    var googleSignIn = overlay.querySelector(".auth-google-btn");
    var appleSignIn = overlay.querySelector(".auth-apple-btn");
    if (googleSignIn) {
      googleSignIn.addEventListener("click", function () {
        if (window.shytalkAuth && window.shytalkAuth.signInWithGoogle) {
          window.shytalkAuth.signInWithGoogle();
        }
      });
    }
    if (appleSignIn) {
      appleSignIn.addEventListener("click", function () {
        if (window.shytalkAuth && window.shytalkAuth.signInWithApple) {
          window.shytalkAuth.signInWithApple();
        }
      });
    }

    function outsideClickHandler(e) {
      if (!modalContent || !modalContent.contains(e.target)) {
        close();
      }
    }

    function keyHandler(e) {
      if (e.key === "Escape") close();
    }

    closeBtn.addEventListener("click", close);
    // Delay attaching the outside-click handler by one tick to avoid
    // catching the same click that opened the modal.
    setTimeout(function () {
      document.addEventListener("click", outsideClickHandler, true);
    }, 0);
    document.addEventListener("keydown", keyHandler);
  }

  // ── Subscribe modal ──

  function openSubscribeModal(featureId) {
    // Always open the subscribe modal container — content varies by auth state
    var existing = document.getElementById("sg-subscribe-overlay");
    if (existing) existing.remove();

    var bodyHtml = '<div class="sg-loading">Loading preferences...</div>';

    var html =
      '<div class="sg-modal-overlay subscribe-modal" id="sg-subscribe-overlay" data-testid="subscribe-modal">' +
      '<div class="sg-modal sg-modal--wide" role="dialog" aria-modal="true" aria-label="'+escapeHtml(sgT("subscribe"))+'">' +
      '<div class="sg-modal-header">' +
      "<h3>"+sgT("subscribe")+"</h3>" +
      '<button class="sg-modal-close" data-testid="subscribe-modal-close" aria-label="'+escapeHtml(sgT("close"))+'">&times;</button>' +
      "</div>" +
      '<div class="sg-modal-body" id="sg-subscribe-body">' +
      bodyHtml +
      "</div>" +
      '<div class="sg-gdpr-consent" data-testid="subscribe-gdpr-notice" data-i18n="gdprEmailConsent">' +
      "By enabling email notifications you consent to receive updates. You can unsubscribe at any time using the link in each email or by returning to this page." +
      "</div>" +
      '<div class="sg-modal-actions">' +
      '<button class="sg-btn sg-btn--secondary" data-testid="subscribe-modal-cancel">' + sgT("cancel") + '</button>' +
      '<button class="sg-btn sg-btn--primary" data-testid="subscribe-modal-save">Save</button>' +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>";

    document.body.insertAdjacentHTML("beforeend", html);

    var overlay = document.getElementById("sg-subscribe-overlay");
    var closeBtn = overlay.querySelector(".sg-modal-close");
    var cancelBtn = overlay.querySelector(
      '[data-testid="subscribe-modal-cancel"]',
    );
    var saveBtn = overlay.querySelector('[data-testid="subscribe-modal-save"]');
    var body = document.getElementById("sg-subscribe-body");

    function close() {
      overlay.remove();
    }

    closeBtn.addEventListener("click", close);
    if (cancelBtn) cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });

    // Load preferences, then add the bell's suggestion to the watch list if we
    // were opened from one — the watch is the point of the click, so doing it
    // after the fetch means the list we render already includes it.
    fetchSubscriptionPrefs()
      .then(function (prefs) {
        applySubscriptionState(prefs);
        if (!featureId) return null;
        if (isWatched(featureId)) return null;
        return watchSuggestion(featureId).then(function () {
          state.watchList = state.watchList.concat([watchListEntry(featureId)]);
        });
      })
      .catch(function (err) {
        // Distinguish "nothing to show" from "we could not find out" — the old
        // silent reset rendered an empty watch list either way.
        state.subscriptionPrefs = state.subscriptionPrefs || {};
        state.watchList = state.watchList || [];
        showToast(
          sgT("subscribe_load_failed") + ": " + (err.message || sgT("subscribe_unknown_error")),
        );
      })
      .then(function () {
        renderSubscribeBody(body, featureId);
      });

    saveBtn.addEventListener("click", function () {
      saveBtn.disabled = true;
      saveBtn.textContent = sgT("subscribe_btn_saving");

      // Collect toggled values. The rows come from the server's own event list
      // (see renderSubscribeBody), so read them back off the DOM rather than a
      // second hardcoded list that could drift from what was rendered.
      var prefs = {};
      var toggles = overlay.querySelectorAll('[data-testid^="subscribe-toggle-"]');
      for (var t = 0; t < toggles.length; t++) {
        var testid = toggles[t].getAttribute("data-testid").slice("subscribe-toggle-".length);
        var sep = testid.lastIndexOf("-");
        var evtKey = testid.slice(0, sep);
        var chKey = testid.slice(sep + 1);
        if (!prefs[evtKey]) prefs[evtKey] = {};
        prefs[evtKey][chKey] = toggles[t].checked;
      }

      saveSubscriptionPrefs(prefs)
        .then(function () {
          showToast(sgT("subscribe_toast_saved"));
          close();
        })
        .catch(function (err) {
          showToast(
            sgT("subscribe_toast_save_failed") +
              ": " +
              (err.message || sgT("subscribe_unknown_error")),
          );
          saveBtn.disabled = false;
          saveBtn.textContent = sgT("save");
        });
    });
  }

  function renderSubscribeBody(container, featureId) {
    var prefs = state.subscriptionPrefs || {};
    var html = "";

    // Event toggles table
    html += '<div class="sg-subscribe-grid">';
    html += '<div class="sg-subscribe-row sg-subscribe-row--header">';
    html +=
      '<div class="sg-subscribe-cell sg-subscribe-cell--event">' +
      escapeHtml(sgT("subscribe_event_header")) +
      "</div>";
    for (var c = 0; c < SUBSCRIBE_CHANNELS.length; c++) {
      html +=
        '<div class="sg-subscribe-cell sg-subscribe-cell--channel">' +
        escapeHtml(channelLabels()[SUBSCRIBE_CHANNELS[c]]) +
        "</div>";
    }
    html += "</div>";

    var eventKeys = Object.keys(prefs);
    for (var e = 0; e < eventKeys.length; e++) {
      var evtKey = eventKeys[e];
      var evtPrefs = prefs[evtKey] || {};
      html += '<div class="sg-subscribe-row">';
      html +=
        '<div class="sg-subscribe-cell sg-subscribe-cell--event">' +
        escapeHtml(subscribeEventLabel(evtKey)) +
        "</div>";
      for (var ci = 0; ci < SUBSCRIBE_CHANNELS.length; ci++) {
        var ch = SUBSCRIBE_CHANNELS[ci];
        var checked = evtPrefs[ch] ? " checked" : "";
        html +=
          '<div class="sg-subscribe-cell sg-subscribe-cell--channel">' +
          '<label class="sg-toggle-label">' +
          '<input type="checkbox" data-testid="subscribe-toggle-' +
          evtKey +
          "-" +
          ch +
          '"' +
          checked +
          " />" +
          '<span class="sg-toggle-visual"></span>' +
          "</label>" +
          "</div>";
      }
      html += "</div>";
    }
    html += "</div>";

    // Watch list
    html += '<div class="sg-watch-section">';
    html += "<h4>" + escapeHtml(sgT("subscribe_watch_header")) + "</h4>";
    if (state.watchList.length === 0) {
      html +=
        '<p class="sg-text-muted" data-testid="watch-empty">' +
        escapeHtml(sgT("subscribe_watch_empty")) +
        "</p>";
    } else {
      html += '<ul class="sg-watch-list" data-testid="watch-list">';
      for (var w = 0; w < state.watchList.length; w++) {
        var item = state.watchList[w];
        // The API stores watches as bare ids, so resolve a title from whatever
        // the board has already loaded and fall back to the id — showing a raw
        // document id is poor, but showing nothing at all is worse.
        var watchId = item.id;
        html +=
          '<li class="sg-watch-item" data-testid="watch-item">' +
          "<span>" +
          escapeHtml(item.title || watchId) +
          "</span>" +
          '<button class="sg-watch-remove" data-id="' +
          escapeHtml(watchId) +
          '" data-testid="watch-remove-' +
          escapeHtml(watchId) +
          '" aria-label="' +
          escapeHtml(sgT("subscribe_watch_remove")) +
          '">&times;</button>' +
          "</li>";
      }
      html += "</ul>";
    }
    html += "</div>";

    container.innerHTML = html;

    var removeBtns = container.querySelectorAll(".sg-watch-remove");
    for (var r = 0; r < removeBtns.length; r++) {
      removeBtns[r].addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        var btn = this;
        btn.disabled = true;
        unwatchSuggestion(id)
          .then(function () {
            state.watchList = state.watchList.filter(function (it) {
              return it.id !== id;
            });
            renderSubscribeBody(container, featureId);
          })
          .catch(function (err) {
            btn.disabled = false;
            showToast(
              sgT("subscribe_watch_remove_failed") +
                ": " +
                (err.message || sgT("subscribe_unknown_error")),
            );
          });
      });
    }
  }

  // ── Suggestion form modal ──

  /**
   * The suggest form, in either mode.
   *
   * Passing a suggestion opens it for EDITING: the fields arrive pre-filled and
   * a banner says the change sends it back for review, because it does — the
   * API resets a pending suggestion's review state on PUT. Nothing offered this
   * before, so a typo in your own pending suggestion was permanent (SHY-0247).
   */
  function openSuggestModal(editing) {
    if (!requireAuth("submit suggestions")) return;

    var existing = document.getElementById("sg-suggest-overlay");
    if (existing) existing.remove();

    var tagOpts = "";
    var tagList = tagOptions();
    for (var t = 1; t < tagList.length; t++) {
      tagOpts +=
        '<option value="' +
        tagList[t].value +
        '">' +
        escapeHtml(tagList[t].label) +
        "</option>";
    }

    var langOpts = "";
    var langList = langOptions();
    for (var l = 1; l < langList.length; l++) {
      langOpts +=
        '<option value="' +
        langList[l].value +
        '">' +
        escapeHtml(langList[l].label) +
        "</option>";
    }

    var html =
      '<div class="sg-modal-overlay" id="sg-suggest-overlay" data-testid="suggest-modal-overlay">' +
      '<div class="sg-modal sg-modal--wide" role="dialog" aria-modal="true" aria-label="'+escapeHtml(sgT("suggestFeature"))+'">' +
      '<div class="sg-modal-header">' +
      "<h3>"+sgT("suggestFeature")+"</h3>" +
      '<button class="sg-modal-close" data-testid="suggest-modal-close" aria-label="'+escapeHtml(sgT("close"))+'">&times;</button>' +
      "</div>" +
      '<div class="sg-modal-body">' +
      '<div class="sg-form-group">' +
      '<label for="sg-suggest-title" class="sg-label">Title</label>' +
      '<input type="text" id="sg-suggest-title" class="sg-input" maxlength="' +
      TITLE_MAX +
      '" placeholder="Brief title for your suggestion" data-testid="suggest-title-input" />' +
      '<span class="sg-char-count" id="sg-title-count" data-testid="suggest-title-count">0/' +
      TITLE_MAX +
      "</span>" +
      "</div>" +
      (editing
        ? '<div class="sg-rereview-warning" data-testid="re-review-warning">' +
          escapeHtml(sgT("reReviewWarning")) +
          "</div>"
        : "") +
      '<div id="sg-duplicate-results" class="sg-duplicate-results" data-testid="suggest-duplicates"></div>' +
      '<div class="sg-form-group">' +
      '<label for="sg-suggest-desc" class="sg-label">Description</label>' +
      '<textarea id="sg-suggest-desc" class="sg-textarea" maxlength="' +
      DESC_MAX +
      '" rows="4" placeholder="Describe the feature in detail..." data-testid="suggest-desc-input"></textarea>' +
      '<span class="sg-char-count" id="sg-desc-count" data-testid="suggest-desc-count">0/' +
      DESC_MAX +
      "</span>" +
      "</div>" +
      '<div class="sg-form-row">' +
      '<div class="sg-form-group sg-form-group--half">' +
      '<label for="sg-suggest-tag" class="sg-label">Tag</label>' +
      '<select id="sg-suggest-tag" class="sg-select" data-testid="suggest-tag-select">' +
      '<option value="">Select a tag</option>' +
      tagOpts +
      "</select>" +
      "</div>" +
      '<div class="sg-form-group sg-form-group--half">' +
      '<label for="sg-suggest-lang" class="sg-label">Language</label>' +
      '<select id="sg-suggest-lang" class="sg-select" data-testid="suggest-lang-select">' +
      langOpts +
      "</select>" +
      "</div>" +
      "</div>" +
      '<label class="sg-checkbox-label" data-testid="suggest-contact-optin">' +
      '<input type="checkbox" id="sg-suggest-contact" />' +
      " ShyTalk may contact me for feedback on this suggestion" +
      "</label>" +
      "</div>" +
      '<div class="sg-modal-actions">' +
      '<button class="sg-btn sg-btn--secondary" data-testid="suggest-modal-cancel">' + sgT("cancel") + '</button>' +
      '<button class="sg-btn sg-btn--primary" data-testid="suggest-modal-submit" disabled>Submit</button>' +
      "</div>" +
      "</div>" +
      "</div>" +
      "</div>";

    document.body.insertAdjacentHTML("beforeend", html);

    var overlay = document.getElementById("sg-suggest-overlay");
    var closeBtn = overlay.querySelector(".sg-modal-close");
    var cancelBtn = overlay.querySelector(
      '[data-testid="suggest-modal-cancel"]',
    );
    var submitBtn = overlay.querySelector(
      '[data-testid="suggest-modal-submit"]',
    );
    var titleInput = document.getElementById("sg-suggest-title");
    var descInput = document.getElementById("sg-suggest-desc");
    var tagSelect = document.getElementById("sg-suggest-tag");
    var langSelect = document.getElementById("sg-suggest-lang");

    // Pre-fill when editing: an edit form that opens blank would silently wipe
    // whatever the person wrote the first time.
    if (editing) {
      titleInput.value = editing.title || "";
      descInput.value = editing.description || "";
      tagSelect.value = editing.tag || (editing.tags && editing.tags[0]) || "";
      langSelect.value = editing.language || "";
    }
    var contactCheckbox = document.getElementById("sg-suggest-contact");
    var titleCount = document.getElementById("sg-title-count");
    var descCount = document.getElementById("sg-desc-count");
    var duplicateResults = document.getElementById("sg-duplicate-results");

    // Pre-select language
    var currentLang =
      window.ShyTalkLanguage && typeof window.ShyTalkLanguage.get === "function"
        ? window.ShyTalkLanguage.get()
        : "en";
    langSelect.value = currentLang;

    function close() {
      overlay.remove();
    }

    function validateForm() {
      var valid = titleInput.value.trim().length >= 3 && tagSelect.value !== "";
      submitBtn.disabled = !valid;
    }

    closeBtn.addEventListener("click", close);
    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });

    // Character counters
    titleInput.addEventListener("input", function () {
      titleCount.textContent = titleInput.value.length + "/" + TITLE_MAX;
      validateForm();

      // Duplicate detection
      clearTimeout(duplicateTimer);
      var query = titleInput.value.trim();
      if (query.length >= DUPLICATE_MIN_CHARS) {
        duplicateTimer = setTimeout(function () {
          searchDuplicates(query)
            .then(function (data) {
              var suggestions = data.suggestions || [];
              if (suggestions.length === 0) {
                duplicateResults.innerHTML = "";
                return;
              }
              var dHtml =
                '<div class="sg-duplicate-banner">' +
                '<p class="sg-duplicate-title">Similar suggestions found:</p>';
              for (var i = 0; i < Math.min(suggestions.length, 3); i++) {
                var s = suggestions[i];
                dHtml +=
                  '<div class="sg-duplicate-item" data-testid="duplicate-item-' +
                  i +
                  '">' +
                  '<div class="sg-duplicate-item-text">' +
                  "<strong>" +
                  escapeHtml(s.title) +
                  "</strong>" +
                  '<span class="sg-text-muted"> — ' +
                  escapeHtml((s.description || "").substring(0, 80)) +
                  "</span>" +
                  "</div>" +
                  '<div class="sg-duplicate-actions">' +
                  '<button class="sg-btn sg-btn--xs sg-btn--primary sg-duplicate-match" data-id="' +
                  s.id +
                  '" data-testid="duplicate-match-' +
                  i +
                  '">' + escapeHtml(sgT("duplicate_match")) + '</button>' +
                  '<button class="sg-btn sg-btn--xs sg-btn--secondary sg-duplicate-diff" data-testid="duplicate-diff-' +
                  i +
                  '">' + escapeHtml(sgT("duplicate_different")) + '</button>' +
                  "</div>" +
                  "</div>";
              }
              dHtml += "</div>";
              duplicateResults.innerHTML = dHtml;

              // Handle "Yes this is what I meant" — navigate to that suggestion
              var matchBtns = duplicateResults.querySelectorAll(
                ".sg-duplicate-match",
              );
              for (var m = 0; m < matchBtns.length; m++) {
                matchBtns[m].addEventListener("click", function () {
                  // The toast promises a redirect, so actually go there. This
                  // used to close the form, say "Redirecting to existing
                  // suggestion", and do nothing at all — the `data-id` written
                  // onto the button was never read, so the whole point of
                  // duplicate detection (send me to the one that exists
                  // instead of making another) quietly failed (SHY-0245).
                  var targetId = this.getAttribute("data-id");
                  close();
                  showToast(sgT("toast_redirecting_to_existing"));
                  if (!targetId) return;
                  location.hash = "suggestion-" + targetId;
                  var card = document.querySelector(
                    '[data-testid="suggestion-card-' + targetId + '"]',
                  );
                  if (card && card.scrollIntoView) {
                    card.scrollIntoView({ behavior: "smooth", block: "center" });
                  }
                });
              }

              // Handle "No my idea is different"
              var diffBtns =
                duplicateResults.querySelectorAll(".sg-duplicate-diff");
              for (var d = 0; d < diffBtns.length; d++) {
                diffBtns[d].addEventListener("click", function () {
                  duplicateResults.innerHTML = "";
                });
              }
            })
            .catch(function () {
              duplicateResults.innerHTML = "";
            });
        }, SEARCH_DEBOUNCE_MS);
      } else {
        duplicateResults.innerHTML = "";
      }
    });

    descInput.addEventListener("input", function () {
      descCount.textContent = descInput.value.length + "/" + DESC_MAX;
    });

    tagSelect.addEventListener("change", validateForm);

    submitBtn.addEventListener("click", function () {
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      submitBtn.textContent = sgT("btn_submitting");

      // Check blocked topics first
      checkBlockedTopics(titleInput.value.trim())
        .then(function (data) {
          if (data.blocked) {
            showToast(
              sgT("toast_topic_not_allowed") + ": " + (data.reason || ""),
            );
            submitBtn.disabled = false;
            submitBtn.textContent = sgT("submit");
            return;
          }

          var save = editing
            ? apiFetch("/api/suggestions/" + editing.id, {
                method: "PUT",
                body: {
                  title: titleInput.value.trim(),
                  description: descInput.value.trim(),
                  tag: tagSelect.value,
                  language: langSelect.value,
                },
                gated: true,
              })
            : submitSuggestion(
                titleInput.value.trim(),
                descInput.value.trim(),
                tagSelect.value,
                langSelect.value,
                contactCheckbox.checked,
              );

          return save.then(function () {
            showToast(
              editing
                ? sgT("toast_suggestion_updated")
                : sgT("toast_suggestion_submitted"),
            );
            close();
            fetchSuggestions();
          });
        })
        .catch(function (err) {
          showToast(
            sgT("toast_submit_failed") +
              ": " +
              (err.message || sgT("unknown_error")),
          );
          submitBtn.disabled = false;
          submitBtn.textContent = sgT("submit");
        });
    });
  }

  // ── Comment section ──

  function renderCommentSection(suggestion) {
    if (suggestion.status !== "accepted") return "";
    var comments = suggestion.comments || [];

    var html =
      '<div class="sg-comments" data-testid="comments-section-' +
      suggestion.id +
      '">';
    html += '<h4 class="sg-comments-heading">Comments</h4>';

    // Comment form — withheld from a banned/suspended user, whose comment
    // the server would refuse anyway (SHY-0149).
    if (canAct()) {
      html +=
        '<div class="sg-comment-form">' +
        '<textarea class="sg-textarea sg-textarea--sm" placeholder="Add a comment..." ' +
        'data-testid="comment-input-' +
        suggestion.id +
        '" ' +
        'data-suggestion-id="' +
        suggestion.id +
        '"></textarea>' +
        '<button class="sg-btn sg-btn--primary sg-btn--sm sg-comment-submit" ' +
        'data-testid="comment-submit-' +
        suggestion.id +
        '" ' +
        'data-suggestion-id="' +
        suggestion.id +
        '">Post</button>' +
        "</div>";
    }

    // Existing comments
    if (comments.length > 0) {
      // A busy suggestion can gather hundreds of comments, and rendering the lot
      // buried the card it belongs to. Show a page at a time, with a control
      // that says how many are left — the list was previously unbounded
      // (SHY-0247).
      var shownCount = state.commentPages[suggestion.id] || COMMENT_PAGE_SIZE;
      var visibleComments = comments.slice(0, shownCount);
      var remaining = comments.length - visibleComments.length;

      html += '<div class="sg-comment-list">';
      for (var i = 0; i < visibleComments.length; i++) {
        var c = visibleComments[i];
        // When the comment's author has been hard-deleted (account
        // deletion cron in express-api/src/cron/accountDeletion.js),
        // the server-stored `text` is a fixed English fallback. Prefer
        // the locale-aware string here so non-English users see a
        // translated placeholder; sgT falls back to en when the locale
        // has no override for this key.
        var commentText = c.authorDeleted
          ? sgT("commentFromDeletedUser")
          : c.text;
        html +=
          '<div class="sg-comment" data-testid="comment-' +
          (c.id || i) +
          '">' +
          '<div class="sg-comment-meta">' +
          '<span class="sg-comment-author">' +
          escapeHtml(c.authorName || "User") +
          "</span>" +
          '<span class="sg-text-muted"> ' +
          relativeTime(c.createdAt) +
          "</span>" +
          "</div>" +
          '<div class="sg-comment-text">' +
          escapeHtml(commentText) +
          "</div>" +
          "</div>";
      }
      html += "</div>";
      if (remaining > 0) {
        html +=
          '<button type="button" class="sg-comment-more" data-testid="comment-pagination" data-id="' +
          escapeHtml(suggestion.id) +
          '">' +
          escapeHtml(sgT("showMoreComments")) +
          " (" +
          remaining +
          ")</button>";
      }
    } else {
      html +=
        '<p class="sg-text-muted sg-comment-empty" data-testid="no-comments-' +
        suggestion.id +
        '">' +
        escapeHtml(sgT("comments_empty")) +
        "</p>";
    }

    html += "</div>";
    return html;
  }

  // ── Main board rendering ──

  function renderBoard() {
    var container = document.getElementById("suggestions-board");
    if (!container) return;

    var html = "";

    // Info banner
    html +=
      '<div class="sg-info-banner" data-testid="suggestions-info-banner">' +
      '<svg class="sg-info-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>' +
      "<span>All suggestions are reviewed before publishing. Please search for existing suggestions before submitting — duplicate submissions will be merged.</span>" +
      "</div>";

    // Blocked banner — a banned/suspended user keeps READ access to the
    // board but loses every write control below (SHY-0149).
    html += standingBannerHtml();

    // Toolbar: search + suggest button
    html += '<div class="sg-toolbar" data-testid="suggestions-toolbar">';
    html +=
      '<div class="sg-search-wrap">' +
      // A placeholder is NOT an accessible name — it disappears on focus and is
      // not reliably announced, so this field had no name at all for a screen
      // reader. `aria-label` gives it one (SHY-0247).
      '<input type="text" class="sg-search-input" placeholder="' +
      escapeHtml(sgT("search")) +
      '" aria-label="' +
      escapeHtml(sgT("searchSuggestions")) +
      '" ' +
      'value="' +
      escapeHtml(state.searchQuery) +
      '" ' +
      'data-testid="suggestions-search-input" />' +
      "</div>";
    if (canAct()) {
      html +=
        '<button class="sg-btn sg-btn--primary sg-suggest-btn" data-testid="suggest-btn">' + escapeHtml(sgT("suggest")) + '</button>';
    }
    html += "</div>";

    // Sort + filter controls
    html += '<div class="sg-controls" data-testid="suggestions-controls">';

    // Sort buttons
    html += '<div class="sg-sort-group" data-testid="suggestions-sort">';
    html +=
      '<button class="sg-sort-btn' +
      (state.sort === "votes" ? " sg-sort-btn--active" : "") +
      '" data-sort="votes" data-testid="sort-most-voted">' + escapeHtml(sgT("mostVoted")) + '</button>';
    html +=
      '<button class="sg-sort-btn' +
      (state.sort === "newest" ? " sg-sort-btn--active" : "") +
      '" data-sort="newest" data-testid="sort-newest">' + escapeHtml(sgT("newest")) + '</button>';
    html += "</div>";

    // Filters
    html += '<div class="sg-filter-group" data-testid="suggestions-filters">';

    // Status filter
    html +=
      '<select class="sg-filter-select" data-filter="status" data-testid="filter-status">';
    var statusList = statusOptions();
    for (var si = 0; si < statusList.length; si++) {
      var sel =
        state.filterStatus === statusList[si].value ? " selected" : "";
      html +=
        '<option value="' +
        statusList[si].value +
        '"' +
        sel +
        ">" +
        escapeHtml(statusList[si].label) +
        "</option>";
    }
    html += "</select>";

    // Tag filter
    html +=
      '<select class="sg-filter-select" data-filter="tag" data-testid="filter-tag">';
    var tagList = tagOptions();
    for (var ti = 0; ti < tagList.length; ti++) {
      var tsel = state.filterTag === tagList[ti].value ? " selected" : "";
      html +=
        '<option value="' +
        tagList[ti].value +
        '"' +
        tsel +
        ">" +
        escapeHtml(tagList[ti].label) +
        "</option>";
    }
    html += "</select>";

    // Language filter
    html +=
      '<select class="sg-filter-select" data-filter="lang" data-testid="filter-lang">';
    var langList = langOptions();
    for (var li = 0; li < langList.length; li++) {
      var lsel = state.filterLang === langList[li].value ? " selected" : "";
      html +=
        '<option value="' +
        langList[li].value +
        '"' +
        lsel +
        ">" +
        escapeHtml(langList[li].label) +
        "</option>";
    }
    html += "</select>";

    // Phase filter
    html +=
      '<select class="sg-filter-select" data-filter="phase" data-testid="phase-filter">';
    var phaseList = phaseOptions();
    for (var pi = 0; pi < phaseList.length; pi++) {
      var psel = state.filterPhase === phaseList[pi].value ? " selected" : "";
      html +=
        '<option value="' +
        phaseList[pi].value +
        '"' +
        psel +
        ">" +
        escapeHtml(phaseList[pi].label) +
        "</option>";
    }
    html += "</select>";

    // Active-filter count + a way back out.
    //
    // With five filter controls it was entirely possible to narrow the board to
    // nothing and have no idea which control was responsible, and no single
    // action to undo it — every filter had to be found and reset by hand
    // (SHY-0247). The badge says how many are on; the button clears them all.
    if (myUniqueId() !== null) {
      html +=
        '<button type="button" class="sg-notif-btn" data-testid="notif-open" aria-label="' +
        escapeHtml(sgT("notifications")) +
        '">' +
        escapeHtml(sgT("notifications")) +
        "</button>";
      html +=
        '<button type="button" class="sg-mine-toggle' +
        (state.mineOnly ? " sg-mine-toggle--active" : "") +
        '" data-testid="my-suggestions-toggle" aria-pressed="' +
        (state.mineOnly ? "true" : "false") +
        '">' +
        escapeHtml(sgT("mySuggestions")) +
        "</button>";
    }

    var activeFilters = activeFilterCount();
    if (activeFilters > 0) {
      html +=
        '<span class="sg-filter-badge" data-testid="filter-badge" aria-label="' +
        escapeHtml(String(activeFilters) + " active filters") +
        '">' +
        activeFilters +
        "</span>";
      html +=
        '<button type="button" class="sg-clear-filters" data-testid="clear-filters">' +
        escapeHtml(sgT("clearFilters")) +
        "</button>";
    }

    html += "</div>"; // sg-filter-group
    html += "</div>"; // sg-controls

    // Loading
    if (state.isLoading) {
      html +=
        '<div class="sg-loading-state" data-testid="suggestions-loading">' +
        '<div class="loading-spinner" aria-hidden="true"></div>' +
        "<p>Loading suggestions...</p>" +
        "</div>";
      container.innerHTML = html;
      attachBoardListeners(container);
      return;
    }

    // Error
    if (state.error) {
      html +=
        '<div class="sg-error-state" data-testid="suggestions-error">' +
        "<p>" +
        escapeHtml(state.error) +
        "</p>" +
        '<button class="sg-btn sg-btn--primary sg-retry-btn" data-testid="suggestions-retry">Retry</button>' +
        "</div>";
      container.innerHTML = html;
      attachBoardListeners(container);
      return;
    }

    // Empty state
    if (state.suggestions.length === 0) {
      var emptyMsg =
        state.searchQuery ||
        state.filterStatus ||
        state.filterTag ||
        state.filterLang
          ? "No results match your filters."
          : "No suggestions yet. Be the first to share your idea!";
      html +=
        // Keep `suggestions-empty` — several existing specs anchor on it. The
        // parked filter-empty test accepts either testid.
        '<div class="sg-empty-state" data-testid="suggestions-empty">' +
        "<p>" +
        escapeHtml(emptyMsg) +
        "</p>" +
        // The empty board is exactly where someone needs the way out most, so
        // repeat the control here rather than making them scroll back up.
        (activeFilterCount() > 0
          ? '<button type="button" class="sg-clear-filters" data-testid="clear-filters-empty">' +
            escapeHtml(sgT("clearFilters")) +
            "</button>"
          : "") +
        "</div>";
      container.innerHTML = html;
      attachBoardListeners(container);
      return;
    }

    // Suggestion cards. With "mine only" on, the list narrows to the reader's
    // own submissions and is labelled so it can be addressed as a view in its
    // own right — there was previously no way to find your own at all.
    var visible = state.suggestions;
    if (state.mineOnly) {
      var meId = myUniqueId();
      visible = state.suggestions.filter(function (item) {
        return meId !== null && String(item.submitterUid) === String(meId);
      });
    }
    html +=
      '<div class="sg-card-list" data-testid="' +
      (state.mineOnly ? "my-suggestions" : "suggestions-list") +
      '">';
    for (var i = 0; i < visible.length; i++) {
      html += renderSuggestionCard(visible[i]);
    }
    html += "</div>";

    // Pagination
    var totalPages = Math.ceil(state.totalCount / PAGE_SIZE);
    if (totalPages > 1) {
      html +=
        '<div class="sg-pagination" data-testid="suggestions-pagination">';
      // Previous
      html +=
        '<button class="sg-page-btn" data-page="' +
        (state.currentPage - 1) +
        '"' +
        (state.currentPage <= 1 ? " disabled" : "") +
        ' data-testid="page-prev">&laquo; Prev</button>';

      // Page numbers
      var startPage = Math.max(1, state.currentPage - 2);
      var endPage = Math.min(totalPages, state.currentPage + 2);
      for (var p = startPage; p <= endPage; p++) {
        html +=
          '<button class="sg-page-btn' +
          (p === state.currentPage ? " sg-page-btn--active" : "") +
          '" data-page="' +
          p +
          '" data-testid="page-' +
          p +
          '">' +
          p +
          "</button>";
      }

      // Next
      html +=
        '<button class="sg-page-btn" data-page="' +
        (state.currentPage + 1) +
        '"' +
        (state.currentPage >= totalPages ? " disabled" : "") +
        ' data-testid="page-next">Next &raquo;</button>';
      html += "</div>";
    }

    container.innerHTML = html;
    attachBoardListeners(container);
  }

  function renderSuggestionCard(s) {
    var myVote = state.myVotes[s.id] || null;
    // A banned/suspended user loses the vote controls for the same reason
    // a completed suggestion does: the action would be refused (SHY-0149).
    var votingDisabled = isVotingDisabled(s.status) || !canAct();
    var score = s.score != null ? s.score : 0;
    var desc = s.description || "";
    var truncated = desc.length > 200;
    var displayDesc = truncated ? desc.substring(0, 200) + "..." : desc;

    var html =
      '<div class="sg-card" data-testid="suggestion-card-' +
      s.id +
      '" data-id="' +
      s.id +
      '">';

    // Vote column
    html += '<div class="sg-vote-col">';
    // Which way I voted, said in words rather than only as a highlighted arrow.
    // The active-arrow class was the sole signal, which is invisible to a screen
    // reader and easy to miss at a glance (SHY-0247).
    if (myVote) {
      html +=
        '<span class="sg-your-vote" data-testid="your-vote-indicator">' +
        escapeHtml(sgT(myVote === "up" ? "yourVoteUp" : "yourVoteDown")) +
        "</span>";
    }
    if (!votingDisabled) {
      html +=
        '<button class="sg-vote-btn sg-vote-btn--up' +
        (myVote === "up" ? " sg-vote-btn--active" : "") +
        '"' +
        ' data-testid="vote-up-' +
        s.id +
        '" data-id="' +
        s.id +
        '" data-dir="up" aria-label="'+escapeHtml(sgT("aria_upvote"))+'">' +
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 4l-5 6h10z"/></svg>' +
        "</button>";
    }
    html +=
      '<span class="sg-vote-score" data-testid="vote-score-' +
      s.id +
      '">' +
      score +
      "</span>";
    if (!votingDisabled) {
      html +=
        '<button class="sg-vote-btn sg-vote-btn--down' +
        (myVote === "down" ? " sg-vote-btn--active" : "") +
        '"' +
        ' data-testid="vote-down-' +
        s.id +
        '" data-id="' +
        s.id +
        '" data-dir="down" aria-label="'+escapeHtml(sgT("aria_downvote"))+'">' +
        '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 12l-5-6h10z"/></svg>' +
        "</button>";
    }
    html += "</div>";

    // Content column
    html += '<div class="sg-card-content">';

    // Title row
    html += '<div class="sg-card-title-row">';
    html +=
      '<h3 class="sg-card-title" data-testid="suggestion-title-' +
      s.id +
      '">' +
      escapeHtml(s.title) +
      "</h3>";
    html +=
      '<button class="sg-bell-btn" data-testid="suggestion-bell-' +
      s.id +
      '" data-id="' +
      s.id +
      '" aria-label="'+escapeHtml(sgT("aria_watch"))+'">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>' +
      "</button>";
    html += "</div>";

    // "Your suggestion" — so a reader can find their own submission in a long
    // list without recognising their own words (SHY-0247).
    var mine = myUniqueId();
    if (mine !== null && String(s.submitterUid) === String(mine)) {
      html +=
        '<span class="sg-submitter-badge" data-testid="submitter-badge">' +
        escapeHtml(sgT("yourSuggestion")) +
        "</span>";
    }

    // Your own PENDING suggestion can still be changed or taken back — the API
    // has allowed both all along (PUT/DELETE /suggestions/:id, owner + pending
    // only), but nothing on the board offered either (SHY-0247).
    if (mine !== null && String(s.submitterUid) === String(mine) && s.status === "pending") {
      html +=
        '<div class="sg-owner-actions">' +
        '<button type="button" class="sg-owner-btn" data-testid="edit-suggestion-btn" data-id="' +
        escapeHtml(s.id) +
        '">' +
        escapeHtml(sgT("editSuggestion")) +
        "</button>" +
        '<button type="button" class="sg-owner-btn sg-owner-btn--danger" data-testid="withdraw-suggestion-btn" data-id="' +
        escapeHtml(s.id) +
        '">' +
        escapeHtml(sgT("withdrawSuggestion")) +
        "</button>" +
        "</div>";
    }

    // Description.
    //
    // `dir="auto"` lets the browser pick direction from the text's own first
    // strong character, so an Arabic or Hebrew suggestion right-aligns without
    // the page switching locale. Without it every description rendered LTR and
    // RTL submissions read backwards to their own authors.
    html +=
      '<div class="sg-card-desc" dir="auto" data-testid="suggestion-desc-' +
      s.id +
      '">';
    // Escaping happens INSIDE renderTextWithLinks, per segment — escaping first
    // and linkifying after leaves quotes intact inside the href (see its doc).
    html += renderTextWithLinks(displayDesc);
    if (truncated) {
      html +=
        ' <button class="sg-expand-btn" data-testid="suggestion-expand-' +
        s.id +
        '" data-id="' +
        s.id +
        '">Show more</button>';
    }
    html += "</div>";

    // Why a suggestion was declined. The reason is stored (`rejectReason` from
    // the API, `declineReason` in older records) but was never rendered, so a
    // rejected suggestion just went quiet — the one moment a person most wants
    // an explanation (SHY-0247).
    var declineReason = s.rejectReason || s.declineReason;
    if (s.status === "rejected" && declineReason) {
      html +=
        '<div class="sg-decline-reason" data-testid="decline-reason" dir="auto">' +
        escapeHtml(declineReason) +
        "</div>";
    }

    // Meta row: tags, language, status, timestamp
    html += '<div class="sg-card-meta">';
    if (s.tag) {
      html +=
        '<span class="sg-tag" data-testid="suggestion-tag-' +
        s.id +
        '">' +
        escapeHtml(s.tag) +
        "</span>";
    }
    if (s.language) {
      html +=
        '<span class="sg-lang-tag" data-testid="suggestion-lang-' +
        s.id +
        '">' +
        escapeHtml(s.language) +
        "</span>";
    }
    html +=
      '<span class="sg-badge ' +
      statusBadgeClass(s.status) +
      '" data-testid="suggestion-status-' +
      s.id +
      '" data-status="' +
      escapeHtml(s.status || "pending") +
      '">' +
      // Hardcoded English until SHY-0252: every other label on this card came
      // from `sgT()`, so a German reader saw a translated board with English
      // status badges on it. The keys already existed in suggestions-i18n.js.
      // DEDICATED badge keys, not the filter labels: the badge deliberately
      // reads "Shipped!"/"Declined" where the filter reads
      // "Completed"/"Rejected", and reusing the filter keys would silently
      // change the English copy that other tests pin.
      escapeHtml(
        s.status === "completed"
          ? sgT("badge_completed")
          : s.status === "planned"
            ? sgT("badge_planned")
            : s.status === "accepted"
              ? sgT("badge_accepted")
              : s.status === "rejected"
                ? sgT("badge_rejected")
                : sgT("badge_pending"),
      ) +
      "</span>";
    // A <time datetime> carries the absolute instant alongside the relative
    // wording, so a screen reader (and anyone hovering) can get the real date
    // instead of only "2 min ago".
    html +=
      '<time class="sg-timestamp" data-testid="suggestion-time-' +
      s.id +
      '" datetime="' +
      escapeHtml(new Date(s.createdAt).toISOString()) +
      '">' +
      relativeTime(s.createdAt) +
      "</time>";
    html += "</div>";

    // Comments section (only for accepted)
    html += renderCommentSection(s);

    html += "</div>"; // sg-card-content
    html += "</div>"; // sg-card

    return html;
  }

  // ── Event delegation ──

  function attachBoardListeners(container) {
    // Sort buttons
    var sortBtns = container.querySelectorAll(".sg-sort-btn");
    for (var i = 0; i < sortBtns.length; i++) {
      sortBtns[i].addEventListener("click", function () {
        var newSort = this.getAttribute("data-sort");
        if (state.sort !== newSort) {
          state.sort = newSort;
          state.currentPage = 1;
          fetchSuggestions();
        }
      });
    }

    // Filter selects
    var filterSelects = container.querySelectorAll(".sg-filter-select");
    for (var f = 0; f < filterSelects.length; f++) {
      filterSelects[f].addEventListener("change", function () {
        var filterType = this.getAttribute("data-filter");
        if (filterType === "status") state.filterStatus = this.value;
        else if (filterType === "tag") state.filterTag = this.value;
        else if (filterType === "lang") state.filterLang = this.value;
        else if (filterType === "phase") state.filterPhase = this.value;
        state.currentPage = 1;
        fetchSuggestions();
      });
    }

    // Search
    var searchInput = container.querySelector(".sg-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        clearTimeout(searchTimer);
        var q = searchInput.value.trim();
        searchTimer = setTimeout(function () {
          if (q.length >= SEARCH_MIN_CHARS || q.length === 0) {
            state.searchQuery = q;
            state.currentPage = 1;
            fetchSuggestions();
          }
        }, SEARCH_DEBOUNCE_MS);
      });
    }

    // Suggest button
    var suggestBtn = container.querySelector(".sg-suggest-btn");
    if (suggestBtn) {
      suggestBtn.addEventListener("click", function () {
        openSuggestModal();
      });
    }

    // Retry button
    var retryBtn = container.querySelector(".sg-retry-btn");
    if (retryBtn) {
      retryBtn.addEventListener("click", function () {
        fetchSuggestions();
      });
    }

    // Vote buttons
    var voteBtns = container.querySelectorAll(".sg-vote-btn");
    for (var v = 0; v < voteBtns.length; v++) {
      voteBtns[v].addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        var dir = this.getAttribute("data-dir");
        // Un-voting needs no explanation — only a NEW vote asks why.
        if (state.myVotes[id] === dir) {
          submitVote(id, dir);
          return;
        }
        if (!requireAuth("vote on suggestions")) return;
        openVoteReasonModal(id, dir);
      });
    }

    // Bell buttons (watch / subscribe) — per-suggestion, requires auth
    var bellBtns = container.querySelectorAll(".sg-bell-btn");
    for (var b = 0; b < bellBtns.length; b++) {
      bellBtns[b].addEventListener("click", function () {
        if (!requireAuth("watch this suggestion")) return;
        var id = this.getAttribute("data-id");
        openSubscribeModal(id);
      });
    }

    // Expand description buttons
    var mineToggle = container.querySelector('[data-testid="my-suggestions-toggle"]');
    if (mineToggle) {
      mineToggle.addEventListener("click", function () {
        state.mineOnly = !state.mineOnly;
        renderBoard();
      });
    }

    var editBtns = container.querySelectorAll('[data-testid="edit-suggestion-btn"]');
    for (var eb = 0; eb < editBtns.length; eb++) {
      editBtns[eb].addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        for (var k = 0; k < state.suggestions.length; k++) {
          if (state.suggestions[k].id === id) {
            openSuggestModal(state.suggestions[k]);
            return;
          }
        }
      });
    }

    var withdrawBtns = container.querySelectorAll('[data-testid="withdraw-suggestion-btn"]');
    for (var wb = 0; wb < withdrawBtns.length; wb++) {
      withdrawBtns[wb].addEventListener("click", function () {
        openWithdrawConfirm(this.getAttribute("data-id"));
      });
    }

    var notifBtn = container.querySelector('[data-testid="notif-open"]');
    if (notifBtn) notifBtn.addEventListener("click", openNotificationInbox);

    var moreCommentBtns = container.querySelectorAll(".sg-comment-more");
    for (var mc = 0; mc < moreCommentBtns.length; mc++) {
      moreCommentBtns[mc].addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        state.commentPages[id] =
          (state.commentPages[id] || COMMENT_PAGE_SIZE) + COMMENT_PAGE_SIZE;
        renderBoard();
      });
    }

    var clearBtns = container.querySelectorAll(".sg-clear-filters");
    for (var cf = 0; cf < clearBtns.length; cf++) {
      clearBtns[cf].addEventListener("click", clearAllFilters);
    }

    var expandBtns = container.querySelectorAll(".sg-expand-btn");
    for (var e = 0; e < expandBtns.length; e++) {
      expandBtns[e].addEventListener("click", function () {
        var id = this.getAttribute("data-id");
        for (var s = 0; s < state.suggestions.length; s++) {
          if (state.suggestions[s].id === id) {
            var descEl = this.closest(".sg-card-desc");
            if (descEl) {
              descEl.innerHTML = escapeHtml(
                state.suggestions[s].description || "",
              );
            }
            break;
          }
        }
      });
    }

    // Pagination buttons
    var pageBtns = container.querySelectorAll(".sg-page-btn");
    for (var p = 0; p < pageBtns.length; p++) {
      pageBtns[p].addEventListener("click", function () {
        if (this.disabled) return;
        var page = parseInt(this.getAttribute("data-page"), 10);
        if (page >= 1) {
          state.currentPage = page;
          fetchSuggestions();
          // Scroll to top of suggestions
          var suggestionsSection = document.getElementById("suggestions");
          if (suggestionsSection) {
            suggestionsSection.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }
        }
      });
    }

    // Comment submit buttons
    var commentBtns = container.querySelectorAll(".sg-comment-submit");
    for (var c = 0; c < commentBtns.length; c++) {
      commentBtns[c].addEventListener("click", function () {
        if (!requireAuth("post comments")) return;
        var suggestionId = this.getAttribute("data-suggestion-id");
        var textarea = container.querySelector(
          'textarea[data-suggestion-id="' + suggestionId + '"]',
        );
        if (!textarea) return;
        var text = textarea.value.trim();
        if (!text) return;

        var btn = this;
        btn.disabled = true;
        btn.textContent = sgT("btn_posting");

        submitComment(suggestionId, text)
          .then(function () {
            showToast(sgT("toast_comment_posted"));
            fetchSuggestions();
          })
          .catch(function (err) {
            showToast(
              sgT("toast_post_comment_failed") +
                ": " +
                (err.message || sgT("unknown_error")),
            );
            btn.disabled = false;
            btn.textContent = sgT("postComment");
          });
      });
    }
  }

  // ── Header subscribe button integration ──

  function setupHeaderSubscribe() {
    var btn = document.getElementById("subscribe-btn");
    if (!btn) return;
    // Replace the default handler from roadmap-app.js
    btn.replaceWith(btn.cloneNode(true));
    btn = document.getElementById("subscribe-btn");
    btn.addEventListener("click", function () {
      var isAuthed = getUser() && hasValidAccount();
      if (!isAuthed) {
        showLoginPromptModal("manage subscriptions");
      } else {
        openSubscribeModal(null);
      }
    });
  }

  // ── Init ──

  function init() {
    setupHeaderSubscribe();
    fetchSuggestions();

    // Expose modals globally so roadmap-app.js bell handlers can use them
    window.shytalkShowLoginModal = showLoginPromptModal;
    window.shytalkOpenSubscribeModal = openSubscribeModal;

    // Re-render when auth state changes (show/hide suggest button), and
    // ask the server for our standing so a banned user sees the blocked
    // banner on load rather than on their first refused click (SHY-0149).
    document.addEventListener("shytalk-auth-changed", function () {
      renderBoard();
      refreshStanding();
    });

    // Every string on this board is produced by `sgT()` AT RENDER TIME, so a
    // language switch left the whole thing — filters, buttons, status badges —
    // in the previous language until the reader happened to reload. Re-render
    // on the switch instead (SHY-0252).
    document.addEventListener("shytalk-language-changed", function () {
      renderBoard();
    });

    // The auth-changed event may have fired before this listener attached
    // (Firebase restores a session fast); probe once for that race.
    refreshStanding();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
