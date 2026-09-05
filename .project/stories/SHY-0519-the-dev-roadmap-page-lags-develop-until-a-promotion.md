---
id: SHY-0519
status: Draft
owner: unassigned
created: 2026-09-04
priority: P2
effort: XS
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0519: The dev roadmap page lags develop until a promotion

## User Story

As **the operator who reads the dev roadmap page to see what the board holds
right now**, I want every dev deploy to publish roadmap data regenerated from
the stories on the deployed commit, so that a change on the board is visible
on the dev page straight after the merge that carried it, not after the next
promotion to `main`.

## Why

`.github/workflows/sync-roadmap-data.yml` regenerates
`public/roadmap-data.json` only on pushes to **`main`** (SHY-0038, signed
commit-back per SHY-0063). The dev site deploys `public/` from **`develop`**,
so the dev page serves the file as `main` last generated it — on 2026-08-27
at the time of writing. Regenerating from `develop`'s corpus today changes
`_meta.epicCount` from 12 to 14 (EPIC-0013 and EPIC-0014 were filed on
2026-09-04) and the timestamps; the item list is unchanged only because the
new stories carry no `roadmap_ids`. The operator's rule is that a board
change reflects on **both** the dev and the live roadmap pages immediately,
and that the sync is autonomous, not remembered.

**Chosen design — regenerate at deploy time, commit nothing.** The web step
of `deploy-dev.yml` runs `node scripts/sync-shy-to-roadmap-data.mjs` after
checkout and before `wrangler pages deploy public`. The dev page then always
reflects the deployed commit's story corpus, and `deploy after every develop
merge` (a standing rule) makes it immediate.

**Rejected — commit the regenerated file back to `develop`.** The story-sync
workflow proves a Release-App `createCommitOnBranch` on `develop` works
(the `board-items.json` sidecar), but it adds a bot commit per story change,
a race with the deploy dispatch that follows the merge, a second loop guard,
and a promotion diff on a generated file. Regenerating on the way out has
none of that and the same result on the page.

## Acceptance Criteria

### Happy path

- [ ] The `Deploy web to dev site` step of `deploy-dev.yml` runs
      `node scripts/sync-shy-to-roadmap-data.mjs` unconditionally, after the
      config substitutions and before the `wrangler pages deploy public` line.
- [ ] After a dev deploy of commit X, `https://dev.shytalk.shyden.co.uk/roadmap-data.json`
      (Basic auth) is byte-identical, timestamps aside, to a local regeneration
      from X's `.project/stories/`.
- [ ] `public/roadmap-data.json` in the repository is not modified or
      committed by `deploy-dev.yml`; `main`'s workflow stays the only writer.

### Error paths

- [ ] The script's exit codes 10 (story parse error) and 20 (malformed data
      shell) fail the web deploy job loudly; the stale committed file is never
      published as a fallback.
- [ ] A missing `.project/stories/` directory fails the job with the script's
      own message.

### Edge cases

- [ ] A web-only deploy (`inputs.backend=false`) still regenerates.
- [ ] `_meta.generatedAt` and `lastUpdated` on dev differ from the committed
      file; the roadmap page renders them as-is with no staleness warning.
- [ ] The prod deploy path is untouched: the live page keeps serving the file
      `main`'s workflow committed.

### Performance

- [ ] The regeneration adds well under a second to the web deploy; no new
      dependency (the script has none).

### Security

- [ ] No new secret, permission or token: the step reads the checked-out
      repository only and writes a file into the artifact that is uploaded
      anyway.

### UX

- [ ] Right after the dev deploy that follows a story merge, the dev roadmap
      page shows the epic count and items of `develop`, matching what the
      board shows.

### i18n

- [ ] Phase titles and their translations are preserved: the script rewrites
      only `phases[].items` and `currentlyWorkingOn` (its documented contract).

### Observability

- [ ] The step writes one line to the job log and the step summary:
      `[roadmap] regenerated from <sha>: <n> public SHYs, <m> EPICs`.
- [ ] `express-api/tests/scripts/deploy-dev-roadmap-regen.test.js` pins the
      order (regenerate before deploy) and the absence of any commit or push of
      `public/roadmap-data.json` from `deploy-dev.yml`.

## BDD Scenarios

**Scenario: A newly filed epic shows on the dev roadmap after the next dev deploy**

- **Given** an epic was merged to the integration branch today
- **When** the dev site is deployed from that branch
- **Then** the dev roadmap page counts that epic

**Scenario: A broken story file stops the dev web deploy**

- **Given** a story file on the integration branch that cannot be parsed
- **When** the dev site is deployed
- **Then** the web deploy fails naming the file, and the old roadmap is not republished

**Scenario: The live roadmap is unchanged by a dev deploy**

- **Given** the live roadmap was last generated from the release branch
- **When** the dev site is deployed
- **Then** the live roadmap page is exactly as it was

## Test Plan

### Red

- `express-api/tests/scripts/deploy-dev-roadmap-regen.test.js` — the web
  deploy `run:` block contains the regeneration command; it appears before
  the `wrangler pages deploy public` line; it is not guarded by an `if`;
  no `createCommitOnBranch`, `git commit` or `git push` mentions
  `public/roadmap-data.json` anywhere in `deploy-dev.yml`.
- `express-api/tests/scripts/sync-roadmap-data-workflow.test.js` — unchanged
  and still green (the `main` workflow is not touched).

### Green

- Two lines in the `Deploy web to dev site` step: the regeneration, and the
  summary echo.

## Out of Scope

- Committing regenerated data to `develop`.
- Any change to `sync-roadmap-data.yml` or the `main` commit-back.
- Board → story two-way sync (SHY-0360).

## Dependencies

- None — `scripts/sync-shy-to-roadmap-data.mjs` exists since SHY-0038/0063.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A story typo on `develop` blocks the dev web deploy | `scripts/check-story-frontmatter.sh` gates every PR, so the corpus on `develop` is valid by construction; failing loud is the intended behaviour, not a regression. |
| The committed file and the dev page disagree | By design: the committed file is the live page's source, regenerated on `main`; the dev page is regenerated from `develop` at deploy time. Recorded here so nobody "fixes" the difference. |

## Definition of Done

- [ ] Merged to `develop`; the dev deploy that follows is green.
- [ ] `_meta.epicCount` on the dev `roadmap-data.json` equals the number of
      `EPIC-*.md` files on the deployed commit; recorded in Notes with the run id.

## Notes

- **2026-09-04** — Found while verifying the EPIC-0013 deploy (run
  33852134253, all legs green): the dev page's data still carried
  `epicCount: 12` while `develop` had 14 epics. The handover asked for this
  story if the gap was confirmed; it was.
