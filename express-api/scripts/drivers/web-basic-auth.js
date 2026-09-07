/**
 * web-basic-auth.js — which ShyTalk web targets sit behind the HTTP Basic wall,
 * and the credentials to present when they do (SHY-0529).
 *
 * Every ShyTalk web host except the live site and a local server is served by
 * Cloudflare Pages with `functions/_middleware.js` in front of it, which demands
 * HTTP Basic credentials. The journey-matrix web driver created its browser
 * contexts without any, so on dev every navigation returned 401 and matrix run
 * 20260906-184009-dev scored 0 passed / 559 failed — 559 reported product bugs
 * for one absent environment variable.
 *
 * This module owns the *decision* (which targets are walled) separately from the
 * driver that acts on it, because the decision is the half with a security
 * consequence: classify a hostile lookalike as walled and we hand it the dev
 * password. Hence three outcomes rather than a boolean — an unknown host is
 * refused, never treated as "probably ours".
 *
 * The prod predicates are imported from the wall itself rather than restated, so
 * the client and the server cannot drift apart.
 *
 * Tests: express-api/tests/scripts/drivers/web-basic-auth.test.js
 */

'use strict';

const {
  PROD_HOSTNAME,
  isProdHostname,
  isProdApiHostname,
} = require('../../../functions/_lib/lockdown.js');

/** Reachable without credentials: the live site, the live API, or a local server. */
const UNWALLED = 'unwalled';
/** A ShyTalk non-live host behind the Cloudflare Pages Basic wall. */
const WALLED = 'walled';
/** Not a known ShyTalk host. Refused — never guessed at. */
const UNRECOGNISED = 'unrecognised';

/** Cloudflare Pages env var `DEV_PASSWORD`; this is its name on the client side. */
const BASIC_AUTH_ENV_VAR = 'DEV_BASIC_AUTH_PASSWORD';

/**
 * `lockdown.js::basicAuthOk` discards the username half and compares only the
 * password, so this is convention for readable server logs, not a secret.
 */
const BASIC_AUTH_USERNAME = 'dev';

/** The wall is Cloudflare middleware; a server on the loopback never runs it. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

/**
 * Registrable hosts we own. A match is exact or on a label boundary, so a
 * lookalike that merely *contains* one of these strings — `evil-<prod host>`,
 * `notshytalk-site.pages.dev` — is somebody else's and does not qualify.
 *
 * The prod hostname is imported from the wall rather than written out again:
 * every non-live web host is a subdomain of it, so the suffix we own and the
 * hostname the wall exempts are necessarily the same string. Restating it would
 * let the two drift. Drift here fails closed — an unrecognised host is refused,
 * not guessed at — so a stale copy would strand the matrix on dev rather than
 * hand the password to a host we no longer recognise. Safe, but stranding the
 * matrix on dev is the exact failure this module exists to remove.
 *
 * The two Pages projects are named individually rather than allowing
 * `*.pages.dev`, which would hand the dev password to any third party's
 * Cloudflare Pages deployment.
 */
const SHYTALK_HOST_SUFFIXES = [
  PROD_HOSTNAME,
  'shytalk-site.pages.dev',
  'shytalk-site-dev.pages.dev',
];

/**
 * @param {unknown} baseURL
 * @returns {string|null} lowercase hostname, or null if it isn't a usable http(s) URL
 */
function hostnameOf(baseURL) {
  if (typeof baseURL !== 'string' || baseURL.length === 0) return null;
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const hostname = url.hostname.toLowerCase();
  return hostname.length === 0 ? null : hostname;
}

/** Exact match, or a subdomain of `suffix` — never a bare substring. */
function matchesHost(hostname, suffix) {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

/**
 * Classify a web target. Total function: anything unparseable, non-http, or not
 * demonstrably ours comes back UNRECOGNISED rather than defaulting either way.
 *
 * @param {unknown} baseURL
 * @returns {typeof UNWALLED | typeof WALLED | typeof UNRECOGNISED}
 */
function classifyWebTarget(baseURL) {
  const hostname = hostnameOf(baseURL);
  if (hostname === null) return UNRECOGNISED;

  // `new URL('http://[::1]:8888').hostname` keeps the IPv6 brackets.
  const bare =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (LOOPBACK_HOSTNAMES.has(bare)) return UNWALLED;

  // Both live hostnames are public. Sending them the dev password would put it
  // in a public server's access log. Checked before the suffix rule below,
  // which would otherwise capture `api.shytalk.shyden.co.uk`.
  if (isProdHostname(hostname) || isProdApiHostname(hostname)) return UNWALLED;

  if (SHYTALK_HOST_SUFFIXES.some((suffix) => matchesHost(hostname, suffix))) return WALLED;

  return UNRECOGNISED;
}

/**
 * The credentials a browser context should carry for `baseURL`.
 *
 * @param {unknown} baseURL
 * @param {Record<string, string|undefined>} [env] defaults to `process.env`
 * @returns {{username: string, password: string}|undefined} undefined when the
 *   target needs none
 * @throws when the target is not ours, or is walled and no password is set —
 *   deliberately loud, because the alternative is a whole matrix run of 401s
 *   reported as product failures.
 */
function basicAuthFor(baseURL, env = process.env) {
  const classification = classifyWebTarget(baseURL);
  if (classification === UNWALLED) return undefined;

  // Only ever the hostname in an error: a baseURL may carry userinfo
  // (`https://dev:password@host`), and these messages reach the runner log and
  // its artefacts.
  const target = hostnameOf(baseURL) ?? '<unparseable target>';

  if (classification === UNRECOGNISED) {
    throw new Error(
      `Refusing to run web journeys against "${target}": it is not a recognised ShyTalk ` +
        `web target, so it must not be sent the non-live Basic-auth password. Recognised ` +
        `targets are the live site, a loopback address, and subdomains of ` +
        `${SHYTALK_HOST_SUFFIXES.join(', ')}.`,
    );
  }

  const password = env[BASIC_AUTH_ENV_VAR];
  // An empty string is treated as absent: `lockdown.js::basicAuthOk` fails
  // closed on an empty expected password, so an empty value here would 401 on
  // every page — the same mass failure, one layer later.
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error(
      `"${target}" is behind the non-live Basic-auth wall but ${BASIC_AUTH_ENV_VAR} is not ` +
        `set. Source it with: set -a && source ~/.shytalk/dev-web-auth.env && set +a`,
    );
  }

  return { username: BASIC_AUTH_USERNAME, password };
}

module.exports = {
  UNWALLED,
  WALLED,
  UNRECOGNISED,
  BASIC_AUTH_ENV_VAR,
  BASIC_AUTH_USERNAME,
  classifyWebTarget,
  basicAuthFor,
};
