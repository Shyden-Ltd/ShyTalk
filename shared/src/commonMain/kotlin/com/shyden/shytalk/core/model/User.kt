package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.millisToTimestamp
import com.shyden.shytalk.core.util.timestampToMillis

data class User(
    val uid: String = "",
    val displayName: String = "",
    val avatarUrl: String? = null,
    val profilePhotoUrl: String? = null,
    val coverPhotoUrl: String? = null,
    val description: String? = null,
    val nationality: String? = null,
    val uniqueId: Long = 0L,
    val blockedUserIds: Set<String> = emptySet(),
    val followingIds: Set<String> = emptySet(),
    val followerIds: Set<String> = emptySet(),
    val dateOfBirth: Long? = null,
    val hideFollowing: Boolean = false,
    val hideOnlineStatus: Boolean = false,
    val hideAge: Boolean = false,
    val email: String? = null,
    val currentRoomId: String? = null,
    val lastRoomName: String? = null,
    val createdAt: Long = currentTimeMillis(),
    val userType: UserType = UserType.MEMBER,
    val lastSeenAt: Long = currentTimeMillis(),
    val stalkerCount: Long = 0,
    val newStalkerCount: Long = 0,
    val stalkersLastViewedAt: Long = 0,
    val isSuspended: Boolean = false,
    val suspensionReason: String? = null,
    val suspensionStartDate: Long? = null,
    val suspensionEndDate: Long? = null,
    val suspensionCanAppeal: Boolean = false,
    val suspendedBy: String? = null,
    val suspensionAppealStatus: String? = null
) {
    val isActivelySuspended: Boolean
        get() {
            if (!isSuspended) return false
            val endDate = suspensionEndDate ?: return true // permanent
            return currentTimeMillis() < endDate
        }

    /** Resolved photo URL: prefers profilePhotoUrl, falls back to avatarUrl. */
    val photoUrl: String? get() = profilePhotoUrl ?: avatarUrl

    fun toMap(): Map<String, Any?> = mapOf(
        "uid" to uid,
        "displayName" to displayName,
        "avatarUrl" to avatarUrl,
        "profilePhotoUrl" to profilePhotoUrl,
        "coverPhotoUrl" to coverPhotoUrl,
        "description" to description,
        "nationality" to nationality,
        "uniqueId" to uniqueId,
        "blockedUserIds" to blockedUserIds.toList(),
        "followingIds" to followingIds.toList(),
        "followerIds" to followerIds.toList(),
        "dateOfBirth" to dateOfBirth?.let { millisToTimestamp(it) },
        "hideFollowing" to hideFollowing,
        "hideOnlineStatus" to hideOnlineStatus,
        "hideAge" to hideAge,
        "email" to email,
        "currentRoomId" to currentRoomId,
        "lastRoomName" to lastRoomName,
        "userType" to userType.name,
        "createdAt" to millisToTimestamp(createdAt),
        "lastSeenAt" to millisToTimestamp(lastSeenAt),
        "stalkerCount" to stalkerCount,
        "newStalkerCount" to newStalkerCount,
        "stalkersLastViewedAt" to millisToTimestamp(stalkersLastViewedAt),
        "isSuspended" to isSuspended,
        "suspensionReason" to suspensionReason,
        "suspensionStartDate" to suspensionStartDate?.let { millisToTimestamp(it) },
        "suspensionEndDate" to suspensionEndDate?.let { millisToTimestamp(it) },
        "suspensionCanAppeal" to suspensionCanAppeal,
        "suspendedBy" to suspendedBy,
        "suspensionAppealStatus" to suspensionAppealStatus
    )

    companion object {
        fun fromMap(map: Map<String, Any?>, uid: String): User = User(
            uid = uid,
            displayName = map["displayName"] as? String ?: "",
            avatarUrl = map["avatarUrl"] as? String,
            profilePhotoUrl = map["profilePhotoUrl"] as? String,
            coverPhotoUrl = map["coverPhotoUrl"] as? String,
            description = map["description"] as? String,
            nationality = map["nationality"] as? String,
            uniqueId = (map["uniqueId"] as? Long) ?: 0L,
            blockedUserIds = (map["blockedUserIds"] as? List<*>)
                ?.filterIsInstance<String>()?.toSet() ?: emptySet(),
            followingIds = (map["followingIds"] as? List<*>)
                ?.filterIsInstance<String>()?.toSet() ?: emptySet(),
            followerIds = (map["followerIds"] as? List<*>)
                ?.filterIsInstance<String>()?.toSet() ?: emptySet(),
            dateOfBirth = map["dateOfBirth"]?.let { timestampToMillis(it) },
            hideFollowing = map["hideFollowing"] as? Boolean ?: false,
            hideOnlineStatus = map["hideOnlineStatus"] as? Boolean ?: false,
            hideAge = map["hideAge"] as? Boolean ?: false,
            email = map["email"] as? String,
            currentRoomId = map["currentRoomId"] as? String,
            lastRoomName = map["lastRoomName"] as? String,
            userType = (map["userType"] as? String)?.let {
                try { UserType.valueOf(it) } catch (_: Exception) { UserType.MEMBER }
            } ?: UserType.MEMBER,
            createdAt = timestampToMillis(map["createdAt"]),
            lastSeenAt = timestampToMillis(map["lastSeenAt"]),
            stalkerCount = (map["stalkerCount"] as? Long) ?: 0,
            newStalkerCount = (map["newStalkerCount"] as? Long) ?: 0,
            stalkersLastViewedAt = map["stalkersLastViewedAt"]?.let { timestampToMillis(it) } ?: 0,
            isSuspended = map["isSuspended"] as? Boolean ?: false,
            suspensionReason = map["suspensionReason"] as? String,
            suspensionStartDate = map["suspensionStartDate"]?.let { timestampToMillis(it) },
            suspensionEndDate = map["suspensionEndDate"]?.let { timestampToMillis(it) },
            suspensionCanAppeal = map["suspensionCanAppeal"] as? Boolean ?: false,
            suspendedBy = map["suspendedBy"] as? String,
            suspensionAppealStatus = map["suspensionAppealStatus"] as? String
        )
    }
}
