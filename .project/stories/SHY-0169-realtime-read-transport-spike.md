---
id: SHY-0169
status: Draft
owner: claude
created: 2026-07-09
priority: P0
effort: M
type: spike
roadmap_ids: []
pr:
mvp: true
epic: EPIC-0006
---

# SHY-0169: Spike — real-time-read transport for API-only backend access

## User Story

As the ShyTalk architect, I want an evidence-based recommendation for **how the Express API should push live updates to clients** (replacing the ~50 direct Firestore `.snapshots()` / RTDB listeners the app uses today), so that the [[EPIC-0006]] read-side remediation migrates the real-time path to a *chosen, validated* transport instead of guessing — and so the migration keeps working on iOS, Android, and web at $0 hosting cost.

## Why

[[EPIC-0006]] must route ALL backend access through the API ([[feedback-no-direct-backend-all-via-api]]). Writes and one-shot reads map cleanly onto request/response endpoints, but the audit (`.project/audit/direct-backend-access-audit-2026-07-09.md`) found **~50 real-time reads** — Firestore `.snapshots()` + RTDB `valueEvents` — that a request/response API cannot serve: the room screen updating live as people join/leave/mute, presence, typing indicators, seat-request queues, role-revocation. These need the server to *push*. The transport choice (SSE vs WebSocket vs short-poll) reshapes the entire read-side migration, the API's runtime shape, and battery/cost on device — so the operator (2026-07-09) chose **spike-first**: trial the options against our real constraints and return a recommendation to ratify, rather than pick cold. A wrong choice here is expensive to unwind across three platforms.

The RTDB `onDisconnect()` primitive (used for presence + stale-room reaping — see CLAUDE.md § Cron-elimination) is a special sub-problem: it fires *server-side when a client's socket drops*. Whatever transport is chosen must offer an equivalent "client went away" signal, or presence needs a different server-side mechanism.

## Acceptance Criteria

### Happy path

- [ ] A written recommendation (in this story's Notes + a short design doc under `.project/plans/`) naming ONE primary transport (SSE / WebSocket / short-poll / hybrid) for the real-time read path, with the reasoning.
- [ ] Each candidate is evaluated against a fixed rubric: (a) **$0 hosting** — runs on the existing Oracle-Cloud Express + Caddy, no paid service; (b) **tri-platform parity** — a working client on iOS (KMP/`iosMain`), Android (`app`), and web with acceptable library support; (c) **latency** for a room update (target: perceptually instant, ≲1s); (d) **battery/network** cost on mobile vs today's Firestore listener; (e) **auth** — carries the existing `WorkerApiClient`/`IosApiClient` ID token so the API can authorize per-stream; (f) **presence/`onDisconnect`** — provides (or lets the server derive) a reliable client-gone signal; (g) **fan-out cost** — server load for N concurrent room members.
- [ ] A migration SHAPE is sketched: which API endpoint(s) stream what, how a client subscribes/unsubscribes, how the server sources the data (it still reads Firestore via Admin SDK server-side, then relays), and how reconnection/backfill works.
- [ ] Follow-up remediation SHYs are filed (read-path: one-shot reads + the real-time listeners per the chosen transport; + the presence replacement), each referencing the ratified transport.

### Error paths

- [ ] **Reconnect/resume**: the recommendation states how a client that drops mid-stream re-syncs without missing or double-applying updates (e.g. SSE `Last-Event-ID`, a resume token, or a full re-fetch on reconnect).
- [ ] **Stream auth expiry**: how a long-lived stream handles the ID token expiring mid-connection (re-auth / periodic re-handshake) — a stream must not outlive the caller's authorization (ties to [[feedback-no-direct-backend-all-via-api]]: the API is the authz layer, continuously).
- [ ] **Server restart / deploy**: clients must reconnect cleanly across an Express redeploy (PM2 restart) without a thundering-herd that overloads the single Oracle VM.

### Edge cases

- [ ] **Safari/WebKit** real-time support (SSE and WebSocket both have historical WebKit quirks — the audit noted spin-monitor already keeps a poll fallback "where onSnapshot is unreliable"); the recommendation must work on the `local`/`dev` browser matrix incl. Safari.
- [ ] **iOS `iosMain`** — the chosen transport must have a Kotlin/Native-compatible client (Ktor supports SSE + WebSocket on Native; a bespoke long-poll is trivial). Confirm, don't assume.
- [ ] **Backgrounded app** — mobile OSes suspend sockets when backgrounded; the recommendation notes how live-room state resumes on foreground (likely a re-subscribe + backfill, same as the reconnect path).
- [ ] **The RTDB-presence special case** — `onDisconnect()` has no direct request/response analog; the spike explicitly addresses whether presence moves to a server-tracked heartbeat/last-seen over the chosen transport, or stays a distinct mechanism.

### Performance

- [ ] The rubric captures a rough per-transport cost model for the single Oracle VM at expected concurrency (e.g. rooms × members); flags whether any option risks the $0/free-tier or the VM's connection limits.

### Security

- [ ] Every candidate is assessed for the core invariant: the API authorizes the stream per the caller's identity + cohort BEFORE relaying any data (no stream leaks another cohort's room — ties to the cross-cohort rules the app already enforces). A transport that can't carry/renew auth is disqualified.

### UX

- [ ] N/A — internal architecture spike; the *outcome* preserves the current live-room UX (updates feel instant), which is itself a rubric criterion (latency).

### i18n

- [ ] N/A — transport layer, no user-facing strings.

