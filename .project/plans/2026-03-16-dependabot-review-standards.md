# Dependabot + Review Standards Enforcement — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate dependency updates via Dependabot and enforce coding standards across git hooks, CI, and Claude hooks — with a clean slate (fix all existing violations first).

**Architecture:** Dependabot creates PRs for 4 ecosystems with patch auto-merge. Linting via ktlint + detekt (Kotlin) and ESLint + Prettier (JS). Enforcement at three layers: Husky pre-commit hooks (local), GitHub Actions lint workflow (CI), and Claude prompt hooks (intelligent checks).

**Tech Stack:** Dependabot, ktlint (Gradle plugin + standalone CLI), detekt, ESLint v9, Prettier, Husky v9, lint-staged, GitHub Actions.

**Spec:** `.project/specs/2026-03-16-dependabot-review-standards-design.md`

---

## Chunk 1: Dependabot Configuration

### Task 1: Create Dependabot config

**Files:**
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Create the Dependabot configuration file**

```yaml
# .github/dependabot.yml
version: 2
updates:
  # Gradle dependencies (libs.versions.toml)
  - package-ecosystem: "gradle"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
      timezone: "UTC"
    labels:
      - "dependencies"
      - "gradle"
    open-pull-requests-limit: 5
    groups:
      patch-updates:
        update-types:
          - "patch"
    ignore:
      - dependency-name: "com.google.firebase:firebase-bom"
        update-types: ["version-update:semver-major"]
      - dependency-name: "com.android.application"
        update-types: ["version-update:semver-major"]
      - dependency-name: "org.jetbrains.kotlin.multiplatform"
        update-types: ["version-update:semver-major"]
      - dependency-name: "org.jetbrains.kotlin.plugin.compose"
        update-types: ["version-update:semver-major"]
      - dependency-name: "org.jetbrains.compose"
        update-types: ["version-update:semver-major"]
      - dependency-name: "androidx.compose:compose-bom"
        update-types: ["version-update:semver-major"]
      - dependency-name: "io.livekit:livekit-android"
        update-types: ["version-update:semver-major"]
      - dependency-name: "androidx.credentials:credentials"
        update-types: ["version-update:semver-major"]

  # Express API npm dependencies
  - package-ecosystem: "npm"
    directory: "/express-api"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
      timezone: "UTC"
    labels:
      - "dependencies"
      - "npm"
    open-pull-requests-limit: 5
    groups:
      patch-updates:
        update-types:
          - "patch"

  # Root npm dependencies (Playwright, sharp)
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
      timezone: "UTC"
    labels:
      - "dependencies"
      - "npm"
    open-pull-requests-limit: 5
    groups:
      patch-updates:
        update-types:
          - "patch"

  # GitHub Actions
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
      timezone: "UTC"
    labels:
      - "dependencies"
      - "github-actions"
    open-pull-requests-limit: 5
    groups:
      patch-updates:
        update-types:
          - "patch"
```

- [ ] **Step 2: Commit**

```bash
git add .github/dependabot.yml
git commit -m "chore: add Dependabot configuration for Gradle, npm, and GitHub Actions"
```

### Task 2: Create Dependabot auto-merge workflow

**Files:**
- Create: `.github/workflows/dependabot-auto-merge.yml`

- [ ] **Step 1: Create the auto-merge workflow**

```yaml
# .github/workflows/dependabot-auto-merge.yml
name: Dependabot Auto-merge

on: pull_request

permissions:
  contents: write
  pull-requests: write

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    timeout-minutes: 5
    steps:
      - name: Fetch Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@v2
        with:
          github-token: "${{ secrets.GITHUB_TOKEN }}"

      - name: Auto-approve patch updates
        if: steps.metadata.outputs.update-type == 'version-update:semver-patch'
        run: gh pr review --approve "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Auto-merge patch updates
        if: steps.metadata.outputs.update-type == 'version-update:semver-patch'
        run: gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/dependabot-auto-merge.yml
git commit -m "ci: add Dependabot auto-merge workflow for patch updates"
```

