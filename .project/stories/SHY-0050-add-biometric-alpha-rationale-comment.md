---
id: SHY-0050
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: XS
type: docs
roadmap_ids: [G032]
pr:
mvp: true
---

# SHY-0050: Add rationale comment to `biometric = "1.4.0-alpha07"` in libs.versions.toml

## User Story

As a future ShyTalk maintainer reading `gradle/libs.versions.toml`, I want **`biometric = "1.4.0-alpha07"` to carry an inline rationale comment** naming the API(s) we use that aren't in the stable line, so that the alpha-version dependency isn't mysterious and isn't accidentally downgraded into a broken build.

## Why

Roadmap row (line 108, 2026-06-05): `G032 | 🟡 Polish | Dep — biometric alpha rationale comment | gradle/libs.versions.toml:33 | (companion to G002) | Same fix as G002, polish portion | XS`.

**Clean scope split (operator dedup decision 2026-06-12):** the roadmap biometric fix has two mutually-exclusive outcomes — *downgrade to stable* (owned by [[SHY-0005]], G002) or *keep alpha with a documented rationale comment* (this story, G032). [[SHY-0005]] was narrowed to downgrade-only and **no longer adds any comment itself**, so this story is now the SOLE owner of the rationale-comment deliverable.

The two stories are complementary:

- If [[SHY-0005]]'s downgrade lands → there is no alpha pin left to explain → **this story closes as `Cancelled`** with rationale.
- If [[SHY-0005]]'s downgrade is **blocked** (stable surface lacks an API we depend on) → the alpha stays → **this story ships the inline rationale comment**.

So this story's path is determined by [[SHY-0005]]'s outcome at pickup time.

## Acceptance Criteria

### Happy path

