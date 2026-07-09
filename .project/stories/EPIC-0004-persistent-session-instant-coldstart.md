---
id: EPIC-0004
status: In Progress
owner: claude
created: 2026-07-01
priority: P1
title: Persistent session & instant, secure cold-start across all surfaces — retire the FunFact splash
child_shys: [SHY-0143, SHY-0144, SHY-0145, SHY-0146, SHY-0147, SHY-0148]
---

# EPIC-0004: Persistent session & instant, secure cold-start (all surfaces) + FunFact splash retirement

## Vision

A returning user never sees a login screen or a loading screen again — **on the app AND on the website**. They land straight in, with private data streaming in behind a **cohort-safe** gate, and with **every anti-abuse gate still enforced** (device/network bans, emulator/rooted/jailbroken-device blocking) — the optimistic path must never become a bypass. The FunFact splash and its fun-facts content pipeline are **retired entirely** (app, admin, backend, data). Cross-surface, cross-browser: the same "stay signed in" guarantee holds on Android, iOS, and every supported browser on desktop and mobile.

The headline is also a **testing accelerator**: every device/browser QA cycle currently pays a sign-in (+ splash, + repeated MFA) tax on each launch. Once these land, a returning tester is straight in — compounding savings across the operator-gated gauntlet for the rest of the MVP.

## Why now (MVP)

Being re-shown login/loading/MFA on every visit — even when already authenticated — is a first-impression regression against the bar set by mainstream apps, and a per-launch friction tax on the whole QA programme. **All six child stories are `mvp: true`** (operator decisions 2026-07-01).

The non-obvious constraints that shape the EPIC:
1. **It's not "add caching".** Firebase already persists the session on every surface. The app re-shows login because it *blocks on a security-load-bearing cohort re-resolution* every cold start; the web mostly persists already but is **untested cross-browser** and the portal **re-verifies MFA every visit** (server-enforced). So the work is "make the re-checks optimistic / bounded **without weakening security**".
2. **The optimistic path must not bypass anti-abuse gates.** Device/network bans currently run only inside the app's sign-in flow — skipping sign-in would skip them. They must be **hoisted to a pre-routing gate**.
3. **Cohort segregation (SHY-0132/0137) is the security boundary** — private data must never render before a fresh token confirms the cohort.

## Scope

Six 1-SHY-1-PR vertical slices, grouped by surface + review boundary so each PR is reviewable under one mental model and the irreversible data deletion is isolated. **All `mvp: true`.**

| # | Child SHY | Surface | Scope | Effort |
|---|---|---|---|---|
| 1 | **SHY-0143** | Android + iOS (shared KMP) | Persist identity; optimistic cold-start to the room list; confirm cohort via a fast token refresh before any private read; full reconcile in the background; bounce to login only on a truly dead session; **hoisted pre-routing device/network ban gate** (+ emulator/root regression) so bans/blocks are never bypassed. | XL |
| 2 | **SHY-0144** | Android + iOS (Kotlin) | Delete the FunFact splash + the app-side fun-fact code; re-route the auth flow straight to the room list; banners kept. | M |
| 3 | **SHY-0145** | Admin + Backend + Data | Remove the fun-facts routes, admin tab, security rules, and the collection data (export-then-delete, operator-gated). Banners kept. | M |
| 4 | **SHY-0146** | iOS | In-app jailbreak / simulator / integrity detection — parity with Android's device gate; shared "unsafe device" screen. | L |
| 5 | **SHY-0147** | Portal (web) + Backend | "Remember this browser" for the portal's authenticator code — a bounded (default 30-day), server-issued, revocable, fail-closed MFA-verified window instead of re-prompting every visit. | L |
| 6 | **SHY-0148** | Public web | Prove & harden "stay signed in" across all 5 supported browsers (roadmap / suggestions / admin) — fill the coverage gaps + fix the loading flash. | M |

**Ordering:** App core first — **1 → 2 → 3** (SHY-0143 delivers the instant-app headline on its own; 2 removes the splash for everyone; 3 cleans the data). **4** (iOS integrity) is independent security parity. **5 → 6** (web) are independent of the app track and of each other, and can proceed in parallel with the app work.

## Child SHYs

