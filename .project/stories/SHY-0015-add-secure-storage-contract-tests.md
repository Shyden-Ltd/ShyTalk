---
id: SHY-0015
status: Draft
owner: claude
created: 2026-06-07
priority: P0
effort: S
type: bug
roadmap_ids: [G019]
pr:
mvp: true
---

# SHY-0015: SecureStorage + CryptoKeyPair contract tests

## User Story

As the ShyTalk operator who relies on the SecureStorage abstraction for PIN storage, biometric session tokens, and pending message encryption keys, I want **the expect/actual contract for `SecureStorage` and `CryptoKeyPair` to have adversarial commonTest contract tests + platform-specific error-path tests on both Android (EncryptedSharedPrefs) and iOS (Keychain)**, so that any regression to the cryptographic substrate is caught in CI rather than at runtime on user devices.

## Why

`shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/SecureStorage.kt` and `CryptoKeyPair.kt` define an `expect`/`actual` contract that:

- On Android, delegates to `EncryptedSharedPrefs` backed by AndroidKeyStore.
- On iOS, delegates to Keychain Services with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`.

This substrate underpins:

- **PIN storage** — `LockScreenViewModel` + `PinSetupViewModel` read/write the user's lock PIN here.
- **Biometric session tokens** — when the user authenticates via Face ID / fingerprint, the resulting session attestation is stored here.
- **Pending message encryption keys** — `IosMessage` + `AndroidMessage` repositories use `CryptoKeyPair` for end-to-end-encrypted message persistence between sign-in events.

Roadmap row G019 (line 63 of `.project/test-plans/exhaustive/2026-06-05-zero-gap-roadmap.md`):

> Sev: 🟠 Important. Category: Test — SecureStorage + CryptoKeyPair contract. Location: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/SecureStorage.kt`, `CryptoKeyPair.kt`. Gap: expect/actual contract (Android EncryptedSharedPrefs + iOS Keychain) untested. Fix: commonTest contract + platform-specific error path tests. Scope: S.

Bumped to Tier 1 P0 under SHY-0032 because:

1. A silent failure in this substrate would mean PINs save successfully on one platform but not the other (cross-platform user-facing bug).
2. A regression to plaintext storage would be a security incident category-of-its-own (PIN leak, message-key leak).
3. The "operator-explicit quality + reliability" weighting means crypto foundations get the highest bar.
4. Without test coverage, every refactor of `SecureStorage.kt` is a guess about whether platform implementations still meet the contract.

## Acceptance Criteria

> **⚠️ No-Stubs supersession** ([[feedback-no-stubs-mocks-fakes-real-only]], operator 2026-06-13): any `Fake*` / `mock-*` / Robolectric-as-real-device named in the AC / BDD / Risks below is a now-banned in-process test double. The `### Pre-Merge Testing Protocol` subsection + the `## Notes` No-Stubs entry govern — implement against the **real local emulator stack / real device**, OR await the flagged 🔴 operator decision on the foundational fake harness. Do NOT implement the named double as written.

### Happy path

- [ ] A new `shared/src/commonTest/kotlin/com/shyden/shytalk/core/util/SecureStorageContractTest.kt` exists with a **single shared test class** that the platform test sources (`androidUnitTest` + `iosTest` or `androidInstrumentedTest` + `iosTest`) extend. The contract enumerates the minimum required behaviour both platforms must satisfy.
- [ ] Round-trip contract: `secureStorage.put("k", "v")` followed by `secureStorage.get("k")` returns `"v"` on both Android and iOS.
- [ ] Delete contract: `put("k", "v") → delete("k") → get("k")` returns `null` on both platforms.
- [ ] List/iteration contract (if the API exposes it): after `put("a","1") + put("b","2")`, listing keys returns both.
- [ ] CryptoKeyPair contract: `generate()` returns a pair where `publicKey != privateKey`, the public key encrypts plaintext that the private key can decrypt round-trip, and consecutive `generate()` calls return distinct pairs.
- [ ] Android platform test in `shared/src/androidInstrumentedTest/kotlin/.../AndroidSecureStorageTest.kt` exercises the contract using a real EncryptedSharedPrefs instance backed by AndroidKeyStore.
- [ ] iOS platform test in `shared/src/iosTest/kotlin/.../IosSecureStorageTest.kt` (or `iosSimulatorArm64Test`/`iosArm64Test` source set) exercises the contract using real Keychain Services.
- [ ] Tests run via `./gradlew :shared:jvmTest`, `./gradlew :shared:connectedAndroidTest`, and `./gradlew :shared:iosSimulatorArm64Test`.
- [ ] All contract assertions pass on both platforms.

