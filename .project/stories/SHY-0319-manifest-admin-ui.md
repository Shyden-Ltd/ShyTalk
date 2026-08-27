---
id: SHY-0319
status: Draft
owner: claude
created: 2026-08-17
priority: P1
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0011
mvp: true
---

# SHY-0319: Edit the app's appearance from the admin panel, and still get a commit

## User Story

As the **operator**, I want to change menus, options, copy and theming from the
admin panel without opening a pull request, so that a fix takes a minute — while
still producing a reviewable, revertible commit.

## Why

SHY-0318 makes the manifest a git artefact, which gives it history, review and an
undo. That is the right foundation, and it still costs a PR round-trip per
change. For a typo at 2am, a PR is friction without benefit.

This story removes the round-trip **without removing the git properties**. The
admin UI validates the edit with the same validator CI uses, then commits it
through the same App-signed `createCommitOnBranch` mutation `release.yml` and the
board sync already use. CI deploys it. The operator sees a form; the repository
sees a normal commit.

So there is exactly one publishing path and one rollback mechanism. The admin UI
is a faster door into the pipeline, never a second pipeline.

**The interface is curated forms, never a raw JSON editor.** A textarea
containing the document that controls every user's app is a production incident
with autocomplete: no field validation until submit, no idea which key you are
editing, and a single misplaced brace away from a rejected or — worse —
structurally-valid-but-wrong document. Forms mean the UI knows what a colour is,
which icons exist, and which locales a label still needs.

## Acceptance Criteria

### Happy path

- [ ] An admin can add, remove, reorder and re-label a menu item through a form and publish it.
- [ ] An admin can change a design token through a colour/dimension control, not a free-text field.
- [ ] An admin can edit a string for a chosen locale, with the remaining locales listed as outstanding.
- [ ] An admin can set `rollout.percent` and `rollout.cohorts` through controls with enforced ranges.
- [ ] Publishing produces a real App-signed commit on develop whose diff shows exactly the change made.

### Error paths

- [ ] An edit failing validation is refused BEFORE any commit, with the failing rule shown against the offending field.
- [ ] A publish attempt during a `createCommitOnBranch` head race retries once, then reports failure without leaving a partial state.
- [ ] A network failure mid-publish leaves the repository unchanged — publish is atomic or it did not happen.
- [ ] A non-admin caller cannot reach any manifest-editing endpoint (`requireAdmin`), asserted per endpoint.

### Edge cases

- [ ] Two admins editing concurrently: the second publish is refused on a stale base rather than silently overwriting, and the message says so.
- [ ] An admin editing a string for a locale that already has an override sees the current override, not the bundled value.
- [ ] Reverting to a previous version through the UI performs the same `git revert` as the command line — one mechanism, not two.
- [ ] An admin cannot construct a reference to a sealed screen: sealed routes are absent from every picker, and a hand-forged request is refused server-side.
- [ ] Leaving a form without publishing discards the draft rather than persisting a half-edit.

### Performance

- [ ] Validation feedback appears within 500 ms of a field changing, so it feels like a form rather than a build.
- [ ] Publish completes within 10 s including validation and the commit.

### Security

- [ ] Every manifest-editing endpoint is `requireAdmin`, enumerated by a test that fails if a new one is added without it.
- [ ] No raw-JSON editing surface exists anywhere in the UI — asserted, because it is the property most likely to be added later "just for debugging".
- [ ] The commit is App-signed via `createCommitOnBranch`, satisfying the branch ruleset's signature requirement without weakening it.
- [ ] The admin UI cannot bypass validation: the publish endpoint re-validates server-side regardless of what the client checked.
- [ ] Sealed screens are unreachable from the UI both by omission (no picker entry) and by refusal (server-side check).

### UX

- [ ] Every form shows what will change before publishing — a human-readable summary, not a JSON diff.
- [ ] Outstanding locales for a new string are listed explicitly, so an admin knows publishing will be refused and why before they try.
- [ ] The admin panel is usable on a mobile browser, per this repo's mobile-first rule, and verified on real mobile browsers.
- [ ] Screenshots at every supported viewport, reviewed by eye.

### i18n

- [ ] The admin panel's own chrome follows the existing admin-panel locale conventions.
- [ ] The string editor surfaces all 20 locales and marks which are missing for a given key.
- [ ] The editor never lets an admin believe a partially-translated string can publish.

### Observability

- [ ] Every publish logs the admin's identity, the fields changed, and the resulting `manifestVersion`.
- [ ] Every refused publish logs the failing rule and the admin who attempted it.
- [ ] The commit message names the admin and summarises the change, so `git log` is a usable audit trail on its own.

## BDD Scenarios

**Scenario: An admin fixes wording without opening a pull request**

- **Given** an admin has spotted a misspelled label
- **When** they correct it in the admin panel and publish
- **Then** the app shows the corrected wording
- **And** the change is recorded in the project history

**Scenario: A change that breaks a rule is stopped before publishing**

