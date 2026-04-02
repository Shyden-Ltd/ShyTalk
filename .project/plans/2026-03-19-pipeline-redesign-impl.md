# Pipeline Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1232-line `release.yml` monolith with 6 focused workflows — pr-checks, deploy-dev, e2e-tests (bug fixes), release, deploy-prod, and sonarcloud — with semver, no comment triggers, and clean separation of concerns.

**Architecture:** Split the monolith atomically — old `release.yml` is replaced (not supplemented) in the same commit. New workflows: `pr-checks.yml` (PR gate), `deploy-dev.yml` (manual dev deploy + tester distribution), `deploy-prod.yml` (manual prod deploy by release tag), `release.yml` (auto semver + GitHub release on merge to main). Existing `e2e-tests.yml` gets bug fixes only. `sonarcloud.yml` rewritten to use Gradle plugin.

**Tech Stack:** GitHub Actions, Gradle (Kotlin DSL), Firebase, Cloudflare Wrangler, Xcode CLI, SonarQube Gradle plugin

**Spec:** `.project/plans/2026-03-19-pipeline-redesign.md`

---

**Note on duplicate runs during PR testing:** While this PR is open, the old `release.yml` from `main` will also trigger on `pull_request` events (GitHub evaluates workflow files from both the PR branch and the base branch). This is expected and harmless — the old workflow will run but is superseded once the PR merges. After merge, only the new workflows exist.

---

## Chunk 1: Foundation — Branch, version format, e2e bug fixes, cleanup

### Task 1: Create feature branch and update version format

**Files:**
- Modify: `app/build.gradle.kts:25-26`

- [ ] **Step 1: Create feature branch**

```bash
git checkout main && git pull
git checkout -b feat/pipeline-redesign
```

- [ ] **Step 2: Update versionName to three-part semver**

In `app/build.gradle.kts`, change:
```kotlin
versionName = "0.54"
```
to:
```kotlin
versionName = "0.54.0"
```

- [ ] **Step 3: Verify ecosystem.config.js NODE_ENV removal**

`express-api/ecosystem.config.js` should already have `NODE_ENV: 'production'` removed (applied earlier in this session). Verify the `env` block only contains `PORT: 3000`. If the old `NODE_ENV` line is still present, remove it.

This is critical — without it, the dev server's test helper routes won't load after a deploy (PM2's `NODE_ENV: 'production'` would override the `.env` setting).

- [ ] **Step 4: Verify build still works**

Run: `./gradlew assembleDevDebug`
Expected: BUILD SUCCESSFUL

- [ ] **Step 5: Commit**

```bash
git add app/build.gradle.kts express-api/ecosystem.config.js
git commit -m "chore: update versionName to semver, remove hardcoded NODE_ENV from ecosystem.config"
```

### Task 2: Fix e2e-tests.yml heredoc whitespace bugs

**Files:**
- Modify: `.github/workflows/e2e-tests.yml:208-213` (Android heredoc)
- Modify: `.github/workflows/e2e-tests.yml:326-331` (Playwright heredoc)

- [ ] **Step 1: Fix Android environment.properties heredoc**

In `.github/workflows/e2e-tests.yml`, replace lines 208-213. The current heredoc has leading spaces because the content is indented with YAML. We can't move content to column 0 (breaks YAML). Instead, pipe through `sed` to strip leading whitespace:
```yaml
          cat > allure-results-android/environment.properties <<'ENVEOF'
          platform=Android
          api_level=${{ matrix.api-level }}
          device=${{ matrix.profile }}
          environment=dev
          ENVEOF
```
Replace with:
```yaml
          sed 's/^ *//' > allure-results-android/environment.properties <<'ENVEOF'
          platform=Android
          api_level=${{ matrix.api-level }}
          device=${{ matrix.profile }}
          environment=dev
          ENVEOF
```

- [ ] **Step 2: Fix Playwright environment.properties heredoc**

Same fix for lines 326-331:
```yaml
          cat > "$DIR/environment.properties" <<EOF
          platform=Web
          browser=${{ matrix.browser }}
          viewport=${{ matrix.viewport }}
          base_url=dev.shytalk.shyden.co.uk
          EOF
```
Replace with:
```yaml
          sed 's/^ *//' > "$DIR/environment.properties" <<EOF
          platform=Web
          browser=${{ matrix.browser }}
          viewport=${{ matrix.viewport }}
          base_url=dev.shytalk.shyden.co.uk
          EOF
```

- [ ] **Step 3: Verify TEST_API_KEY secret exists in dev environment**

Go to GitHub repo → Settings → Environments → `dev` → Environment secrets. Verify `TEST_API_KEY`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` are configured as environment-level secrets (not just repo-level). If they only exist at repo level, add them to the `dev` environment. This fixes the Playwright 401 auth errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/e2e-tests.yml
git commit -m "fix: remove leading whitespace from Allure environment.properties heredocs"
```

### Task 3: Delete e2e-trigger.yml and clean up force-cancel.yml

**Files:**
- Delete: `.github/workflows/e2e-trigger.yml`
- Modify: `.github/workflows/force-cancel.yml`

- [ ] **Step 1: Delete e2e-trigger.yml**

```bash
git rm .github/workflows/e2e-trigger.yml
```

- [ ] **Step 2: Update force-cancel.yml workflow list**

In `.github/workflows/force-cancel.yml`, replace:
```javascript
            const workflows = ['release.yml', 'e2e-tests.yml'];
```
with:
```javascript
            const workflows = ['release.yml', 'pr-checks.yml', 'deploy-dev.yml', 'deploy-prod.yml', 'e2e-tests.yml'];
```

Keep the existing deployment approval rejection logic (lines 37-52) — it's harmless and future-proofs against any workflows that might use environment protection rules later. Only change the workflow list.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/e2e-trigger.yml .github/workflows/force-cancel.yml
git commit -m "chore: delete e2e-trigger.yml, update force-cancel for new workflow names"
```

---

## Chunk 2: pr-checks.yml and sonarcloud.yml rewrite

### Task 4: Create pr-checks.yml

**Files:**
- Create: `.github/workflows/pr-checks.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/pr-checks.yml` with this content:

```yaml
name: PR Checks

on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]

permissions:
  contents: write       # needed by e2e-tests.yml allure-report (gh-pages deploy)
  checks: write
  pull-requests: write

