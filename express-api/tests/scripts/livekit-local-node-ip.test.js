/**
 * SHY-0273 — LiveKit must advertise an address a real device can reach.
 *
 * Voice never connected from a real phone against the local stack. Signalling
 * succeeded (the token pre-warmed, the WebSocket opened) and then the room died
 * with `Broken pipe` / `Reconnecting…`. The server's own log said why:
 *
 *   nodeIP: "172.18.0.2"
 *   publisherCandidates: ["udp4 host 172.18.0.2:52079",
 *                         "tcp4 host 172.18.0.2:7881", …]
 *   [remote] udp host 192.168.1.6:47526
 *   connectionType: "unknown"          ← ICE never completed
 *
 * `172.18.0.2` is the Docker BRIDGE address. Nothing outside the Docker network
 * can reach it — not over Wi-Fi, and not over `adb reverse`. So every ICE
 * candidate the server offered was unreachable and media could never flow.
 *
 * Two things had to be true and neither was checked:
 *   1. `livekit-server` must be TOLD which address to advertise (`--node-ip`,
 *      env `NODE_IP`) — it cannot infer the host's LAN address from inside a
 *      container.
 *   2. That address must be computed at START time, not committed: this
 *      machine's LAN IP changed from 192.168.1.13 to 10.179.17.101 within a
 *      single session.
 *
 * These are structural checks over the compose file and start script — the
 * failure they guard against costs an evening of "voice is just flaky".
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const COMPOSE_RAW = read('local/docker-compose.yml');
const COMPOSE = yaml.load(COMPOSE_RAW);
const START_SH = read('local/start.sh');
const LIVEKIT_YAML = yaml.load(read('local/livekit.yaml'));

describe('SHY-0273 — LiveKit advertises a reachable address on the local stack', () => {
  test('the livekit service exists and is the service under test', () => {
    // Vacuous-pass guard: every assertion below reads this object.
    expect(COMPOSE?.services?.livekit).toBeDefined();
  });

  test('livekit takes NODE_IP from the environment', () => {
    // Without this the container auto-detects its own bridge address and
    // advertises an unreachable candidate to every client.
    const env = COMPOSE.services.livekit.environment;
    expect(env).toBeDefined();
    const value = Array.isArray(env) ? env.find((e) => e.startsWith('NODE_IP')) : env.NODE_IP;
    expect(String(value)).toMatch(/LIVEKIT_NODE_IP/);
  });

  test('the media ports LiveKit advertises are actually published', () => {
    // An advertised candidate on an unpublished port is the same failure in a
    // different place: reachable host, closed door.
    const ports = COMPOSE.services.livekit.ports.map(String);
    const { port_range_start: udpStart, port_range_end: udpEnd } = LIVEKIT_YAML.rtc;
    expect(ports.some((p) => p.includes(`${udpStart}-${udpEnd}`) && p.endsWith('/udp'))).toBe(true);
    // 7881 is the TCP media fallback — the ONLY transport that can survive
    // `adb reverse`, which forwards TCP and never UDP.
    expect(ports.some((p) => p.startsWith('7881:'))).toBe(true);
    // 7880 is signalling.
    expect(ports.some((p) => p.startsWith('7880:'))).toBe(true);
  });

  test('start.sh detects the host LAN address rather than committing one', () => {
    // A committed IP is correct until the machine changes network — which
    // happened inside one session (192.168.1.13 → 10.179.17.101).
    expect(START_SH).toMatch(/detect_lan_ip\(\)/);
    expect(START_SH).toMatch(/export LIVEKIT_NODE_IP/);
    // Chooses the interface carrying default-route traffic, not en0 guesswork.
    expect(START_SH).toMatch(/route -n get default/);
  });

  test('start.sh warns LOUDLY when it cannot determine an address', () => {
    // Degrading silently here means voice quietly fails on device only, which
    // reads as "flaky voice" rather than "misconfigured stack".
    const block = START_SH.slice(START_SH.indexOf('LIVEKIT_NODE_IP='));
    expect(block).toMatch(/WARNING: could not detect a LAN IP/);
    expect(block).toMatch(/>&2/);
  });

  test('no hard-coded address is committed as the node IP', () => {
    // Pins the regression directly: the fix is detection, not a literal.
    //
    // Comments are STRIPPED first. The USB-only recipe legitimately documents
    // `LIVEKIT_NODE_IP=127.0.0.1 …`, and a detector that cannot tell prose from
    // code would either fail on correct documentation or be loosened until it
    // catches nothing.
    const stripComments = (text) =>
      text
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
    const assignment = /LIVEKIT_NODE_IP\s*=\s*["']?\d{1,3}(?:\.\d{1,3}){3}/;
    expect(stripComments(START_SH)).not.toMatch(assignment);
    expect(stripComments(COMPOSE_RAW)).not.toMatch(assignment);
    // And prove the detector still fires on the thing it exists to catch.
    expect(stripComments('LIVEKIT_NODE_IP=192.168.1.13')).toMatch(assignment);
  });

  test('the USB-only fallback is documented where it is needed', () => {
    // `adb reverse` cannot carry UDP, so a USB-only device can only reach
    // media over the TCP candidate — and only if told to advertise localhost.
    expect(START_SH).toMatch(/adb reverse tcp:7881/);
    expect(START_SH).toMatch(/127\.0\.0\.1/);
  });
});

/**
 * SHY-0273 (device walk, 2026-08-04) — defects the DEVICE proof exposed.
 *
 * The NODE_IP fix was verified end-to-end on a real OnePlus CPH2653: LiveKit
 * logged `connectionType: "udp"` pairing 192.168.1.9:52038 ↔ 192.168.1.4:36260,
 * then `mediaTrack published kind:audio source:MICROPHONE`. Voice genuinely
 * connects now.
 *
 * Walking it surfaced two more ways the local stack stays unreachable from a
 * real device — the same defect class as the bridge address: an address or a
 * route baked for an environment that no longer exists.
 */