### Error paths

- [ ] **Storage unavailable** (Android: AndroidKeyStore unreachable; iOS: Keychain locked by OS): `get()` returns `null` or throws a typed `SecureStorageException`; never silently returns garbage. Verified by a fake backend that throws the platform's "storage unavailable" exception.
- [ ] **OS denies access** (Android: app uninstall-reinstall purges keystore; iOS: passcode disabled then re-enabled invalidates Keychain items): the contract surfaces this as a typed exception; the consumer (`LockScreenViewModel`) handles by treating PIN as "not set" and redirecting to setup.
- [ ] **Key generation failure** (insufficient entropy, hardware-backed keystore unavailable): `CryptoKeyPair.generate()` throws `CryptoUnavailableException` with a clear message; ViewModels surface a user-facing fallback (e.g. "biometric not available; please use PIN").
- [ ] **Corrupted ciphertext** (file modified out-of-band, key rotated mid-flight): `get()` throws `SecureStorageCorruptionException`; the consumer wipes the corrupted entry and logs a non-fatal Crashlytics report.
- [ ] **Concurrent writes** (two threads call `put("k", ...)` simultaneously): the contract guarantees one of the writes wins atomically; no torn writes (neither value is half-old / half-new). Verified via a multi-threaded test that issues 10 parallel writes and asserts the final value is one of the 10.

### Edge cases

- [ ] **Empty value** (`put("k", "")`): round-trips correctly; `get("k")` returns `""` not `null`. (This distinguishes "stored empty" from "not stored".)
- [ ] **Very large value** (1 MB string): stored + retrieved correctly OR throws `PayloadTooLargeException` with the platform's hard limit documented in the exception message. EncryptedSharedPrefs has a ~1 MB per-key limit; Keychain has a ~16 KB attribute limit but allows larger `kSecValueData`.
- [ ] **Special characters** in keys and values (null bytes, emoji, RTL Unicode, control characters): round-trips byte-for-byte identical; no encoding corruption.
- [ ] **Key collision with platform-reserved namespace** (Android: `androidx.security.crypto.encrypted_*`; iOS: any key matching iCloud Keychain sync prefix): contract test asserts our keys are namespaced (e.g. prefixed `com.shyden.shytalk.`) so we never collide.
- [ ] **Lifecycle: app process death between `put` and `get`**: a value put in one process invocation is retrievable in the next (verified via an instrumented test that kills + relaunches the test process).
- [ ] **Lifecycle: device reboot between `put` and `get`** (Android only): values persist (EncryptedSharedPrefs uses AndroidKeyStore which survives reboot).
- [ ] **Migration from non-encrypted SharedPreferences** (Android only, if applicable): if a key existed pre-encryption-migration, it's migrated transparently; documented.

### Performance

- [ ] `put()` completes within 50ms p99 on the dev Pixel 7 (measured by a benchmark in the test).
- [ ] `get()` completes within 10ms p99 (typically cached after first read).
- [ ] `CryptoKeyPair.generate()` completes within 200ms p99 (key generation is intentionally slow due to entropy gathering).
- [ ] No detectable memory leak after 1000 put/get cycles (verified via a test that asserts heap size stable).

### Security

