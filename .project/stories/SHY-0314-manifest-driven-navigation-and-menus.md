---
id: SHY-0314
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

# SHY-0314: Menus and navigation the server decides

## User Story

As the **operator**, I want to add, remove, reorder and re-label items in the
app's menus and navigation from the server, so that I can fix a wrong menu or
ship a new entry point in minutes instead of waiting on a store release.

## Why

This is the story that delivers two of the operator's four stated drivers —
*fix mistakes fast* and *menus, navigation and options*. Everything before it is
plumbing; this is where the plumbing becomes a capability.

The interesting problems are all about **references that may not resolve.** A
manifest names an icon, a route and a label key, and each of those is a promise
the binary may not be able to keep — because the manifest was written for a newer
build, or because someone made a typo. Every unresolvable reference needs a
defined behaviour, and the behaviour must never be "draw something broken":

- An **unknown icon** is skipped, not drawn as a blank square. A blank square
  looks like a rendering bug; a missing icon on a labelled row looks fine.
- An **unknown route** means the item is dropped entirely. An item that navigates
  nowhere is worse than an absent item, because the user taps it and nothing
  happens.
- A **missing label key** means the item is dropped rather than rendering the raw
  key. `set_support` displayed to a user is the ugliest possible failure.
- A **sealed route** means the item is dropped and logged (SHY-0311).

The second theme is that **the shipped vocabulary is the ceiling.** Icons resolve
against a registry compiled into the binary — that is constraint C1, the
store-policy boundary, made concrete. The registry is therefore a reviewed,
versioned artefact, not an incidental map.

## Acceptance Criteria

### Happy path

- [ ] Adding a menu item server-side makes it appear in the app with no reinstall.
- [ ] Removing one makes it disappear.
- [ ] Reordering the manifest list reorders the rendered list.
- [ ] Changing a `labelKey` changes the rendered text in the user's locale.
- [ ] A `visibleIf` gated on an enabled feature shows the item; on a disabled one, hides it.

### Error paths

- [ ] An item naming an unknown icon renders with no icon and its label intact — never a blank or placeholder glyph.
- [ ] An item naming an unknown route is dropped entirely and logged.
- [ ] An item whose `labelKey` is missing from the active locale is dropped, never rendered as the raw key.
- [ ] An item naming a sealed route is dropped and logged.
- [ ] A manifest whose entire `menus` section is malformed falls back to bundled menus (SHY-0310 behaviour, asserted here end-to-end).

### Edge cases

- [ ] A manifest yielding zero visible items in a group renders that group's empty state, not an empty container with a heading.
- [ ] Two items with the same `id` are de-duplicated deterministically — first wins — rather than rendering twice.
- [ ] An item visible to one cohort and not another is correct for both, asserted on two real accounts.
- [ ] Deep-linking to a route that the manifest currently hides still works — hiding an entrance is not the same as closing a door, and closing it is SHY-0315's job.

### Performance

- [ ] Rendering a 50-item menu from the manifest is not measurably slower than the bundled equivalent, measured on a real low-end Android device.
- [ ] Predicate evaluation is not repeated per frame — resolved once per manifest change.

### Security

- [ ] A sealed route is unreachable from any item, asserted end-to-end and not only at publish time.
- [ ] `MenuAction.Url` opens only `https` targets (SHY-0310 rule), asserted here through a real tap on a real device.
- [ ] Hiding an item does not grant access to anything; conversely, showing an item never bypasses a server-side authorization check.

### UX

- [ ] Screenshots on real Android and real iPhone at every supported viewport, in default and server-modified states, reviewed by eye.
- [ ] A manifest change applying mid-session does not lose the user's place in the app.
- [ ] Reordering never produces a visible flicker or reflow on the user's next visit to the screen.
- [ ] Low-resolution and low-connectivity states verified, per the repo's mobile-first rule.

### i18n

- [ ] A server-supplied label renders correctly in all 20 locales, verified on the rendered TEXT rather than on the presence of an element.
- [ ] A right-to-left locale (`ar`) renders a server-supplied menu with correct ordering and alignment.
- [ ] An item whose label exists in some locales but not the active one is dropped for that locale only.

### Observability

- [ ] Every dropped item logs its `id` and the reason (unknown icon / unknown route / missing label / sealed).
- [ ] The count of rendered-vs-declared items is logged, so silent mass-dropping is visible.

## BDD Scenarios

**Scenario: A new menu item appears without an app update**

- **Given** an app installed and running
- **When** the operator adds a Support item to the settings menu
- **Then** the item appears in the app without reinstalling it

**Scenario: A menu item pointing nowhere is left out**