### Observability

- [ ] The recommendation names how streams are observed server-side (connection count, per-stream errors, reconnect storms) so the remediation stories can build it in — a silent streaming layer is undebuggable.

## BDD Scenarios

**Scenario: the spike produces a ratifiable recommendation**
- **Given** the ~50 real-time listeners + the RTDB presence/`onDisconnect` case
- **When** the spike evaluates SSE, WebSocket, and short-poll against the fixed rubric
- **Then** it recommends one primary transport with reasoning
- **And** files the read-path remediation follow-up SHYs referencing that choice

**Scenario: a transport that can't authorize per-stream is rejected**
- **Given** a candidate transport that cannot carry or renew the caller's ID token for the life of the stream
- **When** it is assessed against the Security criterion
- **Then** it is disqualified (the API must remain the continuous authz layer)

**Scenario: the presence gap is explicitly resolved, not dropped**
- **Given** RTDB `onDisconnect()` has no request/response analog
- **When** the spike writes its recommendation
- **Then** it names a concrete server-side replacement for "client went away" (heartbeat/last-seen or transport-native disconnect), not a TODO

## Test Plan

**This is a `spike`** — the deliverable is a validated decision + follow-up SHYs, not shipped product code (per CLAUDE.md § Lifecycle: spike → Notes-recorded decision + follow-up SHYs → Done, no release). "Validation" is real, not paper:

- **Red/investigate:** stand up a minimal REAL proof-of-concept for the leading candidate(s) on the actual local stack — a tiny Express endpoint that streams a Firestore change (server reads via Admin SDK, relays over the transport) consumed by a real client on each platform tier (at minimum: a web client + a Kotlin/Ktor client proving `iosMain` viability). No mocks — a real stream carrying a real Firestore update ([[feedback-no-stubs-mocks-fakes-real-only]]).
- **Green:** the PoC demonstrates a room-update round-trip within the latency target, carrying the auth token, with a working reconnect; the rubric table is filled from observed behaviour (not assumed); the recommendation + migration shape are written; follow-up SHYs filed.
- **Coverage gate:** every rubric row (a–g) has a real observation or an explicit, justified "N/A"; the presence/`onDisconnect` case has a concrete answer.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

The spike's **written artifacts** (`.md` story + `.project/plans/` design doc + follow-up SHY `.md`s) are `*.md`-only → device/browser gauntlet EXEMPT (validator + `code-reviewer` + review of the recommendation's soundness). Any **throwaway PoC code** is NOT merged to develop — it lives on a scratch branch or `.project/spikes/` and is explicitly labelled non-production (a spike PoC is not held to the full gauntlet because it is deliberately discarded; the follow-up remediation stories build the real, fully-gauntleted implementation). If any PoC artifact were to be kept, it would first go through the full protocol as its own story.

## Out of Scope

- Implementing the real-time migration — that's the follow-up read-path remediation SHYs this spike files.
- The write-path + one-shot-read remediation — those are decision-independent and proceed in parallel (they don't need this transport).
- The admin-console admin-API — its own EPIC-0006 story (operator-ruled).
- Changing the authz model — the API stays the authz layer; this only decides the *transport* it authorizes over.

## Dependencies

- The audit `.project/audit/direct-backend-access-audit-2026-07-09.md` (the real-time listener inventory + the RTDB-presence call-out).
- The local stack (`local/start.sh`) for the real PoC; the existing `WorkerApiClient`/`IosApiClient` token path; Ktor (already a dependency) for the KMP client PoC.
- Ratification: the operator approves the recommendation before the read-path remediation stories are built.

## Risks & Mitigations

- **Risk: the PoC under-represents production load** (1 VM, many rooms). **Mitigation:** the rubric includes an explicit cost/concurrency model + a flag if any option threatens the $0 tier or VM limits; the recommendation states the load assumption.
- **Risk: analysis paralysis / spike over-runs.** **Mitigation:** timeboxed to the rubric — a *good* decision with a real PoC of the leading candidate, not an exhaustive prod-grade build of all three.
- **Risk: a chosen transport later fails on one platform.** **Mitigation:** tri-platform parity is a hard rubric gate proven with a real client per tier before recommending, not assumed from docs.

## Definition of Done

- [ ] Recommendation written (Notes + `.project/plans/` doc) naming one primary transport, every rubric row (a–g) filled from real observation, the presence/`onDisconnect` replacement named, the migration shape sketched.
- [ ] A real minimal PoC of the leading candidate demonstrated on the local stack across the required platform tiers (web + a Kotlin/Ktor client for `iosMain` viability), no mocks.
- [ ] Follow-up read-path remediation SHYs filed against [[EPIC-0006]], referencing the ratified transport.
- [ ] Operator ratifies the recommendation (recorded in Notes).
- [ ] `code-reviewer` 100% clean on the written artifacts; validator green. **Spike → `Done` on ratification** (no release cut needed).

## Notes (running log)

- 2026-07-09 — Created as the [[EPIC-0006]] real-time-transport spike after the operator chose "investigate + recommend first" (over picking SSE/WebSocket/poll cold) via AskUserQuestion. Companion decisions the same day: Firebase Auth is an allowed exception (auth plane, not data); the staff admin console gets its own admin-API. This spike unblocks the read-side remediation; the write-path remediation is decision-independent and can proceed in parallel. Source inventory: `.project/audit/direct-backend-access-audit-2026-07-09.md` (~50 real-time reads; RTDB presence/`onDisconnect` flagged as the hard sub-case).
