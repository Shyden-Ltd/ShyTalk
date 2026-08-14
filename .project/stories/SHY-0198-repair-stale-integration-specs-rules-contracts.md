---
id: SHY-0198
status: Done
owner: claude
created: 2026-07-16
priority: P1
effort: XS
type: bug
roadmap_ids: []
released_in: v0.98.0
---

# SHY-0198: Repair stale integration specs — deviceBindings deny-all + ownerFirebaseUid strict create

## User Story

As the release operator, I want the integration test tier to encode the CURRENT shipped security contracts, so that a green integration gate means the rules actually hold and a red one means a real regression — instead of the gate being permanently red on stale expectations and blocking every backend-flagged PR to main.

## Why

PR #1614 (SHY-0195, CI-config-only) is the first backend-flagged PR to target main in weeks. Its required `PR Gate` fails because 4 integration specs encode contracts that were deliberately superseded on main:

1. `07-firestore-rules-enforcement.spec.ts:493` — "user CAN read their own device binding" expects owner-read, but **SHY-0170 (#1550)** locked `deviceBindings/{deviceId}` to `allow read, write: if false` (server-only via Admin SDK; documented in-place as defence-in-depth).
2. `10-firestore-cohort-rules.spec.ts:1099/1115/1211` — three room-create specs omit `ownerFirebaseUid`, which **SHY-0029 (#1541)** made strictly mandatory (`.get('ownerFirebaseUid','') == request.auth.uid`; "absent → deny" is documented in the rule).

Local canonical-runner repro reproduced all 4 failures exactly; a rules-file bisect (develop's `firestore.rules` hot-swapped into the emulator, reload confirmed in the emulator log) still fails all 4 — proving BOTH branches are affected and the specs, not the rules, are stale. The develop-flow hid this: develop PRs run no CI, and no backend-flagged PR targeted main since the tightenings landed.

## Acceptance Criteria

### Happy path
- [ ] The full integration suite (`npx playwright test --config=playwright.integration.config.ts`) is green on the current main tree via the canonical local stack.
- [ ] The 4 previously-failing specs pass with expectations matching the shipped contracts (deviceBindings: owner-read DENIED; room creates: succeed with `ownerFirebaseUid` present and matching).

### Error paths
- [ ] The deviceBindings attacker-read spec still asserts denial (deny-all satisfies it).
- [ ] Every cohort deny-side spec (forged cohort ×2, missing cohort, invalid cohort value, proxy ownerId, null-claim→adult) carries `ownerFirebaseUid` matching its auth context so it fails ONLY for its named reason — no test passes for an incidental missing-field cause.

### Edge cases
- [ ] Null-cohort caller (no `cohort` claim) still defaults to minor and can create a `cohort=minor` room once `ownerFirebaseUid` is supplied.
- [ ] The repaired specs pass against BOTH main's rules and develop's rules (develop adds `isBanned()` gates only; fixture users are not banned) — verified by the same emulator hot-swap bisect used in diagnosis.

### Performance
- N/A — test-content-only change; no runtime surface, no suite-shape change (workers stay 1, retries stay 0).

### Security
- [ ] The repaired deviceBindings spec now PINS the SHY-0170 lockdown (a future rules loosening that re-exposes bindings to any client turns the suite red).
- [ ] The repaired create specs still pin the SHY-0029 strict owner bind (a forged/absent `ownerFirebaseUid` remains assert-fails via the existing proxy-ownerId deny spec plus the rule's own default).

### UX
- N/A — no user-facing surface.

### i18n
- N/A — no user-facing strings.

### Observability
- [ ] The PR's CI run shows the `integration-tests / Integration Tests` job GREEN (it runs because `tests/integration/*` flips `INTEGRATION=true`), restoring the gate's signal value.

## BDD Scenarios

**Scenario: the integration gate goes green on the current main tree**
- **Given** the local stack is running (Firebase emulators + Express) on an unmodified main checkout plus this fix
- **When** the full integration suite runs via the canonical Playwright integration config
- **Then** every test passes, including the 4 that previously failed
- **And** the run finishes with exit code 0

**Scenario: a device binding stays private even from its owner**
- **Given** a device binding document exists for a user
- **When** that same user, signed in normally, tries to read their own binding directly from the database
- **Then** the read is refused (bindings are only reachable through the server API)

**Scenario: creating a room works when the app supplies the caller's identity correctly**
- **Given** an adult user signed in with an adult cohort claim
- **When** they create a room tagged adult with their own owner identity fields
- **Then** the room is created successfully

**Scenario: a room create still fails when the cohort is forged, even with correct identity fields**
- **Given** an adult user signed in with an adult cohort claim
- **When** they try to create a room tagged minor while supplying their correct owner identity fields
- **Then** the create is refused for the cohort mismatch alone

## Test Plan

- **RED (evidence, already captured):** CI runs 29479805200 + 29488885639 (`integration-tests` fail on PR #1614's tree) and the local canonical repro on this machine (4 named failures: `07-firestore-rules-enforcement.spec.ts:493`, `10-firestore-cohort-rules.spec.ts:1099/:1115/:1211`; deviceBindings denial `false for 'get' @ L529`, creates denied `false for 'create' @ L223`).
- **GREEN:** edit ONLY `tests/integration/07-firestore-rules-enforcement.spec.ts` (rewrite the owner-read test to assert denial per SHY-0170) and `tests/integration/10-firestore-cohort-rules.spec.ts` (add `ownerFirebaseUid` bound to each authenticated context's uid across the 9 client-create specs); rerun the full integration suite locally → 0 failures.
- **Cross-branch check:** hot-swap develop's `firestore.rules` into the running emulator (reload confirmed in emulator log), rerun the repaired specs → still green; restore main's rules.
- **Frameworks exercised (test-layer diff; no product runtime touched):** Playwright integration suite (canonical config), eslint/prettier on the changed spec files, story validator, `code-reviewer` 100%-clean, CI green by name on the PR.
- **Classification note (superseded by operator directive 2026-07-16 ~17:3x WIB):** operator announced device-return and directed this ticket to DEVELOP with the full develop gauntlet beginning immediately after ("once you push this ticket to develop, begin the gauntlet testing, the devices are available again") — the device-return protocol. This story therefore merges to develop autonomously (develop merge authority) and rides the full end-of-batch device gauntlet with the rest of the develop stack; it reaches main via the post-gauntlet develop→main promotion, which is what heals PR #1614's integration gate.

## Out of Scope

- Widening/narrowing `detect-changes` path filters (`express-api/*` ⇒ `BACKEND=true` currently forces the backend matrix for CI meta-test edits — real overbreadth, its own ticket).
- Any change to `firestore.rules` (both branches' rules are correct and intentional).
- The SHY-0197 pre-push/pre-merge-check work.
- Back-fixing WHY #1541/#1550 merged without this suite red (CI archaeology exhausted; check-run history for those commits is gone).

## Dependencies

- None blocking. PR #1614 (SHY-0195) depends on THIS story to turn its required gate green.

## Risks & Mitigations

- **Risk:** repairing an allow-side spec by flipping it to deny could mask a genuine future regression if the underlying design re-legitimises owner reads. **Mitigation:** the new deny test cites SHY-0170's in-rule documentation; any deliberate re-opening must touch the rule AND the spec together.
- **Risk:** adding `ownerFirebaseUid` to deny-tests could hide the field's own enforcement. **Mitigation:** the proxy-ownerId spec plus the rule's `'' != auth.uid` default keep absent/forged owner fields covered; each deny test now fails for exactly one named cause.
- **Risk:** develop diverges again before back-merge. **Mitigation:** back-merge main→develop immediately after merge per the standing rule.

## Definition of Done

Both spec files repaired; full integration suite green locally on the canonical stack AND the repaired specs green against develop's rules via the bisect swap; eslint/prettier/story-validator clean; `code-reviewer` 100% clean; PR to DEVELOP merged (operator directive 2026-07-16 — device-return protocol; develop PRs have no CI so the local gauntlet + review are the gates); rides the full develop device gauntlet; reaches main via the post-gauntlet promotion, after which PR #1614's integration gate re-runs green.

## Notes

- 2026-07-16 ~17:5x WIB — Filed after full root-cause diagnosis in-session. Trail: #1614's `integration-tests` failed (runs 29479805200 + 29488885639) → local canonical repro on the main-based tree reproduced the exact 4 failures → emulator rules hot-swap bisect (develop's rules; "Rules updated." confirmed twice in emulator log) still failed all 4 → specs stale, not rules. deviceBindings denial pinpointed as `false for 'get' @ L529` (main's deny-all block, SHY-0170); creates denied at `false for 'create' @ L223` (main's strict `ownerFirebaseUid` bind, SHY-0029, "absent → deny" documented in-rule). Blind-spot mechanism: develop PRs run no CI; no backend-flagged PR targeted main between #1550 and #1614. Architect self-validation at filing: spec complete, contracts cited to their owning stories, scope test-only.
- 2026-07-16 ~17:4x WIB — GREEN evidence: full integration suite **136/136, exit 0** on a truly-fresh local stack; repaired specs **5/5 under develop's rules** via the hot-swap bisect (reload confirmed in emulator log), rules restored byte-clean. During verification, two ADDITIONAL pre-existing defects were unearthed and split out to **SHY-0199** (uniqueId counter type-corruption): (a) `local/firebase-emulator-data` persistence (`--import/--export-on-exit`) had preserved a corrupted STRING `counters/uniqueId` ("9009111…1", 31 chars) plus untagged string-uniqueId user docs across restarts — 17 provisionUser-based specs failed locally while CI (import-free) stayed green; wiped the persisted state (regenerable; reseeded on boot) → local matches CI. (b) The corruption mechanism: `test-helpers.js` teardown "restores" the counter from the max-`uniqueId` user doc — Firestore type ordering puts strings after numbers, so one string-uniqueId doc poisons the counter; both `test-helpers.js` AND the PROD signup path (`users.js` — `"…1" < MIN_UNIQUE_ID` string-compare fails open for long strings) then concatenate `+ 1` instead of incrementing. Operator directive received mid-verification: devices are BACK; this ticket routes to develop and the full develop gauntlet begins on merge.
- 2026-07-16 ~17:5x WIB — `code-reviewer` R1 on the retargeted commit: ONE finding — [Minor, pre-existing] the deviceBindings rule's WRITE half (`read, write: if false`) had zero coverage (only read-side tests existed). All six flagged-for-scrutiny areas verified clean by the reviewer against the actual files (all 9 `ownerFirebaseUid`↔authenticatedContext pairs exact; comment accuracy vs the live rule; no coverage lost by the allow→deny flip; deny-side single-cause traced through every AND clause of develop's `isBanned()`-augmented rule; story md fully convention-compliant; no scope creep). Finding closed IN-PR with the reviewer's own prescribed test (`user CANNOT create or overwrite a device binding directly`, :516); per the agent-frugality rule the prescribed 12-line addition was self-verified instead of a fresh agent round: loosened-rule mutant (`if false` → `if request.auth != null`, emulator hot-reload confirmed) flips ALL THREE deviceBindings deny pins RED including the new write test; rule restored byte-clean; full suite **137/137 exit 0**.

Reviewed-up-to: 3b44241ae77

