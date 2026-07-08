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

**Out of scope:**
- The Express API's OWN use of the Firebase Admin SDK — that IS the sanctioned server-side channel, not a violation.
- Firebase **Auth** token minting on the client (sign-in) — flagged separately for an operator ruling (auth plane vs data plane); not assumed to be a violation.
- Rewriting `firestore.rules` — the rules stay as defence-in-depth (deny-by-default once clients no longer connect), tightened in a later story, not removed here.

## Child SHYs

Populated as each is refined (the audit's "remediation grouping" drives the split). Planned:
- **SHY-0168** — Prevention: CI ratchet + reviewer rule + tests that block any NEW direct-backend access (built FIRST — stops the bleeding before remediation churn).
- **SHY-0169** — Spike: real-time-read transport decision (SSE / websocket / poll) for Firestore `.snapshots()` + RTDB listeners.
- **SHY-01xx** (post-audit) — remediation stories grouped by feature/collection (rooms · users · device-binding · presence/RTDB · storage uploads · fun-facts/banners · web), each: move the operation behind an authz'd Express endpoint, migrate Android + iOS `actual` impls, prove on the real emulator stack, tighten the corresponding rule.

## DoD at Epic Level

- The CI ratchet exists, is wired into `lint.yml`, and its baseline allowlist is **empty** (every direct-access site remediated).
- Zero `com.google.firebase.{firestore,database,storage}` / `dev.gitlive.firebase.{firestore,database,storage}` references remain in client code (`app/src/main`, `shared/src/{androidMain,iosMain,commonMain}`); web `public/**` data access all via the API.
- `firestore.rules` / `database.rules.json` tightened to deny direct client data access (defence-in-depth), verified by real-emulator tests.
- CLAUDE.md documents the API-only rule under Architecture + Pre-Merge Testing Protocol; `code-reviewer` enforces it.
- Every child SHY Done + released.

## Notes

- 2026-07-09 — EPIC created in response to the operator's critical directive. Scoping audit dispatched → `.project/audit/direct-backend-access-audit-2026-07-09.md` (baseline: ~26 client repo/impl files still direct; a few flows — Identity/User/PM-lock/Report/some room mutations — already via the API). Prevention (SHY-0168) is being built first so no new violation can merge during the multi-story remediation. Real-time reads called out as the architectural crux (SHY-0169 spike). Rule codified in [[feedback-no-direct-backend-all-via-api]]; generalizes the CLAUDE.md "Room mutations → server-side authz" in-flight plan.
