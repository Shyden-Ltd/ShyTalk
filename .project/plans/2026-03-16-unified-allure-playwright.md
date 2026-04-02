# Unified Allure Report + Playwright Multi-Browser — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Single Allure report at GitHub Pages combining Android E2E and Playwright web tests across 5 browsers, with environment metadata, trends, and no sensitive data leaks.

**Architecture:** Playwright config adds 5 browser projects with conditional Allure reporter. E2E workflow switches from `am instrument` to Gradle for Allure generation. Both result sets merge into unified report. Sanitization script strips secrets before publishing.

**Tech Stack:** Playwright + allure-playwright, Gradle + allure-kotlin, GitHub Actions, Allure CLI, GitHub Pages.

**Spec:** `.project/specs/2026-03-16-unified-allure-playwright-design.md`

---

## Chunk 1: Playwright Multi-Browser + Allure Reporter

### Task 1: Install allure-playwright

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install allure-playwright**

```bash
npm install --save-dev allure-playwright
```

- [ ] **Step 2: Verify existing tests still pass**

```bash
npx playwright test --project=chromium
```

Expected: 101 tests pass.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add allure-playwright dependency"
```

### Task 2: Update playwright.config.ts for multi-browser + Allure

**Files:**
- Modify: `playwright.config.ts`

- [ ] **Step 1: Rewrite playwright.config.ts**

```typescript
import { defineConfig, devices } from '@playwright/test';

const reporters: any[] = [
  ['html', { outputFolder: 'playwright-report' }],
  ['junit', { outputFile: 'playwright-results.xml' }],
];
if (process.env.ALLURE_ENABLED === 'true') {
  reporters.push([
    'allure-playwright',
    { outputFolder: `allure-results/${process.env.ALLURE_PROJECT || 'default'}`, suiteTitle: true },
  ]);
}

export default defineConfig({
  testDir: './tests/web',
  testIgnore: ['**/auth.setup.ts'],
  timeout: 60_000,
  retries: 1,
  workers: 1, // Serial — Firebase Auth rate-limits concurrent logins
  reporter: reporters,
  use: {
    baseURL: process.env.WEB_BASE_URL || 'https://dev.shytalk.shyden.co.uk',
    headless: true,
    screenshot: 'off', // Security: report is public
    trace: 'off',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
  ],
});
```

- [ ] **Step 2: Test that multi-browser works locally (Chromium only for speed)**

```bash
npx playwright test --project=chromium
```

Expected: 101 tests pass.

- [ ] **Step 3: Test Allure reporter produces output**

```bash
ALLURE_ENABLED=true ALLURE_PROJECT=chromium npx playwright test --project=chromium
ls allure-results/chromium/
```

Expected: Allure JSON result files in `allure-results/chromium/`.

- [ ] **Step 4: Add `allure-results/` to `.gitignore`**

Append to `.gitignore`:
```
allure-results/
```

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts .gitignore
git commit -m "feat: add multi-browser Playwright projects with conditional Allure reporter"
```

### Task 3: Create sanitization script

**Files:**
- Create: `.github/scripts/sanitize-allure.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# sanitize-allure.sh — Strip sensitive data from Allure results before publishing.
# Runs on the merged results directory before `allure generate`.

RESULTS_DIR="${1:-.}"

echo "Sanitizing Allure results in $RESULTS_DIR..."

# Patterns to strip from JSON result files and attachments
JWT_PATTERN='eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'
FIREBASE_KEY_PATTERN='AIza[A-Za-z0-9_-]{35}'
EMAIL_PATTERN='[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'

SANITIZED=0

while IFS= read -r file; do
  CHANGED=false

  # Strip JWTs
  if grep -qE "$JWT_PATTERN" "$file" 2>/dev/null; then
    sed -i -E "s/$JWT_PATTERN/[REDACTED_TOKEN]/g" "$file"
    CHANGED=true
  fi

  # Strip Firebase API keys
  if grep -qE "$FIREBASE_KEY_PATTERN" "$file" 2>/dev/null; then
    sed -i -E "s/$FIREBASE_KEY_PATTERN/[REDACTED_API_KEY]/g" "$file"
    CHANGED=true
  fi

  # Strip emails in attachment content (not in result JSON — those contain test names from public source)
  BASENAME=$(basename "$file")
  if [[ "$BASENAME" != *"-result.json" ]] && grep -qE "$EMAIL_PATTERN" "$file" 2>/dev/null; then
    sed -i -E "s/$EMAIL_PATTERN/[REDACTED_EMAIL]/g" "$file"
    CHANGED=true
  fi

  if [ "$CHANGED" = true ]; then
    SANITIZED=$((SANITIZED + 1))
  fi
done < <(find "$RESULTS_DIR" -type f \( -name "*.json" -o -name "*.txt" -o -name "*.log" \))

echo "Sanitization complete. $SANITIZED files modified."
```

- [ ] **Step 2: Make executable**

```bash
git add .github/scripts/sanitize-allure.sh
git update-index --chmod=+x .github/scripts/sanitize-allure.sh
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add Allure result sanitization script for public report security"
```

---

## Chunk 2: E2E Workflow Overhaul

### Task 4: Rewrite test-android to use Gradle + fix Allure

**Files:**
- Modify: `.github/workflows/e2e-tests.yml`
- Delete: `.github/scripts/run-e2e.sh`

- [ ] **Step 1: Read the current workflow file fully**

