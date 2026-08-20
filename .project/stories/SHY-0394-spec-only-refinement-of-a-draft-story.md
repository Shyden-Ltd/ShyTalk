---
id: SHY-0394
status: Draft
owner: unassigned
created: 2026-08-21
priority: P2
effort: S
type: chore
roadmap_ids: []
mvp: false
---

# SHY-0394: Refining a Draft story should not need a false status

## User Story

As **somebody refining a story before it is picked up**, I want to record the
refinement in the story itself, so that the next person reads one document rather
than a story plus a parked note explaining why the story is out of date.

## Why

`scripts/check-pr-story-status.js` requires every changed story to be `In Review`,
`Done` or `Cancelled`, with one exemption: a **newly added** Draft. The exemption
is add-only, and deliberately so — it exists because SHY-0120 shipped with its
story still at `Draft`, so the board claimed nothing had been built.

That protection is correct and must survive. The cost is that a *spec-only*
change to an existing Draft is refused, because path and status alone cannot tell
"I refined the wording" from "I built it and forgot to flip the status".

**This collides with the repo's own re-validate-at-pickup convention**, which
asks for exactly that edit — and it has now cost two PRs:

| When | Story | What happened |
| --- | --- | --- |
| 2026-08-20 | SHY-0146 | PR #1876 closed rather than fake the status; findings moved into EPIC-0004's table |
| 2026-08-21 | SHY-0379 | Refinement parked in `.project/handoff/2026-08-21-SHY-0379-refined-spec.md` so PR #1909 could merge |

Both workarounds are honest and both leave the same debt: **the story on disk is
knowingly stale, and the real content is somewhere a reader has to be told
about.** A planner opening SHY-0379 today gets the superseded version.

### Why not simply flip the status

Because it would be a lie. `In Review` means an implementation is up for review,
and the `Reviewed-up-to` marker would point at a commit that reviewed no
implementation. The gate would pass and the board would be wrong — the precise
failure SHY-0120 taught.

### Recommended shape

Let the PR **declare** the exemption instead of hiding it. A `Spec-only: SHY-NNNN`
line in the PR body exempts that story from the status requirement, and the gate
verifies the claim: every file the branch changes for a spec-only story must be
under `.project/`. A PR that declares spec-only and also ships code is refused,
exactly as today.

The status stays `Draft`, which is true. The claim is in the PR body where a
reviewer sees it next to the diff. The alternative — keep the gate as it is and
keep parking refinements in `.project/handoff/` — is what happens if this is
declined, and it is a legitimate choice; it just needs to be a chosen one.

## Acceptance Criteria

### Happy path

- [ ] A PR that only refines a Draft story's text, and declares it, merges with
      the story still at `Draft`.
- [ ] The refinement lands in the story file itself, not in a parked note.

### Error paths

- [ ] A PR that declares a story spec-only but also changes code outside
      `.project/` is refused, and the message names the offending file.
- [ ] A modified Draft story with **no** declaration is refused exactly as it is
      today, with today's message.

### Edge cases

- [ ] Declaring a story that the PR does not touch is refused, so a stale
      declaration cannot silently exempt a future change.
- [ ] A PR carrying both an implemented `In Review` story and a declared
      spec-only Draft is judged per story, not as a whole.
- [ ] A renamed story file is treated as modified, as it is today.

### Performance

- [ ] The gate still finishes in seconds; it reads the diff it already reads.

### Security

- [ ] The check stays read-only — no shell, no network, no scanned file executed.

### UX

- [ ] Every refusal says what to do next, as the current message does.

### i18n

- [ ] Not applicable — developer tooling, no user-facing surface.

### Observability

- [ ] The gate logs one line per story saying which rule applied, so a passing
      run shows *why* it passed.

## BDD Scenarios

**Scenario: A declared wording change merges without a false status**

- **Given** a change that only rewrites a Draft story's text
- **When** the gate runs on it
- **Then** it passes and the story is still Draft

**Scenario: A declaration cannot smuggle code through**

- **Given** a change that declares a story as text-only but also edits the app
- **When** the gate runs on it
- **Then** it refuses and names the file that gave it away

**Scenario: Forgetting to flip a built story still fails**

- **Given** a story that has been built but left at Draft
- **When** the gate runs on it
- **Then** it refuses exactly as it does today

## Test Plan

| Layer | What it proves |
| --- | --- |
| Unit | Each branch of the decision — added Draft, modified Draft undeclared, modified Draft declared, declared-but-untouched, declared-plus-code — against a real git fixture repo, no mocked `git`. |
| Regression | The SHY-0120 case (built, left Draft, undeclared) still fails with today's message. |
| Guard | A declaration naming a story the diff does not contain fails, so declarations cannot accumulate unnoticed. |

## Out of Scope

- Changing what `In Review` means, or the `Reviewed-up-to` marker.
- The board sync — a story staying `Draft` is already the state it syncs.
- Retro-applying the parked SHY-0146 and SHY-0379 refinements; each returns to
  its story when that story is picked up.

## Dependencies

- None. The gate already has the diff and the status it needs.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The declaration becomes a routine bypass | It is refused unless every changed file for that story is under `.project/`, and it is visible in the PR body at review time. |
| Loosening the gate reintroduces SHY-0120 | A regression test pins the undeclared case to today's refusal, so the protection cannot be removed by accident. |
| A reviewer trusts the declaration without reading it | The gate verifies it rather than trusting it; the declaration is a claim, not a switch. |

## Definition of Done

- [ ] Merged to `develop`, all checks green.
- [ ] Proven by refining one genuinely Draft story through the new path.

## Notes

- Operator call. If the answer is "leave the gate alone", close this as Cancelled
  and the parking convention in
  `.project/handoff/2026-08-21-SHY-0379-refined-spec.md` becomes the documented
  way to do it — which is a fine outcome, just not the current silent one.
