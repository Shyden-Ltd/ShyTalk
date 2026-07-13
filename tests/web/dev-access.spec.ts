import { test, expect, request as apiRequest } from '@playwright/test';

/**
 * SHY-0182 — the dev web pages are gated behind HTTP Basic auth (Cloudflare
 * Pages `_middleware.js`, realm "ShyTalk Non-Prod"). A dev BUILD of the app
 * carries the credential and gets through (WebUrls.devWebBasicAuth); an
 * un-credentialed request must be BLOCKED.
 *
 * This proves the gate end-to-end with REAL requests (no mock) — the two halves
 * of the story's "dev-access" Test-Plan item: credentialed → reaches the page,
 * un-credentialed → 401 challenge. It runs ONLY against the gated dev host
 * (DEV_BASIC_AUTH_PASSWORD set + a non-localhost WEB_BASE); localhost has no
 * Pages-Function gate, so there's nothing to assert there.
 */

const WEB_BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';
const DEV_BASIC_AUTH_PASSWORD = process.env.DEV_BASIC_AUTH_PASSWORD;
// The gate only exists on the deployed non-prod host. Skip otherwise.
const isGatedDev = !!DEV_BASIC_AUTH_PASSWORD && !WEB_BASE.includes('localhost');

// A legal page — exactly what the app opens on dev (WebUrls.LegalDoc.PRIVACY).
const GATED_PAGE = `${WEB_BASE}/privacy.html`;

test.describe('SHY-0182: dev-page Basic-auth access gate', () => {
  test.skip(
    !isGatedDev,
    'runs only against the Basic-auth-gated dev host (set DEV_BASIC_AUTH_PASSWORD + a non-localhost WEB_BASE_URL)',
  );

  test('a credentialed request reaches the restricted legal page', async () => {
    // The username is ignored by the middleware — only the password matters —
    // but 'dev' is the canonical value the deploy sanity check also uses.
    const ctx = await apiRequest.newContext({
      httpCredentials: { username: 'dev', password: DEV_BASIC_AUTH_PASSWORD as string },
    });
    const res = await ctx.get(GATED_PAGE);
    // 2xx after auth (following the canonical-URL redirect); crucially NOT 401.
    expect(res.ok(), `credentialed request should reach the page, got ${res.status()}`).toBe(true);
    expect(res.status()).not.toBe(401);
    await ctx.dispose();
  });

  test('an un-credentialed request is blocked with a 401 Basic-auth challenge', async () => {
    const ctx = await apiRequest.newContext(); // no httpCredentials
    const res = await ctx.get(GATED_PAGE, { maxRedirects: 0 });
    expect(res.status(), 'un-credentialed request must be blocked').toBe(401);
    // The challenge names the non-prod realm — proves it's the lockdown gate.
    const authenticate = res.headers()['www-authenticate'] || '';
    expect(authenticate.toLowerCase()).toContain('basic');
    expect(authenticate).toContain('ShyTalk Non-Prod');
    await ctx.dispose();
  });

  test('a WRONG password is rejected (the gate actually checks the value)', async () => {
    const ctx = await apiRequest.newContext({
      httpCredentials: { username: 'dev', password: 'definitely-not-the-password' },
    });
    const res = await ctx.get(GATED_PAGE, { maxRedirects: 0 });
    expect(res.status(), 'a wrong password must not pass').toBe(401);
    await ctx.dispose();
  });
});
