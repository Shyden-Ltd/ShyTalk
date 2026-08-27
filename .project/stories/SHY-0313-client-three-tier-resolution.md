---
id: SHY-0313
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

# SHY-0313: The app works having never reached the server, and improves when it does

## User Story

As a **user opening the app**, I want it to appear instantly and work fully even
on first launch, on a plane, or when the server is down, so that a
server-driven interface never means a blank screen waiting on a network call.

## Why

Moving the interface onto a network resource creates a failure mode the app has
never had: **there may be no interface yet.** First launch has no cache. A plane
has no network. A bad deploy has no server. If any of those produces a blank or
a spinner, server-driven UI has made the product worse, not better.

The answer is three tiers, tried in order, with a guarantee at the bottom:

> **fresh fetch** → **disk cache** (last good) → **bundled default** (always present)

The bundled default is the load-bearing one and the easiest to under-build. It is
compiled into the binary from the same `manifests/base.json` the server serves,
generated at build time so it cannot drift from the schema. It means the app is
**fully usable having never reached the server** — not degraded, not
read-only, fully usable.

The second requirement is that **nothing waits.** `current()` is synchronous and
returns immediately from cache or bundled defaults; `refresh()` runs in the
background and applies on the next natural recomposition. This is the same
optimistic-cold-start principle EPIC-0004 builds, which is why EPIC-0011 is
gated behind it — putting a network call on the cold-start critical path would
undo that work.

The disk cache is written **only after a successful parse**, so a corrupt
document can never become the cached "last good" one. That ordering is the whole
of the cache's correctness.

## Acceptance Criteria

### Happy path

- [ ] On first launch with no network, the app renders fully from bundled defaults with no spinner and no blank frame.
- [ ] With a reachable server, a fresh manifest is fetched in the background and applied without a restart.
- [ ] A successfully parsed manifest is written to disk and used on the next cold start before any network call completes.
- [ ] `current()` returns a `ResolvedManifest` whose `tier` correctly reports `REMOTE`, `CACHE` or `BUNDLED`.

### Error paths

- [ ] A network failure leaves the previously cached manifest in force; nothing visibly changes.
- [ ] A `500` from the endpoint is treated as a network failure — the cache is retained, not cleared.
- [ ] A response that fails `parseManifest` is discarded and the previous cached manifest retained; the disk cache is NOT overwritten.
- [ ] A corrupt on-disk cache falls through to bundled defaults and the corrupt file is replaced, not left to fail on every launch.

### Edge cases

- [ ] A manifest whose `minAppVersion` exceeds this build is ignored; the previous tier stays in force.
- [ ] Two concurrent `refresh()` calls result in one in-flight request, not two.
- [ ] A `304` response is not mistaken for an empty manifest — the cached document remains in force.
- [ ] A manifest arriving mid-session applies on the next recomposition without tearing the current screen.
- [ ] Clearing app data returns the app to bundled defaults, not to a broken state.

### Performance

- [ ] `current()` completes in under 5 ms, asserted — it must be safe to call during composition.
- [ ] Cold start is not measurably slower than before this story, asserted against a real device baseline.
- [ ] `refresh()` never runs on the main thread.

### Security

- [ ] The disk cache is written to app-private storage on both platforms; a test asserts the path is not world-readable.
- [ ] A cached manifest is re-validated on read, not trusted because it was valid when written — the file could have been tampered with on a rooted device.
- [ ] A manifest referencing a sealed screen is degraded on the client too, not only rejected at publish time — defence in depth for a document that somehow shipped.

### UX

- [ ] No spinner, skeleton or blank frame is ever shown while waiting for a manifest.
- [ ] A manifest applying mid-session does not reset the user's scroll position or navigation state.
- [ ] Screenshots captured on real Android and real iPhone at every supported viewport, in bundled-default and remote states, and reviewed by eye — a green suite is not proof this looks right.

### i18n

- [ ] Bundled defaults carry all 20 locales, so a first-launch user in any language sees their own.
- [ ] A server string override applies in the user's current locale without a restart.
- [ ] Switching locale mid-session uses the already-fetched manifest with no refetch.

### Observability

- [ ] Every resolution logs which tier served it and the `manifestVersion`, so "what was this user looking at" is answerable.
- [ ] Every `degraded` section from `parseManifest` is logged with its name.
- [ ] A fall-through to bundled defaults logs at warn level — it is normal on first launch and a signal at any other time.

## BDD Scenarios

**Scenario: The app works on first launch with no internet**

- **Given** a freshly installed app on a device with no internet
- **When** the user opens it
- **Then** the app appears immediately and is fully usable

**Scenario: New settings arrive without the user waiting**

- **Given** an app showing the settings it already had
- **When** the server sends newer settings
- **Then** the app updates to them without restarting
- **And** the user never waited on a loading screen

**Scenario: Unreadable settings from the server change nothing**

- **Given** an app with working settings
- **When** the server sends settings the app cannot read
- **Then** the app keeps the settings it already had

**Scenario: Losing the network does not change the app**

