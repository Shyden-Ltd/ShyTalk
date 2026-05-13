package com.shyden.shytalk.data.repository

import android.util.Log
import com.google.firebase.firestore.FieldPath
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

private const val TAG = "UserRepository"

class UserRepositoryImpl(
    private val api: WorkerApiClient,
    private val firestore: FirebaseFirestore,
) : UserRepository {
    private val _userUpdates = MutableSharedFlow<User>(replay = 1, extraBufferCapacity = 5)
    override val userUpdates: SharedFlow<User> = _userUpdates.asSharedFlow()

    private suspend fun emitUserUpdate(userId: String) {
        try {
            val doc = firestore.document("users/$userId").get().await()
            val data = doc.data ?: return
            val user = User.fromMap(data, userId)
            _userUpdates.tryEmit(user)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Failed to emit user update for $userId", e)
        }
    }

    private val profileVisibleFields =
        setOf(
            "displayName",
            "description",
            "nationality",
            "profilePhotoUrl",
            "coverPhotoUrl",
            "avatarUrl",
            "hideFollowing",
            "hideOnlineStatus",
            "hideAge",
        )

    // ---- Kept as Worker API (needs server-side logic) ----

    override suspend fun createOrUpdateUser(user: User): Resource<Unit> =
        firebaseCall("Failed to create/update user") {
            val body = JSONObject()
            for ((k, v) in user.toMap()) {
                body.put(k, v ?: JSONObject.NULL)
            }
            api.post("/api/users", body)
            _userUpdates.tryEmit(user)
        }

    override suspend fun generateUniqueId(userId: String): Resource<Long> =
        firebaseCall("Failed to generate unique ID") {
            val json = api.post("/api/users/$userId/unique-id")
            json.getLong("uniqueId")
        }

    override suspend fun submitSuspensionAppeal(
        userId: String,
        appealText: String,
    ): Resource<Unit> =
        firebaseCall("Failed to submit appeal") {
            api.post("/api/users/$userId/appeal", JSONObject().put("appealText", appealText))
        }

    override suspend fun liftExpiredSuspension(userId: String): Resource<Unit> =
        firebaseCall("Failed to lift expired suspension") {
            api.post("/api/users/$userId/lift-suspension")
        }

    override suspend fun checkPmLockOnLogin(userId: String): Resource<PmLockCheckResult> =
        firebaseCall("Failed to check PM lock state") {
            val json = api.post("/api/users/$userId/pm-lock-check")
            // Defensive defaults: a server that doesn't yet ship PR 2
            // omits these fields. `optX(default)` returns the default
            // when the key is missing or the wrong type.
            PmLockCheckResult(
                pmLocked = json.optBoolean("pmLocked", false),
                unlocked = json.optBoolean("unlocked", false),
                alreadyCheckedToday = json.optBoolean("alreadyCheckedToday", false),
                cohort = json.optString("cohort", "minor"),
                cohortChanged = json.optBoolean("cohortChanged", false),
                forceTokenRefresh = json.optBoolean("forceTokenRefresh", false),
                claimMintFailed = json.optBoolean("claimMintFailed", false),
            )
        }

    // ---- Read methods (unchanged — all use Firestore SDK) ----

    // Read from Firestore (offline cache replaces in-memory LRU cache)
    override suspend fun getUser(userId: String): Resource<User> =
        firebaseCall("Failed to get user") {
            val doc = firestore.document("users/$userId").get().await()
            val data = doc.data ?: throw Exception("User not found")
            User.fromMap(data, userId)
        }

    override suspend fun userExists(userId: String): Resource<Boolean> =
        firebaseCall("Failed to check user existence") {
            val doc = firestore.document("users/$userId").get().await()
            doc.exists()
        }

    // Read blocked IDs from Firestore user doc
    override suspend fun getBlockedUserIds(userId: String): Resource<Set<String>> =
        firebaseCall("Failed to get blocked users") {
            val doc = firestore.document("users/$userId").get().await()
            val data = doc.data ?: return@firebaseCall emptySet()
            (data["blockedUserIds"] as? List<*>)
                ?.filterIsInstance<String>()
                ?.toSet() ?: emptySet()
        }

    override suspend fun getUsers(userIds: List<String>): Resource<List<User>> {
        if (userIds.isEmpty()) return Resource.Success(emptyList())
        return firebaseCall("Failed to get users") {
            userIds.chunked(30).flatMap { chunk ->
                try {
                    val snapshot =
                        firestore
                            .collection("users")
                            .whereIn(FieldPath.documentId(), chunk)
                            .get()
                            .await()
                    snapshot.documents.mapNotNull { doc ->
                        val data = doc.data ?: return@mapNotNull null
                        User.fromMap(data, doc.id)
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to batch-load ${chunk.size} users", e)
                    emptyList()
                }
            }
        }
    }

    override suspend fun getStalkers(profileUserId: String): Resource<List<ProfileVisitor>> =
        firebaseCall("Failed to load stalkers") {
            val snapshot =
                firestore
                    .collection("users/$profileUserId/stalkers")
                    .orderBy("lastVisitedAt", com.google.firebase.firestore.Query.Direction.DESCENDING)
                    .limit(50)
                    .get()
                    .await()
            snapshot.documents.mapNotNull { doc ->
                val data = doc.data ?: return@mapNotNull null
                ProfileVisitor.fromMap(data)
            }
        }

    override suspend fun getAliases(userId: String): Resource<Map<String, String>> =
        firebaseCall("Failed to get aliases") {
            val doc = firestore.document("users/$userId").get().await()
            val data = doc.data ?: return@firebaseCall emptyMap()
            val aliases = data["aliases"] as? Map<*, *> ?: return@firebaseCall emptyMap()
            aliases.entries.associate { (k, v) -> k.toString() to v.toString() }
        }

    // Real-time user flags from Firestore user doc
    override fun observeUserFlags(userId: String): Flow<UserFlags> =
        callbackFlow {
            val listener =
                firestore
                    .document("users/$userId")
                    .addSnapshotListener { snapshot, error ->
                        if (error != null || snapshot == null || !snapshot.exists()) return@addSnapshotListener
                        val data = snapshot.data ?: return@addSnapshotListener
                        trySend(
                            UserFlags(
                                isSuspended = data["isSuspended"] as? Boolean ?: false,
                                suspensionEndDate = data["suspensionEndDate"] as? Long,
                                hasActiveWarning = data["hasActiveWarning"] as? Boolean ?: false,
                                warningReason = data["warningReason"] as? String,
                            ),
                        )
                    }
            awaitClose { listener.remove() }
        }

    override suspend fun getWarningReason(userId: String): Resource<String?> =
        firebaseCall("Failed to get warning reason") {
            val doc = firestore.document("users/$userId").get().await()
            val data = doc.data ?: return@firebaseCall null
            data["warningReason"] as? String
        }

    // Real-time user observation from Firestore (replaces 120s polling)
    override fun observeUsers(userIds: Set<String>): Flow<User> {
        if (userIds.isEmpty()) return emptyFlow()
        return userIds
            .map { userId ->
                callbackFlow {
                    val listener =
                        firestore
                            .document("users/$userId")
                            .addSnapshotListener { snapshot, error ->
                                if (error != null || snapshot == null || !snapshot.exists()) return@addSnapshotListener
                                val data = snapshot.data ?: return@addSnapshotListener
                                trySend(User.fromMap(data, userId))
                            }
                    awaitClose { listener.remove() }
                }
            }.merge()
    }

    // ---- Write methods (switched from Worker API to direct Firestore SDK writes) ----

    override suspend fun updateDisplayName(
        userId: String,
        displayName: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update display name") {
            firestore.document("users/$userId").update("displayName", displayName).await()
            emitUserUpdate(userId)
        }

    override suspend fun updateAvatar(
        userId: String,
        avatarUrl: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update avatar") {
            firestore.document("users/$userId").update("avatarUrl", avatarUrl).await()
            emitUserUpdate(userId)
        }

    override suspend fun updateLastSeen(userId: String): Resource<Unit> =
        firebaseCall("Failed to update last seen") {
            firestore.document("users/$userId").update("lastSeenAt", System.currentTimeMillis()).await()
        }

    override suspend fun updateProfile(
        userId: String,
        fields: Map<String, Any?>,
    ): Resource<Unit> =
        firebaseCall("Failed to update profile") {
            firestore.document("users/$userId").update(fields).await()
            if (fields.keys.any { it in profileVisibleFields }) {
                emitUserUpdate(userId)
            }
        }

    override suspend fun blockUser(
        userId: String,
        blockedUserId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to block user") {
            firestore
                .document("users/$userId")
                .update("blockedUserIds", FieldValue.arrayUnion(blockedUserId))
                .await()
        }

    override suspend fun unblockUser(
        userId: String,
        blockedUserId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to unblock user") {
            firestore
                .document("users/$userId")
                .update("blockedUserIds", FieldValue.arrayRemove(blockedUserId))
                .await()
        }

    override suspend fun checkBlockedBy(
        userIds: List<String>,
        targetUserId: String,
    ): Resource<Set<String>> {
        if (userIds.isEmpty()) return Resource.Success(emptySet())
        return firebaseCall("Failed to check blocks") {
            userIds
                .chunked(30)
                .flatMap { chunk ->
                    try {
                        val snapshot =
                            firestore
                                .collection("users")
                                .whereIn(FieldPath.documentId(), chunk)
                                .get()
                                .await()
                        snapshot.documents.mapNotNull { doc ->
                            val data = doc.data ?: return@mapNotNull null
                            val blockedIds =
                                (data["blockedUserIds"] as? List<*>)
                                    ?.filterIsInstance<String>() ?: emptyList()
                            if (targetUserId in blockedIds) doc.id else null
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to batch-check blocks for ${chunk.size} users", e)
                        emptyList()
                    }
                }.toSet()
        }
    }

    override suspend fun followUser(
        currentUserId: String,
        targetUserId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to follow user") {
            api.post("/api/users/$currentUserId/follow", JSONObject().put("targetUserId", targetUserId))
        }

    override suspend fun unfollowUser(
        currentUserId: String,
        targetUserId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to unfollow user") {
            api.post("/api/users/$currentUserId/unfollow", JSONObject().put("targetUserId", targetUserId))
        }

    override suspend fun removeFollower(
        userId: String,
        followerId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove follower") {
            api.post("/api/users/$userId/remove-follower", JSONObject().put("followerUserId", followerId))
        }

    override suspend fun recordProfileVisit(
        profileUserId: String,
        visitorId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to record visit") {
            api.post("/api/users/$profileUserId/record-visit", JSONObject().put("visitorId", visitorId))
        }

    override suspend fun markStalkersViewed(userId: String): Resource<Unit> =
        firebaseCall("Failed to mark stalkers viewed") {
            firestore
                .document("users/$userId")
                .update(
                    mapOf(
                        "stalkersLastViewedAt" to System.currentTimeMillis(),
                        "newStalkerCount" to 0L,
                    ),
                ).await()
        }

    override suspend fun setAlias(
        userId: String,
        targetUserId: String,
        alias: String,
    ): Resource<Unit> =
        firebaseCall("Failed to set alias") {
            firestore
                .document("users/$userId")
                .update("aliases.$targetUserId", alias)
                .await()
        }

    override suspend fun removeAlias(
        userId: String,
        targetUserId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove alias") {
            firestore
                .document("users/$userId")
                .update("aliases.$targetUserId", FieldValue.delete())
                .await()
        }

    override suspend fun acknowledgeWarning(userId: String): Resource<Unit> =
        firebaseCall("Failed to acknowledge warning") {
            firestore
                .document("users/$userId")
                .update(mapOf("hasActiveWarning" to false, "warningReason" to null))
                .await()
        }

    override suspend fun requestAccountDeletion(
        userId: String,
        pin: String,
    ): Resource<Long> =
        firebaseCall("Failed to request account deletion") {
            val response =
                api.post(
                    "/api/users/$userId/delete",
                    JSONObject().put("pin", pin),
                )
            response.getLong("deleteAt")
        }

    override suspend fun cancelAccountDeletion(userId: String): Resource<Unit> =
        firebaseCall("Failed to cancel account deletion") {
            api.post("/api/users/$userId/cancel-delete", JSONObject())
        }

    override suspend fun getAccountDeletionStatus(userId: String): Resource<UserRepository.DeletionStatus> =
        firebaseCall("Failed to get deletion status") {
            val response = api.get("/api/users/$userId/deletion-status")
            UserRepository.DeletionStatus(
                scheduled = response.optBoolean("scheduled", false),
                scheduledAt = if (response.isNull("scheduledAt")) null else response.optLong("scheduledAt"),
                executeAt = if (response.isNull("executeAt")) null else response.optLong("executeAt"),
                reason = if (response.isNull("reason")) null else response.optString("reason"),
                daysRemaining = if (response.isNull("daysRemaining")) null else response.optInt("daysRemaining"),
            )
        }

    override suspend fun requestDataExport(userId: String): Resource<Long> =
        firebaseCall("Failed to request data export") {
            val response = api.post("/api/users/$userId/data-export", JSONObject())
            response.getLong("requestedAt")
        }

    override suspend fun getDataExportStatus(userId: String): Resource<UserRepository.DataExportStatus> =
        firebaseCall("Failed to get export status") {
            val response = api.get("/api/users/$userId/data-export/status")
            UserRepository.DataExportStatus(
                status = response.optString("status", "none"),
                requestedAt = if (response.isNull("requestedAt")) null else response.optLong("requestedAt"),
                expiresAt = if (response.isNull("expiresAt")) null else response.optLong("expiresAt"),
            )
        }
}
