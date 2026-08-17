---
id: SHY-0225
status: Draft
owner: claude
created: 2026-07-19
priority: P0
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0008
mvp: true
pr:
---

# SHY-0225: Chaos / resilience testing — real dependency-failure + degraded-network behaviour

## User Story

As a ShyTalk user on a flaky connection or when a backend hiccups, I want the app to degrade gracefully — reconnect to my voice room, retry my message, show a friendly error instead of crashing, and never lose or corrupt my data — and as the operator I want automated chaos testing that proves this by inducing REAL failures (killing the real voice server, throttling the real network, returning real errors), because resilience that is only mocked is resilience that was never really tested.

## Why

The audit listed **chaos / resilience** as a candidate gap: nothing tests how the app behaves when a dependency fails or the network degrades. For a real-time voice/chat app on self-hosted infra, transient failures are normal — a dropped LiveKit connection, a slow API, a Firestore transaction conflict, an offline→online transition. This story adds **real** chaos testing — inducing genuine failure conditions on the real local stack + real devices (per EPIC-0003; a mocked rejection proves nothing) — registers into SHY-0212's runner, and feeds SHY-0220 a plain-language "Handles problems gracefully ✓" signal. It targets a known sharp edge: a Firestore transaction whose read widens the conflict set under contention ([[feedback-firestore-tx-query-widens-conflict-set]]).

## Acceptance Criteria

### Happy path

- [ ] **Voice-server failure (real):** killing/pausing the REAL local LiveKit container mid-call, the app detects the drop and reconnects gracefully (or surfaces a clear reconnecting state), without crashing or silently muting. Registered `chaos-voice` (`stack`/`device`, `publicArea: Voice rooms`).
- [ ] **API failure (real):** with the REAL API returning induced 503/timeout on a chokepoint (a real failpoint/toggle, not a mock), client requests retry with backoff, show a friendly error on exhaustion, and never crash or persist a partial state. Registered `chaos-api` (`stack`, `publicArea: Cross-cutting`).
- [ ] **Degraded network (real):** under induced high latency / packet loss / offline→online transitions (real network conditioning — `tc` / Network Link Conditioner), messaging queues + reconnects, and no message is lost or duplicated. Registered `chaos-network` (`device`, `publicArea: Messaging`).
- [ ] **Transaction contention (real):** under real concurrent writes, the room/seat transaction resolves correctly (no lost update, no double-seat) — exercising the widened-conflict-set behaviour with real contention. Part of `chaos-api`.
- [ ] All register into `scripts/test/framework-registry.mjs`, emit normalized `metadata.json` (SHY-0212 contract), and `docs/testing/chaos.md` explains in plain language what "handles problems gracefully" means + how each real failure is induced.

### Error paths

- [ ] If the app CRASHES, loses data, duplicates a message, double-seats a room, or hangs on an induced failure, the relevant chaos framework FAILS naming the scenario + the observed bad behaviour.
- [ ] A silent failure (a request that neither succeeds, retries, nor surfaces an error) FAILS — degradation must be graceful AND visible, never silent ([[feedback-detector-must-report-not-guess]]).
- [ ] The suites FAIL (not skip) if the fault can't actually be induced (e.g. the container didn't really stop) — a chaos "pass" over an un-induced fault is a false green, and the harness verifies the fault truly happened ([[feedback-verify-the-harness-not-just-the-result]], [[feedback-environmental-is-not-a-diagnosis]]).

### Edge cases

- [ ] Recovery is asserted, not just failure handling — after the dependency returns (LiveKit back, API healthy, network restored), the app fully recovers to a working state (reconnected, queued messages flushed exactly once).
- [ ] Offline→online exactly-once delivery: a message composed offline is delivered exactly once on reconnect (not lost, not duplicated).
- [ ] Partial failure (one region/service down, another up) is handled per the multi-region routing (LiveKit EU vs Asia) — a single-region outage doesn't take down voice entirely where failover exists.
- [ ] A fault induced at the worst moment (mid-transaction, mid-publish) is handled — timing-sensitive injection, not just before/after.
- [ ] Cleanup: every induced fault is fully reverted after the test (container restarted, network un-throttled) so the stack is left healthy — verified.

