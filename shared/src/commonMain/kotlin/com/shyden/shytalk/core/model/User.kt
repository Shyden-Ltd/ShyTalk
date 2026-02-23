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
    val suspensionAppealStatus: String? = null,
    // Private messaging
    val fcmTokens: List<String> = emptyList(),
    val pmNotificationsEnabled: Boolean = true,
    val pmPrivacy: PmPrivacy = PmPrivacy.EVERYONE,
    val pmSoundEnabled: Boolean = true,
    val pmShowTimestamps: Boolean = true,
    val pmShowDateSeparators: Boolean = true,
    val pmNotificationPreview: Boolean = true,
    val acceptedLegalVersion: Int = 0,
    // Do Not Disturb
    val dndEnabled: Boolean = false,
    val dndStartHour: Int = 22,
    val dndStartMinute: Int = 0,
    val dndEndHour: Int = 8,
    val dndEndMinute: Int = 0,
    // Monetization
    val shyCoins: Long = 0,
    val shyBeans: Long = 0,
    val isSuperShy: Boolean = false,
    val superShyExpiry: Long? = null,
    val superShyTier: String? = null,
    val luckScore: Int = 0,
    val pityCounter: Int = 0,
    val loginStreak: Int = 0,
    val lastLoginDate: String? = null,
    val lastLoginRewardDate: String? = null,
    val aliases: Map<String, String> = emptyMap(),
    val minGiftAnimationValue: Int = 0,
    val hasClaimedSuperShyTrial: Boolean = false
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
        "suspensionAppealStatus" to suspensionAppealStatus,
        "fcmTokens" to fcmTokens,
        "pmNotificationsEnabled" to pmNotificationsEnabled,
        "pmPrivacy" to pmPrivacy.name,
        "pmSoundEnabled" to pmSoundEnabled,
        "pmShowTimestamps" to pmShowTimestamps,
        "pmShowDateSeparators" to pmShowDateSeparators,
        "pmNotificationPreview" to pmNotificationPreview,
        "acceptedLegalVersion" to acceptedLegalVersion,
        "dndEnabled" to dndEnabled,
        "dndStartHour" to dndStartHour,
        "dndStartMinute" to dndStartMinute,
        "dndEndHour" to dndEndHour,
        "dndEndMinute" to dndEndMinute,
        "shyCoins" to shyCoins,
        "shyBeans" to shyBeans,
        "isSuperShy" to isSuperShy,
        "superShyExpiry" to superShyExpiry?.let { millisToTimestamp(it) },
        "superShyTier" to superShyTier,
        "luckScore" to luckScore,
        "pityCounter" to pityCounter,
        "loginStreak" to loginStreak,
        "lastLoginDate" to lastLoginDate,
        "lastLoginRewardDate" to lastLoginRewardDate,
        "aliases" to aliases,
        "minGiftAnimationValue" to minGiftAnimationValue,
        "hasClaimedSuperShyTrial" to hasClaimedSuperShyTrial
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
            suspensionAppealStatus = map["suspensionAppealStatus"] as? String,
            fcmTokens = (map["fcmTokens"] as? List<*>)
                ?.filterIsInstance<String>() ?: emptyList(),
            pmNotificationsEnabled = map["pmNotificationsEnabled"] as? Boolean ?: true,
            pmPrivacy = (map["pmPrivacy"] as? String)?.let {
                try { PmPrivacy.valueOf(it) } catch (_: Exception) { PmPrivacy.EVERYONE }
            } ?: PmPrivacy.EVERYONE,
            pmSoundEnabled = map["pmSoundEnabled"] as? Boolean ?: true,
            pmShowTimestamps = map["pmShowTimestamps"] as? Boolean ?: true,
            pmShowDateSeparators = map["pmShowDateSeparators"] as? Boolean ?: true,
            pmNotificationPreview = map["pmNotificationPreview"] as? Boolean ?: true,
            acceptedLegalVersion = (map["acceptedLegalVersion"] as? Long)?.toInt() ?: 0,
            dndEnabled = map["dndEnabled"] as? Boolean ?: false,
            dndStartHour = (map["dndStartHour"] as? Long)?.toInt() ?: 22,
            dndStartMinute = (map["dndStartMinute"] as? Long)?.toInt() ?: 0,
            dndEndHour = (map["dndEndHour"] as? Long)?.toInt() ?: 8,
            dndEndMinute = (map["dndEndMinute"] as? Long)?.toInt() ?: 0,
            shyCoins = (map["shyCoins"] as? Long) ?: 0,
            shyBeans = (map["shyBeans"] as? Long) ?: 0,
            isSuperShy = map["isSuperShy"] as? Boolean ?: false,
            superShyExpiry = map["superShyExpiry"]?.let { timestampToMillis(it) },
            superShyTier = map["superShyTier"] as? String,
            luckScore = (map["luckScore"] as? Long)?.toInt() ?: 0,
            pityCounter = (map["pityCounter"] as? Long)?.toInt() ?: 0,
            loginStreak = (map["loginStreak"] as? Long)?.toInt() ?: 0,
            lastLoginDate = map["lastLoginDate"] as? String,
            lastLoginRewardDate = map["lastLoginRewardDate"] as? String,
            aliases = (map["aliases"] as? Map<*, *>)
                ?.entries
                ?.mapNotNull { (k, v) -> (k as? String)?.let { key -> (v as? String)?.let { value -> key to value } } }
                ?.toMap() ?: emptyMap(),
            minGiftAnimationValue = (map["minGiftAnimationValue"] as? Long)?.toInt() ?: 0,
            hasClaimedSuperShyTrial = map["hasClaimedSuperShyTrial"] as? Boolean ?: false
        )
    }
}
