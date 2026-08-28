package com.shyden.shytalk.core.push

import android.content.Context
import android.content.pm.PackageManager
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await

/**
 * Where this device's push identifier comes from, under either model.
 *
 * SHY-0244. Firebase Messaging 25.1.0 deprecated the registration-token model
 * in favour of registering by Firebase Installation ID. The two are mutually
 * exclusive and switched by a manifest flag: `register()` throws without it,
 * and `getToken()` throws with it. So there is exactly one right call, and
 * which one it is depends on a value in the manifest.
 *
 * Four call sites used to each fetch a token themselves. Fixing them one by
 * one would have been four chances to leave one on the wrong API — and the
 * wrong API here does not misbehave subtly, it throws. This is the single
 * place that knows.
 */
object AndroidPushIdentifiers {
    /** The manifest flag the Firebase SDK itself reads. */
    private const val META_DATA_KEY = "firebase_messaging_installation_id_enabled"

    private const val PREFS = "shytalk.push.identifiers"
    private const val KEY_VALUE = "currentValue"
    private const val KEY_KIND = "currentKind"

    /**
     * Whether this build registers by installation ID.
     *
     * Read from the manifest rather than from a constant, because the manifest
     * is what the SDK obeys. A constant could disagree with it, and the
     * disagreement would surface as an IllegalStateException at registration
     * time on a user's device rather than at build time.
     */
    fun installationIdEnabled(context: Context): Boolean =
        runCatching {
            context.packageManager
                .getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
                .metaData
                ?.getBoolean(META_DATA_KEY, false) == true
        }.getOrDefault(false)

    /** Remember what the SDK last handed us, so a sign-in does not have to re-fetch. */
    fun cache(
        context: Context,
        identifier: PushIdentifier,
    ) {
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_VALUE, identifier.value)
            .putString(KEY_KIND, identifier.kind.name)
            .apply()
    }

    private fun cached(context: Context): PushIdentifier? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val value = prefs.getString(KEY_VALUE, null) ?: return null
        // A cached value with no kind was written by a pre-migration build, so
        // it can only be a registration token. That default is what lets an
        // upgraded install keep working with no gap in reachability.
        val kind =
            if (prefs.getString(KEY_KIND, null) == PushIdentifierKind.INSTALLATION_ID.name) {
                PushIdentifierKind.INSTALLATION_ID
            } else {
                PushIdentifierKind.REGISTRATION_TOKEN
            }
        return PushIdentifier(value, kind)
    }

    /**
     * This device's current push identifier, fetching one if the SDK has not
     * yet delivered it through [ShyTalkMessagingService].
     *
     * The cached value is preferred because it is what the SDK actually
     * registered. The fetch is the cold-start path: a user who signs in before
     * `onRegistered` has fired still has to become reachable.
     */
    suspend fun current(context: Context): PushIdentifier = cached(context) ?: fetch(context).also { cache(context, it) }

    /**
     * Fetches an identifier under the installation-ID model.
     *
     * There is deliberately no token-model branch. `getToken()` is deprecated
     * in messaging 25.1.0 and calling it fails the build under `-Werror`;
     * suppressing that is what this story set out to avoid. So the flag being
     * set is a precondition, not a choice, and a missing flag fails LOUDLY
     * here rather than as an IllegalStateException from inside the SDK with no
     * indication of which flag is missing.
     */
    private suspend fun fetch(context: Context): PushIdentifier {
        check(installationIdEnabled(context)) {
            "Push registration requires the manifest meta-data $META_DATA_KEY set to true. " +
                "Without it FirebaseMessaging.register() throws and this device can never " +
                "receive a notification."
        }
        // register() returns Task<Void>; the identifier itself is the Firebase
        // Installation ID, which is what FCM registers this app instance under.
        FirebaseMessaging.getInstance().register().await()
        return PushIdentifier(
            FirebaseInstallations.getInstance().id.await(),
            PushIdentifierKind.INSTALLATION_ID,
        )
    }
}
