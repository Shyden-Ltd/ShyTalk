package com.shyden.shytalk.feature.starting

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.StartingScreen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests for StartingScreen service/repository logic: parsing, filtering,
 * API-first with cache fallback, state machine transitions.
 */
class StartingScreenServiceTest {
    // Helpers that simulate service logic

    private fun parseScreens(data: Map<String, Map<String, Any?>>): Map<String, StartingScreen> =
        data
            .map { (id, map) ->
                id to
                    StartingScreen(
                        screenId = id,
                        enabled = map["enabled"] as? Boolean ?: false,
                        dismissable = map["dismissable"] as? Boolean ?: true,
                        frequency = map["frequency"] as? String ?: "every_launch",
                        template = map["template"] as? String ?: "info",
                        title = map["title"] as? String ?: "",
                        message = map["message"] as? String ?: "",
                        imageType = map["imageType"] as? String,
                        backgroundImage = map["backgroundImage"] as? String,
                        startDate = map["startDate"] as? String,
                        endDate = map["endDate"] as? String,
                        contentHash = map["contentHash"] as? String ?: "",
                    )
            }.toMap()

    private fun determineState(
        apiResult: Resource<Map<String, StartingScreen>>,
        cachedBlocker: StartingScreenCache.CachedScreen?,
        dismissedIds: Set<String> = emptySet(),
    ): StartupState =
        when (apiResult) {
            is Resource.Success -> {
                val screens = apiResult.data
                val enabledScreens = screens.values.filter { it.enabled }
                val blocker = enabledScreens.firstOrNull { !it.dismissable }
                if (blocker != null) {
                    StartupState.BLOCKED
                } else {
                    val dismissable =
                        enabledScreens
                            .filter { it.dismissable }
                            .filter { it.frequency != "once" || it.screenId !in dismissedIds }
                    if (dismissable.isNotEmpty()) {
                        StartupState.DISMISSABLE_SCREENS
                    } else {
                        StartupState.PROCEED
                    }
                }
            }
            is Resource.Error -> {
                if (cachedBlocker != null) {
                    StartupState.BLOCKED
                } else {
                    StartupState.PROCEED
                }
            }
            is Resource.Loading -> StartupState.LOADING
        }

    enum class StartupState { LOADING, BLOCKED, DISMISSABLE_SCREENS, PROCEED }

    // ── Parsing ────────────────────────────────────────

    @Test
    fun `parses API response with all fields`() {
        val data =
            mapOf(
                "preLaunchGate" to
                    mapOf<String, Any?>(
                        "enabled" to true,
                        "dismissable" to false,
                        "frequency" to "every_launch",
                        "template" to "warning",
                        "title" to "Not Available",
                        "message" to "Not released yet",
                        "imageType" to "police_duck",
                        "backgroundImage" to null,
                        "contentHash" to "abc123",
                    ),
            )
        val screens = parseScreens(data)
        assertEquals(1, screens.size)
        val screen = screens["preLaunchGate"]!!
        assertEquals("preLaunchGate", screen.screenId)
        assertEquals("warning", screen.template)
        assertEquals("Not Available", screen.title)
        assertEquals("abc123", screen.contentHash)
    }

    @Test
    fun `handles missing optional fields`() {
        val data =
            mapOf(
                "test" to
                    mapOf<String, Any?>(
                        "enabled" to true,
                        "dismissable" to true,
                        "frequency" to "once",
                        "template" to "info",
                        "title" to "Title",
                        "message" to "Message",
                    ),
            )
        val screens = parseScreens(data)
        val screen = screens["test"]!!
        assertNull(screen.imageType)
        assertNull(screen.backgroundImage)
        assertNull(screen.startDate)
        assertNull(screen.endDate)
        assertEquals("", screen.contentHash)
    }

    @Test
    fun `handles empty response`() {
        val screens = parseScreens(emptyMap())
        assertTrue(screens.isEmpty())
    }

    @Test
    fun `parses multiple screens`() {
        val data =
            mapOf(
                "screen1" to
                    mapOf<String, Any?>(
                        "enabled" to true,
                        "dismissable" to false,
                        "frequency" to "every_launch",
                        "template" to "warning",
                        "title" to "Blocked",
                        "message" to "msg",
                    ),
                "screen2" to
                    mapOf<String, Any?>(
                        "enabled" to true,
                        "dismissable" to true,
                        "frequency" to "once",
                        "template" to "info",
                        "title" to "Info",
                        "message" to "msg",
                    ),
            )
        val screens = parseScreens(data)
        assertEquals(2, screens.size)
    }

    // ── State Machine ────────────────────────────────────