---

## Chunk 2: Kotlin Linter Setup (ktlint + detekt)

### Task 3: Add ktlint and detekt plugins to version catalog

**Files:**
- Modify: `gradle/libs.versions.toml`

- [ ] **Step 1: Add ktlint and detekt versions and plugins**

Add to `[versions]` section:
```toml
ktlint = "12.3.0"
detekt = "1.23.7"
```

Add to `[plugins]` section:
```toml
ktlint = { id = "org.jlleitschuh.gradle.ktlint", version.ref = "ktlint" }
detekt = { id = "io.gitlab.arturbosch.detekt", version.ref = "detekt" }
```

- [ ] **Step 2: Commit**

```bash
git add gradle/libs.versions.toml
git commit -m "chore: add ktlint and detekt plugin versions to catalog"
```

### Task 4: Apply ktlint and detekt plugins to build

**Files:**
- Modify: `build.gradle.kts`

- [ ] **Step 1: Add ktlint and detekt plugins to root build.gradle.kts**

Add to the `plugins {}` block:
```kotlin
alias(libs.plugins.ktlint) apply false
alias(libs.plugins.detekt)
```

Add below the `plugins {}` block:
```kotlin
subprojects {
    apply(plugin = "org.jlleitschuh.gradle.ktlint")

    configure<org.jlleitschuh.gradle.ktlint.KtlintExtension> {
        version.set("1.5.0")
        android.set(true)
        outputToConsole.set(true)
        ignoreFailures.set(false)
    }
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(files("detekt.yml"))
    parallel = true
    source.setFrom(files(
        "shared/src/commonMain/kotlin",
        "shared/src/androidMain/kotlin",
        "app/src/main/java",
    ))
}
```

- [ ] **Step 2: Commit**

```bash
git add build.gradle.kts
git commit -m "chore: apply ktlint and detekt plugins to build"
```

### Task 5: Create detekt configuration

**Files:**
- Create: `detekt.yml`

- [ ] **Step 1: Create detekt.yml with mobile-friendly rules**

```yaml
# detekt.yml — ShyTalk custom configuration
# Builds on default config, disabling rules that are too noisy for mobile apps.

complexity:
  LongParameterList:
    active: false
  TooManyFunctions:
    active: false
  CyclomaticComplexMethod:
    threshold: 20
  LongMethod:
    threshold: 80
  LargeClass:
    threshold: 400

style:
  MagicNumber:
    active: false
  MaxLineLength:
    maxLineLength: 140
  WildcardImport:
    active: false
  ReturnCount:
    max: 5
  UnusedPrivateMember:
    active: true
  ForbiddenComment:
    active: false

naming:
  FunctionNaming:
    ignoreAnnotated:
      - "Composable"
  TopLevelPropertyNaming:
    constantPattern: "[A-Z][A-Za-z0-9_]*"

exceptions:
  TooGenericExceptionCaught:
    active: false

performance:
  SpreadOperator:
    active: false
```

- [ ] **Step 2: Verify detekt runs**

```bash
./gradlew detekt
```

Expected: either PASS or specific violations to fix in Task 8.

- [ ] **Step 3: Commit**

```bash
git add detekt.yml
git commit -m "chore: add detekt configuration for mobile codebase"
```

### Task 6: Create root .editorconfig

**Files:**
- Create: `.editorconfig`

- [ ] **Step 1: Create root .editorconfig**

```ini
# .editorconfig — ShyTalk root config
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.{kt,kts}]
indent_style = space
indent_size = 4
max_line_length = 140

[*.{js,mjs,json,yml,yaml}]
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false

[*.feature]
indent_style = space
indent_size = 2
```

- [ ] **Step 2: Commit**

```bash
git add .editorconfig
git commit -m "chore: add root .editorconfig for consistent formatting"
```

### Task 7: Auto-fix Kotlin formatting

