/**
 * Preview-build watermark for non-prod web pages.
 *
 * Mirrors `shared/src/commonMain/.../core/PreviewWatermark.kt` (and its
 * jvm-tested `WatermarkFormat` compact layout contract, SHY-0205): any
 * host that ISN'T production renders a fixed-position red badge naming
 * exactly WHAT is running and WHO/WHERE it is —
 *
 *   ShyTalk Preview
 *   env · build · api <server-sha> ●        (dot = last /api/health verdict)
 *   <git branch, middle-truncated to 24>
 *   <git sha7, "*" when dirty> · <built at, when stamped>
 *   <browser id>
 *   UID: <uid | -> · <cohort, when known>
 *   <locale> · <route>
 *   ▶ <journey marker, only while a runner sets one>
 *
 * Build-time inputs arrive as `<meta name="shytalk-*">` tags written by
 * the two writers of `local/build-meta.js`'s contract: serve-web.js
 * (local, live working tree) and scripts/stamp-build-meta.mjs (dev
 * deploys). Missing metas render as "?" — never blank segments.
 *
 * Production explicitly opts out: when `getEnvironment()` returns
 * `"prod"` the script is a no-op (no badge, no health polling, and prod
 * deploys carry no git metas at all). Hostname mapping:
 *   - `localhost` / `127.0.0.1`           → "local"
 *   - hosts matching `/dev-api\.|dev\./`  → "dev"
 *   - everything else                      → "prod"
 *
 * Test hooks (set by Playwright/the manual-qa-runner BEFORE the script
 * runs unless noted):
 *   - `window.__preview_env_override` — forces the environment string.
 *   - `window.__preview_api_override` — forces the health-poll base URL
 *     (lets tests induce a REAL fetch failure via a closed port).
 *   - `window.__journey_marker` — read every render; the ▶ line appears
 *     while it is a non-empty string and disappears when cleared.
 *   - `window.__shytalk_user_cohort` — cohort label paired with the UID.
 */
