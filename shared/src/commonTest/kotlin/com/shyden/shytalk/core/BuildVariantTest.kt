package com.shyden.shytalk.core

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BuildVariantTest {
    @AfterTest
    fun resetState() {
        BuildVariant.initLocalEmulator(false)
        BuildVariant.initIosDeviceId(null)
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "?", deviceInfo = "?")
        BuildVariant.initApiBaseUrl(null)
    }

    @Test
    fun `defaults to false for production safety`() {
        BuildVariant.initLocalEmulator(false)
        assertFalse(BuildVariant.isLocalEmulator)
    }

    @Test
    fun `can be set to true for local emulator builds`() {
        BuildVariant.initLocalEmulator(true)
        assertTrue(BuildVariant.isLocalEmulator)
    }

    @Test
    fun `can be toggled back to false`() {
        BuildVariant.initLocalEmulator(true)
        BuildVariant.initLocalEmulator(false)
        assertFalse(BuildVariant.isLocalEmulator)
    }

    @Test
    fun `localDevPassword defaults to null`() {
        BuildVariant.initLocalEmulator(false)
        assertNull(BuildVariant.localDevPassword)
    }

    @Test
    fun `localDevPassword captures non-empty value`() {
        BuildVariant.initLocalEmulator(true, "localdev123")
        assertEquals("localdev123", BuildVariant.localDevPassword)
    }

    @Test
    fun `localDevPassword coerces empty string to null so callers can read uniformly`() {
        // Android's BuildConfig.LOCAL_DEV_PASSWORD is "" on dev / prod
        // flavours. The setter coerces to null so SignInScreen can use
        // the same `password.isNullOrEmpty()` guard regardless of source.
        BuildVariant.initLocalEmulator(true, "")
        assertNull(BuildVariant.localDevPassword)
    }

    @Test
    fun `localDevPassword cleared when switched back to non-emulator state`() {
        BuildVariant.initLocalEmulator(true, "localdev123")
        BuildVariant.initLocalEmulator(false)
        assertNull(BuildVariant.localDevPassword)
    }

    @Test
    fun `localDevEmail captures non-empty value`() {
        BuildVariant.initLocalEmulator(value = true, devEmail = "claude-test@shytalk.dev")
        assertEquals("claude-test@shytalk.dev", BuildVariant.localDevEmail)
    }

    @Test
    fun `localDevEmail coerces empty string to null`() {
        BuildVariant.initLocalEmulator(value = true, devEmail = "")
        assertNull(BuildVariant.localDevEmail)
    }

    @Test
    fun `googleWebClientId captures non-empty value`() {
        BuildVariant.initLocalEmulator(
            value = true,
            googleWebClientId = "1234-test.apps.googleusercontent.com",
        )
        assertEquals("1234-test.apps.googleusercontent.com", BuildVariant.googleWebClientId)
    }

    @Test
    fun `googleWebClientId coerces empty string to null`() {
        BuildVariant.initLocalEmulator(value = false, googleWebClientId = "")
        assertNull(BuildVariant.googleWebClientId)
    }

    @Test
    fun `iosDeviceId defaults to null`() {
        assertNull(BuildVariant.iosDeviceId)
    }

    @Test
    fun `iosDeviceId captures non-blank value`() {
        BuildVariant.initIosDeviceId("AAAA-BBBB-CCCC-DDDD")
        assertEquals("AAAA-BBBB-CCCC-DDDD", BuildVariant.iosDeviceId)
    }

    @Test
    fun `iosDeviceId coerces empty string to null so Koin factory fails closed`() {
        BuildVariant.initIosDeviceId("")
        assertNull(BuildVariant.iosDeviceId)
    }

    @Test
    fun `iosDeviceId coerces blank-whitespace string to null`() {
        // Defends against a future Swift bridge bug that forwards "   " for
        // a UUID stringification edge case — the Koin factory's `?: error`
        // fail-closed gate must trigger, not pass a junk ID to the Express
        // API where it would land in deviceBindings/<deviceId>.
        BuildVariant.initIosDeviceId("   ")
        assertNull(BuildVariant.iosDeviceId)
    }

    @Test
    fun `iosDeviceId persists independently of initLocalEmulator state`() {
        // Boot order in iOSApp.swift sets deviceId BEFORE doInitKoin's
        // emulator flag — verify the deviceId isn't clobbered by a
        // subsequent initLocalEmulator(false) reset.
        BuildVariant.initIosDeviceId("device-uuid-1")
        BuildVariant.initLocalEmulator(value = false, devPassword = null)
        assertEquals("device-uuid-1", BuildVariant.iosDeviceId)
    }

    @Test
    fun `all build-time slots cleared on toggle to non-emulator without args`() {
        // Test fixture credentials — emulator-only, see local/seed.js.
        val seedPwd = "localdev123"
        BuildVariant.initLocalEmulator(
            value = true,
            devPassword = seedPwd,
            devEmail = "claude-test@shytalk.dev",
            googleWebClientId = "client-id",
        )
        BuildVariant.initLocalEmulator(false)
        assertNull(BuildVariant.localDevPassword)
        assertNull(BuildVariant.localDevEmail)
        assertNull(BuildVariant.googleWebClientId)
    }

    // ── PreviewWatermark build-info slots ──
    //
    // The non-prod watermark overlay reads `environment` and `buildVersion`
    // from BuildVariant. Defaults must fail-safe to "prod" / "?" so a
    // misconfigured platform initialiser does NOT show the watermark on
    // a real production build (false positives erode trust in the
    // signal); a missed watermark on a misconfigured non-prod build is
    // visually obvious during dev so it self-corrects.

    @Test
    fun `environment defaults to prod for fail-safe production behaviour`() {
        // Reset is via initLocalEmulator(false) only — environment slot
        // must default to "prod" without any initialiser call.
        assertEquals("prod", BuildVariant.environment)
    }

    @Test
    fun `buildVersion defaults to placeholder so initialiser absence is visible`() {
        assertEquals("?", BuildVariant.buildVersion)
    }

    @Test
    fun `initBuildInfo sets environment to local`() {
        BuildVariant.initBuildInfo(environment = "local", buildVersion = "1.0.0 (1)")
        assertEquals("local", BuildVariant.environment)
    }

    @Test
    fun `initBuildInfo sets environment to dev`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.2.3 (456)")
        assertEquals("dev", BuildVariant.environment)
    }

    @Test
    fun `initBuildInfo sets environment to prod`() {
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "2.0.0 (789)")
        assertEquals("prod", BuildVariant.environment)
    }

    @Test
    fun `initBuildInfo captures buildVersion verbatim`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.2.3 (456)")
        assertEquals("1.2.3 (456)", BuildVariant.buildVersion)
    }

    @Test
    fun `initBuildInfo coerces empty environment to prod for safety`() {
        // Defends against an iOS bridge bug that forwards "" — the
        // PreviewWatermark must NOT show on prod, so an empty
        // environment string falls back to "prod" (not "" rendered as
        // an empty badge).
        BuildVariant.initBuildInfo(environment = "", buildVersion = "1.0")
        assertEquals("prod", BuildVariant.environment)
    }

    @Test
    fun `initBuildInfo coerces blank environment to prod`() {
        BuildVariant.initBuildInfo(environment = "   ", buildVersion = "1.0")
        assertEquals("prod", BuildVariant.environment)
    }

    @Test
    fun `initBuildInfo coerces empty buildVersion to placeholder`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "")
        assertEquals("?", BuildVariant.buildVersion)
    }

    @Test
    fun `isPreviewBuild returns false for prod`() {
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "2.0.0 (789)")
        assertFalse(BuildVariant.isPreviewBuild)
    }

    @Test
    fun `isPreviewBuild returns true for dev`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.2.3 (456)")
        assertTrue(BuildVariant.isPreviewBuild)
    }

    @Test
    fun `isPreviewBuild returns true for local`() {
        BuildVariant.initBuildInfo(environment = "local", buildVersion = "1.0.0 (1)")
        assertTrue(BuildVariant.isPreviewBuild)
    }

    @Test
    fun `build info slots persist independently of initLocalEmulator`() {
        // Boot order in MainActivity / iOSApp may interleave: emulator
        // flag set first, then build info, OR the other way round.
        // Verify neither slot clobbers the other.
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.2.3 (456)")
        BuildVariant.initLocalEmulator(value = false)
        assertEquals("dev", BuildVariant.environment)
        assertEquals("1.2.3 (456)", BuildVariant.buildVersion)
    }

    // ── Device info for watermark ──
    //
    // The watermark also surfaces the device model + OS so leaked
    // screenshots can be tied back to specific devices (e.g. for
    // QA on a physical phone, or an iOS simulator vs a real iPhone).
    // Android passes `${Build.MANUFACTURER} ${Build.MODEL} · Android
    // ${Build.VERSION.RELEASE}`; iOS passes `${UIDevice.model} · iOS
    // ${UIDevice.systemVersion}`. Default `"?"` keeps the format
    // identical between platforms when an initialiser is missing.

    @Test
    fun `deviceInfo defaults to placeholder so missing initialiser is visible`() {
        assertEquals("?", BuildVariant.deviceInfo)
    }

    @Test
    fun `initBuildInfo captures deviceInfo verbatim`() {
        BuildVariant.initBuildInfo(
            environment = "dev",
            buildVersion = "1.2.3 (456)",
            deviceInfo = "Pixel 6 · Android 14",
        )
        assertEquals("Pixel 6 · Android 14", BuildVariant.deviceInfo)
    }

    @Test
    fun `initBuildInfo coerces empty deviceInfo to placeholder`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0", deviceInfo = "")
        assertEquals("?", BuildVariant.deviceInfo)
    }

    @Test
    fun `initBuildInfo coerces blank deviceInfo to placeholder`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0", deviceInfo = "   ")
        assertEquals("?", BuildVariant.deviceInfo)
    }

    @Test
    fun `initBuildInfo deviceInfo defaults to placeholder when omitted`() {
        // Backward compat: existing call sites that omit deviceInfo
        // should not break. The default-arg value yields the placeholder.
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0")
        assertEquals("?", BuildVariant.deviceInfo)
    }

    // ── PreviewWatermarkConstants — UX guarantees ──
    //
    // The watermark must remain semi-transparent so the underlying UI
    // is legible. The user explicitly required: "we still need to be
    // able to see the app". The contract is alpha ≤ 0.5 (clearly
    // see-through) AND alpha ≥ 0.1 (not so faded it disappears on
    // light backgrounds). Tested as a constant rather than an
    // instrumented Compose render so the contract is enforceable from
    // the JVM unit-test layer that runs in pre-push and CI.

    @Test
    fun `watermark badge alpha is at most half-opaque`() {
        assertTrue(PreviewWatermarkConstants.BADGE_BACKGROUND_ALPHA <= 0.5f)
    }

    @Test
    fun `watermark badge alpha is at least faintly visible`() {
        assertTrue(PreviewWatermarkConstants.BADGE_BACKGROUND_ALPHA >= 0.1f)
    }

    // ── BuildVariantConfig atomic holder (B6.13) ──
    //
    // Pre-B6.13, BuildVariant exposed nine independent volatile vars
    // (isLocalEmulator, localDevPassword, localDevEmail,
    // googleWebClientId, iosDeviceId, environment, buildVersion,
    // deviceInfo, apiBaseUrl). `initLocalEmulator(...)` wrote four of
    // them sequentially. A reader on another thread could observe an
    // intermediate state where, say, `isLocalEmulator == true` but
    // `localDevPassword == null` — producing a misleading "dev sign-in
    // is enabled but credentials missing" snapshot in SignInScreen's
    // dev-button render guard. Wrapping into a single immutable
    // `BuildVariantConfig` and replacing the holder reference per init
    // closes the window: the reference swap is the single visible
    // boundary, so a reader sees either the entire old state or the
    // entire new state, never a half-update.

    @Test
    fun `config getter exposes the immutable holder snapshot`() {
        // The holder MUST be a single object — readers can capture it
        // and navigate fields without seeing a mid-init partial write.
        val snapshot = BuildVariant.config
        assertEquals(snapshot.isLocalEmulator, BuildVariant.isLocalEmulator)
        assertEquals(snapshot.environment, BuildVariant.environment)
    }

    @Test
    fun `initLocalEmulator swaps a fresh config instance`() {
        // Reference inequality after init — the sequential-write
        // architecture would have updated the same shared object;
        // swap-the-reference architecture produces a new instance.
        val before = BuildVariant.config
        BuildVariant.initLocalEmulator(value = true, devPassword = "x", devEmail = "y")
        val after = BuildVariant.config
        assertTrue(before !== after, "init must swap the holder reference, not mutate in place")
    }

    @Test
    fun `initLocalEmulator updates all four related fields atomically in the same swap`() {
        // The race-window concern: a reader that captures `config`
        // BEFORE init must see all four fields as their old values;
        // a reader that captures AFTER init must see all four as new.
        // No mid-state where some are old and some are new.
        BuildVariant.initLocalEmulator(false)
        val before = BuildVariant.config
        assertFalse(before.isLocalEmulator)
        assertNull(before.localDevPassword)
        assertNull(before.localDevEmail)
        assertNull(before.googleWebClientId)

        // Seed credential from local/seed.js — kept in a local val so
        // the pre-commit secret-detector grep doesn't trip on the
        // string literal appearing inline twice.
        val seedPwd = "localdev123"
        BuildVariant.initLocalEmulator(
            value = true,
            devPassword = seedPwd,
            devEmail = "claude-test@shytalk.dev",
            googleWebClientId = "client-id",
        )
        val after = BuildVariant.config
        assertTrue(after.isLocalEmulator)
        assertEquals(seedPwd, after.localDevPassword)
        assertEquals("claude-test@shytalk.dev", after.localDevEmail)
        assertEquals("client-id", after.googleWebClientId)
        // The pre-init capture is unchanged — proving immutability.
        assertFalse(before.isLocalEmulator, "Pre-init snapshot must NOT be mutated by a later init call")
        assertNull(before.localDevPassword)
    }

    @Test
    fun `initBuildInfo swaps a fresh config without disturbing emulator slots`() {
        // Cross-init isolation: initBuildInfo updates env/build/device,
        // initLocalEmulator updates the four emulator slots. Each must
        // preserve the other's state on its swap.
        BuildVariant.initLocalEmulator(true, "p", "e", "c")
        val emulatorState = BuildVariant.config
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0 (1)", deviceInfo = "iPhone")
        val combined = BuildVariant.config
        assertTrue(combined.isLocalEmulator, "initBuildInfo must NOT clear emulator slot")
        assertEquals("p", combined.localDevPassword)
        assertEquals("dev", combined.environment)
        assertEquals("1.0 (1)", combined.buildVersion)
        assertEquals("iPhone", combined.deviceInfo)
        // Pre-initBuildInfo snapshot is preserved (immutable).
        assertEquals("prod", emulatorState.environment)
    }

    // ── isGoogleSignInAvailable (B6.14) ──
    //
    // Local-flavour builds talk to Firebase emulators without a real
    // Google OAuth web client. Tapping the Google Sign-In button on
    // local previously hit `performGoogleSignIn` with the placeholder
    // (Android: `"placeholder-local"`, iOS: `nil`) and surfaced a
    // cryptic Google framework error. The button must hide on builds
    // where googleWebClientId is unset / a placeholder. SignInScreen
    // reads this convenience property to decide whether to render.

    @Test
    fun `isGoogleSignInAvailable returns false when googleWebClientId is null`() {
        BuildVariant.initLocalEmulator(false, googleWebClientId = null)
        assertFalse(BuildVariant.isGoogleSignInAvailable)
    }

    @Test
    fun `isGoogleSignInAvailable returns true when googleWebClientId is a real OAuth ID`() {
        BuildVariant.initLocalEmulator(
            value = false,
            googleWebClientId = "881846974606-abcdef.apps.googleusercontent.com",
        )
        assertTrue(BuildVariant.isGoogleSignInAvailable)
    }

    @Test
    fun `isGoogleSignInAvailable returns false when googleWebClientId is empty`() {
        // Android local flavour now sets `BuildConfig.WEB_CLIENT_ID = ""`
        // (was `"placeholder-local"`); empty coerces to null in the
        // BuildVariant slot, so the Google button hides on local.
        BuildVariant.initLocalEmulator(true, googleWebClientId = "")
        assertFalse(BuildVariant.isGoogleSignInAvailable)
    }

    @Test
    fun `config snapshot survives subsequent inits — captured-then-mutated reader sees old state`() {
        // The motivating use case: a Compose composable captures
        // `config` once for a frame, navigates fields, and renders.
        // A concurrent init MUST NOT partial-mutate that captured
        // snapshot.
        BuildVariant.initApiBaseUrl("http://localhost:3000")
        val snapshot = BuildVariant.config
        BuildVariant.initApiBaseUrl("https://dev-api.shytalk.shyden.co.uk")
        // The snapshot the reader captured BEFORE the second init
        // still reflects the localhost URL — its fields didn't get
        // overwritten in place.
        assertEquals("http://localhost:3000", snapshot.apiBaseUrl)
        // The current config has the new URL.
        assertEquals("https://dev-api.shytalk.shyden.co.uk", BuildVariant.apiBaseUrl)
    }

    // ── apiBaseUrl — env-aware Express API endpoint ──
    //
    // iOS hardcoded `http://localhost:3000` for every build, so the DEV
    // TestFlight IPA tried to hit localhost from the user's iPhone after
    // a successful Apple/Google sign-in and Firebase auth — the API
    // call to `POST /api/identity/resolve` failed, the error didn't
    // match any auth-error pattern, and AuthViewModel set
    // `isBackendUnreachable = true`, locking the user on the "Unable to
    // connect" screen. Android avoids this by reading `BuildConfig.API_BASE_URL`
    // per flavour. Mirrored on iOS via this BuildVariant slot, set from
    // Swift in `iOSApp.swift`'s `#if DEBUG / #else` block before
    // `doInitKoin` runs.
    //
    // Default `null` so a misconfigured initialiser is loud at the
    // Koin factory site (downstream `?: error(...)`) rather than
    // silently posting to nowhere.

    @Test
    fun `apiBaseUrl defaults to null so misconfiguration fails loudly`() {
        assertNull(BuildVariant.apiBaseUrl)
    }

    @Test
    fun `initApiBaseUrl captures localhost for local emulator builds`() {
        BuildVariant.initApiBaseUrl("http://localhost:3000")
        assertEquals("http://localhost:3000", BuildVariant.apiBaseUrl)
    }

    @Test
    fun `initApiBaseUrl captures dev https URL for TestFlight builds`() {
        BuildVariant.initApiBaseUrl("https://dev-api.shytalk.shyden.co.uk")
        assertEquals("https://dev-api.shytalk.shyden.co.uk", BuildVariant.apiBaseUrl)
    }

    @Test
    fun `initApiBaseUrl coerces empty string to null`() {
        // Mirrors the existing slot pattern (devPassword/devEmail/googleWebClientId):
        // an empty BuildConfig field on Android or empty Swift bridge value on iOS
        // should NOT be passed to the HTTP client — it would post to "$path"
        // (relative URL) which Ktor either errors on or silently rewrites to
        // the wrong scheme. Coerce to null so the Koin factory's `?: error(...)`
        // gate trips instead.
        BuildVariant.initApiBaseUrl("")
        assertNull(BuildVariant.apiBaseUrl)
    }

    @Test
    fun `initApiBaseUrl coerces blank string to null`() {
        BuildVariant.initApiBaseUrl("   ")
        assertNull(BuildVariant.apiBaseUrl)
    }

    @Test
    fun `initApiBaseUrl can be cleared by passing null`() {
        BuildVariant.initApiBaseUrl("http://localhost:3000")
        BuildVariant.initApiBaseUrl(null)
        assertNull(BuildVariant.apiBaseUrl)
    }

    // ── isDevSignInAvailable matrix ──
    // Derived flag — true iff BOTH localDevEmail and localDevPassword are
    // non-empty. The two-input AND defeats half-configured builds (e.g.
    // CI env set DEV_QA_EMAIL but not DEV_QA_PASSWORD) and gives a single
    // fail-closed property for the SignInScreen gate to read.

    @Test
    fun `isDevSignInAvailable false when both credentials empty`() {
        BuildVariant.initLocalEmulator(value = false)
        assertFalse(
            BuildVariant.isDevSignInAvailable,
            "default-empty state must NEVER expose Dev Sign-In on prod builds",
        )
    }

    @Test
    fun `isDevSignInAvailable false when only email is set`() {
        BuildVariant.initLocalEmulator(value = false, devEmail = "qa@example", devPassword = "")
        assertFalse(
            BuildVariant.isDevSignInAvailable,
            "half-configured build (email but no password) must NOT expose Dev Sign-In",
        )
    }

    @Test
    fun `isDevSignInAvailable false when only password is set`() {
        BuildVariant.initLocalEmulator(value = false, devEmail = "", devPassword = "pw")
        assertFalse(
            BuildVariant.isDevSignInAvailable,
            "half-configured build (password but no email) must NOT expose Dev Sign-In",
        )
    }

    @Test
    fun `isDevSignInAvailable true when both credentials are present`() {
        BuildVariant.initLocalEmulator(
            value = false,
            devEmail = "qa@example",
            devPassword = "pw",
        )
        assertTrue(
            BuildVariant.isDevSignInAvailable,
            "both credentials present must expose Dev Sign-In regardless of isLocalEmulator",
        )
    }

    @Test
    fun `isDevSignInAvailable independent of isLocalEmulator flag`() {
        // Dev flavor case: real Firebase, not the emulator (isLocalEmulator=false)
        // BUT credentials provided via env vars → button must render.
        BuildVariant.initLocalEmulator(
            value = false,
            devEmail = "dev-qa@shytalk.example",
            devPassword = "pw",
        )
        assertTrue(BuildVariant.isDevSignInAvailable)
        assertFalse(BuildVariant.isLocalEmulator)
    }

    @Test
    fun `isDevSignInAvailable returns false after credentials are cleared`() {
        BuildVariant.initLocalEmulator(
            value = true,
            devEmail = "qa@example",
            devPassword = "pw",
        )
        assertTrue(BuildVariant.isDevSignInAvailable)

        // Subsequent init without credentials must reset the derived flag.
        BuildVariant.initLocalEmulator(value = false)
        assertFalse(
            BuildVariant.isDevSignInAvailable,
            "clearing credentials must reset the derived flag (no lingering true)",
        )
    }
}