concurrency:
  group: pr-checks-${{ github.head_ref }}
  cancel-in-progress: true

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  detect-changes:
    name: Detect Changes
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      app_changed: ${{ steps.changes.outputs.app_changed }}
      backend_changed: ${{ steps.changes.outputs.backend_changed }}
      web_changed: ${{ steps.changes.outputs.web_changed }}
      workflow_only: ${{ steps.changes.outputs.workflow_only }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          fetch-depth: 0

      - name: Detect changed paths
        id: changes
        run: |
          CHANGED=$(git diff --name-only "${{ github.event.pull_request.base.sha }}...${{ github.event.pull_request.head.sha }}")
          APP=false BACKEND=false WEB=false OTHER=false
          while IFS= read -r file; do
            [ -z "$file" ] && continue
            case "$file" in
              public/*.md) WEB=true ;;
              public/*) WEB=true ;;
              app/*|shared/*|iosApp/*|gradle/*|*.gradle.kts|gradle.properties|gradlew|gradlew.bat) APP=true ;;
              express-api/*|firestore.rules|database.rules.json) BACKEND=true ;;
              .github/*|.claude/*|.project/*|*.md|.gitignore|.gitattributes) ;;
              *) OTHER=true ;;
            esac
          done <<< "$CHANGED"
          WORKFLOW_ONLY=false
          if [ "$APP" = "false" ] && [ "$BACKEND" = "false" ] && [ "$WEB" = "false" ] && [ "$OTHER" = "false" ]; then
            WORKFLOW_ONLY=true
          fi
          for v in app_changed=$APP backend_changed=$BACKEND web_changed=$WEB workflow_only=$WORKFLOW_ONLY; do
            echo "$v" >> "$GITHUB_OUTPUT"
          done
          echo "Detection results: app=$APP backend=$BACKEND web=$WEB workflow_only=$WORKFLOW_ONLY"

  lint:
    needs: [detect-changes]
    if: needs.detect-changes.outputs.workflow_only != 'true'
    uses: ./.github/workflows/lint.yml
    with:
      ref: ${{ github.event.pull_request.head.sha }}
      app_changed: ${{ needs.detect-changes.outputs.app_changed == 'true' }}
      backend_changed: ${{ needs.detect-changes.outputs.backend_changed == 'true' }}
    secrets: inherit

  build-and-test:
    name: Build & Test
    needs: [detect-changes]
    if: needs.detect-changes.outputs.app_changed == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          ref: ${{ github.event.pull_request.head.sha }}

      - name: Set up JDK 17
        uses: actions/setup-java@be666c2fcd27ec809703dec50e508c2fdc7f6654 # v5
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c # v5
        with:
          cache-read-only: false

      - name: Decode google-services.json
        env:
          GOOGLE_SERVICES_DEV_BASE64: ${{ secrets.GOOGLE_SERVICES_DEV_BASE64 }}
        run: |
          mkdir -p app/src/dev app/src/prod
          echo "$GOOGLE_SERVICES_DEV_BASE64" | base64 -d > app/src/dev/google-services.json
          echo "$GOOGLE_SERVICES_DEV_BASE64" | base64 -d > app/src/prod/google-services.json

      - name: Decode keystore
        env:
          KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}
        run: echo "$KEYSTORE_BASE64" | base64 -d > keystore.jks

      - name: Run unit tests and build devRelease APK
        env:
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
          LIVEKIT_URL: ${{ secrets.LIVEKIT_URL }}
        run: ./gradlew testDevDebugUnitTest assembleDevRelease --parallel

      - name: Publish unit test report
        uses: EnricoMi/publish-unit-test-result-action@c950f6fb443cb5af20a377fd0dfaa78838901040 # v2
        if: always()
        with:
          check_name: Unit Tests
          files: '**/build/test-results/**/TEST-*.xml'

      - name: Upload devRelease APK
        uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7
        with:
          name: dev-release-apk
          path: app/build/outputs/apk/dev/release/*.apk

  sonarcloud:
    needs: [detect-changes, build-and-test]
    if: |
      always() &&
      needs.detect-changes.result == 'success' &&
      needs.detect-changes.outputs.workflow_only != 'true' &&
      (needs.build-and-test.result == 'success' || needs.build-and-test.result == 'skipped')
    uses: ./.github/workflows/sonarcloud.yml
    with:
      ref: ${{ github.event.pull_request.head.sha }}
    secrets: inherit

  test-backend:
    needs: [detect-changes]
    if: needs.detect-changes.outputs.backend_changed == 'true'
    uses: ./.github/workflows/test-backend.yml
    with:
      ref: ${{ github.event.pull_request.head.sha }}
    secrets: inherit

  android-e2e-smoke:
    needs: [detect-changes, build-and-test]
    if: |
      always() &&
      needs.detect-changes.outputs.app_changed == 'true' &&
      needs.build-and-test.result == 'success'
    uses: ./.github/workflows/e2e-tests.yml
    with:
      android: '33-phone'
      ios: 'none'
      web: 'none'
      parallel: true
      ref: ${{ github.event.pull_request.head.sha }}
    secrets: inherit
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/pr-checks.yml
git commit -m "feat: add pr-checks.yml — PR quality gate workflow"
```

### Task 5: Rewrite sonarcloud.yml

**Files:**
- Modify: `.github/workflows/sonarcloud.yml`

- [ ] **Step 1: Rewrite sonarcloud.yml to use Gradle plugin**

Replace the entire contents of `.github/workflows/sonarcloud.yml` with:

```yaml
name: SonarCloud Analysis

on:
  workflow_call:
    inputs:
      ref:
        description: 'Git ref to check out'
        type: string
        required: true

  workflow_dispatch:

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  sonarcloud:
    name: SonarCloud Analysis
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          ref: ${{ inputs.ref || github.sha }}
          fetch-depth: 0

      - name: Set up JDK 17
        uses: actions/setup-java@be666c2fcd27ec809703dec50e508c2fdc7f6654 # v5
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c # v5

      - name: Set up Node
        uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6
        with:
          node-version: '24'

      - name: Run Express API tests with coverage
        run: |
          cd express-api && npm ci
          npx jest --coverage --coverageReporters=lcov || true

      - name: Decode google-services.json
        env:
          GOOGLE_SERVICES_DEV_BASE64: ${{ secrets.GOOGLE_SERVICES_DEV_BASE64 }}
        run: |
          mkdir -p app/src/dev app/src/prod
          echo "$GOOGLE_SERVICES_DEV_BASE64" | base64 -d > app/src/dev/google-services.json
          echo "$GOOGLE_SERVICES_DEV_BASE64" | base64 -d > app/src/prod/google-services.json

      - name: Run Kotlin JVM tests for coverage reports
        run: ./gradlew :shared:jvmTest || true

      - name: Run SonarCloud analysis
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: ./gradlew sonar -Dsonar.token=$SONAR_TOKEN -x :app:sonar
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/sonarcloud.yml
git commit -m "refactor: rewrite sonarcloud.yml to use Gradle plugin instead of standalone scanner"
```

---

## Chunk 3: release.yml (semver + GitHub release only)

### Task 6: Replace release.yml with semver-only workflow

**Files:**
- Modify: `.github/workflows/release.yml` (full rewrite)

- [ ] **Step 1: Replace release.yml**

Replace the entire contents of `.github/workflows/release.yml` with:

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write

concurrency:
  group: release-main
  cancel-in-progress: false

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  check-skip:
    name: Check Skip
    runs-on: ubuntu-latest
    timeout-minutes: 2
    outputs:
      should_skip: ${{ steps.check.outputs.skip }}
    steps:
      - name: Check if release commit
        id: check
        env:
          COMMIT_MSG: ${{ github.event.head_commit.message }}
        run: |
          if [[ "$COMMIT_MSG" == chore:\ release\ v* ]]; then
            echo "skip=true" >> "$GITHUB_OUTPUT"
            echo "Skipping — this is a release commit"
          else
            echo "skip=false" >> "$GITHUB_OUTPUT"
          fi

  detect-changes:
    name: Detect Changes
    needs: [check-skip]
    if: needs.check-skip.outputs.should_skip != 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      app_changed: ${{ steps.changes.outputs.app_changed }}
      workflow_only: ${{ steps.changes.outputs.workflow_only }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          fetch-depth: 2

      - name: Detect changed paths
        id: changes
        run: |
          CHANGED=$(git diff --name-only HEAD~1 HEAD)
          APP=false BACKEND=false WEB=false OTHER=false
          while IFS= read -r file; do
            [ -z "$file" ] && continue
            case "$file" in
              public/*) WEB=true ;;
              app/*|shared/*|iosApp/*|gradle/*|*.gradle.kts|gradle.properties|gradlew|gradlew.bat) APP=true ;;
              express-api/*|firestore.rules|database.rules.json) BACKEND=true ;;
              .github/*|.claude/*|.project/*|*.md|.gitignore|.gitattributes) ;;
              *) OTHER=true ;;
            esac
          done <<< "$CHANGED"
          WORKFLOW_ONLY=false
          if [ "$APP" = "false" ] && [ "$BACKEND" = "false" ] && [ "$WEB" = "false" ] && [ "$OTHER" = "false" ]; then
            WORKFLOW_ONLY=true
          fi
          echo "app_changed=$APP" >> "$GITHUB_OUTPUT"
          echo "workflow_only=$WORKFLOW_ONLY" >> "$GITHUB_OUTPUT"
          echo "Detection: app=$APP backend=$BACKEND web=$WEB workflow_only=$WORKFLOW_ONLY"

  prepare-release:
    name: Prepare Release
    needs: [check-skip, detect-changes]
    if: |
      needs.check-skip.outputs.should_skip != 'true' &&
      needs.detect-changes.outputs.workflow_only != 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          token: ${{ secrets.RELEASE_TOKEN }}

      - name: Parse commit message for version bump type
        id: bump
        run: |
          MSG=$(git log -1 --format='%s')
          BODY=$(git log -1 --format='%b')

          # Check for breaking changes
          if echo "$MSG" | grep -qE '^[a-z]+!:' || echo "$BODY" | grep -q 'BREAKING CHANGE'; then
            echo "type=major" >> "$GITHUB_OUTPUT"
          elif echo "$MSG" | grep -qE '^feat(\(.+\))?:'; then
            echo "type=minor" >> "$GITHUB_OUTPUT"
          else
            echo "type=patch" >> "$GITHUB_OUTPUT"
          fi
          echo "Bump type: $(grep type "$GITHUB_OUTPUT" | cut -d= -f2)"

      - name: Bump version
        id: version
        run: |
          # Extract current version
          CURRENT=$(grep 'versionName =' app/build.gradle.kts | head -1 | sed 's/.*"\(.*\)".*/\1/')
          CURRENT_CODE=$(grep 'versionCode' app/build.gradle.kts | head -1 | sed 's/[^0-9]//g')

          IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
          BUMP="${{ steps.bump.outputs.type }}"

          case "$BUMP" in
            major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
            minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
            patch) PATCH=$((PATCH + 1)) ;;
          esac

          NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
          NEW_CODE=$((CURRENT_CODE + 1))

          sed -i "s/versionCode = ${CURRENT_CODE}/versionCode = ${NEW_CODE}/" app/build.gradle.kts
          sed -i "s/versionName = \"${CURRENT}\"/versionName = \"${NEW_VERSION}\"/" app/build.gradle.kts

          echo "version=${NEW_VERSION}" >> "$GITHUB_OUTPUT"
          echo "Bumped: ${CURRENT} → ${NEW_VERSION} (code: ${CURRENT_CODE} → ${NEW_CODE})"

      - name: Generate release notes
        id: notes
        run: |
          SUBJECT=$(git log -1 --format='%s')
          BODY=$(git log -1 --format='%b')
          VERSION="${{ steps.version.outputs.version }}"
          NOTES_FILE=$(mktemp)
          PLAY_FILE="app/src/main/play/release-notes/en-US/internal.txt"

          # Build full release notes (no leading whitespace — write directly to file)
          {
            echo "## v${VERSION}"
            echo ""
            echo "${SUBJECT}"
          } > "$NOTES_FILE"

          FILTERED=""
          if [ -n "$BODY" ]; then
            FILTERED=$(echo "$BODY" | grep -vE '^\s*$' | grep -vE '^(chore|ci|build|style)(\(.+\))?:' | head -20)
            if [ -n "$FILTERED" ]; then
              {
                echo ""
                echo "### Changes"
                echo "$FILTERED" | while IFS= read -r line; do
                  clean=$(echo "$line" | sed 's/^[a-z]*(\?[^)]*)\?: //' | sed 's/^\* //')
                  echo "- ${clean}"
                done
              } >> "$NOTES_FILE"
            fi
          fi

          echo "notes_file=$NOTES_FILE" >> "$GITHUB_OUTPUT"

          # Google Play release notes (max 500 chars)
          {
            echo "v${VERSION}"
            echo ""
            echo "$SUBJECT" | sed 's/^[a-z]*(\?[^)]*)\?: //'
          } > "$PLAY_FILE"

          if [ -n "$FILTERED" ]; then
            echo "$FILTERED" | head -5 | while IFS= read -r line; do
              clean=$(echo "$line" | sed 's/^[a-z]*(\?[^)]*)\?: //' | sed 's/^\* //')
              echo "- ${clean}"
            done >> "$PLAY_FILE"
          fi

          # Truncate to 500 chars
          truncated=$(head -c 500 "$PLAY_FILE")
          echo "$truncated" > "$PLAY_FILE"

      - name: Commit version bump
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add app/build.gradle.kts app/src/main/play/release-notes/en-US/internal.txt
          git commit -m "chore: release v${{ steps.version.outputs.version }}"
          git push

      - name: Create GitHub release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          VERSION="${{ steps.version.outputs.version }}"
          COMMIT_SHA=$(git rev-parse HEAD)
          gh release create "v${VERSION}" \
            --target "$COMMIT_SHA" \
            --title "v${VERSION}" \
            --notes-file "${{ steps.notes.outputs.notes_file }}"
          echo "Created release v${VERSION} at ${COMMIT_SHA}"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat: rewrite release.yml — semver bump + GitHub release only, no deploy"
