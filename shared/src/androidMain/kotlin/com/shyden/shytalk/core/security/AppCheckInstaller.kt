package com.shyden.shytalk.core.security

import android.util.Log
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory

private const val TAG = "AppCheckInstaller"

/**
 * Installs the Firebase App Check provider once, at app start (SHY-0300).
 *
 * Installing is a one-time global act; obtaining a token is per-request and
 * lives in `AppCheckTokenProvider`. Splitting them is what lets the token
 * fetch stay off the cold-start critical path — the provider is registered
 * here and warms in the background while the app routes.
 *
 * ## Why the debug provider is not wired here
 *
 * `firebase-appcheck-debug` is a SEPARATE artifact that must never reach a
 * release build: it mints tokens for any caller that knows the debug secret,
 * which would defeat the control entirely. Rather than branch on
 * `BuildConfig.DEBUG` with the artifact present in every variant, the debug
 * provider is added only to debug variants in `app/build.gradle.kts` and
 * selected reflectively below. A release build has no such class on its
 * classpath, so the branch cannot be taken even if the flag were wrong.
 *
 * Takes no `Context`: `FirebaseAppCheck.getInstance()` resolves the default
 * FirebaseApp, which the Firebase initialisation provider has already created
 * by the time `Application.onCreate` runs. A Context parameter would suggest
 * otherwise.
 *
 * ## Failure is not fatal
 *
 * Every failure path logs and returns. An install that cannot happen means
 * requests go out unattested, which the SERVER decides how to treat — and
 * during the monitor phase means nothing at all. Crashing the app because
 * attestation could not be set up would be strictly worse than the abuse
 * attestation prevents.
 */
object AppCheckInstaller {
    @Volatile
    private var installed = false

    /**
     * @param isDebug the CALLER's debug flag. Passed in rather than read from
     *   a `BuildConfig` here: this module is built once and consumed by both
     *   app variants, so its own build flag would not track the app's.
     */
    fun install(isDebug: Boolean) {
        if (installed) return
        try {
            val appCheck = FirebaseAppCheck.getInstance()
            if (isDebug) {
                if (installDebugProvider(appCheck)) {
                    installed = true
                    return
                }
                // Fall through to Play Integrity: better a debug build that
                // cannot attest than one that silently installs nothing and
                // reports success.
                Log.w(TAG, "debug provider unavailable — falling back to Play Integrity")
            }
            appCheck.installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance())
            installed = true
            Log.i(TAG, "App Check installed (Play Integrity)")
        } catch (e: Exception) {
            // Reachable when Play Services is absent or out of date, which is
            // common on the emulator and on de-Googled devices.
            Log.e(TAG, "App Check install failed — requests will go out unattested", e)
        }
    }

    /**
     * Reflective because `firebase-appcheck-debug` is present ONLY in debug
     * variants. A direct reference would fail to compile release builds, and
     * adding the artifact everywhere to make it compile is exactly what must
     * not happen.
     */
    private fun installDebugProvider(appCheck: FirebaseAppCheck): Boolean =
        try {
            val cls =
                Class.forName(
                    "com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory",
                )
            val factory = cls.getMethod("getInstance").invoke(null)
            val install =
                FirebaseAppCheck::class.java.methods.first {
                    it.name == "installAppCheckProviderFactory" && it.parameterTypes.size == 1
                }
            install.invoke(appCheck, factory)
            Log.i(TAG, "App Check installed (DEBUG provider — local/dev only)")
            true
        } catch (e: ClassNotFoundException) {
            Log.d(TAG, "debug App Check provider not on the classpath: ${e.message}")
            false
        } catch (e: Exception) {
            Log.w(TAG, "debug App Check provider failed to install: ${e.message}")
            false
        }
}
