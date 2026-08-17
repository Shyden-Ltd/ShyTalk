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
 * Build the lookup Map, REFUSING any duplicate key.
 *
 * A plain `Map.set` per persona would let a future "Alice Chen" beside
 * "Alice Anderson" silently overwrite the entry, so every `Alice` step would
 * sign in as whichever persona the registry listed last. The journey would then
 * PASS while asserting against the wrong account — a green test proving the
 * wrong thing, which is more expensive than a red one. First names are a
 * stringly-typed key over a registry nobody edits with this collision in mind,
 * so the collision has to be loud at build time rather than latent.
 *
 * Exported (and pure — array in, Map out) so the refusal is directly testable
 * on a colliding array without touching the real registry.
 *
 * @param {Array<{id: string, displayName: string}>} personas
 * @returns {Map<string, object>}
 */
function buildPersonaIndex(personas) {
  const index = new Map();
  const claimedBy = new Map();
  const claim = (key, persona) => {
    const existing = claimedBy.get(key);
    if (existing && existing !== persona.id) {
      throw new Error(
        `persona lookup key "${key}" is claimed by BOTH ${existing} and ${persona.id} — ` +
          `journeys naming "${key}" would sign in as whichever was registered last. ` +
          `Give one of them a distinct first name in provision-test-personas.js.`,
      );
    }
    claimedBy.set(key, persona.id);
    index.set(key, persona);
  };
  for (const persona of personas) {
    claim(persona.displayName.split(/\s+/)[0], persona);
    claim(persona.id, persona);
  }
  return index;
}

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
    _personaByName = buildPersonaIndex(personas);
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
      // `name` is guaranteed non-empty: resolvePersona returns null for a falsy
      // name and we have already refused above. No `|| 'default'` fallback —
      // it would only mislead a reader into thinking an empty name reaches here.
      const page = await pageFor(name);
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
/**
 * The browser-side sign-in state machine, sent verbatim to `/execute/async`.
 *
 * Extracted to a named constant so it can be executed and asserted on directly
 * (SHY-0328 R2). It is self-contained — its only collaborators are
 * `window.shytalkAuth`, `Date.now` and `setTimeout`, all of which a test can
 * supply — so proving `done()` fires EXACTLY ONCE on every path does not
 * require a browser, and does not require faking any real service.
 *
 * That property is the whole point: `done()` firing twice, or firing early,
 * is a FALSE SUCCESS — the runner would record a signed-in browser that is not
 * signed in. That is the exact failure class this module exists to remove, so
 * it deserves a regression net rather than a once-off device observation.
 *
 * Receives `arguments[0]=email, [1]=secret, [2]=done` — the W3C
 * `/execute/async` calling convention, where the last argument is the callback.
 */
const WEBDRIVER_SIGN_IN_SCRIPT = `
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
        `;

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
      const result = await executeAsync(WEBDRIVER_SIGN_IN_SCRIPT, [persona.email, password]);
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

module.exports = {
  makeWebSignIn,
  makeWebSignInViaWebDriver,
  resolvePersona,
  buildPersonaIndex,
  WEBDRIVER_SIGN_IN_SCRIPT,
};
