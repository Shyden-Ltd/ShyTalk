---
id: SHY-0151
status: Draft
owner: claude
created: 2026-07-01
priority: P1
effort: L
type: feature
roadmap_ids: []
epic: EPIC-0005
pr:
mvp: true
---

# SHY-0151: Reinstall-proof device bans via DeviceCheck (iOS) + Play Integrity (Android)

## User Story

**As** the team issuing device bans,
**I want** a banned device to stay banned even after a reinstall or data-clear — keyed off the **platforms' own device-integrity primitives** (Apple DeviceCheck, Google Play Integrity) rather than a resettable app-generated ID,
**So that** a banned device can't return simply by reinstalling, and **no innocent device is ever mistaken for a banned one**.

## Why

The bypass-surface review found the device ID is a **resettable** value — Android `Settings.Secure.ANDROID_ID` (`DeviceInfoCollector.android.kt:16-19`) and iOS `identifierForVendor` (`DeviceInfoCollector.ios.kt:31`) both reset on clear-data/reinstall, so a device ban keyed on them evaporates.

Hardware IDs (serial / IMEI / SIM) — the intuitive fix — are **platform-blocked for consumer apps**: Android 10+ requires `READ_PRIVILEGED_PHONE_STATE` (a system permission Google Play does not grant), iOS has never exposed them, and SIM is both restricted and swappable. So the fix uses the platforms' sanctioned anti-abuse primitives, which are **free** and **deterministic** (no false positives, unlike heuristic fingerprinting):
- **iOS — DeviceCheck:** Apple persists **2 bits per physical device** that **survive app reinstall/data-clear**, managed by Apple + keyed to the developer account. We set a "banned" bit on a banned device; on a fresh install we query it and re-apply the ban. Deterministic, Apple-managed, zero false positives.
- **Android — Play Integrity:** no DeviceCheck equivalent exists, so Android is attestation-based: Play Integrity verifies a **genuine, untampered device** and lets us bind a server-issued device token, raising evasion cost and letting us gate off an *attested* signal rather than a resettable ID. (Honest asymmetry: iOS gets a near-perfect persistent bit; Android gets strong attestation + a server token, not a permanent hardware ID.)

