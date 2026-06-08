package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.firestore.dataMap
import com.shyden.shytalk.data.remote.IosApiClient
import dev.gitlive.firebase.firestore.Direction
import dev.gitlive.firebase.firestore.DocumentSnapshot
import dev.gitlive.firebase.firestore.FieldPath
import dev.gitlive.firebase.firestore.FieldValue
import dev.gitlive.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull

private const val TAG = "UserRepository"

class IosUserRepositoryImpl(
    private val api: IosApiClient,
    private val firestore: FirebaseFirestore,
) : UserRepository {
    private val _userUpdates = MutableSharedFlow<User>(replay = 1, extraBufferCapacity = 5)
    override val userUpdates: SharedFlow<User> = _userUpdates.asSharedFlow()

    private suspend fun emitUserUpdate(userId: String) {
        try {
            val doc = firestore.collection("users").document(userId).get()
            if (!doc.exists) return
            val user = docToUser(doc, userId)
            _userUpdates.tryEmit(user)
        } catch (e: Exception) {
            logW(TAG, "Failed to emit user update for $userId")
        }
    }

    private fun docToUser(
        doc: DocumentSnapshot,
        userId: String,
    ): User {
        val data = doc.dataMap()
        return User.fromMap(data, userId)
    }

    // ── Read methods ────────────────────────────────────────────────

    override suspend fun getUser(userId: String): Resource<User> =
        firebaseCall("Failed to get user") {
            val doc = firestore.collection("users").document(userId).get()
            if (!doc.exists) throw Exception("User not found")
            docToUser(doc, userId)
        }

    override suspend fun userExists(userId: String): Resource<Boolean> =
        firebaseCall("Failed to check user existence") {
            val doc = firestore.collection("users").document(userId).get()
            doc.exists
        }

    override suspend fun getBlockedUserIds(userId: String): Resource<Set<String>> =
        firebaseCall("Failed to get blocked users") {
            val doc = firestore.collection("users").document(userId).get()
            if (!doc.exists) return@firebaseCall emptySet()
            val data = doc.dataMap()
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
                            .where { FieldPath.documentId inArray chunk }
                            .get()
                    snapshot.documents.map { doc -> docToUser(doc, doc.id) }
                } catch (e: Exception) {
                    logW(TAG, "Failed to batch-load ${chunk.size} users")
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
                    .orderBy("lastVisitedAt", Direction.DESCENDING)
                    .limit(50)
                    .get()
            snapshot.documents.mapNotNull { doc ->
                try {
                    val data = doc.dataMap()
                    ProfileVisitor.fromMap(data)
                } catch (e: Exception) {
                    null
                }
            }
        }

    override suspend fun getAliases(userId: String): Resource<Map<String, String>> =
        firebaseCall("Failed to get aliases") {
            val doc = firestore.collection("users").document(userId).get()
            if (!doc.exists) return@firebaseCall emptyMap()
            val data = doc.dataMap()
            val aliases = data["aliases"] as? Map<*, *> ?: return@firebaseCall emptyMap()
            aliases.entries.associate { (k, v) -> k.toString() to v.toString() }
        }

    override suspend fun getWarningReason(userId: String): Resource<String?> =
        firebaseCall("Failed to get warning reason") {
            val doc = firestore.collection("users").document(userId).get()
            if (!doc.exists) return@firebaseCall null
            val data = doc.dataMap()
            data["warningReason"] as? String
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
                                .where { FieldPath.documentId inArray chunk }
                                .get()
                        snapshot.documents.mapNotNull { doc ->
                            val data = doc.dataMap()
                            val blockedIds =
                                (data["blockedUserIds"] as? List<*>)
                                    ?.filterIsInstance<String>() ?: emptyList()
                            if (targetUserId in blockedIds) doc.id else null
                        }
                    } catch (e: Exception) {
                        logW(TAG, "Failed to batch-check blocks for ${chunk.size} users")
                        emptyList()
                    }
                }.toSet()
        }
    }

    // ── Real-time flows ─────────────────────────────────────────────

    override fun observeUserFlags(userId: String): Flow<UserFlags> =
        firestore
            .collection("users")
            .document(userId)
            .snapshots
            .map { snapshot ->
                if (!snapshot.exists) return@map UserFlags()
                val data = snapshot.dataMap()
                UserFlags(
                    isSuspended = data["isSuspended"] as? Boolean ?: false,
                    suspensionEndDate = (data["suspensionEndDate"] as? Number)?.toLong(),
                    hasActiveWarning = data["hasActiveWarning"] as? Boolean ?: false,
                    warningReason = data["warningReason"] as? String,
                )
            }

    override fun observeUsers(userIds: Set<String>): Flow<User> {
        if (userIds.isEmpty()) return emptyFlow()
        return userIds
            .map { userId ->
                firestore
                    .collection("users")
                    .document(userId)
                    .snapshots
                    // Skip non-existent docs (deletion or never-created):
                    // dataMap() on a missing doc yields an empty map, and
                    // User.fromMap of an empty map produces a zero-value
                    // ghost User (uid="", uniqueId=0) that propagates into
                    // seat rendering and follower-counts with no error
                    // signal. Guard matches the observeUserFlags pattern
                    // already in this file at line 178.
                    .filter { it.exists }
                    .map { snapshot ->
                        docToUser(snapshot, userId)
                    }
            }.merge()
    }

    // ── Write methods (Firestore + Express API) ─────────────────────

    override suspend fun createOrUpdateUser(user: User): Resource<Unit> =
        firebaseCall("Failed to create/update user") {
            val body = JsonObject(user.toMap().mapValues { (_, v) -> toJsonElement(v) })
            api.post("/api/users", body)
            _userUpdates.tryEmit(user)
        }

    /**
     * Recursively convert a value to the matching kotlinx.serialization JsonElement.
     * Critical: List/Map values must NOT fall through to JsonPrimitive(v.toString()),
     * which yields strings like "[uid1, uid2]" or "{key=value}" instead of valid
     * JSON arrays/objects. The Express API receives those as strings and either
     * rejects the request or stores garbage. List<String> fields like blockedUserIds,
     * followingIds, providers must round-trip as JSON arrays.
     */
    private fun toJsonElement(v: Any?): JsonElement =
        when (v) {
            null -> JsonNull

            is String -> JsonPrimitive(v)

            is Number -> JsonPrimitive(v)

            is Boolean -> JsonPrimitive(v)

            is Map<*, *> ->
                JsonObject(
                    v.entries.associate { (k, value) ->
                        k.toString() to toJsonElement(value)
                    },
                )

            is List<*> -> JsonArray(v.map { toJsonElement(it) })

            is Set<*> -> JsonArray(v.map { toJsonElement(it) })

            else -> JsonPrimitive(v.toString())
        }

    override suspend fun updateDisplayName(
        userId: String,
        displayName: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update display name") {
            firestore.collection("users").document(userId).updateFields { "displayName" to displayName }
            emitUserUpdate(userId)
        }

    override suspend fun updateAvatar(
        userId: String,
        avatarUrl: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update avatar") {
            firestore.collection("users").document(userId).updateFields { "avatarUrl" to avatarUrl }
            emitUserUpdate(userId)
        }

    override suspend fun updateLastSeen(userId: String): Resource<Unit> =
        firebaseCall("Failed to update last seen") {
            firestore.collection("users").document(userId).updateFields { "lastSeenAt" to currentTimeMillis() }
        }

    override suspend fun updateProfile(
        userId: String,
        fields: Map<String, Any?>,
    ): Resource<Unit> =
        firebaseCall("Failed to update profile") {
            firestore.collection("users").document(userId).updateFields {
                for ((k, v) in fields) {
                    k to (v ?: FieldValue.delete)
                }
            }
            emitUserUpdate(userId)
        }

    override suspend fun generateUniqueId(userId: String): Resource<Long> =
        firebaseCall("Failed to generate unique ID") {
            val response = api.post("/api/users/$userId/unique-id")
            response["uniqueId"]!!.jsonPrimitive.long
        }

    override suspend fun blockUser(
        userId: String,
        blockedUserId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to block user") {
            firestore
                .collection("users")
                .document(userId)
                .updateFields { "blockedUserIds" to FieldValue.arrayUnion(blockedUserId) }
        }

    override suspend fun unblockUser(
        userId: String,
        blockedUserId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to unblock user") {
            firestore
                .collection("users")
                .document(userId)
                .updateFields { "blockedUserIds" to FieldValue.arrayRemove(blockedUserId) }
        }

    override suspend fun followUser(
        currentUserId: String,
        targetUserId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to follow user") {
            api.post(
                "/api/users/$currentUserId/follow",
                JsonObject(mapOf("targetUserId" to JsonPrimitive(targetUserId))),
            )
        }

    override suspend fun unfollowUser(
        currentUserId: String,
        targetUserId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to unfollow user") {
            api.post(
                "/api/users/$currentUserId/unfollow",
                JsonObject(mapOf("targetUserId" to JsonPrimitive(targetUserId))),
            )
        }

    override suspend fun removeFollower(
        userId: String,
        followerId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove follower") {
            api.post(
                "/api/users/$userId/remove-follower",
                JsonObject(mapOf("followerUserId" to JsonPrimitive(followerId))),
            )
        }

    override suspend fun recordProfileVisit(
        profileUserId: String,
        visitorId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to record visit") {
            api.post(
                "/api/users/$profileUserId/record-visit",
                JsonObject(mapOf("visitorId" to JsonPrimitive(visitorId))),
            )
        }

    override suspend fun markStalkersViewed(userId: String): Resource<Unit> =
        firebaseCall("Failed to mark stalkers viewed") {
            firestore.collection("users").document(userId).updateFields {
                "stalkersLastViewedAt" to currentTimeMillis()
                "newStalkerCount" to 0L
            }
        }

    override suspend fun submitSuspensionAppeal(
        userId: String,
        appealText: String,
    ): Resource<Unit> =
        firebaseCall("Failed to submit appeal") {
            api.post(
                "/api/users/$userId/appeal",
                JsonObject(mapOf("appealText" to JsonPrimitive(appealText))),
            )
        }

    override suspend fun liftExpiredSuspension(userId: String): Resource<Unit> =
        firebaseCall("Failed to lift expired suspension") {
            api.post("/api/users/$userId/lift-suspension")
        }

    override suspend fun checkPmLockOnLogin(userId: String): Resource<PmLockCheckResult> =
        firebaseCall("Failed to check PM lock state") {
            val json = api.post("/api/users/$userId/pm-lock-check")

            fun bool(key: String): Boolean = (json[key] as? JsonPrimitive)?.booleanOrNull ?: false

            fun str(
                key: String,
                default: String,
            ): String = (json[key] as? JsonPrimitive)?.contentOrNull ?: default
            PmLockCheckResult(
                pmLocked = bool("pmLocked"),
                unlocked = bool("unlocked"),
                alreadyCheckedToday = bool("alreadyCheckedToday"),
                cohort = str("cohort", "minor"),
                cohortChanged = bool("cohortChanged"),
                forceTokenRefresh = bool("forceTokenRefresh"),
                claimMintFailed = bool("claimMintFailed"),
            )
        }

    override suspend fun setAlias(
        userId: String,
        targetUserId: String,
        alias: String,
    ): Resource<Unit> =
        firebaseCall("Failed to set alias") {
            firestore.collection("users").document(userId).updateFields { "aliases.$targetUserId" to alias }
        }

    override suspend fun removeAlias(
        userId: String,
        targetUserId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove alias") {
            firestore
                .collection("users")
                .document(userId)
                .updateFields { "aliases.$targetUserId" to FieldValue.delete }
        }

    override suspend fun acknowledgeWarning(userId: String): Resource<Unit> =
        firebaseCall("Failed to acknowledge warning") {
            firestore.collection("users").document(userId).updateFields {
                "hasActiveWarning" to false
                "warningReason" to null
            }
        }

    override suspend fun requestAccountDeletion(
        userId: String,
        pin: String,
    ): Resource<Long> =
        firebaseCall("Failed to request account deletion") {
            val response =
                api.post(
                    "/api/users/$userId/delete",
                    JsonObject(mapOf("pin" to JsonPrimitive(pin))),
                )
            response["deleteAt"]!!.jsonPrimitive.long
        }

    override suspend fun cancelAccountDeletion(userId: String): Resource<Unit> =
        firebaseCall("Failed to cancel account deletion") {
            api.post("/api/users/$userId/cancel-delete", JsonObject(emptyMap()))
        }

    override suspend fun getAccountDeletionStatus(userId: String): Resource<UserRepository.DeletionStatus> =
        firebaseCall("Failed to get deletion status") {
            val r = api.get("/api/users/$userId/deletion-status")
            UserRepository.DeletionStatus(
                scheduled = r["scheduled"]?.jsonPrimitive?.boolean ?: false,
                scheduledAt = r["scheduledAt"]?.jsonPrimitive?.longOrNull,
                executeAt = r["executeAt"]?.jsonPrimitive?.longOrNull,
                reason = r["reason"]?.jsonPrimitive?.content,
                daysRemaining = r["daysRemaining"]?.jsonPrimitive?.intOrNull,
            )
        }

    override suspend fun requestDataExport(userId: String): Resource<Long> =
        firebaseCall("Failed to request data export") {
            val response = api.post("/api/users/$userId/data-export", JsonObject(emptyMap()))
            response["requestedAt"]!!.jsonPrimitive.long
        }

    override suspend fun getDataExportStatus(userId: String): Resource<UserRepository.DataExportStatus> =
        firebaseCall("Failed to get export status") {
            val r = api.get("/api/users/$userId/data-export/status")
            UserRepository.DataExportStatus(
                status = r["status"]?.jsonPrimitive?.content ?: "none",
                requestedAt = r["requestedAt"]?.jsonPrimitive?.longOrNull,
                expiresAt = r["expiresAt"]?.jsonPrimitive?.longOrNull,
            )
        }
}
