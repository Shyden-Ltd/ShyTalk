package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

class UserRepositoryImpl(
    private val api: WorkerApiClient,
    private val firestore: FirebaseFirestore
) : UserRepository {

    private val _userUpdates = MutableSharedFlow<User>(replay = 1, extraBufferCapacity = 5)
    override val userUpdates: SharedFlow<User> = _userUpdates.asSharedFlow()

    private suspend fun emitUserUpdate(userId: String) {
        try {
            val doc = firestore.document("users/$userId").get().await()
            val data = doc.data ?: return
            val user = User.fromMap(data, userId)
            _userUpdates.tryEmit(user)
        } catch (_: Exception) { }
    }

    private val profileVisibleFields = setOf(
        "displayName", "description", "nationality", "profilePhotoUrl",
        "coverPhotoUrl", "avatarUrl", "hideFollowing", "hideOnlineStatus", "hideAge"
    )

    // ---- Kept as Worker API (needs server-side logic) ----

    override suspend fun createOrUpdateUser(user: User): Resource<Unit> = firebaseCall("Failed to create/update user") {
        val body = JSONObject()
        for ((k, v) in user.toMap()) {
            body.put(k, v ?: JSONObject.NULL)
        }
        api.post("/api/users", body)
        _userUpdates.tryEmit(user)
    }

    override suspend fun generateUniqueId(userId: String): Resource<Long> = firebaseCall("Failed to generate unique ID") {
        val json = api.post("/api/users/$userId/unique-id")
        json.getLong("uniqueId")
    }

    override suspend fun submitSuspensionAppeal(userId: String, appealText: String): Resource<Unit> =
        firebaseCall("Failed to submit appeal") {
            api.post("/api/users/$userId/appeal", JSONObject().put("appealText", appealText))
        }

    override suspend fun liftExpiredSuspension(userId: String): Resource<Unit> =
        firebaseCall("Failed to lift expired suspension") {
            api.post("/api/users/$userId/lift-suspension")
        }

    // ---- Read methods (unchanged — all use Firestore SDK) ----

    // Read from Firestore (offline cache replaces in-memory LRU cache)
    override suspend fun getUser(userId: String): Resource<User> = firebaseCall("Failed to get user") {
        val doc = firestore.document("users/$userId").get().await()
        val data = doc.data ?: throw Exception("User not found")
        User.fromMap(data, userId)
    }

    override suspend fun userExists(userId: String): Resource<Boolean> = firebaseCall("Failed to check user existence") {
        val doc = firestore.document("users/$userId").get().await()
        doc.exists()
    }

    // Read blocked IDs from Firestore user doc
    override suspend fun getBlockedUserIds(userId: String): Resource<Set<String>> = firebaseCall("Failed to get blocked users") {
        val doc = firestore.document("users/$userId").get().await()
        val data = doc.data ?: return@firebaseCall emptySet()
        (data["blockedUserIds"] as? List<*>)
            ?.filterIsInstance<String>()?.toSet() ?: emptySet()
    }

    override suspend fun getUsers(userIds: List<String>): Resource<List<User>> {
        if (userIds.isEmpty()) return Resource.Success(emptyList())
        return firebaseCall("Failed to get users") {
            coroutineScope {
                userIds.chunked(10).flatMap { chunk ->
                    chunk.map { uid ->
                        async(Dispatchers.IO) {
                            try {
                                val doc = firestore.document("users/$uid").get().await()
                                val data = doc.data ?: return@async null
                                User.fromMap(data, uid)
                            } catch (_: Exception) { null }
                        }
                    }.mapNotNull { it.await() }
                }
            }
        }
    }

    override suspend fun getStalkers(profileUserId: String): Resource<List<ProfileVisitor>> =
        firebaseCall("Failed to load stalkers") {
            val snapshot = firestore.collection("users/$profileUserId/stalkers")
                .orderBy("visitedAt", com.google.firebase.firestore.Query.Direction.DESCENDING)
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
    override fun observeUserFlags(userId: String): Flow<UserFlags> = callbackFlow {
        val listener = firestore.document("users/$userId")
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null || !snapshot.exists()) return@addSnapshotListener
                val data = snapshot.data ?: return@addSnapshotListener
                trySend(UserFlags(
                    isSuspended = data["isSuspended"] as? Boolean ?: false,
                    suspensionEndDate = data["suspensionEndDate"] as? Long,
                    hasActiveWarning = data["hasActiveWarning"] as? Boolean ?: false,
                    warningReason = data["warningReason"] as? String
                ))
            }
        awaitClose { listener.remove() }
    }

    override suspend fun getWarningReason(userId: String): Resource<String?> = firebaseCall("Failed to get warning reason") {
        val doc = firestore.document("users/$userId").get().await()
        val data = doc.data ?: return@firebaseCall null
        data["warningReason"] as? String
    }

    // Real-time user observation from Firestore (replaces 120s polling)
    override fun observeUsers(userIds: Set<String>): Flow<User> {
        if (userIds.isEmpty()) return emptyFlow()
        return userIds.map { userId ->
            callbackFlow {
                val listener = firestore.document("users/$userId")
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

    override suspend fun updateDisplayName(userId: String, displayName: String): Resource<Unit> =
        firebaseCall("Failed to update display name") {
            firestore.document("users/$userId").update("displayName", displayName).await()
            emitUserUpdate(userId)
        }

    override suspend fun updateAvatar(userId: String, avatarUrl: String): Resource<Unit> =
        firebaseCall("Failed to update avatar") {
            firestore.document("users/$userId").update("avatarUrl", avatarUrl).await()
            emitUserUpdate(userId)
        }

    override suspend fun updateLastSeen(userId: String): Resource<Unit> =
        firebaseCall("Failed to update last seen") {
            firestore.document("users/$userId").update("lastSeenAt", System.currentTimeMillis()).await()
        }

    override suspend fun updateProfile(userId: String, fields: Map<String, Any?>): Resource<Unit> =
        firebaseCall("Failed to update profile") {
            firestore.document("users/$userId").update(fields).await()
            if (fields.keys.any { it in profileVisibleFields }) {
                emitUserUpdate(userId)
            }
        }

    override suspend fun blockUser(userId: String, blockedUserId: String): Resource<Unit> =
        firebaseCall("Failed to block user") {
            firestore.document("users/$userId")
                .update("blockedUserIds", FieldValue.arrayUnion(blockedUserId)).await()
        }

    override suspend fun unblockUser(userId: String, blockedUserId: String): Resource<Unit> =
        firebaseCall("Failed to unblock user") {
            firestore.document("users/$userId")
                .update("blockedUserIds", FieldValue.arrayRemove(blockedUserId)).await()
        }

    override suspend fun checkBlockedBy(userIds: List<String>, targetUserId: String): Resource<Set<String>> {
        if (userIds.isEmpty()) return Resource.Success(emptySet())
        return firebaseCall("Failed to check blocks") {
            coroutineScope {
                userIds.map { uid ->
                    async(Dispatchers.IO) {
                        try {
                            val doc = firestore.document("users/$uid").get().await()
                            val data = doc.data ?: return@async null
                            val blockedIds = (data["blockedUserIds"] as? List<*>)
                                ?.filterIsInstance<String>() ?: emptyList()
                            if (targetUserId in blockedIds) uid else null
                        } catch (_: Exception) { null }
                    }
                }.mapNotNull { it.await() }.toSet()
            }
        }
    }

    override suspend fun followUser(currentUserId: String, targetUserId: String): Resource<Unit> =
        firebaseCall("Failed to follow user") {
            firestore.document("users/$currentUserId")
                .update("followingIds", FieldValue.arrayUnion(targetUserId)).await()
            firestore.document("users/$targetUserId")
                .update("followerIds", FieldValue.arrayUnion(currentUserId)).await()
        }

    override suspend fun unfollowUser(currentUserId: String, targetUserId: String): Resource<Unit> =
        firebaseCall("Failed to unfollow user") {
            firestore.document("users/$currentUserId")
                .update("followingIds", FieldValue.arrayRemove(targetUserId)).await()
            firestore.document("users/$targetUserId")
                .update("followerIds", FieldValue.arrayRemove(currentUserId)).await()
        }

    override suspend fun removeFollower(userId: String, followerId: String): Resource<Unit> =
        firebaseCall("Failed to remove follower") {
            firestore.document("users/$userId")
                .update("followerIds", FieldValue.arrayRemove(followerId)).await()
            firestore.document("users/$followerId")
                .update("followingIds", FieldValue.arrayRemove(userId)).await()
        }

    override suspend fun recordProfileVisit(profileUserId: String, visitorId: String): Resource<Unit> =
        firebaseCall("Failed to record visit") {
            val now = System.currentTimeMillis()
            val docRef = firestore.document("users/$profileUserId/stalkers/$visitorId")
            val existing = docRef.get().await()
            if (existing.exists()) {
                docRef.update(
                    mapOf(
                        "lastVisitedAt" to now,
                        "visitCount" to FieldValue.increment(1)
                    )
                ).await()
            } else {
                docRef.set(
                    mapOf(
                        "visitorId" to visitorId,
                        "lastVisitedAt" to now,
                        "firstVisitedAt" to now,
                        "visitCount" to 1L
                    )
                ).await()
            }
        }

    override suspend fun markStalkersViewed(userId: String): Resource<Unit> =
        firebaseCall("Failed to mark stalkers viewed") {
            firestore.document("users/$userId")
                .update("stalkersViewedAt", System.currentTimeMillis()).await()
        }

    override suspend fun setAlias(userId: String, targetUserId: String, alias: String): Resource<Unit> =
        firebaseCall("Failed to set alias") {
            firestore.document("users/$userId")
                .update("aliases.$targetUserId", alias).await()
        }

    override suspend fun removeAlias(userId: String, targetUserId: String): Resource<Unit> =
        firebaseCall("Failed to remove alias") {
            firestore.document("users/$userId")
                .update("aliases.$targetUserId", FieldValue.delete()).await()
        }

    override suspend fun acknowledgeWarning(userId: String): Resource<Unit> =
        firebaseCall("Failed to acknowledge warning") {
            firestore.document("users/$userId")
                .update(mapOf("hasActiveWarning" to false, "warningReason" to null)).await()
        }
}
