'use strict';

/* global window */
/* eslint-disable no-console -- driver methods log diagnostics for the
   manual QA runner (operator-facing CLI), not application code. Matches
   the header every sibling driver carries. */

/**
 * Shared `webSignIn` for every web driver (SHY-0328).
 *
 * The step `<Name> on Web signs in with valid credentials` had NO implementation
 * on ANY web driver — `webSignIn` was not even in the desktop driver's method
 * list, so it was not stubbed either and the runner saw `undefined`:
 * "ctx.webDriver.webSignIn not configured". Every journey needing an
 * authenticated browser died at its first gate, on every browser. Because it
 * failed uniformly — desktop chromium included, which touches no device — it
 * read as product debt rather than one missing method.
 *
 * Why a shared factory rather than six copies, or inheritance:
 *
 * The six web drivers are deliberately independent — they acquire a Page in
 * completely different ways (Playwright launch, CDP-over-adb into the device's
 * Chrome, safaridriver on a real iPhone). What they share is not page
 * ACQUISITION but what to DO with a page once they have one. So this takes
 * `pageFor` as a dependency and owns only the auth sequence. Six copies of the
 * auth logic would drift; a base class would force the acquisition to converge,
 * which is exactly what must not happen.
 *
 * Real Firebase auth, not injected state. `window.shytalkAuth.signInWithEmail`
 * is exposed by public/js/roadmap-auth.js:273 and calls
 * `auth.signInWithEmailAndPassword`, with the auth emulator wired at :150 when
 * PORTAL_CONFIG.USE_EMULATORS is set. Faking `window.shytalkAuth` does NOT work:
 * `apiFetch(..., { gated: true })` short-circuits without a real token, so gated
 * writes never leave the browser — measured on the suggestions board.
 *
 * Firebase persists the session per ORIGIN (IndexedDB), so signing in on
 * /roadmap.html leaves every other page on that origin authenticated too.
 */

/**
 * First name (or P-id) → persona registry entry, e.g. "Alice" → the P-02 record.
 *
 * Mirrors manual-qa-runner.js's loadPersonas() mapping rather than importing it:
 * the runner is a 16k-line CLI that CONSTRUCTS drivers, so requiring it from one
 * would invert the dependency. The registry itself is the shared source, so the
 * two cannot disagree about who a persona is — only about the lookup key, which
 * is one split() here.
 */
let _personaByName = null;
function resolvePersona(name) {
  if (!name) return null;
  if (!_personaByName) {
    const { personas } = require('../provision-test-personas');
    _personaByName = new Map();
    for (const persona of personas) {
      _personaByName.set(persona.displayName.split(/\s+/)[0], persona);
      _personaByName.set(persona.id, persona);
    }
  }
  return _personaByName.get(name) || null;
}

/**
 * Build a `webSignIn(name)` bound to one driver's page acquisition.
 *
 * @param {object} deps
 * @param {(name: string) => Promise<object>} deps.pageFor  the driver's own Page getter
 * @param {string} deps.baseURL                              origin under test
 * @param {string} deps.label                                driver name, for log lines
 * @returns {(name: string) => Promise<boolean>}
 */
function makeWebSignIn({ pageFor, baseURL, label }) {
  return async function webSignIn(name) {
    const persona = resolvePersona(name);
    if (!persona) {
      console.error(`[${label}] webSignIn("${name}") — persona not in registry`);
      return false;
    }
    const password = process.env.PERSONAS_PASSWORD;
    if (!password) {
      console.error(`[${label}] webSignIn("${name}") — PERSONAS_PASSWORD not set`);
      return false;
    }
    try {
      const page = await pageFor(name || 'default');
      await page.goto(`${baseURL.replace(/\/$/, '')}/roadmap.html`);
      // shytalkAuth is built asynchronously, after the Firebase SDK loads.
      await page.waitForFunction(
        () => Boolean(window.shytalkAuth && window.shytalkAuth.signInWithEmail),
        { timeout: 20000 },
      );
      const result = await page.evaluate(
        async ({ email, secret }) => {
          try {
            await window.shytalkAuth.signInWithEmail(email, secret);
            return { ok: true };
          } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
          }
        },
        { email: persona.email, secret: password },
      );
      if (!result.ok) {
        console.error(`[${label}] webSignIn("${name}") failed: ${result.error}`);
        return false;
      }
      // Assert the OUTCOME, not the call. signInWithEmail resolving is not the
      // same as the page having an authenticated user for the next step to act on.
      await page.waitForFunction(
        () => Boolean(window.shytalkAuth && window.shytalkAuth.currentUser),
        { timeout: 20000 },
      );
      return true;
    } catch (e) {
      console.error(`[${label}] webSignIn("${name}") threw: ${e.message}`);
      return false;
    }
  };
}

/**
 * `webSignIn` for the two drivers that speak WebDriver REST rather than holding
 * a Playwright Page — geckodriver (Firefox on Android) and Appium (WebKit on
 * iOS). They already own `navigateTo(url)` and an `/execute/sync` path; this
 * needs one more capability, `/execute/async`, because
 * `signInWithEmail` returns a Promise and a SYNC script would return before it
 * settles and report a false success.
 *
 * Same auth sequence, same outcome assertion, same refusals as makeWebSignIn —
 * only the transport differs. Kept beside it deliberately so the two can be read
 * against each other rather than drifting in separate files.
 *
 * @param {object} deps
 * @param {(url: string) => Promise<void>} deps.navigateTo
 * @param {(script: string, args?: unknown[]) => Promise<unknown>} deps.executeAsync
 * @param {string} deps.baseURL
 * @param {string} deps.label
 */
function makeWebSignInViaWebDriver({ navigateTo, executeAsync, baseURL, label }) {
  return async function webSignIn(name) {
    const persona = resolvePersona(name);
    if (!persona) {
      console.error(`[${label}] webSignIn("${name}") — persona not in registry`);
      return false;
    }
    const password = process.env.PERSONAS_PASSWORD;
    if (!password) {
      console.error(`[${label}] webSignIn("${name}") — PERSONAS_PASSWORD not set`);
      return false;
    }
    try {
      await navigateTo(`${baseURL.replace(/\/$/, '')}/roadmap.html`);
      // One async script does the waiting too: polling from Node over REST would
      // cost a round trip per attempt, and the page can settle in well under one.
      const result = await executeAsync(
        `
        var email = arguments[0], secret = arguments[1], done = arguments[2];
        var deadline = Date.now() + 20000;
        (function waitForAuth() {
          if (window.shytalkAuth && window.shytalkAuth.signInWithEmail) {
            window.shytalkAuth.signInWithEmail(email, secret).then(function () {
              (function waitForUser() {
                if (window.shytalkAuth && window.shytalkAuth.currentUser) return done({ ok: true });
                if (Date.now() > deadline) return done({ ok: false, error: 'no currentUser after sign-in' });
                setTimeout(waitForUser, 100);
              })();
            }, function (e) {
              done({ ok: false, error: (e && e.message) || String(e) });
            });
            return;
          }
          if (Date.now() > deadline) return done({ ok: false, error: 'shytalkAuth never appeared' });
          setTimeout(waitForAuth, 100);
        })();
        `,
        [persona.email, password],
      );
      if (!result || !result.ok) {
        console.error(
          `[${label}] webSignIn("${name}") failed: ${(result && result.error) || 'no result'}`,
        );
        return false;
      }
      return true;
    } catch (e) {
      console.error(`[${label}] webSignIn("${name}") threw: ${e.message}`);
      return false;
    }
  };
}

module.exports = { makeWebSignIn, makeWebSignInViaWebDriver, resolvePersona };