Operator decision (2026-07-01): use DeviceCheck + Play Integrity (both free); **phone-number verification is flagged as a possible future *paid* lever** (SMS has a per-verification cost, so it doesn't meet the "free" bar) — out of scope here.

## Acceptance Criteria

### Happy path
- [ ] A normal, untampered device passes its platform integrity check (DeviceCheck bit clear on iOS; Play Integrity "genuine" on Android) and onboards normally — no false block.
- [ ] Device bans are keyed off the platform primitive (DeviceCheck bit / Play-Integrity-bound token), **not** the resettable `ANDROID_ID` / `identifierForVendor`.

### Error paths
- [ ] A **banned iPhone that reinstalls** is recognised via its **persisted DeviceCheck bit** and re-blocked (Apple remembers the device across the reinstall).
- [ ] A **banned Android device that returns** is recognised via its Play-Integrity-attested / server-bound device signal and blocked or flagged.

### Edge cases
- [ ] **DeviceCheck is only 2 bits** — used as a binary "banned" flag (not general state); the design stays within that budget.
- [ ] **iOS device with no Apple-services / DeviceCheck availability** → a documented fallback (fall back to the existing signals + server enforcement; never a silent pass, never a false block).
- [ ] **Android device where Play Integrity is unavailable / fails** (no Play Services, uncertified) → treated as an unsafe/untrusted device (consistent with the existing Android device gate + SHY-0146), not silently trusted.
- [ ] **No false positives:** because the key is a platform-managed per-device signal (not a heuristic match), an innocent device is **never** mistaken for a banned one — the whole reason for this approach over fingerprint correlation.

### Performance
- [ ] The DeviceCheck / Play Integrity calls are async, done at registration / sign-in (not per-request); bounded; no measurable onboarding delay in the normal case.

### Security
- [ ] Reinstall-surviving, deterministic device bans: **iOS strong** (DeviceCheck bit persists across reinstall); **Android** via attestation + server-bound token. Keyed off platform-trusted signals, needing **no** hardware-ID permissions.
- [ ] Honest boundary: a determined attacker with genuinely new hardware still returns — this is layered with SHY-0149 (server enforcement) + SHY-0150 (rules) + account/network bans; it raises the cost, it is not an absolute lock (documented).
- [ ] The DeviceCheck bit / integrity verdict is set + read **server-side** with the platform keys; not client-forgeable.

### UX
- [ ] **Zero false positives** — a legitimate device is never wrongly blocked (deterministic, not a guess); a genuinely banned device sees the ban screen.

### i18n
- N/A — server-side device-integrity logic; any user-facing block reuses the existing localized ban screen.

### Observability
- [ ] The device-integrity decisions are logged for audit — DeviceCheck bit set/query results, Play Integrity verdicts, and the ban action taken — per [[feedback-comprehensive-default-debug-logging]]; no secret keys logged.

## BDD Scenarios

**Scenario: a banned iPhone stays banned even after reinstalling**

- **Given** an iPhone that was banned
- **When** it reinstalls the app to try to get a fresh start
- **Then** it is still recognised as the banned device and blocked (the device is remembered across the reinstall)

**Scenario: a banned Android device is recognised when it returns**

- **Given** a banned Android device
- **When** it reinstalls and tries to sign up again
- **Then** the app's device-integrity check recognises it and blocks or flags it

**Scenario: an ordinary device is never wrongly blocked**

- **Given** an ordinary, untampered device
- **When** someone installs the app and signs up
- **Then** they are never mistaken for a banned device — the check is exact, not a guess

**Scenario: a device that can't prove it's genuine is treated as unsafe**

- **Given** a device that fails the platform's genuineness check (for example a tampered or uncertified device)
- **When** it opens the app
- **Then** it is treated as an unsafe device, not silently trusted

## Test Plan

Touches `express-api/**` (DeviceCheck bit + Play Integrity verdict verification, server-side, with the platform keys) + the app device-registration path (iOS DeviceCheck token, Android Play Integrity token) → **backend + app change ⇒ Gate 4 full gauntlet**. Per § No Stubs: DeviceCheck + Play Integrity require **real Apple/Google services on real devices** (they cannot be emulated) — so the device legs are essential + partly operator-gated ([[project-qa-gauntlet-operator-gated]]).

**Red → Green (framework by framework):**
- **Express/Node (Jest, real emulator + real platform APIs where possible)**: the ban→DeviceCheck-bit set/query lifecycle (server sets the bit on ban, queries on registration); Play Integrity verdict verification (genuine → pass; failed/absent → treated unsafe); the device-ban key is the platform signal, not `ANDROID_ID`/`identifierForVendor`. Server-side token/verdict verification with the platform keys.
- **iOS (real iPhone, XCTest + on-device)**: DeviceCheck token generation on the device; a **real reinstall** → the persisted bit still flags the banned device (the core proof — needs a real device + Apple services; operator-gated).
- **Android (real device CPH2653)**: Play Integrity token on-device; a banned device reinstall → recognised/flagged; a device without Play Services → treated unsafe.
- **Static/quality:** `npm run lint` 0 warnings; prettier clean; iOS/Android lint clean.
- **Phase 1 LOCAL gauntlet:** Gate-4 full matrix — a real iPhone banned then reinstalled → still blocked (DeviceCheck); a real Android device banned then returning → flagged; ordinary devices unaffected. **Phase 2:** `code-reviewer` 100% clean → In Review → CI green. **Phase 3 (DEV):** verify DeviceCheck/Play Integrity against dev with the real platform keys.

## Out of Scope
- **Heuristic device fingerprinting / correlation** — explicitly replaced by the deterministic platform primitives (no false-positive risk).
- **Phone-number verification** — a strong *account-level* barrier, but SMS/OTP has a **per-verification cost** so it does not meet the "free" bar for launch (operator 2026-07-01). Flagged as a **possible future paid enhancement**; file its own story if/when the abuse justifies the cost.
- Serial / IMEI / SIM keying — **not possible** on consumer iOS/Android (platform-blocked; see Why).
- The **API/middleware** gate (SHY-0149) + **rules-level** gate (SHY-0150) — the enforcement layers this feeds; iOS in-app integrity detection is EPIC-0004 SHY-0146 (App Attest/DeviceCheck for *genuineness*; this story uses DeviceCheck for *ban persistence* — related, coordinate).

## Dependencies
- Apple **DeviceCheck** (developer-account key + the server-side API) + Google **Play Integrity API** (+ Play Services on device).
- The device-registration path (`/api/device-info`) + `DeviceInfoCollector` (android/ios) to carry the platform tokens.
- The `deviceBans` records + the ban lifecycle in SHY-0149 (where a ban sets the DeviceCheck bit / marks the token).
- Coordinate with SHY-0146 (iOS App Attest/DeviceCheck for device genuineness) to avoid duplicate DeviceCheck wiring.

## Risks & Mitigations
- **Risk:** DeviceCheck's 2-bit limit is too little for future needs. **Mitigation:** scope it to the binary "banned" flag now; richer per-device state is a separate concern.
- **Risk:** Android has no permanent per-device ID → a banned Android device with new hardware / a reset returns. **Mitigation:** honest defense-in-depth — Play Integrity + server token raise the cost; layered with SHY-0149/0150 + account/network bans; documented, not over-claimed.
- **Risk:** DeviceCheck/Play Integrity availability gaps (no Apple services / no Play Services). **Mitigation:** documented fallbacks that fail toward *treat-as-unsafe* / server-enforced, never a silent trusted pass or a false block.
- **Risk:** privacy/legal of device attestation. **Mitigation:** DeviceCheck/Play Integrity are Apple/Google-sanctioned + lighter-touch than raw fingerprinting; flag for the launch privacy/legal review ([[project-gdpr-export-osa17-legal-review]]).
- **Risk:** DeviceCheck/Play Integrity can't be emulated → CI can't fully cover it. **Mitigation:** the reinstall-survival proof is an operator-gated real-device gauntlet cell; server-side verdict verification is unit/integration-tested.

## Definition of Done
- [ ] DeviceCheck (iOS) bit set/query + Play Integrity (Android) verdict verification wired server-side + on-device; device bans keyed off the platform signal; documented fallbacks.
- [ ] **Pre-Merge Testing Protocol satisfied (Gate-4 full matrix):** Jest RED→GREEN (bit/verdict lifecycle · unsafe-on-failure · key-is-platform-signal) + **real-device reinstall-survival proof** (real iPhone DeviceCheck + real Android Play Integrity, operator-gated) → LOCAL gauntlet green → `code-reviewer` 100% clean → In Review → push → CI green → DEV green → **judgment-merge** (NO auto-merge; notify operator).
- [ ] `released_in: vX.Y.Z` set on the next release cut.

## Notes (running log)
- 2026-07-01 — **CREATED fully-refined** ([[feedback-no-skeleton-stories-fully-refined]]) under [[EPIC-0005-ban-enforcement-hardening]] from the bypass-surface map (vector 5: resettable device IDs). **Re-scoped during review:** the operator asked to key device bans off a unique identifier (serial/IMEI/SIM) to eliminate false positives — but those are **platform-blocked** for consumer apps (Android 10+ privileged permission; iOS never exposed; SIM swappable). Operator chose (AskUserQuestion) the platform-sanctioned + **free** primitives — **DeviceCheck (iOS)** (Apple-persisted per-device bit, survives reinstall, deterministic) + **Play Integrity (Android)** (attestation + server token) — replacing the original heuristic fingerprint-correlation (and its false-positive risk). **Phone-number verification** requested "if free"; it is **not** free (per-SMS cost) → flagged as a future paid enhancement, out of scope. `type: feature`, `mvp: true`. Non-technical BDD per [[feedback-non-technical-bdd]].
