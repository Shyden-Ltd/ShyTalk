package com.shyden.shytalk.core

/**
 * Immutable snapshot of all build-time flags. Wrapping the nine
 * previously-independent vars into a single data class lets callers
 * `BuildVariant.config` once per frame and navigate fields without
 * seeing a half-applied init — the reference swap inside `BuildVariant`
 * is the single visible boundary, so a reader observes either the
 * entire old state or the entire new state.
 *
 * Every field has a fail-safe default so an absent platform initialiser
 * is loud rather than silent: emulator slots default to off+null,
 * environment defaults to `"prod"` (no false-positive watermark on real
 * production), buildVersion / deviceInfo default to `"?"`, apiBaseUrl
 * defaults to null (downstream Koin factory `?: error(...)` trips).
 */
data class BuildVariantConfig(
    val isLocalEmulator: Boolean = false,
    val localDevPassword: String? = null,
    val localDevEmail: String? = null,
    val googleWebClientId: String? = null,
    val iosDeviceId: String? = null,
    val environment: String = "prod",
    val buildVersion: String = "?",
    val deviceInfo: String = "?",
    val apiBaseUrl: String? = null,
)

/**
 * Shared build-time flags accessible from common code. Set exactly once at
 * platform startup before any UI runs (Android: when `BuildConfig.FLAVOR ==
 * "local"`; iOS: when the `#if DEBUG` configuration is active).
 *
 * `@kotlin.concurrent.Volatile` on the holder reference establishes a
 * happens-before edge between the boot-time write on the main thread
 * and Compose-thread reads on iOS, where recomposition can read flags
 * from a different thread than the one that wrote them. The setter is
 * private so feature code cannot flip flags at runtime — initialisation
 * must go through the `init*()` functions, each of which `copy()`s the
 * current holder and replaces the reference in a single volatile
 * write. That closes the multi-write race window where a reader could
 * observe `isLocalEmulator == true` while `localDevPassword` was still
 * null mid-init (the failure mode B6.13 addresses).
 *
 * `localDevPassword` is injected from outside the binary on the local flavor
 * only — Android reads from `BuildConfig.LOCAL_DEV_PASSWORD` (empty string on
 * dev/prod via `buildConfigField`), iOS reads from `iOSApp.swift`'s `#if DEBUG`
 * block. On non-local builds it is `null`, so `SignInScreen`'s dev path
 * fails closed before the Firebase call. Keeping the literal out of every
 * non-DEBUG iOS Release binary and every non-local Android APK closes the
 * "reverse-engineer the production binary to learn the seed credential" leak
 * that the previous inline `"localdev123"` strings exposed.
 */
object BuildVariant {
    @kotlin.concurrent.Volatile
    private var holder: BuildVariantConfig = BuildVariantConfig()

    /**
     * Current immutable snapshot of all flags. Capture once at the top
     * of a render frame / cold-start path and read its fields — the
     * captured reference will not be mutated by any subsequent init.
     */
    val config: BuildVariantConfig
        get() = holder

    // ── Property accessors — backward-compatible API surface ──
    //
    // Existing call sites read `BuildVariant.isLocalEmulator` etc.
    // directly. Keep the same surface delegating to the holder so the
    // refactor is a no-op for callers, while internal state is now a
    // single atomically-swapped reference.

    val isLocalEmulator: Boolean get() = holder.isLocalEmulator
    val localDevPassword: String? get() = holder.localDevPassword
    val localDevEmail: String? get() = holder.localDevEmail
    val googleWebClientId: String? get() = holder.googleWebClientId