- **Given** an admin adds a label with no Vietnamese translation
- **When** they try to publish
- **Then** publishing is refused before anything is recorded
- **And** the missing translation is shown against the field

**Scenario: Two admins cannot overwrite each other**

- **Given** two admins editing the same settings at once
- **When** the second one publishes after the first
- **Then** the second publish is refused as out of date

**Scenario: Protected screens cannot be edited**

- **Given** an admin looking for the ban screen in the admin panel
- **When** they browse the list of editable screens
- **Then** the ban screen is not offered

## Test Plan

**RED first.**

### Node / Jest (`express-api/tests/routes/admin-manifest.test.js`)

- `every manifest-editing endpoint requires admin`
- `enumerates manifest-editing endpoints and fails if one lacks requireAdmin`
- `re-validates server-side regardless of the client`
- `refuses a publish referencing a sealed screen`
- `refuses a publish whose base is stale, naming the conflict`
- `retries once on a createCommitOnBranch head race, then reports failure`
- `leaves the repository unchanged when the commit fails`
- `produces an App-signed commit whose diff matches the edit`
- `logs the admin identity, changed fields and manifestVersion`
- `completes publish within 10 seconds`

### Playwright (`tests/web/admin-manifest.spec.ts`)

- Real admin auth against the real local stack — no route mocks.
- Add / remove / reorder / relabel a menu item, then assert the resulting
  committed document.
- Assert **no raw-JSON textarea exists** anywhere in the manifest section.
- Assert sealed screens are absent from every picker.
- Assert outstanding locales are listed for a new string key.
- Assert validation feedback appears within 500 ms.
- Real mobile browser viewports, per the repo's mobile-first rule.

### Device / cross-browser

- Admin panel exercised on all five local browsers, and on real mobile browsers
  on a real Android device and a real iPhone.
- Screenshots at every viewport, reviewed by eye.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| server-side re-validation removed, trusting the client | `re-validates server-side regardless of the client` |
| `requireAdmin` dropped from one endpoint | `enumerates manifest-editing endpoints and fails if one lacks requireAdmin` |
| stale-base check removed | `refuses a publish whose base is stale, naming the conflict` |
| a raw-JSON textarea added | the Playwright assertion that no raw-JSON surface exists |
| sealed routes present in a picker | `refuses a publish referencing a sealed screen` + the picker assertion |
| commit failure leaves a partial write | `leaves the repository unchanged when the commit fails` |

### Backend + web change ⇒ FULL gauntlet

Touches `express-api/src/**` and `public/**`; the full device + all-browser
matrix runs.

## Out of Scope

- Editing anything outside the manifest — this is not a general admin feature.
- A preview environment that renders the edit before publishing. Valuable, and a
  separate story; `rollout.percent` at 0 or 5 is the Phase 1 answer.
- Phase 2 layout-tree editing.
- Any raw-JSON surface, permanently.

## Dependencies

- **SHY-0318** — the pipeline this UI writes through. Hard prerequisite; without
  it there is nothing to commit to.
- **SHY-0310**, **SHY-0311**, **SHY-0316**, **SHY-0317** — the rules the forms
  enforce and the pickers respect.
- **EPIC-0004 must be Done** (EPIC-0011 dependency gate).
- The existing admin panel and its `requireAdmin` middleware.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| A raw-JSON editor is added later "just for debugging" and becomes the real interface | Its absence is an asserted Security AC and a Playwright assertion, not a style preference. |
| The admin UI becomes a second publishing path that diverges from git | It commits through the same `createCommitOnBranch` mutation; there is one path and one rollback. |
| Concurrent admins silently overwrite each other | Stale-base refusal, asserted, with the check in the mutation table. |
| Client-side validation is trusted and a hand-forged request ships a bad document | Server-side re-validation is an AC and the first mutation. |
| This story's size pushes the EPIC past MVP | Sized as the largest line item in the plan and explicitly sequenced last; SHY-0318 ships the git path first, so this is additive rather than blocking. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] A publish from the admin panel produces a **real App-signed commit** whose diff matches the edit.
- [ ] **No raw-JSON editing surface exists**, asserted.
- [ ] Sealed screens absent from every picker AND refused server-side.
- [ ] Admin panel verified on all five local browsers and on real mobile browsers on both devices.
- [ ] Screenshots at every viewport, reviewed by eye.
- [ ] Backend + web change ⇒ FULL gauntlet green, then DEV green.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Story raised from design doc §7. Operator chose "both from the start" for publishing; this is the admin half, and it is affordable only because SHY-0318 makes it a client of the git pipeline rather than a second pipeline.
- **2026-08-17** — Curated forms rather than raw JSON was resolved as open question 3 in the design doc. A textarea holding the document that controls every user's app is a production incident with autocomplete.
- **2026-08-17** — Reuses the same App-signed `createCommitOnBranch` mutation as `release.yml` and the board sync, so the branch ruleset's signature requirement is satisfied without weakening it.
