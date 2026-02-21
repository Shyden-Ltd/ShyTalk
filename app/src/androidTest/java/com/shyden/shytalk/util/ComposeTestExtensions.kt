package com.shyden.shytalk.util

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput

/**
 * Waits for a node with the given [tag] to appear.
 *
 * Assumes [mainClock.autoAdvance] is false (set in [launchNavGraph]).
 * Each iteration:
 *   1. [Thread.sleep] yields the instrumentation thread, letting ViewModel
 *      coroutines on Dispatchers.Main deliver StateFlow updates.
 *   2. [mainClock.advanceTimeBy] processes several frames so Compose picks
 *      up the new state and recomposes.
 *   3. [assertExists] checks the semantics tree (with autoAdvance=false,
 *      its internal [waitForIdle] returns quickly without driving animations).
 */
fun ComposeTestRule.waitForTag(
    tag: String,
    timeoutMs: Long = 10_000,
    useUnmergedTree: Boolean = false
) {
    val deadline = System.nanoTime() + timeoutMs * 1_000_000L
    while (true) {
        Thread.sleep(250)
        mainClock.advanceTimeBy(500)
        try {
            onNodeWithTag(tag, useUnmergedTree = useUnmergedTree).assertExists()
            return
        } catch (e: AssertionError) {
            if (System.nanoTime() >= deadline) throw e
        }
    }
}

fun ComposeTestRule.clickTag(tag: String) {
    onNodeWithTag(tag).performClick()
}

fun ComposeTestRule.typeTextInTag(tag: String, text: String) {
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
 */
fun ComposeTestRule.waitForText(text: String, timeoutMs: Long = 10_000) {
    val deadline = System.nanoTime() + timeoutMs * 1_000_000L
    while (true) {
        Thread.sleep(250)
        mainClock.advanceTimeBy(500)
        try {
            onNodeWithText(text).assertExists()
            return
        } catch (e: AssertionError) {
            if (System.nanoTime() >= deadline) throw e
        }
    }
}

fun ComposeTestRule.clickText(text: String) {
    onNodeWithText(text).performClick()
}
