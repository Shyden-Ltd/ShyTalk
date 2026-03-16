package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LinkedProviderTest {
    @Test
    fun fromMap_parsesGoogleProvider() {
        val map =
            mapOf<String, Any?>(
                "type" to "google",
                "identifier" to "alice@gmail.com",
                "active" to true,
                "linkedAt" to 1709913600000L,
            )

        val provider = LinkedProvider.fromMap(map)

        assertEquals(ProviderType.GOOGLE, provider.type)
        assertEquals("alice@gmail.com", provider.identifier)
        assertTrue(provider.active)
        assertEquals(1709913600000L, provider.linkedAt)
        assertNull(provider.unlinkedAt)
    }

    @Test
    fun fromMap_parsesAppleProvider() {
        val map =
            mapOf<String, Any?>(
                "type" to "apple",
                "identifier" to "001234.abcdef",
                "active" to true,
                "linkedAt" to 1709913600000L,
            )

        val provider = LinkedProvider.fromMap(map)

        assertEquals(ProviderType.APPLE, provider.type)
        assertEquals("001234.abcdef", provider.identifier)
    }

    @Test
    fun fromMap_parsesInactiveProviderWithUnlinkedAt() {
        val map =
            mapOf<String, Any?>(
                "type" to "email",
                "identifier" to "old@work.com",
                "active" to false,
                "linkedAt" to 1709913600000L,
                "unlinkedAt" to 1709917200000L,
            )

        val provider = LinkedProvider.fromMap(map)

        assertEquals(ProviderType.EMAIL, provider.type)
        assertEquals(false, provider.active)
        assertEquals(1709917200000L, provider.unlinkedAt)
    }

    @Test
    fun fromMap_defaultsToActiveWhenMissing() {
        val map =
            mapOf<String, Any?>(
                "type" to "google",
                "identifier" to "user@gmail.com",
                "linkedAt" to 1709913600000L,
            )

        val provider = LinkedProvider.fromMap(map)

        assertTrue(provider.active)
    }

    @Test
    fun fromMap_unknownTypeBecomesUNKNOWN() {
        val map =
            mapOf<String, Any?>(
                "type" to "facebook",
                "identifier" to "12345",
                "active" to true,
                "linkedAt" to 1709913600000L,
            )

        val provider = LinkedProvider.fromMap(map)

        assertEquals(ProviderType.UNKNOWN, provider.type)
    }

    @Test
    fun toMap_roundTrips() {
        val original =
            LinkedProvider(
                type = ProviderType.GOOGLE,
                identifier = "alice@gmail.com",
                active = true,
                linkedAt = 1709913600000L,
                unlinkedAt = null,
            )

        val map = original.toMap()
        val restored = LinkedProvider.fromMap(map)

        assertEquals(original.type, restored.type)
        assertEquals(original.identifier, restored.identifier)
        assertEquals(original.active, restored.active)
        assertEquals(original.linkedAt, restored.linkedAt)
        assertEquals(original.unlinkedAt, restored.unlinkedAt)
    }

    @Test
    fun toMap_includesCorrectKeys() {
        val provider =
            LinkedProvider(
                type = ProviderType.EMAIL,
                identifier = "test@example.com",
                active = false,
                linkedAt = 1709913600000L,
                unlinkedAt = 1709917200000L,
            )

        val map = provider.toMap()

        assertEquals("email", map["type"])
        assertEquals("test@example.com", map["identifier"])
        assertEquals(false, map["active"])
        assertEquals(1709913600000L, map["linkedAt"])
        assertEquals(1709917200000L, map["unlinkedAt"])
    }
}

class ProviderTypeTest {
    @Test
    fun fromKey_resolveAllKnownTypes() {
        assertEquals(ProviderType.GOOGLE, ProviderType.fromKey("google"))
        assertEquals(ProviderType.APPLE, ProviderType.fromKey("apple"))
        assertEquals(ProviderType.EMAIL, ProviderType.fromKey("email"))
    }

    @Test
    fun fromKey_unknownKeyReturnsUNKNOWN() {
        assertEquals(ProviderType.UNKNOWN, ProviderType.fromKey("facebook"))
        assertEquals(ProviderType.UNKNOWN, ProviderType.fromKey(""))
        assertEquals(ProviderType.UNKNOWN, ProviderType.fromKey("GitHub"))
    }

    @Test
    fun key_matchesExpectedStrings() {
        assertEquals("google", ProviderType.GOOGLE.key)
        assertEquals("apple", ProviderType.APPLE.key)
        assertEquals("email", ProviderType.EMAIL.key)
        assertEquals("unknown", ProviderType.UNKNOWN.key)
    }
}
