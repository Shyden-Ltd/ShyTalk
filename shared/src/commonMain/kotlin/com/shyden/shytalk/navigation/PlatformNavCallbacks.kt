package com.shyden.shytalk.navigation

/**
 * Platform-specific callbacks for the shared NavGraph.
 *
 * The NavGraph uses Compose Multiplatform navigation (shared across iOS and Android),
 * but some behaviors require platform APIs (FCM, permissions, image picking, billing).
 * Each platform provides its own implementation of this interface.
 *
 * Android: real implementations using ActivityResultContracts, FirebaseMessaging, BillingService, etc.
 * iOS: no-ops for v1 (FCM, permissions, billing), real implementations where possible (URL encoding).
 */
interface PlatformNavCallbacks {
    // ── Push notifications ──

    /** Save the platform push token (FCM on Android, APNs on iOS) for the given user. */
    fun saveFcmToken(userId: String)

    /**
     * Releases this device's push registration for [userId], on sign-out.
     *
     * SHY-0494: `suspend` on purpose. As a plain function every caller fired it
     * into a scope and moved on, so it raced the navigation that cancelled that
     * scope AND the auth teardown that revoked its credential. Suspending makes
     * "await this before signing out" the only way to call it.
     */
    suspend fun removeFcmToken(userId: String)

    // ── Background services ──

    /** Start background message sync (Android foreground service, iOS background task). */
    fun startMessageSyncService()

    /** Stop background message sync (called on sign-out). */
    fun stopMessageSyncService()

    // ── Permissions ──

    /** Request runtime permissions (notifications, microphone). No-op on iOS (handled differently). */
    fun requestPermissions()

    /** Check if the app can draw overlays (Android-specific, always false on iOS). */
    fun canDrawOverlays(): Boolean

    // ── Media picking ──

    /** Launch image picker for up to [maxCount] images. Delivers results via [onResult]. */
    fun pickImages(
        maxCount: Int,
        onResult: (List<ByteArray>) -> Unit,
    )

    /** Launch single image picker for a sticker. Delivers result via [onResult]. */
    fun pickStickerImage(onResult: (ByteArray?) -> Unit)

    /** Launch photo picker with crop (for group photos). Delivers result via [onResult]. */
    fun pickAndCropPhoto(onResult: (ByteArray?) -> Unit)

    // ── Billing ──

    /** Launch in-app purchase flow for a coin package. */
    fun purchasePackage(productId: String)

    /** Launch subscription purchase flow. */
    fun purchaseSubscription(productId: String)

    // ── URL encoding ──

    /** Encode a URL for safe use in navigation routes. */
    fun encodeUrl(url: String): String

    /** Decode a URL from a navigation route argument. */
    fun decodeUrl(encoded: String): String
}
