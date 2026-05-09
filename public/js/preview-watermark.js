/**
 * Preview-build watermark for non-prod web pages.
 *
 * Mirrors `shared/src/commonMain/.../core/PreviewWatermark.kt` on the
 * mobile side: any host that ISN'T the production API origin renders a
 * fixed-position red badge with "ShyTalk Preview", the detected
 * environment, the build/release indicator, the browser name + version,
 * and the signed-in user's UID (or "-" when not signed in).
 *
 * Production explicitly opts out: when `getEnvironment()` returns
 * `"prod"` the script is a no-op. Hostname mapping:
 *   - `localhost` / `127.0.0.1`           → "local"
 *   - hosts matching `/dev-api\.|dev\./`  → "dev"
 *   - everything else                      → "prod"
 *
 * `window.__preview_env_override` (string, set by Playwright tests
 * before the script runs) takes precedence over hostname detection,
 * which lets the test suite verify the prod opt-out without spinning
 * up a real prod-shaped origin.
 *
 * The watermark observes Firebase Auth state (when the page has
 * Firebase available) so the UID updates after sign-in without
 * requiring a page reload. When Firebase isn't initialised yet (e.g.
 * the static landing page), UID stays as "-".
 */
(function initPreviewWatermark() {
  'use strict';

  function getEnvironment() {
    if (typeof window.__preview_env_override === 'string') {
      return window.__preview_env_override;
    }
    var host = window.location.hostname || '';
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'local';
    if (/dev-api\.|dev\.shytalk/.test(host)) return 'dev';
    return 'prod';
  }

  function getBrowserId() {
    var ua = navigator.userAgent || '';
    // Order matters — Chrome reports "Chrome ... Safari" so test for it
    // before generic Safari; Edge reports "Chrome ... Edg/" so check Edg
    // first; Firefox + WebKit are unambiguous.
    var match;
    if ((match = /Edg\/([0-9.]+)/.exec(ua))) return 'Edge ' + match[1].split('.')[0];
    if ((match = /Firefox\/([0-9.]+)/.exec(ua))) return 'Firefox ' + match[1].split('.')[0];
    if ((match = /Chrome\/([0-9.]+)/.exec(ua))) return 'Chrome ' + match[1].split('.')[0];
    if ((match = /Version\/([0-9.]+).*Safari/.exec(ua))) return 'Safari ' + match[1].split('.')[0];
    if (/AppleWebKit/.test(ua)) return 'WebKit';
    return 'Unknown';
  }

  function getBuildVersion() {
    // Use a meta tag if present (set by deploy pipelines), otherwise
    // fall back to the script's own date stamp via document.lastModified.
    var meta = document.querySelector('meta[name="shytalk-build"]');
    if (meta && meta.content) return meta.content;
    return document.lastModified || '?';
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
    } catch (_) { /* Firebase not initialised */ }
    try {
      if (window.__shytalk_user_uid) return window.__shytalk_user_uid;
    } catch (_) { /* not present */ }
    try {
      var ls = localStorage.getItem('shytalk_user_uid');
      if (ls) return ls;
    } catch (_) { /* localStorage blocked */ }
    return null;
  }

  var env = getEnvironment();
  if (env === 'prod') return; // No watermark on prod.

  function render() {
    var existing = document.getElementById('preview-watermark');
    if (existing) existing.remove();

    var node = document.createElement('div');
    node.id = 'preview-watermark';
    node.setAttribute('aria-hidden', 'true');
    // Dodge the shared header (public/js/shared-header.js) when one is
    // present — otherwise the badge sits inside the header's hit-test
    // area at the top of the page, swallowing taps that should reach
    // the header (e.g. the Sign In button) and visually overlapping
    // the header chrome. Pages without the shared header keep the
    // original top:4 placement. The 2s re-render interval guarantees
    // the position stays correct if the header is injected after the
    // first render (init race between the two scripts).
    var sharedHeader = document.querySelector('.sh-header');
    var topPx = (sharedHeader ? sharedHeader.offsetHeight : 0) + 4;
    node.style.cssText = [
      'position:fixed',
      'top:' + topPx + 'px',
      'right:4px',
      'z-index:2147483647', // max int — guarantee on top of any modal
      // Alpha 0.4 — visible enough to read the build/env/UID lines
      // against any background, transparent enough that the underlying
      // page colour clearly bleeds through. The contract is enforced by
      // the alpha test in preview-watermark.spec.ts (≤ 0.5, ≥ 0.1).
      'background:rgba(211,47,47,0.4)',
      'color:#fff',
      // White text against semi-transparent red can wash out — add a
      // subtle dark text-shadow so the labels remain readable on light
      // backgrounds without bumping the badge opacity back up.
      'text-shadow:0 1px 2px rgba(0,0,0,0.6)',
      'padding:3px 6px',
      'border-radius:3px',
      'font-family:ui-monospace,Menlo,Consolas,monospace',
      'font-size:9px',
      'line-height:1.3',
      'text-align:right',
      'pointer-events:none',
      'user-select:none',
      '-webkit-user-select:none',
    ].join(';');

    var lines = [
      '<div style="font-weight:700;font-size:10px;font-family:system-ui,sans-serif">ShyTalk Preview</div>',
      '<div>' + escapeHtml(env) + ' · ' + escapeHtml(getBuildVersion()) + '</div>',
      '<div>' + escapeHtml(getBrowserId()) + '</div>',
      '<div>UID: ' + escapeHtml(getCurrentUid() || '-') + '</div>',
    ];
    node.innerHTML = lines.join('');

    if (document.body) document.body.appendChild(node);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
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
  if (document.readyState === 'complete') {
    render();
  } else {
    document.addEventListener('DOMContentLoaded', render, { once: true });
  }

  // Re-render every 2s so the UID picks up after sign-in even on pages
  // that don't fire an auth-state-changed callback. Cheap — single
  // DOM node swap.
  setInterval(render, 2000);
})();
