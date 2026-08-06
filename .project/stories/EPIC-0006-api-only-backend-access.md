---
id: EPIC-0006
status: In Progress
owner: claude
created: 2026-07-09
priority: P0
title: API-only backend access — no direct client→Firestore/RTDB/Storage
---

# EPIC-0006: API-only backend access — clients never touch backend services directly

## Vision

Every client (Android, iOS, web) reaches the backend through the **Express API and nothing else**. The API is the single authorization chokepoint that decides *who can do what, and how*. No client ever opens a direct connection to Firestore, the Realtime Database, or Cloud Storage. This closes a **critical, launch-blocking security hole**: today the KMP app talks to Firestore directly from per-platform repository impls (Android via native `com.google.firebase`, iOS via `dev.gitlive.firebase`), so access control rests entirely on `firestore.rules` / `database.rules.json` evaluated on the client's connection — a posture with no server-side arbiter, easy to under-specify, and impossible to audit centrally. For a minors-facing product this is unacceptable. (Operator directive, 2026-07-09: *"the backend services should never be exposed or used directly … massive security risk … deal with immediately … never repeat."* Codified in [[feedback-no-direct-backend-all-via-api]].)

This EPIC **generalizes** the older, partial "Room mutations → server-side authz" plan (CLAUDE.md § In-Flight Initiatives) from room writes to **all backend access — every collection, reads AND writes, all three clients** — and it locks the door behind us so a direct-access regression can never merge again.

## Scope

**In scope:**
- **Remediate** every direct client→backend-service call (audit: `.project/audit/direct-backend-access-audit-2026-07-09.md`). Baseline at creation: ~15 Android `app/src/main` files (native SDK) + ~11 iOS `shared/src/iosMain` files (gitlive) + web `public/**` — routed instead through Express API endpoints that enforce authorization with the Admin SDK server-side.
- **Prevent** recurrence structurally (make the bad state un-mergeable), the operator-mandated triple:
  1. **CI ratchet** — a `scripts/check-*` guard that fails on any NEW direct-backend-service reference in client code, matching BOTH SDK namespaces (`com.google.firebase.{firestore,database,storage}` AND `dev.gitlive.firebase.{firestore,database,storage}`) + web `firebase`/`firestore` data usage. Baseline-allowlisted to the known sites, ratcheting to zero as remediation lands.
  2. **Reviewer block** — a CLAUDE.md rule + `code-reviewer` checklist item that treats any direct backend access as a blocking finding.
  3. **Tests** — the ratchet has its own tests (fixture with a planted violation must fail; clean fixture must pass), and each remediation story proves the new API path against the real local emulator stack.
- **Architectural decision** for real-time reads (Firestore `.snapshots()` / RTDB listeners): request/response APIs can't stream, so live updates need SSE / websocket / short-poll. This is the hardest sub-problem and needs an operator/architect decision — captured as its own spike before the read-side remediation stories.

**Operator decisions (2026-07-09, via AskUserQuestion):**
- **Real-time reads → SPIKE FIRST.** Don't pick a transport cold; SHY-0169 trials SSE vs WebSocket vs short-poll against our real constraints ($0 hosting, the Oracle-Cloud Express API, iOS+Android+web parity, minors-safety, RTDB presence/`onDisconnect`) and returns a recommendation for the operator to ratify before the read-side remediation stories are written.
- **Firebase Auth → ALLOWED EXCEPTION** (auth plane, not data plane): client sign-in / ID-token minting stays client-side — it is how the client proves identity *to* the API, on which all API authz depends. The `check-no-direct-backend.js` ratchet already excludes `*.firebase.auth` / `getAuth(` / `firebase.auth(`; keep it excluded.
- **Staff admin console → its own authz'd admin-API.** `public/admin/js/**` + `public/portal/portal.js` get dedicated staff-authenticated API endpoints (no direct Firestore), same principle as the app — lower urgency (staff-only, smaller blast radius) but in scope, its own remediation story.

**Out of scope:**
- The Express API's OWN use of the Firebase Admin SDK — that IS the sanctioned server-side channel, not a violation.
- Firebase **Auth** token minting on the client — ruled an allowed exception (above).
- Rewriting `firestore.rules` — the rules stay as defence-in-depth (deny-by-default once clients no longer connect), tightened in a later story, not removed here.

## Child SHYs

Populated as each is refined (the audit's 10-cluster remediation grouping A–H + P + R drives the split). Planned:
- **SHY-0168** — ✅ **Done-in-develop (#1548)** — Prevention: CI ratchet + reviewer rule + 48 tests that block any NEW direct-backend access (built FIRST — stops the bleeding before remediation churn).
- **SHY-0169** — **NEXT** — Spike: real-time-read transport decision (SSE vs WebSocket vs poll) for the ~50 Firestore `.snapshots()` + RTDB listeners, incl. an RTDB-presence/`onDisconnect` server-side replacement. Blocks the read-side remediation stories.
- **SHY-01xx write-path remediation** (decision-INDEPENDENT — can proceed in parallel with the spike): the audit's write-tail clusters — profile edits, block-list, `currentRoomId`, conversation/group settings + moderation writes, seat approve/deny, device-binding, room-chat message writes — each: move behind an authz'd Express endpoint, migrate Android + iOS `actual` impls (1:1 mirrors), prove on the real emulator stack, tighten the corresponding rule.
- **SHY-01xx read-path remediation** (gated on SHY-0169): one-shot reads (request/response) + the real-time listeners (per the ratified transport).
- **SHY-01xx admin-console** — dedicated staff-authenticated admin-API for `public/admin/js/**` + `portal.js` (operator-ruled its own surface).

## DoD at Epic Level

- The CI ratchet exists, is wired into `lint.yml`, and its baseline allowlist is **empty** (every direct-access site remediated).
- Zero `com.google.firebase.{firestore,database,storage}` / `dev.gitlive.firebase.{firestore,database,storage}` references remain in client code (`app/src/main`, `shared/src/{androidMain,iosMain,commonMain}`); web `public/**` data access all via the API.
- `firestore.rules` / `database.rules.json` tightened to deny direct client data access (defence-in-depth), verified by real-emulator tests.
- CLAUDE.md documents the API-only rule under Architecture + Pre-Merge Testing Protocol; `code-reviewer` enforces it.
- Every child SHY Done + released.

## Notes

- 2026-07-09 — EPIC created in response to the operator's critical directive. Scoping audit dispatched → `.project/audit/direct-backend-access-audit-2026-07-09.md` (baseline: ~26 client repo/impl files still direct; a few flows — Identity/User/PM-lock/Report/some room mutations — already via the API). Prevention (SHY-0168) is being built first so no new violation can merge during the multi-story remediation. Real-time reads called out as the architectural crux (SHY-0169 spike). Rule codified in [[feedback-no-direct-backend-all-via-api]]; generalizes the CLAUDE.md "Room mutations → server-side authz" in-flight plan.
