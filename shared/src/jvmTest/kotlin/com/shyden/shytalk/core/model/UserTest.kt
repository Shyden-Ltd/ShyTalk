package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.currentTimeMillis
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UserTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses basic fields`() {
        val map =
            mapOf<String, Any?>(
                "displayName" to "Alice",
                "avatarUrl" to "https://avatar.png",
                "profilePhotoUrl" to "https://profile.png",
                "coverPhotoUrl" to "https://cover.png",
                "description" to "Hello world",
                "nationality" to "US",
                "uniqueId" to 10000001L,
                "firebaseUid" to "firebase-uid-1",
                "email" to "alice@example.com",
                "userType" to "MEMBER",
                "createdAt" to 1705326600000L,
                "lastSeenAt" to 1705326700000L,
                "language" to "en",
            )

        val user = User.fromMap(map, "10000001")

        assertEquals("10000001", user.uid)
        assertEquals("Alice", user.displayName)
        assertEquals("https://avatar.png", user.avatarUrl)
        assertEquals("https://profile.png", user.profilePhotoUrl)
        assertEquals("https://cover.png", user.coverPhotoUrl)
        assertEquals("Hello world", user.description)
        assertEquals("US", user.nationality)
        assertEquals(10000001L, user.uniqueId)
        assertEquals("firebase-uid-1", user.firebaseUid)
        assertEquals("alice@example.com", user.email)
        assertEquals(UserType.MEMBER, user.userType)
        assertEquals(1705326600000L, user.createdAt)
        assertEquals(1705326700000L, user.lastSeenAt)
        assertEquals("en", user.language)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val user = User.fromMap(emptyMap(), "u1")

        assertEquals("u1", user.uid)
        assertEquals("", user.displayName)
        assertNull(user.avatarUrl)
        assertNull(user.profilePhotoUrl)
        assertNull(user.coverPhotoUrl)
        assertNull(user.description)
        assertNull(user.nationality)
        assertEquals(0L, user.uniqueId)
        assertEquals("", user.firebaseUid)
        assertEquals(emptyList(), user.providers)
        assertEquals(emptySet(), user.blockedUserIds)
        assertEquals(emptySet(), user.followingIds)
        assertEquals(emptySet(), user.followerIds)
        assertNull(user.dateOfBirth)
        assertFalse(user.hideFollowing)
        assertFalse(user.hideOnlineStatus)
        assertFalse(user.hideAge)
        assertNull(user.email)
        assertNull(user.currentRoomId)
        assertNull(user.lastRoomName)
        assertEquals(UserType.MEMBER, user.userType)
        assertEquals(0L, user.stalkerCount)
        assertEquals(0L, user.newStalkerCount)
        assertFalse(user.isSuspended)
        assertNull(user.suspensionReason)
        assertEquals(emptyList(), user.fcmTokens)
        assertTrue(user.pmNotificationsEnabled)
        assertEquals(PmPrivacy.EVERYONE, user.pmPrivacy)
        assertEquals(0, user.acceptedLegalVersion)
        assertFalse(user.dndEnabled)
        assertEquals(22, user.dndStartHour)
        assertEquals(0, user.dndStartMinute)
        assertEquals(8, user.dndEndHour)
        assertEquals(0, user.dndEndMinute)
        assertEquals(0L, user.shyCoins)
        assertEquals(0L, user.shyBeans)
        assertFalse(user.isSuperShy)
        assertEquals(0, user.luckScore)
        assertEquals(0, user.pityCounter)
        assertEquals(0, user.loginStreak)
        assertEquals(emptyMap(), user.aliases)
        assertEquals(0, user.minGiftAnimationValue)
        assertFalse(user.selfDestructAlertEnabled)
        assertFalse(user.hasClaimedSuperShyTrial)
        assertEquals("en", user.language)
    }

    // ── UserType parsing ────────────────────────────────────────────

    @Test
    fun `fromMap parses SHYTALK_OFFICIAL type`() {
        val map = mapOf<String, Any?>("userType" to "SHYTALK_OFFICIAL")
        val user = User.fromMap(map, "u1")
        assertEquals(UserType.SHYTALK_OFFICIAL, user.userType)
    }

    @Test
    fun `fromMap parses MC_SINGER type`() {
        val map = mapOf<String, Any?>("userType" to "MC_SINGER")
        val user = User.fromMap(map, "u1")
        assertEquals(UserType.MC_SINGER, user.userType)
    }

    @Test
    fun `fromMap defaults to MEMBER for unknown userType`() {
        val map = mapOf<String, Any?>("userType" to "UNKNOWN")
        val user = User.fromMap(map, "u1")
        assertEquals(UserType.MEMBER, user.userType)
    }

    // ── PmPrivacy parsing ───────────────────────────────────────────

    @Test
    fun `fromMap parses FOLLOWERS_ONLY pmPrivacy`() {
        val map = mapOf<String, Any?>("pmPrivacy" to "FOLLOWERS_ONLY")
        val user = User.fromMap(map, "u1")
        assertEquals(PmPrivacy.FOLLOWERS_ONLY, user.pmPrivacy)
    }

    @Test
    fun `fromMap parses NO_ONE pmPrivacy`() {
        val map = mapOf<String, Any?>("pmPrivacy" to "NO_ONE")
        val user = User.fromMap(map, "u1")
        assertEquals(PmPrivacy.NO_ONE, user.pmPrivacy)
    }

    @Test
    fun `fromMap defaults to EVERYONE for unknown pmPrivacy`() {
        val map = mapOf<String, Any?>("pmPrivacy" to "INVALID")
        val user = User.fromMap(map, "u1")
        assertEquals(PmPrivacy.EVERYONE, user.pmPrivacy)
    }

    // ── Boolean fields with asBool ──────────────────────────────────

    @Test
    fun `fromMap handles integer booleans for hide fields`() {
        val map =
            mapOf<String, Any?>(
                "hideFollowing" to 1,
                "hideOnlineStatus" to 0,
                "hideAge" to 1,
            )

        val user = User.fromMap(map, "u1")

        assertTrue(user.hideFollowing)
        assertFalse(user.hideOnlineStatus)
        assertTrue(user.hideAge)
    }

    @Test
    fun `fromMap handles integer booleans for suspension fields`() {
        val map =
            mapOf<String, Any?>(
                "isSuspended" to 1,
                "suspensionCanAppeal" to 0,
            )

        val user = User.fromMap(map, "u1")

        assertTrue(user.isSuspended)
        assertFalse(user.suspensionCanAppeal)
    }

    @Test
    fun `fromMap handles integer booleans for PM settings`() {
        val map =
            mapOf<String, Any?>(
                "pmNotificationsEnabled" to 0,
                "pmSoundEnabled" to 0,
                "pmShowTimestamps" to 0,
                "pmShowDateSeparators" to 0,
                "pmNotificationPreview" to 0,
            )

        val user = User.fromMap(map, "u1")

        assertFalse(user.pmNotificationsEnabled)
        assertFalse(user.pmSoundEnabled)
        assertFalse(user.pmShowTimestamps)
        assertFalse(user.pmShowDateSeparators)
        assertFalse(user.pmNotificationPreview)
    }

    // ── dateOfBirth fallback ────────────────────────────────────────

    @Test
    fun `fromMap parses dateOfBirth`() {
        val map = mapOf<String, Any?>("dateOfBirth" to 631152000000L)
        val user = User.fromMap(map, "u1")
        assertEquals(631152000000L, user.dateOfBirth)
    }

    @Test
    fun `fromMap falls back to date_of_birth field`() {
        val map = mapOf<String, Any?>("date_of_birth" to 631152000000L)
        val user = User.fromMap(map, "u1")
        assertEquals(631152000000L, user.dateOfBirth)
    }

    // ── aliases parsing ─────────────────────────────────────────────

    @Test
    fun `fromMap parses aliases`() {
        val map =
            mapOf<String, Any?>(
                "aliases" to mapOf("user-2" to "Bob Alias", "user-3" to "Charlie Alias"),
            )

        val user = User.fromMap(map, "u1")

        assertEquals(2, user.aliases.size)
        assertEquals("Bob Alias", user.aliases["user-2"])
        assertEquals("Charlie Alias", user.aliases["user-3"])
    }

    @Test
    fun `fromMap handles empty aliases`() {
        val map = mapOf<String, Any?>("aliases" to emptyMap<String, Any>())
        val user = User.fromMap(map, "u1")
        assertTrue(user.aliases.isEmpty())
    }

    // ── Computed properties ─────────────────────────────────────────

    @Test
    fun `isActivelySuspended returns false when not suspended`() {
        val user = User(isSuspended = false)
        assertFalse(user.isActivelySuspended)
    }

    @Test
    fun `isActivelySuspended returns true for permanent suspension`() {
        val user = User(isSuspended = true, suspensionEndDate = null)
        assertTrue(user.isActivelySuspended)
    }

    @Test
    fun `isActivelySuspended returns true when endDate is in the future`() {
        val user =
            User(
                isSuspended = true,
                suspensionEndDate = currentTimeMillis() + 60_000,
            )
        assertTrue(user.isActivelySuspended)
    }

    @Test
    fun `isActivelySuspended returns false when endDate is in the past`() {
        val user =
            User(
                isSuspended = true,
                suspensionEndDate = currentTimeMillis() - 60_000,
            )
        assertFalse(user.isActivelySuspended)
    }

    @Test
    fun `photoUrl prefers profilePhotoUrl`() {
        val user = User(profilePhotoUrl = "profile.png", avatarUrl = "avatar.png")
        assertEquals("profile.png", user.photoUrl)
    }

    @Test
    fun `photoUrl falls back to avatarUrl`() {
        val user = User(profilePhotoUrl = null, avatarUrl = "avatar.png")
        assertEquals("avatar.png", user.photoUrl)
    }

    @Test
    fun `photoUrl returns null when both are null`() {
        val user = User(profilePhotoUrl = null, avatarUrl = null)
        assertNull(user.photoUrl)
    }

    @Test
    fun `displayUniqueId returns tempUniqueId when active`() {
        val user =
            User(
                uniqueId = 10000001,
                tempUniqueId = 99999999,
                tempUniqueIdExpiry = currentTimeMillis() + 60_000,
            )
        assertEquals(99999999L, user.displayUniqueId)
    }

    @Test
    fun `displayUniqueId returns real uniqueId when temp is expired`() {
        val user =
            User(
                uniqueId = 10000001,
                tempUniqueId = 99999999,
                tempUniqueIdExpiry = currentTimeMillis() - 60_000,
            )
        assertEquals(10000001L, user.displayUniqueId)
    }

    @Test
    fun `displayUniqueId returns real uniqueId when tempUniqueId is null`() {
        val user = User(uniqueId = 10000001, tempUniqueId = null)
        assertEquals(10000001L, user.displayUniqueId)
    }

    @Test
    fun `displayUniqueId returns real uniqueId when tempUniqueIdExpiry is null`() {
        val user =
            User(
                uniqueId = 10000001,
                tempUniqueId = 99999999,
                tempUniqueIdExpiry = null,
            )
        assertEquals(10000001L, user.displayUniqueId)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes key fields`() {
        val user =
            User(
                uid = "u1",
                displayName = "Alice",
                uniqueId = 10000001L,
                userType = UserType.SHYTALK_OFFICIAL,
                shyCoins = 500,
                shyBeans = 100,
                language = "ko",
            )

        val map = user.toMap()

        assertEquals("u1", map["uid"])
        assertEquals("Alice", map["displayName"])
        assertEquals(10000001L, map["uniqueId"])
        assertEquals("SHYTALK_OFFICIAL", map["userType"])
        assertEquals(500L, map["shyCoins"])
        assertEquals(100L, map["shyBeans"])
        assertEquals("ko", map["language"])
    }

    @Test
    fun `toMap serializes pmPrivacy as string`() {
        val user = User(pmPrivacy = PmPrivacy.NO_ONE)
        val map = user.toMap()
        assertEquals("NO_ONE", map["pmPrivacy"])
    }

    @Test
    fun `toMap includes suspension fields`() {
        val user =
            User(
                isSuspended = true,
                suspensionReason = "Spam",
                suspensionStartDate = 1705326600000L,
                suspensionEndDate = 1705413000000L,
                suspensionCanAppeal = true,
                suspendedBy = "admin-1",
                suspensionAppealStatus = "pending",
            )

        val map = user.toMap()

        assertEquals(true, map["isSuspended"])
        assertEquals("Spam", map["suspensionReason"])
        assertEquals(1705326600000L, map["suspensionStartDate"])
        assertEquals(1705413000000L, map["suspensionEndDate"])
        assertEquals(true, map["suspensionCanAppeal"])
        assertEquals("admin-1", map["suspendedBy"])
        assertEquals("pending", map["suspensionAppealStatus"])
    }

    @Test
    fun `toMap includes DND fields`() {
        val user =
            User(
                dndEnabled = true,
                dndStartHour = 23,
                dndStartMinute = 30,
                dndEndHour = 7,
                dndEndMinute = 0,
            )

        val map = user.toMap()

        assertEquals(true, map["dndEnabled"])
        assertEquals(23, map["dndStartHour"])
        assertEquals(30, map["dndStartMinute"])
        assertEquals(7, map["dndEndHour"])
        assertEquals(0, map["dndEndMinute"])
    }

    // ── UserType enum ───────────────────────────────────────────────

    @Test
    fun `UserType has expected values`() {
        val types = UserType.entries
        assertEquals(5, types.size)
        assertTrue(UserType.MEMBER in types)
        assertTrue(UserType.SHYTALK_OFFICIAL in types)
        assertTrue(UserType.MC_SINGER in types)
        assertTrue(UserType.MC_EVENT_HOST in types)
        assertTrue(UserType.TEACHER in types)
    }

    // ── PmPrivacy enum ──────────────────────────────────────────────

    @Test
    fun `PmPrivacy has expected values`() {
        val privacies = PmPrivacy.entries
        assertEquals(3, privacies.size)
        assertTrue(PmPrivacy.EVERYONE in privacies)
        assertTrue(PmPrivacy.FOLLOWERS_ONLY in privacies)
        assertTrue(PmPrivacy.NO_ONE in privacies)
    }

    // ── fcmTokens parsing ───────────────────────────────────────────

    @Test
    fun `fromMap parses fcmTokens`() {
        val map = mapOf<String, Any?>("fcmTokens" to listOf("token1", "token2"))
        val user = User.fromMap(map, "u1")
        assertEquals(listOf("token1", "token2"), user.fcmTokens)
    }

    @Test
    fun `fromMap handles missing fcmTokens`() {
        val user = User.fromMap(emptyMap(), "u1")
        assertEquals(emptyList(), user.fcmTokens)
    }

    // ── Number type handling ────────────────────────────────────────

    @Test
    fun `fromMap handles Int for uniqueId`() {
        val map = mapOf<String, Any?>("uniqueId" to 10000001)
        val user = User.fromMap(map, "u1")
        assertEquals(10000001L, user.uniqueId)
    }

    @Test
    fun `fromMap handles Double for shyCoins`() {
        val map = mapOf<String, Any?>("shyCoins" to 500.0)
        val user = User.fromMap(map, "u1")
        assertEquals(500L, user.shyCoins)
    }

    @Test
    fun `fromMap handles Int for acceptedLegalVersion`() {
        val map = mapOf<String, Any?>("acceptedLegalVersion" to 3)
        val user = User.fromMap(map, "u1")
        assertEquals(3, user.acceptedLegalVersion)
    }

    @Test
    fun `fromMap handles Long for acceptedLegalVersion`() {
        val map = mapOf<String, Any?>("acceptedLegalVersion" to 3L)
        val user = User.fromMap(map, "u1")
        assertEquals(3, user.acceptedLegalVersion)
    }

    // ── Account deletion fields ────────────────────────────────────

    @Test
    fun `default deletion fields are null`() {
        val user = User()
        assertNull(user.deletionScheduledAt)
        assertNull(user.deletionReason)
        assertNull(user.deletionExecuteAt)
        assertFalse(user.isPendingDeletion)
    }

    @Test
    fun `isPendingDeletion is true when both timestamps are set`() {
        val user =
            User(
                deletionScheduledAt = 1705326600000L,
                deletionReason = "self",
                deletionExecuteAt = 1705326600000L + 30 * 86400000L,
            )
        assertTrue(user.isPendingDeletion)
    }

    @Test
    fun `isPendingDeletion is false when only scheduledAt is set`() {
        val user = User(deletionScheduledAt = 1705326600000L)
        assertFalse(user.isPendingDeletion)
    }

    @Test
    fun `fromMap parses deletion fields`() {
        val map =
            mapOf<String, Any?>(
                "deletionScheduledAt" to 1705326600000L,
                "deletionReason" to "self",
                "deletionExecuteAt" to 1707918600000L,
            )
        val user = User.fromMap(map, "u1")
        assertEquals(1705326600000L, user.deletionScheduledAt)
        assertEquals("self", user.deletionReason)
        assertEquals(1707918600000L, user.deletionExecuteAt)
    }

    @Test
    fun `fromMap handles null deletion fields`() {
        val map =
            mapOf<String, Any?>(
                "deletionScheduledAt" to null,
                "deletionReason" to null,
                "deletionExecuteAt" to null,
            )
        val user = User.fromMap(map, "u1")
        assertNull(user.deletionScheduledAt)
        assertNull(user.deletionReason)
        assertNull(user.deletionExecuteAt)
    }

    @Test
    fun `fromMap handles missing deletion fields`() {
        val map = emptyMap<String, Any?>()
        val user = User.fromMap(map, "u1")
        assertNull(user.deletionScheduledAt)
        assertNull(user.deletionReason)
        assertNull(user.deletionExecuteAt)
    }

    @Test
    fun `toMap includes deletion fields`() {
        val user =
            User(
                deletionScheduledAt = 1705326600000L,
                deletionReason = "admin",
                deletionExecuteAt = 1707918600000L,
            )
        val map = user.toMap()
        assertEquals(1705326600000L, map["deletionScheduledAt"])
        assertEquals("admin", map["deletionReason"])
        assertEquals(1707918600000L, map["deletionExecuteAt"])
    }

    @Test
    fun `toMap includes null deletion fields`() {
        val user = User()
        val map = user.toMap()
        assertNull(map["deletionScheduledAt"])
        assertNull(map["deletionReason"])
        assertNull(map["deletionExecuteAt"])
    }

    @Test
    fun `deletion reason can be self, admin, or inactivity`() {
        listOf("self", "admin", "inactivity").forEach { reason ->
            val user =
                User(
                    deletionScheduledAt = currentTimeMillis(),
                    deletionReason = reason,
                    deletionExecuteAt = currentTimeMillis() + 86400000L,
                )
            assertEquals(reason, user.deletionReason)
            assertTrue(user.isPendingDeletion)
        }
    }
}
