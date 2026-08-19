---
id: SHY-0327
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: S
type: chore
roadmap_ids: []
mvp: true
---

# SHY-0327: The "2 critical, 12 high" security banner is mostly the un-promoted `main`, and the fix is the promotion

## User Story

As the **operator**, I want the 19 Dependabot alerts triaged against what is
actually deployed, so that the real exposure is fixed before launch and the
banner stops crying wolf on every push.

## Why

Every `git push` prints:

> `GitHub found 19 vulnerabilities on Shyden-Ltd/ShyTalk's default branch (2 critical, 12 high, 4 moderate, 1 low)`

Triaged 2026-08-17 against the actual dependency graph rather than the headline.
**Most of it is already fixed on develop and unfixed only on `main`**, because
Dependabot evaluates the **default branch** and `main` is **43 commits behind
develop**.

Measured, both criticals and the largest high cluster:

| package | `main` | `develop` | advisory range | verdict |
| --- | --- | --- | --- | --- |
| `websocket-driver` | **0.7.4** | **0.7.5** | `< 0.7.5` | fixed on develop |
| `brace-expansion` | **5.0.6** | **5.0.9** | `< 5.0.9` | fixed on develop |
| `js-yaml` | 4.2.0 | 4.2.0 | GHSA-5p4m-2wfm-xmqj | **genuinely open** |

So the honest reading of "2 critical" is: **both are `websocket-driver`
CVE-2026-54466, both already patched on develop**, and one of the two is
additionally mis-scoped — GitHub labels it `runtime`, but the only path to it is
`@firebase/rules-unit-testing` → `firebase` → `@firebase/database` →
`faye-websocket` → `websocket-driver`, and `@firebase/rules-unit-testing` is in
**`devDependencies`**. It is a Firestore-rules *test* library. It never ships.

**Two conclusions, and the second is the reason this is `mvp: true`:**

1. The single highest-value remediation is the **owed develop→main promotion**,
   not a new dependency bump. It closes both criticals and most highs at once.
2. Until that promotion happens, this banner is **permanently untrustworthy** —
   and a security banner nobody believes is worse than none, because the day a
   real runtime critical lands it will look exactly like the noise. That is the
   same fail-open-and-silent shape as a hidden ban screen.

The residue after promotion is small and needs real work: `js-yaml` (same
version on both branches), and the runtime-scoped `ip-address` (via
`express-rate-limit`, a genuine `dependencies` entry), `protobufjs` and
`body-parser` alerts, which must each be checked against the installed version
the same way rather than assumed.

## Acceptance Criteria

### Happy path

- [ ] Every one of the 19 alerts is classified: fixed-on-develop, dev-only, genuinely-open-runtime, or false-positive — with the installed version and the advisory range recorded for each.
- [ ] The classification is produced by a **re-runnable script**, not a one-off table that rots.
- [ ] After the develop→main promotion, the alert count is re-measured and the drop is recorded.

### Error paths

- [ ] An alert whose installed version cannot be determined is reported as **unknown**, never silently as safe.
- [ ] An alert naming a manifest that does not exist fails the triage loudly rather than being skipped.
- [ ] A package present in more than one lockfile at different versions is reported per lockfile, not collapsed to one verdict.

### Edge cases

- [ ] `scope` is taken from the **actual dependency graph** (`npm ls`), not from GitHub's label — the `websocket-driver` critical is labelled `runtime` and reached only through a `devDependency`.
- [ ] A transitive package reachable by BOTH a runtime and a dev path is classified by the runtime path (the stricter reading).
- [ ] Multiple advisories against one package with different ranges are each evaluated separately — `brace-expansion` has five ranges and the installed version satisfies all five.
- [ ] Both `package-lock.json` (root) and `express-api/package-lock.json` are covered; the root lock is easy to forget and is where 8 of the alerts sit.

### Performance

- [ ] The triage script completes in under 60 s so it can be re-run after any promotion or bump.

### Security

- [ ] Every **genuinely-open runtime** alert gets either an upgrade or a written, dated risk acceptance naming who accepted it. No silent carry-forward.
- [ ] No alert is dismissed in the GitHub UI as part of this story — dismissal hides it from the next reader; fixing or documenting does not.
- [ ] The triage does not print or commit any token, key, or lockfile integrity hash beyond what is already committed.

### UX

- [ ] N/A — no end-user surface. The operator-facing outcome is a security banner whose number means something.

### i18n

- [ ] N/A — tooling and documentation only; no user-facing strings.

### Observability

- [ ] The triage output names, per alert: package, both installed versions, advisory range, graph-derived scope, and verdict — enough to re-check one alert without re-running everything.
- [ ] The script is committed so the count can be tracked over time rather than re-derived by hand each time the banner is noticed.

## BDD Scenarios

**Scenario: The security warning is explained rather than repeated**

- **Given** a security warning naming nineteen problems
- **When** the operator asks which ones actually affect the shipped product
- **Then** they get a per-problem answer with the evidence for each

**Scenario: Publishing the pending release removes most of them**

- **Given** most of the problems are already fixed on the integration branch
- **When** that work is promoted to the release branch
- **Then** the warning count drops, and the drop is recorded

**Scenario: A problem that only affects test tooling is not treated as shipped risk**

- **Given** a flagged package reachable only through a testing library
- **When** the triage classifies it
- **Then** it is recorded as test-only, with the dependency path shown

**Scenario: Anything genuinely affecting the live product is acted on**

