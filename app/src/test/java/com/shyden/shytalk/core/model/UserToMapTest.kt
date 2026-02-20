package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import com.shyden.shytalk.testutil.TestData
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Date

class UserToMapTest {

    @Test
    fun `toMap contains all fields`() {
        val user = TestData.createTestUser(
            uid = "u1",
            displayName = "Alice",
            blockedUserIds = setOf("b1", "b2"),
            profilePhotoUrl = "https://example.com/photo.jpg",
            coverPhotoUrl = "https://example.com/cover.jpg",
            uniqueId = 99999L
        )
        val map = user.toMap()

        assertEquals("u1", map["uid"])
        assertEquals("Alice", map["displayName"])
        assertEquals(listOf("b1", "b2"), map["blockedUserIds"])
        assertEquals("https://example.com/photo.jpg", map["profilePhotoUrl"])
        assertEquals("https://example.com/cover.jpg", map["coverPhotoUrl"])
        assertEquals(99999L, map["uniqueId"])
    }

    @Test
    fun `toMap includes null optional fields`() {
        val user = User(
            uid = "u1",
            displayName = "Bob",
            createdAt = TestData.BASE_TIMESTAMP,
            lastSeenAt = TestData.BASE_TIMESTAMP
        )
        val map = user.toMap()

        assertNull(map["avatarUrl"])
        assertNull(map["profilePhotoUrl"])
        assertNull(map["coverPhotoUrl"])
        assertNull(map["description"])
        assertNull(map["nationality"])
        assertNull(map["email"])
    }

    @Test
    fun `toMap preserves timestamp values`() {
        val millis = 1_500_000_000_000L
        val expectedTs = Timestamp(Date(millis))
        val user = User(uid = "u1", displayName = "X", createdAt = millis, lastSeenAt = millis)
        val map = user.toMap()

        assertEquals(expectedTs, map["createdAt"])
        assertEquals(expectedTs, map["lastSeenAt"])
    }

    @Test
    fun `toMap serializes empty blocked list`() {
        val user = TestData.createTestUser(blockedUserIds = emptySet())
        val map = user.toMap()
        assertEquals(emptyList<String>(), map["blockedUserIds"])
    }

    @Test
    fun `toMap contains exactly 44 keys`() {
        val user = TestData.createTestUser()
        val map = user.toMap()
        assertEquals(54, map.size)
    }

    @Test
    fun `toMap keys match expected field names`() {
        val expectedKeys = setOf(
            "uid", "displayName", "avatarUrl", "profilePhotoUrl", "coverPhotoUrl",
            "description", "nationality", "uniqueId", "blockedUserIds",
            "followingIds", "followerIds", "dateOfBirth", "hideFollowing",
            "hideOnlineStatus", "hideAge", "email",
            "currentRoomId", "lastRoomName", "userType", "createdAt", "lastSeenAt",
            "stalkerCount", "newStalkerCount", "stalkersLastViewedAt",
            "isSuspended", "suspensionReason", "suspensionStartDate",
            "suspensionEndDate", "suspensionCanAppeal", "suspendedBy",
            "suspensionAppealStatus",
            "fcmTokens", "pmNotificationsEnabled", "pmPrivacy",
            "pmSoundEnabled", "pmShowTimestamps", "pmShowDateSeparators",
            "pmNotificationPreview", "acceptedLegalVersion",
            "dndEnabled", "dndStartHour", "dndStartMinute",
            "dndEndHour", "dndEndMinute",
            "shyCoins", "shyBeans", "isSuperShy", "superShyExpiry", "superShyTier",
            "luckScore", "pityCounter", "loginStreak", "lastLoginDate", "lastLoginRewardDate"
        )
        val user = TestData.createTestUser()
        assertEquals(expectedKeys, user.toMap().keys)
    }

    @Test
    fun `toMap includes privacy fields`() {
        val user = User(hideFollowing = true, hideOnlineStatus = true, hideAge = true)
        val map = user.toMap()
        assertEquals(true, map["hideFollowing"])
        assertEquals(true, map["hideOnlineStatus"])
        assertEquals(true, map["hideAge"])
    }

    @Test
    fun `toMap defaults privacy fields to false`() {
        val user = User()
        val map = user.toMap()
        assertEquals(false, map["hideFollowing"])
        assertEquals(false, map["hideOnlineStatus"])
        assertEquals(false, map["hideAge"])
    }

    @Test
    fun `toMap includes dateOfBirth when set`() {
        val dobMillis = 946684800000L // 2000-01-01
        val expectedTs = Timestamp(Date(dobMillis))
        val user = User(dateOfBirth = dobMillis)
        val map = user.toMap()
        assertEquals(expectedTs, map["dateOfBirth"])
    }