### Performance

- [ ] Chaos runs are time-bounded (registry `timeoutMs`) and scoped (a curated set of high-value fault scenarios, not exhaustive combinatorics) so CI stays bounded.
- [ ] Recovery-time is measured (how long to reconnect/flush) and reported, with a budget where meaningful (ties SHY-0214).

### Security

- [ ] Chaos never disables authz/safety controls to "make failures easier" — faults are injected at the dependency/network layer, and all traffic still flows through the real API chokepoint ([[feedback-no-direct-backend-all-via-api]]); a fault must not open a bypass (e.g. a failed ban-check must fail closed, not fail open) ([[feedback-root-cause-not-symptom]]).
- [ ] Under API failure, the ban/age/authz decisions fail CLOSED (deny), never open — asserted (ties SHY-0221 fail-closed properties).
- [ ] Chaos logs/artifacts carry no PII (belt with SHY-0223).

### UX

- [ ] The user-visible degradation is asserted to be friendly + informative ("Reconnecting…", "Message will send when you're back online") — not a raw error or a frozen screen; failure output states the user impact plainly.
- [ ] `docs/testing/chaos.md` explains each real fault + expected graceful behaviour + the one command to run each locally.

### i18n

- [ ] The degradation/error/reconnecting messages shown during chaos are localized across the 4 active locales (a user hits these exactly when stressed — they must be in their language); ties SHY-0222.

### Observability

- [ ] Each framework's `metadata.json` records scenario pass/fail + recovery time, feeding a plain-language "Handles problems gracefully ✓" signal for SHY-0220.
- [ ] Induced-fault + observed-behaviour + recovery are logged with `[framework:chaos-voice|chaos-api|chaos-network]`, greppable in CI — including proof the fault was truly induced.

## BDD Scenarios

**Scenario: The app reconnects after a real voice-server drop**
- **Given** an active voice call on the real local LiveKit
- **When** the LiveKit container is really killed mid-call
- **Then** the app shows a reconnecting state and recovers when LiveKit returns
- **And** it does not crash or silently mute

**Scenario: The client retries and stays consistent under real API failure**
- **Given** the real API returns induced 503/timeout on a chokepoint
- **When** the client makes a request
- **Then** it retries with backoff, shows a friendly error on exhaustion, and persists no partial state

**Scenario: Offline message delivers exactly once on reconnect**
- **Given** a message composed while the device is really offline
- **When** the network is restored
- **Then** the message is delivered exactly once (not lost, not duplicated)

**Scenario: A safety decision fails closed under failure**
- **Given** the API/ban-check dependency is failing
- **When** an action requiring a ban/age check is attempted
- **Then** the decision fails CLOSED (denied), never open

**Scenario: The harness verifies the fault was truly induced**
- **Given** a chaos scenario that should kill the voice container
- **When** the container did NOT actually stop
- **Then** the framework fails (no false green over an un-induced fault)

**Scenario: Resilience verdict reaches the public page**
- **Given** a completed chaos run
- **When** SHY-0220's page reads the chaos `metadata.json`
- **Then** it can show "Handles problems gracefully ✓" with recovery times

## Test Plan

**Classification:** real-only, by definition. Faults are induced for real — `docker kill`/pause the real LiveKit container, real API failpoints/toggles returning real 5xx/timeouts, real network conditioning (`tc`/Network Link Conditioner), real concurrent writes for contention. No mocked rejection stands in for a real failure. Host-runnable unit portion: the recovery-time aggregator + the fault-induction verifier (asserts the fault truly happened) + the metadata normalizer.

### Red — write failing tests first

- `chaos-voice`: `app/src/androidTest/.../ChaosVoiceReconnectTest.kt` + iOS equivalent — `@Test fun reconnectsAfterRealLiveKitKill()`; a RED variant proving a non-reconnecting build fails.
- `chaos-api`: `express-api/tests/chaos/api-failure.test.js` — `it('client retries with backoff on real 503')`, `it('no partial state persisted on failure')`, `it('safety decisions fail closed under failure')`, `it('room/seat transaction is correct under real contention')`.
- `chaos-network`: device tests under real conditioning — `it('message queues offline and delivers exactly once on reconnect')`, `it('shows friendly reconnecting UI')`.
- Harness-honesty: `it('fails when the induced fault did not truly occur')` ([[feedback-verify-the-harness-not-just-the-result]]).
- `it('every induced fault is reverted, stack left healthy')`, `it('metadata records recovery time')`.

