---
id: EPIC-0009
status: In Progress
owner: claude
created: 2026-07-24
priority: P1
title: Gauntlet v2 — overlapped, visible, self-notifying release gauntlet
---

# EPIC-0009: Gauntlet v2 — overlapped, visible, self-notifying release gauntlet

## Vision

The release gauntlet must stop *looking* dead while it works, stop idling the phones while the Mac chews through its suites, and stop needing a human to babysit it for a PIN. Gauntlet v2 makes it **overlapped (devices work while the Mac's state-independent suites run), visible live in the console, self-announcing, and cross-platform-real-time-covered** — it pauses and pings the operator exactly when a PIN is needed, and pings on completion and on any failure (console AND phone), so the operator watches the first few minutes to confirm liveness and then walks away.

Operator directive (2026-07-24), verbatim intent: parallel Mac+iPhone+Android together, clash-free; cross-platform real-time coverage (admin/web → live to the apps); a fast pre-flight smoke; visible live in the console; self-notifying on complete/fail/PIN.

**Grounded correction (2026-07-24 investigation — supersedes the first draft's design):** the persona-slicing "3 disjoint platform lanes" idea is **not implementable** and is dropped. The map of the real primitives showed:

1. **The device matrix is ALREADY parallel** — `manual-qa-runner --matrix --parallel` runs Mac-web ∥ Android ∥ iPhone concurrently (3 groups keyed by physical device; `matrix-dispatch.js` `Promise.all` over device groups). What reads as "Mac first, devices idle" is the **framework phase** (`gauntlet.sh` Playwright + Auth-wiping Jest, dispatched BEFORE the matrix at `:133` vs `:158`) running serially to completion first. **That framework-before-matrix serialization is the bottleneck** — and it is exactly the operator's "don't run Mac then phones, run them together."
2. **Personas can't be sliced per-platform** — journeys are intrinsically cross-platform *per journey* (j11 drives the Android app + the iPhone app + the web admin simultaneously with shared personas Officia/Greta). The isolation axis can only be the whole journey, never persona-per-platform.
3. **True clash-free parallel lanes are a large, low-payoff rewrite** — concurrent lanes share ONE emulator dataset with global collections (`auditLog`, `messages`) asserting exact counts and one Auth store (revoking a persona in one lane kills its session in another). Guaranteeing non-interference needs per-lane persona-ID bands + room-id prefixes + rewriting the hardcoded IDs in every `.feature` file — large, for marginal speed over the parallelism that already exists.

**Operator decision (2026-07-24): Pragmatic v2.** Deliver the visible pains — overlap + streaming + pause/ping + self-notify + smoke + cross-platform coverage — WITHOUT the per-journey data-isolation rewrite.

## Scope

**In scope:** a Gauntlet-v2 orchestration mode over `express-api/scripts/gauntlet/**` that (a) dispatches the already-parallel device matrix without waiting for the full framework phase, overlapping only the **state-independent** framework suites (static analysis + host/unit tests that never touch the shared emulator stack) with the live matrix; (b) streams progress live to the console while still writing the run file; (c) a pause/resume + notification mechanism (PIN-ready start gate, per-moment PIN pause, event-driven complete/failure pings to console + phone via `PushNotification`); (d) a fast pre-flight smoke (real API + Firebase + real-time cross-surface round-trip) that aborts early if the plumbing is dead; (e) hardened cross-platform real-time journey coverage (admin/web → live to Android/iPhone).

**Explicitly OUT of scope (per the Pragmatic decision):** per-lane data isolation (persona-ID bands, room-id prefixing, per-journey-file ID rewrites, per-lane global-collection assertion scoping); multi-emulator-project lanes; changing the matrix's existing device-group parallelism; rewriting the drivers or product runtime; the release decision itself (still operator-gated per the Pre-Merge Protocol).

## Child SHYs

- **SHY-0236** (foundation, pre-req — DONE, merged to develop): orphan/thrash permanent fix (`cmd_stop` tree-kill + driver stale-holder clear) + best-effort suites + FAIL sentinel + bash-3.2 safety + Playwright env. v2 stands on a stop that actually stops and a run that reaches the matrix.
- **SHY-0238** — Gauntlet-v2 orchestrator: overlap the state-independent framework suites with the already-parallel device matrix (devices start immediately after the initial reseed; the Auth-mutating Jest stays in a non-overlapping slot, its wipe already healed by 50-matrix's own reseed) + live console streaming (still write the file) + an aggregated tally. The core, and the measurable speed + visibility win.
- **SHY-0239** — Pause/ping + notification mechanism: PIN-ready start gate (pause + ping + await confirm before start), per-moment PIN pause with auto-detect resume (explicit checkpoint fallback where the OS overlay can't be detected), and event-driven completion/failure pings to console + phone (fail-fast; no token-burning polling).
- **SHY-0240** — Pre-flight smoke + cross-platform real-time coverage: a fast liveness round-trip (persona API sign-in + Firestore write + admin/web → device propagation) that aborts the run early if the plumbing is dead, plus hardened journeys asserting admin/web → Android/iPhone live propagation (build on j01 / j04 / j10 / j11, the confirmed live-propagation journeys).

## DoD at Epic Level

- One command brings up the stack once, dispatches the device matrix without waiting out the framework phase, overlaps the state-independent suites with it, streams live to the console, and finishes materially faster than v1's serial framework-then-matrix run.
- The run pauses + pings (console + phone) before start and at every PIN moment, auto-resuming when the PIN is entered.
- The run pings (console + phone) on completion and on the first failure (fail-fast).
- A pre-flight smoke proves API + Firebase + real-time cross-surface liveness and aborts early if dead.
- Real-time admin → device propagation is asserted by at least the moderation + admin journeys.
- The overlap is proven state-safe: no suite that mutates shared Auth/data runs concurrently with the live device matrix (the Jest Auth-wipe never lands mid-matrix).
- Every mechanism is tested (structure/behaviour pins) with the real-execution discipline SHY-0236 established.

## Notes

**2026-07-24:** Filed at operator direction after v1's serial/invisible/babysat run surfaced the pain during the develop→main release. First draft proposed persona-sliced parallel lanes; the grounding investigation (see Vision) proved that unsound and surfaced that the matrix is already 3-way parallel and the real bottleneck is the framework-before-matrix phase. Operator chose **Pragmatic v2** (overlap + visibility + pause/ping + self-notify + smoke + cross-platform coverage; no data-isolation rewrite). Sequence: SHY-0236 (done) → SHY-0238 (overlap + streaming) → SHY-0239 (pause/ping + self-notify) → SHY-0240 (smoke + cross-platform) → first v2 run doubles as the release gate + iOS verification → develop→main.