```

---

## Chunk 4: deploy-dev.yml

### Task 7: Create deploy-dev.yml

**Files:**
- Create: `.github/workflows/deploy-dev.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/deploy-dev.yml` with this content:

```yaml
name: Deploy to Dev

on:
  workflow_dispatch:
    inputs:
      backend:
        description: 'Deploy Express API to dev'
        type: boolean
        default: true
      web:
        description: 'Deploy web to dev'
        type: boolean
        default: true
      android-testers:
        description: 'Distribute APK to testers'
        type: boolean
        default: true
      ios-testers:
        description: 'Distribute iOS to TestFlight'
        type: boolean
        default: true
      playwright:
        description: 'Run Playwright tests after deploy'
        type: boolean
        default: true

permissions:
  contents: write       # needed by e2e-tests.yml allure-report (gh-pages deploy)
  actions: read

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  deploy-backend-dev:
    name: Deploy Backend to Dev
    if: inputs.backend
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - name: Set up Node
        uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6
        with:
          node-version: '24'

      - name: Install deploy tools
        run: npm install -g firebase-tools

      - name: Deploy Express API to London (dev)
        env:
          SSH_KEY: ${{ secrets.LONDON_SSH_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan 145.241.224.13 >> ~/.ssh/known_hosts

          cd express-api
          tar czf /tmp/api.tar.gz --exclude='node_modules' --exclude='.env' .
          scp /tmp/api.tar.gz ubuntu@145.241.224.13:/tmp/
          ssh ubuntu@145.241.224.13 "cd ~/express-api && tar xzf /tmp/api.tar.gz && npm install --omit=dev && pm2 restart shytalk-api"

      - name: Verify dev API health
        run: |
          for i in 1 2 3 4 5; do
            sleep 5
            if curl -sf https://dev-api.shytalk.shyden.co.uk/api/health; then exit 0; fi
            echo "Health check attempt $i failed, retrying..."
          done
          echo "Dev API health check failed after 5 attempts"
          exit 1

      - name: Deploy Firestore rules to dev
        env:
          FIREBASE_SERVICE_ACCOUNT_DEV: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_DEV }}
        run: |
          echo "$FIREBASE_SERVICE_ACCOUNT_DEV" > /tmp/firebase-sa.json
          export GOOGLE_APPLICATION_CREDENTIALS=/tmp/firebase-sa.json
          firebase deploy --only firestore:rules --project shytalk-dev --non-interactive
          rm /tmp/firebase-sa.json

      - name: Deploy RTDB rules to dev
        env:
          FIREBASE_SERVICE_ACCOUNT_DEV: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_DEV }}
        run: |
          echo "$FIREBASE_SERVICE_ACCOUNT_DEV" > /tmp/firebase-sa.json
          export GOOGLE_APPLICATION_CREDENTIALS=/tmp/firebase-sa.json
          firebase deploy --only database --project shytalk-dev --non-interactive
          rm /tmp/firebase-sa.json

  deploy-web-dev:
    name: Deploy Web to Dev
    if: inputs.web
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - name: Set up Node
        uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6
        with:
          node-version: '24'

      - name: Install deploy tools
        run: npm install -g wrangler

      - name: Deploy web to dev site
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: '9315582c39b627dca58dfa83602db385'
          DEV_FIREBASE_API_KEY: ${{ secrets.DEV_FIREBASE_API_KEY }}
        run: |
          sed "s|<DEV_FIREBASE_API_KEY>|$DEV_FIREBASE_API_KEY|" public/admin/config.dev.example.js > public/admin/config.js
          wrangler pages deploy public --project-name shytalk-site-dev --branch main

  distribute-android:
    name: Distribute Android to Testers
    if: inputs.android-testers
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - name: Try download cached APK
        id: cached-apk
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          REF=$(git rev-parse HEAD)
          REPO="${{ github.repository }}"
          RUN_ID=$(gh api "repos/${REPO}/actions/workflows/pr-checks.yml/runs?head_sha=${REF}&status=success&per_page=5" \
            --jq '.workflow_runs[0].id // empty' 2>/dev/null || echo "")
          if [ -n "$RUN_ID" ]; then
            echo "Found pr-checks run: $RUN_ID"
            echo "run_id=$RUN_ID" >> "$GITHUB_OUTPUT"
            echo "found=true" >> "$GITHUB_OUTPUT"
          else
            echo "No cached APK found — will build from scratch"
            echo "found=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Download cached APK
        if: steps.cached-apk.outputs.found == 'true'
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8
        with:
          name: dev-release-apk
          path: dev-release-apk
          run-id: ${{ steps.cached-apk.outputs.run_id }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
        continue-on-error: true
        id: download-apk

      - name: Set up JDK 17
        if: steps.cached-apk.outputs.found != 'true' || steps.download-apk.outcome == 'failure'
        uses: actions/setup-java@be666c2fcd27ec809703dec50e508c2fdc7f6654 # v5
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Set up Gradle
        if: steps.cached-apk.outputs.found != 'true' || steps.download-apk.outcome == 'failure'
        uses: gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c # v5
        with:
          cache-read-only: false

      - name: Decode google-services.json
        if: steps.cached-apk.outputs.found != 'true' || steps.download-apk.outcome == 'failure'
        env:
          GOOGLE_SERVICES_DEV_BASE64: ${{ secrets.GOOGLE_SERVICES_DEV_BASE64 }}
        run: |
          mkdir -p app/src/dev app/src/prod
          echo "$GOOGLE_SERVICES_DEV_BASE64" | base64 -d > app/src/dev/google-services.json
          echo "$GOOGLE_SERVICES_DEV_BASE64" | base64 -d > app/src/prod/google-services.json

      - name: Decode keystore
        if: steps.cached-apk.outputs.found != 'true' || steps.download-apk.outcome == 'failure'
        env:
          KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}
        run: echo "$KEYSTORE_BASE64" | base64 -d > keystore.jks

      - name: Build devRelease APK
        if: steps.cached-apk.outputs.found != 'true' || steps.download-apk.outcome == 'failure'
        env:
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
          LIVEKIT_URL: ${{ secrets.LIVEKIT_URL }}
        run: |
          ./gradlew assembleDevRelease
          mkdir -p dev-release-apk
          cp app/build/outputs/apk/dev/release/*.apk dev-release-apk/

      - name: Locate APK
        id: find-apk
        run: |
          APK_PATH=$(find dev-release-apk -name "*.apk" -type f | head -1)
          if [ -z "$APK_PATH" ]; then
            echo "found=false" >> "$GITHUB_OUTPUT"
            echo "::error::No APK found"
          else
            echo "found=true" >> "$GITHUB_OUTPUT"
            echo "apk_path=$APK_PATH" >> "$GITHUB_OUTPUT"
            echo "Found APK: $APK_PATH"
          fi

      - name: Upload to Firebase App Distribution
        if: steps.find-apk.outputs.found == 'true'
        uses: wzieba/Firebase-Distribution-Github-Action@bd494989dd4bec0343f78adee87fe66e48279ad6 # v1
        with:
          appId: "1:881846974606:android:fdcefe4da94d82718e31df"
          serviceCredentialsFileContent: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_DEV }}
          groups: internal-testers
          file: ${{ steps.find-apk.outputs.apk_path }}
          releaseNotes: "Dev build from ${{ github.ref_name }} (${{ github.sha }})"

  distribute-ios:
    name: Distribute iOS to TestFlight
    if: inputs.ios-testers
    runs-on: macos-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          fetch-depth: 0

      - name: Check if app changed
        id: check-app
        run: |
          CHANGED=$(git diff --name-only origin/main...HEAD -- \
            app/ shared/ iosApp/ gradle/ '*.gradle.kts' gradle.properties gradlew gradlew.bat 2>/dev/null || echo "")
          if [ -z "$CHANGED" ]; then
            echo "app_changed=false" >> "$GITHUB_OUTPUT"
            echo "No app changes detected — skipping iOS build"
          else
            echo "app_changed=true" >> "$GITHUB_OUTPUT"
          fi

      - name: Set up JDK 17
        if: steps.check-app.outputs.app_changed == 'true'
        uses: actions/setup-java@be666c2fcd27ec809703dec50e508c2fdc7f6654 # v5
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Set up Gradle
        if: steps.check-app.outputs.app_changed == 'true'
        uses: gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c # v5
        with:
          cache-read-only: false

      - name: Install Apple API key
        if: steps.check-app.outputs.app_changed == 'true'
        env:
          APP_STORE_CONNECT_KEY: ${{ secrets.APP_STORE_CONNECT_KEY }}
          APP_STORE_CONNECT_KEY_ID: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
        run: |
          mkdir -p ~/private_keys
          echo "$APP_STORE_CONNECT_KEY" > ~/private_keys/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8

      - name: Decode signing certificate and provisioning profile
        if: steps.check-app.outputs.app_changed == 'true'
        env:
          IOS_CERTIFICATE_BASE64: ${{ secrets.IOS_CERTIFICATE_BASE64 }}
          IOS_CERTIFICATE_PASSWORD: ${{ secrets.IOS_CERTIFICATE_PASSWORD }}
          IOS_PROVISION_PROFILE_BASE64: ${{ secrets.IOS_PROVISION_PROFILE_BASE64 }}
        run: |
          CERTIFICATE_PATH=$RUNNER_TEMP/certificate.p12
          KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
          echo "$IOS_CERTIFICATE_BASE64" | base64 -d > "$CERTIFICATE_PATH"
          security create-keychain -p "" "$KEYCHAIN_PATH"
          security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
          security unlock-keychain -p "" "$KEYCHAIN_PATH"
          security import "$CERTIFICATE_PATH" -P "$IOS_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
          security set-key-partition-list -S apple-tool:,apple: -k "" "$KEYCHAIN_PATH"
          security list-keychain -d user -s "$KEYCHAIN_PATH"

          PROFILE_PATH=$RUNNER_TEMP/profile.mobileprovision
          echo "$IOS_PROVISION_PROFILE_BASE64" | base64 -d > "$PROFILE_PATH"
          PROFILE_UUID=$(/usr/bin/security cms -D -i "$PROFILE_PATH" 2>/dev/null | grep -A1 '<key>UUID</key>' | grep '<string>' | sed 's/.*<string>\(.*\)<\/string>.*/\1/')
          mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
          cp "$PROFILE_PATH" ~/Library/MobileDevice/Provisioning\ Profiles/${PROFILE_UUID}.mobileprovision

      - name: Select Xcode 26
        if: steps.check-app.outputs.app_changed == 'true'
        run: |
          XCODE_26=$(ls -d /Applications/Xcode_26*.app 2>/dev/null | head -1)
          if [ -z "$XCODE_26" ]; then
            echo "Available Xcode versions:"
            ls /Applications/Xcode*.app
            echo "::error::Xcode 26 not found on this runner"
            exit 1
          fi
          sudo xcode-select -s "$XCODE_26/Contents/Developer"

      - name: Decode google-services.json
        if: steps.check-app.outputs.app_changed == 'true'
        env:
          GOOGLE_SERVICES_DEV_BASE64: ${{ secrets.GOOGLE_SERVICES_DEV_BASE64 }}
        run: |
          mkdir -p app/src/dev app/src/prod
          echo "$GOOGLE_SERVICES_DEV_BASE64" | base64 -d > app/src/dev/google-services.json
          echo "$GOOGLE_SERVICES_DEV_BASE64" | base64 -d > app/src/prod/google-services.json

      - name: Build KMP shared framework for iOS
        if: steps.check-app.outputs.app_changed == 'true'
        run: ./gradlew :shared:linkReleaseFrameworkIosArm64

      - name: Build and archive iOS app
        if: steps.check-app.outputs.app_changed == 'true'
        run: |
          cd iosApp
          xcodebuild \
            -project iosApp.xcodeproj \
            -scheme iosApp \
            -sdk iphoneos \
            -configuration Release \
            -archivePath $RUNNER_TEMP/iosApp.xcarchive \
            CODE_SIGN_STYLE=Manual \
            CODE_SIGN_IDENTITY="Apple Distribution" \
            PROVISIONING_PROFILE_SPECIFIER="ShyTalk App Store Distribution" \
            DEVELOPMENT_TEAM=F3XX4PM3MF \
            archive

      - name: Export IPA
        if: steps.check-app.outputs.app_changed == 'true'
        env:
          APP_STORE_CONNECT_KEY_ID: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          APP_STORE_CONNECT_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
        run: |
          cd iosApp
          xcodebuild \
            -exportArchive \
            -archivePath $RUNNER_TEMP/iosApp.xcarchive \
            -exportOptionsPlist ExportOptions.plist \
            -exportPath $RUNNER_TEMP/export \
            -authenticationKeyPath ~/private_keys/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8 \
            -authenticationKeyID $APP_STORE_CONNECT_KEY_ID \
            -authenticationKeyIssuerID $APP_STORE_CONNECT_ISSUER_ID

      - name: Upload to TestFlight
        if: steps.check-app.outputs.app_changed == 'true'
        env:
          APP_STORE_CONNECT_KEY_ID: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          APP_STORE_CONNECT_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
        run: |
          xcrun altool --upload-app \
            -f $RUNNER_TEMP/export/*.ipa \
            -t ios \
            --apiKey "$APP_STORE_CONNECT_KEY_ID" \
            --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"

      - name: Clean up keychain
        if: always()
        run: security delete-keychain $RUNNER_TEMP/app-signing.keychain-db 2>/dev/null || true

  playwright-tests:
    name: Playwright Tests
    needs: [deploy-backend-dev, deploy-web-dev]
    if: |
      always() &&
      inputs.playwright &&
      (needs.deploy-backend-dev.result == 'success' || needs.deploy-backend-dev.result == 'skipped') &&
      (needs.deploy-web-dev.result == 'success' || needs.deploy-web-dev.result == 'skipped')
    uses: ./.github/workflows/e2e-tests.yml
    with:
      android: 'none'
      ios: 'none'
      web: 'all'
      parallel: true
      ref: ${{ github.sha }}
    secrets: inherit
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy-dev.yml
git commit -m "feat: add deploy-dev.yml — on-demand dev deploy + tester distribution"
```

---

## Chunk 5: deploy-prod.yml and final verification

### Task 8: Create deploy-prod.yml

**Files:**
- Create: `.github/workflows/deploy-prod.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/deploy-prod.yml` with this content:

```yaml
name: Deploy to Production

on:
  workflow_dispatch:
    inputs:
      release-tag:
        description: 'Release tag to deploy (e.g. v0.55.0)'
        type: string
        required: true
      backend:
        description: 'Deploy Express API to prod'
        type: boolean
        default: true
      web:
        description: 'Deploy web to prod'
        type: boolean
        default: true
      android:
        description: 'Build + upload to Play Store'
        type: boolean
        default: true
      ios:
        description: 'Build + upload to App Store'
        type: boolean
        default: true

permissions:
  contents: read
  issues: write

concurrency:
  group: deploy-prod
  cancel-in-progress: false

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  validate-release:
    name: Validate Release Tag
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      version: ${{ steps.validate.outputs.version }}
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          ref: ${{ inputs.release-tag }}
          fetch-depth: 0

      - name: Validate tag exists and is on main
        id: validate
        env:
          TAG: ${{ inputs.release-tag }}
        run: |
          # Verify tag exists
          if ! git tag -l "$TAG" | grep -q "$TAG"; then
            echo "::error::Tag $TAG does not exist"
            exit 1
          fi

          # Verify tag is reachable from main
          if ! git merge-base --is-ancestor "$TAG" origin/main 2>/dev/null; then
            echo "::warning::Tag $TAG may not be on the main branch"
          fi

          VERSION="${TAG#v}"
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          echo "Deploying release $TAG (version $VERSION)"

  deploy-backend-prod:
    name: Deploy Backend to Prod
    needs: [validate-release]
    if: inputs.backend
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          ref: ${{ inputs.release-tag }}

      - name: Set up Node
        uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6
        with:
          node-version: '24'

      - name: Install deploy tools
        run: npm install -g firebase-tools

      - name: Set up SSH
        env:
          SSH_KEY: ${{ secrets.SINGAPORE_SSH_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan 213.35.98.160 >> ~/.ssh/known_hosts

      - name: Archive previous API version
        run: ssh ubuntu@213.35.98.160 "cd ~/shytalk-api && tar czf /tmp/api-previous.tar.gz --exclude='node_modules' --exclude='.env' ."

      - name: Deploy Express API to Singapore (prod)
        run: |
          cd express-api
          tar czf /tmp/api.tar.gz --exclude='node_modules' --exclude='.env' .
          scp /tmp/api.tar.gz ubuntu@213.35.98.160:/tmp/
          ssh ubuntu@213.35.98.160 "cd ~/shytalk-api && tar xzf /tmp/api.tar.gz && npm install --omit=dev && pm2 restart shytalk-api"

      - name: Verify prod API health
        run: |
          for i in 1 2 3 4 5; do
            sleep 5
            if curl -sf https://api.shytalk.shyden.co.uk/api/health; then exit 0; fi
            echo "Health check attempt $i failed, retrying..."
          done
          echo "Prod API health check failed after 5 attempts"
          exit 1

      - name: Deploy Firestore rules to prod
        env:
          FIREBASE_SERVICE_ACCOUNT_PROD: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_PROD }}
        run: |
          echo "$FIREBASE_SERVICE_ACCOUNT_PROD" > /tmp/firebase-sa.json
          export GOOGLE_APPLICATION_CREDENTIALS=/tmp/firebase-sa.json
          firebase deploy --only firestore:rules --project shytalk-7ba69 --non-interactive
          rm /tmp/firebase-sa.json

      - name: Deploy RTDB rules to prod
        env:
          FIREBASE_SERVICE_ACCOUNT_PROD: ${{ secrets.FIREBASE_SERVICE_ACCOUNT_PROD }}
        run: |
          echo "$FIREBASE_SERVICE_ACCOUNT_PROD" > /tmp/firebase-sa.json
          export GOOGLE_APPLICATION_CREDENTIALS=/tmp/firebase-sa.json
          firebase deploy --only database --project shytalk-7ba69 --non-interactive
          rm /tmp/firebase-sa.json

  deploy-web-prod:
    name: Deploy Web to Prod
    needs: [validate-release]
    if: inputs.web
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          ref: ${{ inputs.release-tag }}

      - name: Set up Node
        uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6
        with:
          node-version: '24'

      - name: Install deploy tools
        run: npm install -g wrangler

      - name: Deploy web to prod site
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: '9315582c39b627dca58dfa83602db385'
          PROD_FIREBASE_API_KEY: ${{ secrets.PROD_FIREBASE_API_KEY }}
        run: |
          sed "s|<PROD_FIREBASE_API_KEY>|$PROD_FIREBASE_API_KEY|" public/admin/config.example.js > public/admin/config.js
          wrangler pages deploy public --project-name shytalk-site --branch main

  deploy-android-prod:
    name: Deploy Android to Play Store
    needs: [validate-release]
    if: inputs.android
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          ref: ${{ inputs.release-tag }}

      - name: Set up JDK 17
        uses: actions/setup-java@be666c2fcd27ec809703dec50e508c2fdc7f6654 # v5
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c # v5
        with:
          cache-read-only: false

      - name: Decode google-services.json
        env:
          GOOGLE_SERVICES_DEV_BASE64: ${{ secrets.GOOGLE_SERVICES_DEV_BASE64 }}
          GOOGLE_SERVICES_PROD_BASE64: ${{ secrets.GOOGLE_SERVICES_PROD_BASE64 }}
        run: |
          mkdir -p app/src/dev app/src/prod
          echo "$GOOGLE_SERVICES_DEV_BASE64" | base64 -d > app/src/dev/google-services.json
          echo "$GOOGLE_SERVICES_PROD_BASE64" | base64 -d > app/src/prod/google-services.json

      - name: Decode keystore
        env:
          KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}
        run: echo "$KEYSTORE_BASE64" | base64 -d > keystore.jks

      - name: Build prodRelease
        env:
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
          LIVEKIT_URL: ${{ secrets.LIVEKIT_URL }}
        run: ./gradlew assembleProdRelease bundleProdRelease

      - name: Run prod smoke tests
        env:
          KEYSTORE_PASSWORD: ${{ secrets.KEYSTORE_PASSWORD }}
          LIVEKIT_URL: ${{ secrets.LIVEKIT_URL }}
        run: ./gradlew testProdReleaseUnitTest

      - name: Upload to Play Store internal testing track
        uses: r0adkll/upload-google-play@935ef9c68bb393a8e6116b1575626a7f5be3a7fb # v1
        with:
          serviceAccountJsonPlainText: ${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}
          packageName: com.shyden.shytalk
          releaseFiles: app/build/outputs/bundle/prodRelease/*.aab
          track: internal
          status: draft

  deploy-ios-prod:
    name: Deploy iOS to App Store
    needs: [validate-release]
    if: inputs.ios
    runs-on: macos-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with:
          ref: ${{ inputs.release-tag }}

      - name: Set up JDK 17
        uses: actions/setup-java@be666c2fcd27ec809703dec50e508c2fdc7f6654 # v5
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c # v5
        with:
          cache-read-only: false

      - name: Install Apple API key
        env:
          APP_STORE_CONNECT_KEY: ${{ secrets.APP_STORE_CONNECT_KEY }}
          APP_STORE_CONNECT_KEY_ID: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
        run: |
          mkdir -p ~/private_keys
          echo "$APP_STORE_CONNECT_KEY" > ~/private_keys/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8

      - name: Decode signing certificate and provisioning profile
        env:
          IOS_CERTIFICATE_BASE64: ${{ secrets.IOS_CERTIFICATE_BASE64 }}
          IOS_CERTIFICATE_PASSWORD: ${{ secrets.IOS_CERTIFICATE_PASSWORD }}
          IOS_PROVISION_PROFILE_BASE64: ${{ secrets.IOS_PROVISION_PROFILE_BASE64 }}
        run: |
          CERTIFICATE_PATH=$RUNNER_TEMP/certificate.p12
          KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
          echo "$IOS_CERTIFICATE_BASE64" | base64 -d > "$CERTIFICATE_PATH"
          security create-keychain -p "" "$KEYCHAIN_PATH"
          security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
          security unlock-keychain -p "" "$KEYCHAIN_PATH"
          security import "$CERTIFICATE_PATH" -P "$IOS_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
          security set-key-partition-list -S apple-tool:,apple: -k "" "$KEYCHAIN_PATH"
          security list-keychain -d user -s "$KEYCHAIN_PATH"

          PROFILE_PATH=$RUNNER_TEMP/profile.mobileprovision
          echo "$IOS_PROVISION_PROFILE_BASE64" | base64 -d > "$PROFILE_PATH"
          PROFILE_UUID=$(/usr/bin/security cms -D -i "$PROFILE_PATH" 2>/dev/null | grep -A1 '<key>UUID</key>' | grep '<string>' | sed 's/.*<string>\(.*\)<\/string>.*/\1/')
          mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
          cp "$PROFILE_PATH" ~/Library/MobileDevice/Provisioning\ Profiles/${PROFILE_UUID}.mobileprovision

      - name: Select Xcode 26
        run: |
          XCODE_26=$(ls -d /Applications/Xcode_26*.app 2>/dev/null | head -1)
          if [ -z "$XCODE_26" ]; then
            echo "Available Xcode versions:"
            ls /Applications/Xcode*.app
            echo "::error::Xcode 26 not found on this runner"
            exit 1
          fi
          sudo xcode-select -s "$XCODE_26/Contents/Developer"

      - name: Decode google-services.json
        env:
          GOOGLE_SERVICES_DEV_BASE64: ${{ secrets.GOOGLE_SERVICES_DEV_BASE64 }}
          GOOGLE_SERVICES_PROD_BASE64: ${{ secrets.GOOGLE_SERVICES_PROD_BASE64 }}
        run: |
          mkdir -p app/src/dev app/src/prod
          echo "$GOOGLE_SERVICES_DEV_BASE64" | base64 -d > app/src/dev/google-services.json
          echo "$GOOGLE_SERVICES_PROD_BASE64" | base64 -d > app/src/prod/google-services.json

      - name: Build KMP shared framework for iOS
        run: ./gradlew :shared:linkReleaseFrameworkIosArm64

      - name: Build and archive iOS app
        run: |
          cd iosApp
          xcodebuild \
            -project iosApp.xcodeproj \
            -scheme iosApp \
            -sdk iphoneos \
            -configuration Release \
            -archivePath $RUNNER_TEMP/iosApp.xcarchive \
            CODE_SIGN_STYLE=Manual \
            CODE_SIGN_IDENTITY="Apple Distribution" \
            PROVISIONING_PROFILE_SPECIFIER="ShyTalk App Store Distribution" \
            DEVELOPMENT_TEAM=F3XX4PM3MF \
            archive

      - name: Export IPA
        env:
          APP_STORE_CONNECT_KEY_ID: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          APP_STORE_CONNECT_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
        run: |
          cd iosApp
          xcodebuild \
            -exportArchive \
            -archivePath $RUNNER_TEMP/iosApp.xcarchive \
            -exportOptionsPlist ExportOptions.plist \
            -exportPath $RUNNER_TEMP/export \
            -authenticationKeyPath ~/private_keys/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8 \
            -authenticationKeyID $APP_STORE_CONNECT_KEY_ID \
            -authenticationKeyIssuerID $APP_STORE_CONNECT_ISSUER_ID

      - name: Upload to App Store Connect
        env:
          APP_STORE_CONNECT_KEY_ID: ${{ secrets.APP_STORE_CONNECT_KEY_ID }}
          APP_STORE_CONNECT_ISSUER_ID: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
        run: |
          xcrun altool --upload-app \
            -f $RUNNER_TEMP/export/*.ipa \
            -t ios \
            --apiKey "$APP_STORE_CONNECT_KEY_ID" \
            --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID"

      - name: Clean up keychain
        if: always()
        run: security delete-keychain $RUNNER_TEMP/app-signing.keychain-db 2>/dev/null || true

  alert-desync:
    name: Alert - Deploy Failed
    needs: [validate-release, deploy-backend-prod, deploy-web-prod, deploy-android-prod, deploy-ios-prod]
    if: |
      always() &&
      needs.validate-release.result == 'success' &&
      (needs.deploy-backend-prod.result == 'failure' ||
       needs.deploy-web-prod.result == 'failure' ||
       needs.deploy-android-prod.result == 'failure' ||
       needs.deploy-ios-prod.result == 'failure')
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6

      - name: Create critical issue
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG: ${{ inputs.release-tag }}
          BACKEND: ${{ needs.deploy-backend-prod.result }}
          WEB: ${{ needs.deploy-web-prod.result }}
          ANDROID: ${{ needs.deploy-android-prod.result }}
          IOS: ${{ needs.deploy-ios-prod.result }}
        run: |
          FAILED=""
          [ "$BACKEND" = "failure" ] && FAILED="${FAILED}- Backend API\n"
          [ "$WEB" = "failure" ] && FAILED="${FAILED}- Web\n"
          [ "$ANDROID" = "failure" ] && FAILED="${FAILED}- Android (Play Store)\n"
          [ "$IOS" = "failure" ] && FAILED="${FAILED}- iOS (App Store)\n"

          BODY_FILE=$(mktemp)
          cat > "$BODY_FILE" <<BODYEOF
## Production Deploy Failed

**Release:** ${TAG}
**Run:** ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}

### Failed components
$(echo -e "$FAILED")

### Immediate action required
1. Check the deploy job logs for the failure reason
2. Fix the issue and re-run deploy-prod with the same tag
3. Verify production matches the expected release
4. Close this issue once resolved
BODYEOF
          gh issue create \
            --title "CRITICAL: Production deploy failed for ${TAG}" \
            --label "critical,prod-desync" \
            --body-file "$BODY_FILE"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy-prod.yml
git commit -m "feat: add deploy-prod.yml — manual production deploy by release tag"
```

### Task 9: Push and verify

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/pipeline-redesign
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: pipeline redesign — split monolith into 6 focused workflows" --body "$(cat <<'EOF'
## Summary
- Replace 1232-line `release.yml` monolith (9.5% PR success rate) with 6 focused workflows
- `pr-checks.yml`: PR quality gate (lint, build, test, SonarCloud, Android E2E smoke)
- `deploy-dev.yml`: On-demand dev deploy + tester distribution (workflow_dispatch)
- `release.yml`: Auto semver bump + GitHub release on merge to main (no deploy)
- `deploy-prod.yml`: Manual production deploy by release tag (workflow_dispatch)
- `sonarcloud.yml`: Rewritten to use Gradle plugin (remove standalone scanner)
- `e2e-tests.yml`: Bug fixes (heredoc whitespace, Playwright 401)
- Delete `e2e-trigger.yml` (no more comment triggers)
- Update `force-cancel.yml` for new workflow names
- Semver versioning starting at 0.54.0

## Test plan
- [ ] `pr-checks.yml` triggers and completes on this PR
- [ ] Lint, build-and-test, test-backend, sonarcloud jobs run correctly
- [ ] `deploy-dev.yml` works via workflow_dispatch from this branch
- [ ] After merge: `release.yml` creates GitHub release with semver tag
- [ ] `deploy-prod.yml` deploys the release tag to production
- [ ] `force-cancel.yml` can cancel all new workflow types

Spec: `.project/plans/2026-03-19-pipeline-redesign.md`
EOF
)"
```

- [ ] **Step 3: Verify pr-checks.yml runs on the PR**

```bash
gh run list --workflow=pr-checks.yml --limit 3
```

Expected: A run triggered by this PR's `pull_request` event.

- [ ] **Step 4: Verify old release.yml no longer triggers on PR**

The old `release.yml` triggered on `pull_request`. Since it's been replaced, only `pr-checks.yml` should fire. Verify no `Release Pipeline` run appears for this PR.

- [ ] **Step 5: Test deploy-dev.yml via workflow_dispatch**

```bash
gh workflow run deploy-dev.yml --ref feat/pipeline-redesign -f backend=false -f web=false -f android-testers=false -f ios-testers=false -f playwright=false
```

Expected: Run starts and completes (all jobs skipped since all inputs are false — validates the workflow parses correctly).

- [ ] **Step 6: After merge — verify release.yml creates a GitHub release**

After PR is merged to main:
```bash
gh release list --limit 3
```

Expected: A new release `v0.55.0` (since this is a `feat:` PR) with release notes.

- [ ] **Step 7: Test deploy-prod.yml**

```bash
gh workflow run deploy-prod.yml -f release-tag=v0.55.0 -f backend=false -f web=false -f android=false -f ios=false
```

Expected: Run starts, validate-release succeeds, all deploy jobs skipped (inputs false).
