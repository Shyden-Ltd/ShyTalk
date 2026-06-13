---
id: SHY-0049
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: XS
type: infra
roadmap_ids: [G031]
pr:
mvp: true
---

# SHY-0049: Add `check-kotlin-prerelease.sh` CI gate (fires when Kotlin stable lands)

## User Story

As a dependency-hygiene-conscious ShyTalk maintainer, I want **a CI gate that fails when Kotlin is pinned to a pre-release version (`-RC`, `-alpha`, `-beta`, `-Mx`) AND a stable release exists on Maven Central**, so that the team can't silently stay on RC2 once 2.4.0 stable ships and so that any future Kotlin upgrade naturally lands on stable (companion to [[SHY-0041]]).

## Why

Roadmap row (line 107, 2026-06-05): `G031 | 🟡 Polish | Dep CI gate — pre-release Kotlin check | gradle/libs.versions.toml:3 | No CI check for when stable becomes available | check-kotlin-prerelease.sh failing on -RC/-alpha/-beta when stable on Maven Central; wire into lint.yml | XS`.

Companion to [[SHY-0041]] (which does the actual bump). This SHY adds the GATE so [[SHY-0041]] becomes a one-time concern, not a recurring oversight.

## Acceptance Criteria

### Happy path

- [ ] New `scripts/check-kotlin-prerelease.sh` — parses `gradle/libs.versions.toml:3` (or wherever `kotlin = "..."` is); if value ends in `-RC*`/`-alpha*`/`-beta*`/`-Mx`, query Maven Central metadata; if a stable version exists, exit non-zero with a clear message naming the stable version + linking to [[SHY-0041]] for the bump path.
- [ ] If no stable exists yet (or current value is already stable), exit 0.
- [ ] Wired into `.github/workflows/lint.yml` as a new step after `Release workflow contract`.
- [ ] Wired into `.husky/pre-push` after `check-release-trigger.sh`.
- [ ] Jest tests at `express-api/tests/scripts/check-kotlin-prerelease.test.js`: stable-pinned → exit 0; pre-release-pinned + stable-exists → exit non-zero; pre-release-pinned + no-stable-yet → exit 0 with informational warning; missing-file → exit 2 usage error; network-failure-on-Maven-lookup → exit 0 with warning (don't block CI on transient infra).
- [ ] `shellcheck` clean.

### Error paths

- [ ] **Maven Central HTTP 5xx**: print warning to stderr, exit 0 (don't block CI on transient infra). Networking failures are NOT defects in our config.
- [ ] **`libs.versions.toml` missing `kotlin = "..."`**: exit 2 with clear "kotlin version line not found" message.
- [ ] **Pre-release suffix not recognised** (e.g. `2.4.0-eap-12`): treat as pre-release; gate fires.
- [ ] **Maven metadata XML format changes**: parser uses awk/sed on simple `<latest>...</latest>` extraction; fragile but verifiable.

### Edge cases

- [ ] **Multiple kotlin lines in toml** (e.g. `kotlin = "..."` + `kotlin-x-serialization = "..."`): only the first match (the Kotlin compiler version) is gated.
- [ ] **Kotlin version specified via `gradle.properties` instead of `libs.versions.toml`**: gate also checks `gradle.properties` if present.
- [ ] **Stable version is older than RC** (e.g. 2.3.32 stable + 2.4.0-RC2 pinned): gate suppresses — don't downgrade.
- [ ] **`2.4.0` lands while CI run is mid-flight**: lookup is per-run; race acceptable (next run will fire correctly).

### Performance

- [ ] Lookup completes in <5s (single HTTP GET to Maven Central + awk parse).
- [ ] Caching not needed — single per-CI-run check.

### Security

- [ ] No credentials needed (Maven Central is public).
- [ ] HTTPS-only URL (`https://repo.maven.apache.org/...`).
- [ ] No command injection — version string compared via shell string equality, not eval.

### UX

- [ ] N/A — CI gate.

### i18n

- [ ] N/A.

### Observability

- [ ] On failure: clear `::error::` message with current version, latest-stable, link to [[SHY-0041]], + remediation instruction.
- [ ] On network warning: `::warning::` annotation in CI logs.

## BDD Scenarios

**Scenario: Stable Kotlin pinned → gate passes silently**

- **Given** `gradle/libs.versions.toml` contains `kotlin = "2.4.0"`
- **When** `bash scripts/check-kotlin-prerelease.sh` runs
- **Then** the script exits 0
- **And** stderr is empty (no errors or warnings)

**Scenario: Pre-release pinned + stable available → gate fails**

- **Given** `gradle/libs.versions.toml` contains `kotlin = "2.4.0-RC2"`
- **And** Maven Central's latest Kotlin is `2.4.0` stable
- **When** the script runs
- **Then** the script exits non-zero
- **And** stderr contains `::error::` naming the stable version + [[SHY-0041]] reference

**Scenario: Pre-release pinned + no stable yet → gate passes with warning**

- **Given** `kotlin = "2.4.0-RC2"`
- **And** Maven Central's latest Kotlin is `2.4.0-RC3`
- **When** the script runs
- **Then** the script exits 0
- **And** stderr contains `::warning::` informational note

**Scenario: Network failure → gate doesn't block CI**

- **Given** Maven Central returns HTTP 503
- **When** the script runs
- **Then** the script exits 0
- **And** stderr contains a transient-failure warning

## Test Plan

**Red:**
- New `express-api/tests/scripts/check-kotlin-prerelease.test.js` — 5 cases per AC. **No mocked Maven responses** (per `CLAUDE.md` § No Stubs / Mocks / Fakes — Real Only): each case drives the script against the **real** Maven Central using immutable historical coordinates that genuinely exhibit the state — a real old RC (e.g. `2.0.0-RC1`) whose real stable (`2.0.0`) exists → gate fires; a real stable pin → exit 0; an injectable `MAVEN_METADATA_URL` pointed at a **real unreachable host** for the network-failure path (a real `curl` failure, not a mocked 503); a real nonexistent toml path for exit-2. The "pre-release + no-stable-yet" case uses a real perpetually-pre-release coordinate if one exists, else 🚩 escalate (never a fixture metadata file).

**Green:**
- Author `scripts/check-kotlin-prerelease.sh` (~80 lines bash).
- Wire into `lint.yml` + `.husky/pre-push`.
- Run tests + shellcheck + actionlint.

**Coverage gate:** 5 Jest cases pass; shellcheck + actionlint clean.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (adds a bash script + Jest tests + `lint.yml`/`.husky/pre-push` wiring) → the FULL protocol applies. CI-gate tooling with no app/web surface; the proof is the gate really firing/passing against **real Maven Central**.

**Frameworks exercised (RED→GREEN):**
- ✅ **Express Jest** — the 5 `check-kotlin-prerelease.test.js` cases, each driving the **real script against real Maven Central** via immutable historical coordinates (no mocked responses — see the scrubbed Red step above).
- ✅ **shellcheck** — `check-kotlin-prerelease.sh` (warnings = failures).
- ✅ **actionlint** — the `lint.yml` step wiring.
- ✅ **eslint** (`--max-warnings=0`) — the test JS.
- ⬜ **app/web/iOS UI · Kotlin unit · detekt/ktlint** — N/A (the gate inspects the version pin; it changes no app/shared code).

**No-Stubs (scrubbed):** the original Red step "mocks the Maven Central response" is replaced by **real immutable Maven coordinates** (Maven Central never deletes versions, so a real RC + its real stable reproduce the fire-state deterministically forever) + a **real unreachable URL** for the network-failure path. **🚩** the "pre-release + no-stable-yet" state is the one hard-to-find condition → a real perpetually-pre-release coordinate, or escalate — never a fixture metadata file.

**LOCAL gauntlet:** Jest (real-Maven) + shellcheck + actionlint + eslint green locally; the pre-push hook wiring exercised by a real push. Any failure → fix TDD → restart.
**DEV gauntlet:** push to the branch and confirm the new `lint.yml` step runs the gate on the **real** pipeline (passes on the current stable pin; the fire-path is proven by the Jest real-Maven cases). Restart from LOCAL on failure.
**Judgment-merge** only when production-ready with zero doubt; NO auto-merge.

## Out of Scope

- Bumping Kotlin itself — covered by [[SHY-0041]].
- Gating on other pre-release dependencies — separate SHYs per dep family.
- Auto-bumping (Dependabot-style) — only check + report.

## Dependencies

- `gradle/libs.versions.toml` exists.
- `curl` + `awk` available (standard CI runner).
- `shellcheck` for local lint.
- Optional: `gh` for Dependabot integration follow-up (out of scope here).

## Risks & Mitigations

- **Risk: Maven Central URL format changes.** Mitigation: pin URL form; update if breaks.
- **Risk: parser hits a Kotlin pre-release suffix I didn't anticipate.** Mitigation: regex covers `-RC`, `-alpha`, `-beta`, `-Mx`, `-eap`; refine post-merge if new form appears.
- **Risk: gate is overly chatty in dev** (every push prints stable check). Mitigation: only emit on failure or network-warning paths.

## Definition of Done

- [ ] Script + 5 Jest tests + lint.yml wiring + pre-push wiring.
- [ ] shellcheck + actionlint + Jest all green.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): the 5 Jest cases green against real Maven Central + shellcheck + actionlint + eslint clean → `code-reviewer` 100% clean → push → CI green by name (the new gate step runs on the real pipeline) → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~13:15 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 107 (G031). Reserved ID SHY-0049.
- 2026-06-13 ~01:11 BST — **Embedded the Pre-Merge Testing Protocol + No-Stubs scrub** ([[SHY-0091]] pass, [[feedback-no-stubs-mocks-fakes-real-only]]): CI-gate tooling → Jest headline driven against REAL Maven Central. Scrubbed the Red step's "mocks the Maven Central response" → real immutable coordinates (a real RC + its real stable reproduce the fire-state forever; Maven never deletes versions) + a real unreachable URL for the network-failure path (real curl failure, not a mocked 503); 🚩 the "pre-release + no-stable-yet" case uses a real perpetually-pre-release coordinate or escalates. DoD swaps the stale Reviewer-ZERO line for protocol-satisfied + judgment-merge + released_in. Pickup-fitness: AC current; companion [[SHY-0041]] (the actual bump) + the live `libs.versions.toml` kotlin pin need the read-and-confirm at pickup.
