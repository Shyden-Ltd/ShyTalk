# Dependabot + Review Standards Enforcement — Design Spec

**Date:** 2026-03-16
**Branch:** `chore/dependabot-review-standards`
**Goal:** Automate dependency updates via Dependabot and enforce coding standards across all enforcement layers (git hooks, CI, Claude hooks).

---

## 1. Dependabot Configuration

**File:** `.github/dependabot.yml`

Four ecosystems, weekly schedule (Monday 06:00 UTC), max 5 open PRs each:

| Ecosystem | Directory | Labels | Grouping |
|-----------|-----------|--------|----------|
| `gradle` | `/` | `dependencies`, `gradle` | Patch updates grouped |
| `npm` | `/express-api` | `dependencies`, `npm` | Patch updates grouped |
| `npm` | `/` | `dependencies`, `npm` | Patch updates grouped |
| `github-actions` | `/` | `dependencies`, `github-actions` | Patch updates grouped |

**Ignored major bumps:** `firebase-bom`, `composeBom`, `agp` (com.android.application), `kotlin`, `composeMultiplatform`, `livekit`, `credentials` — these require careful manual migration due to breaking API changes or tight coupling.

### Auto-merge Workflow

**File:** `.github/workflows/dependabot-auto-merge.yml`

- Triggers on Dependabot PRs only
- Patch versions: auto-approve + auto-merge when CI passes
- Minor/major versions: left for manual review

---

## 2. Linter Setup

### Kotlin — ktlint + detekt

**ktlint:**
- Plugin: `org.jlleitschuh.ktlint` (v12.x) — added to `[plugins]` in `gradle/libs.versions.toml`, referenced via `alias(libs.plugins.ktlint)` in root `build.gradle.kts`
- Applies to `app/` and `shared/` modules
- Config: root `.editorconfig` (Kotlin style rules)
- Tasks: `./gradlew ktlintCheck` (verify) / `./gradlew ktlintFormat` (auto-fix)
- Also install standalone ktlint CLI via npm wrapper (`@naturalcycles/ktlint`) for pre-commit hooks (avoids Gradle cold-start penalty)

**detekt:**
- Plugin: `io.gitlab.arturbosch.detekt` — added to `[plugins]` in `gradle/libs.versions.toml`, referenced via `alias(libs.plugins.detekt)` in root `build.gradle.kts`
- Config: `detekt.yml` — disables noisy rules unsuitable for mobile (MagicNumber, TooManyFunctions, LongParameterList)
- Task: `./gradlew detekt`

### JavaScript — ESLint + Prettier

- ESLint v9 flat config: `express-api/eslint.config.mjs` — `@eslint/js` recommended + node environment
- Prettier: `express-api/.prettierrc` — single quotes, trailing commas `"all"` (Prettier default, matches existing codebase style), 100 char width
- devDependencies in `express-api/package.json`
- Scripts: `npm run lint` / `npm run lint:fix` / `npm run format` / `npm run format:check`

### Root .editorconfig

- UTF-8, LF line endings
- 4-space indent for Kotlin
- 2-space indent for JS, JSON, YAML
- `trim_trailing_whitespace = true`, `insert_final_newline = true`

---

## 3. Git Commit Hooks

**Tools:** Husky v9 + lint-staged at project root.

**Pre-commit hook** runs linters on staged files only:

| File pattern | Command |
|---|---|
| `*.kt` | `npx ktlint --relative` (standalone CLI, avoids Gradle cold-start; check only, no auto-fix) |
| `express-api/**/*.js` | `eslint` + `prettier --check` |
| `*.feature` | `.claude/hooks/check-gherkin.sh` |

**Install:** Husky `prepare` script in root `package.json` — runs on `npm install`, so hooks are automatic for anyone cloning the repo.

**No auto-fix on commit:** Failing and requiring manual fix ensures the developer reviews all changes before committing.

---

## 4. CI Lint Workflow

**File:** `.github/workflows/lint.yml`

