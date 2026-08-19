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

    /**
     * Why a viewer may or may not see somebody's profile — SHY-0348.
     *
     * Deliberately a TYPE and not a string. The block case has to be told apart
     * from "not found" and from a network failure, and the only thing that ever
     * reliably distinguishes them is the server's status code. Matching on an
     * error message would work until somebody rewords it.
     */
    sealed class ProfileAccess {
        data class Visible(
            val user: User,
        ) : ProfileAccess()

        /** The owner has blocked this viewer. They must be unblocked first. */
        data object BlockedByOwner : ProfileAccess()

        /** No such user, or hidden for a reason the server will not disclose. */
        data object NotFound : ProfileAccess()
    }

    /**
     * Load somebody ELSE's profile, through the API so the block gate applies.
     *
     * `getUser` reads Firestore directly, which the rules allow for any
     * same-cohort user — so a blocked viewer saw everything (SHY-0348). The
     * server already refuses (`users.js`, 403), it was simply never asked.
     */
    suspend fun getProfileForViewing(userId: String): Resource<ProfileAccess>

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

    /**
     * Which of [userIds] have blocked the SIGNED-IN user?
     *
     * The subject is always the caller — the server derives it from the auth
     * token — so there is deliberately no parameter for it. A parameter that
     * cannot change the answer would invite a caller to ask about somebody
     * else and quietly receive an answer about themselves.
     *
     * Returns [Resource.Error] when the check could not be completed. That is
     * NOT the same as an empty set, and callers must not conflate them: an
     * empty set means "nobody here has blocked you", an error means "we do not
     * know". (SHY-0351 — the old implementation returned the former for the
     * latter, so the room-join warning could never fire.)
     */
    suspend fun checkBlockedBy(userIds: List<String>): Resource<Set<String>>

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

    /**
     * One page of "who has been viewing me" — SHY-0338.
     *
     * Returns the visit records AND the visitors' profiles together. The
     * caller used to fetch the records and then batch-fetch the profiles
     * separately, and the second call was the one that failed: it queried
     * Firestore directly, and `firestore.rules` refuses such a query
     * ALL-OR-NOTHING when any one member fails the cohort gate. Both halves
     * now come from `GET /api/users/:uniqueId/stalkers`, where the Admin SDK
     * can drop individual visitors instead of refusing the list.
     *
     * Owner-only. Asking for somebody else's is refused by the server.
     */
    data class StalkerPage(
        val visitors: List<ProfileVisitor> = emptyList(),
        val users: List<User> = emptyList(),
    )

    suspend fun getStalkers(profileUserId: String): Resource<StalkerPage>

    suspend fun markStalkersViewed(userId: String): Resource<Unit>

    fun observeUsers(userIds: Set<String>): Flow<User>

    suspend fun submitSuspensionAppeal(
        userId: String,
        appealText: String,
    ): Resource<Unit>

    suspend fun liftExpiredSuspension(userId: String): Resource<Unit>

    /**
     * First-of-day PM-lock auto-unlock + UK OSA #17 cohort check.
     *
     * Calls `POST /api/users/:uniqueId/pm-lock-check`. The server
     * reads the user doc, decides whether the user has aged into 18+
     * since the lock was set, writes the unlock + cohort flip
     * atomically, and mints a fresh `cohort` custom claim if the
     * cohort changed. Server-side because Firestore rules deny
     * client writes to `pmLocked` / `lastPmLockCheck` / `cohort`.
     *
     * Throttled inside the route to one Firestore op per UTC day per
     * user. Failure is non-fatal: the next launch or a counterparty's
     * gate will surface the current state.
     *
     * The returned [PmLockCheckResult.forceTokenRefresh] flag tells
     * the caller to invoke [AuthRepository.refreshIdToken] before
     * the next Firestore read — otherwise the rules-layer sees the
     * stale cohort claim and the cross-cohort gate lags up to ~1h.
     */
    suspend fun checkPmLockOnLogin(userId: String): Resource<PmLockCheckResult>

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