Read `.github/workflows/e2e-tests.yml`.

- [ ] **Step 2: Rewrite the workflow**

Key changes:
1. **Remove `build-android` job** — merge into `test-android`
2. **Rewrite `test-android`** to: checkout, setup JDK/Gradle, decode secrets, boot emulator via reactivecircus, run `./gradlew connectedDevDebugAndroidTest`, pull Allure results from device, write `environment.properties`, upload artifact
3. **Add `test-playwright` job** — checkout, setup Node.js, install browsers, run Playwright with `ALLURE_ENABLED=true`, write per-project `environment.properties`, upload artifact
4. **Update `e2e-summary`** — add `test-playwright` to needs
5. **Update `allure-report`** — add `test-playwright` to needs, add sanitization step before `allure generate`, update `if` condition to run when either android or playwright ran
6. **Delete `run-e2e.sh`** reference

The `test-android` job should use `reactivecircus/android-emulator-runner` with `script: ./gradlew connectedDevDebugAndroidTest --no-parallel --info`.

The `test-playwright` job:
```yaml
test-playwright:
  name: Playwright Web Tests
  needs: [resolve-inputs]
  if: always() && needs.resolve-inputs.result == 'success'
  runs-on: ubuntu-latest
  timeout-minutes: 60
  steps:
    - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
      with:
        ref: ${{ needs.resolve-inputs.outputs.ref }}

    - uses: actions/setup-node@53b83947a5a98c8d113130e565377fae1a50d02f # v6
      with:
        node-version: 22
        cache: npm

    - name: Install dependencies
      run: npm ci

    - name: Install Playwright browsers
      run: npx playwright install --with-deps

    - name: Run Playwright tests with Allure
      env:
        WEB_BASE_URL: https://dev.shytalk.shyden.co.uk
        ADMIN_EMAIL: ${{ secrets.ADMIN_EMAIL }}
        ADMIN_PASSWORD: ${{ secrets.ADMIN_PASSWORD }}
      run: |
        for PROJECT in chromium firefox webkit mobile-chrome mobile-safari; do
          echo "Running $PROJECT..."
          ALLURE_ENABLED=true ALLURE_PROJECT=$PROJECT \
            npx playwright test --project=$PROJECT || true
        done

    - name: Write environment.properties per project
      run: |
        for PROJECT in chromium firefox webkit mobile-chrome mobile-safari; do
          DIR="allure-results/$PROJECT"
          mkdir -p "$DIR"
          case "$PROJECT" in
            chromium)      VIEWPORT="1280x720"; BROWSER="Chromium" ;;
            firefox)       VIEWPORT="1280x720"; BROWSER="Firefox" ;;
            webkit)        VIEWPORT="1280x720"; BROWSER="WebKit" ;;
            mobile-chrome) VIEWPORT="393x851";  BROWSER="Mobile Chrome (Pixel 5)" ;;
            mobile-safari) VIEWPORT="390x844";  BROWSER="Mobile Safari (iPhone 13)" ;;
          esac
          cat > "$DIR/environment.properties" <<EOF
        platform=Web
        browser=$BROWSER
        viewport=$VIEWPORT
        base_url=dev.shytalk.shyden.co.uk
        EOF
        done

    - name: Upload Allure results
      uses: actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f # v7
      if: always()
      with:
        name: allure-results-playwright
        path: allure-results/
        retention-days: 14
```

- [ ] **Step 3: Delete run-e2e.sh**

```bash
git rm .github/scripts/run-e2e.sh
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/e2e-tests.yml
git commit -m "feat: unified Allure report — Gradle E2E + multi-browser Playwright in single workflow"
```

### Task 5: Push and trigger first unified run

- [ ] **Step 1: Push branch**

```bash
git push -u origin test/unified-allure-playwright
```

- [ ] **Step 2: Trigger workflow**

```bash
gh workflow run "E2E Tests" --ref test/unified-allure-playwright -f platform=android -f parallel=true
```

- [ ] **Step 3: Monitor and debug**

Watch the run. Fix issues as they appear:
- Gradle build failures → check google-services.json decode, keystore
- Emulator boot → already proven working with reactivecircus
- Allure results empty → check device pull step
- Playwright browser install failures → check Node.js version
- Sanitization script errors → check bash syntax

- [ ] **Step 4: Iterate until green**

Fix → commit → push → re-trigger. Keep going until both `test-android` and `test-playwright` pass and the Allure report has data.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve workflow issues for unified Allure report"
```

### Task 6: Verify Allure report content

- [ ] **Step 1: Check GitHub Pages**

Visit `https://shydenmcm.github.io/ShyTalk/` and verify:
- Android E2E tests appear with scenario names
- Playwright tests appear grouped by browser
- Environment info shows for each suite
- No sensitive data (tokens, emails, API keys) visible
- Trends show (may need 2+ runs for trend data)

- [ ] **Step 2: Verify sanitization worked**

Download the Allure result artifacts from the run. Grep for sensitive patterns:
```bash
# Should find nothing
grep -rE 'eyJ[A-Za-z0-9_-]+\.eyJ' allure-results-all/ || echo "No JWTs found (good)"
grep -rE 'AIza' allure-results-all/ || echo "No Firebase keys found (good)"
```

- [ ] **Step 3: Create PR**

```bash
gh pr create --title "Unified Allure report + multi-browser Playwright" --body "..."
```

- [ ] **Step 4: Verify CI, merge**