Triggers on PR pushes to `main`. Path filtering runs only relevant linters.

| Job | Runs when | Command | Timeout |
|---|---|---|---|
| `kotlin-lint` | `**/*.kt` changed | `./gradlew ktlintCheck detekt` | 10 min |
| `express-lint` | `express-api/**` changed | `cd express-api && npm run lint && npm run format:check` | 5 min |
| `gherkin-lint` | `*.feature` changed | `bash .claude/hooks/check-gherkin.sh` | 2 min |

Workflow-only changes (`.github/`, `.claude/`, `*.md`) skip entirely.

A `lint-gate` summary job runs after all conditional lint jobs and always succeeds if all completed jobs passed (or were skipped). This single `lint-gate` job is the required status check for merge in GitHub branch protection — avoids the "missing check" problem when conditional jobs are skipped due to path filtering.

Runs in parallel with `release.yml` — separate lightweight workflow.

---

## 5. Claude Hooks (Extended)

Existing hooks unchanged. New additions to `.claude/settings.json`:

| Hook | Type | Trigger | Checks |
|---|---|---|---|
| Gherkin quality | `prompt` | Matcher: `Write\|Edit`, prompt filters for `*.feature` files | Scenarios ≤ 15 steps, Background for shared setup, no duplicated tap sequences, descriptive step names |
| Compose testTag | `prompt` | Matcher: `Write\|Edit`, prompt filters for `*Screen.kt` files | New interactive elements (Button, TextField, clickable) should have `testTag` |
| Express route pattern | `prompt` | Matcher: `Write\|Edit`, prompt filters for `express-api/src/routes/*.js` files | `const router = express.Router(); module.exports = router;` pattern, `requireAdmin` guard on admin routes, `logger.*` logging |

Prompt-based (not command) because these are nuanced checks unsuitable for shell scripts. File pattern filtering is done inside the prompt text (same approach as the existing KMP hook), not in the matcher field.

---

## 6. Gherkin Quality Script

**File:** `.claude/hooks/check-gherkin.sh` *(new file to be created)*

Shared by git pre-commit hook (lint-staged) and CI `gherkin-lint` job.

**Rules:**
1. Scenario length — max 15 steps per scenario (Given/When/Then/And/But)
2. Duplicate step sequences — 3+ identical consecutive steps repeated across scenarios in same file
3. Empty scenarios — no scenarios with zero steps
4. Scenario naming — no duplicate scenario names within a feature file

**Not checked:** Step definition correctness (runtime concern), grammar/phrasing (Claude prompt hook handles this).

**Input:** File paths as arguments (lint-staged) or scans `app/src/androidTest/assets/features/*.feature` if no args (CI).

**Exit codes:** 0 = pass, 1 = violations found (details on stderr).

---

## 7. Rollout Strategy — Fix Everything First

### Auto-fix phase
1. `./gradlew ktlintFormat` — auto-fix ~90% of Kotlin style issues
2. `npx prettier --write .` in `express-api/` — fix all JS formatting
3. `npx eslint --fix .` in `express-api/` — fix auto-fixable lint issues

### Manual fix phase
- Remaining ktlint/detekt violations (complexity, unused params)
- Remaining ESLint issues (unused vars, shadowing)

### Commit sequence
1. `chore: add Dependabot configuration`
2. `chore: add ktlint, detekt, ESLint, Prettier configs`
3. `style: auto-fix Kotlin formatting (ktlintFormat)`
4. `style: auto-fix Express formatting (prettier + eslint --fix)`
5. `fix: resolve remaining lint violations manually`
6. `chore: add Husky + lint-staged git hooks`
7. `ci: add lint workflow and Dependabot auto-merge`
8. `chore: extend Claude hooks for Gherkin, Compose, Express standards`

### .gitignore updates
- ktlint/detekt report files are generated in `build/` (already gitignored)
- `.husky/` directory should be committed (contains hook scripts)
- No new gitignore entries needed

### Validation
After all fixes: run full linting + full test suite to confirm nothing broke.