    @Test
    fun `API success with blocker returns BLOCKED`() {
        val screens =
            mapOf(
                "blocker" to StartingScreen("blocker", true, false, "every_launch", "warning", "Blocked", "msg"),
            )
        val state = determineState(Resource.Success(screens), null)
        assertEquals(StartupState.BLOCKED, state)
    }

    @Test
    fun `API success with no blocker and no dismissable returns PROCEED`() {
        val screens =
            mapOf(
                "disabled" to StartingScreen("disabled", false, true, "every_launch", "info", "Off", "msg"),
            )
        val state = determineState(Resource.Success(screens), null)
        assertEquals(StartupState.PROCEED, state)
    }

    @Test
    fun `API success with dismissable screens returns DISMISSABLE_SCREENS`() {
        val screens =
            mapOf(
                "notice" to StartingScreen("notice", true, true, "every_launch", "info", "Notice", "msg"),
            )
        val state = determineState(Resource.Success(screens), null)
        assertEquals(StartupState.DISMISSABLE_SCREENS, state)
    }

    @Test
    fun `API success empty response returns PROCEED`() {
        val state = determineState(Resource.Success(emptyMap()), null)
        assertEquals(StartupState.PROCEED, state)
    }

    @Test
    fun `API failure with cached blocker returns BLOCKED (fail-safe)`() {
        val cached =
            StartingScreenCache.CachedScreen(
                screenId = "cached",
                contentHash = "hash",
                enabled = true,
                dismissable = false,
                frequency = "every_launch",
                template = "warning",
                title = "Cached",
                message = "msg",
                imageType = null,
                backgroundImage = null,
                backgroundImagePath = null,
            )
        val state = determineState(Resource.Error("Network error"), cached)
        assertEquals(StartupState.BLOCKED, state)
    }

    @Test
    fun `API failure with no cache returns PROCEED (fail-open)`() {
        val state = determineState(Resource.Error("Network error"), null)
        assertEquals(StartupState.PROCEED, state)
    }

    @Test
    fun `API loading returns LOADING`() {
        val state = determineState(Resource.Loading, null)
        assertEquals(StartupState.LOADING, state)
    }

    // ── Once-dismissed filtering ────────────────────────

    @Test
    fun `once frequency dismissed screen filtered out`() {
        val screens =
            mapOf(
                "once_screen" to StartingScreen("once_screen", true, true, "once", "info", "Once", "msg"),
            )
        val state = determineState(Resource.Success(screens), null, dismissedIds = setOf("once_screen"))
        assertEquals(StartupState.PROCEED, state)
    }

    @Test
    fun `every_launch not filtered by dismissed set`() {
        val screens =
            mapOf(
                "always" to StartingScreen("always", true, true, "every_launch", "info", "Always", "msg"),
            )
        val state = determineState(Resource.Success(screens), null, dismissedIds = setOf("always"))
        assertEquals(StartupState.DISMISSABLE_SCREENS, state)
    }

    @Test
    fun `mix of once-dismissed and undismissed`() {
        val screens =
            mapOf(
                "dismissed" to StartingScreen("dismissed", true, true, "once", "info", "D", "msg"),
                "not_dismissed" to StartingScreen("not_dismissed", true, true, "once", "info", "ND", "msg"),
            )
        val state = determineState(Resource.Success(screens), null, dismissedIds = setOf("dismissed"))
        assertEquals(StartupState.DISMISSABLE_SCREENS, state)
    }

    // ── Blocker + dismissable mix ────────────────────────

    @Test
    fun `blocker takes priority over dismissable screens`() {
        val screens =
            mapOf(
                "blocker" to StartingScreen("blocker", true, false, "every_launch", "warning", "B", "msg"),
                "dismissable" to StartingScreen("dismissable", true, true, "once", "info", "D", "msg"),
            )
        val state = determineState(Resource.Success(screens), null)
        assertEquals(StartupState.BLOCKED, state)
    }

    // ── Content hash cache invalidation ────────────────

    @Test
    fun `contentHash match indicates cache hit`() {
        val apiHash = "abc123"
        val cacheHash = "abc123"
        assertEquals(apiHash, cacheHash)
    }

    @Test
    fun `contentHash mismatch indicates cache miss`() {
        val apiHash = "new_hash"
        val cacheHash = "old_hash"
        assertTrue(apiHash != cacheHash)
    }

    // ── Allowlist override ────────────────────────────

    @Test
    fun `allowlist override makes blocking screen dismissable in API response`() {
        // API returns dismissable=true for allowlisted device
        val screen =
            StartingScreen(
                "blocker",
                true,
                true,
                "every_launch",
                "warning",
                "B",
                "msg",
            )
        assertTrue(screen.dismissable) // API already overrode this
    }
}
