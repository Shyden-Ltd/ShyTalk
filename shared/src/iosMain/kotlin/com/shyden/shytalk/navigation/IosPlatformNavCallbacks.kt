package com.shyden.shytalk.navigation

import com.shyden.shytalk.core.push.PushTokenManager
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.util.IosImagePicker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.koin.mp.KoinPlatformTools
import platform.Foundation.NSCharacterSet
import platform.Foundation.NSString
import platform.Foundation.URLQueryAllowedCharacterSet
import platform.Foundation.stringByAddingPercentEncodingWithAllowedCharacters
import platform.Foundation.stringByRemovingPercentEncoding

/**
 * iOS implementation of [PlatformNavCallbacks].
 *
 * Push token management delegates to [PushTokenManager] (commonMain) which
 * owns the Mutex that serialises save/clear across rapid sign-out → sign-in.
 * URL encoding uses Foundation's percent-encoding APIs.
 * Media picking uses PHPickerViewController for image selection.
 */
class IosPlatformNavCallbacks : PlatformNavCallbacks {
    // Lazy Koin resolution — match Android's `by inject()` pattern. Eager
    // resolution at construction worked fine in production (Koin is up before
    // MainViewController instantiates IosPlatformNavCallbacks) but broke any
    // test or Compose-preview surface that constructs this class before
    // `doInitKoin`. Lazy means the lookup happens on first save/remove call,
    // by which point production callers have always initialised Koin.
    private val pushTokenManager: PushTokenManager by lazy {
        KoinPlatformTools.defaultContext().get().get()
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    // ── Push notifications ──

    override fun saveFcmToken(userId: String) {
        scope.launch {
            try {
                pushTokenManager.syncToken(userId)
            } catch (e: Exception) {
                logW("IosPlatformNavCallbacks", "saveFcmToken failed: ${e.message}")
            }
        }
    }

    override fun removeFcmToken(userId: String) {
        scope.launch {
            try {
                pushTokenManager.clearToken(userId)
            } catch (e: Exception) {
                logW("IosPlatformNavCallbacks", "removeFcmToken failed: ${e.message}")
            }
        }
    }

    // ── Background services (no-op v1) ──

    override fun startMessageSyncService() {
        // No-op: iOS background fetch will be added later
    }

    override fun stopMessageSyncService() {
        // No-op
    }

    // ── Permissions (no-op v1 — iOS handles permissions differently) ──

    override fun requestPermissions() {
        // No-op: iOS permissions are requested at point of use (microphone, notifications)
    }

    override fun canDrawOverlays(): Boolean = false // Not applicable on iOS

    // ── Media picking (PHPickerViewController) ──

    override fun pickImages(
        maxCount: Int,
        onResult: (List<ByteArray>) -> Unit,
    ) {
        IosImagePicker.pickImages(maxCount = maxCount, onResult = onResult)
    }

    override fun pickStickerImage(onResult: (ByteArray?) -> Unit) {
        IosImagePicker.pickSingleImage(onResult = onResult)
    }

    override fun pickAndCropPhoto(onResult: (ByteArray?) -> Unit) {
        // iOS has no built-in crop UI in PHPicker — deliver the raw image.
        // A crop overlay can be added later if needed.
        IosImagePicker.pickSingleImage(onResult = onResult)
    }

    // ── Billing (no-op v1 — StoreKit integration in future PR) ──

    override fun purchasePackage(productId: String) {
        logW("IosPlatformNavCallbacks", "purchasePackage($productId) — StoreKit not yet integrated")
    }

    override fun purchaseSubscription(productId: String) {
        logW("IosPlatformNavCallbacks", "purchaseSubscription($productId) — StoreKit not yet integrated")
    }

    // ── URL encoding (real implementation using Foundation) ──

    @Suppress("CAST_NEVER_SUCCEEDS")
    override fun encodeUrl(url: String): String =
        (url as NSString)
            .stringByAddingPercentEncodingWithAllowedCharacters(
                NSCharacterSet.URLQueryAllowedCharacterSet,
            ) ?: url

    @Suppress("CAST_NEVER_SUCCEEDS")
    override fun decodeUrl(encoded: String): String = (encoded as NSString).stringByRemovingPercentEncoding ?: encoded
}
