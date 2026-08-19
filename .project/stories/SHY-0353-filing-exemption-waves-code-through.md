---
id: SHY-0353
status: Draft
owner: claude
created: 2026-08-19
priority: P1
effort: S
type: infra
roadmap_ids: []
mvp: true
---

# SHY-0353: A pull request full of code can skip the story gate by carrying a brand-new story

## User Story

As **the person relying on the merge gate to mean something**, I want the
"filing" exemption to apply only to actual filings, so that a pull request
shipping real code cannot skip the readiness check by happening to add its story
in the same commit.

## Why

**P1. The gate says OK to something the protocol would refuse, in both layers.**

There is a deliberate exemption: a **newly-added `Draft`** story is a legitimate
*filing* — writing a backlog item — and should not be blocked by the "story must
be In Review before merge" rule. That reasoning is sound.

The implementation keys on the story alone and never asks what else is in the
pull request:

- `scripts/pre-merge-check.sh:65` — `if [ "$code" = "A" ] && [ "$status" = "Draft" ]` → exempt, `continue`
- `scripts/check-pr-story-status.js:87` — `else if (code === 'A' && status === 'Draft')` → exempt

Both are add-only and Draft-only, which is careful in one dimension and blind in
the other. **Neither asks whether the pull request also contains non-story
files.** So a pull request that ships backend routes, both mobile clients and
tests skips the status gate entirely, provided its story is new and still Draft —
which is the *normal* state for work done in one pass, where the story is written
and implemented together.

**Observed, not theorised — on PR #1807 (SHY-0350), 2026-08-19:**

```
filing exemption: .project/stories/SHY-0350-....md newly-added Draft (SHY-0131 parity)
PRE-MERGE-CHECK: OK
```

That pull request contained `express-api/src/routes/users.js`, both platform
message repositories, a new `JsonToMap.kt` and two test files. It had **no**
`Reviewed-up-to` marker and its story was **Draft**, and the gate cleared it.
When the story was moved to `In Review` by hand, the same gate immediately
refused for a missing review marker — which is the check that should have run
all along. The exemption was hiding a real requirement, not waiving a formality.

**Why this matters more than a normal gate bug.** Both gates exist to stop
exactly one thing: merging work whose readiness nobody has asserted. The
device-gauntlet rules, the `Reviewed-up-to` marker and the In-Review requirement
all hang off this check. A PR that takes the exemption skips **all** of it. And
the failure is silent and reassuring — it prints `OK`.

## Acceptance Criteria

### Happy path

- [ ] A pull request containing only story documents can still file a brand-new Draft story, exactly as today.
- [ ] A pull request containing any non-story file is held to the full readiness check, even if it also adds a new Draft story.
- [ ] Both the local gate and the CI gate behave the same way, so neither can be the softer route.

### Error paths

- [ ] When the exemption is refused because the pull request ships code, the message says so — naming a non-story file — rather than only reporting the story's status.
- [ ] A pull request adding several stories, one new Draft and one modified, is judged by the strictest applicable rule.

### Edge cases

- [ ] A story added and immediately moved to In Review in the same pull request is judged on its final status, not its first.
- [ ] A renamed story file is not mistaken for a newly-added one.
- [ ] A pull request whose only non-story change is another `.project/` document is classified deliberately, and the choice is stated rather than left to accident.
- [ ] A pull request with no story at all keeps its current behaviour.

### Performance

- [ ] N/A — a shell/Node condition over an existing diff listing; no new I/O.

### Security

- [ ] N/A — no credential, network or deployment surface. The change tightens a gate; it grants nothing.

### UX

- [ ] N/A — no user-facing surface; the audience is whoever reads the gate's output.

### i18n

- [ ] N/A — no user-facing strings.

### Observability

- [ ] The gate states which rule it applied and why, so a reader can tell a genuine filing from a refused one without re-deriving it.

## BDD Scenarios

**Scenario: A genuine filing still passes**

- **Given** a change that only adds a new backlog story document
- **When** it is checked for readiness
- **Then** it is allowed through as the filing it is

