package com.shyden.shytalk.feature.home

import com.shyden.shytalk.testsupport.RepoSource
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * SHY-0500 — J40's "private data reaches the room list" step passed on Android
 * and failed on the iPhone (run `local-2026-09-05T02-56-46-302Z`) with
 * "neither a room card nor the empty state arrived within 15s", while the
 * app's own log said `Received 0 active rooms` and the texts were drawn.
 *
 * uiautomator exposes every node that carries a testTag as a resource-id.
 * XCUITest only sees the nodes Compose Multiplatform turns into accessibility
 * elements, and a Box that has nothing but a testTag and a scroll modifier is
 * not one of them: its `name` never appears in the tree. Merging the
 * descendants makes the empty state a single element that carries the tag and
 * reads to VoiceOver as one sentence. Pinned at the source because the
 * difference only shows on a phone; the device proof is J40 on the iPhone.
 */
class RoomListEmptyStateIsAnAccessibilityElementPinTest {
    private val homeScreen = "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/home/HomeScreen.kt"

    @Test
    fun `the room list empty state merges its descendants so XCUITest exposes its tag`() {
        val src = RepoSource.read(homeScreen)
        val tag = src.indexOf(".testTag(\"roomList_emptyState\")")
        assertTrue(tag >= 0, "anchor moved: the roomList_emptyState tag")
        val boxStart = src.lastIndexOf("Box(", tag)
        val boxArgsEnd = src.indexOf("contentAlignment", tag)
        assertTrue(boxStart in 0 until tag && boxArgsEnd > tag, "anchor moved: the empty-state Box")
        val modifierChain = src.substring(boxStart, boxArgsEnd)
        assertTrue(
            modifierChain.contains("semantics(mergeDescendants = true)"),
            "the empty state carries a testTag with no merged semantics, so iOS exposes no element for it",
        )
        assertTrue(
            src.contains("import androidx.compose.ui.semantics.semantics"),
            "HomeScreen does not import the semantics modifier",
        )
    }
}
