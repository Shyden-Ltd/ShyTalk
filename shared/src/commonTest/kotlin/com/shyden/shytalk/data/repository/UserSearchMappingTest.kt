package com.shyden.shytalk.data.repository

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Tests for the shared DM user-search post-fetch mapping (SHY-0137) —
 * [mapUserSearchRows] and [jsonObjectToMap]. These live in commonMain so they
 * are covered ONCE here for BOTH targets (Android + iOS); previously the iOS
 * copy of this logic had zero test coverage because iosMain isn't visible from
 * commonTest. Both repository impls now flatten their platform JSON into
 * `List<Map<String, Any?>>` and call [mapUserSearchRows].
 */
class UserSearchMappingTest {
    // region mapUserSearchRows

    @Test
    fun `maps valid rows to Users with stringified uniqueId as uid and the displayName`() {
        val rows =
            listOf(
                mapOf<String, Any?>("uniqueId" to 10000002L, "displayName" to "Bob"),
                mapOf<String, Any?>("uniqueId" to 10000003L, "displayName" to "Carol"),
            )

        val users = mapUserSearchRows(rows, currentUserId = "10000001")

        assertEquals(2, users.size)
        // The Firestore doc id (== uniqueId string) is the User.uid.
        assertEquals("10000002", users[0].uid)
        assertEquals(10000002L, users[0].uniqueId)
        assertEquals("Bob", users[0].displayName)
        assertEquals("10000003", users[1].uid)
        assertEquals("Carol", users[1].displayName)
    }

    @Test
    fun `coerces an Int uniqueId to a Long-backed uid`() {
        // org.json on Android normalises Int->Long, but a raw Int row must still
        // resolve (Number covers both). Guards the `as? Number` cast.
        val rows = listOf(mapOf<String, Any?>("uniqueId" to 42, "displayName" to "Dot"))

        val users = mapUserSearchRows(rows, currentUserId = "10000001")

        assertEquals(1, users.size)
        assertEquals("42", users[0].uid)
        assertEquals(42L, users[0].uniqueId)
    }

    @Test
    fun `excludes the current user from the results`() {
        val rows =
            listOf(
                mapOf<String, Any?>("uniqueId" to 10000001L, "displayName" to "Me"),
                mapOf<String, Any?>("uniqueId" to 10000002L, "displayName" to "Bob"),
            )

        val users = mapUserSearchRows(rows, currentUserId = "10000001")

        assertEquals(1, users.size)
        assertEquals("10000002", users[0].uid)
        assertTrue(users.none { it.uid == "10000001" })
    }

    @Test
    fun `drops a row with an absent uniqueId while a valid row in the same batch survives`() {
        val rows =
            listOf(
                mapOf<String, Any?>("displayName" to "NoId"),
                mapOf<String, Any?>("uniqueId" to 10000002L, "displayName" to "Bob"),
            )

        val users = mapUserSearchRows(rows, currentUserId = "10000001")

        assertEquals(1, users.size)
        assertEquals("10000002", users[0].uid)
        assertEquals("Bob", users[0].displayName)
    }

    @Test
    fun `drops a row with a non-numeric string uniqueId while a valid row in the same batch survives`() {
        val rows =
            listOf(
                mapOf<String, Any?>("uniqueId" to "not-a-number", "displayName" to "BadId"),
                mapOf<String, Any?>("uniqueId" to 10000002L, "displayName" to "Bob"),
            )

        val users = mapUserSearchRows(rows, currentUserId = "10000001")

        assertEquals(1, users.size)
        assertEquals("10000002", users[0].uid)
        assertEquals("Bob", users[0].displayName)
    }

    @Test
    fun `empty input yields an empty list`() {
        assertEquals(emptyList(), mapUserSearchRows(emptyList(), currentUserId = "10000001"))
    }

    @Test
    fun `returns an empty list when every row is dropped`() {
        val rows =
            listOf(
                mapOf<String, Any?>("displayName" to "NoId"),
                mapOf<String, Any?>("uniqueId" to "x", "displayName" to "BadId"),
                mapOf<String, Any?>("uniqueId" to 10000001L, "displayName" to "Me"),
            )

        val users = mapUserSearchRows(rows, currentUserId = "10000001")

        assertTrue(users.isEmpty())
    }