- [ ] **Step 1: Run ktlintFormat to auto-fix**

```bash
./gradlew ktlintFormat
```

- [ ] **Step 2: Run ktlintCheck to verify remaining issues**

```bash
./gradlew ktlintCheck
```

Expected: either PASS or a small number of issues that can't be auto-fixed.

- [ ] **Step 3: Fix any remaining ktlint violations manually**

Address any issues reported by ktlintCheck that ktlintFormat couldn't fix.

- [ ] **Step 4: Run detekt and fix violations**

```bash
./gradlew detekt
```

Fix any reported violations. These are typically unused imports, unused variables, or overly complex methods.

- [ ] **Step 5: Run full Kotlin test suite to verify nothing broke**

```bash
./gradlew test
```

Expected: all tests pass.

- [ ] **Step 6: Commit all formatting fixes**

```bash
git add '*.kt' '*.kts'
git commit -m "style: auto-fix Kotlin formatting via ktlintFormat and resolve detekt violations"
```

---

## Chunk 3: JavaScript Linter Setup (ESLint + Prettier)

### Task 8: Add ESLint and Prettier to Express API

**Files:**
- Modify: `express-api/package.json`
- Create: `express-api/eslint.config.mjs`
- Create: `express-api/.prettierrc`
- Create: `express-api/.prettierignore`

- [ ] **Step 1: Install ESLint and Prettier as dev dependencies**

```bash
cd express-api && npm install --save-dev eslint @eslint/js prettier eslint-config-prettier globals
```

- [ ] **Step 2: Add lint/format scripts to package.json**

Add to `"scripts"` in `express-api/package.json`:
```json
"lint": "eslint .",
"lint:fix": "eslint --fix .",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

- [ ] **Step 3: Create ESLint flat config**

```javascript
// express-api/eslint.config.mjs
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'warn',
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-throw-literal': 'error',
      'no-shadow': 'warn',
    },
  },
  {
    ignores: ['node_modules/', 'coverage/'],
  },
];
```

- [ ] **Step 4: Create Prettier config**

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "semi": true,
  "tabWidth": 2
}
```

- [ ] **Step 5: Create .prettierignore**

```
node_modules/
coverage/
package-lock.json
```

- [ ] **Step 6: Commit config files only (not formatting fixes yet)**

```bash
cd express-api
git add eslint.config.mjs .prettierrc .prettierignore package.json package-lock.json
git commit -m "chore: add ESLint and Prettier configuration to Express API"
```

### Task 9: Auto-fix Express formatting

- [ ] **Step 1: Run Prettier to auto-fix formatting**

```bash
cd express-api && npx prettier --write .
```

- [ ] **Step 2: Run ESLint auto-fix**

```bash
cd express-api && npx eslint --fix .
```

- [ ] **Step 3: Run ESLint check to see remaining issues**

```bash
cd express-api && npx eslint .
```

Expected: either PASS or remaining issues to fix manually.

- [ ] **Step 4: Fix remaining ESLint violations manually**

Common issues: `no-unused-vars` (remove or prefix with `_`), `no-console` (replace with `logger.*`), `eqeqeq` (replace `==` with `===`).

- [ ] **Step 5: Run Express API tests to verify nothing broke**

```bash
cd express-api && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit formatting fixes**

```bash
git add express-api/
git commit -m "style: auto-fix Express formatting via Prettier and resolve ESLint violations"
```

---

## Chunk 4: Gherkin Quality Script

### Task 10: Create check-gherkin.sh

**Files:**
- Create: `.claude/hooks/check-gherkin.sh`

- [ ] **Step 1: Write the Gherkin quality check script**

```bash
#!/usr/bin/env bash
# check-gherkin.sh — Validates Gherkin feature files for quality standards.
# Used by: lint-staged (pre-commit), CI (lint.yml)
#
# Rules:
#   1. Max 15 steps per scenario
#   2. No empty scenarios (zero steps)
#   3. No duplicate scenario names within a feature file
#
# Usage:
#   bash .claude/hooks/check-gherkin.sh [file1.feature file2.feature ...]
#   If no args, scans app/src/androidTest/assets/features/*.feature

