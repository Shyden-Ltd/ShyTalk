# Manual QA — journey-based Gherkin test plan

This directory is the source of truth for the `/manual-qa` skill. The primary axis is **user journey × persona**, not feature slice. A journey threads multiple features end-to-end with explicit cross-platform handoffs, asserting Firestore + UI on every step.

## Files

| File | Purpose |
|---|---|
| `_personas.md` | Persona catalogue (P-01 .. P-19) with stable identities, devices, and used-by matrix |
| `_platform-handoffs.md` | Cross-platform vocabulary (`On <platform>:`, `Then within Xms <persona>'s <platform> UI...`) |
| `j01-adult-new-day-one.feature` | Adam — fresh adult signup → legal → age verification → first gift |
| `j02-minor-new-restricted.feature` | Mia — minor signup → restricted UX → same-cohort follow → cross-cohort 404 |
| `j03-lapsed-returning.feature` | Lena — 45-day lapse → forced re-acceptance → streak reset (German locale) |
| `j04-dob-mismatch-flip.feature` | Hayato — admin downgrades cohort to minor after ID review → cascade |
| `j05-alice-monetization.feature` | Alice — IAP → gacha → gift → leaderboard climb |
| `j06-iap-failure-and-recovery.feature` | Alice — receipt replay, network drop, invalid receipt, refund |
| `j07-discovery-follow-pm.feature` | Adam → Alice — discover → follow → PM → reply round-trip |
| `j08-cross-cohort-wall.feature` | Vexa — every adult→minor surface returns 404 with audit |
| `j09-voice-room-host.feature` | Theo — create room, multi-platform joiners, seat queue, kick, close |
| `j10-mid-room-warning.feature` | Theo seated with mic — admin warns → mic mutes → warning screen → ack |
| `j11-harassment-moderation-cycle.feature` | Raul/Nora — offensive PM → report → warn → re-offend → suspend → appeal → lift |
| `j12-admin-daily-routine.feature` | Greta — full admin queue: reports, age verification, appeals, economy, device ban, audit |
| `j13-locales-rtl-cjk.feature` | Layla (ar) + Kenji (ja) — full flow with RTL + CJK glyph rendering |
| `j14-low-bandwidth-degraded.feature` | Ines — Slow 3G + 30% loss → reconnect, queue, retry, skeletons |
| `j15-mc-performance.feature` | Selma (MC_SINGER) — singing room with live gifts, animations, earnings tally |
| `j16-event-host-team-leader.feature` | Tariq (MC_EVENT_HOST) — multi-singer event with roster, seat rotation, event summary |
| `j17-teacher-classroom.feature` | Bao (TEACHER) + Yuki (student) — Mandarin lesson, voice, tip, rate |
| `j18-official-system-pms.feature` | Officia (SHYTALK_OFFICIAL) — system PMs, locale rendering, cohort exemption, unblockable |
| `j19-osa-migration-regression.feature` | OSA #17 migration steady-state guards — followingIds, mixed rooms, frozen convos, idempotency |
| `_osa17-coverage-matrix.md` | OSA #17 prod-readiness coverage matrix — PR × behavior × covering scenario × status |
| `manual-verification-ledger.json` | Human sign-off ledger for `@manual` scenarios (file-hash + commit-SHA + 30-day expiry) |
| `manual-verification-ledger.schema.json` | JSON Schema for the ledger |
| `steps/` | Step library — implementation of Given/When/Then phrases |

## Provisioning the persona accounts

Stable personas (P-02..P-19) live on the dev Firebase project. Run the provisioner once before any journey loop:

```sh
# On the operator machine
export PERSONAS_PASSWORD=$(openssl rand -base64 24)
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13 \
  "cd /home/ubuntu/express-api && PERSONAS_PASSWORD='$PERSONAS_PASSWORD' \
   node -r dotenv/config scripts/provision-test-personas.js"
# Save the password
mkdir -p ~/.shytalk && echo "PERSONAS_PASSWORD=$PERSONAS_PASSWORD" >> ~/.shytalk/dev-personas-credentials
chmod 600 ~/.shytalk/dev-personas-credentials
```

Idempotent — re-running upserts. Ephemeral personas (P-01 Adam, P-03 Mia) are created inside scenarios that exercise signup.

## Authoring rules

1. **Persona-first.** Every `Given/When/Then` step that involves a UI action MUST name the persona AND the platform: `When Adam on Android taps...`. No bare `When the user taps...`. The runner needs to know which device to drive.
2. **State + UI on mutations.** Every `When` that mutates state has a pair: `Then within Xms the database has document...` AND `Then within Xms <persona>'s <platform> UI shows...`. Both must hold.
3. **Cross-platform propagation explicit.** When persona A's action should affect persona B's screen, write the assertion against B's platform: `Then within 5000ms Alice's Web UI shows...`.
4. **Edge scenarios live next to the canonical journey.** A scenario block per edge. The runner reports per-scenario.
5. **Tag the matrix.** `@browser-chromium / @browser-firefox / @browser-webkit / @android-emulator / @android-physical / @ios-sim / @ios-device` so the runner knows which driver matrix to expand.
6. **`@blocker` marks shipping gates.** A failing `@blocker` scenario prevents the loop from declaring zero-findings.
7. **`@manual` marks human-only steps.** Each must have a ledger entry to count toward shipping (see `SKILL.md` § Manual verification ledger).

## Tag taxonomy

### Platform pickers
- `@android-emulator` — Pixel_API_34 AVD
- `@android-physical` — OnePlus CPH2653 over wifi-adb
- `@ios-sim` — iPhone 15 Pro Simulator
- `@ios-device` — physical iPhone (manual)
- `@browser-chromium` / `@browser-firefox` / `@browser-webkit`

### Severity hints
- `@blocker` — failure prevents shipping; auto-classify as Blocker severity
- `@manual` — non-automatable, requires ledger sign-off

### Coverage axes
- `@cross-cohort` — UK OSA cohort gate enforcement
- `@locale-rtl` / `@locale-cjk` — locale rendering
- `@concurrency` — multi-device or multi-tab race
- `@persistence` — survives kill/relaunch/reinstall
- `@perf-budget:<ms>` — performance assertion

## Coverage matrices

Two derived matrices live in `_personas.md`:
1. **Persona × Journey** — which persona participates in which journey
2. **Journey × Platform** — which platforms participate in which journey

A journey is incomplete if its declared platforms each don't make at least one assertion.

## Step library

`steps/` files (`shared-steps.md`, `web-steps.md`, `android-steps.md`, `ios-steps.md`, `firestore-steps.md`, `manual-steps.md`) define phrase → driver bindings. Adding a new phrase = append to the appropriate file.

## How `/manual-qa` consumes this directory

1. Validates the personas exist on the dev environment (calls `/api/admin/users/{uniqueId}` for each stable persona).
2. Reads every `j*.feature` file.
3. For each Scenario:
   - Expands platform-matrix tags into runs.
   - Drives each platform via its step bindings (Playwright MCP / adb / simctl / Firebase Admin REST).
   - On `@manual` steps, prompts the operator (interactive) or fails the scenario (autonomous, unless a fresh ledger entry exists).
4. Surfaces findings classified Blocker / Major / Minor / Polish.
5. Loops until **zero findings of any severity**.
