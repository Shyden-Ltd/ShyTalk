---
id: SHY-0092
status: Draft
owner: claude
created: 2026-06-13
priority: P2
effort: XS
type: chore
roadmap_ids: []
epic: EPIC-0003
pr:
mvp: false
---

# SHY-0092: Correct the misleading "STUB / SCAFFOLD for every method" driver docstrings

## User Story

**As** any engineer (or Claude session) reading the QA driver source to judge what is real vs unimplemented,
**I want** each driver's header docstring to accurately describe its current real-vs-stub state,
**So that** nobody mistakes a fully-implemented driver for a placeholder (and "rebuilds" working code), and nobody mistakes a genuinely-unimplemented path for a finished one — the exact false-confidence the No-Stubs rule exists to kill, in its inverse form.

## Why

EPIC-0003's evidence pass found two drivers whose **header comments lie about their own state** (the inverse No-Stubs hazard — a comment claiming "stub" over real code):
- `web-playwright-driver.js` lines 22–23/52/58/204 say *"Initial implementation: STUB FOR EVERY METHOD that returns false"* / *"Each is stubbed below"* / *"all return false (not implemented)"* — yet line 216+ defines real implementations that override the stubs, and the file drives the real web surface.
- `android-adb-driver.js` lines 10–11/62–63 say *"The current implementation is a SCAFFOLD: every method name … is wired to a stub"* — yet the file is **2560 lines of real ADB/UIAutomator implementations** (real override block starts line 210).

Separately, EPIC-0003's operator decision (2026-06-13) made **Appium the canonical real-iPhone native path**, demoting `ios-devicectl-driver.js` + `ios-simctl-driver.js` to **documented non-canonical alternatives whose UI inspection is intentionally unbuilt**. Their headers must say so explicitly, so a future session does not "complete" them under the No-Stubs rule when the canonical path is Appium.

This is documentation correctness only — no runtime behaviour changes. But because the files are `.js` (driver tooling, not `*.md`), the change runs the FULL Pre-Merge Testing Protocol (CLAUDE.md): the only exemption is `*.md`-only, and these are scripts.

## Acceptance Criteria

### Happy path
- [ ] `web-playwright-driver.js`'s header docstring accurately describes the **stub-registration + real-override** pattern (every contract name is wired to a fail-loud `return false` fallback; real implementations defined below override the names that are implemented) — it no longer claims the file is a blanket stub.
- [ ] `android-adb-driver.js`'s header docstring accurately states it is a **fully-implemented real ADB/UIAutomator driver** (with the same fail-loud fallback for any not-yet-mapped contract name) — it no longer claims "the current implementation is a SCAFFOLD".
- [ ] `ios-devicectl-driver.js` + `ios-simctl-driver.js` headers each carry an explicit **"NON-CANONICAL ALTERNATIVE"** note: the canonical real-iPhone native path is `ios-appium-driver.js` (EPIC-0003 decision 2026-06-13); these drivers' UI inspection is intentionally unimplemented and **not** on the Pre-Merge gauntlet path, so they are not a No-Stubs violation to be "completed".
- [ ] The runtime **fail-loud fallback log** wording (`[<driver>] stub:<name>(...) — not implemented yet`) is left intact and still accurate for genuinely-unmapped names (this is correct behaviour, not the lie being fixed).

### Error paths
- [ ] No code path, return value, exported symbol, or method registry changes — verified by the existing driver Jest + contract tests passing unchanged (a comment edit must not alter `listMethods()` output or any `*_METHOD_NAMES` constant).
- [ ] A representative real method that previously had a real override (e.g. `web-playwright` search-input resolution; `android-adb` real primitive) still behaves identically (the gauntlet journey smoke proves the file was not corrupted by the edit).

### Edge cases
- [ ] The devicectl/simctl note does **not** claim the drivers are deleted/removed — they still exist as selectable non-canonical drivers; only their canonical status + unbuilt-UI state is documented.
- [ ] `grep -RynE 'STUB FOR EVERY METHOD|is a SCAFFOLD' web-playwright-driver.js android-adb-driver.js` returns **empty** after the fix (the two specific false phrases are gone), while the legitimate fail-loud `stub:` log string remains.
- [ ] No other driver's accurate docstring is altered (the 6 web-mobile drivers + `ios-appium-driver` headers are not in scope; only the 4 named files change).

### Performance
- N/A — comment-only change; zero runtime/wall-clock impact on the drivers or the runner.

### Security
- N/A — no behaviour, no credentials, no command construction changed (the `execFileSync('/usr/bin/xcrun', …)` hardening in the iOS drivers is untouched).

### UX
- [ ] The "consumer" is a future Claude/dev reading the file cold: from the header alone they can correctly judge real-vs-stub in <10 s without reading 2560 lines — no header asserts a state the body contradicts.

### i18n
- N/A — English source-code comments (internal engineering; not a translated public surface).

### Observability
- [ ] The drivers' real runtime logging (the `stub:<name> — not implemented yet` fail-loud line that lets the runner surface an unmapped-method finding) is unchanged and still fires for genuinely-unmapped names.

## BDD Scenarios

**Scenario: a reader trusts the web-playwright header**
- **Given** `web-playwright-driver.js` with real method overrides below the registration loop
- **When** an engineer reads the file header
- **Then** the header describes the stub-registration + real-override pattern
- **And** it does not claim "STUB FOR EVERY METHOD that returns false"

**Scenario: a reader trusts the android-adb header**
- **Given** `android-adb-driver.js` with 2350+ lines of real implementations
- **When** an engineer reads the file header
- **Then** the header states it is a real ADB/UIAutomator driver (not a scaffold)
- **And** the No-Stubs hazard of "comment says stub over real code" is removed

