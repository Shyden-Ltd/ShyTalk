package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow

data class UserFlags(
    val isSuspended: Boolean = false,
    val suspensionEndDate: Long? = null,
    val hasActiveWarning: Boolean = false,
    val warningReason: String? = null,
)

interface UserRepository {
    val userUpdates: SharedFlow<User>

    suspend fun createOrUpdateUser(user: User): Resource<Unit>

    suspend fun getUser(userId: String): Resource<User>

    suspend fun userExists(userId: String): Resource<Boolean>

    suspend fun updateDisplayName(
        userId: String,
        displayName: String,
    ): Resource<Unit>

    suspend fun updateAvatar(
        userId: String,
        avatarUrl: String,
    ): Resource<Unit>

    suspend fun updateLastSeen(userId: String): Resource<Unit>

    suspend fun updateProfile(
        userId: String,
        fields: Map<String, Any?>,
    ): Resource<Unit>

    suspend fun generateUniqueId(userId: String): Resource<Long>

    suspend fun blockUser(
        userId: String,
        blockedUserId: String,
    ): Resource<Unit>

    suspend fun unblockUser(
        userId: String,
        blockedUserId: String,
    ): Resource<Unit>

    suspend fun getBlockedUserIds(userId: String): Resource<Set<String>>

    suspend fun checkBlockedBy(
        userIds: List<String>,
        targetUserId: String,
    ): Resource<Set<String>>

    suspend fun followUser(
        currentUserId: String,
        targetUserId: String,
    ): Resource<Unit>

    suspend fun unfollowUser(
        currentUserId: String,
        targetUserId: String,
    ): Resource<Unit>

    suspend fun getUsers(userIds: List<String>): Resource<List<User>>

    suspend fun removeFollower(
        userId: String,
        followerId: String,
    ): Resource<Unit>

    suspend fun recordProfileVisit(
        profileUserId: String,
        visitorId: String,
    ): Resource<Unit>

    suspend fun getStalkers(profileUserId: String): Resource<List<ProfileVisitor>>

    suspend fun markStalkersViewed(userId: String): Resource<Unit>

    fun observeUsers(userIds: Set<String>): Flow<User>

    suspend fun submitSuspensionAppeal(
        userId: String,
        appealText: String,
    ): Resource<Unit>

    suspend fun liftExpiredSuspension(userId: String): Resource<Unit>

    suspend fun getAliases(userId: String): Resource<Map<String, String>>

    suspend fun setAlias(
        userId: String,
        targetUserId: String,
        alias: String,
    ): Resource<Unit>

    suspend fun removeAlias(
        userId: String,
        targetUserId: String,
    ): Resource<Unit>

    fun observeUserFlags(userId: String): Flow<UserFlags>

    suspend fun acknowledgeWarning(userId: String): Resource<Unit>

    suspend fun getWarningReason(userId: String): Resource<String?>

    suspend fun requestAccountDeletion(
        userId: String,
        pin: String,
    ): Resource<Long>

    suspend fun cancelAccountDeletion(userId: String): Resource<Unit>

    data class DeletionStatus(
        val scheduled: Boolean = false,
        val scheduledAt: Long? = null,
        val executeAt: Long? = null,
        val reason: String? = null,
        val daysRemaining: Int? = null,
    )

    suspend fun getAccountDeletionStatus(userId: String): Resource<DeletionStatus>

    suspend fun requestDataExport(userId: String): Resource<Long>

    data class DataExportStatus(
        val status: String = "none",
        val requestedAt: Long? = null,
        val expiresAt: Long? = null,
    )

    suspend fun getDataExportStatus(userId: String): Resource<DataExportStatus>
}
