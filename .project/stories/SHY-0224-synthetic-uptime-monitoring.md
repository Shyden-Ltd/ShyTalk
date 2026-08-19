---
id: SHY-0224
status: Draft
owner: claude
created: 2026-07-19
priority: P0
effort: M
type: infra
roadmap_ids: []
epic: EPIC-0008
mvp: true
pr:
---

# SHY-0224: Synthetic / uptime monitoring — live real-journey probes feeding the public health signal

## User Story

As the operator (and as a visitor to the public health page), I want lightweight real user-journey probes to run against the live environments on a schedule and produce a plain-language "is it actually up right now?" signal, so that an outage or a broken sign-in/room/message flow is detected within minutes and shown honestly on the public page — not discovered when a user complains.

## Why

The audit listed **synthetic / uptime** monitoring as a gap: nothing checks the *live* app post-deploy, so SHY-0220's page would only ever reflect the *last CI run*, not current reality. Synthetic monitoring closes that — small real journeys (sign-in, room list, join, message) run against live dev/prod and emit a fresh health signal. It is inherently periodic, so it is the **one deliberate, justified scheduled exception** to the event-driven preference ([[feedback-avoid-crons-prefer-event-driven]]) — mirroring the already-accepted `cron-account-deletion.yml` — kept minimal-interval + $0 (a scheduled GitHub Actions job, no external SaaS) + non-destructive. It registers into SHY-0212's runner and upgrades SHY-0220 from "last tested" to "live now ✓".

## Acceptance Criteria

### Happy path

- [ ] A **synthetic probe suite** runs a small set of REAL user journeys against a live environment — sign-in (dedicated synthetic account), room-list load, join a room, send + receive a message — asserting each completes within a latency budget. Registered `synthetic-uptime` with SHY-0212's **`live`** category (schedule-driven, deployed-environment; excluded from `run-all` profiles, reported into the health page's live section), `publicArea: Cross-cutting`.
- [ ] A **scheduled GitHub Actions workflow** (`.github/workflows/synthetic-monitor.yml`) runs the probes at a documented, quota-respecting interval against dev (and optionally prod with the dedicated synthetic account) — the deliberate, justified cron exception, documented as such.
- [ ] On each run it writes a fresh live signal (per-journey pass/fail + latency + timestamp) into the SHY-0220 feed (`public/health-data.json` "live" section) so the public page shows current status + "last checked N minutes ago".
- [ ] On failure it raises an operator signal (a GitHub issue and/or a PushNotification per [[feedback-sound-notify-when-interaction-needed]]) so an outage is actioned, not just recorded. **Any alert issue must be distinguishable from a `story`-labelled story-issue and must NOT be swept by the SHY-0082 board sync** (which deletes label families repo-wide + manages `story`-labelled issues each run) — use a distinct label (e.g. `uptime-alert`) so alerts survive.
- [ ] Registers into `scripts/test/framework-registry.mjs`, emits normalized `metadata.json` (SHY-0212 contract), and `docs/testing/synthetic-uptime.md` explains in plain language what "live now" means + the schedule + the non-destructive guarantees.

### Error paths

- [ ] A live sign-in/room/message failure FAILS `synthetic-uptime` naming the journey + step + environment, and flips the corresponding public-page area to red.
- [ ] A latency breach (journey slower than budget) is reported as a degraded (amber) signal, distinct from a hard failure (red).
- [ ] A probe that can't reach the environment at all reports the environment as down (red) with the reachability error — never a false green ([[feedback-environmental-is-not-a-diagnosis]]).
- [ ] A transient single-run blip vs a sustained outage is distinguished (e.g. N-consecutive-failures before hard-red) to avoid alert noise while never hiding a real outage.

### Edge cases

- [ ] **Non-destructive:** prod probes use a dedicated synthetic account, are rate-limited, and clean up any created state (leave the room, delete the test message) — a probe never pollutes real user data or real rooms.
- [ ] The probe account is clearly marked synthetic and excluded from real analytics/moderation stats.
- [ ] If a deploy is mid-flight, the probe distinguishes "deploying" from "down" where the environment exposes that, avoiding a false outage during a known rollout.
- [ ] The schedule is minimal-interval (quota-aware on the free tier) with the interval documented + justified; a `lazy-replace` grace is honored if the schedule changes ([[feedback-lazy-replace-cron-preserve-grace]]).
- [ ] Secrets (the synthetic account credential) are sourced from repo secrets / `~/.shytalk/*.env`, never committed/logged.

