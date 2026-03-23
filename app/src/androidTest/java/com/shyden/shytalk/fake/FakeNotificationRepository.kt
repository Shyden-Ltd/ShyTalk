package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.NotificationRepository

class FakeNotificationRepository : NotificationRepository {
    override suspend fun saveFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun removeFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun setPmNotificationsEnabled(
        userId: String,
        enabled: Boolean,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean> = Resource.Success(true)
}
