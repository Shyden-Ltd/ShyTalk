package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FieldPath
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
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
import kotlinx.coroutines.withTimeout

class UserRepositoryImpl(
    private val firestore: FirebaseFirestore
) : UserRepository {

    private val usersCollection = firestore.collection("users")

    private val _userUpdates = MutableSharedFlow<User>(replay = 1, extraBufferCapacity = 5)
    override val userUpdates: SharedFlow<User> = _userUpdates.asSharedFlow()

    private suspend fun emitUserUpdate(userId: String) {
        try {
            val doc = usersCollection.document(userId).get().await()
            if (doc.exists()) {
                val data = doc.data
                if (data != null) {
                    _userUpdates.tryEmit(User.fromMap(data, doc.id))
                }
            }
        } catch (_: Exception) {
            // Best-effort: don't fail the parent operation if re-fetch fails
        }
    }

    private val profileVisibleFields = setOf(
        "displayName", "description", "nationality", "profilePhotoUrl",
        "coverPhotoUrl", "avatarUrl", "hideFollowing", "hideOnlineStatus", "hideAge"
    )

    override suspend fun createOrUpdateUser(user: User): Resource<Unit> = firebaseCall("Failed to create/update user") {
        try {
            withTimeout(10_000L) {
                usersCollection.document(user.uid).set(user.toMap()).await()
            }
            _userUpdates.tryEmit(user)
        } catch (_: TimeoutCancellationException) {
            throw Exception("Server not responding — please try again")
        }
    }

    override suspend fun getUser(userId: String): Resource<User> = firebaseCall("Failed to get user") {
        val doc = usersCollection.document(userId).get().await()
        if (!doc.exists()) throw Exception("User not found")
        val data = doc.data ?: throw Exception("User data is null")
        User.fromMap(data, doc.id)
    }

    override suspend fun userExists(userId: String): Resource<Boolean> = firebaseCall("Failed to check user existence") {
        val doc = usersCollection.document(userId).get().await()
        doc.exists()
    }

    override suspend fun updateDisplayName(userId: String, displayName: String): Resource<Unit> = firebaseCall("Failed to update display name") {
        usersCollection.document(userId).update("displayName", displayName).await()
        emitUserUpdate(userId)
    }

    override suspend fun updateAvatar(userId: String, avatarUrl: String): Resource<Unit> = firebaseCall("Failed to update avatar") {
        usersCollection.document(userId).update("avatarUrl", avatarUrl).await()
        emitUserUpdate(userId)
    }

    override suspend fun updateLastSeen(userId: String): Resource<Unit> = firebaseCall("Failed to update last seen") {
        usersCollection.document(userId).update("lastSeenAt", Timestamp.now()).await()
    }

    override suspend fun updateProfile(userId: String, fields: Map<String, Any?>): Resource<Unit> = firebaseCall("Failed to update profile") {
        usersCollection.document(userId).update(fields).await()
        if (fields.keys.any { it in profileVisibleFields }) {
            emitUserUpdate(userId)
        }
    }

    override suspend fun generateUniqueId(userId: String): Resource<Long> = firebaseCall("Failed to generate unique ID") {
        val counterRef = firestore.collection("counters").document("uniqueId")
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(counterRef)
            val currentId = if (snapshot.exists()) {
                snapshot.getLong("nextId") ?: 10000000L
            } else {
                10000000L
            }
            transaction.set(counterRef, mapOf("nextId" to currentId + 1))
            transaction.update(usersCollection.document(userId), "uniqueId", currentId)
            currentId
        }.await()
    }

    override suspend fun blockUser(userId: String, blockedUserId: String): Resource<Unit> = firebaseCall("Failed to block user") {
        val batch = firestore.batch()
        // Add to blocked list
        batch.update(usersCollection.document(userId), "blockedUserIds", FieldValue.arrayUnion(blockedUserId))
        // Remove follow connections in both directions
        batch.update(usersCollection.document(userId), "followingIds", FieldValue.arrayRemove(blockedUserId))
        batch.update(usersCollection.document(userId), "followerIds", FieldValue.arrayRemove(blockedUserId))
        batch.update(usersCollection.document(blockedUserId), "followingIds", FieldValue.arrayRemove(userId))
        batch.update(usersCollection.document(blockedUserId), "followerIds", FieldValue.arrayRemove(userId))
        batch.commit().await()
    }

    override suspend fun unblockUser(userId: String, blockedUserId: String): Resource<Unit> = firebaseCall("Failed to unblock user") {
        usersCollection.document(userId)
            .update("blockedUserIds", FieldValue.arrayRemove(blockedUserId)).await()
    }

    override suspend fun getBlockedUserIds(userId: String): Resource<Set<String>> = firebaseCall("Failed to get blocked users") {
        val doc = usersCollection.document(userId).get().await()
        if (!doc.exists()) return@firebaseCall emptySet()
        val data = doc.data ?: return@firebaseCall emptySet()
        (data["blockedUserIds"] as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet()
    }

    override suspend fun followUser(currentUserId: String, targetUserId: String): Resource<Unit> =
        firebaseCall("Failed to follow user") {
            val batch = firestore.batch()
            batch.update(usersCollection.document(currentUserId), "followingIds", FieldValue.arrayUnion(targetUserId))
            batch.update(usersCollection.document(targetUserId), "followerIds", FieldValue.arrayUnion(currentUserId))
            batch.commit().await()
        }

    override suspend fun unfollowUser(currentUserId: String, targetUserId: String): Resource<Unit> =
        firebaseCall("Failed to unfollow user") {
            val batch = firestore.batch()
            batch.update(usersCollection.document(currentUserId), "followingIds", FieldValue.arrayRemove(targetUserId))
            batch.update(usersCollection.document(targetUserId), "followerIds", FieldValue.arrayRemove(currentUserId))
            batch.commit().await()
        }

    override suspend fun removeFollower(userId: String, followerId: String): Resource<Unit> =
        firebaseCall("Failed to remove follower") {
            val batch = firestore.batch()
            batch.update(usersCollection.document(userId), "followerIds", FieldValue.arrayRemove(followerId))
            batch.update(usersCollection.document(followerId), "followingIds", FieldValue.arrayRemove(userId))
            batch.commit().await()
        }

    override suspend fun getUsers(userIds: List<String>): Resource<List<User>> =
        firebaseCall("Failed to get users") {
            if (userIds.isEmpty()) return@firebaseCall emptyList()
            coroutineScope {
                userIds.chunked(30).map { chunk ->
                    async {
                        val snapshot = usersCollection.whereIn(FieldPath.documentId(), chunk).get().await()
                        snapshot.documents.mapNotNull { doc ->
                            doc.data?.let { User.fromMap(it, doc.id) }
                        }
                    }
                }.awaitAll().flatMap { it }
            }
        }

    override fun observeUsers(userIds: Set<String>): Flow<User> {
        if (userIds.isEmpty()) return emptyFlow()
        return userIds.map { userId ->
            callbackFlow {
                val listener = usersCollection.document(userId)
                    .addSnapshotListener { snapshot, error ->
                        if (error != null || snapshot == null || !snapshot.exists()) return@addSnapshotListener
                        snapshot.data?.let { trySend(User.fromMap(it, snapshot.id)) }
                    }
                awaitClose { listener.remove() }
            }
        }.merge()
    }
}
