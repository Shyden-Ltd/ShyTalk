---
id: SHY-0149
status: In Progress
owner: claude
created: 2026-07-01
priority: P1
effort: L
type: bug
roadmap_ids: []
epic: EPIC-0005
pr:
mvp: true
---

# SHY-0149: Enforce bans server-side on every request + fix client-IP / XFF derivation

## User Story

**As** the team relying on bans to keep abusers out,
**I want** bans enforced server-side on every sensitive request — not just when the app chooses to check at sign-in — using the real client IP,
**So that** a banned user cannot evade by using the website, calling the API directly with a valid token, forging a header, running a modified client, or staying signed in past the moment of the ban.

## Why

The bypass-surface review (2026-07-01) found `checkBans()` is invoked in **exactly one place** — `express-api/src/routes/device-info.js:118`, called by the app **once, at sign-in** (`AuthViewModel.checkAndApplyBan()`). Consequences:
- **Web / direct-API (Critical):** `POST /api/suggestions` (create/vote/comment) enforce `requireAuth` + `requireNotSuspended` only (`suggestions.js:390,654,818`); `authMiddleware` checks suspension (`auth.js:196`) but **never bans**. A banned user with a valid token acts freely from the website or `curl`.
- **XFF spoofing (Critical):** `device-info.js:75-76` reads `forwarded.split(',')[0]` — the **leftmost, client-supplied** `X-Forwarded-For` — instead of `req.ip` (which respects `app.set('trust proxy', 1)` at `index.js:33`). A forged `X-Forwarded-For: <clean-ip>, <real-ip>` evades network/IP bans.
- **Mid-session (Major):** suspension is re-checked every request; device/network bans are not — a ban issued after sign-in doesn't bite until the next cold-start.
- **Empty tests (Critical):** `tests/web/suggestions-security.spec.ts:108` ("banned user: direct API call returns 403") has **no body**; `:100`/`:104` likewise. `device-info.test.js` mocks Firestore (violates the § No Stubs policy for a route test).

The fix: add a **per-request ban gate** to the shared `authMiddleware` (mirroring the existing suspension check) so **every** auth-gated sensitive route enforces bans server-side, fed the **correct edge IP**; and fix the IP derivation to use `req.ip`. This is the authoritative counterpart to [[SHY-0143]]'s client-side pre-routing gate.

## Acceptance Criteria

### Happy path
- [ ] An **unbanned** user's requests to sensitive endpoints (create/vote/comment, and other auth-gated mutations) succeed exactly as before.
- [ ] The per-request ban gate lives in the shared `authMiddleware` (alongside the suspension check), so it applies uniformly to every auth-gated sensitive route — app, web, and direct API alike.

### Error paths
- [ ] A **device-banned** user's request to a sensitive endpoint is refused with `403` + a ban reason — from the **website**, the **app**, and a **direct API call**.
- [ ] A **network-banned** user (matched on the **real edge IP** / subnet / ASN) is refused with `403`.
- [ ] A user **banned mid-session** is refused on their **next request** (per-request check, like suspension), not only after re-launch.

### Edge cases
- [ ] The IP used for network-ban matching is the **real edge IP** (`req.ip` with `trust proxy: 1`); a forged/extra `X-Forwarded-For` value does **not** change the matched IP (no leftmost-XFF trust).
- [ ] The ban gate applies to **mutating / sensitive** routes; genuinely public reads keep their current access (an explicit exempt list, mirroring how the suspension check exempts certain paths) so the gate doesn't over-block.
- [ ] **Ban-lookup transient error:** the gate matches the **suspension check's existing error posture** for consistency (documented); for a safety control on a *mutation*, prefer fail-closed if it doesn't lock out all users on a transient blip — the chosen posture is explicit + tested.
- [ ] Both **device** and **network** ban types (IP / subnet / ASN) are enforced by the server-side gate (not only device).

