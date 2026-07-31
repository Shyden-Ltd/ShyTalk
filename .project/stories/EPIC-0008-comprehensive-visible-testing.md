---
id: EPIC-0008
status: Draft
owner: claude
created: 2026-07-19
priority: P0
title: Comprehensive, self-serve, publicly-visible testing — every kind of test, one command, public health page
child_shys: [SHY-0212, SHY-0213, SHY-0214, SHY-0215, SHY-0216, SHY-0217, SHY-0218, SHY-0219, SHY-0220, SHY-0221, SHY-0222, SHY-0223, SHY-0224, SHY-0225]
---

# EPIC-0008: Comprehensive, self-serve, publicly-visible testing

## Vision

ShyTalk proves — to itself **and to the public** — that it is safe and working, across **every meaningful kind of testing**, with results anyone can run and anyone can read.

Three pillars, all hard MVP-launch blockers (operator 2026-07-19, "the entire epic is a hard blocker, extremely critical — if this is wrong it puts the entire project at risk"):

1. **Breadth** — beyond the functional tests we already have, the app is covered by the test *types* it currently lacks: accessibility, performance/load, visual regression, mutation, deepened security (DAST + Swift SAST + entropy secret-scan + license), client↔API contract, a cohesive compliance suite (GDPR + UK OSA + age-gating), fuzz/property, i18n/localization, PII-leak/log-privacy, synthetic uptime, and chaos/resilience. Every new framework is **real-only** (per [[EPIC-0003]] policy) — doubles only in unit locations.
2. **Self-serve** — every framework runs from **one documented human command**, a single top-level **"run everything"** command runs the whole suite, and **CI** runs them automatically. Each has a plain-English README a non-engineer can follow. No framework requires Claude to trigger it.
3. **Public transparency** — results are published on the public site as a **plain-language health page** (simple safety/health summary on top — *Safety, Sign-in, Voice rooms, Messaging, Payments* as green/amber/red with "last checked" + trend — and an expandable detail section below). Non-technical language, $0 hosting. The reporting engine is chosen deliberately (Allure re-evaluated).

**Boundary vs [[EPIC-0003]]:** EPIC-0003 makes the *existing* ~300 mock-using tests **real** (no stubs) and the manual-QA matrix operational. EPIC-0008 adds the *missing kinds* of testing + self-serve execution + public reporting. Complementary, not overlapping; EPIC-0008's new frameworks adopt EPIC-0003's real-only rule from birth.

## Scope

Grounded in the evidence audit `.project/audit/2026-07-19-testing-frameworks-audit.md` (verified against source, not docs). In scope: the 12 confirmed gaps + the self-serve runner/docs + the public reporting page. **Out of scope:** migrating existing mock tests to real (that is EPIC-0003); re-architecting `manual-qa-runner.js`; net-new product features. Each gap is one fully-refined child SHY (1 story = 1 PR), each delivering: the framework itself (real-only), a human run-command + top-level aggregate-runner hook + CI wiring, a plain-English README, and a `metadata.json`-shaped result feed for the public page.

## Child SHYs

- **SHY-0212** — Framework audit remediation + **one-command aggregate runner** + per-framework plain-English READMEs (self-serve foundation; makes every existing + new framework runnable without Claude).
- **SHY-0213** — **Accessibility (a11y)** testing — web (axe-core), Android, iOS.
- **SHY-0214** — **Performance / load** testing — API + LiveKit voice + web (Lighthouse) + mobile cold-start.
- **SHY-0215** — **Visual regression** testing — web + Android + iOS.
- **SHY-0216** — **Mutation** testing — JS (Stryker) + Kotlin (Pitest); coverage-quality gate.
- **SHY-0217** — **Security deepening** — DAST (OWASP ZAP) + Swift/iOS SAST + entropy secret-scan (gitleaks) + dependency-license compliance.
- **SHY-0218** — **Contract** testing — client↔Express-API schema (the single backend chokepoint).
- **SHY-0219** — **Compliance** suite — GDPR (export/delete) + UK Online Safety Act + age-gating, as a cohesive labelled framework.
- **SHY-0220** — **Public health-report page** + reporting-engine decision (Allure vs alternatives) — plain-language, simple-top/detail-below, $0.
- **SHY-0221** — **Fuzz / property** testing — API inputs + parsers.
- **SHY-0222** — **i18n / localization** testing — missing-key build gate, pseudo-localization, RTL, the 5 active locales.
- **SHY-0223** — **PII-leak / log-privacy** testing — no secrets/PII in logs or public reports.
- **SHY-0224** — **Synthetic / uptime** monitoring — post-deploy plain-language health signal feeding the public page.
- **SHY-0225** — **Chaos / resilience** testing — dependency-failure + degraded-network behaviour.

