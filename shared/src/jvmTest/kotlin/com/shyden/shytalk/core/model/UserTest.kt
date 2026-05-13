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
    fun `default createdAt and lastSeenAt are 0L (not capture-time)`() {
        // Regression test: default-constructed User must NOT capture
        // currentTimeMillis() at construction time. If it did, writing
        // a default-constructed User via UserRepository.createOrUpdateUser
        // would overwrite the server's authoritative createdAt with
        // wall-clock-at-construction. fromMap() populates these fields
        // from the Firestore doc; client-built User instances must
        // explicitly set them when the value matters.
        val user = User()
        assertEquals(0L, user.createdAt)
        assertEquals(0L, user.lastSeenAt)
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

    // ── Age verification fields ──────────────────────────────────────
    //
    // Apple App Store guidelines require 18+ enforcement on the gated
    // private-message + gacha features. The verification status is held
    // server-side via the API; the client never writes these fields
    // directly (Firestore rules enforce that — see firestore.rules diff
    // alongside this PR). Method strings are an enumerated set of
    // "passport" / "drivers-license" / "national-id" — the admin panel
    // picks one when approving a submission.

    @Test
    fun `default age verification fields are unverified`() {
        val user = User()
        assertFalse(user.ageVerified)
        assertNull(user.ageVerifiedAt)
        assertNull(user.ageVerificationMethod)
    }

    @Test
    fun `fromMap parses age verification fields`() {
        val map =
            mapOf<String, Any?>(
                "ageVerified" to true,
                "ageVerifiedAt" to 1705326600000L,
                "ageVerificationMethod" to "passport",
            )
        val user = User.fromMap(map, "u1")
        assertTrue(user.ageVerified)
        assertEquals(1705326600000L, user.ageVerifiedAt)
        assertEquals("passport", user.ageVerificationMethod)
    }

    @Test
    fun `fromMap handles null age verification fields`() {
        // Reverted-to-unverified shape: admin can revert ageVerified to
        // false with a reason note, in which case we want the timestamp
        // and method cleared. Pin that null on the wire round-trips to
        // null on the model.
        val map =
            mapOf<String, Any?>(
                "ageVerified" to false,
                "ageVerifiedAt" to null,
                "ageVerificationMethod" to null,
            )
        val user = User.fromMap(map, "u1")
        assertFalse(user.ageVerified)
        assertNull(user.ageVerifiedAt)
        assertNull(user.ageVerificationMethod)
    }

    @Test
    fun `fromMap handles missing age verification fields`() {
        // Existing user docs in Firestore predate this feature. They
        // have NO `ageVerified` field at all — must default to false.
        val map = emptyMap<String, Any?>()
        val user = User.fromMap(map, "u1")
        assertFalse(user.ageVerified)
        assertNull(user.ageVerifiedAt)
        assertNull(user.ageVerificationMethod)
    }

    @Test
    fun `toMap includes age verification fields when verified`() {
        val user =
            User(
                ageVerified = true,
                ageVerifiedAt = 1705326600000L,
                ageVerificationMethod = "drivers-license",
            )
        val map = user.toMap()
        assertEquals(true, map["ageVerified"])
        assertEquals(1705326600000L, map["ageVerifiedAt"])
        assertEquals("drivers-license", map["ageVerificationMethod"])
    }

    @Test
    fun `toMap includes default age verification fields when unverified`() {
        // The default-unverified shape MUST round-trip cleanly so a
        // newly-created user document writes the explicit `ageVerified:
        // false`. Without it Firestore queries that filter on
        // `ageVerified == false` (admin "find unverified users" view)
        // would silently miss legacy / new accounts.
        val user = User()
        val map = user.toMap()
        assertEquals(false, map["ageVerified"])
        assertNull(map["ageVerifiedAt"])
        assertNull(map["ageVerificationMethod"])
    }

    @Test
    fun `ageVerificationMethod accepts the three approved id types`() {
        listOf("passport", "drivers-license", "national-id").forEach { method ->
            val user =
                User(
                    ageVerified = true,
                    ageVerifiedAt = currentTimeMillis(),
                    ageVerificationMethod = method,
                )
            assertEquals(method, user.ageVerificationMethod)
            assertTrue(user.ageVerified)
        }
    }

    // ── PM-lock fields (PR 11) ──────────────────────────────────────

    @Test
    fun `default pmLocked is false and lastPmLockCheck is null`() {
        val user = User()
        assertFalse(user.pmLocked)
        assertNull(user.lastPmLockCheck)
    }

    @Test
    fun `fromMap parses pmLocked + lastPmLockCheck`() {
        val map =
            mapOf<String, Any?>(
                "pmLocked" to true,
                "lastPmLockCheck" to 1709913600000L,
            )
        val user = User.fromMap(map, "u1")
        assertTrue(user.pmLocked)
        assertEquals(1709913600000L, user.lastPmLockCheck)
    }

    @Test
    fun `fromMap defaults pmLocked false when absent`() {
        // Existing user docs predate PR 11 and have neither field.
        // Default fail-OPEN here — sub-18 users got their lock applied
        // by the migration script; an unmigrated 18+ user should NOT
        // be locked. The migration is idempotent so any subsequent
        // run catches anyone the first run missed.
        val user = User.fromMap(emptyMap(), "u1")
        assertFalse(user.pmLocked)
        assertNull(user.lastPmLockCheck)
    }

    @Test
    fun `toMap round-trips pmLocked + lastPmLockCheck`() {
        val user = User(pmLocked = true, lastPmLockCheck = 1709913600000L)
        val map = user.toMap()
        assertEquals(true, map["pmLocked"])
        assertEquals(1709913600000L, map["lastPmLockCheck"])
    }

    @Test
    fun `toMap includes default pmLocked false for new users`() {
        // Pin that newly-created user docs write the explicit `pmLocked
        // = false` field so an admin "find unlocked users" query on
        // `where('pmLocked', '==', false)` catches them. Same defence
        // as the ageVerified pattern.
        val user = User()
        val map = user.toMap()
        assertEquals(false, map["pmLocked"])
        assertNull(map["lastPmLockCheck"])
    }

    // ── Segregation cohort fields (UK OSA #17) ───────────────────────
    //
    // Server-only-write. Mirrors the pmLocked / ageVerified contract —
    // Firestore rules deny client writes to both `cohort` and
    // `cohortOverride`. Default is most-restrictive "minor" so a legacy
    // user doc missing the field surfaces as the safer cohort; the
    // first sign-in check (pm-lock-check.js extension) corrects it
    // when DOB indicates adult. Spec:
    // `.project/plans/2026-05-13-age-segregation-design.md`.

    @Test
    fun `default cohort is minor and cohortOverride is null`() {
        // Most-restrictive default. A default-constructed User must
        // surface as minor — never as adult — so any caller that forgets
        // to wire fromMap gets the safer cohort by default.
        val user = User()
        assertEquals("minor", user.cohort)
        assertNull(user.cohortOverride)
    }

    @Test
    fun `fromMap parses cohort and cohortOverride`() {
        val map =
            mapOf<String, Any?>(
                "cohort" to "adult",
                "cohortOverride" to "minor",
            )
        val user = User.fromMap(map, "u1")
        assertEquals("adult", user.cohort)
        assertEquals("minor", user.cohortOverride)
    }

    @Test
    fun `fromMap defaults cohort to minor when absent`() {
        // Legacy user docs predate UK OSA #17 and have no `cohort`
        // field at all. They MUST surface as minor (most-restrictive),
        // not as a hard error or an empty string — downstream cohort
        // filters compare against the string literal "minor" / "adult"
        // so an empty / missing default would silently bypass every
        // gate. The first sign-in pm-lock-check writes the correct
        // value once we have a DOB.
        val user = User.fromMap(emptyMap(), "u1")
        assertEquals("minor", user.cohort)
        assertNull(user.cohortOverride)
    }

    @Test
    fun `fromMap defaults cohort to minor when value is null`() {
        // Distinct from "absent" — Firestore can return a doc where the
        // key exists but the value is explicitly null (e.g. after a
        // FieldValue.delete() write the field disappears, but during
        // transit the SDK may surface it as null). Treat both the same
        // way: surface as minor.
        val map = mapOf<String, Any?>("cohort" to null)
        val user = User.fromMap(map, "u1")
        assertEquals("minor", user.cohort)
    }

    @Test
    fun `fromMap handles null cohortOverride explicitly`() {
        // The override is null when admin has not set a manual override.
        // Round-tripping null cleanly is required so an admin "clear
        // override" action writes `cohortOverride: null` and a
        // subsequent read surfaces as null (not as an empty string).
        val map = mapOf<String, Any?>("cohortOverride" to null)
        val user = User.fromMap(map, "u1")
        assertNull(user.cohortOverride)
    }

    @Test
    fun `toMap round-trips cohort and cohortOverride`() {
        val user = User(cohort = "adult", cohortOverride = "minor")
        val map = user.toMap()
        assertEquals("adult", map["cohort"])
        assertEquals("minor", map["cohortOverride"])
    }

    @Test
    fun `toMap writes explicit minor for new users (admin queryability)`() {
        // Pin that newly-created user docs write the explicit `cohort:
        // "minor"` field so an admin "find minor users" view on
        // `where('cohort', '==', 'minor')` catches them. Same defence
        // as the ageVerified pattern. Without this, default-constructed
        // users would round-trip as cohort=null on the wire and miss
        // the query.
        val user = User()
        val map = user.toMap()
        assertEquals("minor", map["cohort"])
        assertNull(map["cohortOverride"])
    }

    @Test
    fun `cohort field accepts the two canonical tag strings`() {
        // The model is intentionally a passive String parser (no enum)
        // so a future "verified-adult" tag (Phase 2 of #17, not in
        // scope) doesn't require a model migration. The two canonical
        // values today are pinned here.
        listOf("minor", "adult").forEach { tag ->
            val user = User(cohort = tag)
            assertEquals(tag, user.cohort)
        }
    }

    @Test
    fun `cohortOverride non-null takes precedence in the model contract`() {
        // The model holds both fields verbatim — precedence is enforced
        // at the rules / repo / server layers, NOT in the model. This
        // pins that fact: a user with cohort=minor AND cohortOverride=
        // adult retains BOTH values; downstream enforcement reads
        // `cohortOverride ?: cohort`.
        val user = User(cohort = "minor", cohortOverride = "adult")
        assertEquals("minor", user.cohort)
        assertEquals("adult", user.cohortOverride)
    }

    @Test
    fun `fromMap preserves unrecognised cohort string for forward-compat tags`() {
        // Spec § Open follow-ups names "verified-adult" as a future
        // Phase 2 tag. The model is intentionally a passive String
        // parser (not an enum) so a server that ships a new tag
        // before the client updates surfaces the tag verbatim — never
        // coerced to a wrong value, never thrown. This pins the
        // additive rollout contract: server can lead, client follows.
        val map = mapOf<String, Any?>("cohort" to "verified-adult")
        val user = User.fromMap(map, "u1")
        assertEquals("verified-adult", user.cohort)
    }
}
