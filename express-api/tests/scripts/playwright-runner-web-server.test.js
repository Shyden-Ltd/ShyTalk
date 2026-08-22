/**
 * The Playwright runner has to point at the web server the stack actually runs.
 *
 * ## What happened
 *
 * `local/test-playwright.sh` started its OWN static server —
 * `npx serve public -l 8080` — and pointed `WEB_BASE_URL` at it. Two things
 * were wrong with that line, and each is fatal on its own:
 *
 *   1. **`npx serve` was RETIRED by SHY-0180.** It dies ~15 minutes into a
 *      heavy Chromium suite: the `npm exec` wrapper takes a SIGINT/SIGTERM and
 *      its shutdown path crashes on an EBADF from an in-flight read, turning
 *      the tail of the suite into mass ERR_CONNECTION_REFUSED phantom
 *      failures. It blocked a push three times and killed ~5 runs.
 *      `local/serve-web.js` replaced it everywhere — except here.
 *   2. **Port 8080 is the FIRESTORE EMULATOR.** Every other reference to
 *      `localhost:8080` in this repo is Firestore. So `serve` could not bind,
 *      and every admin spec ran against the emulator's 404 page. They failed
 *      in `adminLogin` looking for a Sign In button on a page that was never
 *      the admin panel — a harness failure that reads exactly like a broken
 *      login.
 *
 * The sweep when SHY-0180 landed missed this one script, which is why this
 * guard checks the CLASS rather than the line: no runner may start `npx serve`,
 * and no runner may serve the web tier on Firestore's port.
 *
 * See [[feedback-consistency-whole-project]] and
 * [[feedback-partial-local-stack-produces-false-test-failures]].
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const LOCAL_DIR = path.join(repoRoot, 'local');

/** Every shell script that starts or drives part of the local stack. */
const SCRIPTS = fs
  .readdirSync(LOCAL_DIR)
  .filter((f) => f.endsWith('.sh'))
  .map((f) => path.join(LOCAL_DIR, f));

/** Comments explain the history; only executable lines can start a server. */
const codeOf = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');

const FIRESTORE_EMULATOR_PORT = 8080;

describe('local stack scripts — the web tier', () => {
  test('there are scripts to check (the guard is not vacuous)', () => {
    expect(SCRIPTS.length).toBeGreaterThan(2);
  });

  test.each(SCRIPTS.map((f) => [path.basename(f), f]))(
    '%s does not resurrect `npx serve`',
    (_name, file) => {
      expect(codeOf(file)).not.toMatch(/npx\s+serve\b/);
    },
  );

  test.each(SCRIPTS.map((f) => [path.basename(f), f]))(
    "%s does not serve the web tier on Firestore's port",
    (_name, file) => {
      // `-l 8080` / `--listen 8080` / `PORT=8080` on a static server. The
      // emulator owns this port, so anything else binding it either fails to
      // start or steals traffic from Firestore.
      expect(codeOf(file)).not.toMatch(
        new RegExp(`(-l|--listen|--port|PORT=)\\s*${FIRESTORE_EMULATOR_PORT}\\b`),
      );
    },
  );

  test('the Playwright runner points at the stack web server, not one of its own', () => {
    const runner = path.join(LOCAL_DIR, 'test-playwright.sh');
    const code = codeOf(runner);
    expect(code).toMatch(/WEB_BASE_URL=http:\/\/localhost:8888/);
    // A runner that starts a second web server is a runner whose results depend
    // on which of the two Playwright happened to reach.
    expect(code).not.toMatch(/serve\s+public/);
  });
});