Each is fully-refined at creation ([[feedback-no-skeleton-stories-fully-refined]]); XL areas sub-split into 1-SHY-1-PR slices at pickup.

## DoD at Epic Level

- [ ] Every one of the 12 audited gaps has a shipped framework, **real-only**, green in CI.
- [ ] A single top-level command runs the entire suite; every framework also has its own documented one-line human command; **none require Claude to trigger**.
- [ ] Every framework has a plain-English README (what it checks, how to run it, how to read the result).
- [ ] The public site hosts a **plain-language health page** (simple-top / detail-below), $0-hosted, fed from live results, jargon-free — reviewed for non-technical readability.
- [ ] The reporting-engine decision (Allure vs alternative) is recorded with rationale.
- [ ] Every child SHY satisfies the Pre-Merge Testing Protocol and is Done (`released_in:` set).
- [ ] No new in-process doubles outside unit locations (the [[EPIC-0003]] ratchet stays green).

## Notes

- 2026-07-19 — Filed on operator directive: "required for MVP… have a look at all our testing frameworks today, find gaps, introduce new frameworks if suitable, remove low-value ones… all kinds (security, compliance, accessibility etc.)… easily executed without using Claude… easy README instructions… publish results for the public… a page on our public site… less jargon." Scoping resolved via AskUserQuestion: audit→EPIC+refined stories (no impl today beyond the audit); per-framework cmd + one-command-all + CI; **all** listed types + the extras I proposed; evaluate Allure + recommend; **entire epic is a hard MVP blocker**; public page simple-top/detail-below; **distinct EPIC-0008, cross-referenced to [[EPIC-0003]]**. Evidence audit written first (`.project/audit/2026-07-19-testing-frameworks-audit.md`) — corrected 3 of my own priors (security/rules/age-verif are NOT gaps).
- 2026-07-19 — `priority: P0` reflects the operator's "extremely critical / entire project at risk" framing; revisit if it should sit behind another P0.
- 2026-07-20 — **Filed (spec-only) + architect-reviewed.** PR #1628 merged all 14 child stories + this epic + the audit to `develop`. `feature-dev:code-architect` batch-validated the specs: verdict APPROVE-WITH-CHANGES. Fixes applied as a follow-up refinement PR (`story/EPIC-0008-spec-refinements`): **CRITICAL 1** — extended SHY-0212's registry/metadata contract (optional `details` object + canonical `test-results/trends/<id>.jsonl` trend store + resolved `publicArea`→five-card mapping incl. a populated Payments card + new `mac`/`live` categories); SHY-0220 updated to consume it. **CRITICAL 2** — SHY-0215 duplicated the pre-existing SHY-0179 (Roborazzi Compose screenshots); reconciled by superseding SHY-0179 (now Cancelled) and folding its PreviewWatermark safe-area regression into 0215's `visual-compose`. Importants applied: 0213/0215 Arabic→pseudo-RTL (ar not active); 0213 "zero a11y" + 0222 "nothing gates i18n" reworded to "no *systematic* tooling / extends existing"; 0216 mutation scoped to fast host units (not emulator routes); 0217 named `semgrep` as the $0 Swift-SAST fallback; 0219 erasure DoD qualified "per stated policy, not legal cert".
- 2026-07-20 — **iOS device-lane caveat (architect cross-cutting #4, epic-level):** the "one command, no Claude, green in CI" promise is weakest for the iOS lanes of SHY-0213/0214/0215/0225 — real-iPhone XCUITest/Appium is operator-gated (WDA) and full iOS-Appium journey coverage is still **SHY-0095 (Draft, EPIC-0003)**. These stories legitimately *require* real iOS, but their iOS lane **depends on SHY-0095/EPIC-0003** landing; pickup order should respect that. Also: 0216 (mutation) + 0218 (contract) build on EPIC-0003's real-emulator suite migration — EPIC-0003's "sole focus" status means those two sequence after the relevant EPIC-0003 drains.
- 2026-07-20 — **Operator decision (AskUserQuestion):** keep ALL 14 children as **P0 MVP launch-blockers** (no re-tiering to post-launch fast-follow) — matches the original "the entire epic is a hard blocker." The long serialized critical path under WIP=1 is accepted; sequencing respects the iOS/EPIC-0003 dependencies above.
