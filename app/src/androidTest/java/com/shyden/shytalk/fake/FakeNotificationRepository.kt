package com.shyden.shytalk.fake

import com.shyden.shytalk.core.push.PushIdentifier
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.NotificationRepository

class FakeNotificationRepository : NotificationRepository {
    override suspend fun savePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun removePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun setPmNotificationsEnabled(
        userId: String,
        enabled: Boolean,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean> = Resource.Success(true)
}