### Performance

- [ ] Each probe run is small + time-bounded (registry `timeoutMs`) so it fits well within Actions minutes + free-tier quota.
- [ ] Probes are rate-aware against the live API ([[feedback-api-rate-limit-awareness]]) and do not themselves load the environment.

### Security

- [ ] Probes authenticate through the REAL auth path (no bypass) and touch backend only via the Express API ([[feedback-no-direct-backend-all-via-api]]) — they exercise the same chokepoint real users do.
- [ ] The synthetic account has least-privilege; its credential is a secret; probe logs redact it (ties SHY-0223).
- [ ] The live signal published to the public page is status/latency only — no PII, no account detail (belt with SHY-0223).

### UX

- [ ] Failure/alert output is plain: "Sign-in on dev is failing as of 14:32 — the login step timed out." Not a raw journey-step code.
- [ ] `docs/testing/synthetic-uptime.md` explains the live-status concept, the schedule, the non-destructive guarantees, and how to run a probe on-demand locally.

### i18n

- [ ] N/A for the probe mechanics; the **public-facing** "live now / last checked" labels it feeds are localized by SHY-0220 across the 4 active locales.

### Observability

- [ ] `metadata.json` + the live feed record per-journey pass/fail + latency + timestamp per environment, driving SHY-0220's live signal + freshness.
- [ ] Probe runs are logged with `[framework:synthetic-uptime]` + environment + journey, greppable in the workflow.
- [ ] An uptime/latency trend (last N runs) is retained so the public page can show a simple availability trend.

## BDD Scenarios

**Scenario: A live sign-in outage is detected and shown red**
- **Given** sign-in is failing on dev
- **When** the scheduled synthetic probe runs
- **Then** `synthetic-uptime` fails naming the sign-in journey + environment
- **And** the public health page's Sign-in area flips to red with a recent timestamp
- **And** an operator signal (issue/notification) is raised

**Scenario: A latency degradation is amber, not red**
- **Given** the room-join journey is slow but succeeds
- **When** the probe runs
- **Then** it reports a degraded (amber) signal, distinct from a hard failure

**Scenario: Probes are non-destructive on prod**
- **Given** a prod probe joins a room and sends a message with the synthetic account
- **When** the probe finishes
- **Then** it leaves the room and removes the test message
- **And** no real user data or room is polluted

**Scenario: A transient blip does not spam alerts**
- **Given** a single failed run followed by successes
- **When** the failure-threshold logic evaluates
- **Then** it does not hard-red/alert on a single blip, but DOES on sustained failure

**Scenario: Unreachable environment is red, not falsely green**
- **Given** the live environment is unreachable
- **When** the probe runs
- **Then** it reports the environment down (red) with the reachability error

**Scenario: Live signal reaches the public page**
- **Given** a completed probe cycle
- **When** SHY-0220's page reads the live section of the feed
- **Then** it shows current status + "last checked N minutes ago" per area

## Test Plan

**Classification:** real-only against live environments (the whole point — synthetic monitoring of a mock is meaningless). The probe journeys run the REAL app flows against live dev/prod via the real API with a real synthetic account. Host-runnable unit portion: the failure-threshold/aggregation logic + the live-feed writer + the non-destructive-cleanup verifier (fixture-based).

### Red — write failing tests first

- `express-api/tests/synthetic/probe-journeys.test.js` (run against the real stack/dev) — `it('sign-in journey completes within budget')`, `it('join+message journey completes')`, `it('reports red when a journey fails')`, `it('reports amber on latency breach')`, `it('reports red when environment unreachable')`.
- `express-api/tests/synthetic/non-destructive.test.js` — `it('cleans up created room membership + test message')`, `it('uses the dedicated synthetic account')`.
- `express-api/tests/synthetic/threshold.test.js` — `it('does not alert on a single blip')`, `it('alerts on N-consecutive failures')`.
- Workflow meta-test: `it('synthetic-monitor.yml runs on a minimal documented schedule')`, `it('feeds the live section of health-data.json')`.

