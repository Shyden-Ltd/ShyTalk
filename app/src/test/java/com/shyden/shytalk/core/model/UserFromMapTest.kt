package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Date

class UserFromMapTest {
    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "displayName" to "Alice",
                "avatarUrl" to "https://avatar.png",
                "profilePhotoUrl" to "https://profile.png",
                "coverPhotoUrl" to "https://cover.png",
                "description" to "Hello!",
                "nationality" to "US",
                "uniqueId" to 12345L,
                "blockedUserIds" to listOf("user-2", "user-3"),
                "email" to "alice@example.com",
                "createdAt" to ts,
                "lastSeenAt" to ts,
            )
        val user = User.fromMap(map, "user-1")
        assertEquals("user-1", user.uid)
        assertEquals("Alice", user.displayName)
        assertEquals("https://avatar.png", user.avatarUrl)
        assertEquals("https://profile.png", user.profilePhotoUrl)
        assertEquals("https://cover.png", user.coverPhotoUrl)
        assertEquals("Hello!", user.description)
        assertEquals("US", user.nationality)
        assertEquals(12345L, user.uniqueId)
        assertEquals(setOf("user-2", "user-3"), user.blockedUserIds)
        assertEquals("alice@example.com", user.email)
        assertEquals(tsMillis, user.createdAt)
        assertEquals(tsMillis, user.lastSeenAt)
    }

    @Test
    fun `fromMap handles empty map with all defaults`() {
        val user = User.fromMap(emptyMap(), "user-1")
        assertEquals("user-1", user.uid)
        assertEquals("", user.displayName)
        assertNull(user.avatarUrl)
        assertNull(user.profilePhotoUrl)
        assertNull(user.coverPhotoUrl)
        assertNull(user.description)
        assertNull(user.nationality)
        assertEquals(0L, user.uniqueId)
        assertEquals(emptySet<String>(), user.blockedUserIds)
        assertNull(user.email)
    }

    @Test
    fun `fromMap filters non-string items from blockedUserIds`() {
        val map =
            mapOf<String, Any?>(
                "blockedUserIds" to listOf("user-1", 42, null, "user-2"),
            )
        val user = User.fromMap(map, "uid")
        assertEquals(setOf("user-1", "user-2"), user.blockedUserIds)
    }

    @Test
    fun `fromMap defaults blockedUserIds to empty when null`() {
        val map = mapOf<String, Any?>("blockedUserIds" to null)
        val user = User.fromMap(map, "uid")
        assertEquals(emptySet<String>(), user.blockedUserIds)
    }

    @Test
    fun `fromMap defaults uniqueId to 0 when missing`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertEquals(0L, user.uniqueId)
    }

    @Test
    fun `fromMap parses uniqueId from Long`() {
        val map = mapOf<String, Any?>("uniqueId" to 99999999L)
        val user = User.fromMap(map, "uid")
        assertEquals(99999999L, user.uniqueId)
    }

    @Test
    fun `photoUrl prefers profilePhotoUrl over avatarUrl`() {
        val user = User(profilePhotoUrl = "https://profile.png", avatarUrl = "https://avatar.png")
        assertEquals("https://profile.png", user.photoUrl)
    }

    @Test
    fun `photoUrl falls back to avatarUrl when profilePhotoUrl is null`() {
        val user = User(profilePhotoUrl = null, avatarUrl = "https://avatar.png")
        assertEquals("https://avatar.png", user.photoUrl)
    }

    @Test
    fun `photoUrl returns null when both are null`() {
        val user = User(profilePhotoUrl = null, avatarUrl = null)
        assertNull(user.photoUrl)
    }

    @Test
    fun `fromMap parses hideFollowing and hideOnlineStatus`() {
        val map =
            mapOf<String, Any?>(
                "hideFollowing" to true,
                "hideOnlineStatus" to true,
            )
        val user = User.fromMap(map, "uid")
        assertTrue(user.hideFollowing)
        assertTrue(user.hideOnlineStatus)
    }

    @Test
    fun `fromMap defaults hideFollowing and hideOnlineStatus to false`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertFalse(user.hideFollowing)
        assertFalse(user.hideOnlineStatus)
    }

    @Test
    fun `fromMap parses dateOfBirth`() {
        val dobMillis = 946684800000L
        val dob = Timestamp(Date(dobMillis))
        val map = mapOf<String, Any?>("dateOfBirth" to dob)
        val user = User.fromMap(map, "uid")
        assertEquals(dobMillis, user.dateOfBirth)
    }

    @Test
    fun `fromMap defaults dateOfBirth to null`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertNull(user.dateOfBirth)
    }

    @Test
    fun `fromMap parses hideAge`() {
        val map = mapOf<String, Any?>("hideAge" to true)
        val user = User.fromMap(map, "uid")
        assertTrue(user.hideAge)
    }

    @Test
    fun `fromMap defaults hideAge to false`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertFalse(user.hideAge)
    }

    @Test
    fun `fromMap of toMap produces equivalent user`() {
        val original =
            User(
                uid = "user-1",
                displayName = "Alice",
                avatarUrl = "https://avatar.png",
                profilePhotoUrl = "https://profile.png",
                coverPhotoUrl = "https://cover.png",
                description = "Hello!",
                nationality = "US",
                uniqueId = 12345L,
                blockedUserIds = setOf("user-2", "user-3"),
                dateOfBirth = tsMillis,
                hideFollowing = true,
                hideOnlineStatus = true,
                hideAge = true,
                email = "alice@example.com",
                createdAt = tsMillis,
                lastSeenAt = tsMillis,
                stalkerCount = 5,
                newStalkerCount = 2,
                stalkersLastViewedAt = tsMillis,
            )
        val roundtripped = User.fromMap(original.toMap(), "user-1")
        assertEquals(original, roundtripped)
    }

    // ===== Stalker fields =====

    @Test
    fun `fromMap parses stalkerCount`() {
        val map = mapOf<String, Any?>("stalkerCount" to 10L)
        val user = User.fromMap(map, "uid")
        assertEquals(10L, user.stalkerCount)
    }

    @Test
    fun `fromMap defaults stalkerCount to 0 when missing`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertEquals(0L, user.stalkerCount)
    }

    @Test
    fun `fromMap parses stalkerCount from Int`() {
        val map = mapOf<String, Any?>("stalkerCount" to 7)
        val user = User.fromMap(map, "uid")
        assertEquals(7L, user.stalkerCount)
    }

    @Test
    fun `fromMap parses stalkerCount from Double`() {
        val map = mapOf<String, Any?>("stalkerCount" to 5.0)
        val user = User.fromMap(map, "uid")
        assertEquals(5L, user.stalkerCount)
    }

    @Test
    fun `fromMap parses newStalkerCount`() {
        val map = mapOf<String, Any?>("newStalkerCount" to 3L)
        val user = User.fromMap(map, "uid")
        assertEquals(3L, user.newStalkerCount)
    }

    @Test
    fun `fromMap defaults newStalkerCount to 0 when missing`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertEquals(0L, user.newStalkerCount)
    }

    @Test
    fun `fromMap parses newStalkerCount from Int`() {
        val map = mapOf<String, Any?>("newStalkerCount" to 2)
        val user = User.fromMap(map, "uid")
        assertEquals(2L, user.newStalkerCount)
    }

    @Test
    fun `fromMap parses newStalkerCount from Double`() {
        val map = mapOf<String, Any?>("newStalkerCount" to 4.0)
        val user = User.fromMap(map, "uid")
        assertEquals(4L, user.newStalkerCount)
    }

    @Test
    fun `fromMap parses stalkersLastViewedAt`() {
        val map = mapOf<String, Any?>("stalkersLastViewedAt" to ts)
        val user = User.fromMap(map, "uid")
        assertEquals(tsMillis, user.stalkersLastViewedAt)
    }

    @Test
    fun `fromMap defaults stalkersLastViewedAt to 0 when missing`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertEquals(0L, user.stalkersLastViewedAt)
    }

    @Test
    fun `fromMap defaults stalkersLastViewedAt to 0 when null`() {
        val map = mapOf<String, Any?>("stalkersLastViewedAt" to null)
        val user = User.fromMap(map, "uid")
        assertEquals(0L, user.stalkersLastViewedAt)
    }

    // ===== Suspension fields =====

    @Test
    fun `fromMap parses suspension fields`() {
        val startTs = Timestamp(Date(1_500_000_000_000L))
        val endTs = Timestamp(Date(1_600_000_000_000L))
        val map =
            mapOf<String, Any?>(
                "isSuspended" to true,
                "suspensionReason" to "Spam",
                "suspensionStartDate" to startTs,
                "suspensionEndDate" to endTs,
                "suspensionCanAppeal" to true,
                "suspendedBy" to "admin-1",
                "suspensionAppealStatus" to "pending",
            )
        val user = User.fromMap(map, "uid")

        assertTrue(user.isSuspended)
        assertEquals("Spam", user.suspensionReason)
        assertEquals(1_500_000_000_000L, user.suspensionStartDate)
        assertEquals(1_600_000_000_000L, user.suspensionEndDate)
        assertTrue(user.suspensionCanAppeal)
        assertEquals("admin-1", user.suspendedBy)
        assertEquals("pending", user.suspensionAppealStatus)
    }

    @Test
    fun `fromMap defaults suspension fields when missing`() {
        val user = User.fromMap(emptyMap(), "uid")

        assertFalse(user.isSuspended)
        assertNull(user.suspensionReason)
        assertNull(user.suspensionStartDate)
        assertNull(user.suspensionEndDate)
        assertFalse(user.suspensionCanAppeal)
        assertNull(user.suspendedBy)
        assertNull(user.suspensionAppealStatus)
    }

    @Test
    fun `fromMap parses permanent suspension (null endDate)`() {
        val map =
            mapOf<String, Any?>(
                "isSuspended" to true,
                "suspensionEndDate" to null,
            )
        val user = User.fromMap(map, "uid")

        assertTrue(user.isSuspended)
        assertNull(user.suspensionEndDate)
    }

    @Test
    fun `isActivelySuspended returns true for permanent suspension`() {
        val user = User(isSuspended = true, suspensionEndDate = null)
        assertTrue(user.isActivelySuspended)
    }

    @Test
    fun `isActivelySuspended returns true for future end date`() {
        val futureEnd = System.currentTimeMillis() + 86_400_000L
        val user = User(isSuspended = true, suspensionEndDate = futureEnd)
        assertTrue(user.isActivelySuspended)
    }

    @Test
    fun `isActivelySuspended returns false for past end date`() {
        val pastEnd = System.currentTimeMillis() - 86_400_000L
        val user = User(isSuspended = true, suspensionEndDate = pastEnd)
        assertFalse(user.isActivelySuspended)
    }

    @Test
    fun `isActivelySuspended returns false when not suspended`() {
        val user = User(isSuspended = false)
        assertFalse(user.isActivelySuspended)
    }

    // ===== minGiftAnimationValue =====

    @Test
    fun `fromMap parses minGiftAnimationValue`() {
        val map = mapOf<String, Any?>("minGiftAnimationValue" to 500L)
        val user = User.fromMap(map, "uid")
        assertEquals(500, user.minGiftAnimationValue)
    }

    @Test
    fun `fromMap defaults minGiftAnimationValue to 0 when missing`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertEquals(0, user.minGiftAnimationValue)
    }

    @Test
    fun `fromMap defaults minGiftAnimationValue to 0 when null`() {
        val map = mapOf<String, Any?>("minGiftAnimationValue" to null)
        val user = User.fromMap(map, "uid")
        assertEquals(0, user.minGiftAnimationValue)
    }

    @Test
    fun `toMap includes minGiftAnimationValue`() {
        val user = User(minGiftAnimationValue = 1000)
        val map = user.toMap()
        assertEquals(1000, map["minGiftAnimationValue"])
    }

    @Test
    fun `toMap defaults minGiftAnimationValue to 0`() {
        val user = User()
        val map = user.toMap()
        assertEquals(0, map["minGiftAnimationValue"])
    }

    // ===== selfDestructAlertEnabled =====

    @Test
    fun `fromMap parses selfDestructAlertEnabled`() {
        val map = mapOf<String, Any?>("selfDestructAlertEnabled" to true)
        val user = User.fromMap(map, "u1")
        assertTrue(user.selfDestructAlertEnabled)
    }

    @Test
    fun `fromMap defaults selfDestructAlertEnabled to false when missing`() {
        val user = User.fromMap(emptyMap(), "u1")
        assertFalse(user.selfDestructAlertEnabled)
    }

    @Test
    fun `toMap includes selfDestructAlertEnabled`() {
        val user = User(selfDestructAlertEnabled = true)
        val map = user.toMap()
        assertEquals(true, map["selfDestructAlertEnabled"])
    }

    @Test
    fun `toMap defaults selfDestructAlertEnabled to false`() {
        val user = User()
        val map = user.toMap()
        assertEquals(false, map["selfDestructAlertEnabled"])
    }

    // ===== shyCoins / shyBeans — Number-safe casting =====

    @Test
    fun `fromMap parses shyCoins from Long`() {
        val map = mapOf<String, Any?>("shyCoins" to 500L)
        val user = User.fromMap(map, "uid")
        assertEquals(500L, user.shyCoins)
    }

    @Test
    fun `fromMap parses shyCoins from Int`() {
        val map = mapOf<String, Any?>("shyCoins" to 250)
        val user = User.fromMap(map, "uid")
        assertEquals(250L, user.shyCoins)
    }

    @Test
    fun `fromMap parses shyCoins from Double`() {
        val map = mapOf<String, Any?>("shyCoins" to 100.0)
        val user = User.fromMap(map, "uid")
        assertEquals(100L, user.shyCoins)
    }

    @Test
    fun `fromMap defaults shyCoins to 0 when missing`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertEquals(0L, user.shyCoins)
    }

    @Test
    fun `fromMap parses shyBeans from Long`() {
        val map = mapOf<String, Any?>("shyBeans" to 1000L)
        val user = User.fromMap(map, "uid")
        assertEquals(1000L, user.shyBeans)
    }

    @Test
    fun `fromMap parses shyBeans from Int`() {
        val map = mapOf<String, Any?>("shyBeans" to 75)
        val user = User.fromMap(map, "uid")
        assertEquals(75L, user.shyBeans)
    }

    @Test
    fun `fromMap parses shyBeans from Double`() {
        val map = mapOf<String, Any?>("shyBeans" to 50.0)
        val user = User.fromMap(map, "uid")
        assertEquals(50L, user.shyBeans)
    }

    @Test
    fun `fromMap defaults shyBeans to 0 when missing`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertEquals(0L, user.shyBeans)
    }

    // ===== Language preference =====

    @Test
    fun `fromMap parses language`() {
        val map = mapOf<String, Any?>("language" to "es")
        val user = User.fromMap(map, "uid")
        assertEquals("es", user.language)
    }

    @Test
    fun `fromMap defaults language to en when missing`() {
        val user = User.fromMap(emptyMap(), "uid")
        assertEquals("en", user.language)
    }

    @Test
    fun `toMap includes language`() {
        val user = User(language = "ja")
        val map = user.toMap()
        assertEquals("ja", map["language"])
    }

    @Test
    fun `fromMap of toMap roundtrip preserves suspension fields`() {
        val original =
            User(
                uid = "user-1",
                displayName = "Test",
                isSuspended = true,
                suspensionReason = "Abuse",
                suspensionStartDate = tsMillis,
                suspensionEndDate = tsMillis,
                suspensionCanAppeal = true,
                suspendedBy = "admin-1",
                suspensionAppealStatus = "pending",
                createdAt = tsMillis,
                lastSeenAt = tsMillis,
                stalkersLastViewedAt = tsMillis,
            )
        val roundtripped = User.fromMap(original.toMap(), "user-1")
        assertEquals(original, roundtripped)
    }
}
