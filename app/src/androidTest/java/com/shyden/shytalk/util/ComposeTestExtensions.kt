package com.shyden.shytalk.util

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput

/**
 * Waits for a node with the given [tag] to appear.
 *
 * Assumes [mainClock.autoAdvance] is false (set in [launchNavGraph]).
 * Each iteration:
 *   1. [mainClock.advanceTimeBy] drives the Compose clock so pending frames
 *      and coroutine dispatches on Dispatchers.Main are processed.
 *   2. [waitForIdle] flushes any remaining pending recompositions before the
 *      semantics tree is inspected.
 *   3. [assertExists] checks the semantics tree (with autoAdvance=false,
 *      its internal [waitForIdle] returns quickly without driving animations).
 *
 * **Use this before EVERY direct assertion.** Since the migration to
 * `androidx.compose.ui.test.junit4.v2.createComposeRule`, the test rule uses
 * `StandardTestDispatcher` instead of v1's `UnconfinedTestDispatcher`. That
 * means coroutines on `Dispatchers.Main` (including ViewModel-init `viewModelScope.launch`
 * blocks) no longer execute eagerly — they're queued until the clock
 * advances. Any direct `onNodeWithTag(...).assertIsDisplayed()` without a
 * preceding `waitForTag` may silently fail to see state set by an unyielded
 * coroutine. The `mainClock.advanceTimeBy(500)` + `waitForIdle()` loop here
 * is what makes the dispatcher swap safe for existing tests.
 */
fun ComposeTestRule.waitForTag(
    tag: String,
    timeoutMs: Long = 10_000,
    useUnmergedTree: Boolean = false,
) {
    val deadline = System.nanoTime() + timeoutMs * 1_000_000L
    while (true) {
        mainClock.advanceTimeBy(500)
        waitForIdle()
        try {
            onNodeWithTag(tag, useUnmergedTree = useUnmergedTree).assertExists()
            return
        } catch (e: AssertionError) {
            if (System.nanoTime() >= deadline) throw e
        }
    }
}

/**
 * Waits for a node with the given [tag] to be GONE.
 *
 * The mirror of [waitForTag], and the reason the feature corpus no longer
 * needs `I wait N milliseconds` before a negative assertion: an assertion
 * that fires immediately can only be made reliable by a fixed sleep, which
 * is both flaky and a step wasted against the 6-step scenario cap. Returns
 * as soon as the node is absent — if it was never there, that is instantly.
 */
fun ComposeTestRule.waitForTagToDisappear(
    tag: String,
    timeoutMs: Long = 10_000,
) {
    val deadline = System.nanoTime() + timeoutMs * 1_000_000L
    while (true) {
        mainClock.advanceTimeBy(500)
        waitForIdle()
        try {
            onNodeWithTag(tag).assertDoesNotExist()
            return
        } catch (e: AssertionError) {
            if (System.nanoTime() >= deadline) throw e
        }
    }
}

fun ComposeTestRule.clickTag(tag: String) {
    onNodeWithTag(tag).performClick()
}

fun ComposeTestRule.typeTextInTag(
    tag: String,
    text: String,
) {
    onNodeWithTag(tag).performTextInput(text)
}

fun ComposeTestRule.assertTagExists(tag: String) {
    onNodeWithTag(tag).assertIsDisplayed()
}

fun ComposeTestRule.assertTagDoesNotExist(tag: String) {
    onNodeWithTag(tag).assertDoesNotExist()
}

/**
 * Waits for a node with the given [text] to appear.
 * Uses the same strategy as [waitForTag].
 *
 * Uses [onAllNodesWithText] internally so that the wait succeeds even when
 * multiple nodes share the same text (e.g. two "Unlink" buttons for two providers).
 */
fun ComposeTestRule.waitForText(
    text: String,
    timeoutMs: Long = 10_000,
) {
    val deadline = System.nanoTime() + timeoutMs * 1_000_000L
    while (true) {
        mainClock.advanceTimeBy(500)
        waitForIdle()
        try {
            val nodes = onAllNodesWithText(text).fetchSemanticsNodes()
            if (nodes.isNotEmpty()) return
            throw AssertionError("No nodes found with text '$text'")
        } catch (e: AssertionError) {
            if (System.nanoTime() >= deadline) throw e
        }
    }
}

fun ComposeTestRule.clickText(text: String) {
    onNodeWithText(text).performClick()
}