    @Test
    fun `toMap includes null dateOfBirth when not set`() {
        val user = User()
        val map = user.toMap()
        assertNull(map["dateOfBirth"])
    }

    @Test
    fun `default constructor has expected defaults`() {
        val user = User()
        assertEquals("", user.uid)
        assertEquals("", user.displayName)
        assertNull(user.avatarUrl)
        assertNull(user.profilePhotoUrl)
        assertNull(user.coverPhotoUrl)
        assertNull(user.description)
        assertNull(user.nationality)
        assertEquals(0L, user.uniqueId)
        assertEquals(emptySet<String>(), user.blockedUserIds)
        assertNull(user.dateOfBirth)
        assertEquals(false, user.hideFollowing)
        assertEquals(false, user.hideOnlineStatus)
        assertEquals(false, user.hideAge)
        assertNull(user.email)
        assertEquals(0L, user.stalkerCount)
        assertEquals(0L, user.newStalkerCount)
        assertEquals(0L, user.stalkersLastViewedAt)
        assertEquals(false, user.isSuspended)
        assertNull(user.suspensionReason)
        assertNull(user.suspensionStartDate)
        assertNull(user.suspensionEndDate)
        assertEquals(false, user.suspensionCanAppeal)
        assertNull(user.suspendedBy)
        assertNull(user.suspensionAppealStatus)
    }

    @Test
    fun `toMap includes stalker fields`() {
        val user = User(stalkerCount = 5, newStalkerCount = 2, stalkersLastViewedAt = TestData.BASE_TIMESTAMP)
        val map = user.toMap()
        assertEquals(5L, map["stalkerCount"])
        assertEquals(2L, map["newStalkerCount"])
        assertEquals(Timestamp(Date(TestData.BASE_TIMESTAMP)), map["stalkersLastViewedAt"])
    }

    @Test
    fun `toMap defaults stalker fields to zero`() {
        val user = User()
        val map = user.toMap()
        assertEquals(0L, map["stalkerCount"])
        assertEquals(0L, map["newStalkerCount"])
    }

    @Test
    fun `toMap roundtrip preserves non-null optional fields`() {
        val user = User(
            uid = "u1",
            displayName = "Test",
            avatarUrl = "avatar.png",
            profilePhotoUrl = "profile.png",
            coverPhotoUrl = "cover.png",
            description = "Hello world",
            nationality = "US",
            uniqueId = 42L,
            blockedUserIds = setOf("x"),
            email = "test@example.com",
            createdAt = TestData.BASE_TIMESTAMP,
            lastSeenAt = TestData.LATER_TIMESTAMP
        )
        val map = user.toMap()

        assertEquals(user.uid, map["uid"])
        assertEquals(user.displayName, map["displayName"])
        assertEquals(user.avatarUrl, map["avatarUrl"])
        assertEquals(user.profilePhotoUrl, map["profilePhotoUrl"])
        assertEquals(user.coverPhotoUrl, map["coverPhotoUrl"])
        assertEquals(user.description, map["description"])
        assertEquals(user.nationality, map["nationality"])
        assertEquals(user.uniqueId, map["uniqueId"])
        assertEquals(user.blockedUserIds.toList(), map["blockedUserIds"])
        assertEquals(user.email, map["email"])
        assertEquals(Timestamp(Date(user.createdAt)), map["createdAt"])
        assertEquals(Timestamp(Date(user.lastSeenAt)), map["lastSeenAt"])
    }

    // ===== Suspension fields =====

    @Test
    fun `toMap includes suspension fields when suspended`() {
        val startMillis = 1_500_000_000_000L
        val endMillis = 1_600_000_000_000L
        val user = User(
            isSuspended = true,
            suspensionReason = "Spam",
            suspensionStartDate = startMillis,
            suspensionEndDate = endMillis,
            suspensionCanAppeal = true,
            suspendedBy = "admin-1"
        )
        val map = user.toMap()

        assertEquals(true, map["isSuspended"])
        assertEquals("Spam", map["suspensionReason"])
        assertEquals(Timestamp(Date(startMillis)), map["suspensionStartDate"])
        assertEquals(Timestamp(Date(endMillis)), map["suspensionEndDate"])
        assertEquals(true, map["suspensionCanAppeal"])
        assertEquals("admin-1", map["suspendedBy"])
    }

    @Test
    fun `toMap defaults suspension fields`() {
        val user = User()
        val map = user.toMap()

        assertEquals(false, map["isSuspended"])
        assertNull(map["suspensionReason"])
        assertNull(map["suspensionStartDate"])
        assertNull(map["suspensionEndDate"])
        assertEquals(false, map["suspensionCanAppeal"])
        assertNull(map["suspendedBy"])
        assertNull(map["suspensionAppealStatus"])
    }
}