### Green — implement

1. Build fault-injection helpers (container kill/pause, API failpoint toggle, network conditioning) + the induction verifier.
2. Author the chaos scenarios across voice/api/network + contention, on the real stack + real devices.
3. Register all three; write `docs/testing/chaos.md`.
4. Fix every real resilience defect surfaced at root (add reconnect, backoff+retry, offline queue with exactly-once, fail-closed safety, correct contention handling) — real product hardening.

### Gauntlet

Touches app (`shared/**`, `app/**`, `iosApp/**`) + backend (`express-api/**`, transactions) → FULL Pre-Merge Testing Protocol (backend ⇒ full gauntlet); chaos-voice/network proven on real Android + real iPhone against the real local stack, before merge.

## Out of Scope

- Production chaos engineering (injecting faults into live prod) — this story runs chaos against the local stack + dev; prod chaos is a much later, carefully-gated concern.
- Exhaustive fault-combination matrices — a curated high-value scenario set; breadth via follow-ups.
- Region-failover infrastructure changes (this tests the EXISTING multi-region routing's resilience, it doesn't build new failover).
- The public rollup page — SHY-0220.

## Dependencies

- **Blocks:** contributes a resilience signal to SHY-0220.
- **Blocked by:** SHY-0212 (registry/runner/docs/metadata). Uses the real local stack (LiveKit Docker, emulators), real devices, and the real API. Fail-closed assertions align with SHY-0221 + SHY-0219.
- **Tooling:** Docker container control, API failpoint toggle, `tc`/Network Link Conditioner ($0, local); existing device + journey harness. All $0.

## Risks & Mitigations

- **Risk:** A mocked "failure" sneaks in, proving nothing. **Mitigation:** Real-only by definition — faults induced on real dependencies; the harness VERIFIES the fault truly occurred (fails on an un-induced fault) ([[feedback-verify-the-harness-not-just-the-result]]).
- **Risk:** Chaos leaves the stack broken for later tests. **Mitigation:** Guaranteed revert after each scenario (container restarted, network restored), verified; test isolation preserved ([[feedback-test-isolation-no-leaks]]).
- **Risk:** Timing-sensitive injection is flaky. **Mitigation:** Deterministic injection points + assertions on recovery, not on exact timing; a flake is root-caused, not retried ([[feedback-no-auto-retry-workflows]]).
- **Risk:** A fault opens a security bypass (fail-open). **Mitigation:** Explicit fail-closed assertions on safety decisions under failure ([[feedback-root-cause-not-symptom]], [[feedback-no-string-ordering-for-security-decisions]]).
- **Risk:** Exactly-once delivery is hard to prove. **Mitigation:** Assert no-loss AND no-duplicate on offline→online with a counted, identified message set.

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `chaos-voice`, `chaos-api`, `chaos-network` green: real reconnect after real LiveKit kill, real retry/backoff + no-partial-state + fail-closed under real API failure, exactly-once offline delivery under real network conditioning, correct contention handling.
- [ ] The harness verifies faults are truly induced + fully reverted; every real resilience defect surfaced is fixed at root.
- [ ] All three registered; `docs/testing/chaos.md` present + plain-language; `metadata.json` (incl. recovery time) emitted.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0225-chaos-resilience-testing`; PR title `SHY-0225: Chaos / resilience testing — real dependency-failure + degraded-network`; FULL gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (operator: chaos/resilience candidate). Purest expression of real-only: faults are induced for REAL (kill the real LiveKit container, real API failpoints, real network conditioning) — a mocked rejection proves nothing. Harness honesty is first-class: the framework fails if the fault didn't truly occur ([[feedback-verify-the-harness-not-just-the-result]]). Safety decisions must fail CLOSED under failure. Targets the known widened-conflict-set transaction edge ([[feedback-firestore-tx-query-widens-conflict-set]]). Asserts recovery + exactly-once, not just failure handling.
