---
id: SHY-0240
status: In Progress
owner: claude
created: 2026-07-25
priority: P1
effort: S
type: infra
roadmap_ids: []
epic: EPIC-0009
---

# SHY-0240: Gauntlet v2 — pre-flight data-plane smoke (abort the run early if the plumbing is dead)

## User Story

As **the engineer running the release gauntlet**,
I want **a few-second liveness check that proves the real data plane (API + Firebase Auth + a Firestore write→read round-trip) is alive before the device matrix is dispatched**,
So that **a dead or misconfigured stack fails the run in seconds — with a clear reason — instead of being discovered after the phones have burned through hours of cell timeouts against a stack that was never going to work**.

## Why

The grounding investigation (2026-07-25, recorded in `## Notes`) established:

- **Nothing proves the data plane before the matrix today.** `20-reseed.sh` proves *Auth* sign-in (a curl against the Auth emulator, `20-reseed.sh:57-67`), but never touches the Express API or does a Firestore write/read — so an API that is down, an authz layer that is broken, or a Firestore that won't accept writes is only discovered once the matrix cells start failing.
- **The matrix is expensive to start.** `50-matrix.sh launch` reseeds, preps devices, and dispatches Mac∥Android∥iPhone cells that each carry long timeouts. A dead stack there wastes real wall-clock and a device session.
- **For an API-only backend, an API read *is* the propagation-readable proof.** Clients never read Firestore directly ([[feedback-no-direct-backend-all-via-api]]); every device journey observes state *through the API*. So a `PATCH` that lands and a `GET` that serves it back is exactly the round-trip the device journeys depend on — verifiable in seconds, with no device.

So SHY-0240 adds a `25-smoke.sh` phase, wired into `gauntlet-v2.sh` **after the PIN gate and before matrix-dispatch**, that runs a four-leg round-trip and `die`s on any failure — reusing the orchestrator's existing `set -e` + ERR-trap → `FAIL` sentinel machinery (SHY-0236), so a dead plumbing aborts the whole run before a single device cell is dispatched.

The four legs, each a real proof:

| Leg | Call | Proves |
|---|---|---|
| 1 | `wait_http $API_BASE/api/health` (unauth) | the Express API is up |
| 2 | `signInWithPassword` (persona) → `idToken` | Firebase Auth is up + personas are seeded |
| 3 | owner-gated `PATCH /api/users/<id>` (Bearer) | the API accepts an authenticated write to Firestore |
| 4 | `GET /api/users/<id>` → the written nonce echoes | that write is durable + served back through the API |

**Note on scope:** the original EPIC-0009 child bundled "smoke + cross-platform coverage." The cross-platform real-time journey hardening (j01/j04 live web→device assertions) can only be verified by driving real Android + iOS device UIs (a hard matrix gate) and is split into **SHY-0241** (deferred to the operator-present release session). This story is the device-free, fully-AFK-verifiable smoke.

## Acceptance Criteria

### Happy path
- [ ] `25-smoke.sh [local|dev]` runs a four-leg round-trip (health → persona sign-in → authenticated write → read-back) and exits 0 when the data plane is alive, in a few seconds.
- [ ] The read-back leg asserts the **same** nonce it wrote round-trips (not merely that a `GET` returns 200 against a stale doc).
- [ ] `gauntlet-v2.sh` runs the smoke as a `phase "smoke"` **after** the PIN gate and **before** matrix-dispatch, only when a matrix is being dispatched (`MATRIX=1`); for `local` it reseeds first so the smoke persona exists.

### Error paths
- [ ] Any failed leg (health, sign-in, write, or read-back) `die`s with a specific, actionable message → the caller's ERR trap writes `FAIL` → the whole run aborts before matrix-dispatch.
- [ ] A dead API aborts at the health leg within the bound (`SMOKE_HEALTH_TIMEOUT`, default 10s) — it never proceeds to sign-in/write against a dead stack.
- [ ] An unknown `--target` and (for `dev`) missing credentials fail fast, non-zero, before any network call.

