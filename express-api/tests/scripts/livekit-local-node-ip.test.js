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
