package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.push.PushIdentifier
import com.shyden.shytalk.core.util.Resource

interface NotificationRepository {
    /**
     * Register this device for push (SHY-0244).
     *
     * Takes the identifier AND its kind so the backend stores it in the right
     * field. A bare string here would let a Firebase Installation ID be filed
     * as a registration token, which fails on send and is then reaped —
     * silently ending push for that device.
     */
    suspend fun savePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit>

    suspend fun removePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit>

    suspend fun setPmNotificationsEnabled(
        userId: String,
        enabled: Boolean,
    ): Resource<Unit>

    suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean>
}
