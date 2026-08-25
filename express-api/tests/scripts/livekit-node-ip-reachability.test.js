/**
 * SHY-0465 — the local stack must not advertise a voice address the phone
 * cannot reach.
 *
 * SHY-0273 taught `local/start.sh` to hand LiveKit the host's LAN address
 * instead of the Docker bridge address. That fixed the case it was written
 * for and left a second one standing: the script asks "what is my LAN IP",
 * never "can the phone reach it".
 *
 * On 2026-08-26, phone and host on the SAME SSID and the SAME /24:
 *
 *   phone -> localhost:7880   (adb reverse)   200        signalling OK
 *   phone -> 192.168.1.3:7880 (host LAN)      000        unreachable
 *   phone -> 192.168.1.1      (gateway)       0% loss    positive control
 *   arp -an                                   192.168.1.5 (incomplete)
 *
 * AP client isolation: the access point routes to the internet and refuses
 * peer-to-peer. Signalling still connects over the USB tunnel, so the room
 * opens and only ICE dies — which reads as flakiness, not as a network wall.
 * J09 was red for a session on exactly this.
 *
 * These tests RUN the chooser rather than reading it. The probe is injected
 * as a real command with a real exit code (`true` / `false` / a missing
 * binary), so what is under test is the decision the script actually makes.
 *
 * The last test is the one that matters most: it asserts the SEAM. A chooser
 * that decides correctly while `start.sh` ignores its answer would pass every
 * test above it and fix nothing.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CHOOSER = path.join(REPO_ROOT, 'scripts', 'dev', 'choose-livekit-node-ip.sh');
const START_SH = path.join(REPO_ROOT, 'local', 'start.sh');
// Absolute, so the interpreter is not resolved through a PATH the tests edit.
const BASH = '/bin/bash';

/**
 * Runs the chooser ONCE and returns both streams. stdout is the address and
 * nothing else; stderr is the reason. Running it twice to read the two
 * separately would let them disagree.
 */
