/**
 * Read the Android UI hierarchy over a WARM server (SHY-0447).
 *
 * ## Why this exists
 *
 * `adb exec-out uiautomator dump` spawns a fresh instrumentation for every
 * call. Measured on the real OnePlus, 2026-08-23:
 *
 *   uiautomator dump        ~2332ms
 *   UiAutomator2 /source      ~65ms      36x faster
 *
 * A J38 walk made 78 reads: 182 seconds, **86% of the entire run**. The cost is
 * identical on the Android launcher, so it is the tool and not the app. iOS was
 * never slow this way because WebDriverAgent is a server that stays up between
 * calls — this gives Android the same shape.
 *
 * ## What moves, and what does not
 *
 * ONLY the read. Taps, swipes, installs and the rest stay on adb: they are
 * proven, they are not where the time goes, and changing them would put every
 * Android journey at risk for no measurable gain.
 *
 * ## When it is not available
 *
 * The driver is an opt-in Appium install. Where it is missing this returns
 * `null` and the caller falls back to `uiautomator dump` — LOUDLY, because a
 * silent fallback hides a 36x regression behind a run that is merely slow.
 */

'use strict';

const DEFAULT_APPIUM_BASE_URL = process.env.APPIUM_BASE_URL || 'http://127.0.0.1:4723';

/** Said out loud when the fast path is not available. Never swallowed. */
const ANDROID_SOURCE_UNAVAILABLE =
  'UiAutomator2 is not available, so the screen is being read with `uiautomator dump` ' +
  '(~2.3s per read instead of ~65ms, which is most of a walk). Install it with: ' +
  'appium driver install uiautomator2 — and make sure the Appium server was started ' +
  'with ANDROID_HOME set, or the Android driver refuses every session.';

/**
 * Failures that mean the SESSION is gone rather than the command having a real
 * answer. Same question, and the same deliberate narrowness, as the iOS side:
 * a genuine error about the screen must not trigger a rebuild.
 */
const SESSION_LOST = [
  'socket hang up',
  'econnreset',
  'econnrefused',
  'epipe',
  'invalid session id',
  'session is either terminated or not started',
  'a session is either terminated',
  'instrumentation process is not running',
];

function looksLikeLostSession(error) {
  const m = ((error && error.message) || String(error || '')).toLowerCase();
  return Boolean(m) && SESSION_LOST.some((s) => m.includes(s));
}

/**
 * Rewrite UiAutomator2's source into the shape `uiautomator dump` produces.
 *
 * The two readers differ in exactly ONE way — where the class name lives:
 *
 *   uiautomator dump   <node class="android.widget.Button" resource-id="x" …/>
 *   UiAutomator2       <android.widget.Button class="android.widget.Button" …/>
 *
 * Every attribute the journeys read — resource-id, text, bounds, enabled,
 * clickable, package — is identical and already carries the class as an
 * attribute too. Verified on the real phone, 2026-08-23: both readers returned
 * the SAME EIGHT ids for the same Home screen, Compose testTags included.
 *
 * Adapting here rather than teaching `parseNodes` two formats is deliberate.
 * `byId`, `byText`, `occluderOf` and `assertReachable` are built on the node
 * shape and so is every test that proves them; a second format would ripple
 * through all of it for no gain. Downstream never learns there are two.
 *
 * Left alone: `<hierarchy>`, which both formats use as the root.
 */
function normaliseUiAutomator2Source(xml) {
  return String(xml).replace(/<(\/?)([A-Za-z_][\w.$]*)([\s/>])/g, (whole, slash, tag, tail) =>
    tag === 'hierarchy' ? whole : `<${slash}node${tail}`,
  );
}

/**
 * Escape a value for embedding in a UiSelector expression.
 *
 * The selector is a Java expression the device evaluates, so a stray quote
 * either fails to parse or — worse — selects something else. Backslashes are
 * escaped BEFORE quotes, or the backslash the quote-pass inserts gets escaped
 * a second time.
 */