    @Test
    fun `preserves input order of the surviving rows`() {
        val rows =
            listOf(
                mapOf<String, Any?>("uniqueId" to 10000005L, "displayName" to "Eve"),
                mapOf<String, Any?>("displayName" to "Dropped"),
                mapOf<String, Any?>("uniqueId" to 10000002L, "displayName" to "Bob"),
            )

        val users = mapUserSearchRows(rows, currentUserId = "10000001")

        assertEquals(listOf("10000005", "10000002"), users.map { it.uid })
    }

    // endregion

    // region jsonObjectToMap

    /** Parse a JSON literal into the [JsonObject] the iOS impl hands to [jsonObjectToMap]. */
    private fun obj(literal: String): JsonObject = Json.parseToJsonElement(literal) as JsonObject

    @Test
    fun `jsonObjectToMap coerces a JSON null to a Kotlin null`() {
        val map = jsonObjectToMap(obj("""{ "nationality": null }"""))

        assertTrue(map.containsKey("nationality"))
        assertNull(map["nationality"])
    }

    @Test
    fun `jsonObjectToMap keeps a quoted string as a String`() {
        val map = jsonObjectToMap(obj("""{ "displayName": "Bob" }"""))

        assertEquals("Bob", map["displayName"])
        assertTrue(map["displayName"] is String)
    }

    @Test
    fun `jsonObjectToMap coerces the literal true to a Boolean`() {
        val map = jsonObjectToMap(obj("""{ "ageVerified": true }"""))

        assertEquals(true, map["ageVerified"])
        assertTrue(map["ageVerified"] is Boolean)
    }

    @Test
    fun `jsonObjectToMap coerces the literal false to a Boolean`() {
        val map = jsonObjectToMap(obj("""{ "pmLocked": false }"""))

        assertEquals(false, map["pmLocked"])
        assertTrue(map["pmLocked"] is Boolean)
    }

    @Test
    fun `jsonObjectToMap coerces a decimal number to a Double`() {
        val map = jsonObjectToMap(obj("""{ "score": 1.5 }"""))

        assertEquals(1.5, map["score"])
        assertTrue(map["score"] is Double)
    }

    @Test
    fun `jsonObjectToMap coerces an integer number to a Long`() {
        val map = jsonObjectToMap(obj("""{ "uniqueId": 10000002 }"""))

        assertEquals(10000002L, map["uniqueId"])
        assertTrue(map["uniqueId"] is Long)
    }

    @Test
    fun `jsonObjectToMap keeps a quoted true or false token as a String (isString wins over content)`() {
        // The `isString` branch is checked BEFORE the content-equals-"true"/"false"
        // branch, so a QUOTED "true" stays a String — only a BARE true/false token
        // (isString == false) coerces to Boolean. Pins the branch ordering so a
        // future reorder that turned `"true"` into a Boolean would fail here.
        val map = jsonObjectToMap(obj("""{ "flag": "true", "other": "false" }"""))

        assertEquals("true", map["flag"])
        assertTrue(map["flag"] is String)
        assertEquals("false", map["other"])
        assertTrue(map["other"] is String)
    }

    @Test
    fun `jsonObjectToMap skips a nested object`() {
        val map = jsonObjectToMap(obj("""{ "displayName": "Bob", "settings": { "a": 1 } }"""))

        assertEquals("Bob", map["displayName"])
        assertTrue(!map.containsKey("settings"))
    }

    @Test
    fun `jsonObjectToMap skips a nested array`() {
        val map = jsonObjectToMap(obj("""{ "displayName": "Bob", "tags": [1, 2, 3] }"""))

        assertEquals("Bob", map["displayName"])
        assertTrue(!map.containsKey("tags"))
    }

    @Test
    fun `jsonObjectToMap flattens a realistic user card into a fromMap-ready map`() {
        // End-to-end: a flattened card feeds mapUserSearchRows -> a real User.
        val map =
            jsonObjectToMap(
                obj(
                    """{ "uniqueId": 10000002, "displayName": "Bob", "nationality": "GB", "ageVerified": true }""",
                ),
            )

        assertEquals(10000002L, map["uniqueId"])
        assertEquals("Bob", map["displayName"])
        assertEquals("GB", map["nationality"])
        assertEquals(true, map["ageVerified"])

        val users = mapUserSearchRows(listOf(map), currentUserId = "10000001")
        assertEquals(1, users.size)
        assertEquals("10000002", users[0].uid)
        assertEquals("Bob", users[0].displayName)
        assertEquals("GB", users[0].nationality)
    }

    // endregion
}
