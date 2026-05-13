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
  var DUPLICATE_MIN_CHARS = 3;

  var STATUS_OPTIONS = [
    { value: "", label: sgT("allStatuses") },
    { value: "pending", label: sgT("pending") },
    { value: "accepted", label: sgT("accepted") },
    { value: "planned", label: sgT("planned") },
    { value: "completed", label: sgT("completed") },
    { value: "rejected", label: sgT("rejected") },
  ];

  var TAG_OPTIONS = [
    { value: "", label: sgT("allTags") },
    { value: "voice", label: sgT("tagVoice") },
    { value: "chat", label: sgT("tagChat") },
    { value: "moderation", label: sgT("tagModeration") },
    { value: "ui", label: sgT("tagUi") },
    { value: "privacy", label: sgT("tagPrivacy") },
    { value: "social", label: sgT("tagSocial") },
    { value: "economy", label: sgT("tagEconomy") },
    { value: "accessibility", label: sgT("tagAccessibility") },
    { value: "other", label: sgT("tagOther") },
  ];

  // Language names rendered in their NATIVE form so a user filtering by
  // a language always sees that language in its own script — convention
  // mirrors language-selector.js's LANGUAGES.native list and is the
  // standard pattern for language pickers (cf. Wikipedia language nav,
  // YouTube language selector, etc.).
  var LANG_OPTIONS = [
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

  var SUBSCRIBE_EVENTS = [
    { key: "newSuggestion", label: sgT("subscribe_event_new_suggestion") },
    { key: "statusChange", label: sgT("subscribe_event_status_change") },
    { key: "commentReply", label: sgT("subscribe_event_comment_reply") },
    { key: "watchedUpdate", label: sgT("subscribe_event_watched_update") },
  ];

  var SUBSCRIBE_CHANNELS = ["email", "push", "inApp", "systemMessage"];

  var CHANNEL_LABELS = {
    email: sgT("subscribe_channel_email"),
    push: sgT("subscribe_channel_push"),
    inApp: sgT("subscribe_channel_inapp"),
    systemMessage: sgT("subscribe_channel_system"),
  };

  // ── State ──

  var PHASE_OPTIONS = [
    { value: "", label: sgT("allPhases") },
    { value: "compliance", label: sgT("phaseCompliance") },
    { value: "platform", label: sgT("phasePlatform") },
    { value: "revenue", label: sgT("phaseRevenue") },
    { value: "social", label: sgT("phaseSocial") },
    { value: "qol", label: sgT("phaseQol") },
    { value: "entertainment", label: sgT("phaseEntertainment") },
    { value: "support", label: sgT("phaseSupport") },
  ];

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
    myVotes: {},
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
              var err = new Error(body.error || "Request failed");
              err.status = res.status;
              throw err;
            });
        }
        return res.json();
      });
    });
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

  function submitVote(suggestionId, direction) {
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
    }

    apiFetch("/api/suggestions/" + suggestionId + "/vote", {
      method: method,
      body: body,
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
    });
  }

  function fetchSubscriptionPrefs() {
    return apiFetch("/api/subscriptions/me");
  }

  function saveSubscriptionPrefs(prefs) {
    return apiFetch("/api/subscriptions/me", {
      method: "PUT",
      body: prefs,
    });
  }

  function watchSuggestion(suggestionId) {
    return apiFetch("/api/subscriptions/me/watch", {
      method: "POST",
      body: { suggestionId: suggestionId },
    });
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
      "<p>Sign in with your ShyTalk account to " +
      escapeHtml(action || "perform this action") +
      ".</p>" +
      '<div class="auth-buttons" style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin:16px 0;">' +
        '<button class="auth-google-btn" data-testid="auth-google-btn" aria-label="'+escapeHtml(sgT("signInGoogle"))+'" style="display:inline-flex;align-items:center;gap:10px;padding:10px 24px;background:#fff;color:#3c4043;border:1px solid #dadce0;border-radius:4px;font-size:14px;font-weight:500;cursor:pointer;min-height:44px;">' +
          '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>' +
          "<span>Sign in with Google</span>" +
        "</button>" +
        '<button class="auth-apple-btn" data-testid="auth-apple-btn" aria-label="'+escapeHtml(sgT("signInApple"))+'" style="display:inline-flex;align-items:center;gap:10px;padding:10px 24px;background:#000;color:#fff;border:none;border-radius:4px;font-size:14px;font-weight:500;cursor:pointer;min-height:44px;">' +
          '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="#fff" d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.53-3.23 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>' +
          "<span>Sign in with Apple</span>" +
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

    // Load preferences
    fetchSubscriptionPrefs()
      .then(function (prefs) {
        state.subscriptionPrefs = prefs.preferences || {};
        state.watchList = prefs.watchList || [];
        renderSubscribeBody(body, featureId);
      })
      .catch(function () {
        state.subscriptionPrefs = {};
        state.watchList = [];
        renderSubscribeBody(body, featureId);
      });

    saveBtn.addEventListener("click", function () {
      saveBtn.disabled = true;
      saveBtn.textContent = sgT("subscribe_btn_saving");

      // Collect toggled values
      var prefs = {};
      for (var e = 0; e < SUBSCRIBE_EVENTS.length; e++) {
        var evt = SUBSCRIBE_EVENTS[e];
        prefs[evt.key] = {};
        for (var c = 0; c < SUBSCRIBE_CHANNELS.length; c++) {
          var ch = SUBSCRIBE_CHANNELS[c];
          var checkbox = overlay.querySelector(
            '[data-testid="subscribe-toggle-' + evt.key + "-" + ch + '"]',
          );
          prefs[evt.key][ch] = checkbox ? checkbox.checked : false;
        }
      }

      saveSubscriptionPrefs({ preferences: prefs, gdprEmailConsent: true })
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
        escapeHtml(CHANNEL_LABELS[SUBSCRIBE_CHANNELS[c]]) +
        "</div>";
    }
    html += "</div>";

    for (var e = 0; e < SUBSCRIBE_EVENTS.length; e++) {
      var evt = SUBSCRIBE_EVENTS[e];
      var evtPrefs = prefs[evt.key] || {};
      html += '<div class="sg-subscribe-row">';
      html +=
        '<div class="sg-subscribe-cell sg-subscribe-cell--event">' +
        escapeHtml(evt.label) +
        "</div>";
      for (var ci = 0; ci < SUBSCRIBE_CHANNELS.length; ci++) {
        var ch = SUBSCRIBE_CHANNELS[ci];
        var checked = evtPrefs[ch] ? " checked" : "";
        html +=
          '<div class="sg-subscribe-cell sg-subscribe-cell--channel">' +
          '<label class="sg-toggle-label">' +
          '<input type="checkbox" data-testid="subscribe-toggle-' +
          evt.key +
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
    html += "<h4>Watch list</h4>";
    if (state.watchList.length === 0) {
      html +=
        '<p class="sg-text-muted">No watched suggestions yet. Click the bell icon on a suggestion to watch it.</p>';
    } else {
      html += '<ul class="sg-watch-list">';
      for (var w = 0; w < state.watchList.length; w++) {
        var item = state.watchList[w];
        html +=
          '<li class="sg-watch-item">' +
          "<span>" +
          escapeHtml(item.title || item.suggestionId) +
          "</span>" +
          "</li>";
      }
      html += "</ul>";
    }
    html += "</div>";

    container.innerHTML = html;
  }

  // ── Suggestion form modal ──

  function openSuggestModal() {
    if (!requireAuth("submit suggestions")) return;

    var existing = document.getElementById("sg-suggest-overlay");
    if (existing) existing.remove();

    var tagOpts = "";
    for (var t = 1; t < TAG_OPTIONS.length; t++) {
      tagOpts +=
        '<option value="' +
        TAG_OPTIONS[t].value +
        '">' +
        escapeHtml(TAG_OPTIONS[t].label) +
        "</option>";
    }

    var langOpts = "";
    for (var l = 1; l < LANG_OPTIONS.length; l++) {
      langOpts +=
        '<option value="' +
        LANG_OPTIONS[l].value +
        '">' +
        escapeHtml(LANG_OPTIONS[l].label) +
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
                  close();
                  showToast(sgT("toast_redirecting_to_existing"));
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

          return submitSuggestion(
            titleInput.value.trim(),
            descInput.value.trim(),
            tagSelect.value,
            langSelect.value,
            contactCheckbox.checked,
          ).then(function () {
            showToast(sgT("toast_suggestion_submitted"));
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

    // Comment form
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

    // Existing comments
    if (comments.length > 0) {
      html += '<div class="sg-comment-list">';
      for (var i = 0; i < comments.length; i++) {
        var c = comments[i];
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
          escapeHtml(c.text) +
          "</div>" +
          "</div>";
      }
      html += "</div>";
    } else {
      html +=
        '<p class="sg-text-muted sg-comment-empty">No comments yet. Be the first!</p>';
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

    // Toolbar: search + suggest button
    html += '<div class="sg-toolbar" data-testid="suggestions-toolbar">';
    html +=
      '<div class="sg-search-wrap">' +
      '<input type="text" class="sg-search-input" placeholder="' + escapeHtml(sgT("search")) + '" ' +
      'value="' +
      escapeHtml(state.searchQuery) +
      '" ' +
      'data-testid="suggestions-search-input" />' +
      "</div>";
    html +=
      '<button class="sg-btn sg-btn--primary sg-suggest-btn" data-testid="suggest-btn">' + escapeHtml(sgT("suggest")) + '</button>';
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
    for (var si = 0; si < STATUS_OPTIONS.length; si++) {
      var sel =
        state.filterStatus === STATUS_OPTIONS[si].value ? " selected" : "";
      html +=
        '<option value="' +
        STATUS_OPTIONS[si].value +
        '"' +
        sel +
        ">" +
        escapeHtml(STATUS_OPTIONS[si].label) +
        "</option>";
    }
    html += "</select>";

    // Tag filter
    html +=
      '<select class="sg-filter-select" data-filter="tag" data-testid="filter-tag">';
    for (var ti = 0; ti < TAG_OPTIONS.length; ti++) {
      var tsel = state.filterTag === TAG_OPTIONS[ti].value ? " selected" : "";
      html +=
        '<option value="' +
        TAG_OPTIONS[ti].value +
        '"' +
        tsel +
        ">" +
        escapeHtml(TAG_OPTIONS[ti].label) +
        "</option>";
    }
    html += "</select>";

    // Language filter
    html +=
      '<select class="sg-filter-select" data-filter="lang" data-testid="filter-lang">';
    for (var li = 0; li < LANG_OPTIONS.length; li++) {
      var lsel = state.filterLang === LANG_OPTIONS[li].value ? " selected" : "";
      html +=
        '<option value="' +
        LANG_OPTIONS[li].value +
        '"' +
        lsel +
        ">" +
        escapeHtml(LANG_OPTIONS[li].label) +
        "</option>";
    }
    html += "</select>";

    // Phase filter
    html +=
      '<select class="sg-filter-select" data-filter="phase" data-testid="phase-filter">';
    for (var pi = 0; pi < PHASE_OPTIONS.length; pi++) {
      var psel = state.filterPhase === PHASE_OPTIONS[pi].value ? " selected" : "";
      html +=
        '<option value="' +
        PHASE_OPTIONS[pi].value +
        '"' +
        psel +
        ">" +
        escapeHtml(PHASE_OPTIONS[pi].label) +
        "</option>";
    }
    html += "</select>";

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
        '<div class="sg-empty-state" data-testid="suggestions-empty">' +
        "<p>" +
        escapeHtml(emptyMsg) +
        "</p>" +
        "</div>";
      container.innerHTML = html;
      attachBoardListeners(container);
      return;
    }

    // Suggestion cards
    html += '<div class="sg-card-list" data-testid="suggestions-list">';
    for (var i = 0; i < state.suggestions.length; i++) {
      html += renderSuggestionCard(state.suggestions[i]);
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
    var votingDisabled = isVotingDisabled(s.status);
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

    // Description
    html +=
      '<div class="sg-card-desc" data-testid="suggestion-desc-' + s.id + '">';
    html += escapeHtml(displayDesc);
    if (truncated) {
      html +=
        ' <button class="sg-expand-btn" data-testid="suggestion-expand-' +
        s.id +
        '" data-id="' +
        s.id +
        '">Show more</button>';
    }
    html += "</div>";

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
      escapeHtml(
        s.status === "completed"
          ? "Shipped!"
          : s.status === "planned"
            ? "Planned"
            : s.status === "accepted"
              ? "Accepted"
              : s.status === "rejected"
                ? "Declined"
                : "Pending",
      ) +
      "</span>";
    html +=
      '<span class="sg-timestamp" data-testid="suggestion-time-' +
      s.id +
      '">' +
      relativeTime(s.createdAt) +
      "</span>";
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
        submitVote(id, dir);
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

    // Re-render when auth state changes (show/hide suggest button)
    document.addEventListener("shytalk-auth-changed", function () {
      renderBoard();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
