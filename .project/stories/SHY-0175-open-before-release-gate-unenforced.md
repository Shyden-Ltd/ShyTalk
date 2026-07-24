---
id: SHY-0175
status: Draft
owner: claude
created: 2026-07-10
priority: P2
effort: S
type: chore
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0175: A story can say "do not release without X" and the release will happen anyway

## User Story

**As** an engineer who wrote "this must not ship until a native speaker reads it",
**I want** the release to refuse until that box is ticked,
**So that** a release gate is a gate, not a sentence in a file nobody re-reads.

## Why

[[SHY-0149]] added an `## Open before release` section to its story with one unchecked item: a native-speaker pass on the Russian, Ukrainian and Chinese ban/suspension copy, which an engineer wrote and a test can only prove *self-consistent*, never *correct*.

Nothing enforces it. `scripts/check-story-frontmatter.sh` validates the ten required `##` sections and the frontmatter fields; `## Open before release` is not among them, so it is neither required nor scanned. `scripts/pre-merge-check.sh` gates the PR, not the release. `release.yml` cuts a tag without consulting story files at all. The item is prose, in a file, and the release path never looks at it.

Surfaced by SHY-0149's round-18 review (finding R18-I3), which classified it as a reachable gap given this repo's autonomous-release posture: the story merges, the next `release.yml` run cuts a tag, and mistranslated copy reaches users in three locales with an unticked box sitting in a markdown file.

The same mechanism would be useful beyond i18n: "needs a load test", "needs the legal review in [[project-gdpr-export-osa17-legal-review]]", "needs a real-device pass on iOS 18".

## Acceptance Criteria

### Happy path
- [ ] A story with an unchecked item under `## Open before release` blocks the release cut, naming the story and the item.
- [ ] A story with all such items checked, or with no such section, does not block anything.

### Error paths
- [ ] A malformed `## Open before release` section (no checkboxes, or checkboxes outside it) fails loudly rather than being treated as empty — an unparseable gate must not read as an open door.
- [ ] The check runs on stories that are merged but not yet released (`status: In Review`, no `released_in:`), which is exactly the window the gate exists for.

### Edge cases
- [ ] A `Cancelled` or `Draft` story's open items never block a release.
- [ ] An item checked in the same PR that adds it behaves like any other checked item.

### Performance
- [ ] The scan adds no more than a second to the release job (it reads ~180 markdown files).

### Security
- N/A — release tooling; no production surface.

### UX
- N/A — no user-facing surface.

### i18n
- N/A — no user-facing strings.

### Observability
- [ ] The failure message names the story id, the file, and the exact unchecked line — enough to act on without opening anything.

## BDD Scenarios

**Scenario: something still needs a human**
- **Given** a finished piece of work whose notes say a person must check something before it goes out
- **And** nobody has ticked it off
- **When** a release is prepared
- **Then** the release stops and says which piece of work, and what is outstanding

**Scenario: everything has been signed off**
- **Given** the same piece of work with the box ticked
- **When** a release is prepared
- **Then** it proceeds

## Test Plan

Touches `scripts/**` and `.github/workflows/release.yml` → no product runtime surface; the device/browser gauntlet does not apply.

**Red → Green:** write `express-api/tests/scripts/check-release-gates.test.js` FIRST, against fixture story files: one with an unchecked item (must fail), one with all checked (must pass), one with no section (must pass), one Cancelled with an unchecked item (must pass), one malformed (must fail). Watch each fail before writing `scripts/check-release-gates.sh`. Mutation-verify: make the script ignore unchecked boxes and watch the first fixture go green — it must not.

Then wire it into `release.yml` before the tag step, and prove it blocks by running it against SHY-0149's real story file while its native-speaker item is open.

**Static/quality:** `npm run lint` 0 warnings; prettier clean. Verify with `grep -E "error|warning|problem"`, never a `tail` window.

## Out of Scope
- Changing what SHY-0149's open item says, or doing the translation review itself.
- Any per-PR gate — `pre-merge-check.sh` already covers the merge step.

## Dependencies
- `scripts/check-story-frontmatter.sh` (the parser to mirror), `scripts/pre-merge-check.sh`, `.github/workflows/release.yml`.

## Risks & Mitigations
- **Risk:** a forgotten open item blocks every release indefinitely. **Mitigation:** the message names the story and the line; ticking a box is a one-line PR. This is the intended behaviour, not a bug.
- **Risk:** the section name drifts (`## Open before release` vs `## Before release`). **Mitigation:** the frontmatter validator learns the heading, so a typo fails at story-lint time rather than silently disabling the gate.

## Definition of Done
- [ ] An unchecked item blocks a release cut; a checked one does not; both proven by test and by a real run against SHY-0149.
- [ ] `code-reviewer` 100% clean → In Review → CI green by name → merge → `released_in:` on the next cut.

## Notes (running log)

- 2026-07-10 — **CREATED fully-refined** from SHY-0149's round-18 review (finding R18-I3). SHY-0149 gates its own release on a native-speaker pass over `ru`/`uk`/`zh` ban copy that an engineer wrote — copy whose *self-consistency* `tests/web/portal-ban-i18n.spec.ts` pins, and whose *correctness* no test can. The gate is a markdown checkbox that no tool reads. The failure it invites is precisely the one SHY-0149 spent eighteen review rounds on: a green signal that was never evidence of anything. Filed rather than folded in: it changes release tooling, needs its own RED fixtures, and blocks nothing about SHY-0149's merge.