- [ ] **Path COMMENT** (if [[SHY-0005]]'s downgrade is blocked / alpha retained): a comment block directly above the biometric line follows the format `# Required: <API> — stable (<stable-version>) does not ship <feature> yet; downgrade tracked by [[SHY-0005]]`. The comment names the EXACT class + method we depend on and links to the AndroidX release notes for alpha07.
- [ ] **Path CANCEL** (if [[SHY-0005]] downgraded to stable first): no comment needed; this story closes as `Cancelled` with rationale "biometric is stable; no alpha pinning to explain".
- [ ] **Path BLOCKED** (if [[SHY-0005]] is still Draft/unresolved at pickup): this story records the dependency in `## Notes` and waits — it cannot decide its path until 0005 resolves. (Do not guess the API gap; 0005's build result is the evidence.)

### Error paths

- [ ] **The named API rationale is no longer accurate** (we removed the alpha-only usage in the interim): the correct fix is a downgrade, which is [[SHY-0005]]'s job — re-open/hand back to 0005 rather than writing a false comment.
- [ ] **The comment is added but is non-specific** (`# Alpha required`, no API named): the `code-reviewer` flags it as a finding; the comment cannot merge until it names a concrete class + method.

### Edge cases

- [ ] **Multiple alpha-pinned deps** in `libs.versions.toml`: out of scope; this story only covers `biometric`. (If others exist, file separate SHYs.)
- [ ] **Comment-style consistency** with existing `libs.versions.toml` comments — match the surrounding `#` comment style (check the file's current convention before writing).

### Performance

- N/A — a code comment adds no runtime, build, or APK-size cost. (The build still compiles identically; proven by the gauntlet's build step, not assumed.)

### Security

- N/A — comment only; no code, dependency, or secret change. (Documenting that the pin is an alpha is mildly *security-positive*: it makes the un-pen-tested pre-release dep visible to future audits.)

### UX

- N/A — maintainer-facing inline documentation; no user surface.

### i18n

- N/A — code comment, English only (internal config file, never surfaced to users).

### Observability

- [ ] PR description records [[SHY-0005]]'s status at pickup time and states which path (COMMENT / CANCEL / BLOCKED) was taken.

## BDD Scenarios

**Scenario: rationale comment present after this story ships**

- **Given** [[SHY-0005]]'s downgrade was blocked and biometric stays on alpha07
- **When** a maintainer reads `gradle/libs.versions.toml` at the biometric line
- **Then** there is a comment block above it naming the required API + the stable-version gap + an [[SHY-0005]] cross-link

**Scenario: Cancelled if the downgrade lands first**

- **Given** [[SHY-0005]] downgraded biometric to stable
- **When** this story is picked up
- **Then** it closes as `Cancelled` with rationale "biometric stable; no alpha pinning to explain"

**Scenario: reviewer rejects a non-specific comment**

- **Given** a draft PR with a generic `# Alpha required` comment
- **When** the `code-reviewer` reads the biometric line
- **Then** the comment is flagged and cannot merge until it names a concrete class + method

## Test Plan

**Red:** N/A — a comment-only change has no behaviour to assert with a unit test. The "test" is the gauntlet's build/compile step proving the comment doesn't break TOML parsing, plus the `code-reviewer` enforcing comment specificity.

**Green:**
- Read [[SHY-0005]]'s status + the current `libs.versions.toml` biometric line.
- Path COMMENT → add the rationale comment. Path CANCEL → close as Cancelled. Path BLOCKED → record + wait.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** — this edits `gradle/libs.versions.toml`, not a `.md` file, so the device gauntlet is NOT formally exempt. BUT the change is a single TOML comment with **zero behaviour change**, so the gauntlet collapses to its build/regression floor:

- ✅ **Gradle build/compile** — `./gradlew assembleDevDebug` + `./gradlew :shared:compileKotlinIosArm64` must still succeed (proves the comment didn't corrupt TOML parsing / version-catalog resolution).
- ✅ **Kotlin/JVM unit + detekt + ktlint** — must stay green (no Kotlin changed; this is the no-regression assertion).
- ✅ **Manual-QA journey matrix** — the full regression corpus on the real Android device (the comment cannot change biometric behaviour, but we *prove* it didn't rather than assume) — impact-selected = lock-screen/biometric journey; full corpus at the pre-push gate.
- ⬜ **Web E2E / integration / eslint / Express Jest / iOS XCTest / XCUITest** — N/A (no web, API, or iOS-app surface touched); the iOS app + web journeys still run as the regression net per the protocol.
- ✅ **SonarCloud** — quality gate (will be a near-no-op on a comment).

**LOCAL gauntlet:** build + full regression corpus green on the real Android device; web regression-only across the `local` browser matrix. **DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; real-device regression; web = Chrome only. Any failure → fix TDD → restart from LOCAL. **Judgment-merge** only when production-ready with zero doubt.

(If Path CANCEL is taken, the gauntlet is moot — a Cancelled story ships no code.)

## Out of Scope

- **Downgrading biometric** — owned by [[SHY-0005]] (G002).
- **Rationale comments on OTHER alpha-pinned deps** — separate SHYs.
- **Refactoring `libs.versions.toml` structure.**

## Dependencies

- **[[SHY-0005]]** (biometric downgrade, Draft) — MUST resolve first to determine this story's path (COMMENT / CANCEL). Mutually exclusive outcome.

## Risks & Mitigations

- **Risk: this story is redundant after [[SHY-0005]]'s downgrade lands.** Mitigation: the explicit `Cancelled` pathway in AC + the dependency on 0005's outcome.
- **Risk: the comment goes stale if biometric stable later GAs the API.** Mitigation: the comment links to [[SHY-0005]] so the future-downgrade tracker's pickup naturally re-evaluates the comment.

## Definition of Done

- [ ] Path COMMENT / CANCEL / BLOCKED applied per [[SHY-0005]]'s state at pickup time.
- [ ] If Path COMMENT: the rationale comment names a concrete class + method + links the AndroidX release notes + cross-links [[SHY-0005]].
- [ ] If Path COMMENT: **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol) at its comment-only floor — gradle build/compile green + full regression corpus green on the real Android device (LOCAL) → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green (real devices; web = Chrome) → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `code-reviewer` ZERO findings (or `Cancelled` with rationale).
- [ ] `released_in: vX.Y.Z` after release cut; `status: Done` (or `Cancelled`).

## Notes (running log)

- 2026-06-08 ~13:15 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 108 (G032). Reserved ID SHY-0050.
- 2026-06-12 ~23:25 BST — **Realigned as the SOLE owner of the rationale comment** (operator dedup decision, [[SHY-0091]] pass). [[SHY-0005]] was narrowed to downgrade-only and no longer adds any comment, so the old "0005 might add the comment too" framing was removed; this story's path (COMMENT / CANCEL) is now cleanly determined by 0005's downgrade outcome. Embedded the **Pre-Merge Testing Protocol** at its comment-only floor (not `*.md`-only since it edits `.toml`: build/compile + full regression corpus prove no behaviour change). DoD: → **judgment-merge**.
</content>
