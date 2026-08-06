---
id: EPIC-0005
status: In Progress
owner: claude
created: 2026-07-01
priority: P1
title: Ban enforcement & anti-abuse hardening — make bans actually unbypassable (server + rules + web)
child_shys: [SHY-0149, SHY-0150, SHY-0151]
---

# EPIC-0005: Ban enforcement & anti-abuse hardening

## Vision

A ban actually stops the banned. Bans are enforced **authoritatively** — server-side on every sensitive request, at the Firestore-rules layer, and **consistently across app, web, and direct API** — so a banned user cannot evade by using the website, calling the API directly with a valid token, forging an `X-Forwarded-For` header, running a modified client, staying signed in past the moment of the ban, or reinstalling to reset their device ID. The ban check stops being a single client-triggered call at sign-in and becomes a **per-request, defense-in-depth** control.

## Why now (MVP)

An adversarial bypass-surface review (2026-07-01) found bans are checked in **exactly one place** — the mobile app's `/api/device-info` call at sign-in (`grep checkBans` → one file). Everything else is open:
- **Web / direct-API:** `/api/suggestions` create/vote/comment enforce auth + suspension but **no ban** — a banned user acts freely from the website or `curl`.
- **`X-Forwarded-For` spoofable:** the network-ban check reads the **leftmost** (client-supplied) XFF, not the real edge IP.
- **No server-side / mid-session enforcement:** suspension is re-checked every request; **device/network bans are not**.
- **No Firestore-rules-level gate:** rules trust `request.auth != null` alone.
- **Empty skeleton tests:** `tests/web/suggestions-security.spec.ts:108` ("banned user: direct API call returns 403") has **no body**.

For a **Safety-first** MVP ([[project-mvp-golive-parameters]]), a safety control that's trivially bypassable undercuts the bar. **Operator (2026-07-01): all three stories `mvp: true` (launch-blocking).**

## Relationship to EPIC-0004

[[SHY-0143]] hoists the ban check to the app's **pre-routing** — a UX + defense-in-depth layer so a banned app user sees the ban screen instead of the room list. This EPIC is the **authoritative** counterpart: the enforcement that no client (honest, modified, or `curl`) can skip. The two are complementary — 0143 makes the honest app behave; EPIC-0005 makes the ban unbypassable.

## Scope

Three 1-SHY-1-PR slices, by enforcement layer. **All `mvp: true`.**

| # | Child SHY | Layer | Scope | Effort |
|---|---|---|---|---|
| 1 | **SHY-0149** | Backend (Express) | Enforce bans **server-side on every sensitive request** (a per-request ban gate mirroring the suspension check) + fix the **client-IP / XFF derivation** to use the real edge IP + fill the empty security skeleton tests. Kills the web / direct-API / mid-session / XFF bypass. | L |
| 2 | **SHY-0150** | Firestore rules | A **rules-level ban gate** (`isBanned()` helper + gate on user-write collections) so even a direct Firestore SDK write from a banned user is denied at the database layer — the strongest backstop. | M |
| 3 | **SHY-0151** | Backend + device | **Reinstall-proof device bans** via DeviceCheck (iOS) + Play Integrity (Android) — platform-managed, deterministic device state that survives a reinstall (no false positives; hardware IDs like serial/IMEI/SIM are platform-blocked for consumer apps). Both are free. | L |

**Ordering:** `0149 → 0150 → 0151`. 0149 closes the critical server-side/web/XFF bypasses; 0150 adds the rules-layer backstop; 0151 (platform-primitive device bans — iOS strong via DeviceCheck, Android attestation-based via Play Integrity) lands last.

## Child SHYs

- **SHY-0149** (P1, L, bug) — Enforce bans server-side on every request + fix client-IP/XFF derivation. **The core fix.** Status: Draft.
- **SHY-0150** (P1, M, bug) — Firestore-rules-level ban gate. Status: Draft.
- **SHY-0151** (P1, L, feature) — Reinstall-proof device bans via DeviceCheck (iOS) + Play Integrity (Android). Status: Draft.

## DoD at Epic Level

- [ ] **SHY-0149:** a banned user is refused at every sensitive endpoint — from the website, the app, and a direct API call; a forged `X-Forwarded-For` does not evade a network ban (the real edge IP is used); a mid-session ban takes effect on the next request; the empty `suggestions-security.spec.ts` skeletons are implemented against **real** services.
- [ ] **SHY-0150:** a banned user's direct Firestore write is denied at the rules layer (`isBanned()` gate); unbanned writes succeed; proven with the real Rules engine.
- [ ] **SHY-0151:** a banned device that reinstalls/clears-data is still recognised via the platform primitive (DeviceCheck bit on iOS / Play Integrity on Android) and re-blocked; an innocent device is **never** falsely blocked (deterministic, not heuristic).
- [ ] Each child SHY satisfies the Pre-Merge Testing Protocol and reaches `Done` (`released_in:` set). **All three `mvp: true`.**

## Notes (running log)

- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) from an adversarial ban bypass-surface Explore review during the EPIC-0004 brainstorming — the operator asked "other ways people may bypass any type of ban, especially on the webpages." The map found **9 bypass vectors + 2 critical empty-test gaps + zero rules-level enforcement**: bans checked only at app sign-in; web/direct-API unenforced; XFF spoofable (leftmost, not `req.ip`); no mid-session re-check; device IDs reset trivially; no `isBanned()` in rules. Operator decisions (2026-07-01, AskUserQuestion): **new EPIC-0005** (distinct anti-abuse theme, separate from EPIC-0004's persistent-session) + **all three stories `mvp: true`** (launch-blocking — Safety-first bar). Complements [[SHY-0143]] (client pre-routing gate). Non-technical BDD per [[feedback-non-technical-bdd]]. Filed on branch `chore/EPIC-0004-session-coldstart` (all-`.md`). Next pickup: **SHY-0149**.
