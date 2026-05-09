import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Pin the contract that public/_headers requires JS / CSS to be
 * revalidated frequently.
 *
 * Why: Cloudflare Pages default Cache-Control for unfingerprinted
 * assets is `public, max-age=14400` (4 hours), so a fix deployed to
 * e.g. /js/logger.js takes up to 4 hours to reach users with stale
 * copies. Found during manual-qa on 2026-05-09: the logger fetch-
 * wrapper recursion fix in PR #562 was in the served file but a
 * cached pre-fix copy kept hitting "Maximum call stack size
 * exceeded" in the browser. `must-revalidate` + a short max-age
 * forces an If-Modified-Since round-trip every 5 minutes.
 *
 * This is a static-config validation test, not a runtime test —
 * Cloudflare Pages applies _headers, but local Python http.server /
 * `npx serve` don't, so we can't assert HTTP response headers
 * locally. Instead we parse the file and assert the rule is present.
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
      // New pattern
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

test.describe('public/_headers cache-control rules (regression)', () => {
  test('JS / CSS routes require browser revalidation', () => {
    const content = fs.readFileSync(HEADERS_PATH, 'utf8');
    const rules = parseHeaders(content);

    // The four routes that must have revalidation. Missing any of
    // these means a deployed JS/CSS fix can stick at the prior
    // Cloudflare-default 4h cache for end users.
    const requiredPatterns = ['/js/*', '/css/*', '/admin/js/*', '/portal/*.js'];
    const found = new Map<string, HeaderRule>();
    for (const rule of rules) {
      if (requiredPatterns.includes(rule.pattern)) {
        found.set(rule.pattern, rule);
      }
    }

    for (const pattern of requiredPatterns) {
      const rule = found.get(pattern);
      expect(rule, `${pattern} rule missing from public/_headers`).toBeDefined();
      const cc = rule!.headers['cache-control'];
      expect(cc, `${pattern} missing Cache-Control`).toBeDefined();
      expect(cc, `${pattern} must have must-revalidate`).toContain('must-revalidate');
      // Max-age must be short enough that a deploy reaches users in
      // the same session — 5 minutes is the contract.
      const maxAgeMatch = cc!.match(/max-age=(\d+)/);
      expect(maxAgeMatch, `${pattern} missing max-age`).not.toBeNull();
      const maxAgeSec = Number(maxAgeMatch![1]);
      expect(maxAgeSec, `${pattern} max-age must be <= 600s (10 min)`).toBeLessThanOrEqual(600);
      expect(maxAgeSec, `${pattern} max-age must be > 0`).toBeGreaterThan(0);
    }
  });
});