    /**
     * Whether the "Dev Sign-In" shortcut on SignInScreen should be
     * available on this build. Derives from credential presence rather
     * than a separate flag so the gate fails closed: a build without
     * baked credentials never renders the button (no UI affordance to
     * tap → silent no-op even on a Frida runtime flip).
     *
     * Matrix:
     *   - local flavor: credentials hardcoded → true
     *   - dev flavor: credentials read from `DEV_QA_EMAIL`/`DEV_QA_PASSWORD`
     *     env vars / gradle props at build time. Default empty → false.
     *     Operator opts in by passing them to `gradlew assembleDevDebug`.
     *   - prod flavor: credentials always empty → false (defence-in-depth
     *     vs. a misconfigured build that somehow set BYPASS_DEVICE_CHECKS
     *     in a prod APK).
     *
     * Distinct from [isLocalEmulator] which gates LiveKit URL fallback +
     * Firebase emulator wiring. A dev-flavor build is NOT a local emulator
     * — it talks to real dev Firebase + a deployed LiveKit instance — so
     * widening `isLocalEmulator` would silently rewire those paths.
     */
    val isDevSignInAvailable: Boolean
        get() =
            !holder.localDevEmail.isNullOrEmpty() &&
                !holder.localDevPassword.isNullOrEmpty()

    /**
     * iOS-only stable per-device identifier, eagerly computed in
     * `iOSApp.swift` and passed in via `KoinHelper.doInitKoin`. The Koin
     * factory at `IosPlatformModule.kt`'s `named("deviceId")` reads from
     * this slot rather than calling `UIDevice.currentDevice.identifierForVendor`
     * lazily — PR #406 attempted that and crashed the Firebase Firestore
     * init with a `ClassCastException: HashMap cannot be cast to CPointer`
     * (K/N + GitLive Firebase + Kotlin 2.4.0-Beta2 timing fragility, see
     * `project-ios-device-id-revert-rca.md`). On Android this slot is
     * unused — `Settings.Secure.ANDROID_ID` is read directly elsewhere.
     */
    val iosDeviceId: String? get() = holder.iosDeviceId

    /**
     * Build environment: `"local"`, `"dev"`, or `"prod"`. Drives the
     * `PreviewWatermark` overlay — any value other than `"prod"` shows
     * the red "ShyTalk Preview" badge on every screen so screenshots
     * accidentally shared from non-prod builds are unmistakable.
     * Set once at boot via [initBuildInfo]. Defaults to `"prod"` so a
     * misconfigured platform initialiser fails safe (false-positive
     * watermarks on real prod erode trust in the signal more than a
     * missed watermark on a dev build, which is visually obvious during
     * development and self-corrects).
     */
    val environment: String get() = holder.environment

    /**
     * Human-readable build identifier shown in the watermark, e.g.
     * `"1.2.3 (456)"`. Set once at boot via [initBuildInfo]. Defaults
     * to `"?"` so an absent initialiser is visible at a glance rather
     * than rendering as an empty badge.
     */
    val buildVersion: String get() = holder.buildVersion

    /**
     * Device label shown in the watermark, e.g. `"Pixel 6 · Android 14"`
     * or `"iPhone 17 · iOS 26.4"`. Lets a screenshot reader trace a
     * leak back to a specific physical device or simulator. Set once at
     * boot via [initBuildInfo].
     *
     * Format is platform-defined:
     * - Android: `"${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}"`
     * - iOS: `"${UIDevice.model} · iOS ${UIDevice.systemVersion}"`
     */
    val deviceInfo: String get() = holder.deviceInfo

    /**
     * Express API base URL — same pattern as deviceInfo above. Set once
     * at boot via [initApiBaseUrl]. iOS used to hardcode localhost in
     * `IosPlatformModule.kt`, locking TestFlight builds on "Unable to
     * connect" after sign-in. Default `null` so a missing initialiser
     * trips the Koin factory's `?: error(...)` instead of silently
     * posting to a relative URL.
     */
    val apiBaseUrl: String? get() = holder.apiBaseUrl

    /**
     * Convenience: any environment that isn't prod is a "preview"
     * build. The PreviewWatermark composable / web overlay reads this
     * to decide whether to render.
     */
    val isPreviewBuild: Boolean
        get() = holder.environment != "prod"