### Green — implement

1. Build the probe journeys (reusing journey/persona infra) + the dedicated synthetic account provisioning.
2. Build the failure-threshold + live-feed writer + operator-alert path (issue/notification).
3. Add `.github/workflows/synthetic-monitor.yml` (minimal schedule, quota-aware, documented exception).
4. Register `synthetic-uptime`; write `docs/testing/synthetic-uptime.md`; wire the live signal into the SHY-0220 feed.
5. Prove non-destructive cleanup on prod before enabling prod probes.

### Gauntlet

Touches backend probe paths + a scheduled workflow. CI-config-plus-backend-probe: the FULL relevant gauntlet for the probe journeys (real dev environment), the workflow linted (actionlint), non-destructive cleanup proven, `code-reviewer` 100% clean. Prod probing enabled only after the non-destructive guarantee is proven on dev + prod.

## Out of Scope

- Full external APM / RUM (real-user monitoring) — this is synthetic (our own probes), not user telemetry.
- Paid uptime services / external status-page SaaS ($0 + no-external-dep constraint) — the scheduled workflow + SHY-0220 page are the $0 solution.
- Deep performance profiling (SHY-0214 owns budgets); synthetic just checks live liveness + gross latency.
- The public page rendering itself — SHY-0220 (this story feeds its live section).

## Dependencies

- **Blocks:** SHY-0220's *live* signal (upgrades it from last-CI-run to live-now).
- **Blocked by:** SHY-0212 (registry/runner/docs/metadata + the health-feed shape). Uses the existing journey/persona infra + live dev/prod environments.
- **Tooling:** GitHub Actions scheduled workflow ($0 on public repo); existing journey runner; a dedicated synthetic account. All $0.

## Risks & Mitigations

- **Risk:** A cron creeps in against the event-driven preference. **Mitigation:** This is a **deliberate, documented, justified** exception (uptime is inherently periodic; mirrors `cron-account-deletion.yml`), minimal-interval + quota-aware; the story records the rationale ([[feedback-avoid-crons-prefer-event-driven]], [[feedback-lazy-replace-cron-preserve-grace]]).
- **Risk:** Prod probes pollute real data. **Mitigation:** Dedicated synthetic account, rate-limited, guaranteed cleanup, excluded from stats; cleanup proven before prod enablement.
- **Risk:** Alert noise from transient blips. **Mitigation:** N-consecutive-failure threshold before hard-red/alert, while never hiding sustained outages.
- **Risk:** Free-tier quota burn. **Mitigation:** Small probes, minimal interval, time-bounded, rate-aware.
- **Risk:** Synthetic credential leak. **Mitigation:** Secret-sourced, least-privilege, redacted in logs (SHY-0223); never committed.
- **Risk:** False green when the env is merely reachable but broken. **Mitigation:** Probes assert real journey COMPLETION, not just a port/health-ping ([[feedback-environmental-is-not-a-diagnosis]]).

## Definition of Done

- [ ] All AC boxes across the 8 dimensions checked.
- [ ] `synthetic-uptime` green: real sign-in/room/message journeys against live dev pass within budget; failure/latency/unreachable states report correctly; non-destructive cleanup proven.
- [ ] Scheduled workflow live (minimal, documented, justified exception); feeds SHY-0220's live signal; raises an operator alert on sustained failure.
- [ ] Registered; `docs/testing/synthetic-uptime.md` present + plain-language; `metadata.json` + live feed emitted.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to:` recorded; status `In Review`; `pre-merge-check.sh` OK.
- [ ] Branch `story/SHY-0224-synthetic-uptime-monitoring`; PR title `SHY-0224: Synthetic / uptime monitoring — live real-journey probes`; relevant gauntlet passed; `released_in:` at release.

## Notes

- 2026-07-19 — Created as an EPIC-0008 child (operator: synthetic/uptime candidate). The ONE deliberate, justified scheduled exception (uptime is inherently periodic; mirrors the accepted `cron-account-deletion.yml`), kept minimal + $0 + non-destructive. Upgrades SHY-0220 from "last tested" to "live now". Probes assert real journey completion (not a port ping) so a reachable-but-broken env is caught. Dedicated synthetic account, guaranteed cleanup, secret-sourced credential.
