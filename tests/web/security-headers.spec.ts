import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Pin the contract that public/_headers default `/*` block ships
 * defense-in-depth security headers.
 *
 * Why: 2026-05-09 /manual-qa surfaced gaps — the default `/*` block had
 * Cross-Origin-Opener-Policy + X-Content-Type-Options + Referrer-Policy
 * but lacked HSTS (downgrade attacks possible), X-Frame-Options
 * (clickjacking on legal / homepage / roadmap), and Permissions-Policy
 * (no granular feature control). Cloudflare may layer some of these at
 * edge but having them in `_headers` is defense-in-depth and survives
 * config drift at CF.
 *
 * Static-config validation, mirroring the cache-control-headers.spec.ts
 * pattern — local servers don't apply _headers so we can't HTTP-check.
 */

const HEADERS_PATH = path.resolve(__dirname, '../../public/_headers');

interface HeaderRule {
  pattern: string;
  headers: Record<string, string>;
}

function parseHeaders(content: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | null = null;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      if (current) rules.push(current);
      current = { pattern: line.trim(), headers: {} };
    } else if (current) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const name = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        current.headers[name.toLowerCase()] = value;
      }
    }
  }
  if (current) rules.push(current);
  return rules;
}

test.describe('public/_headers default block — defense-in-depth security', () => {
  test('default /* block ships HSTS, X-Frame-Options, Permissions-Policy', () => {
    const content = fs.readFileSync(HEADERS_PATH, 'utf8');
    const rules = parseHeaders(content);
    const defaultRule = rules.find((r) => r.pattern === '/*');
    expect(defaultRule, 'default /* rule missing from public/_headers').toBeDefined();

    // ── HSTS ────────────────────────────────────────────────────
    // Pinning HTTPS for at least a year protects users from
    // SSL-strip / downgrade attacks. `preload` keeps the domain
    // eligible for the browser HSTS preload list.
    const hsts = defaultRule!.headers['strict-transport-security'];
    expect(hsts, 'HSTS missing from default block').toBeDefined();
    const maxAgeMatch = hsts!.match(/max-age=(\d+)/);
    expect(maxAgeMatch, 'HSTS missing max-age').not.toBeNull();
    const maxAgeSec = Number(maxAgeMatch![1]);
    // 1 year minimum is the HSTS preload list requirement. Anything
    // shorter signals "we don't really mean it" to Chrome / Firefox.
    expect(maxAgeSec, 'HSTS max-age must be >= 1 year').toBeGreaterThanOrEqual(31536000);
    expect(hsts, 'HSTS must include subdomains').toMatch(/includeSubDomains/i);
    expect(hsts, 'HSTS must include preload').toMatch(/preload/i);

    // ── X-Frame-Options ─────────────────────────────────────────
    // Legal pages / homepage / roadmap should NOT be iframable —
    // clickjacking risk. Portal already has its own DENY (line 26).
    const xfo = defaultRule!.headers['x-frame-options'];
    expect(xfo, 'X-Frame-Options missing from default block').toBeDefined();
    expect(['DENY', 'SAMEORIGIN'], 'X-Frame-Options should be DENY or SAMEORIGIN').toContain(xfo);

    // ── Permissions-Policy ──────────────────────────────────────
    // Static web pages don't need camera / mic / geolocation /
    // payment / sensors. The native app uses these via platform
    // APIs, not browser ones. Lock them off so a future inline
    // script (or compromised dependency) can't request them.
    const pp = defaultRule!.headers['permissions-policy'];
    expect(pp, 'Permissions-Policy missing from default block').toBeDefined();
    const mustDisallow = ['camera', 'microphone', 'geolocation', 'payment'];
    for (const feature of mustDisallow) {
      // Format: `camera=()` (empty allowlist = disabled everywhere)
      const re = new RegExp(`${feature}\\s*=\\s*\\(\\)`);
      expect(pp, `Permissions-Policy must disable ${feature}`).toMatch(re);
    }
  });

  test('default block preserves existing baseline headers (no regression)', () => {
    const content = fs.readFileSync(HEADERS_PATH, 'utf8');
    const rules = parseHeaders(content);
    const defaultRule = rules.find((r) => r.pattern === '/*');
    expect(defaultRule).toBeDefined();
    // These were the original three; this PR adds three more on top
    // without removing them. Catches accidental deletion mid-edit.
    expect(defaultRule!.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    expect(defaultRule!.headers['x-content-type-options']).toBe('nosniff');
    expect(defaultRule!.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
});
