package com.shyden.shytalk.fake

import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.PmLockCheckResult
import com.shyden.shytalk.data.repository.UserFlags
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testdata.TestData
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.emptyFlow

class FakeUserRepository : UserRepository {
    val users =
        mutableMapOf(
            "test-user-1" to TestData.currentUser,
            "test-user-2" to TestData.otherUser,
        )

    private val _userUpdates = MutableSharedFlow<User>(replay = 1, extraBufferCapacity = 5)
    override val userUpdates: SharedFlow<User> = _userUpdates.asSharedFlow()

    val userFlagsFlow = MutableStateFlow(UserFlags())

    /**
     * Restore the seeded state — call between tests to stop state leaking.
     *
     * SHY-0474. This is a Koin SINGLETON and `ResetFakesRule` only reset the
     * auth fake, so anything a test wrote here survived into every later test
     * in the run. A cohort test writing "not-a-cohort" onto the seeded user
     * made three private-messaging tests fail several classes later, which
     * reads as a defect in messaging rather than as leakage from a test that
     * had already finished.
     */
    fun reset() {
        users.clear()
        users["test-user-1"] = TestData.currentUser
        users["test-user-2"] = TestData.otherUser
        userFlagsFlow.value = UserFlags()
        signedInUserId = "test-user-1"
    }

    override suspend fun createOrUpdateUser(user: User): Resource<Unit> {
        users[user.uid] = user
        _userUpdates.tryEmit(user)
        return Resource.Success(Unit)
    }

    override suspend fun getUser(userId: String): Resource<User> {
        val user = users[userId] ?: return Resource.Error("User not found")
        return Resource.Success(user)
    }

    /**
     * Viewers the profile owner has blocked. Empty by default, so the common
     * case needs no setup and a test that cares about blocking has to say so.
     */
    val blockedFromViewing = mutableSetOf<String>()

    /**
     * Added when `getProfileForViewing` reached the interface (SHY-0348) and
     * this fake was not updated with it, which stopped the whole androidTest
     * source set from COMPILING — so every instrumented test silently stopped
     * running rather than failing. Restored 2026-08-26 while fixing SHY-0466,
     * whose own evidence is in this source set.
     *
     * Mirrors the real repository's three outcomes rather than collapsing them:
     * a fake that cannot express "blocked" would let a caller that ignores the
     * block case pass, which is a defect invented by the double rather than
     * found by it.
     */
    override suspend fun getProfileForViewing(userId: String): Resource<UserRepository.ProfileAccess> {
        if (userId in blockedFromViewing) {
            return Resource.Success(UserRepository.ProfileAccess.BlockedByOwner)
        }
        val user = users[userId] ?: return Resource.Success(UserRepository.ProfileAccess.NotFound)
        return Resource.Success(UserRepository.ProfileAccess.Visible(user))
    }

    override suspend fun userExists(userId: String): Resource<Boolean> = Resource.Success(users.containsKey(userId))

    override suspend fun updateDisplayName(
        userId: String,
        displayName: String,
    ): Resource<Unit> {
        users[userId] = users[userId]?.copy(displayName = displayName) ?: return Resource.Error("User not found")
        return Resource.Success(Unit)
    }

    override suspend fun updateAvatar(
        userId: String,
        avatarUrl: String,
    ): Resource<Unit> {
        users[userId] = users[userId]?.copy(avatarUrl = avatarUrl) ?: return Resource.Error("User not found")
        return Resource.Success(Unit)
    }

    override suspend fun updateLastSeen(userId: String): Resource<Unit> = Resource.Success(Unit)

    override suspend fun updateProfile(
        userId: String,
        fields: Map<String, Any?>,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun generateUniqueId(userId: String): Resource<Long> = Resource.Success(10000001L)

    override suspend fun blockUser(
        userId: String,
        blockedUserId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun unblockUser(
        userId: String,
        blockedUserId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getBlockedUserIds(userId: String): Resource<Set<String>> = Resource.Success(emptySet())

    /** Who "me" is for [checkBlockedBy], mirroring the auth-derived subject on the server. */
    var signedInUserId: String = "test-user-1"

    override suspend fun checkBlockedBy(userIds: List<String>): Resource<Set<String>> {
        val blockers =
            userIds
                .filter { uid ->
                    users[uid]?.blockedUserIds?.contains(signedInUserId) == true
                }.toSet()
        return Resource.Success(blockers)
    }

    override suspend fun followUser(
        currentUserId: String,
        targetUserId: String,
    ): Resource<Unit> {
        val current = users[currentUserId] ?: return Resource.Error("User not found")
        val target = users[targetUserId] ?: return Resource.Error("Target not found")
        users[currentUserId] = current.copy(followingIds = current.followingIds + targetUserId)
        users[targetUserId] = target.copy(followerIds = target.followerIds + currentUserId)
        return Resource.Success(Unit)
    }

    override suspend fun unfollowUser(
        currentUserId: String,
        targetUserId: String,
    ): Resource<Unit> {
        val current = users[currentUserId] ?: return Resource.Error("User not found")
        val target = users[targetUserId] ?: return Resource.Error("Target not found")
        users[currentUserId] = current.copy(followingIds = current.followingIds - targetUserId)
        users[targetUserId] = target.copy(followerIds = target.followerIds - currentUserId)
        return Resource.Success(Unit)
    }

    override suspend fun getUsers(userIds: List<String>): Resource<List<User>> = Resource.Success(userIds.mapNotNull { users[it] })

    override suspend fun removeFollower(
        userId: String,
        followerId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun recordProfileVisit(
        profileUserId: String,
        visitorId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getStalkers(profileUserId: String): Resource<UserRepository.StalkerPage> =
        Resource.Success(UserRepository.StalkerPage())

    override suspend fun markStalkersViewed(userId: String): Resource<Unit> = Resource.Success(Unit)

    override fun observeUsers(userIds: Set<String>): Flow<User> = emptyFlow()

    override suspend fun submitSuspensionAppeal(
        userId: String,
        appealText: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun liftExpiredSuspension(userId: String): Resource<Unit> = Resource.Success(Unit)

    override suspend fun checkPmLockOnLogin(userId: String): Resource<PmLockCheckResult> = Resource.Success(PmLockCheckResult())

    override suspend fun getAliases(userId: String): Resource<Map<String, String>> = Resource.Success(emptyMap())

    override suspend fun setAlias(
        userId: String,
        targetUserId: String,
        alias: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun removeAlias(
        userId: String,
        targetUserId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override fun observeUserFlags(userId: String): Flow<UserFlags> = userFlagsFlow

    override suspend fun acknowledgeWarning(userId: String): Resource<Unit> {
        userFlagsFlow.value = userFlagsFlow.value.copy(hasActiveWarning = false)
        return Resource.Success(Unit)
    }

    override suspend fun getWarningReason(userId: String): Resource<String?> = Resource.Success(userFlagsFlow.value.warningReason)

    override suspend fun requestAccountDeletion(
        userId: String,
        pin: String,
    ): Resource<Long> = Resource.Success(System.currentTimeMillis() + 30 * 86400000L)

    override suspend fun cancelAccountDeletion(userId: String): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getAccountDeletionStatus(userId: String): Resource<UserRepository.DeletionStatus> =
        Resource.Success(UserRepository.DeletionStatus())

    override suspend fun requestDataExport(userId: String): Resource<Long> = Resource.Success(System.currentTimeMillis())

    override suspend fun getDataExportStatus(userId: String): Resource<UserRepository.DataExportStatus> =
        Resource.Success(UserRepository.DataExportStatus())
}