- **Given** a problem that does affect the shipped product
- **When** the triage finishes
- **Then** it is either upgraded or has a dated, named risk acceptance

## Test Plan

### Node / Jest (`express-api/tests/scripts/triage-dependabot.test.js`)

Against committed fixtures, so the triage logic is itself tested:

- `classifies an installed version at or above the patched version as fixed`
- `classifies an installed version below the patched version as open`
- `evaluates each advisory range separately for one package` (the `brace-expansion` five-range case)
- `derives scope from the dependency graph, not the alert label` (the `websocket-driver` case)
- `classifies a package reachable by both runtime and dev paths as runtime`
- `reports unknown when the installed version cannot be determined`
- `fails loudly when a named manifest is absent`
- `reports per-lockfile when versions differ between them`
- `completes in under 60 seconds`

### Real-data check

- Run against the live alert list and confirm the two `websocket-driver`
  criticals classify as fixed-on-develop + dev-only-path, and `js-yaml`
  classifies as genuinely open. These are the three the manual triage already
  established, so they are the script's calibration.

### Post-promotion measurement

- After the develop→main promotion, re-run and record the new count. A predicted
  drop that does not materialise means the triage is wrong and needs revisiting.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| scope read from the alert label instead of the graph | `derives scope from the dependency graph, not the alert label` |
| only the first advisory per package evaluated | `evaluates each advisory range separately for one package` |
| unknown version treated as safe | `reports unknown when the installed version cannot be determined` |
| a missing manifest skipped silently | `fails loudly when a named manifest is absent` |
| only `express-api/package-lock.json` scanned | `reports per-lockfile when versions differ between them` |

### Not a device story

Touches a script, its tests and documentation. No app, backend or website runtime
surface → no device gauntlet; full non-device suite plus `code-reviewer`.

## Out of Scope

- **Performing the develop→main promotion.** That is its own gated release act with its own gauntlet; this story identifies it as the highest-value remediation and measures the result.
- Upgrading anything classified fixed-on-develop — the promotion does it.
- Dismissing alerts in the GitHub UI, ever (see Security AC).
- The 19 count itself as a target. The goal is that every remaining alert is understood, not that the number reads zero.

## Dependencies

- **The owed develop→main promotion** — 43 commits, and the single action that
  closes both criticals plus most highs. Tracked in
  `[[project-shytalk-promotion-in-progress]]`.
- Dependabot config lives in `.github/dependabot.yml`; **SHY-0226** is currently
  changing its `directories:` coverage, so this story should read the merged
  version rather than race it.
- No blocking dependency for the triage itself.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| **The banner stays untrustworthy and masks a real runtime critical later** — the actual danger here | This is the story's stated purpose, and the triage is a committed re-runnable script rather than a one-time note, so the number stays meaningful after the next bump. |
| A dev-only classification is wrong and something does ship | Scope is derived from `npm ls`, not from GitHub's label — which is already demonstrated wrong once — and a package reachable by both paths is classified as runtime. |
| Alerts get dismissed to clear the banner | Explicitly forbidden by an AC. Dismissal hides the finding from the next reader; fixing or documenting does not. |
| The promotion is assumed to have fixed things without checking | The post-promotion re-measurement is in the DoD; an unrealised drop invalidates the triage. |
| Triage is done once and rots | The script is the deliverable, not the table. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] All 19 alerts are classified with installed version, advisory range, graph-derived scope and verdict recorded in this story's Notes.
- [ ] `scripts/triage-dependabot.sh` (or `.js`) is committed and re-runnable.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] Every genuinely-open **runtime** alert is upgraded, or carries a dated risk acceptance naming who accepted it.
- [ ] **No alert was dismissed in the GitHub UI.**
- [ ] The post-promotion alert count is re-measured and recorded.
- [ ] `cd express-api && npm test` passes; `npm run lint` clean at `--max-warnings=0`.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Raised on operator instruction ("investigate and file a story") after the banner appeared on every push during an open-branch sweep.
- **2026-08-17** — Triage findings, measured not assumed. 19 open alerts: 2 critical, 12 high, 4 medium, 1 low. **Both criticals are `websocket-driver` CVE-2026-54466 with range `< 0.7.5`; develop has 0.7.5 and `main` has 0.7.4.** The six `brace-expansion` highs span five ranges; develop's installed versions (1.1.18 / 2.1.4 / 5.0.9) satisfy all five, `main` has 5.0.6. Dependabot evaluates the **default branch**, and develop is **43 commits ahead of main** — so the banner is largely a report on the un-promoted release.
- **2026-08-17** — One critical is **mis-scoped by GitHub as `runtime`**. `npm ls` shows the only path is `@firebase/rules-unit-testing` → `firebase` → `@firebase/database` → `faye-websocket` → `websocket-driver`, and `@firebase/rules-unit-testing` is a `devDependency` (a Firestore-rules test library). Hence the AC requiring scope to come from the graph rather than the label.
- **2026-08-17** — `js-yaml` 4.2.0 is identical on both branches, so GHSA-5p4m-2wfm-xmqj is **genuinely open** and is the clearest candidate for real work. `ip-address` (via `express-rate-limit`, a real `dependencies` entry), `protobufjs` and `body-parser` need the same per-version check rather than assumption.
- **2026-08-17** — `mvp: true` on the reasoning that an untrustworthy security banner is a launch risk in itself: the day a real runtime critical lands, it will look exactly like the existing noise.