- **Given** a menu item that points at a screen this app does not have
- **When** the app draws the menu
- **Then** the item is left out entirely
- **And** the rest of the menu is unaffected

**Scenario: A missing icon does not spoil the row**

- **Given** a menu item asking for an icon this app does not have
- **When** the app draws the menu
- **Then** the item appears with its text and no icon

**Scenario: An item meant for adults is not shown to minors**

- **Given** a menu item marked for adults only
- **When** a minor opens the menu
- **Then** the item is not shown

## Test Plan

**RED first.**

### Kotlin unit (`shared/src/commonTest/kotlin/.../manifest/`)

- `MenuResolutionTest.kt`
  - `renders declared items in declared order`
  - `drops an item with an unknown route`
  - `keeps an item with an unknown icon, without an icon`
  - `drops an item whose labelKey is missing from the active locale`
  - `drops an item naming a sealed route`
  - `de-duplicates two items sharing an id, first wins`
  - `renders the group empty state when no item is visible`
  - `evaluates each predicate once per manifest change, not per frame`
  - `logs a reason for every dropped item`

### Compose UI (`shared/src/commonTest` + Android instrumented)

- Renders a manifest-driven menu and asserts the **rendered text**, per this
  repo's rule that asserting tags is not asserting content.
- Asserts RTL ordering for `ar`.

### Android instrumented BDD (`app/src/androidTest/assets/features/`)

- New scenarios in a `manifest_menus.feature` covering add / remove / reorder /
  relabel / cohort-gated visibility, driven through the existing step
  definitions.

### Device, REAL Android + REAL iPhone

- Operator edits the manifest; both devices show the change with no reinstall.
- Two real accounts in different cohorts, asserting per-cohort visibility.
- A real tap on a `MenuAction.Url` item confirming `https`-only.
- 50-item menu timing on a real low-end device.
- Screenshots at every viewport in both states, reviewed by eye.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| unknown icon renders a placeholder glyph | `keeps an item with an unknown icon, without an icon` |
| unknown route renders the item anyway | `drops an item with an unknown route` |
| missing label renders the raw key | `drops an item whose labelKey is missing from the active locale` |
| sealed-route check removed from resolution | `drops an item naming a sealed route` |
| duplicate ids both rendered | `de-duplicates two items sharing an id, first wins` |
| predicates re-evaluated per frame | `evaluates each predicate once per manifest change, not per frame` |

## Out of Scope

- Closing the door behind a hidden entrance — SHY-0315 pairs client hiding with
  server refusal. This story only hides.
- Design tokens and theming — the story filed by the SHY-0320 spike.
- Remotely-composed screen layouts — Phase 2.
- Web navigation — Phase 2.

## Dependencies

- **SHY-0310**, **SHY-0311**, **SHY-0312**, **SHY-0313** — the whole pipeline
  below this story.
- **EPIC-0004 must be Done** (EPIC-0011 dependency gate).
- The icon registry is introduced here and consumed by nothing else in Phase 1.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| A dropped item is indistinguishable from a deliberate removal, so a typo looks like a config change | Every drop logs its `id` and reason, and rendered-vs-declared counts are logged so mass-dropping is visible. |
| Hiding an entrance is mistaken for securing a feature | Stated in Out of Scope and in the Security AC; SHY-0315 delivers the server half, and its deep-link AC pins the distinction. |
| An RTL locale renders a server-supplied menu wrongly and no test catches it | Explicit `ar` assertion at both unit and device level. |
| The icon registry becomes an unreviewed dumping ground, eroding the C1 boundary | It is a reviewed, versioned artefact by AC; adding to it is a code change in a PR, which is exactly the friction intended. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] Add / remove / reorder / relabel each **proven on a real Android device and a real iPhone with no reinstall**.
- [ ] Per-cohort visibility proven on two real accounts.
- [ ] Screenshots at every viewport in both states, reviewed by eye.
- [ ] All 20 locales verified on rendered text; `ar` verified for RTL.
- [ ] LOCAL gauntlet 100% green (real Android + real iPhone + all five browsers), then DEV green.
- [ ] `./gradlew :shared:compileKotlinIosArm64` passes.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Story raised from design doc §5.1. Delivers two of the four operator drivers; the earlier stories are plumbing.
- **2026-08-17** — Each unresolvable-reference behaviour is separately specified because they are genuinely different: a missing icon should degrade in place, a missing route should remove the item. Treating them alike gives you either blank squares or dead taps.
- **2026-08-17** — The deep-link AC is deliberate. Hiding a menu entry is a UI change, not an access-control change, and conflating the two is how a "disabled" feature stays reachable.
