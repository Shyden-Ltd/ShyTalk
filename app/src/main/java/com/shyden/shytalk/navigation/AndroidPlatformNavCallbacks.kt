package com.shyden.shytalk.navigation

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.shyden.shytalk.core.push.AndroidPushIdentifiers
import com.shyden.shytalk.data.remote.PmSyncService
import com.shyden.shytalk.data.repository.NotificationRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Android implementation of [PlatformNavCallbacks].
 *
 * Handles FCM tokens, foreground services, URL encoding, and billing.
 * Media picking and permissions require Compose launchers and are handled
 * via lambda callbacks set by [rememberAndroidPlatformCallbacks].
 */
class AndroidPlatformNavCallbacks(
    private val context: Context,
    private val scope: CoroutineScope,
    private val notificationRepository: NotificationRepository,
    private val onPickImagesRequest: ((Int, (List<ByteArray>) -> Unit) -> Unit)? = null,
    private val onPickStickerRequest: (((ByteArray?) -> Unit) -> Unit)? = null,
    private val onPickAndCropPhotoRequest: (((ByteArray?) -> Unit) -> Unit)? = null,
    private val onPurchasePackageRequest: ((String) -> Unit)? = null,
    private val onPurchaseSubscriptionRequest: ((String) -> Unit)? = null,
    private val onRequestPermissions: (() -> Unit)? = null,
    private val onCanDrawOverlays: (() -> Boolean)? = null,
) : PlatformNavCallbacks {
    // ── Push notifications ──

    override fun saveFcmToken(userId: String) {
        scope.launch {
            try {
                val identifier = AndroidPushIdentifiers.current(context)
                notificationRepository.savePushIdentifier(userId, identifier)
            } catch (e: Exception) {
                Log.w(TAG, "FCM token save failed — will retry on next launch", e)
            }
        }
    }

    override suspend fun removeFcmToken(userId: String) {
        // No scope.launch: the caller awaits this so the release finishes while
        // the credential authorising it is still valid (SHY-0494).
        try {
            val identifier = AndroidPushIdentifiers.current(context)
            notificationRepository.removePushIdentifier(userId, identifier)
        } catch (e: Exception) {
            Log.w(TAG, "push identifier release failed on sign-out", e)
        }
    }

    // ── Background services ──

    override fun startMessageSyncService() {
        try {
            val syncIntent = Intent(context, PmSyncService::class.java)
            androidx.core.content.ContextCompat
                .startForegroundService(context, syncIntent)
        } catch (e: Exception) {
            Log.w(TAG, "PM sync service start failed", e)
        }
    }

    override fun stopMessageSyncService() {
        try {
            context.stopService(Intent(context, PmSyncService::class.java))
        } catch (e: Exception) {
            Log.d(TAG, "PM sync service stop failed", e)
        }
    }

    // ── Permissions ──

    override fun requestPermissions() {
        onRequestPermissions?.invoke()
    }

    override fun canDrawOverlays(): Boolean = onCanDrawOverlays?.invoke() ?: false

    // ── Media picking ──

    override fun pickImages(
        maxCount: Int,
        onResult: (List<ByteArray>) -> Unit,
    ) {
        onPickImagesRequest?.invoke(maxCount, onResult)
    }

    override fun pickStickerImage(onResult: (ByteArray?) -> Unit) {
        onPickStickerRequest?.invoke(onResult)
    }

    override fun pickAndCropPhoto(onResult: (ByteArray?) -> Unit) {
        onPickAndCropPhotoRequest?.invoke(onResult)
    }

    // ── Billing ──

    override fun purchasePackage(productId: String) {
        onPurchasePackageRequest?.invoke(productId)
    }

    override fun purchaseSubscription(productId: String) {
        onPurchaseSubscriptionRequest?.invoke(productId)
    }

    // ── URL encoding ──

    override fun encodeUrl(url: String): String = Uri.encode(url)

    override fun decodeUrl(encoded: String): String = Uri.decode(encoded)

    companion object {
        private const val TAG = "AndroidPlatformNav"
    }
}