### Edge cases
- [ ] The **local↔dev password trap** is handled: `local` signs in with the baked `localdev123`; `dev` uses the `PERSONAS_PASSWORD` secret. A wrong-password sign-in surfaces an explicit `INVALID_PASSWORD` message (not a generic failure).
- [ ] A `--no-matrix` (frameworks-only) run skips the smoke entirely (nothing to protect).
- [ ] The persona + write target are overridable (`SMOKE_PERSONA_EMAIL`/`SMOKE_PERSONA_UNIQUEID`) but default to a stable, existing seeded pair whose **API-resolved** uniqueId matches (`adult-power@shytalk.dev` ↔ `50000010`) — proven by real probe, since the token's `uniqueId` claim does **not** match the API's Firestore-resolved id.
- [ ] The smoke is **idempotent**: it captures `lastRoomName` before the write and restores it after (best-effort), so it does not permanently mutate a shared journey persona (the reseed's merge-write would not heal the nonce). The JSON bodies are built via `JSON.stringify` (node), so an overridden email/secret containing a quote or backslash cannot malform the request and false-abort a healthy stack.

### Performance
- [ ] The smoke is a few-second round-trip (four sequential curls with short `-m` bounds), negligible against the multi-hour matrix — and it *saves* wall-clock by aborting a doomed run before device dispatch.

### Security
- [ ] N/A — local/dev QA tooling. It signs in as a seeded **test** persona and writes a benign nonce to a whitelisted field (`lastRoomName`); no secrets are logged (the password comes from env / the baked local default), no new trust boundary. The dev password is read from `~/.shytalk` via env, never echoed.

### UX
- [ ] Each leg logs a green `ok` line; a failure prints a red `die` naming the exact leg + a hint (e.g. which password `local`/`dev` expects), so the operator fixes the plumbing without spelunking.

### i18n
- [ ] N/A — developer-facing CLI tooling; no user-facing strings.

### Observability
- [ ] The smoke's pass/fail is visible in the run's live console stream (via `gauntlet-v2.sh`'s `phase`/`tee`) and its failure aborts through the same `FAIL` sentinel the rest of the run uses — one consistent terminal signal.

## BDD Scenarios

**Scenario: A live stack passes the smoke and the run proceeds**
- **Given** the local stack is up and seeded
- **When** `25-smoke.sh local` runs
- **Then** all four legs pass (`ok`) and it exits 0
- **And** the write nonce is read back through the API

**Scenario: A dead API aborts the run before the matrix**
- **Given** the API is not reachable
- **When** the smoke runs (health bound `SMOKE_HEALTH_TIMEOUT=1`)
- **Then** it `die`s at the health leg within the bound, non-zero
- **And** it never attempts sign-in or a write

**Scenario: The write→read round-trip is the real proof**
- **Given** a signed-in persona
- **When** the smoke PATCHes `lastRoomName=<nonce>` and GETs the user back
- **Then** it asserts the exact `<nonce>` is returned (a stale-doc 200 would not pass)

**Scenario: The local↔dev password trap is caught**
- **Given** `--target dev` with the wrong password
- **When** sign-in returns `INVALID_PASSWORD`
- **Then** the smoke dies with a message naming which password each target expects

**Scenario: The orchestrator aborts early on a dead plumbing**
- **Given** `gauntlet-v2.sh --frameworks` with a matrix and a dead data plane
- **When** the smoke phase runs (after the PIN gate, before dispatch)
- **Then** the run writes `FAIL` and exits before any device cell is dispatched

## Test Plan

**Classification: test-tooling-only.** Confined to `express-api/scripts/gauntlet/25-smoke.sh` (new) + one wiring block in `gauntlet-v2.sh` + new test files under `express-api/tests/scripts/`. No app/backend/website runtime surface — Pre-Merge Protocol tooling exemption. The happy path is proven by a **real run against the live local stack** (recorded in `## Notes`); the abort paths are CI-deterministic (no stack needed).

**Real-execution proof (recorded, not a unit test):** `bash 25-smoke.sh local` against the live seeded local stack → all four legs `ok`, exit 0 (see Notes for the captured output). This is the SHY-0236 real-only discipline — the smoke is an integration check whose happy path runs against the real stack.

**Structural pins** (`express-api/tests/scripts/gauntlet-v2-smoke-structure.test.js`, new):
- the four legs are present (health via `wait_http /api/health`; `signInWithPassword`; owner-gated `PATCH /api/users`; read-back that greps the **written nonce**);
- every leg `die`s on failure (+ unknown target) — the abort contract;
- the local↔dev password + api-key branch, incl. the explicit `INVALID_PASSWORD` message;
- the default persona is the verified `adult-power@shytalk.dev` ↔ `50000010` pair (overridable);
- `gauntlet-v2.sh` wires the smoke after the PIN gate, before matrix-dispatch, inside a `MATRIX=1` guard, with a local `reseed-pre-smoke`.

**Behavioural pins** (`express-api/tests/scripts/gauntlet-v2-smoke.test.js`, new — real `spawnSync`, no live stack):
- an unknown target dies non-zero with a clear message;
- a dead API (closed port + `SMOKE_HEALTH_TIMEOUT=1`) aborts at the health leg within the bound, non-zero, and never reaches sign-in;
- `--target dev` with missing credentials dies before any network call.

**Guards:** `bash -n` + `shellcheck -x` on both scripts; `eslint --max-warnings=0` + `prettier` on the new tests; `scripts/check-no-new-stubs.js` clean (real curl/process, no doubles); `code-reviewer` 100% clean.

## Out of Scope

- **Cross-platform real-time journey hardening** (live admin/web → Android/iPhone assertions on j01/j04; `@ios-device` upgrade for j10/j11) — **SHY-0241**, device-dependent, deferred to the release session.
- Driving any real device, or asserting on-device UI propagation — the smoke is a headless data-plane check, not a substitute for the device matrix (it *protects* the matrix).
- Changing `50-matrix.sh`'s own reseed/dispatch, or the drivers/product runtime.
- A `--target prod` smoke (the gauntlet targets local/dev only).

## Dependencies

- **SHY-0238 + SHY-0239** (merged to develop) — the smoke slots into `gauntlet-v2.sh`'s phase sequence after the SHY-0239 PIN gate and reuses the SHY-0236/0238 `set -e` + ERR-trap → `FAIL` sentinel abort machinery.
- `20-reseed.sh` (local seeding) — the local smoke reseeds first so the persona exists + is signed in with the baked `localdev123`.
- A running local stack for the real-execution proof; `~/.shytalk/dev-personas.env` (`PERSONAS_PASSWORD` + `FIREBASE_DEV_API_KEY`) for a dev smoke.

## Risks & Mitigations

- **Risk:** the token's `uniqueId` claim ≠ the API-resolved id, so a naive write target always fails owner-gate. **Mitigation:** proven by real probe; the default persona/id (`adult-power`/`50000010`) is a verified pair whose API-resolved id matches; pinned structurally.
- **Risk:** a false abort on an alive-but-unseeded stack. **Mitigation:** `gauntlet-v2.sh` reseeds before the local smoke; the smoke's `INVALID_PASSWORD` branch names the seed/password fix.
- **Risk:** a bad `SMOKE_HEALTH_TIMEOUT`/non-numeric could hang. **Mitigation:** `wait_http` loops a bounded `seq 1 timeout`; a non-numeric would error the `seq` and fall through (not hang) — and the default is used unless explicitly overridden.
- **Risk:** the smoke's write permanently pollutes a shared journey persona's field — the reseed's `set(doc, {merge:true})` does **NOT** clear a field it doesn't itself set (`provision-test-personas.js:494` never writes `lastRoomName`), so the nonce would persist across every run (review R1 caught the original "reseed wipes it" claim as false). **Mitigation:** the smoke is **idempotent** — it reads `lastRoomName` before the write and restores it after (best-effort; liveness is already proven by the read-back), leaving the persona exactly as found. Verified on a real run: `lastRoomName` before == after.

## Definition of Done

- `25-smoke.sh` (four-leg round-trip, target-branched, die-on-failure) + its `gauntlet-v2.sh` wiring (after PIN gate, before dispatch, `MATRIX`-gated, local reseed) landed.
- Real-execution happy-path proof recorded; structural + behavioural abort pins green; `bash -n` + `shellcheck` + `eslint` + `prettier` + no-new-stubs clean; `code-reviewer` 100% clean; merged to develop.

## Notes

**2026-07-25 — grounding + design (Explore + live probe).** Mapped the existing liveness (`20-reseed.sh:57-67` is Auth-only, no API/Firestore round-trip), the minimal real API triangle (`signInWithPassword` → `PATCH /api/users/:id` `users.js:651` owner-gated → `GET /api/users/:id` `users.js:533`), and the local↔dev credential split. **Live probe caught a real trap:** the token's `uniqueId` claim decodes to `1`, but `PATCH /api/users/1` → "Cannot modify another user" and `GET /api/users/1` → "Not found" — the API resolves `req.auth.uniqueId` from Firestore by firebaseUid (`auth.js:120`), not the claim, and there is no `/me` endpoint. Verified the correct pair `adult-power@shytalk.dev` ↔ `50000010` end to end (PATCH `{"success":true}`, GET echoes the nonce). Codified [[feedback-never-guess-always-investigate]] in practice — probing first turned a would-be always-failing write into a design fact.

**2026-07-25 — implemented + real-run proof.** `25-smoke.sh` (new): four-leg round-trip, `set -uo pipefail` + `die`-on-each-leg (→ ERR trap → FAIL), target-branched creds. Wired into `gauntlet-v2.sh`: `phase "smoke"; bash 25-smoke.sh "$TARGET"` after `pin_ready_gate`, before matrix-dispatch, inside `MATRIX=1`, with a local `reseed-pre-smoke`. **Real run `bash 25-smoke.sh local` against the live seeded local stack → all four legs `ok`, exit 0 (~1s):** health ok → sign-in (adult-power) ok → write (PATCH /api/users/50000010) ok → round-trip (nonce read back) ok. Abort paths verified live too: unknown target → die; dead API (`:9` + `SMOKE_HEALTH_TIMEOUT=1`) → die at health in ~1s; `--target dev` sans creds → die. Tests (SHY-0236/0238/0239 discipline): `gauntlet-v2-smoke-structure.test.js` + `gauntlet-v2-smoke.test.js`.

**2026-07-25 — Code-review R1** (`code-reviewer`, reviewer-before-push gate on the local commit): 1 Critical + 4 Important/Minor, ALL applied (fix round self-certified per [[feedback-agent-token-frugality]]).
- **C1 — leg-4's round-trip check (the headline AC) was only string-present-pinned**, never execution-tested — every behavioural test died before reaching it, so a `grep -qF`→`grep -qvF` inversion would silently false-pass. **Fixed:** extracted the leg logic into pure sourceable predicates (`smoke_json_field`/`smoke_write_ok`/`smoke_roundtrip_ok`/`smoke_invalid_password`) behind a `GAUNTLET_SMOKE_LIB` guard (the SHY-0238/0239 lib-mode pattern) + unit-tested each with literal fixtures. The round-trip predicate is **mutation-proven** (invert → test goes red).
- **I2 — the story's "reseed wipes the nonce" mitigation was factually wrong** (verified: `provision-test-personas.js:494` `set(…,{merge:true})` never writes `lastRoomName`, so the merge never clears it — the pollution was permanent). **Fixed:** the smoke now captures `lastRoomName` before + restores it after (idempotent, best-effort) — verified on a real run (`before == after`); the Risks text is corrected.
- **I3 — raw JSON interpolation of email/password** could malform the body + false-abort if an overridden value / dev secret held a `"`/`\`. **Fixed:** bodies built via `JSON.stringify` (node); pinned by an escaping test (a quoted value round-trips through `JSON.parse`).
- **I4 — the wiring ordering test lacked the sibling `-1`-found guard** (a broken reference regex could pass vacuously). **Fixed:** guard all three indices `> -1`.
- **M1 — the `PERSONAS_PASSWORD`-only-missing dev path was untested.** **Fixed:** added a 4th abort pin (api-key present, password absent → dies naming `PERSONAS_PASSWORD`).
- Gates: **81 gauntlet-v2 tests green** (58 prior + 23: 14 structural + 9 behavioural); round-trip predicate mutation-proven; the real run stays green + idempotent; `bash -n` + `shellcheck -x` + eslint + prettier + no-new-stubs clean.