const run = (env = {}) => {
  const result = spawnSync(BASH, [CHOOSER], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return { address: result.stdout.trim(), reason: result.stderr.trim() };
};

const choose = (env = {}) => run(env).address;
const chooseWithReason = run;

describe('SHY-0465 — the chooser exists and is executable', () => {
  test('the chooser script is present', () => {
    // Vacuous-pass guard: every test below executes this file.
    expect(fs.existsSync(CHOOSER)).toBe(true);
  });
});

describe('SHY-0465 — which address the local stack advertises', () => {
  const HOST_IP = '192.168.1.3';

  test('an address set by hand wins, and no probe runs', () => {
    // The documented USB-only escape hatch must keep working verbatim.
    // `false` as the probe would choose loopback if it were consulted.
    const address = choose({
      LIVEKIT_NODE_IP: '10.11.12.13',
      LIVEKIT_HOST_IP: HOST_IP,
      LIVEKIT_PROBE: '/usr/bin/false',
    });
    expect(address).toBe('10.11.12.13');
  });

  test('a phone that CAN reach this machine keeps the LAN address', () => {
    // Unchanged behaviour on a healthy network — SHY-0273's fix must survive.
    const address = choose({
      LIVEKIT_NODE_IP: '',
      LIVEKIT_HOST_IP: HOST_IP,
      LIVEKIT_PROBE: '/usr/bin/true',
    });
    expect(address).toBe(HOST_IP);
  });

  test('a phone that CANNOT reach this machine gets the loopback address', () => {
    // The defect this ticket exists for. Loopback is carried by `adb reverse`.
    const address = choose({
      LIVEKIT_NODE_IP: '',
      LIVEKIT_HOST_IP: HOST_IP,
      LIVEKIT_PROBE: '/usr/bin/false',
    });
    expect(address).toBe('127.0.0.1');
  });

  test('no device attached keeps the LAN address rather than guessing', () => {
    // A missing adb must not be read as "unreachable" — that would flip every
    // desktop-only run onto loopback for a reason that was never tested.
    const address = choose({
      LIVEKIT_NODE_IP: '',
      LIVEKIT_HOST_IP: HOST_IP,
      LIVEKIT_PROBE: '',
      ADB: path.join(REPO_ROOT, 'no-such-adb-binary'),
    });
    expect(address).toBe(HOST_IP);
  });

  test('a probe that cannot run at all still yields an address', () => {
    // Fail-soft: the stack must start even when the probe itself is broken.
    const address = choose({
      LIVEKIT_NODE_IP: '',
      LIVEKIT_HOST_IP: HOST_IP,
      LIVEKIT_PROBE: path.join(REPO_ROOT, 'no-such-probe-binary'),
    });
    expect(address).toBe(HOST_IP);
  });
});

describe('SHY-0465 — the choice explains itself', () => {
  const HOST_IP = '192.168.1.3';

  test('choosing loopback says the phone could not reach the LAN address', () => {
    // An operator on an isolating network must learn it from the startup log,
    // not from a red journey an hour later.
    const { address, reason } = chooseWithReason({
      LIVEKIT_NODE_IP: '',
      LIVEKIT_HOST_IP: HOST_IP,
      LIVEKIT_PROBE: '/usr/bin/false',
    });
    expect(address).toBe('127.0.0.1');
    expect(reason).toContain(HOST_IP);
    expect(reason).toMatch(/could not reach/i);
  });

  test('choosing the LAN address says the phone was actually asked', () => {
    const { reason } = chooseWithReason({
      LIVEKIT_NODE_IP: '',
      LIVEKIT_HOST_IP: HOST_IP,
      LIVEKIT_PROBE: '/usr/bin/true',
    });
    expect(reason).toMatch(/reach/i);
    expect(reason).toContain(HOST_IP);
  });

  test('no device attached says so, rather than claiming a reachable phone', () => {
    // The distinction matters: "untested" and "tested and reachable" lead to
    // different next steps when voice then fails.
    const { reason } = chooseWithReason({
      LIVEKIT_NODE_IP: '',
      LIVEKIT_HOST_IP: HOST_IP,
      LIVEKIT_PROBE: '',
      ADB: path.join(REPO_ROOT, 'no-such-adb-binary'),
    });
    expect(reason).toMatch(/no device|not tested|could not test/i);
  });
});

describe('SHY-0465 — stdout carries the address and nothing else', () => {
  test('a warning never contaminates the address the caller captures', () => {
    // start.sh does `LIVEKIT_NODE_IP="$(chooser)"`, so anything printed on
    // stdout BECOMES the address. A warning leaking there would hand LiveKit
    // a sentence instead of an IP — and the container would advertise it.
    // A PATH holding bash and nothing else: `route`, `ipconfig`, `hostname`
    // and `uname` are genuinely absent, so detection really does fail. This
    // is the real failure, not a simulated one.
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-nodeip-'));
    fs.symlinkSync(BASH, path.join(binDir, 'bash'));

    const { address, reason } = chooseWithReason({
      LIVEKIT_NODE_IP: '',
      LIVEKIT_HOST_IP: '',
      LIVEKIT_PROBE: '',
      PATH: binDir,
    });

    expect(reason).toMatch(/WARNING/);
    expect(address).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
    expect(address).not.toMatch(/WARNING/);
  });
});

describe('SHY-0465 — start.sh actually uses the chooser', () => {
  const SRC = fs.readFileSync(START_SH, 'utf8');
  const codeLines = SRC.split('\n').filter((l) => !/^\s*#/.test(l));
  const code = codeLines.join('\n');

  test('start.sh is non-empty and is the file under test', () => {
    expect(code.length).toBeGreaterThan(500);
  });

  test('start.sh calls the chooser', () => {
    // Test the CALLER, not the helper: a chooser that decides correctly while
    // start.sh keeps its own detection would fix nothing.
    expect(code).toMatch(/choose-livekit-node-ip\.sh/);
  });

  test("start.sh gives LiveKit the chooser's answer", () => {
    // The value must reach the container, not merely be computed.
    const assignment = codeLines.find(
      (l) => /LIVEKIT_NODE_IP=/.test(l) && /choose-livekit-node-ip\.sh/.test(l),
    );
    expect(assignment).toBeDefined();
    expect(code).toMatch(/export LIVEKIT_NODE_IP/);
  });

  test('start.sh no longer decides the address by detection alone', () => {
    // The old `detect_lan_ip` result must not be assigned straight to
    // LIVEKIT_NODE_IP — that is the bug, and it would silently return.
    // Anchored against the form the script ACTUALLY used —
    // `LIVEKIT_NODE_IP="${LIVEKIT_NODE_IP:-$(detect_lan_ip)}"`. A narrower
    // pattern passes on today's broken code and guards nothing.
    const direct = codeLines.filter((l) => /LIVEKIT_NODE_IP=.*detect_lan_ip/.test(l));
    expect(direct).toEqual([]);
  });

  test('the TCP media port loopback mode depends on is still tunnelled', () => {
    // In loopback mode ICE has no UDP path; 7881 over `adb reverse` is the
    // only way media flows. Losing it would make the fallback silently mute.
    const tunnelLine = codeLines.find(
      (l) => /for p in .*adb reverse|for p in /.test(l) && /7881/.test(l),
    );
    expect(tunnelLine).toBeDefined();
  });
});