describe('SHY-0273 — the local stack reaches the REAL device it installs on', () => {
  const GAUNTLET_ANDROID = read('express-api/scripts/gauntlet/30-android.sh');
  const JOURNEY_RUNNER = read('express-api/scripts/device-journey-runner.js');

  // Everything below reads one of these; a bad path would otherwise pass vacuously.
  test('the files under test are non-empty', () => {
    expect(START_SH.length).toBeGreaterThan(0);
    expect(GAUNTLET_ANDROID.length).toBeGreaterThan(0);
    expect(JOURNEY_RUNNER.length).toBeGreaterThan(0);
  });

  // Comment lines are NOT code. start.sh discusses `assembleLocalDebug` in
  // prose above Step 7, so a naive line search finds the commentary and reports
  // on it instead of on the command that actually runs.
  const codeLines = (src) => src.split('\n').filter((l) => !/^\s*#/.test(l));

  test('start.sh builds the APK for a real device, not the retired emulator', () => {
    // `localHostAlias` defaults to 10.0.2.2 — the Android EMULATOR's loopback
    // alias. Emulators were retired 2026-07-15 (AVD + package deleted), so the
    // default now bakes an address that resolves nowhere on the only device
    // type that exists. start.sh then INSTALLS that APK on the attached phone
    // (Step 8), which is how you get an app that cannot reach its own stack.
    const buildLines = codeLines(START_SH).filter((l) => /gradlew.*assembleLocalDebug/.test(l));
    expect(buildLines).toHaveLength(1);
    expect(buildLines[0]).toMatch(/-PlocalHost=/);
    // And prove the stripper is not simply hiding the command from the test.
    expect(
      codeLines('# ./gradlew assembleLocalDebug\n./gradlew assembleLocalDebug -PlocalHost=x'),
    ).toEqual(['./gradlew assembleLocalDebug -PlocalHost=x']);
  });

  test('start.sh tunnels the stack into the device it just installed on', () => {
    // Building with `-PlocalHost=localhost` without opening the tunnels is the
    // same failure wearing a different hat: the APK is correct and still cannot
    // reach anything. The install step is the only place that knows a device
    // is attached, so the tunnels belong there.
    const installStep = START_SH.slice(START_SH.indexOf('Step 8/8'));
    expect(installStep).toMatch(/adb .*reverse/);
  });

  // The three places that tunnel the local stack into a real device. Read by
  // both tests below so a fourth consumer added later has one place to join.
  const shellPorts = (src) => /for p in ([0-9 ]+); do/.exec(src)?.[1].trim().split(/\s+/);
  const PORT_LISTS = {
    'start.sh': shellPorts(START_SH),
    'gauntlet/30-android.sh': shellPorts(GAUNTLET_ANDROID),
    'device-journey-runner.js': /reversePorts:\s*\[([0-9,\s]+)\]/
      .exec(JOURNEY_RUNNER)?.[1]
      .split(',')
      .map((p) => p.trim()),
  };

  test.each(Object.keys(PORT_LISTS))('%s carries the TCP media fallback (7881)', (name) => {
    // 7881 is LiveKit's TCP media port — the ONLY media transport `adb reverse`
    // can carry, since it forwards TCP and never UDP. Without it tunnelled, the
    // documented USB-only mode (LIVEKIT_NODE_IP=127.0.0.1) cannot work through
    // any harness: it is a recipe with no way to follow it.
    //
    // Asserted over the WHOLE list, so a consumer that drops it later fails
    // here rather than silently, on device, as "voice is flaky again".
    expect(PORT_LISTS[name]).toBeDefined();
    expect(PORT_LISTS[name]).toContain('7881');
  });

  test('the device-port lists do not drift apart', () => {
    // They tunnel the SAME stack for the SAME app. Two of them had ALREADY
    // diverged — the gauntlet carried 8888 (web serve) and the runner did not —
    // which is how one harness passes and another fails on identical code.
    const [reference, ...others] = Object.keys(PORT_LISTS);
    for (const name of others) {
      expect({ [name]: [...PORT_LISTS[name]].sort() }).toEqual({
        [name]: [...PORT_LISTS[reference]].sort(),
      });
    }
  });

  test.each([
    ['start.sh', START_SH],
    ['gauntlet/30-android.sh', GAUNTLET_ANDROID],
  ])('%s does not OVERSTATE how many tunnels are open', (_name, src) => {
    // `adb reverse --list` emits a trailing blank line, so `wc -l` returns one
    // MORE than the number of tunnels. Observed live: 8 tunnels reported as
    // "9 active". The number exists to make a MISSING tunnel visible, and an
    // off-by-one in the safe direction is precisely the case where it cannot —
    // 7 tunnels would still read as 8.
    const countLine = src.split('\n').find((l) => /reverse --list/.test(l) && /active/.test(l));
    expect(countLine).toBeDefined();
    expect(countLine).not.toMatch(/wc -l/);
    expect(countLine).toMatch(/grep -c \./);
  });
});