### Performance
- [ ] The per-request ban check is a **bounded** lookup (mirroring the suspension check's cost/caching approach) — no unbounded Firestore scan, no per-request lookup storm; a short cache is acceptable if it matches the suspension check's freshness.

### Security
- [ ] Bans are enforced **server-side on every sensitive request** → the web, direct-API, modified-client, and mid-session bypasses are all closed; no ban check is skippable by the client.
- [ ] The network-ban IP is **unspoofable via headers** (real edge IP only).
- [ ] The gate does not leak ban internals beyond the necessary `403` + reason.

### UX
- [ ] A banned user receives a clear `403` with the ban reason (the app maps it to the ban screen; the web shows an appropriate blocked message) — not a generic/confusing error.

### i18n
- N/A — the server returns a machine-readable reason; the **client** localizes the ban/blocked message (the API layer is not a translated surface).

### Observability
- [ ] Server-side ban denials are logged for audit (endpoint · uid · ban type · matched IP-or-device), per [[feedback-comprehensive-default-debug-logging]] — no secret values logged.

## BDD Scenarios

**Scenario: a banned person can't post on the website**
- **Given** someone whose device or network is banned
- **When** they try to post a suggestion, vote, or comment on the website
- **Then** the action is refused

**Scenario: a banned person can't get around the app by contacting the service directly**
- **Given** a banned person using a tool to talk to the service directly instead of the app
- **When** they try to perform a banned action
- **Then** the service refuses it

**Scenario: forging your network address doesn't get past a network ban**
- **Given** someone on a banned network who forges a different network address in their request
- **When** they contact the service
- **Then** they are still recognised as banned and refused

**Scenario: being banned while using the app stops you right away**
- **Given** someone using the app who is banned while still signed in
- **When** they next try to do something
- **Then** they are refused — they do not stay in until they close the app

**Scenario: an ordinary user is unaffected**
- **Given** a user in good standing
- **When** they post, vote, or comment
- **Then** it works as normal

## Test Plan

Touches `express-api/**` (shared auth middleware + IP derivation + sensitive routes) → **backend change ⇒ Gate 4 forces the FULL app+web+device gauntlet** (per SHY-0127). Per § No Stubs: run against the **real Firebase emulator** — and this story **migrates `device-info.test.js` off its Firestore mocks** as part of the fix (a documented No-Stubs debt).

**Red → Green (framework by framework):**
- **Express/Node (Jest, real emulator)**:
  - `authMiddleware` ban gate: a device-banned uid → `403` on a sensitive route; a network-banned edge IP → `403`; an unbanned user → passes. Both ban types (device + network IP/subnet/ASN). RED before the gate exists (routes let banned users through today).
  - **XFF derivation:** a request with a forged `X-Forwarded-For` is matched against the **real edge IP**, not the header value — banned real-IP still `403`, forged clean-IP does **not** bypass. Exercised against the real `trust proxy` config (no mock).
  - **Mid-session:** sign-in passes → issue a ban → the next request to a sensitive route → `403`.
  - Migrate `express-api/tests/routes/device-info.test.js` off `jest.mock` → real emulator.
- **Playwright (web, all 5 browsers)** `tests/web/suggestions-security.spec.ts`: **implement the empty skeletons** — `:100` banned user sees suggestions read-only; `:104` no vote/comment/suggest controls; **`:108` a banned user's direct API call returns `403`** (the critical missing test).
- **Static/quality:** `npm run lint` 0 warnings; prettier clean.
- **Phase 1 LOCAL gauntlet:** Gate-4 full matrix — real Android + real iPhone + all browsers — banned user blocked everywhere; unbanned unaffected.
- **Phase 2:** `code-reviewer` 100% clean (security scrutiny: error posture, IP derivation, exempt list) → In Review + `Reviewed-up-to:` → push → CI green by name (incl. the backend-forced matrix).
- **Phase 3 (DEV):** re-run against dev (real Firebase) — banned user blocked on web + app + direct API; forged XFF ineffective.

## Out of Scope
- **Firestore-rules-level** ban enforcement — SHY-0150 (this story is the API/middleware layer).
- **Device re-registration** resistance — SHY-0151.
- The app's **client-side pre-routing** ban gate — SHY-0143 (this is the server-side counterpart; both ship).
- Adding new ban **types** or the admin ban-management UI (unchanged).

## Dependencies
- `express-api/src/middleware/auth.js:195-210` (the suspension check to mirror + extend), `device-info.js` `checkBans()` (the ban-matching logic to reuse server-side) + its IP derivation (`:75-76`), `express-api/src/index.js:33` (`trust proxy`).
- The sensitive routes (`suggestions.js` create/vote/comment, and the wider set of auth-gated mutations) that must inherit the gate.
- `tests/web/suggestions-security.spec.ts` (the empty skeletons to implement) + the real Firebase emulator.

## Risks & Mitigations
- **Risk:** fail-open on a ban-lookup error lets bans slip; fail-closed on an outage blocks everyone. **Mitigation:** match the suspension check's posture for consistency, prefer fail-closed on **mutations** if it doesn't lock out all users on a transient blip; the chosen posture is explicit + tested.
- **Risk:** a per-request Firestore lookup is a cost/latency hit. **Mitigation:** mirror the suspension check's bounded/cached approach; no unbounded scans.
- **Risk:** over-broad enforcement blocks legitimate public reads. **Mitigation:** apply to mutating/sensitive routes with an explicit exempt list (like suspension); tested both ways.
- **Risk:** `trust proxy` misconfiguration still yields a spoofable IP. **Mitigation:** use `req.ip` (respecting `trust proxy: 1`) + a test that a forged XFF does not change the matched IP against the **real** config.

## Definition of Done
- [ ] `authMiddleware` per-request ban gate (device + network, real edge IP) on sensitive routes + `device-info.js` IP-derivation fix + the empty `suggestions-security.spec.ts` skeletons implemented + `device-info.test.js` migrated to the real emulator.
- [ ] **Pre-Merge Testing Protocol satisfied (Gate-4 full matrix):** Jest RED→GREEN (ban gate · XFF · mid-session · real-emulator migration) + Playwright web security specs (incl. direct-API-403) + lint/prettier clean → LOCAL full gauntlet green → `code-reviewer` 100% clean (security scrutiny) → In Review + `Reviewed-up-to:` → push → CI green by name → DEV gauntlet green (banned blocked on web+app+direct-API; forged XFF ineffective) → **judgment-merge** (NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) under [[EPIC-0005-ban-enforcement-hardening]] from the adversarial bypass-surface map. The core fix: bans checked in exactly one place (app sign-in) → move enforcement server-side, per-request, in `authMiddleware`, with the real edge IP. Closes vectors 1 (web/API), 2 (XFF), 3 (direct-API), 4 (mid-session) + fills the empty security skeleton tests. `type: bug`, `mvp: true` (operator 2026-07-01). Authoritative counterpart to [[SHY-0143]]'s client pre-routing gate. Non-technical BDD per [[feedback-non-technical-bdd]].
- 2026-07-09 — **A query read inside the bind transaction was silently breaking the device-lock.** Chasing a "flaky" pre-existing SHY-0170 test (`concurrent bind race on one unbound device`) — which first failed with a 500, then with **both racers getting `allowed`** — a controlled experiment (remove only the cap query; race failure disappears entirely) proved the cause: `tx.get(query)` widens a Firestore transaction's conflict set, and under the emulator it also defeats the **document**-level conflict detection SHY-0170's one-device-one-account invariant depends on. That invariant outranks the new cap (it is what stops ban evasion by account-swapping), so **every binding transaction is now document-reads-only**: the cap is pre-checked outside the transaction, and `rollbackBindingIfOverCap` closes the race afterwards by releasing *only the claim this request just took*, and only while it still owns it. Racing requests each release their own claim, so the account settles at or below the cap; the device keeps its telemetry and returns to unclaimed — exactly the at-cap state. `maxAttempts: 15` retained (concurrent sign-ins on one device legitimately contend; Firestore's default 5 surfaced as a 500). Mutation-verified: disabling the rollback lands 21 bindings against a cap of 20 on all three routes. **Test isolation, three layers:** the three real-emulator files wiped shared collections in `beforeEach` while Jest ran them in parallel workers against one project (proven: 87/87 serial, failures parallel). Per-worker `projectId` — the approach `firebase-emulator.js` itself suggested — **does not work**: the Auth emulator resolves tokens against the project it was started with, so all 82 minted-token tests 401. The fix is per-FILE document-id prefixes (`abg-`/`lck-`/`dvi-`) + a `clearPrefixed` helper; the shared `users` wipe is gone. Two further sources surfaced beneath it: stale documents from earlier local runs (CI starts fresh), and `networkBans` minted by the **admin route with generated ids** — unreachable by any id-prefix scheme, and matched by IP *value*, so they must be cleaned on the field the code actually matches. 87/87 parallel ×2; 446/446 affected; 12,973 full-suite.
- 2026-07-09 — **Review round 4 → fixes.** No logic defect found in any round-3 fix, but six gaps. **R4-I1 (the important one — a product decision made by accident):** exempting `/portal/me` to fix the suspension lockout also exempted it from the **ban** gate, and `portal.js` has an `isSuspended` branch but **no ban branch** — so a banned user would have received a normal dashboard with no hint of the ban, and my test only asserted `.expect(200)` without inspecting the body. Resolved by asking what each response *is*: the gate's 403 already carries `code:'banned'` + reason + expiresAt, which **is** the ban notice and is the shape every client (incl. the web board built in this story) already renders. So `/portal/me` stays ban-gated with the informative 403; `/portal/sign-out` stays exempt, because a ban must never trap someone in a session; suspension keeps its 200-with-`isSuspended`. Tests now assert the body (`code:'banned'` + reason present, `displayName` absent). **R4-C1:** the `admin-cleanup` cache-invalidation fix shipped with **zero** tests — nothing would have failed if it were deleted (and `jest.spyOn` wouldn't work: the route destructures `clearBanCache` at require time, so the mock must precede the require). Positive + negative paths now pinned in both cleanup suites. **R4-I2/I3:** the admin binding write was non-transactional (the same TOCTOU already fixed on the other two minting routes) **and** used `.set()` without `merge`, silently wiping the ~20 telemetry fields `/api/device-info` writes whenever an admin corrected a device's ownership. Both fixed; both pinned (a concurrency test, and a re-seed test that asserts `firstSeen`/`osVersion`/`country`/`asn` survive). **R4-I4:** `device-info` would bind a device to a caller with no `users` doc, storing a literal `uniqueId: null` beside a `boundAt` — an ownership that can never resolve; `lock-check` already forbade this, now both do. **R4-I5:** `test-helpers` cleared the ban cache for seeded bans but not seeded **bindings** — a latent false-negative source in the very security specs that endpoint exists to serve.
- 2026-07-09 — **Review round 3 → fixes.** Two more Criticals, both verified in code before acting. **R3-C1:** the device cap keyed on `!existing.exists` rather than on *ownership*. The first call to an over-cap device wrote an unowned doc; the **second call to the same deviceId** took the `else` branch, saw `owner === null`, and bound it — no cap check, and `bound` stayed false so `clearBanCache` never fired. Two calls to one endpoint defeated the cap. Fixed by keying the check on `owner === null` (a brand-new doc and a previously-unbound doc are the same case); added the positive counterpart too — once a slot frees up the unowned doc **is** claimed normally, so it was never poisoned, just unclaimed. Mutation-verified against a faithful reconstruction of the old branch shape (the second call binds `uniqueId` where `undefined` is required). **R3-C2 (pre-existing, [[feedback-fix-pre-existing-and-new-same]]):** `index.js` mounts the non-strict `authMiddleware` globally on `/api`, and `portal.js` then applies `authMiddlewareStrict` per-route — so portal requests are gated **twice**, and the outer gate's exemption list never knew about `/portal/me` or `/portal/sign-out`. The strict middleware's carve-out for those paths has been **dead code**: a *suspended* user could not view their own portal profile or sign out, and the new ban gate would have inherited the identical lockout. Three test files missed it because all three mount the strict middleware **in isolation** rather than behind the real outer gate — the textbook "passes in isolation, broken in integration" failure. Fixed by adding both paths to `isSuspensionExemptPath` (which `isBanExemptPath` composes), plus a new `createPortalStackApp()` harness that replicates the production middleware order; mutation-verified (removing the exemptions turns both the banned and suspended portal tests red). **R3-I1:** `admin-cleanup`'s two bulk binding deletes never cleared the ban cache — added. **R3-I2:** `admin-devices` POST skipped the cap whenever the doc existed, so an admin could **reassign** a device to an account already at the cap; the cap now applies whenever the write *costs the target a slot* (new device, or a change of owner), and the previous owner's cached standing is cleared too.
- 2026-07-09 — **Review round 2 → fixes.** The reviewer found **2 Criticals introduced by my own round-1 fix**, both verified real. **C-NEW-1:** the fail-closed truncation `throw` propagated straight to `authMiddleware`'s 401 catch, *past* `isBanExemptPath` — so an account whose binding scan truncates (a **permanent** state, unlike a transient outage) could never appeal and never exercise its GDPR Art.15 data export, and never even receive the ban screen. Fixed by testing the exemption **before** the lookup in both middlewares (also saves a Firestore read on exempt paths). **C-NEW-2:** the `device-info` cap was three separate calls (`get` → `count` → `set`), so N concurrent sign-ins on distinct new devices each observed a pre-cap count and all committed — the sibling `lock-check` was already transactional. Fixed by wrapping the read-decide-write in `db.runTransaction` with `countBoundDevices(uid, tx)`. **Also corrected my own design error:** returning `403 device_limit` from `device-info` would have blanked the ban screen that endpoint is exempted to feed — at the cap it now records telemetry **unbound** (no `uniqueId`, so it can never serve as a decoy) and still returns `banStatus`. **I-NEW-1:** the LRU test was a tautology (touching the hot key every iteration makes FIFO and LRU converge) — rebuilt so it fails under FIFO. **I-NEW-3 + beyond:** `admin-devices` create/delete wrote `deviceBindings` uncapped **and never invalidated the ban cache** — a gap the reviewer under-called: creating a binding can pull a hardware ban into scope, so a stale "clean" verdict would persist for the full TTL. Cap + `clearBanCache` added there, and on both client binding paths (`lock-check`, `device-info`), each with a real-emulator test. **I-NEW-2** (clients don't map `device_limit`) is moot for `device-info` (no longer 403s); `lock-check`'s 403 falls into the app's existing lenient error path — no regression, and client ban-screen UX remains [[SHY-0143]]'s scope.
- 2026-07-09 — **Review round 1 → fixes.** `code-reviewer` returned **1 Critical + 6 Important**, all verified against live code before acting. **C1 (Critical, real):** the gate resolved hardware bans by scanning the caller's `deviceBindings` with `.limit(20)`; deviceIds are attacker-chosen strings and Firestore paginates by document id, and `/devices/lock-check` (which mints bindings, unbounded, and is itself ban-exempt) let an attacker bury the banned device under decoys that sort ahead of it. **Fixed both halves:** a write-time cap (`MAX_BOUND_DEVICES = 20`, enforced transactionally in lock-check via `tx.get(query)` — overload confirmed in the Admin SDK typings — and on `/device-info`, the other minting route), plus the gate now scans to `MAX_BOUND_DEVICES × 5` and **fails closed on truncation** (throws → 401) instead of logging a warning and assuming innocence. Overshoot now hurts only the evader. **I1:** the web page cleared its blocked banner on any 200 — but public suggestion reads are auth-exempt and answer 200 to banned users, so one sort/search click restored the write controls; call sites now opt in via `gated: true`. **I2:** `cron/testDataCleanup.js` + `admin-migrate.js` mutate ban collections without `clearBanCache()` — added. **I3:** `authMiddlewareStrict`'s 403 branch had no test at all (the strict suite stubs the gate to always pass) — added 3 real-emulator portal cases. **I4:** `evictOldest` was FIFO-by-insertion, so a hot caller could be evicted ahead of a cold one — cache hits now re-insert (LRU). **I5:** verified — `uniqueId === null` callers genuinely cannot carry a device ban (no bindings exist); the gap is closed by SHY-0170's device-lock and SHY-0151's platform attestation, and is now documented at the code site rather than left implicit. **I6:** app-side handling of a mid-session 403 stays with [[SHY-0143]] per this story's Out of Scope. New tests: decoy-flood evasion pin, fail-closed-on-truncation, per-account cap on both minting routes, 4 remaining cache-invalidation writers, strict-middleware 403 + exempt path, LRU/in-flight/rejected-lookup cache semantics, post-detection browsing keeps the banner, hostile ban `reason` renders inert.
- 2026-07-09 — **GREEN + web surface.** Backend: `src/utils/bans.js` (shared engine), gate wired into both auth middlewares, `req.ip` replaces the leftmost-XFF split, cache invalidation on every ban mutation path (`admin-bans` issue/unban/unban-all, `admin-users` auto-ban/lift, `test-helpers` cleanup + seeding). Web: `suggestions-board.js` learns standing from any 403 the server returns (no new endpoint — the gate itself is the source of truth), shows a localized blocked banner (3 keys × 21 locales) and withholds suggest/vote/comment controls; read access preserved. **Three defects found and fixed en route** (all pre-existing, per [[feedback-fix-pre-existing-and-new-same]]): (1) an admin-issued **ASN ban could never match** — the admin route validates digits-only (`64500`) while geo enrichment stores `AS64500`; (2) the ip-api geo `fetch` had **no timeout**, so a hung upstream stalled `/api/device-info` (and with it sign-in) — now `AbortSignal.timeout(3000)`; (3) `roadmap-auth.js` **skipped Firebase init whenever the API key contained "fake"**, which is exactly the local + CI config — so `window.shytalkAuth` never gained its sign-in methods and **no web test could ever exercise a signed-in user**. That is the real reason the anti-abuse specs were empty skeletons; the guard is now emulator-aware (`!hasRealKey && !isLocal`), and CI's `playwright-tests.yml` already starts the Auth emulator. Tests: 4 anti-abuse Playwright specs implemented against a **real** seeded `deviceBans` doc (`deviceBans`/`networkBans` added to the test-write allowlist) — **mutation-verified**: disabling the gate turns all 3 banned-user specs RED (the first mutation run was invalid — `pkill -f "node src/index.js"` never matched `node --env-file=.env.local src/index.js`, so the un-mutated server answered; re-run by PID proved it). 29 web specs green on chromium; `device-info.test.js` migrated to the real emulator with mock-necessary slices split into `tests/unit/`; no-stubs baseline shrinks by 3, no-direct-backend clean.
- 2026-07-09 — **PICKED UP** (`In Progress`, branch `story/SHY-0149`). Pickup-fitness review vs current develop: all four bypasses re-verified live (`checkBans` still single-call at `device-info.js:135`; leftmost-XFF at `device-info.js:81-82`; skeletons still empty; `device-info.test.js` still mocked). Refinements from intervening work: (1) uid→ban resolution rides SHY-0170's `deviceBindings` ownership + the existing `deviceBans.linkedUniqueId` field (String + legacy Number via `Filter.or`) — this is what blocks a device-banned account on the web; (2) ASN network-bans match the caller's STORED binding `asn` (no per-request geo call); (3) error posture = **fail-closed**, matching the suspension check's structural posture (rejection → authMiddleware outer catch → 401); (4) gate exemptions = suspension-exempt list + `/device-info` + `/devices/lock-check` (the ban-delivery/binding channels — gating them would replace the app's ban screen with a generic error); (5) per-uid ban cache mirrors `suspensionCache` (TTL/eviction/in-flight dedup) + global active-networkBans cache; admin-bans routes must invalidate on issue/lift; (6) Test Plan's per-PR device gauntlet superseded by the MVP pivot (SHY-0163) — device E2E joins the end-of-sprint REAL-DEVICE batch; Jest+Playwright+lint run per-PR in full. **RED verified via canonical `npm test`: 24 specs — 17 fail for missing-feature reasons exactly, 7 pass pre-gate as designed** (`tests/middleware/auth-ban-gate.test.js` real-emulator + `auth-ban-gate-posture.test.js` unit posture/audit).
