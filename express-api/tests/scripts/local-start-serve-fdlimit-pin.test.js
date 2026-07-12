/**
 * local-start-serve-fdlimit-pin.test.js
 *
 * Pins that local/start.sh raises the file-descriptor limit before
 * launching the :8888 static web serve.
 *
 * Why: macOS's default per-process fd cap is 256, and `npx serve`
 * EMFILE-crashes MID-Playwright-run once enough sockets/files are open
 * — Node dies on open(), and the rest of the suite drowns in
 * ERR_CONNECTION_REFUSED "failures" that look like product bugs. This
 * exact failure burned SHY-0149 (root-cause session), SHY-0150's
 * pre-push (83 phantom fails), and SHY-0095's push (84 retried specs,
 * 143 did-not-run) before the launch was hardened. The runner-side
 * bring-up docs prescribed `ulimit -n 10240` all along; start.sh step
 * 6b was the one unprotected launcher left.
 *
 * Structure-pin convention (same class as the workflow-pin tests): the
 * script is bash, so the contract is pinned by reading the source.
 */
const fs = require('fs');
const path = require('path');

const START_SH = path.resolve(__dirname, '../../../local/start.sh');

describe('local/start.sh — :8888 serve fd-limit hardening', () => {
  const lines = fs.readFileSync(START_SH, 'utf8').split('\n');
  const serveIdx = lines.findIndex((l) => /npx serve public .*-l 8888/.test(l));
  const ulimitIdx = lines.findIndex((l) => /^\s*ulimit -n (\d+)/.test(l));

  test('the serve launch exists (guard for this pin going stale)', () => {
    expect(serveIdx).toBeGreaterThan(-1);
  });

  test('an ulimit raise of at least 10240 precedes the serve launch nearby', () => {
    expect(ulimitIdx).toBeGreaterThan(-1);
    const m = /^\s*ulimit -n (\d+)/.exec(lines[ulimitIdx]);
    expect(parseInt(m[1], 10)).toBeGreaterThanOrEqual(10240);
    expect(ulimitIdx).toBeLessThan(serveIdx);
    // Locality: the raise must be part of the step-6b launch block, not
    // an unrelated line elsewhere that a refactor could strand.
    expect(serveIdx - ulimitIdx).toBeLessThanOrEqual(10);
  });
});
