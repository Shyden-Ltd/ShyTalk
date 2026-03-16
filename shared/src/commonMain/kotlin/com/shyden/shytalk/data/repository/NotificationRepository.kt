package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

interface NotificationRepository {
    suspend fun saveFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit>

    suspend fun removeFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit>

    suspend fun setPmNotificationsEnabled(
        userId: String,
        enabled: Boolean,
    ): Resource<Unit>

    suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean>
}