**Scenario: Code cannot ride in on a filing**

- **Given** a change that ships working code and also adds a new backlog story
- **When** it is checked for readiness
- **Then** it is refused, and told that the code in it must meet the usual bar

**Scenario: Both gates agree**

- **Given** the same change that ships code alongside a new story
- **When** it is checked locally and again on the server
- **Then** both refuse it, so neither is an easier way in

## Test Plan

**CI-config-only classification**: the change is confined to `scripts/pre-merge-check.sh`,
`scripts/check-pr-story-status.js` and their tests. No app, backend or website
runtime surface, so the device/browser gauntlet would exercise nothing related to
it. The full non-device gauntlet still runs.

### Jest — `express-api/tests/scripts/pre-merge-check-filing-exemption.test.js`

- `a story-only PR adding a Draft story is exempt` — the behaviour that must survive
- `a PR adding a Draft story AND a source file is REFUSED` — **the defect, in one assertion**; fails today
- `the refusal names a non-story file, so the reason is legible`
- `a PR adding a Draft story and only other .project docs is classified per the decision recorded in Notes`
- `a renamed story is not treated as newly added`
- `a story added and set to In Review in the same PR is judged on In Review`

### Jest — `express-api/tests/scripts/check-pr-story-status-filing-exemption.test.js`

- the same matrix against the CI gate, so the two cannot drift apart

### Proof against the real case

- Re-run the local gate against PR #1807's tree as it stood at the moment it
  printed `PRE-MERGE-CHECK: OK`, and confirm it now refuses. A unit test proves
  the condition; this proves it catches the case that actually got through.

### Mutation proof

| Mutation | Must kill |
| --- | --- |
| the non-story-file condition removed | `a PR adding a Draft story AND a source file is REFUSED` |
| the exemption removed entirely | `a story-only PR adding a Draft story is exempt` |
| the CI gate left untightened | the CI-gate matrix |

## Out of Scope

- Changing what the `Reviewed-up-to` marker means or how it is recorded.
- The SHY-0131 exemption's own rationale — filing a brand-new Draft story
  remains legitimate; only its blindness to the rest of the pull request changes.
- The separate CI gap where no workflow compiles the iOS target — SHY-0352.
- Retrospectively re-gating anything already merged.

## Dependencies

- None. Both gates already receive the full changed-file list they need; the
  information is present and simply unused.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---- |
| Tightening blocks legitimate filings | The story-only case is asserted first and is in the mutation table, so removing the exemption reddens a test rather than passing quietly. |
| The two gates drift apart again | The same matrix runs against both, in sibling test files. |
| A mixed `.project/` PR is classified by accident | It is an explicit AC and an explicit test, and the decision gets written into Notes rather than inferred from behaviour. |
| The fix is asserted but never proven against the real case | The #1807 reproduction above is required by the DoD; a green unit test alone is not accepted as proof. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test was observed failing before the change.
- [ ] The gate was re-run against PR #1807's tree and observed to refuse where it previously printed OK.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] `shellcheck`/`actionlint` clean; `eslint --max-warnings=0` and `prettier --check` clean.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-19 — found while trying to merge PR #1807, not by reading the
  script.** The gate printed `filing exemption … PRE-MERGE-CHECK: OK` for a pull
  request shipping `users.js`, both platform repositories, a new `JsonToMap.kt`
  and two test files. Moving the story to `In Review` by hand made the same gate
  refuse immediately for a missing `Reviewed-up-to` marker — so the exemption was
  suppressing a real requirement, not waiving a formality.

- **2026-08-19 — the hole is in BOTH layers, which is why this is P1.**
  `pre-merge-check.sh:65` and `check-pr-story-status.js:87` implement the same
  condition independently and share the same blind spot, so the local gate and
  the CI gate fail identically. There is no second line of defence.

- **2026-08-19 — the exemption itself is not the problem** and should survive.
  Filing a brand-new Draft story is legitimate and common. What is missing is one
  extra question — *does this pull request contain anything that is not a story
  document?* — which both gates already have the data to answer.