function escapeUiSelectorArg(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Match a control by the resource-id a Compose testTag surfaces as.
 *
 * NOT Appium's `id` strategy, which wants a fully-qualified
 * `package:id/name`. A testTag surfaces as a bare `resource-id` such as
 * `support_back`, and both `id` and `accessibility id` answer "An element
 * could not be located" for it — measured on the real OnePlus. UiSelector
 * matches the raw string, which is what `byId` matches in the journeys.
 */
function androidResourceIdSelector(tag) {
  if (!tag || typeof tag !== 'string') {
    throw new Error(`an element tag is required to build a selector; got ${JSON.stringify(tag)}`);
  }
  return `new UiSelector().resourceId("${escapeUiSelectorArg(tag)}")`;
}

/** Match a control by its exact visible text, the way `byText` does. */
function androidTextSelector(text) {
  if (!text || typeof text !== 'string') {
    throw new Error(`element text is required to build a selector; got ${JSON.stringify(text)}`);
  }
  return `new UiSelector().text("${escapeUiSelectorArg(text)}")`;
}

/**
 * How long one Appium round trip may take before it is abandoned.
 *
 * `fetch` has no default timeout, so a wedged Appium holds the request until
 * the OS gives up — minutes, inside a step the caller believes is quick. That
 * is SHY-0451, found on the iPhone (`ios-journey-device.js`), and this is the
 * same channel on the sibling platform: identical shape, no bound, and no
 * reason to wait for it to strike here too.
 *
 * Android reads measure ~65ms. Ten seconds is well over a hundred times the
 * healthy case, so anything reaching it is stuck, not slow.
 */
const APPIUM_REQUEST_TIMEOUT_MS = 10000;

/** One JSON round trip to Appium. Injected in tests so the policy is testable. */
async function httpRequest(baseUrl, method, path, _body, timeoutMs = APPIUM_REQUEST_TIMEOUT_MS) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(_body ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${String(parsed?.value?.message ?? '').slice(0, 300)}`,
    );
  }
  return parsed?.value;
}

/**
 * Stand up a UiAutomator2 session for reading the screen.
 *
 * @returns `{ dumpXml, close }`, or `null` when Appium cannot serve Android —
 *   the caller is expected to fall back and say so.
 */
async function createAndroidSourceSession({
  serial,
  appiumBaseUrl = DEFAULT_APPIUM_BASE_URL,
  request,
  // Injectable so the bound can be PROVEN against a real hung socket in
  // milliseconds. Racing jest's own timeout against the production value
  // tests which number is larger, not whether a signal is attached.
  requestTimeoutMs = APPIUM_REQUEST_TIMEOUT_MS,
} = {}) {
  const call =
    request ||
    ((method, path, body) => httpRequest(appiumBaseUrl, method, path, body, requestTimeoutMs));

  let sessionId = null;

  const open = async () => {
    const value = await call('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:udid': serial,
          // The app under test is launched and stopped by the journeys over
          // adb, not by this session — it exists only to read the screen.
          'appium:autoLaunch': false,
          'appium:noReset': true,
          // Long enough to outlive the slowest step. The server is torn down
          // deliberately at the end of a run instead.
          'appium:newCommandTimeout': 600,
          // The runner drives taps over adb; nothing here needs to survive a
          // crash of the app under test, and the server runs in its own
          // process so it does not.
          'appium:skipServerInstallation': false,
        },
      },
    });
    sessionId = value?.sessionId || value?.value?.sessionId;
    if (!sessionId) throw new Error('Appium returned no sessionId for UiAutomator2');
    return sessionId;
  };

  try {
    await open();
  } catch (_e) {
    // Not installed, no ANDROID_HOME, no device — all the same to the caller,
    // which falls back and prints ANDROID_SOURCE_UNAVAILABLE.
    return null;
  }

  const readOnce = async () => {
    const xml = await call('GET', `/session/${sessionId}/source`, null);
    if (!xml || !String(xml).includes('<hierarchy')) {
      throw new Error(
        `not a UI hierarchy: ${String(xml).slice(0, 120) || '(empty)'} — an empty node list ` +
          'reads to every caller as "the element is absent", which is not the same thing',
      );
    }
    return normaliseUiAutomator2Source(xml);
  };

  /** Resolve one element, returning Appium's handle for it. */
  const findElement = async (selector) => {
    const el = await call('POST', `/session/${sessionId}/element`, {
      using: '-android uiautomator',
      value: selector,
    });
    const id = el?.['element-6066-11e4-a52e-4f735466cecf'] || el?.ELEMENT;
    if (!id) throw new Error(`no element matched ${selector}`);
    return id;
  };

  return {
    /**
     * Click a control as an ELEMENT — Appium resolves it and clicks it
     * server-side, so there is no window between deciding where a control is
     * and touching that point (SHY-0448).
     */
    async tapElement(tag) {
      const selector = androidResourceIdSelector(tag);
      const id = await findElement(selector);
      await call('POST', `/session/${sessionId}/element/${id}/click`, {});
    },

    /** The same, by exact visible text, for controls with no testTag. */
    async tapElementByLabel(label) {
      const id = await findElement(androidTextSelector(label));
      await call('POST', `/session/${sessionId}/element/${id}/click`, {});
    },

    async dumpXml() {
      try {
        return await readOnce();
      } catch (e) {
        if (!looksLikeLostSession(e)) throw e;
        // The server died. Stand a new one up and read again — once. A second
        // death in a row is a real problem, not something to loop over.
        sessionId = null;
        await open();
        return readOnce();
      }
    },
    async close() {
      if (!sessionId) return;
      const id = sessionId;
      sessionId = null;
      await call('DELETE', `/session/${id}`, null).catch(() => {});
    },
  };
}

module.exports = {
  createAndroidSourceSession,
  androidResourceIdSelector,
  androidTextSelector,
  escapeUiSelectorArg,
  normaliseUiAutomator2Source,
  looksLikeLostSession,
  ANDROID_SOURCE_UNAVAILABLE,
  DEFAULT_APPIUM_BASE_URL,
  APPIUM_REQUEST_TIMEOUT_MS,
};
