---
id: EPIC-0011
status: Draft
owner: claude
created: 2026-08-17
priority: P1
title: Server-driven UI — change look, menus, options and copy without a store release
child_shys: [SHY-0310, SHY-0311, SHY-0312, SHY-0313, SHY-0314, SHY-0315, SHY-0316, SHY-0317, SHY-0318, SHY-0319, SHY-0320]
---

# EPIC-0011: Server-driven UI (Phase 1 — manifest pipeline + config layer)

## Vision

Any change to the app's look, menus, navigation, options or copy reaches users
in **minutes, not days** — because it is a document the server sends, not code
in a binary someone has to review.

Today every visual change costs a build, a store submission and 1–7 days of
review, with no ability to correct a mistake inside that window. For a product
that expects to iterate continuously on look and options right through launch,
that is the wrong cost curve; and for a mistake already live in front of users
it is a genuinely bad failure mode.

The operator's framing was **"as much as we possibly can without causing major
issues"** — so this EPIC maximises reach and spends its whole complexity budget
on bounding the blast radius rather than on narrowing scope. Concretely: the
server may change anything that **fails visibly**, and may not touch the five
screens that **fail silently and permissively**.

Phase 1 delivers the pipeline and the config layer. Phase 2 (its own EPIC,
raised when this one closes) adds a layout renderer for remotely-composed
screens. Phase 1 is not a smaller Phase 2 — it is the first half of it, so
nothing built here is rewritten there.

**Design:** `.project/plans/2026-08-17-server-driven-ui-design.md`
**Plan:** `.project/plans/2026-08-17-server-driven-ui-phase1-plan.md`

## Scope

Eleven 1-SHY-1-PR vertical slices. **All `mvp: true`.**

| #   | Child SHY    | Slice                                                          | Effort |
| --- | ------------ | -------------------------------------------------------------- | ------ |
| 1   | **SHY-0310** | Manifest schema + shared data model + fail-safe parser         | M      |
| 2   | **SHY-0311** | Sealed-screen registry + the CI test that enforces it          | S      |
| 3   | **SHY-0312** | `GET /api/ui-manifest` — cohort-resolved, ETag/304, App Check   | M      |
| 4   | **SHY-0313** | Client three-tier resolution: remote → cache → bundled          | L      |
| 5   | **SHY-0314** | Navigation + menus driven by the manifest                       | L      |
| 6   | **SHY-0315** | Feature flags — client hides the entrance, API refuses the call | M      |
| 7   | **SHY-0316** | Server-served copy, validated across all 20 locales             | M      |
| 8   | **SHY-0317** | Staged rollout + rollback, including a rollback drill           | M      |
| 9   | **SHY-0318** | Publishing pipeline — `manifests/` in repo, validated in CI      | M      |
| 10  | **SHY-0319** | Admin UI — curated forms, committing through the git pipeline    | L      |
| 11  | **SHY-0320** | _Spike:_ count the hard-coded colour/dimension debt             | S      |

**Hard dependency gate: EPIC-0004 lands first.** Its cold-start rewrite is
where SHY-0313's three-tier resolution belongs — that work is already making
cold start optimistic and resolving state before routing. Starting this EPIC
first would mean designing cold start twice and then reconciling two designs.

**Ordering:** 1 → 2 (seal the boundary before anything can cross it) → 3 → 4,
then 5/6/7 in any order (WIP=1 makes them sequential in practice), with 8, 9
and 10 following 3. The spike (11) is independent and may run at any time.

**Sealed from the manifest, permanently:** ban/suspension, App-Lock, cohort
segregation, unsafe-device, account deletion. Held by a CI test, not by
convention.

## Child SHYs

**Foundation:**

- **SHY-0310** (P1, M, feature) — Manifest schema, shared model, fail-safe parser. Pure types, fully testable in `commonTest`. Status: Draft.
- **SHY-0311** (P1, S, feature) — Sealed-screen registry + CI enforcement. **The safety floor; lands before any consumer.** Status: Draft.

**Delivery:**

- **SHY-0312** (P1, M, feature) — The endpoint: cohort-resolved document, ETag/304, pre-auth variant attested by App Check. Status: Draft.
- **SHY-0313** (P1, L, feature) — Client three-tier resolution; never blocks first paint. Status: Draft.

**Config layer:**

- **SHY-0314** (P1, L, feature) — Manifest-driven navigation + menus, with an icon registry that skips unknowns. Status: Draft.
- **SHY-0315** (P1, M, feature) — Feature flags, paired with server-side refusal. Status: Draft.
- **SHY-0316** (P1, M, feature) — Server-served copy validated across all 20 locales. Status: Draft.

**Operations:**

