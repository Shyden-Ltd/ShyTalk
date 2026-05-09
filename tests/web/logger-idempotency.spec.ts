import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Regression: ShyTalkLogger.init() must be idempotent.
 *
 * The admin panel (and other surfaces) call `ShyTalkLogger.init()` from
 * within Firebase's `onAuthStateChanged` callback (admin/js/main.js).
 * That callback fires on every sign-in, sign-out → sign-in cycle, ID-
 * token refresh, and tab focus. Each call invokes `_setupFetchInterceptor`,
 * `_setupErrorHandlers`, and `_setupClickTracking`.
 *
 * Pre-fix bug: those helpers had no double-install guard. Each
 * re-init wrapped `window.fetch` with a NEW wrapper that captured the
 * PREVIOUS wrapper as `_originalFetch`. After N sign-in cycles, every
 * fetch hit a chain of N wrappers calling each other, blowing the
 * stack with "Maximum call stack size exceeded" — observed in the
 * admin panel's alert-count loader and gift-catalog loader during
 * manual QA on 2026-05-09.
 *
 * Tests below pin the idempotency contract:
 *   1. Calling init() many times leaves window.fetch wrapped exactly once
 *   2. A subsequent fetch does NOT throw "Maximum call stack size exceeded"
 *   3. Error and click handler counts also stay at one each
 */
test.describe('ShyTalkLogger — init idempotency (regression)', () => {
  test('multiple init() calls leave fetch wrapped exactly once', async ({ page }) => {
    await page.goto(`${BASE}/`);
    // Wait for logger.js to load
    await page.waitForFunction(() => typeof (window as any).ShyTalkLogger !== 'undefined');

    const result = await page.evaluate(() => {
      const Logger = (window as any).ShyTalkLogger;
      const fetchBeforeReinit = window.fetch;
      // Re-init 10 times — simulates 10 auth-state changes
      for (let i = 0; i < 10; i++) {
        Logger.init({ source: 'test', endpoint: '/api/logs' });
      }
      const fetchAfterReinit = window.fetch;
      return {
        // Reference equality: window.fetch must NOT have been replaced again
        fetchSwapped: fetchBeforeReinit !== fetchAfterReinit,
        fetchInterceptorInstalled: !!Logger._fetchInterceptorInstalled,
        errorHandlersInstalled: !!Logger._errorHandlersInstalled,
        clickTrackingInstalled: !!Logger._clickTrackingInstalled,
      };
    });

    expect(result.fetchSwapped).toBe(false);
    expect(result.fetchInterceptorInstalled).toBe(true);
    expect(result.errorHandlersInstalled).toBe(true);
    expect(result.clickTrackingInstalled).toBe(true);
  });

  test('fetch survives many init() cycles without stack overflow', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => typeof (window as any).ShyTalkLogger !== 'undefined');

    const result = await page.evaluate(async () => {
      const Logger = (window as any).ShyTalkLogger;
      // Simulate 20 auth-state changes — pre-fix this would have wrapped
      // window.fetch 20 deep, blowing the stack on the next request.
      for (let i = 0; i < 20; i++) {
        Logger.init({ source: 'test', endpoint: '/api/logs' });
      }
      try {
        // Use a same-origin URL so we go through the fetch interceptor's
        // own-API branch, exercising the trace-header path that previously
        // crashed.
        const res = await fetch('/favicon.ico');
        return { ok: true, status: res.status };
      } catch (err: any) {
        return { ok: false, error: err.name + ': ' + (err.message || '').slice(0, 200) };
      }
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  test('error handler does not multi-fire after many init() cycles', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => typeof (window as any).ShyTalkLogger !== 'undefined');

    // Install a counter that increments every time the logger logs an error
    // (which happens via the window error handler, going through Logger.error).
    const errorLogCount = await page.evaluate(async () => {
      const Logger = (window as any).ShyTalkLogger;
      let count = 0;
      // Replace the public error method with a counting proxy. The handlers
      // installed by _setupErrorHandlers call `self.error(...)` so this
      // counter measures handler dispatch count.
      const originalError = Logger.error.bind(Logger);
      Logger.error = function (...args: any[]) {
        count++;
        return originalError(...args);
      };
      // Re-init 5 times
      for (let i = 0; i < 5; i++) {
        Logger.init({ source: 'test', endpoint: '/api/logs' });
      }
      // Synthesise one window.error event — pre-fix this would have called
      // self.error() 5 times (once per stacked listener); now exactly once.
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'idempotency-test',
        filename: 'test',
        lineno: 1,
        colno: 1,
        error: new Error('idempotency-test'),
      }));
      return count;
    });

    expect(errorLogCount).toBe(1);
  });

  test('click tracker does not multi-fire after many init() cycles', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForFunction(() => typeof (window as any).ShyTalkLogger !== 'undefined');

    const clickLogCount = await page.evaluate(async () => {
      const Logger = (window as any).ShyTalkLogger;
      let count = 0;
      const originalInfo = Logger.info.bind(Logger);
      Logger.info = function (msg: string, ctx: any) {
        if (typeof msg === 'string' && msg.startsWith('User clicked: ')) count++;
        return originalInfo(msg, ctx);
      };
      // Re-init 5 times
      for (let i = 0; i < 5; i++) {
        Logger.init({ source: 'test', endpoint: '/api/logs' });
      }
      // Inject a tracked button and dispatch click
      const btn = document.createElement('button');
      btn.setAttribute('data-log', 'idempotency-test-click');
      document.body.appendChild(btn);
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      btn.remove();
      return count;
    });

    expect(clickLogCount).toBe(1);
  });
});
