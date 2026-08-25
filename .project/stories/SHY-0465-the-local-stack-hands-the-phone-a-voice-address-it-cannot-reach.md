---
id: SHY-0465
status: In Review
owner: unassigned
created: 2026-08-26
priority: P1
effort: S
type: bug
roadmap_ids: []
mvp: false
epic: EPIC-0003
---

# SHY-0465: The local stack hands the phone a voice address it cannot reach

## User Story

As **whoever runs the device journeys against the local stack**, I want the
stack to hand the phone a voice address the phone can actually reach, so that
voice works without anyone first diagnosing their own Wi-Fi.

## Why

`local/start.sh` detects this machine's LAN address and gives it to LiveKit as
`NODE_IP` — the address LiveKit advertises in its ICE candidates ([[SHY-0273]]).
The detection asks "what is my LAN IP", never "can the phone reach it". On a
router with **AP client isolation** those are different questions, and the
answer to the second one is no.

Measured on 2026-08-26, phone and Mac on the same SSID and the same `/24`:

```
phone -> localhost:7880   (adb reverse)     200         signalling OK
phone -> 192.168.1.3:7880 (host LAN)        000         unreachable
phone -> 192.168.1.1      (gateway)         0% loss     positive control
mac   -> 192.168.1.5      (phone)           100% loss
arp -an                                     192.168.1.5 (incomplete)
macOS firewall                              disabled
```

Gateway reachable, peer ARP unanswered in **both** directions, firewall off.
The obvious reading was AP client isolation. It was not confirmed: the
condition cleared later the same night, after both devices took new DHCP
leases (host `.3` -> `.5`, phone `.5` -> `.6`), and the phone then reached the
host with 0% loss. Isolation, a stale lease, or a band/AP split all fit the
evidence and none was pinned down.

**That is the argument for probing rather than diagnosing.** The stack cannot
know which of those it is facing either, and it does not need to — it needs to
know whether this phone can reach this host right now.

Nothing was wrong with the code, the tunnels, or the app.

The cost is that it does not present as a network problem. Signalling connects
over the USB tunnel, so the room opens; ICE then never completes, so voice
never joins. J09 was red for a session and the diagnosis in the handover was
"the phone's WebSocket link to LiveKit, or the app's LiveKit client" — both
healthy.

`start.sh` already documents the working alternative in a comment, so the
knowledge exists and only the automation is missing:

```
USB-only — phone has no route to this machine's LAN. Run with
  LIVEKIT_NODE_IP=127.0.0.1 bash local/start.sh
```

Recreating the container with `NODE_IP=127.0.0.1` fixed it outright. J09 went
from 8/9 to 14/14, and the tell is the timing, not the tick: "the room screen
shows the seat grid" went from **timing out at 10 000 ms** to **4.3 s**.

That fix lives only in a running container. The next `bash local/start.sh`
re-detects the LAN address and re-breaks voice, which is why this is a ticket
and not a note.

## Acceptance Criteria

### Happy path

- [ ] On a network where the phone can reach this machine, the stack still
      advertises the LAN address and voice connects over UDP, unchanged from
      today.
- [ ] On a network where it cannot, the stack advertises the loopback address
      instead and voice connects over the reverse tunnel — with no argument
      from the operator.

### Error paths

- [ ] With no device attached, the stack picks the LAN address as it does now
      and says that it could not test reachability.
- [ ] A probe that cannot run at all (no `adb`, device unauthorised) does not
      abort the stack; it falls back and says which address it chose and why.

### Edge cases

- [ ] The probe result is reported for the device the journeys will actually
      use, not merely the first serial `adb` lists.
- [ ] Choosing loopback also confirms the TCP media tunnel is present, since
      ICE has no UDP path left in that mode.

### Performance

- [ ] The probe adds no more than a couple of seconds to startup and runs once,
      before the containers start, not per journey.

### Security

- [ ] The probe reads reachability only. It changes no firewall state, no
      router setting, and nothing on the phone.

### UX

- [ ] Startup states which address LiveKit will advertise **and the evidence**
      for it — "the phone could not reach 192.168.1.3, using loopback" — so an
      operator on an isolating network learns it from the log rather than from
      a red journey.

### i18n

- [ ] None: developer-facing tooling.

### Observability

- [ ] The chosen mode and its reason appear in the startup log, so a journey
      report can be read against the mode the stack was in.

## BDD Scenarios

**Scenario: The phone cannot reach this machine**

- **Given** a phone that cannot reach this machine over Wi-Fi
- **When** the local stack starts
- **Then** voice is set up to run over the USB cable instead, and the log says so

**Scenario: The phone can reach this machine**

- **Given** a phone that can reach this machine over Wi-Fi
- **When** the local stack starts
- **Then** voice is set up to run over Wi-Fi, as it does today

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | The chooser returns loopback on an unreachable probe, LAN on a reachable one, and LAN with a warning when no device is attached. |
| Script | Starting the stack on this (isolating) network selects loopback and tunnels 7881. |
| Device | J09 passes on the isolating network with no manual override, and the seat grid renders well inside the voice watchdog. |

## Out of Scope

- Changing the router. The stack must work on whatever network it meets.
- The app's own behaviour when voice cannot connect — [[SHY-0466]].
- The LiveKit dev key being shorter than 32 characters, which makes the
  container log an `ERROR` on every local boot. Real, cosmetic, separate.

## Dependencies

- [[SHY-0273]] — introduced `NODE_IP` and the LAN detection this extends.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The probe is slow or flaky and delays every start | One short probe with a hard timeout; failure falls back rather than blocking. |
| Loopback mode is chosen when Wi-Fi would have worked | The probe must get a POSITIVE reachability result to choose LAN, and prints the evidence either way. |
| Loopback mode without the 7881 tunnel silently kills media | The AC requires confirming that tunnel whenever loopback is chosen. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] J09 passes on this network from a plain `bash local/start.sh`, with no
      environment variable set by hand.

## Notes

- Filed 2026-08-26 after re-confirming J09 post-reboot. The reboot did not
  clear the symptom; the network was the same as before it.
- On 2026-08-04 the same setup was device-proven on UDP with host `.9` and
  phone `.4` ([[SHY-0273]]). Nothing in the app changed between then and now —
  the network did, which is the argument for probing rather than detecting.