    /**
     * Convenience: `true` only when a real Google OAuth web-client ID
     * is configured. Local-flavour builds talk to Firebase emulators
     * without a real OAuth client — tapping the Google Sign-In button
     * there used to hit `performGoogleSignIn` with a placeholder
     * client ID and surface a cryptic Google framework error.
     * `SignInScreen` reads this to decide whether to render the Google
     * button at all.
     */
    val isGoogleSignInAvailable: Boolean
        get() = holder.googleWebClientId != null

    /**
     * One-shot initialiser for the watermark slots. Called from
     * platform entry points (Android `MainActivity.onCreate`, iOS
     * `KoinHelper.doInitKoin`) before UI mounts. Empty/blank
     * `environment` is coerced to `"prod"` for fail-safe behaviour;
     * empty `buildVersion` / `deviceInfo` are coerced to `"?"` so a
     * misconfigured initialiser is loud rather than silent.
     */
    fun initBuildInfo(
        environment: String,
        buildVersion: String,
        deviceInfo: String = "",
    ) {
        holder =
            holder.copy(
                environment = environment.takeIf { it.isNotBlank() } ?: "prod",
                buildVersion = buildVersion.takeIf { it.isNotBlank() } ?: "?",
                deviceInfo = deviceInfo.takeIf { it.isNotBlank() } ?: "?",
            )
    }

    /**
     * One-shot initialiser called from platform entry points before UI mounts.
     * Public (rather than `internal`) so the `app` module's MainActivity (and
     * iOS's `KoinHelper.doInitKoin`) can invoke it; the named function makes
     * the "set once at boot" contract explicit at every call site.
     *
     * `devPassword` and `devEmail` should be `null` on every non-local build.
     * Android passes the corresponding `BuildConfig.LOCAL_DEV_*` field (empty
     * string when the field is built out via the `dev` / `prod`
     * `buildConfigField` to `""`); iOS passes `nil` from the `#else` branch
     * of `#if DEBUG`. The setter coerces empty strings to `null` so callers
     * can read with a uniform `isNullOrEmpty()` guard.
     *
     * `googleWebClientId` is needed only by Android's CredentialManager flow
     * for Google Sign-In; iOS reads its OAuth client ID from
     * `FirebaseApp.app().options.clientID` and ignores this slot, so iOS
     * passes `nil`.
     */
    fun initLocalEmulator(
        value: Boolean,
        devPassword: String? = null,
        devEmail: String? = null,
        googleWebClientId: String? = null,
    ) {
        holder =
            holder.copy(
                isLocalEmulator = value,
                localDevPassword = devPassword?.takeIf { it.isNotEmpty() },
                localDevEmail = devEmail?.takeIf { it.isNotEmpty() },
                googleWebClientId = googleWebClientId?.takeIf { it.isNotEmpty() },
            )
    }

    /**
     * One-shot iOS deviceId initialiser. Called from
     * `KoinHelper.doInitKoin(deviceId = ...)`, which is in turn called from
     * Swift's `iOSApp.swift` `init()` after `UIApplication` is fully set up
     * but before Firebase init runs. Empty/blank values are coerced to
     * null so a downstream `?: error(...)` in the Koin factory fails
     * loudly rather than passing an empty string to the Express API.
     */
    fun initIosDeviceId(value: String?) {
        holder = holder.copy(iosDeviceId = value?.takeIf { it.isNotBlank() })
    }

    /**
     * One-shot API base URL initialiser. Called from
     * `KoinHelper.doInitKoin(apiBaseUrl = ...)` which is in turn called
     * from Swift's `iOSApp.swift` with the env-specific URL. Empty/blank
     * values coerce to null — see [apiBaseUrl] doc for the fail-closed
     * rationale.
     */
    fun initApiBaseUrl(value: String?) {
        holder = holder.copy(apiBaseUrl = value?.takeIf { it.isNotBlank() })
    }
}