**App track (Android + iOS):**
- **SHY-0143** (P1, XL, feature) — Persist session → optimistic, cohort-safe, ban-gated cold-start to the room list. **The headline + security keystone.** Status: Draft.
- **SHY-0144** (P1, M, refactor) — Retire the FunFact splash + app-side fun-fact code. Status: Draft.
- **SHY-0145** (P1, M, chore) — Decommission the fun-facts pipeline (admin + backend + data). Status: Draft.

**Device-integrity parity:**
- **SHY-0146** (P1, L, feature) — iOS in-app jailbreak/simulator/integrity detection (Android parity). Status: Draft.

**Web track (all supported browsers):**
- **SHY-0147** (P1, L, feature) — Portal "remember this browser" bounded MFA window. Status: Draft.
- **SHY-0148** (P1, M, chore) — Cross-browser "stay signed in" proof + hardening for the public pages. Status: Draft.

> The cohort-safety gate + the hoisted ban gate in SHY-0143 are the security keystones; SHY-0144 cannot regress banners (a separate, surviving feature); SHY-0145 carries the only irreversible step (the collection delete) and is therefore its own small, auditable PR (lands after SHY-0144 removes the consumer). SHY-0146 gives iOS device-integrity parity. SHY-0147's MFA-remember is fail-closed + bounded + revocable. SHY-0148 is mostly cross-browser proof + a flash fix (the web already persists login).

## DoD at Epic Level

- [ ] **SHY-0143:** a returning user with a valid session cold-starts straight to the room-list shell on **real Android + real iPhone** (no login, no splash); **no private read before the cohort is confirmed**; a dead/expired/revoked/suspended session bounces cleanly to login; a **banned device/network is shown the ban screen (never login/rooms), even with no saved session**; emulator/rooted Android stays blocked; the SHY-0139 fallback guard holds.
- [ ] **SHY-0144:** no user — returning or first-time — sees the FunFact splash; banners still load + display; splash strings removed in all 20 locales.
- [ ] **SHY-0145:** the fun-facts routes/admin-tab/rules are gone and the collection is exported-then-deleted (operator-approved); banners untouched.
- [ ] **SHY-0146:** a jailbroken/simulated iPhone is blocked in-app (shared "unsafe device" screen); a clean iPhone is unaffected; dev builds bypass for QA.
- [ ] **SHY-0147:** a portal user who "remembers this browser" skips the authenticator code for the bounded window; re-prompted on expiry / a new browser / sign-out; the MFA-remember token is bounded, server-signed, revocable, httpOnly, and fail-closed.
- [ ] **SHY-0148:** a signed-in visitor stays signed in on reload across **all 5 browsers** (incl. Safari/WebKit) with no signed-out flash; a signed-out visitor is still prompted.
- [ ] Each child SHY satisfies the Pre-Merge Testing Protocol and reaches `Done` (`released_in:` set on its release cut). **All six are `mvp: true`.**

## Notes (running log)

- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) from an operator brainstorming session; **expanded twice during review**. Started as the app cold-start + splash retirement (0143/0144/0145). Operator then flagged the **anti-abuse bypass** (device/network bans run only inside the app's sign-in flow → the optimistic path would skip them) → folded a **hoisted pre-routing ban gate** into SHY-0143 (effort L→XL) + split **iOS in-app integrity detection** to SHY-0146 (both after an anti-abuse Explore map). Operator then extended the persistent-session goal to **the web** → a web-surfaces Explore map showed the web already persists login but is untested cross-browser + the portal re-verifies MFA every visit → filed SHY-0147 (bounded "remember this browser" MFA window) + SHY-0148 (cross-browser "stay signed in" proof + flash fix). All six `mvp: true`. Design decisions (all operator, AskUserQuestion): instant shell + data behind a cohort gate; fast token-refresh gate + background reconcile; re-login only on no-session/refresh-fail/forceSignOut/suspension; splash deleted for everyone; fun-facts data deleted after backup export; ban gate folded into 0143; iOS integrity launch-blocking; portal MFA bounded 30-day window; web stories launch-blocking. Grounded in three read-only Explore passes (startup/auth flow · splash blast-radius · anti-abuse gating · web surfaces). Also codified a global standard mid-review: **non-technical BDD** ([[feedback-non-technical-bdd]], CLAUDE.md § BDD). Filed on branch `chore/EPIC-0004-session-coldstart` (all-`.md`). Next pickup in priority order: **SHY-0143**.