- [ ] Plaintext values NEVER appear in:
  - Android logcat (`adb logcat | grep <known-test-value>` returns empty after a `put`).
  - iOS `Console.app` device log.
  - Crash reports or non-fatal Crashlytics reports.
  - Backup files (Android: `adb backup` of the app contains no plaintext; iOS: Keychain entries with `ThisDeviceOnly` accessibility don't get included in iCloud backups).
- [ ] Encryption-at-rest is verified by reading the underlying storage file (Android: `EncryptedSharedPrefs` file in `/data/data/<pkg>/shared_prefs/` is binary, not parseable as plaintext; iOS: Keychain entries decrypt only with the device passcode).
- [ ] Key rotation: if `CryptoKeyPair.generate()` is called twice for the same logical purpose (e.g. session token), the old key is destroyed; orphaned keys are not left in the keystore.
- [ ] No fall-through to insecure storage: the platform `actual` implementations MUST NOT silently degrade to `SharedPreferences` (Android) or `NSUserDefaults` (iOS) if the secure backend fails; instead they throw.
- [ ] OWASP MASVS storage requirements: V2.1 (no sensitive data in app-readable storage), V2.2 (no sensitive data in logs), V2.3 (no sensitive data in clipboard), V2.4 (Keychain/Keystore used), V2.5 (key generation properly seeded). Each requirement gets at least one assertion.

### UX

- [ ] When a contract violation surfaces (e.g. corrupted entry), the consumer gets a typed exception with a recovery hint; the user is NOT shown a generic "something went wrong" toast — instead the relevant flow (e.g. PIN entry) gracefully redirects to setup.
- [ ] No UX regression vs current behaviour for the happy path.

### i18n

- [ ] N/A — exception messages are internal (logged + observed, not shown to user verbatim); user-facing recovery messages live in the calling ViewModel's `strings.xml` references which are unchanged.

### Observability

- [ ] Add structured logging breadcrumbs (NOT plaintext values):
  - `Log.d("SecureStorage", "put: key=$key (size=${bytes.size} bytes)")` — key + size, never value.
  - `Log.d("SecureStorage", "get: key=$key (hit=$found)")` — boolean hit/miss, never value.
  - `Log.w("SecureStorage", "corruption: key=$key — wiping")` — corruption events.
- [ ] Non-fatal Crashlytics reports on `SecureStorageCorruptionException` so we observe real-world incidence rates.
- [ ] Test runs emit JUnit XML to `build/test-results/`; Allure reports include the contract test results.
- [ ] Sonar coverage on `SecureStorage.kt` + `CryptoKeyPair.kt` + both platform actuals ≥85%.

## BDD Scenarios

**Scenario: Android round-trip via real EncryptedSharedPrefs**

- **Given** the SecureStorageContractTest is running on an Android instrumented test
- **And** the device has a working AndroidKeyStore
- **When** the test calls `secureStorage.put("test-key", "secret-value")` followed by `secureStorage.get("test-key")`
- **Then** the get returns `"secret-value"`
- **And** the underlying SharedPreferences XML file is binary (not human-readable)

**Scenario: iOS round-trip via real Keychain**

- **Given** the SecureStorageContractTest is running on an iOS simulator test
- **And** the simulator has a writable Keychain
- **When** the test calls `secureStorage.put("test-key", "secret-value")` followed by `secureStorage.get("test-key")`
- **Then** the get returns `"secret-value"`
- **And** `SecItemCopyMatching` confirms the entry has `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` attribute

**Scenario: Empty value distinguishes from absent value**

- **Given** an empty SecureStorage
- **When** `put("only-key", "")` is called
- **Then** `get("only-key")` returns `""` (empty string, not null)
- **And** `get("nonexistent-key")` returns `null`

**Scenario: Concurrent writes resolve atomically**

- **Given** an empty SecureStorage
- **When** 10 threads simultaneously call `put("contention-key", "thread-N")` for N=1..10
- **Then** after all threads complete, `get("contention-key")` returns exactly one of the 10 values
- **And** no torn write is observed (the value matches `Regex("thread-[1-9]|thread-10")`)

**Scenario: Corruption surfaces as typed exception**

- **Given** a value was `put("key", "value")` then the underlying storage file is tampered with externally (test setup writes garbage bytes)
- **When** `get("key")` is called
- **Then** the implementation throws `SecureStorageCorruptionException` with a message naming the key
- **And** a non-fatal Crashlytics report is logged with the exception
- **And** the entry is wiped (subsequent `get("key")` returns `null`)

**Scenario: No plaintext in logcat**

- **Given** logcat is captured during a `put("test-key", "totally-secret-value")` call
- **When** the logcat output is grep'd for "totally-secret-value"
- **Then** there are zero matches

**Scenario: CryptoKeyPair round-trip encryption**

- **Given** `CryptoKeyPair.generate()` returns a pair `(publicKey, privateKey)`
- **When** plaintext is encrypted with `publicKey` and the ciphertext is decrypted with `privateKey`
- **Then** the decrypted result equals the original plaintext
- **And** a second `generate()` call returns a different pair (`publicKey2 != publicKey`)

**Scenario: OWASP MASVS V2.4 — Keychain used on iOS**

- **Given** the iOS implementation of SecureStorage
- **When** static-analysis or runtime-inspection scans for `NSUserDefaults` writes containing sensitive data
- **Then** there are zero matches — all sensitive writes go through `SecItem*` Keychain APIs

## Test Plan (TDD)

### Red

1. Add `shared/src/commonTest/kotlin/com/shyden/shytalk/core/util/SecureStorageContractTest.kt` as an `expect class` (or `abstract class`) defining the contract.
2. Add `shared/src/androidInstrumentedTest/.../AndroidSecureStorageTest.kt` (extends or `actual`-implements the contract).
3. Add `shared/src/iosTest/.../IosSecureStorageTest.kt`.
4. Run `./gradlew :shared:connectedAndroidTest --tests "*SecureStorage*"` → all RED (most contract methods not implemented, or implementations have bugs the tests catch).
5. Run `./gradlew :shared:iosSimulatorArm64Test --tests "*SecureStorage*"` → all RED.
6. Specific failing assertions expected:
   - Concurrent-write atomicity test fails if the current `actual` lacks synchronization.
   - Corruption test fails if the current implementation throws untyped exceptions.
   - "No plaintext in logcat" fails if any production log statement logs values.

### Green

1. Fix any contract violations surfaced by the RED tests:
   - Add synchronization around mutation if missing.
   - Wrap platform exceptions in typed `SecureStorageException` / `SecureStorageCorruptionException`.
   - Audit production log statements; remove any value-bearing log lines.
   - Add the `'ownerFirebaseUid'`-style namespace prefixing if absent.
2. Re-run both platform test suites → all GREEN.
3. Run Sonar coverage check; verify ≥85% on the affected files.
4. Manual smoke: launch dev app on Android device + iOS simulator; set a PIN; confirm it persists across app restart.

### Pre-Merge Testing Protocol (per `CLAUDE.md` § Pre-Merge Testing Protocol)

**Not `*.md`-only** (adds contract + platform tests, may fix the Android/iOS `actual` crypto code) → the FULL gauntlet applies. This is the **cryptographic substrate** (PIN, biometric session tokens, message keys), so the security dimension is the headline, and the **real iOS device replaces the spec's "iOS simulator"** (the protocol forbids simulator for the app-level gauntlet).

**Frameworks exercised (RED→GREEN before any production fix):**
- ✅ **Kotlin/JVM unit** — the commonMain portion of `SecureStorageContractTest` (`./gradlew :shared:jvmTest`).
- ✅ **Android instrumented** — `AndroidSecureStorageTest` against real EncryptedSharedPrefs / AndroidKeyStore on a **real Android device** (`connectedDevDebugAndroidTest`), incl. the "no plaintext in logcat" grep + at-rest-binary check.
- ✅ **iOS Kotlin/Native test** — `IosSecureStorageTest` against real Keychain (`./gradlew :shared:iosSimulatorArm64Test`); the on-device Keychain accessibility (`ThisDeviceOnly`, no-iCloud-backup) is re-confirmed on the **real iPhone** journey.
- ✅ **detekt + ktlint** + **iOS shared compile-check** (`./gradlew :shared:compileKotlinIosArm64`).
- ✅ **Android instrumented BDD + Manual-QA journey matrix** — set a PIN, force-stop + relaunch (persistence), and confirm biometric session round-trip on a **real Android device AND a real iPhone**.
- ⬜ **Web E2E / integration / eslint / Express Jest** — N/A; full journey corpus runs as the regression net.
- ✅ **SonarCloud** — coverage gate (≥85% on SecureStorage/CryptoKeyPair + both actuals, per AC).

**LOCAL gauntlet:** contract + both platform suites green (incl. no-plaintext-leak assertions) → PIN-persistence + biometric journeys on real Android + real iPhone → impact-selected each loop, full corpus at the pre-push gate. Any failure → fix TDD → restart the whole local gauntlet.
**DEV gauntlet:** redeploy the unmerged branch via Deploy-To-Dev `ref`; real Android + real iPhone; web = Chrome only. Restart from LOCAL on failure. **Judgment-merge** only when production-ready with zero doubt — a plaintext-leak or cross-platform PIN-save divergence is a security incident, so the bar is absolute.

## Out of Scope

- **Migrating to a different crypto library** — only contract tests for the current implementation.
- **End-to-end encryption protocol design** — `CryptoKeyPair` is the primitive; the protocol layer (Signal-style ratcheting etc.) is separate.
- **Key escrow / recovery flows** — separate SHY.
- **iCloud Keychain sync configuration** — out of scope; we intentionally use `ThisDeviceOnly` accessibility.
- **Hardware-attestation flows** — not currently used; future SHY if needed.
- **Performance optimisation** — only baseline benchmarks; no tuning unless tests reveal a regression.

## Dependencies

- **SHY-0001** + **SHY-0032** — process dependencies.
- `shared/src/commonMain/.../SecureStorage.kt` + `CryptoKeyPair.kt` + Android + iOS actuals — existing files.
- `androidInstrumentedTest` source set must be configured (verify `app/build.gradle.kts`).
- `iosTest` (or `iosSimulatorArm64Test`/`iosArm64Test`) source sets must be configured (verify `shared/build.gradle.kts`).
- AndroidKeyStore + Keychain Services must be available in test environments (instrumented test on real device or AVD; iOS simulator).

## Risks & Mitigations

- **Risk:** Instrumented tests fail in CI because the GitHub Actions runner lacks a properly configured AndroidKeyStore. **Mitigation:** verify the existing CI workflow already runs instrumented tests against an AVD; if not, contribute the AVD config in this PR (likely a Firebase Test Lab or Macrobenchmark API hook).
- **Risk:** iOS test source set isn't currently wired; adding `iosTest` requires gradle config changes. **Mitigation:** check `shared/build.gradle.kts` for `iosTest` source set; if absent, add it + a sample test that just imports the contract; reviewer agent verifies build still works.
- **Risk:** The contract tests reveal a real production bug (e.g. iOS Keychain entry has wrong accessibility class, leaking via iCloud backup). **Mitigation:** GOOD outcome — fix in the same PR; document in Notes as a security finding.
- **Risk:** Concurrent-write atomicity test is flaky on slow CI hardware. **Mitigation:** use larger iteration counts (1000 instead of 10) + explicit `await`s; mark as `@FlakyTest` only if proven to be CI-resource-dependent (NOT a logic bug).
- **Risk:** The instrumented test takes >10 minutes per platform, slowing CI. **Mitigation:** parallelise; contract test is bounded ~5min per platform max.
- **Risk:** Mocking the platform crypto APIs in jvmTest produces false-positive coverage (we test fakes, not the real backend). **Mitigation:** all real platform behaviour is exercised in instrumented + iOS sim tests; jvmTest only covers commonMain logic that doesn't hit `expect`.

## Definition of Done

- [ ] Contract test file in commonTest exists.
- [ ] Android platform test in androidInstrumentedTest exists; passes.
- [ ] iOS platform test in iosTest exists; passes.
- [ ] All contract assertions, error-path assertions, edge-case assertions covered.
- [ ] No plaintext leaks in logcat / Console.app (verified by grep tests).
- [ ] Sonar coverage ≥85% on `SecureStorage.kt` + `CryptoKeyPair.kt` + Android + iOS actuals.
- [ ] If a production bug was surfaced, it's fixed in this PR (not deferred).
- [ ] **Pre-Merge Testing Protocol satisfied** (`CLAUDE.md` § Pre-Merge Testing Protocol): contract + both platform suites green (incl. no-plaintext-leak) + PIN-persistence/biometric journeys green on **real Android + real iPhone** (NOT a simulator — supersedes the old "iOS simulator" smoke) → `code-reviewer` 100% clean → push → CI green by name → DEV gauntlet green → **judgment-merge** (zero doubt; NO auto-merge).
- [ ] `released_in: vX.Y.Z` set after the release cut.
- [ ] `status: Done`; `pr:` populated; merge + smoke outcomes in Notes.

## Notes (running log)

- 2026-06-07 ~20:44 BST — Refined under SHY-0032. Bumped P1 → P0. Tier 1 security; foundational substrate.
- 2026-06-07 — Skeleton generated by `scripts/convert-roadmap-to-stories.sh` from PR-bundle `PR-E3` (roadmap_ids: G019).
- 2026-06-12 ~23:40 BST — **Embedded the Pre-Merge Testing Protocol** ([[SHY-0091]] pass): crypto substrate → security dimension headlines; named the framework set (commonMain unit + Android instrumented incl. no-plaintext-logcat + iOS Keychain test + PIN-persistence/biometric journeys). UPGRADED the spec's "iOS simulator" to a **real iPhone** (protocol forbids simulator for app-level gauntlet). DoD auto-merge → judgment-merge. Pickup-fitness: no dupes/stale found.
- 2026-06-13 ~01:55 BST — **No-Stubs flag (review-surfaced)** ([[feedback-no-stubs-mocks-fakes-real-only]]): AC names a "fake backend that throws storage-unavailable" + the Risks admit "mocking platform crypto APIs in jvmTest tests fakes, not the real backend" — exactly the false-confidence the rule targets. The real path: induce the storage-unavailable error on a real device (real Keychain/KeyStore), not a fake. Same foundational-fake class as [[SHY-0010]] (🔴 operator-decision item on the SHY-0091 handoff); AC/BDD/Risks prose superseded by the No-Stubs banner atop `## Acceptance Criteria` pending operator direction — NOT re-architected here.