- **SHY-0317** (P1, M, feature) — Staged rollout, rollback, and a rollback drill. Status: Draft.
- **SHY-0318** (P1, M, infra) — Git-backed publishing pipeline + CI validation. Status: Draft.
- **SHY-0319** (P1, L, feature) — Admin UI, curated forms only. Status: Draft.

**Investigation:**

- **SHY-0320** (P1, S, spike) — Count the theming debt; file the implementation story with a real number. Status: Draft.

> SHY-0311 is the security keystone and deliberately lands second — a sealed
> boundary added after consumers exist is a boundary that has already been
> crossed. SHY-0315 ships both halves in one PR on purpose: a client-side flag
> without a matching server refusal is theatre, since a modified client simply
> does not honour it. SHY-0320 is a spike and files its own follow-up rather
> than pre-declaring an effort it cannot honestly know.

## DoD at Epic Level

- [ ] **The acceptance test for the whole EPIC:** an operator edits a manifest, and a **real Android device and a real iPhone** both show the change **without a reinstall** — proven on the journey runner, not asserted.
- [ ] **SHY-0310:** a malformed manifest degrades per-section to bundled defaults; a manifest failing top-level validation is discarded whole and the previous good one retained; neither crashes nor blanks the UI.
- [ ] **SHY-0311:** a CI test fails the build if any manifest key resolves to a sealed screen; the test is proven by a deliberately-crossing fixture, not merely present.
- [ ] **SHY-0312:** the endpoint serves cohort-correct documents; a repeat request with `If-None-Match` returns `304` with no body; the pre-auth variant is refused without a valid App Check token.
- [ ] **SHY-0313:** the app is **fully usable having never reached the server** — first launch and airplane mode, radio genuinely off; cold start paints without waiting on the fetch; a manifest arriving later applies without a restart.
- [ ] **SHY-0314:** menu and nav items add, remove, reorder and re-label from the server; an unknown icon name is skipped rather than drawn blank; `visibleIf` respects feature and cohort.
- [ ] **SHY-0315:** a disabled feature is both hidden client-side **and** refused by the API with a real status code; a modified client that ignores the flag still cannot reach it.
- [ ] **SHY-0316:** a server-supplied string overrides the bundled one in all 20 locales; a manifest referencing a key missing from any locale **fails to publish**.
- [ ] **SHY-0317:** a manifest reaches only its rollout percentage, bucketed stably per user across launches; the **rollback drill has actually been executed** and recovery proven.
- [ ] **SHY-0318:** `manifests/` is the committed source of truth; `scripts/validate-manifests.sh` runs in `lint.yml`; an invalid manifest cannot merge.
- [ ] **SHY-0319:** an admin edit produces a real App-signed commit with a reviewable diff; no raw-JSON editing surface exists.
- [ ] **SHY-0320:** the hard-coded colour/dimension count is recorded in Notes and the theming implementation story is filed with a real effort.
- [ ] Every child SHY satisfies the Pre-Merge Testing Protocol and reaches `Done` on its release cut. **All eleven are `mvp: true`.**

## Notes (running log)

- **2026-08-17** — EPIC raised. Operator directive: *"all the visual, menus, options etc. as much as we can, should be downloaded via an online server, to allow us to make any change to the app we want and it appear without needing to release a new update to the play or apple stores… should be mvp."*
- **2026-08-17** — Six decisions locked in the brainstorming session; recorded in full in the design doc §1. Headlines: Phase 2 via Phase 1; git **and** admin UI from the start sharing one pipeline; five screens sealed; server-side enforcement is the real control; gacha age gate removed but cohort segregation kept; **EPIC-0004 first**.
- **2026-08-17** — Server-side enforcement **audited rather than assumed**. Suspension + ban are already checked on every authenticated request in both auth paths (`authMiddleware:175`, `authMiddlewareStrict:311`); auth is deny-by-default at `index.js:117` behind a unit-tested skip allowlist; cohort has 23 `requireSameCohort` call sites. The appeal / GDPR-export / ban-screen exemptions (`isBanExemptPath:297`) are deliberate and correct — a gate that also blocks the appeal is a gate with no exit.
- **2026-08-17** — One real gap found and filed as **SHY-0321**: App Check is enforced only on unauthenticated routes (`requiresAppCheck` sits inside the `skipsAuth` branch at `index.js:129`), so authenticated routes accept any valid Firebase ID token — which a modified build signed into a genuine account holds legitimately. Independent of this EPIC, but SDUI raises its value.
- **2026-08-17** — Open questions resolved on operator instruction: web joins in Phase 2, not Phase 1; the theming debt gets a counting spike before its story is sized; the admin UI is curated forms, never a raw JSON editor.
