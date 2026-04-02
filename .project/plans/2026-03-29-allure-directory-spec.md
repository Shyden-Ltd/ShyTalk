# Allure Report Directory Structure — Spec

_Date: 2026-03-29 | Status: Planned_

## Problem

Both Android E2E and Playwright workflows deploy to gh-pages root with `keep_files: false`, overwriting each other. Only the last-run report survives. No Express or Kotlin reports on Pages at all.

## Requirements

1. Per-suite reports: Android E2E, Playwright, Express (Jest), Kotlin (JUnit)
2. Per-environment: PR checks vs deploy-to-dev vs production smoke tests
3. Historical runs preserved (not just latest)
4. Root landing page with directory links
5. **PUBLIC-FACING — zero PII in any report**

## PII Prevention

These reports are on public GitHub Pages. Must ensure:
- No user emails, names, or IDs in test names or output
- No Firebase tokens or API keys in error messages
- No real Firestore document IDs
- Test data uses obviously fake names (`e2e-chromium-w0-u`, not real names)
- Allure environment.properties must not contain secrets
- Error screenshots must not show PII (admin panel tests show test-created data only)
- Jest coverage reports show code paths, not data — safe by default

## Directory Structure

```
shydenmcm.github.io/ShyTalk/
├── index.html                              ← Landing page
│
├── android-e2e/
│   ├── pr/
│   │   ├── latest/                         ← Allure report from most recent PR check
│   │   ├── history/                        ← Allure trend data (PR checks)
│   │   └── runs/
│   │       └── 2026-03-29-run-12345/       ← Historical run
│   └── deploy/
│       ├── latest/
│       ├── history/
│       └── runs/
│           └── 2026-03-29-run-12345/
│
├── playwright/
│   ├── pr/
│   │   ├── latest/
│   │   ├── history/
│   │   └── runs/
│   └── deploy/
│       ├── latest/
│       ├── history/
│       └── runs/
│
├── express/
│   ├── pr/
│   │   ├── latest/                         ← Jest HTML report + coverage
│   │   └── runs/
│   └── deploy/
│       ├── latest/
│       └── runs/
│
└── kotlin/
    ├── pr/
    │   ├── latest/                         ← JUnit/Gradle HTML test report
    │   └── runs/
    └── deploy/
        ├── latest/
        └── runs/
```

## Landing Page (index.html)

**This is public-facing** — treat it like a product page, not a dev tool. The audience includes testers, stakeholders, and curious users who find it via GitHub. It should be polished, welcoming, and educational.

### Design
- ShyTalk dark theme (matches app branding — `#121218` bg, `#1a1a2e` cards, `#8b7fff` accent)
- ShyTalk logo at top with tagline "Quality & Testing Dashboard"
- Responsive — works on mobile
- Smooth animations on card hover

### Content sections

**1. Hero**
- Logo + "ShyTalk Test Reports"
- Brief explanation: "We run thousands of automated tests across every platform to ensure ShyTalk is reliable, secure, and bug-free. Browse our latest test results below."

**2. Report cards grid** (2x2 on desktop, stacked on mobile)
Each card shows:
- Suite icon (phone for Android, globe for Playwright, terminal for Express, kotlin logo for Kotlin)
- Suite name + one-line description ("Android E2E — Full user journey tests on real Android emulators")
- Latest run: pass/fail badge, date, test count
- Two buttons: "PR Checks" and "Deploy Results" linking to `{suite}/{env}/latest/`
- "History" link to `{suite}/{env}/runs/`

**3. "How to read these reports" section**
Collapsible guide explaining:
- What Allure reports show (test cases, steps, attachments, trends)
- How to navigate: Overview → Suites → click a test → see steps + screenshots
- What "broken" vs "failed" vs "passed" means
- How to use the trend graphs
- What the different test suites cover (E2E = real device flows, Playwright = admin panel, Express = API, Kotlin = business logic)

**4. Footer**
- "Powered by Allure Framework"
- Link to ShyTalk website
- Last updated timestamp + CI run link

## Workflow Changes

### Current (broken)
```yaml
# Both do this — they overwrite each other:
publish_dir: allure-report
keep_files: false
```

### Proposed
```yaml
# Each workflow deploys to its own subdirectory:
publish_dir: allure-report
destination_dir: android-e2e/pr/latest   # or playwright/deploy/latest etc.
keep_files: true                          # Don't wipe other suites
```

### History preservation
```yaml
# Before generating report, copy to runs/ archive:
- name: Archive previous report
  run: |
    DATE=$(date +%Y-%m-%d)
    RUN_ID=${{ github.run_id }}
    DEST="runs/${DATE}-run-${RUN_ID}"
    # Copy current latest to archive before overwriting
    cp -r gh-pages/${SUITE}/${ENV}/latest ${DEST} 2>/dev/null || true

# Restore trend history from the suite-specific history dir:
- name: Copy history
  run: cp -r gh-pages/${SUITE}/${ENV}/history/* allure-results/history/ 2>/dev/null || true
```

### Landing page update
After each report deploy, regenerate `index.html` with updated timestamps:
```yaml
- name: Update landing page
  run: node scripts/generate-allure-index.js
```

## Runs Cleanup

**PR reports**: Delete test results for merged or cancelled PRs after 7 days. Use a scheduled GitHub Action (weekly cron) that:
1. Lists all PR report directories under `{suite}/pr/runs/`
2. Checks each PR's status via `gh pr view`
3. If merged or closed AND older than 7 days, delete the directory
4. Deploy reports keep indefinitely (these are release records)

**Deploy reports**: Keep last 30 per suite/env. Prune older runs monthly.

## Implementation Order

1. Create `scripts/generate-allure-index.js` — generates the landing page HTML
2. Update `e2e-tests.yml` — deploy to `android-e2e/{env}/latest/` with history
3. Update `playwright-tests.yml` — deploy to `playwright/{env}/latest/` with history
4. Add Express Jest HTML report step to `test-backend.yml`
5. Add Kotlin JUnit HTML report step to `build-and-test` in `pr-checks.yml`
6. Add landing page generation step to each workflow
7. Add PII scrubbing checks to each report generation step