**Scenario: devicectl/simctl are documented non-canonical**
- **Given** Appium is the canonical real-iPhone native path (EPIC-0003 decision)
- **When** an engineer reads `ios-devicectl-driver.js` / `ios-simctl-driver.js`
- **Then** each header states it is a non-canonical alternative with intentionally-unbuilt UI inspection
- **And** the reader will not "complete" it under the No-Stubs rule

**Scenario: behaviour is provably unchanged**
- **Given** the comment edits are applied
- **When** the driver Jest + contract + interface-pin tests run
- **Then** they pass unchanged (same `listMethods()`, same `*_METHOD_NAMES`)
- **And** a representative real-device journey still passes on the matrix

## Test Plan

Touches `.js` (driver tooling) → **NOT `*.md`-only → runs the FULL Pre-Merge Testing Protocol** (the device gauntlet's job here is to prove the comment edit did not corrupt the tooling). Real backends/devices per CLAUDE.md § No Stubs.

**Red (before):**
- `web-playwright-driver.js` + `android-adb-driver.js` headers contain the falsifying phrases; no guard prevents this comment-rot from regressing.
- `ios-devicectl-driver.js` + `ios-simctl-driver.js` headers do not state their non-canonical status.

**Green (after) — framework by framework:**
- **Express/Node (Jest)** `cd express-api && npm test`:
  - A docstring-honesty guard (in `tests/scripts/drivers/driver-contract.test.js` or a new `driver-docstring-honesty.test.js`) asserting, per driver: the falsifying phrase is **absent** AND a known real-method override token is **present** (guards both the lie and accidental gutting — testing the literal artifact changed, not behaviour-by-grep) — RED before the edit, GREEN after.
  - The devicectl/simctl guard asserts the `NON-CANONICAL ALTERNATIVE` marker is present in each header.
  - `driver-contract.test.js`, `driver-interface-pin.test.js`, `web-playwright-driver.test.js`, `android-adb-driver.test.js`, `ios-devicectl-driver.test.js`, `ios-simctl-driver.test.js` pass **unchanged** (no registry/contract drift).
- **eslint** `npm run lint` → 0 warnings (comments must not break max-len/jsdoc rules).
- **`--check-drivers`** `node scripts/manual-qa-runner.js --check-drivers --target local` → identical method surface + driver load before/after.
- **Device gauntlet (Phase 1 LOCAL):** the FULL matrix runs on the **real Android + real iPhone + all browsers**; a representative regression journey passes on each cell — proving the edit did not corrupt any driver. (This story is also the first end-to-end proof that EPIC-0003's "operational" matrix genuinely runs.)
- **Phase 2:** `code-reviewer` 100% clean → push → CI required checks **Detect Changes / Analyze JavaScript / PR Gate** green by name.
- **Phase 3 (DEV):** re-run on dev (web = Chrome) on the unmerged branch `ref`.

## Out of Scope
- Implementing any driver method (devicectl/simctl UI inspection stays unbuilt — that path is non-canonical per EPIC-0003; the canonical iOS work is SHY-0095).
- Touching the 6 web-mobile drivers or `ios-appium-driver` headers (their docstrings are accurate; `ios-appium`'s aspirational "delegates to iosUiDump" comment is corrected by SHY-0095 when those methods become real).
- Deleting devicectl/simctl (a later cleanup decision, not this story).

## Dependencies
- EPIC-0003 operator decision (2026-06-13): Appium is the canonical real-iPhone native path (drives the devicectl/simctl non-canonical wording).
- The QA driver Jest/contract test suite (present) for the no-behaviour-change proof.

## Risks & Mitigations
- **Risk:** a comment edit accidentally deletes/garbles a real code line. **Mitigation:** the unchanged driver Jest + contract tests + the real-method-present half of the guard + a real-device journey smoke catch any corruption.
- **Risk:** the guard test devolves into brittle structural-grep-as-behaviour. **Mitigation:** the guard tests the **literal artifact being changed** (the docstring text) — legitimate for a doc-honesty fix — and pairs phrase-absence with real-token-presence so it cannot be gamed by deleting the whole header.
- **Risk:** running the full device gauntlet for a comment change feels disproportionate. **Mitigation:** the protocol's only exemption is `*.md`-only; new exemptions are an operator call (see Notes) — and the run usefully proves the matrix is operational.

## Definition of Done
- [ ] All four driver headers corrected per the AC; the two false phrases grep-empty; the two non-canonical markers present.
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): docstring-honesty guard RED→GREEN + all driver Jest/contract/pin tests green unchanged + eslint 0 + `--check-drivers` identical surface → LOCAL device gauntlet green on real Android + real iPhone + all browsers → `code-reviewer` 100% clean → push → CI green by name (Detect Changes / Analyze JavaScript / PR Gate) → DEV gauntlet green → **judgment-merge** (zero doubt; NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-06-13 — Filed under EPIC-0003 (child build-order item **D**, the warm-up). Evidence captured at filing: `web-playwright-driver.js` falsifying lines 22–23/52/58/204; `android-adb-driver.js` lines 10–11/62–63; devicectl/simctl genuinely have unbuilt UI inspection (non-canonical per the Appium decision). **Interpretation surfaced for operator review (not assumed):** a comment-only `.js` change runs the full device gauntlet because the protocol's sole exemption is `*.md`-only and these are scripts; I did NOT carve a new "comments are exempt" rule. If the operator wants a "comment-only-in-test-tooling" exemption, that's a CLAUDE.md change they decide — flagged, not actioned.