- **Given** an app that has already received its settings
- **When** the device goes offline and the user reopens the app
- **Then** the app appears exactly as it did before

## Test Plan

**RED first**, across three layers, because this story spans pure logic, real
disk and real devices.

### Kotlin unit (`shared/src/commonTest/kotlin/.../manifest/`)

- `ManifestSourceTest.kt`
  - `current returns BUNDLED when no cache exists`
  - `current returns CACHE when a valid cache exists`
  - `current returns REMOTE after a successful refresh`
  - `current completes in under 5ms`
  - `refresh coalesces two concurrent calls into one request`
  - `a failed parse leaves the cache untouched`
  - `a 304 leaves the cached document in force`
  - `a manifest above minAppVersion is ignored`
  - `a corrupt cache falls through to bundled and is replaced`
  - `a cached manifest is re-validated on read`
  - `a sealed-route reference is degraded client-side`

### Integration, real disk + real stack

- Real Express + real emulator: fetch, verify disk write, kill the process,
  cold start, assert the cached manifest is in force before any network call.
- Real corrupt file written to the real cache path, assert fall-through and
  replacement.

### Device, REAL Android + REAL iPhone (no emulator/simulator)

- **Airplane mode, radio genuinely off**, fresh install: app opens fully usable.
  This is the story's headline and cannot be proven any other way.
- Manifest edited server-side, app already running: change appears with no
  reinstall and no restart.
- Cold-start timing against a pre-story baseline on the same device.
- Screenshots at every supported viewport in both bundled and remote states.

### Mutation proof

| Mutation | Must kill |
| -------- | --------- |
| disk cache written before parse succeeds | `a failed parse leaves the cache untouched` |
| `current()` awaits `refresh()` | `current completes in under 5ms` |
| `304` treated as an empty manifest | `a 304 leaves the cached document in force` |
| cached manifest trusted without re-validation | `a cached manifest is re-validated on read` |
| `minAppVersion` check dropped | `a manifest above minAppVersion is ignored` |
| refresh coalescing removed | `refresh coalesces two concurrent calls into one request` |

## Out of Scope

- Consuming the manifest to draw navigation or menus — SHY-0314.
- Applying tokens to the theme — the story filed by the SHY-0320 spike.
- The endpoint itself — SHY-0312.
- Web consumption — Phase 2 (operator decision 2026-08-17).

## Dependencies

- **SHY-0310** — model and parser.
- **SHY-0311** — `isSealedRoute` for client-side degradation.
- **SHY-0312** — the endpoint, including its `304` semantics.
- **EPIC-0004 must be Done.** This story's resolution logic lands inside the
  cold-start path that EPIC-0004 rewrites; it cannot be built against the old one.
- Interface contract `ManifestSource.current()` / `refresh()` fixed in the Phase 1 plan.

## Risks & Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| The bundled default drifts from the schema and first launch breaks | Generated from `manifests/base.json` at build time, not hand-maintained. A drift is a build failure. |
| A network call sneaks onto the cold-start critical path | `current()` is synchronous by signature and pinned by a 5 ms assertion; making it await is in the mutation table. |
| Airplane-mode behaviour is asserted in a test but never seen on a device | The device test requires the radio genuinely off on real hardware. Per this repo's real-only rule, a simulated offline state does not count. |
| A corrupt cache bricks the app on every launch | Explicit AC + test: fall through AND replace. Replacement is the half that is easy to omit. |
| Cold start regresses and nobody notices | Measured against a real pre-story device baseline, in the DoD. |

## Definition of Done

- [ ] Every AC checkbox above is met.
- [ ] Every named test exists, was observed RED first, and is now green.
- [ ] Every mutation killed its named test and was reverted with a git-verified clean tree.
- [ ] **Proven on a real Android device and a real iPhone with the radio off**, fresh install, app fully usable.
- [ ] Screenshots reviewed by eye at every viewport in both bundled and remote states.
- [ ] Cold start not measurably slower than the recorded baseline.
- [ ] LOCAL gauntlet 100% green (real Android + real iPhone + all five browsers), then DEV green.
- [ ] `./gradlew :shared:compileKotlinIosArm64` passes.
- [ ] `code-reviewer` 100% clean; `Reviewed-up-to: <sha>` in Notes.
- [ ] CI green by name: **Detect Changes**, **Analyze JavaScript**, **PR Gate**.
- [ ] `bash scripts/pre-merge-check.sh <PR#>` emits `PRE-MERGE-CHECK: OK`.
- [ ] Status `In Review` before merge; `Done` on release cut with `released_in:`.

## Notes (running log)

- **2026-08-17** — Story raised from design doc §4.2. The three-tier order and the "never blocks first paint" rule are constraints C8/C9 in the Phase 1 plan, binding on every story.
- **2026-08-17** — Cache-write-after-parse is called out separately in the AC because it is the whole of the cache's correctness: writing before validating lets one corrupt response poison every subsequent cold start.
- **2026-08-17** — Gated behind EPIC-0004 deliberately. Building the resolver against today's cold start would mean rewriting it when EPIC-0004 lands, which is the duplicated-design cost the sequencing decision exists to avoid.