set -euo pipefail

ERRORS=0
MAX_STEPS=15

# Collect files to check
if [ $# -gt 0 ]; then
  FILES=("$@")
else
  FILES=(app/src/androidTest/assets/features/*.feature)
fi

for file in "${FILES[@]}"; do
  [ -f "$file" ] || continue

  # --- Rule 1 & 2: Scenario step count ---
  scenario_name=""
  step_count=0
  line_num=0

  while IFS= read -r line || [ -n "$line" ]; do
    line_num=$((line_num + 1))
    trimmed=$(echo "$line" | sed 's/^[[:space:]]*//')

    # New scenario starts
    if echo "$trimmed" | grep -qE '^(Scenario|Scenario Outline):'; then
      # Check previous scenario
      if [ -n "$scenario_name" ] && [ "$step_count" -eq 0 ]; then
        echo "ERROR: $file: Empty scenario '$scenario_name' has zero steps" >&2
        ERRORS=$((ERRORS + 1))
      fi
      if [ -n "$scenario_name" ] && [ "$step_count" -gt "$MAX_STEPS" ]; then
        echo "ERROR: $file: Scenario '$scenario_name' has $step_count steps (max $MAX_STEPS)" >&2
        ERRORS=$((ERRORS + 1))
      fi
      scenario_name=$(echo "$trimmed" | sed 's/^Scenario\( Outline\)\?: //')
      step_count=0
    fi

    # Count steps
    if echo "$trimmed" | grep -qE '^(Given|When|Then|And|But) '; then
      step_count=$((step_count + 1))
    fi
  done < "$file"

  # Check last scenario in file
  if [ -n "$scenario_name" ] && [ "$step_count" -eq 0 ]; then
    echo "ERROR: $file: Empty scenario '$scenario_name' has zero steps" >&2
    ERRORS=$((ERRORS + 1))
  fi
  if [ -n "$scenario_name" ] && [ "$step_count" -gt "$MAX_STEPS" ]; then
    echo "ERROR: $file: Scenario '$scenario_name' has $step_count steps (max $MAX_STEPS)" >&2
    ERRORS=$((ERRORS + 1))
  fi

  # --- Rule 3: Duplicate scenario names ---
  scenario_names=$(grep -E '^\s*(Scenario|Scenario Outline):' "$file" | sed 's/^[[:space:]]*//' | sed 's/^Scenario\( Outline\)\?: //' | sort)
  duplicates=$(echo "$scenario_names" | uniq -d)
  if [ -n "$duplicates" ]; then
    while IFS= read -r dup; do
      [ -z "$dup" ] && continue
      echo "ERROR: $file: Duplicate scenario name '$dup'" >&2
      ERRORS=$((ERRORS + 1))
    done <<< "$duplicates"
  fi

done

if [ "$ERRORS" -gt 0 ]; then
  echo "" >&2
  echo "Gherkin quality check: $ERRORS error(s) found." >&2
  exit 1
fi

echo "Gherkin quality check: all files passed."
exit 0
```

- [ ] **Step 2: Make the script executable**

```bash
chmod +x .claude/hooks/check-gherkin.sh
```

- [ ] **Step 3: Test the script against existing feature files**

```bash
bash .claude/hooks/check-gherkin.sh
```

Expected: all 33 feature files pass, or specific violations to fix.

- [ ] **Step 4: Fix any Gherkin violations found**

If any scenarios exceed 15 steps, split them or extract shared steps to Background.

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/check-gherkin.sh
git commit -m "chore: add Gherkin quality check script for pre-commit and CI"
```

---

## Chunk 5: Git Hooks (Husky + lint-staged)

### Task 11: Install Husky and lint-staged

**Files:**
- Modify: `package.json` (root)
- Create: `.husky/pre-commit`

Note: `.claude/hooks/check-gherkin.sh` must exist before this task (created in Chunk 4).

- [ ] **Step 1: Install Husky and lint-staged**

```bash
npm install --save-dev husky lint-staged
```

- [ ] **Step 2: Add prepare script and lint-staged config to root package.json**

Add to `"scripts"`:
```json
"prepare": "husky"
```

Add top-level:
```json
"lint-staged": {
  "*.kt": ["ktlint --relative"],
  "express-api/**/*.js": ["eslint", "prettier --check"],
  "*.feature": ["bash .claude/hooks/check-gherkin.sh"]
}
```

- [ ] **Step 3: Initialize Husky**

```bash
npx husky init
```

- [ ] **Step 4: Create pre-commit hook**

Write to `.husky/pre-commit`:
```bash
npx lint-staged
```

- [ ] **Step 5: Install standalone ktlint CLI for pre-commit speed**

```bash
npm install --save-dev @naturalcycles/ktlint
```

- [ ] **Step 6: Test the pre-commit hook**

Make a trivial whitespace change to a Kotlin file, stage it, and attempt a real commit to verify the hook triggers:
```bash
echo "" >> shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/User.kt
git add shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/User.kt
git commit -m "test: verify pre-commit hook"
```

Expected: ktlint runs on the staged file. If it passes, revert the test commit with `git reset HEAD~1` and restore the file. If it fails, the hook is working correctly — fix the issue or revert the change.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .husky/
git commit -m "chore: add Husky + lint-staged git hooks for pre-commit linting"
```

---

## Chunk 6: CI Lint Workflow

### Task 12: Create lint.yml workflow

**Files:**
- Create: `.github/workflows/lint.yml`

- [ ] **Step 1: Create the lint workflow**

```yaml
# .github/workflows/lint.yml
name: Lint

on:
  pull_request:
    branches: [main]

permissions:
  contents: read

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  detect-changes:
    name: Detect Changes
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      kotlin_changed: ${{ steps.changes.outputs.kotlin_changed }}
      express_changed: ${{ steps.changes.outputs.express_changed }}
      gherkin_changed: ${{ steps.changes.outputs.gherkin_changed }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          fetch-depth: 0

      - name: Detect changed paths
        id: changes
        run: |
          CHANGED=$(git diff --name-only "${{ github.event.pull_request.base.sha }}...${{ github.event.pull_request.head.sha }}")
          KOTLIN=false EXPRESS=false GHERKIN=false
          while IFS= read -r file; do
            [ -z "$file" ] && continue
            case "$file" in
              *.kt|*.kts) KOTLIN=true ;;
              express-api/*) EXPRESS=true ;;
              *.feature) GHERKIN=true ;;
            esac
          done <<< "$CHANGED"
          echo "kotlin_changed=$KOTLIN" >> "$GITHUB_OUTPUT"
          echo "express_changed=$EXPRESS" >> "$GITHUB_OUTPUT"
          echo "gherkin_changed=$GHERKIN" >> "$GITHUB_OUTPUT"
          echo "Detection: kotlin=$KOTLIN express=$EXPRESS gherkin=$GHERKIN"

  kotlin-lint:
    name: Kotlin Lint
    needs: detect-changes
    if: needs.detect-changes.outputs.kotlin_changed == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - uses: actions/setup-java@be666c2fcd27ec809703dec50e508c2fdc7f6654 # v5
        with:
          distribution: temurin
          java-version: 17

      - uses: gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c # v5

      - name: Run ktlint
        run: ./gradlew ktlintCheck

      - name: Run detekt
        run: ./gradlew detekt

  express-lint:
    name: Express Lint
    needs: detect-changes
    if: needs.detect-changes.outputs.express_changed == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: express-api/package-lock.json

      - name: Install dependencies
        run: cd express-api && npm ci

      - name: Run ESLint
        run: cd express-api && npm run lint

      - name: Check Prettier formatting
        run: cd express-api && npm run format:check

  gherkin-lint:
    name: Gherkin Lint
    needs: detect-changes
    if: needs.detect-changes.outputs.gherkin_changed == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - name: Check Gherkin quality
        run: bash .claude/hooks/check-gherkin.sh

  lint-gate:
    name: Lint Gate
    needs: [kotlin-lint, express-lint, gherkin-lint]
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: Check lint results
        run: |
          echo "Kotlin lint: ${{ needs.kotlin-lint.result }}"
          echo "Express lint: ${{ needs.express-lint.result }}"
          echo "Gherkin lint: ${{ needs.gherkin-lint.result }}"
          if [ "${{ needs.kotlin-lint.result }}" = "failure" ] || \
             [ "${{ needs.express-lint.result }}" = "failure" ] || \
             [ "${{ needs.gherkin-lint.result }}" = "failure" ]; then
            echo "One or more lint checks failed."
            exit 1
          fi
          echo "All lint checks passed (or were skipped)."
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/lint.yml
git commit -m "ci: add lint workflow with ktlint, detekt, ESLint, Prettier, and Gherkin checks"
```

---

## Chunk 7: Claude Hooks

### Task 13: Extend Claude hooks for standards enforcement

**Files:**
- Modify: `.claude/settings.json`

- [ ] **Step 1: Add Gherkin quality prompt hook**

Add to the `"PreToolUse"` array in `.claude/settings.json`:

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "prompt",
      "prompt": "If this file is a .feature file (Gherkin), check: (1) Each Scenario should have at most 15 steps (Given/When/Then/And/But lines). (2) Shared setup steps that appear in every scenario should use Background instead of repeating. (3) No duplicated sequences of 3+ identical consecutive steps across scenarios. (4) Scenario names should be descriptive and unique within the file. If violations found, DENY and explain. If not a .feature file or no violations, approve silently."
    }
  ]
}
```

- [ ] **Step 2: Add Compose testTag prompt hook**

Add to the `"PreToolUse"` array:

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "prompt",
      "prompt": "If this file is a Kotlin file ending in Screen.kt, check that new interactive Compose elements (Button, IconButton, TextField, OutlinedTextField, clickable, toggleable) include a Modifier.testTag() for E2E testability. If new interactive elements are missing testTag, DENY and list which elements need tags. If not a Screen.kt file or all elements have testTags, approve silently."
    }
  ]
}
```

- [ ] **Step 3: Add Express route pattern prompt hook**

Add to the `"PreToolUse"` array:

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "prompt",
      "prompt": "If this file is in express-api/src/routes/, check: (1) Uses 'const router = express.Router(); module.exports = router;' pattern. (2) Admin routes (path containing '/admin/') use requireAdmin guard: 'if (requireAdmin(req, res)) return;'. (3) Uses structured logging via logger.info/warn/error instead of console.log/warn/error. If violations found, DENY and explain. If not a route file or no violations, approve silently."
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json
git commit -m "chore: extend Claude hooks for Gherkin, Compose testTag, and Express route standards"
```

---

## Chunk 8: Final Validation

### Task 14: Run all linters end-to-end

- [ ] **Step 1: Run Kotlin linters**

```bash
./gradlew ktlintCheck detekt
```

Expected: PASS with zero violations.

- [ ] **Step 2: Run Express linters**

```bash
cd express-api && npm run lint && npm run format:check
```

Expected: PASS with zero violations.

- [ ] **Step 3: Run Gherkin check**

```bash
bash .claude/hooks/check-gherkin.sh
```

Expected: PASS.

- [ ] **Step 4: Run full test suite**

```bash
./gradlew test
```

Expected: all Kotlin tests pass.

```bash
cd express-api && npm test
```

Expected: all Express tests pass.

- [ ] **Step 5: Push branch and create PR**

```bash
git push -u origin chore/dependabot-review-standards
```

Create PR targeting `main`.
