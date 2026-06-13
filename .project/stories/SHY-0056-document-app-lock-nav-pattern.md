---
id: SHY-0056
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: XS
type: docs
roadmap_ids: [G041]
pr:
mvp: true
---

# SHY-0056: Document App Lock navigation intercept pattern in CLAUDE.md

## User Story

As a future ShyTalk Claude session OR new contributor reading `CLAUDE.md`, I want **the App-Lock navigation intercept pattern** (Lock/PinSetup/SecuritySettings are routed OUTSIDE the standard `SharedNavGraph` via `MainActivity`'s `AppLockRepository` intercept) **documented in the Architecture section**, so that the architectural surprise doesn't cause future "why isn't this screen in NavGraph?" confusion.

## Why

Roadmap row (line 106, 2026-06-05): `G041 | 🟡 Polish | Doc — App Lock nav pattern undocumented | CLAUDE.md Architecture section | Lock/PinSetup/SecuritySettings intercept via MainActivity not documented | Add "App Lock Navigation" note | XS`.

The pattern works (and is intentional — App Lock has to gate ALL navigation including back-button), but it's load-bearing weirdness that newcomers will trip over. Documenting saves debugging time.

## Acceptance Criteria

### Happy path

- [ ] New subsection in `CLAUDE.md § Architecture` titled "App Lock Navigation" or similar.
- [ ] Content covers: (a) which screens use the intercept (Lock, PinSetup, SecuritySettings), (b) which file owns the intercept (`MainActivity`), (c) how the intercept interacts with `AppLockRepository`, (d) why it's NOT in `SharedNavGraph` (back-button + system-level gate requirement), (e) iOS equivalent if any.
- [ ] Cross-links from any relevant places in CLAUDE.md (e.g. `Screen.kt:75-80` mentions if applicable).
- [ ] Companion: the iOS-side pattern (if it differs) gets a sentence.

### Error paths

- [ ] **Pattern has changed since the 2026-06-05 audit** (e.g. migrated to SharedNavGraph): re-audit by reading MainActivity + AppLockRepository; if migrated, file deprecation SHY for the old pattern.

### Edge cases

- [ ] **iOS implementation differs**: documenting Android-only is acceptable; flag iOS as TBD if a separate pattern exists.
- [ ] **Tests covering this pattern**: cross-link to test files for "how is it verified."

### Performance

- [ ] N/A.

### Security

- [ ] App Lock IS security-relevant — verify the doc accurately describes the intercept's security contract (e.g. no nav-graph entries bypass the lock).

### UX

- [ ] N/A — internal doc.

### i18n

- [ ] N/A.

### Observability

- [ ] N/A.

## BDD Scenarios

**Scenario: Architecture section gains App Lock subsection**

- **Given** CLAUDE.md is opened
- **When** the reader searches for "App Lock"
- **Then** a subsection in Architecture covers the intercept pattern
- **And** it names the 3 screens + the owning file + the rationale

**Scenario: Reader avoids the "why not NavGraph" confusion**

- **Given** a new contributor reading the navigation section
- **When** they encounter Lock/PinSetup/SecuritySettings in `Screen.kt` but NOT in `SharedNavGraph.kt`
- **Then** the App Lock subsection explains the intentional design
- **And** points at MainActivity for the intercept code

## Test Plan

**Red:** read CLAUDE.md; verify no current App Lock subsection.

**Green:**
- Read MainActivity + AppLockRepository to confirm current behaviour.
- Author subsection.
- Verify text accuracy against code.

**Coverage gate:** subsection exists + content matches code reality.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**`*.md`-only → device/browser gauntlet EXEMPT** (the sole exemption): this story edits **only `CLAUDE.md`** (a new Architecture subsection), touching no app/web/server/CI surface — so the full real-device/all-browser gauntlet does not apply.

**Verification (the exemption still demands real evidence — a doc that doesn't match code is a "stub doc"):**
- ✅ Every claim in the subsection is **verified against the real source** — read the live `MainActivity` + `AppLockRepository` to confirm the intercept pattern, the 3 gated screens, and (Security dimension) that **no `SharedNavGraph` entry bypasses the lock** — never paraphrase the 2026-06-05 audit (per `CLAUDE.md` § No Stubs / Mocks / Fakes — Real Only: describe reality, not a remembered snapshot). Add a `<!-- last verified -->` date stamp.
- ✅ `scripts/check-story-frontmatter.sh` exit 0; `code-reviewer` 100% clean.
- ⬜ Kotlin/Web/Android/iOS frameworks · CI lints — N/A (a CLAUDE.md doc edit; no code change).

**No LOCAL/DEV device gauntlet** — `*.md`-only exemption. **Judgment-merge** when the prose is confirmed accurate against the live code and review is clean; NO auto-merge.

## Out of Scope

- Refactoring MainActivity / AppLockRepository.
- Migrating Lock screens INTO SharedNavGraph (would be a separate L-scope SHY).
- Documenting other non-NavGraph navigation patterns (none known).

## Dependencies

- `app/src/main/.../MainActivity.kt` (must exist + use the intercept pattern).
- `AppLockRepository` (must exist).
- CLAUDE.md exists.

## Risks & Mitigations

- **Risk: pattern subtly changed since audit.** Mitigation: re-verify by reading code before writing.
- **Risk: doc becomes stale if MainActivity refactors.** Mitigation: add a `<!-- last verified -->` date stamp.

## Definition of Done

- [ ] Subsection added; accurate against code.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): `*.md`-only → device gauntlet EXEMPT; the subsection verified accurate against the live `MainActivity`/`AppLockRepository` (incl. the security contract) + `code-reviewer` 100% clean → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated.

## Notes (running log)

- 2026-06-08 ~13:22 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 106 (G041). Reserved ID SHY-0056.
- 2026-06-13 ~01:27 BST — **Embedded the Pre-Merge Testing Protocol (exemption form)** ([[SHY-0091]] pass): `*.md`-only (new CLAUDE.md Architecture subsection) → device/browser gauntlet EXEMPT. The exemption still requires REAL evidence — every claim verified against the LIVE `MainActivity` + `AppLockRepository` (incl. the security contract that no NavGraph entry bypasses the lock), never paraphrasing the 2026-06-05 audit; a doc that doesn't match code is a "stub doc" ([[feedback-no-stubs-mocks-fakes-real-only]] applied to prose). DoD swaps the stale Reviewer-ZERO line for protocol-satisfied(exempt) + judgment-merge + released_in + `pr:`. Pickup-fitness: AC current; the Error-path "pattern may have changed since the 2026-06-05 audit" check IS the live re-verify gate — confirm against code at pickup before writing.
