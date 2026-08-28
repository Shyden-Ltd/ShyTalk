package com.shyden.shytalk.core.push

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.data.repository.NotificationRepository
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class PushTokenManager(
    private val bridgeProvider: () -> PushTokenBridge?,
    private val notificationRepo: NotificationRepository,
) {
    private val mutex = Mutex()

    suspend fun syncToken(userId: String) {
        mutex.withLock {
            val bridge = bridgeProvider() ?: return
            val current = bridge.currentPushIdentifier() ?: return
            if (bridge.lastRegisteredIdentifier() == current) return
            when (val result = notificationRepo.savePushIdentifier(userId, current)) {
                is Resource.Success -> bridge.setLastRegisteredIdentifier(current)

                is Resource.Error -> {
                    // Don't update lastRegisteredIdentifier — a later trigger (sign-in,
                    // foreground retry) will re-attempt with the same currentToken.
                    // logE so backend / network failures surface in telemetry —
                    // a silent swallow here would hide a class of "user mysteriously
                    // stops receiving notifications" bugs.
                    logE(TAG, "savePushIdentifier failed for userId=$userId: ${result.message}")
                }

                is Resource.Loading -> Unit // suspending fn — Loading is not emitted by repo impl
            }
        }
    }

    suspend fun clearToken(userId: String) {
        mutex.withLock {
            val bridge = bridgeProvider() ?: return
            val last = bridge.lastRegisteredIdentifier() ?: return
            when (val result = notificationRepo.removePushIdentifier(userId, last)) {
                is Resource.Success -> bridge.setLastRegisteredIdentifier(null)

                is Resource.Error -> {
                    // Keep lastRegisteredIdentifier so a later sign-in cycle won't
                    // accidentally re-register the same token under the wrong user
                    // (and the next remove attempt still has the value to delete).
                    logE(TAG, "removePushIdentifier failed for userId=$userId: ${result.message}")
                }

                is Resource.Loading -> Unit
            }
        }
    }

    private companion object {
        const val TAG = "PushTokenManager"
    }
}
