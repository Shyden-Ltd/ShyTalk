package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Tests for the User model's `providers` field and `firebaseUid` field
 * added for the multi-provider identity system.
 */
class UserProvidersTest {
    @Test
    fun fromMap_parsesProvidersField() {
        val map =
            mapOf<String, Any?>(
                "displayName" to "Alice",
                "uniqueId" to 10000001L,
                "firebaseUid" to "firebase-uid-123",
                "providers" to
                    listOf(
                        mapOf(
                            "type" to "google",
                            "identifier" to "alice@gmail.com",
                            "active" to true,
                            "linkedAt" to 1709913600000L,
                        ),
                    ),
            )

        val user = User.fromMap(map, "10000001")

        assertEquals(1, user.providers.size)
        assertEquals(ProviderType.GOOGLE, user.providers[0].type)
        assertEquals("alice@gmail.com", user.providers[0].identifier)
        assertTrue(user.providers[0].active)
    }

    @Test
    fun fromMap_parsesMultipleProviders() {
        val map =
            mapOf<String, Any?>(
                "displayName" to "Alice",
                "uniqueId" to 10000001L,
                "firebaseUid" to "firebase-uid-123",
                "providers" to
                    listOf(
                        mapOf(
                            "type" to "google",
                            "identifier" to "alice@gmail.com",
                            "active" to true,
                            "linkedAt" to 1709913600000L,
                        ),
                        mapOf(
                            "type" to "email",
                            "identifier" to "alice@work.com",
                            "active" to false,
                            "linkedAt" to 1709913600000L,
                            "unlinkedAt" to 1709917200000L,
                        ),
                    ),
            )

        val user = User.fromMap(map, "10000001")

        assertEquals(2, user.providers.size)
        assertEquals(ProviderType.GOOGLE, user.providers[0].type)
        assertEquals(ProviderType.EMAIL, user.providers[1].type)
        assertEquals(false, user.providers[1].active)
    }

    @Test
    fun fromMap_defaultsToEmptyProvidersWhenMissing() {
        val map =
            mapOf<String, Any?>(
                "displayName" to "Alice",
                "uniqueId" to 10000001L,
            )

        val user = User.fromMap(map, "10000001")

        assertTrue(user.providers.isEmpty())
    }

    @Test
    fun fromMap_parsesFirebaseUid() {
        val map =
            mapOf<String, Any?>(
                "displayName" to "Alice",
                "uniqueId" to 10000001L,
                "firebaseUid" to "firebase-uid-abc123",
            )

        val user = User.fromMap(map, "10000001")

        assertEquals("firebase-uid-abc123", user.firebaseUid)
    }

    @Test
    fun fromMap_defaultsFirebaseUidToEmptyString() {
        val map =
            mapOf<String, Any?>(
                "displayName" to "Alice",
                "uniqueId" to 10000001L,
            )

        val user = User.fromMap(map, "10000001")

        assertEquals("", user.firebaseUid)
    }

    @Test
    fun toMap_includesProviders() {
        val user =
            User(
                uid = "10000001",
                displayName = "Alice",
                uniqueId = 10000001L,
                firebaseUid = "firebase-uid-123",
                providers =
                    listOf(
                        LinkedProvider(
                            type = ProviderType.GOOGLE,
                            identifier = "alice@gmail.com",
                            active = true,
                            linkedAt = 1709913600000L,
                        ),
                    ),
            )

        val map = user.toMap()

        @Suppress("UNCHECKED_CAST")
        val providersList = map["providers"] as List<Map<String, Any?>>

        assertEquals(1, providersList.size)
        assertEquals("google", providersList[0]["type"])
        assertEquals("alice@gmail.com", providersList[0]["identifier"])
    }

    @Test
    fun toMap_includesFirebaseUid() {
        val user =
            User(
                uid = "10000001",
                displayName = "Alice",
                uniqueId = 10000001L,
                firebaseUid = "firebase-uid-123",
            )

        val map = user.toMap()

        assertEquals("firebase-uid-123", map["firebaseUid"])
    }

    @Test
    fun activeProviders_filtersInactiveOnes() {
        val user =
            User(
                uid = "10000001",
                displayName = "Alice",
                uniqueId = 10000001L,
                providers =
                    listOf(
                        LinkedProvider(ProviderType.GOOGLE, "alice@gmail.com", active = true, linkedAt = 1709913600000L),
                        LinkedProvider(ProviderType.EMAIL, "old@work.com", active = false, linkedAt = 1709913600000L),
                        LinkedProvider(ProviderType.APPLE, "001234.abcdef", active = true, linkedAt = 1709913600000L),
                    ),
            )

        val active = user.activeProviders

        assertEquals(2, active.size)
        assertEquals(ProviderType.GOOGLE, active[0].type)
        assertEquals(ProviderType.APPLE, active[1].type)
    }

    @Test
    fun hasProvider_returnsTrueForLinkedType() {
        val user =
            User(
                uid = "10000001",
                displayName = "Alice",
                uniqueId = 10000001L,
                providers =
                    listOf(
                        LinkedProvider(ProviderType.GOOGLE, "alice@gmail.com", active = true, linkedAt = 1709913600000L),
                    ),
            )

        assertTrue(user.hasProvider(ProviderType.GOOGLE))
        assertEquals(false, user.hasProvider(ProviderType.APPLE))
    }

    @Test
    fun hasProvider_ignoresInactiveProviders() {
        val user =
            User(
                uid = "10000001",
                displayName = "Alice",
                uniqueId = 10000001L,
                providers =
                    listOf(
                        LinkedProvider(ProviderType.EMAIL, "old@work.com", active = false, linkedAt = 1709913600000L),
                    ),
            )

        assertEquals(false, user.hasProvider(ProviderType.EMAIL))
    }
}
