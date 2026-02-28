package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.merge
import org.json.JSONArray
import org.json.JSONObject

class UserRepositoryImpl(
    private val api: WorkerApiClient
) : UserRepository {

    private val _userUpdates = MutableSharedFlow<User>(replay = 1, extraBufferCapacity = 5)
    override val userUpdates: SharedFlow<User> = _userUpdates.asSharedFlow()

    private suspend fun emitUserUpdate(userId: String) {
        try {
            val json = api.get("/api/users/$userId")
            _userUpdates.tryEmit(User.fromMap(json.toMap(), userId))
        } catch (_: Exception) {
            // Best-effort: don't fail the parent operation if re-fetch fails
        }
    }

    private val profileVisibleFields = setOf(
        "displayName", "description", "nationality", "profilePhotoUrl",
        "coverPhotoUrl", "avatarUrl", "hideFollowing", "hideOnlineStatus", "hideAge"
    )

    override suspend fun createOrUpdateUser(user: User): Resource<Unit> = firebaseCall("Failed to create/update user") {
        val body = JSONObject()
        for ((k, v) in user.toMap()) {
            body.put(k, v ?: JSONObject.NULL)
        }
        api.post("/api/users", body)
        _userUpdates.tryEmit(user)
    }

    override suspend fun getUser(userId: String): Resource<User> = firebaseCall("Failed to get user") {
        val json = api.get("/api/users/$userId")
        User.fromMap(json.toMap(), userId)
    }

    override suspend fun userExists(userId: String): Resource<Boolean> = firebaseCall("Failed to check user existence") {
        val json = api.get("/api/users/$userId/exists")
        json.optBoolean("exists", false)
    }

    override suspend fun updateDisplayName(userId: String, displayName: String): Resource<Unit> = firebaseCall("Failed to update display name") {
        api.patch("/api/users/$userId", JSONObject().put("displayName", displayName))
        emitUserUpdate(userId)
    }

    override suspend fun updateAvatar(userId: String, avatarUrl: String): Resource<Unit> = firebaseCall("Failed to update avatar") {
        api.patch("/api/users/$userId", JSONObject().put("avatarUrl", avatarUrl))
        emitUserUpdate(userId)
    }

    override suspend fun updateLastSeen(userId: String): Resource<Unit> = firebaseCall("Failed to update last seen") {
        api.patch("/api/users/$userId", JSONObject().put("lastSeenAt", System.currentTimeMillis()))
    }

    override suspend fun updateProfile(userId: String, fields: Map<String, Any?>): Resource<Unit> = firebaseCall("Failed to update profile") {
        val body = JSONObject()
        for ((k, v) in fields) {
            body.put(k, v ?: JSONObject.NULL)
        }
        api.patch("/api/users/$userId", body)
        if (fields.keys.any { it in profileVisibleFields }) {
            emitUserUpdate(userId)
        }
    }

    override suspend fun generateUniqueId(userId: String): Resource<Long> = firebaseCall("Failed to generate unique ID") {
        val json = api.post("/api/users/$userId/unique-id")
        json.getLong("uniqueId")
    }

    override suspend fun blockUser(userId: String, blockedUserId: String): Resource<Unit> = firebaseCall("Failed to block user") {
        api.post("/api/users/$userId/block", JSONObject().put("blockedUserId", blockedUserId))
    }

    override suspend fun unblockUser(userId: String, blockedUserId: String): Resource<Unit> = firebaseCall("Failed to unblock user") {
        api.delete("/api/users/$userId/block/$blockedUserId")
    }

    override suspend fun getBlockedUserIds(userId: String): Resource<Set<String>> = firebaseCall("Failed to get blocked users") {
        val json = api.get("/api/users/$userId/blocked")
        val arr = json.optJSONArray("blockedUserIds") ?: JSONArray()
        (0 until arr.length()).map { arr.getString(it) }.toSet()
    }

    override suspend fun followUser(currentUserId: String, targetUserId: String): Resource<Unit> =
        firebaseCall("Failed to follow user") {
            api.post("/api/users/$currentUserId/follow", JSONObject().put("targetUserId", targetUserId))
        }

    override suspend fun unfollowUser(currentUserId: String, targetUserId: String): Resource<Unit> =
        firebaseCall("Failed to unfollow user") {
            api.delete("/api/users/$currentUserId/follow/$targetUserId")
        }

    override suspend fun removeFollower(userId: String, followerId: String): Resource<Unit> =
        firebaseCall("Failed to remove follower") {
            api.delete("/api/users/$userId/followers/$followerId")
        }

    override suspend fun getUsers(userIds: List<String>): Resource<List<User>> =
        firebaseCall("Failed to get users") {
            if (userIds.isEmpty()) return@firebaseCall emptyList()
            val body = JSONObject().put("uids", JSONArray(userIds))
            val arr = api.post("/api/users/batch", body).optJSONArray("users") ?: JSONArray()
            (0 until arr.length()).mapNotNull { i ->
                val obj = arr.getJSONObject(i)
                val uid = obj.optString("uid", "")
                if (uid.isNotEmpty()) User.fromMap(obj.toMap(), uid) else null
            }
        }

    override suspend fun recordProfileVisit(profileUserId: String, visitorId: String): Resource<Unit> =
        firebaseCall("Failed to record visit") {
            api.post("/api/users/$profileUserId/stalkers/visit", JSONObject().put("visitorId", visitorId))
        }

    override suspend fun getStalkers(profileUserId: String): Resource<List<ProfileVisitor>> =
        firebaseCall("Failed to load stalkers") {
            val arr = api.get("/api/users/$profileUserId/stalkers").optJSONArray("stalkers") ?: JSONArray()
            (0 until arr.length()).mapNotNull { i ->
                val obj = arr.getJSONObject(i)
                ProfileVisitor.fromMap(obj.toMap())
            }
        }

    override suspend fun markStalkersViewed(userId: String): Resource<Unit> =
        firebaseCall("Failed to mark stalkers viewed") {
            api.post("/api/users/$userId/stalkers/viewed")
        }

    override suspend fun submitSuspensionAppeal(userId: String, appealText: String): Resource<Unit> =
        firebaseCall("Failed to submit appeal") {
            api.post("/api/users/$userId/appeal", JSONObject().put("appealText", appealText))
        }

    override suspend fun liftExpiredSuspension(userId: String): Resource<Unit> =
        firebaseCall("Failed to lift expired suspension") {
            api.post("/api/users/$userId/lift-suspension")
        }

    override suspend fun getAliases(userId: String): Resource<Map<String, String>> =
        firebaseCall("Failed to get aliases") {
            val json = api.get("/api/users/$userId/aliases")
            val obj = json.optJSONObject("aliases") ?: JSONObject()
            val result = mutableMapOf<String, String>()
            obj.keys().forEach { key -> result[key] = obj.getString(key) }
            result
        }

    override suspend fun setAlias(userId: String, targetUserId: String, alias: String): Resource<Unit> =
        firebaseCall("Failed to set alias") {
            api.put("/api/users/$userId/aliases/$targetUserId", JSONObject().put("alias", alias))
        }

    override suspend fun removeAlias(userId: String, targetUserId: String): Resource<Unit> =
        firebaseCall("Failed to remove alias") {
            api.delete("/api/users/$userId/aliases/$targetUserId")
        }

    override fun observeUserFlags(userId: String): Flow<UserFlags> = flow {
        while (true) {
            try {
                val json = api.get("/api/users/$userId/flags")
                emit(UserFlags(
                    isSuspended = json.optBoolean("isSuspended", false),
                    suspensionEndDate = if (json.has("suspensionEndDate") && !json.isNull("suspensionEndDate")) json.getLong("suspensionEndDate") else null,
                    hasActiveWarning = json.optBoolean("hasActiveWarning", false),
                    warningReason = if (json.has("warningReason") && !json.isNull("warningReason")) json.getString("warningReason") else null
                ))
            } catch (_: Exception) {
                // Silently skip failed polls
            }
            delay(15_000) // Poll every 15 seconds
        }
    }

    override suspend fun acknowledgeWarning(userId: String): Resource<Unit> = firebaseCall("Failed to acknowledge warning") {
        api.post("/api/users/$userId/acknowledge-warning")
    }

    override suspend fun getWarningReason(userId: String): Resource<String?> = firebaseCall("Failed to get warning reason") {
        val json = api.get("/api/users/$userId/warning-reason")
        if (json.has("reason") && !json.isNull("reason")) json.getString("reason") else null
    }

    override fun observeUsers(userIds: Set<String>): Flow<User> {
        if (userIds.isEmpty()) return emptyFlow()
        return userIds.map { userId ->
            flow {
                while (true) {
                    try {
                        val json = api.get("/api/users/$userId")
                        emit(User.fromMap(json.toMap(), userId))
                    } catch (_: Exception) {
                        // Silently skip failed polls
                    }
                    delay(30_000) // Poll every 30 seconds
                }
            }
        }.merge()
    }
}
