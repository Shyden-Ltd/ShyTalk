'use strict';

/**
 * SHY-0500 — `local/stop.sh` must actually stop what `local/start.sh` started.
 *
 * It killed the Express API by the pattern `express-api/src/index.js`, and
 * start.sh launches it as `node src/index.js` from inside express-api/ — so
 * the pattern never matched, the API outlived every stop, and the next start
 * refused at pre-flight with "port 3000 held by PID … (node)" (2026-09-04).
 * A stale API that survives is worse than a refused start: it serves the
 * previous build against a fresh emulator.
 *
 * Pinned structurally: stop.sh releases every port start.sh's pre-flight
 * guards, by port, so it cannot drift from the launch command again.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const START = fs.readFileSync(path.join(REPO_ROOT, 'local', 'start.sh'), 'utf8');
const STOP = fs.readFileSync(path.join(REPO_ROOT, 'local', 'stop.sh'), 'utf8');

const preflightPorts = () => {
  const m = START.match(/for port in ([\d ]+); do/);
  if (!m) throw new Error('start.sh no longer has a pre-flight port loop — update this pin');
  return m[1]
    .trim()
    .split(/\s+/)
    .map(Number)
    .sort((a, b) => a - b);
};

const stopPorts = () => {
  const m = STOP.match(/STACK_PORTS="([^"]+)"/);
  return m
    ? m[1]
        .trim()
        .split(/\s+/)
        .map(Number)
        .sort((a, b) => a - b)
    : [];
};

describe('local/stop.sh releases what local/start.sh guards', () => {
  test('the pin is reading a real pre-flight list', () => {
    expect(preflightPorts().length).toBeGreaterThanOrEqual(5);
    expect(preflightPorts()).toContain(3000);
  });

  test('stop.sh releases every pre-flight port, by port, on macOS and Linux', () => {
    expect(stopPorts()).toEqual(preflightPorts());
    expect(STOP).toMatch(/lsof -tiTCP:"?\$\{?port\}?"? -sTCP:LISTEN/);
  });

  test("the sweep kills only the stack's own process kinds, and names what it left alone", () => {
    // The stack is node (API, web server, emulator UI) and java (emulators).
    // Docker's port proxy for LiveKit and MailHog, or an unrelated dev server
    // on 8080, must not be SIGTERMed by a stop (review, 2026-09-04) — and a
    // listener that is left alone is the reason the next start refuses, so
    // it is named.
    expect(STOP).toMatch(/ps -o comm= -p "\$pid"/);
    expect(STOP).toMatch(/node\|java\|firebase\)/);
    expect(STOP).toMatch(/left \$\{comm\} \(pid \$\{pid\}\) on port \$\{port\} alone/);
    expect(STOP).toMatch(/stopped \$\{comm\} \(pid \$\{pid\}\) on port \$\{port\}/);
  });

  test('stop.sh waits for the ports it released to close, so a start straight after it is not refused', () => {
    // kill(1) returns before the process has exited. `stop.sh && start.sh`
    // hit start.sh's pre-flight while the Firestore emulator and the Auth
    // emulator were still shutting down (2026-09-04): "port 9000 held by
    // PID … (java)". A stop that returns while its ports are still held has
    // not stopped anything yet.
    expect(STOP).toMatch(
      /for port in \$STACK_PORTS; do[\s\S]*lsof -tiTCP:"\$\{port\}" -sTCP:LISTEN[\s\S]*still held after/,
    );
    expect(STOP).toMatch(/STACK_PORTS_RELEASE_TIMEOUT_S=/);
  });

  test('the API is not matched by a path start.sh never uses', () => {
    // start.sh: `cd express-api && node src/index.js`. A pattern with the
    // directory in it matches nothing that is actually running.
    expect(STOP).not.toMatch(/pkill -f "express-api\/src\/index\.js"/);
    expect(START).toMatch(/cd "\$PROJECT_ROOT\/express-api" && .*node src\/index\.js/);
  });
});