(function initPreviewWatermark() {
  "use strict";

  var BRANCH_MAX_CHARS = 24;
  var HEALTH_POLL_INTERVAL_MS = 30000;

  function getEnvironment() {
    if (typeof window.__preview_env_override === "string") {
      return window.__preview_env_override;
    }
    var host = window.location.hostname || "";
    if (host === "localhost" || host === "127.0.0.1" || host === "::1")
      return "local";
    if (/dev-api\.|dev\.shytalk/.test(host)) return "dev";
    return "prod";
  }

  function getBrowserId() {
    var ua = navigator.userAgent || "";
    // Order matters — Chrome reports "Chrome ... Safari" so test for it
    // before generic Safari; Edge reports "Chrome ... Edg/" so check Edg
    // first; Firefox + WebKit are unambiguous.
    var match;
    if ((match = /Edg\/([0-9.]+)/.exec(ua)))
      return "Edge " + match[1].split(".")[0];
    if ((match = /Firefox\/([0-9.]+)/.exec(ua)))
      return "Firefox " + match[1].split(".")[0];
    if ((match = /Chrome\/([0-9.]+)/.exec(ua)))
      return "Chrome " + match[1].split(".")[0];
    if ((match = /Version\/([0-9.]+).*Safari/.exec(ua)))
      return "Safari " + match[1].split(".")[0];
    if (/AppleWebKit/.test(ua)) return "WebKit";
    return "Unknown";
  }

  function getMeta(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return meta && meta.content ? meta.content : null;
  }

  function getBuildVersion() {
    // Deploy pipelines stamp shytalk-build (stamp-build-meta.mjs);
    // otherwise fall back to the document's own date stamp.
    return getMeta("shytalk-build") || document.lastModified || "?";
  }

  function getCurrentUid() {
    // Try multiple known sources: Firebase Auth's currentUser, a
    // window-level cache populated by portal.js, or a localStorage
    // fallback. Returning null/undefined is safe — caller renders "-".
    try {
      if (window.firebase && window.firebase.auth) {
        var user = window.firebase.auth().currentUser;
        if (user && user.uid) return user.uid;
      }
    } catch (_) {
      /* Firebase not initialised */
    }
    try {
      if (window.__shytalk_user_uid) return window.__shytalk_user_uid;
    } catch (_) {
      /* not present */
    }
    try {
      var ls = localStorage.getItem("shytalk_user_uid");
      if (ls) return ls;
    } catch (_) {
      /* localStorage blocked */
    }
    return null;
  }

  /** Middle-truncation, mirroring WatermarkFormat.truncateMiddle
   *  (incl. its max<=1 → "…" degenerate-budget rule). */
  function truncateMiddle(value, max) {
    if (value.length <= max) return value;
    if (max <= 1) return "…";
    var keepEnd = Math.floor((max - 1) / 2);
    var keepStart = max - 1 - keepEnd;
    return (
      value.slice(0, keepStart) + "…" + value.slice(value.length - keepEnd)
    );
  }

  /** "MM-dd HH:mm" in the viewer's zone, from the ISO built-at meta. */
  function formatBuiltAt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var pad = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    return (
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  var env = getEnvironment();
  if (env === "prod") return; // No watermark, no polling, on prod.

  // One greppable build-identity line per page load (Observability AC —
  // parity with Android's logcat line and iOS's NSLog).
  try {
    // eslint-disable-next-line no-console
    console.log(
      "[ShyTalk] build identity: " +
        env +
        " " +
        getBuildVersion() +
        " " +
        (getMeta("shytalk-git-branch") || "?") +
        "@" +
        (getMeta("shytalk-git-sha") || "?") +
        (getMeta("shytalk-git-dirty") === "1" ? "*" : "") +
        " built " +
        (getMeta("shytalk-built-at") || "?"),
    );
  } catch (_) {
    /* console unavailable — never break the page */
  }

  // ── Server-echo health poll (SHY-0205) ──
  // Asks the EXISTING /api/health which backend is actually ANSWERING —
  // sha is its self-reported deploy identity ("unknown" on local). The
  // dot shows the last COMPLETED poll's verdict; a failure keeps the
  // last-known sha so "which backend did I last reach" stays visible.
  var serverHealth = { sha: null, ok: null };

  function healthBase() {
    if (typeof window.__preview_api_override === "string") {
      return window.__preview_api_override;
    }
    // prod never reaches here (script exits above) — local vs dev only.
    // Single-line env ternary: the env-url guard's sanctioned shape
    // (suggestions-board.js precedent).
    return env === "local"
      ? "http://localhost:3000"
      : "https://dev-api.shytalk.shyden.co.uk"; // localhost checked first
  }

  // Logs only on ok→fail / fail→ok transitions (Observability AC —
  // parity with the Kotlin side's state-change logD), never per poll.
  function recordHealth(ok) {
    var previous = serverHealth.ok;
    serverHealth.ok = ok;
    if (previous !== ok) {
      try {
        // eslint-disable-next-line no-console
        console.log(
          "[ShyTalk] server health " +
            (previous === null ? "unknown" : previous) +
            " -> " +
            ok +
            " (sha=" +
            (serverHealth.sha || "?") +
            ")",
        );
      } catch (_) {
        /* console unavailable */
      }
    }
  }

  function pollHealth() {
    try {
      fetch(healthBase() + "/api/health", { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("http " + res.status);
          return res.json();
        })
        .then(function (body) {
          if (body && typeof body.sha === "string" && body.sha)
            serverHealth.sha = body.sha;
          recordHealth(!!(body && body.status === "ok"));
        })
        .catch(function () {
          recordHealth(false);
        });
    } catch (_) {
      recordHealth(false);
    }
  }
  pollHealth();
  setInterval(pollHealth, HEALTH_POLL_INTERVAL_MS);

  function render() {
    var existing = document.getElementById("preview-watermark");
    if (existing) existing.remove();

    var node = document.createElement("div");
    node.id = "preview-watermark";
    node.setAttribute("aria-hidden", "true");
    // Dodge the shared header (public/js/shared-header.js) when one is
    // present — otherwise the badge sits inside the header's hit-test
    // area at the top of the page, swallowing taps that should reach
    // the header (e.g. the Sign In button) and visually overlapping
    // the header chrome. Pages without the shared header keep the
    // original top:4 placement. The 2s re-render interval guarantees
    // the position stays correct if the header is injected after the
    // first render (init race between the two scripts).
    var sharedHeader = document.querySelector(".sh-header");
    var topPx = (sharedHeader ? sharedHeader.offsetHeight : 0) + 4;
    node.style.cssText = [
      "position:fixed",
      "top:" + topPx + "px",
      "right:4px",
      "z-index:2147483647", // max int — guarantee on top of any modal
      // Alpha 0.4 — visible enough to read the build/env/UID lines
      // against any background, transparent enough that the underlying
      // page colour clearly bleeds through. The contract is enforced by
      // the alpha test in preview-watermark.spec.ts (≤ 0.5, ≥ 0.1).
      "background:rgba(211,47,47,0.4)",
      "color:#fff",
      // White text against semi-transparent red can wash out — add a
      // subtle dark text-shadow so the labels remain readable on light
      // backgrounds without bumping the badge opacity back up.
      "text-shadow:0 1px 2px rgba(0,0,0,0.6)",
      "padding:3px 6px",
      "border-radius:3px",
      "font-family:ui-monospace,Menlo,Consolas,monospace",
      "font-size:9px",
      "line-height:1.3",
      "text-align:right",
      // Compactness cap (operator ruling 2026-07-18) — long lines
      // ellipsize instead of widening the badge across the page.
      "max-width:60vw",
      "overflow:hidden",
      "pointer-events:none",
      "user-select:none",
      "-webkit-user-select:none",
    ].join(";");

    // ── Assemble the compact lines (mirrors WatermarkFormat.content) ──
    var serverPart = serverHealth.sha ? serverHealth.sha.slice(0, 7) : "?";
    var dotColor =
      serverHealth.ok === true
        ? "#66BB6A"
        : serverHealth.ok === false
          ? "#FF5252"
          : "#BDBDBD";
    var statusLine =
      escapeHtml(env) +
      " · " +
      escapeHtml(getBuildVersion()) +
      " · api " +
      escapeHtml(serverPart) +
      ' <span style="color:' +
      dotColor +
      ';text-shadow:none">●</span>';

    var branch = getMeta("shytalk-git-branch");
    var sha = getMeta("shytalk-git-sha");
    var dirty = getMeta("shytalk-git-dirty") === "1";
    var builtAt = getMeta("shytalk-built-at");
    var builtAtLabel = builtAt ? formatBuiltAt(builtAt) : null;
    var shaPart = sha ? escapeHtml(sha.slice(0, 7)) + (dirty ? "*" : "") : "?";
    var shaLine = builtAtLabel
      ? shaPart + " · " + escapeHtml(builtAtLabel)
      : shaPart;

    var uid = getCurrentUid();
    var cohort =
      typeof window.__shytalk_user_cohort === "string"
        ? window.__shytalk_user_cohort
        : null;
    var uidLine = uid
      ? "UID: " + escapeHtml(uid) + (cohort ? " · " + escapeHtml(cohort) : "")
      : "UID: -";

    var locale =
      document.documentElement.lang ||
      (navigator.language || "").split("-")[0] ||
      "?";
    var route = window.location.pathname || "";
    var localeRouteLine =
      escapeHtml(locale) + (route ? " · " + escapeHtml(route) : "");

    var marker =
      typeof window.__journey_marker === "string" &&
      window.__journey_marker.trim()
        ? window.__journey_marker.trim()
        : null;

    // Per-line clamp (compactness AC): one visual row per line, ellipsis
    // instead of wrapping — the JS mirror of Compose's maxLines=1 +
    // TextOverflow.Ellipsis.
    var LINE_STYLE =
      ' style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"';
    var lines = [
      '<div style="font-weight:700;font-size:10px;font-family:system-ui,sans-serif">ShyTalk Preview</div>',
      "<div" + LINE_STYLE + ">" + statusLine + "</div>",
      "<div" +
        LINE_STYLE +
        ">" +
        escapeHtml(branch ? truncateMiddle(branch, BRANCH_MAX_CHARS) : "?") +
        "</div>",
      "<div" + LINE_STYLE + ">" + shaLine + "</div>",
      "<div" + LINE_STYLE + ">" + escapeHtml(getBrowserId()) + "</div>",
      "<div" + LINE_STYLE + ">" + uidLine + "</div>",
      "<div" + LINE_STYLE + ">" + localeRouteLine + "</div>",
    ];
    if (marker)
      lines.push("<div" + LINE_STYLE + ">▶ " + escapeHtml(marker) + "</div>");
    node.innerHTML = lines.join("");

    if (document.body) document.body.appendChild(node);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  // `defer` scripts execute when readyState === 'interactive' — AFTER
  // parsing but BEFORE DOMContentLoaded. shared-header.js (loaded
  // without defer) only injects its <header> on its own
  // DOMContentLoaded handler. If we render immediately at 'interactive'
  // we miss the header and position the badge at top:4 (inside the
  // header's hit-test area). Wait for DOMContentLoaded in BOTH the
  // 'loading' and 'interactive' cases so we always measure
  // `.sh-header.offsetHeight` after shared-header has rendered.
  if (document.readyState === "complete") {
    render();
  } else {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  }

  // Re-render every 2s so the UID / journey marker / health dot pick up
  // changes even on pages that fire no callbacks. Cheap — single DOM
  // node swap.
  setInterval(render, 2000);
})();
