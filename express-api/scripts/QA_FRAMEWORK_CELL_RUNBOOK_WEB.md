# QA Framework — Web Desktop Cell Runbook

Per-cell setup + verification + common-failures guide for the 4 web
desktop cells in the QA-runner matrix. Closes part of gap **F1**:
"No per-cell setup runbook (each of the 12 cells has its own
prerequisites)".

Covers: `chromium`, `firefox`, `webkit`, `edge`.

All four run via Playwright on the operator's macOS workstation (or
ubuntu CI). Browsers are downloaded by Playwright on first use; no
external browser installation required.

---

## Shared prerequisites (apply to all 4 cells)

| Requirement                    | Install command                                    | Verification                                 |
| ------------------------------ | -------------------------------------------------- | -------------------------------------------- |
| Node 24+                       | `brew install node@24` (macOS) or `nvm install 24` | `node --version` → 24.x                      |
| Express deps installed         | `cd express-api && npm ci`                         | `[ -d express-api/node_modules/playwright ]` |
| Playwright browsers downloaded | `npx playwright install` (run once)                | `~/.cache/ms-playwright/` populated          |
| PERSONAS_PASSWORD env var      | `source ~/.shytalk/dev-personas.env`               | `echo $PERSONAS_PASSWORD` non-empty          |
| FIREBASE\_<TARGET>\_API_KEY    | `export FIREBASE_DEV_API_KEY=...`                  | `echo $FIREBASE_DEV_API_KEY` non-empty       |

Run `node express-api/scripts/manual-qa-runner.js --check-env` to
verify all of the above in one shot.

---

## Cell: `chromium`

The canonical desktop cell. Most stable, fastest to launch.

### Setup

No additional setup beyond shared prerequisites. Chromium is bundled
with Playwright.

### Verification

```bash
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target dev
# Expected: chromium row → outcome=ok
```

### Smoke test

```bash
node express-api/scripts/manual-qa-runner.js \
  --smoke --target dev --filter chromium
# Expected: Smoke: 1 ok / 0 fail / 0 skip
```

### Common failures

| Symptom                                        | Root cause                        | Fix                                            |
| ---------------------------------------------- | --------------------------------- | ---------------------------------------------- |
| `browserType.launch: Executable doesn't exist` | Playwright browsers not installed | `npx playwright install chromium`              |
| `net::ERR_NAME_NOT_RESOLVED` on dev target     | DNS / network issue               | Verify `dev-api.shytalk.shyden.co.uk` resolves |
| `Auth/PERMISSION_DENIED`                       | PERSONAS_PASSWORD missing/wrong   | Re-source `~/.shytalk/dev-personas.env`        |

---

## Cell: `firefox`

Geckodriver-backed. ~2× slower bootstrap than chromium.

### Setup

```bash
npx playwright install firefox
```

### Verification

```bash
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target local --filter firefox
```

### Common failures

| Symptom                             | Root cause                           | Fix                                                                  |
| ----------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| `geckodriver /session failed (500)` | Firefox profile corruption           | `rm -rf ~/Library/Caches/firefox*` and re-install                    |
| `marionette.enabled=false`          | Firefox dev/release version mismatch | Use Playwright's bundled Firefox; don't override with system Firefox |
| Slow first-launch (>30s)            | Profile creation overhead            | Acceptable on first run; subsequent runs cache the profile           |

---

## Cell: `webkit`

Playwright's WebKit (Safari engine — but NOT Apple Safari). Useful
for catching iOS-Safari behaviour on macOS without device emulation.

### Setup

```bash
npx playwright install webkit
```

On ubuntu CI, requires `--with-deps` to install GTK + GStreamer libs:

```bash
npx playwright install --with-deps webkit
```

### Verification

```bash
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target local --filter webkit
```

### Common failures

| Symptom                                               | Root cause                                          | Fix                                                          |
| ----------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| `Host system is missing dependencies to run browsers` | Ubuntu missing GTK/GStreamer                        | `npx playwright install --with-deps webkit`                  |
| Headless crashes on first launch                      | WebKit's playwright build needs JIT permissions     | Run with `--headed` to inspect; check macOS SIP not blocking |
| Different rendering vs real Safari                    | WebKit ≠ Safari (font rendering, JS engine version) | Cross-reference on a real iPhone via mobile-safari-ios cell  |

---

## Cell: `edge`

Microsoft Edge (Chromium-based since 2020). Playwright launches the
SYSTEM Edge install, not a bundled one.

### Setup

| Platform | Install Edge                                                                  | Verification                              |
| -------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| macOS    | `brew install --cask microsoft-edge`                                          | `/Applications/Microsoft Edge.app` exists |
| Ubuntu   | `sudo apt install microsoft-edge-stable` (or `npx playwright install msedge`) | `which microsoft-edge-stable`             |
| Windows  | Pre-installed                                                                 | `Get-Command msedge`                      |

### Verification

```bash
node express-api/scripts/manual-qa-runner.js \
  --check-drivers --target local --filter edge
```

### Common failures

| Symptom                                         | Root cause                                                    | Fix                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Executable doesn't exist at /Applications/...` | Edge not installed                                            | Install via brew (macOS) or apt (Linux)                                                   |
| Edge version mismatch                           | Edge auto-updated to a version newer than Playwright supports | `brew pin microsoft-edge` to freeze; or download specific version from microsoft.com/edge |
| Codec / DRM failures                            | Playwright's Edge launches without DRM modules                | Acceptable for QA matrix; not a real-user issue                                           |

---

## Cross-cell debugging

If multiple cells fail with the same symptom, suspect:

1. **PERSONAS_PASSWORD wrong** — re-source `~/.shytalk/dev-personas.env`
2. **dev target unreachable** — `curl -I dev-api.shytalk.shyden.co.uk`
3. **Local stack down** (local target) — `bash local/start.sh`
4. **Playwright browsers stale** — `rm -rf ~/.cache/ms-playwright && npx playwright install`

See [QA_FRAMEWORK_TROUBLESHOOTING.md](./QA_FRAMEWORK_TROUBLESHOOTING.md)
for runner-wide diagnostics.
