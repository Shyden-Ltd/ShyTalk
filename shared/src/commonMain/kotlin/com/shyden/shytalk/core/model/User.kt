package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool
import com.shyden.shytalk.core.util.currentTimeMillis
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
    val firebaseUid: String = "",
    val providers: List<LinkedProvider> = emptyList(),
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
    // 0L sentinel so a default-constructed User() does NOT capture the
    // current timestamp at construction time. Default-constructing a User
    // and then writing it via UserRepository.createOrUpdateUser would
    // overwrite the server's authoritative createdAt/lastSeenAt with
    // wall-clock-at-construction. fromMap() populates these from the
    // Firestore doc; client-built User instances should always set the
    // field explicitly when the value matters.
    val createdAt: Long = 0L,
    val userType: UserType = UserType.MEMBER,
    val lastSeenAt: Long = 0L,
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
    val tempUniqueId: Long? = null,
    val tempUniqueIdExpiry: Long? = null,
    val luckScore: Int = 0,
    val pityCounter: Int = 0,
    val loginStreak: Int = 0,
    val lastLoginDate: String? = null,
    val lastLoginRewardDate: String? = null,
    val aliases: Map<String, String> = emptyMap(),
    val minGiftAnimationValue: Int = 0,
    val selfDestructAlertEnabled: Boolean = false,
    val hasClaimedSuperShyTrial: Boolean = false,
    val language: String = "en",
    // Account deletion
    val deletionScheduledAt: Long? = null,
    val deletionReason: String? = null,
    val deletionExecuteAt: Long? = null,
    // Age verification (Apple App Store 18+ enforcement on PMs + gacha).
    // Server-side only — Firestore rules block client write of these
    // three fields. `ageVerificationMethod` is one of "passport" /
    // "drivers-license" / "national-id" when set; null when unverified
    // (or when admin reverts a verification with a reason note).
    val ageVerified: Boolean = false,
    val ageVerifiedAt: Long? = null,
    val ageVerificationMethod: String? = null,
    /**
     * PM-lock flag (PR 11). Set true for users currently below 18; the
     * `conversations/{id}/messages/...` write+read paths gate on this.
     * Sub-18 user view: their conversation list and thread contents
     * are hidden. 18+ counter-party view: thread visible but input
     * disabled with the "this user cannot receive messages" copy.
     *
     * Set by the migration script (PR 11) for legacy 13-17 accounts,
     * by the modify-DOB handler when admin reverts a user to <18, and
     * cleared automatically by the auth login first-of-day check when
     * a previously-locked user has aged in.
     */
    val pmLocked: Boolean = false,
    /**
     * Day-of-year stamp (UTC ms at start of day) of the most recent
     * first-login auto-unlock check. Used to throttle the aging-in
     * scan to once per user per day — dormant accounts don't pay the
     * Firestore-quota cost, and active users don't pay it on every
     * launch.
     */
    val lastPmLockCheck: Long? = null,
    /**
     * Segregation cohort tag (UK OSA #17). One of "minor" (< 18) or
     * "adult" (>= 18). Server-only-write — Firestore rules deny
     * client writes to this field. Default is most-restrictive
     * "minor" so a legacy user doc missing the field surfaces as
     * the safer cohort; the first sign-in pm-lock-check writes the
     * correct value once we have a DOB. Spec:
     * `.project/plans/2026-05-13-age-segregation-design.md`.
     */
    val cohort: String = "minor",
    /**
     * Admin-set override of [cohort] (UK OSA #17). When non-null,
     * downstream enforcement reads `cohortOverride ?: cohort` — the
     * override wins for every interaction gate. Only settable on
     * accounts with `userType >= MODERATOR`; regular member accounts
     * get a 422 from the admin-users route. Audit-logged in the
     * same transaction as the write. Spec: see [cohort].
     */
    val cohortOverride: String? = null,
) {
    val isActivelySuspended: Boolean
        get() {
            if (!isSuspended) return false
            val endDate = suspensionEndDate ?: return true // permanent
            return currentTimeMillis() < endDate
        }

    /** Whether this account has a pending deletion. */
    val isPendingDeletion: Boolean
        get() = deletionScheduledAt != null && deletionExecuteAt != null

    /** Active (non-unlinked) providers only. */
    val activeProviders: List<LinkedProvider> get() = providers.filter { it.active }

    /** Whether this user has an active provider of the given type. */
    fun hasProvider(type: ProviderType): Boolean = activeProviders.any { it.type == type }

    /** Resolved photo URL: prefers profilePhotoUrl, falls back to avatarUrl. */
    val photoUrl: String? get() = profilePhotoUrl ?: avatarUrl

    /** Returns tempUniqueId if active, otherwise the real uniqueId. */
    val displayUniqueId: Long
        get() {
            if (tempUniqueId != null && tempUniqueIdExpiry != null && tempUniqueIdExpiry > currentTimeMillis()) {
                return tempUniqueId
            }
            return uniqueId
        }

    fun toMap(): Map<String, Any?> =
        mapOf(
            "uid" to uid,
            "displayName" to displayName,
            "avatarUrl" to avatarUrl,
            "profilePhotoUrl" to profilePhotoUrl,
            "coverPhotoUrl" to coverPhotoUrl,
            "description" to description,
            "nationality" to nationality,
            "uniqueId" to uniqueId,
            "firebaseUid" to firebaseUid,
            "providers" to providers.map { it.toMap() },
            "blockedUserIds" to blockedUserIds.toList(),
            "followingIds" to followingIds.toList(),
            "followerIds" to followerIds.toList(),
            "dateOfBirth" to dateOfBirth,
            "hideFollowing" to hideFollowing,
            "hideOnlineStatus" to hideOnlineStatus,
            "hideAge" to hideAge,
            "email" to email,
            "currentRoomId" to currentRoomId,
            "lastRoomName" to lastRoomName,
            "userType" to userType.name,
            "createdAt" to createdAt,
            "lastSeenAt" to lastSeenAt,
            "stalkerCount" to stalkerCount,
            "newStalkerCount" to newStalkerCount,
            "stalkersLastViewedAt" to stalkersLastViewedAt,
            "isSuspended" to isSuspended,
            "suspensionReason" to suspensionReason,
            "suspensionStartDate" to suspensionStartDate,
            "suspensionEndDate" to suspensionEndDate,
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
            "superShyExpiry" to superShyExpiry,
            "superShyTier" to superShyTier,
            "tempUniqueId" to tempUniqueId,
            "tempUniqueIdExpiry" to tempUniqueIdExpiry,
            "luckScore" to luckScore,
            "pityCounter" to pityCounter,
            "loginStreak" to loginStreak,
            "lastLoginDate" to lastLoginDate,
            "lastLoginRewardDate" to lastLoginRewardDate,
            "aliases" to aliases,
            "minGiftAnimationValue" to minGiftAnimationValue,
            "selfDestructAlertEnabled" to selfDestructAlertEnabled,
            "hasClaimedSuperShyTrial" to hasClaimedSuperShyTrial,
            "language" to language,
            "deletionScheduledAt" to deletionScheduledAt,
            "deletionReason" to deletionReason,
            "deletionExecuteAt" to deletionExecuteAt,
            "ageVerified" to ageVerified,
            "ageVerifiedAt" to ageVerifiedAt,
            "ageVerificationMethod" to ageVerificationMethod,
            "pmLocked" to pmLocked,
            "lastPmLockCheck" to lastPmLockCheck,
            "cohort" to cohort,
            "cohortOverride" to cohortOverride,
        )

    companion object {
        fun fromMap(
            map: Map<String, Any?>,
            uid: String,
        ): User =
            User(
                uid = uid,
                displayName = map["displayName"] as? String ?: "",
                avatarUrl = map["avatarUrl"] as? String,
                profilePhotoUrl = map["profilePhotoUrl"] as? String,
                coverPhotoUrl = map["coverPhotoUrl"] as? String,
                description = map["description"] as? String,
                nationality = map["nationality"] as? String,
                uniqueId = (map["uniqueId"] as? Number)?.toLong() ?: 0L,
                firebaseUid = map["firebaseUid"] as? String ?: "",
                providers =
                    (map["providers"] as? List<*>)
                        ?.filterIsInstance<Map<*, *>>()
                        ?.map {
                            @Suppress("UNCHECKED_CAST")
                            LinkedProvider.fromMap(it as Map<String, Any?>)
                        }
                        ?: emptyList(),
                blockedUserIds =
                    (map["blockedUserIds"] as? List<*>)
                        ?.filterIsInstance<String>()
                        ?.toSet() ?: emptySet(),
                followingIds =
                    (map["followingIds"] as? List<*>)
                        ?.filterIsInstance<String>()
                        ?.toSet() ?: emptySet(),
                followerIds =
                    (map["followerIds"] as? List<*>)
                        ?.filterIsInstance<String>()
                        ?.toSet() ?: emptySet(),
                dateOfBirth = (map["dateOfBirth"] ?: map["date_of_birth"])?.let { timestampToMillis(it) },
                hideFollowing = map["hideFollowing"].asBool(),
                hideOnlineStatus = map["hideOnlineStatus"].asBool(),
                hideAge = map["hideAge"].asBool(),
                email = map["email"] as? String,
                currentRoomId = map["currentRoomId"] as? String,
                lastRoomName = map["lastRoomName"] as? String,
                userType =
                    (map["userType"] as? String)?.let {
                        try {
                            UserType.valueOf(it)
                        } catch (_: Exception) {
                            UserType.MEMBER
                        }
                    } ?: UserType.MEMBER,
                createdAt = timestampToMillis(map["createdAt"]),
                lastSeenAt = timestampToMillis(map["lastSeenAt"]),
                stalkerCount = (map["stalkerCount"] as? Number)?.toLong() ?: 0,
                newStalkerCount = (map["newStalkerCount"] as? Number)?.toLong() ?: 0,
                stalkersLastViewedAt = map["stalkersLastViewedAt"]?.let { timestampToMillis(it) } ?: 0,
                isSuspended = map["isSuspended"].asBool(),
                suspensionReason = map["suspensionReason"] as? String,
                suspensionStartDate = map["suspensionStartDate"]?.let { timestampToMillis(it) },
                suspensionEndDate = map["suspensionEndDate"]?.let { timestampToMillis(it) },
                suspensionCanAppeal = map["suspensionCanAppeal"].asBool(),
                suspendedBy = map["suspendedBy"] as? String,
                suspensionAppealStatus = map["suspensionAppealStatus"] as? String,
                fcmTokens =
                    (map["fcmTokens"] as? List<*>)
                        ?.filterIsInstance<String>() ?: emptyList(),
                pmNotificationsEnabled = map["pmNotificationsEnabled"].asBool(true),
                pmPrivacy =
                    (map["pmPrivacy"] as? String)?.let {
                        try {
                            PmPrivacy.valueOf(it)
                        } catch (_: Exception) {
                            PmPrivacy.EVERYONE
                        }
                    } ?: PmPrivacy.EVERYONE,
                pmSoundEnabled = map["pmSoundEnabled"].asBool(true),
                pmShowTimestamps = map["pmShowTimestamps"].asBool(true),
                pmShowDateSeparators = map["pmShowDateSeparators"].asBool(true),
                pmNotificationPreview = map["pmNotificationPreview"].asBool(true),
                acceptedLegalVersion = (map["acceptedLegalVersion"] as? Number)?.toInt() ?: 0,
                dndEnabled = map["dndEnabled"].asBool(),
                dndStartHour = (map["dndStartHour"] as? Number)?.toInt() ?: 22,
                dndStartMinute = (map["dndStartMinute"] as? Number)?.toInt() ?: 0,
                dndEndHour = (map["dndEndHour"] as? Number)?.toInt() ?: 8,
                dndEndMinute = (map["dndEndMinute"] as? Number)?.toInt() ?: 0,
                shyCoins = (map["shyCoins"] as? Number)?.toLong() ?: 0,
                shyBeans = (map["shyBeans"] as? Number)?.toLong() ?: 0,
                isSuperShy = map["isSuperShy"].asBool(),
                superShyExpiry = map["superShyExpiry"]?.let { timestampToMillis(it) },
                superShyTier = map["superShyTier"] as? String,
                tempUniqueId = (map["tempUniqueId"] as? Number)?.toLong(),
                tempUniqueIdExpiry = map["tempUniqueIdExpiry"]?.let { timestampToMillis(it) },
                luckScore = (map["luckScore"] as? Number)?.toInt() ?: 0,
                pityCounter = (map["pityCounter"] as? Number)?.toInt() ?: 0,
                loginStreak = (map["loginStreak"] as? Number)?.toInt() ?: 0,
                lastLoginDate = map["lastLoginDate"] as? String,
                lastLoginRewardDate = map["lastLoginRewardDate"] as? String,
                aliases =
                    (map["aliases"] as? Map<*, *>)
                        ?.entries
                        ?.mapNotNull { (k, v) -> (k as? String)?.let { key -> (v as? String)?.let { value -> key to value } } }
                        ?.toMap() ?: emptyMap(),
                minGiftAnimationValue = (map["minGiftAnimationValue"] as? Number)?.toInt() ?: 0,
                selfDestructAlertEnabled = map["selfDestructAlertEnabled"].asBool(),
                hasClaimedSuperShyTrial = map["hasClaimedSuperShyTrial"].asBool(),
                language = map["language"] as? String ?: "en",
                deletionScheduledAt = map["deletionScheduledAt"]?.let { timestampToMillis(it) },
                deletionReason = map["deletionReason"] as? String,
                deletionExecuteAt = map["deletionExecuteAt"]?.let { timestampToMillis(it) },
                ageVerified = map["ageVerified"].asBool(),
                ageVerifiedAt = map["ageVerifiedAt"]?.let { timestampToMillis(it) },
                ageVerificationMethod = map["ageVerificationMethod"] as? String,
                pmLocked = map["pmLocked"].asBool(),
                lastPmLockCheck = map["lastPmLockCheck"]?.let { timestampToMillis(it) },
                cohort = map["cohort"] as? String ?: "minor",
                cohortOverride = map["cohortOverride"] as? String,
            )
    }
}
