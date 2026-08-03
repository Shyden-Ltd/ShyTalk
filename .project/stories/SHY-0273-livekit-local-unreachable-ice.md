---
id: SHY-0273
status: In Progress
owner: claude
created: 2026-08-04
priority: P1
effort: S
type: bug
roadmap_ids: []
pr:
mvp: false
---

# SHY-0273: Voice never connects from a real device on the local stack

## User Story

As someone testing voice on a real phone against the local stack,
I want the room's audio to actually connect,
So that I can verify voice features without deploying to dev first.

## Why

Voice has never worked from a real device against `local/start.sh`. It fails in a way that
looks like flakiness — the room opens, the mic control appears, and then the connection dies:

```
E/LiveKitVoiceService: FailedToConnect event: Broken pipe
E/LiveKitVoiceService: java.net.SocketException: Broken pipe
D/LiveKitVoiceService: Reconnecting...
```

That reads as a network wobble. It is not. The LiveKit server's own log says exactly what
happened:

```
starting LiveKit server  {"nodeIP": "172.18.0.2", "rtc.portTCP": 7881,
                          "rtc.portICERange": [52000, 52100]}

publisherCandidates: ["udp4 host 172.18.0.2:52079",
                      "tcp4 host 172.18.0.2:7881",
                      "udp4 srflx 182.8.122.101:6661", …]
     [remote] udp host 192.168.1.6:47526
connectionType: "unknown"
```

`172.18.0.2` is the **Docker bridge address**. Every candidate the server offered pointed at an
address that nothing outside the Docker network can reach — not the phone over Wi-Fi, and not
over `adb reverse`. The phone offered its own real LAN address (`192.168.1.6`); the server had
nothing reachable to pair it with, so `connectionType` stayed `"unknown"` and ICE never
completed. Signalling had already succeeded, which is why the failure surfaces late and looks
like a dropped socket rather than a misconfiguration.

A `livekit-server` running inside a container cannot infer the *host's* address. It has to be
told, via `--node-ip` (env `NODE_IP`). Nothing was telling it.

**Why `adb reverse` alone can never fix this.** `adb reverse` forwards **TCP only**. LiveKit
carries media over UDP 52000-52100 by default, so no amount of port forwarding over USB will
carry it. The TCP fallback (7881) *can* traverse the tunnel — but only if the advertised
candidate is an address the phone can route to, which brings it back to `NODE_IP`.

**Why the address must be detected, not committed.** This machine's LAN address changed from
`192.168.1.13` to `10.179.17.101` inside a single working session. A committed literal would
have been correct for one evening.

## Acceptance Criteria

### Happy path
- [ ] A real phone on the same Wi-Fi connects voice against the local stack

### Error paths
- [ ] When no LAN address can be determined, the stack says so loudly instead of starting a
      server that will silently fail on device

### Edge cases
- [ ] A machine with both Wi-Fi and Ethernet up picks the interface that actually carries traffic
- [ ] A USB-only device (no shared LAN) has a documented, working route

### Performance
- [ ] N/A — one environment variable resolved once at startup.

### Security
- [ ] Only a private LAN address is advertised; no change to authentication or the dev keys
- [ ] Nothing new is exposed beyond the ports Docker already published

### UX
- [ ] N/A — developer tooling; no user-facing surface.

### i18n
- [ ] N/A — no user-facing strings.

### Observability
- [ ] The address being advertised is printed at startup, so a wrong one is visible immediately

## BDD Scenarios

**Scenario: Voice connects from a real phone**
- **Given** the local stack is running and a phone is on the same network
- **When** the tester joins a voice room
- **Then** the audio connects

**Scenario: A misconfigured stack says so**
- **Given** a machine with no reachable network address
- **When** the local stack starts
- **Then** it warns that voice will not connect from a real device

## Test Plan

**Diagnosis before code.** The cause was read from the LiveKit server's own candidate list, not
inferred: advertised candidates were all `172.18.0.2`, the remote candidate was the phone's real
LAN address, and `connectionType` was `"unknown"`. That is ICE failing to pair, not a socket
dropping.

**Verified after the change** — LiveKit restarted and its startup line now reads
`{"nodeIP": "10.179.17.101", …}`, the host's real LAN address, instead of the bridge address.

**New — `express-api/tests/scripts/livekit-local-node-ip.test.js`** (7 tests) pins the whole
contract structurally, because the failure mode is silent and costs an evening each time:
the service takes `NODE_IP` from the environment; every port LiveKit advertises (UDP range,
TCP 7881, signalling 7880) is actually published; `start.sh` *detects* rather than commits, and
does so from the default-route interface rather than guessing `en0`; the no-address path warns
on stderr; **no literal address is committed** (comments stripped first, since the USB-only
recipe legitimately documents one — with the detector proven to still fire on a real
assignment); and the USB-only fallback is documented.

**Regression** — `local-stack-resource-diet`, `local-start-serve-fdlimit-pin`,
`ios-local-xcconfig` all still green (49 + 14 tests), since this touches `docker-compose.yml`
and `start.sh` which they pin.

**Not yet done: the device walk.** Devices are unavailable, and this machine has since moved to
a different network from the phone, so the end-to-end proof is owed. Everything above is
evidence from the server's own logs plus structural pins; the claim "voice now connects" is
NOT yet made.

## Out of Scope

- Dev and prod LiveKit, which run on real hosts with real addresses and are unaffected.
- Making `adb reverse` carry UDP. It cannot; the TCP fallback is the supported USB route.

## Dependencies

- None.

## Risks & Mitigations

- **Risk:** the detected interface is the wrong one on a multi-homed machine.
  **Mitigation:** selection follows the default route rather than an interface-name guess, the
  chosen address is printed at startup, and `LIVEKIT_NODE_IP` overrides it explicitly.
- **Risk:** a future edit reverts to auto-detection inside the container.
  **Mitigation:** pinned by the new test, including a check that no literal address creeps in.
- **Risk:** advertising a LAN address is wrong in a CI container.
  **Mitigation:** CI does not run the LiveKit container for device tests; on Linux the detection
  degrades to `hostname -I`, and an empty result warns rather than failing the stack.

## Definition of Done

- [ ] LiveKit advertises the host address (verified in its startup log)
- [ ] Structural pins green
- [ ] **Voice verified connecting from a real phone on the local stack**
- [ ] Merged to develop; `released_in:` at the next release cut

## Notes (running log)

- **2026-08-04 06:2x BST** — Found while trying to complete the SHY-0272 mute walk locally.
  Diagnosed from the server's candidate list rather than the client's "Broken pipe", which was a
  symptom several layers downstream. Two distinct facts had to line up: a container cannot know
  its host's address, and `adb reverse` cannot carry UDP. Fixed the first; documented the second.
  The LAN address changing mid-session (192.168.1.13 → 10.179.17.101) settled the
  detect-vs-commit question by itself.
