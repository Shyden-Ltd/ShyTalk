package com.shyden.shytalk.feature.daily

import com.shyden.shytalk.testsupport.RepoSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * SHY-0527 -- the device-journey runner closes the daily-reward sheet by test
 * tag only, so the tags it looks for must exist on the composable, and the
 * "Later" button must be absent (not an empty label) once the reward has been
 * claimed. The empty-labelled button was what the label-based handler tapped
 * into nothing; the runner's id list and the composable's tags are one seam.
 */
class DailyRewardDialogTestTagsPinTest {
    private val dialog =
        RepoSource.read(
            "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/daily/DailyRewardDialog.kt",
        )
    private val runner = RepoSource.read("express-api/scripts/device-journey-runner.js")

    @Test
    fun `every sheet button carries exactly one test tag`() {
        for (tag in listOf("dailyReward_claimButton", "dailyReward_dismissButton", "dailyReward_closeButton")) {
            assertEquals(
                1,
                Regex("""testTag\("$tag"\)""").findAll(dialog).count(),
                "testTag(\"$tag\") must appear exactly once in DailyRewardDialog.kt",
            )
        }
    }

    @Test
    fun `the Later button is absent, not empty, once the reward is claimed`() {
        assertFalse(
            dialog.contains("""if (state.hasClaimedToday) "" else"""),
            "an empty-labelled Later button is what SHY-0527 removed",
        )
        assertTrue(
            Regex("""dismissButton =\s*if \(state\.hasClaimedToday\) \{\s*null\s*\} else \{""").containsMatchIn(dialog),
            "the dismiss slot must be null once the reward is claimed",
        )
    }

    @Test
    fun `the runner closes the sheet by the same tags`() {
        val declared = Regex("""const REWARD_SHEET_BUTTON_IDS = \[([^\]]*)\]""").find(runner)?.groupValues?.get(1)
        assertNotNull(declared, "anchor: REWARD_SHEET_BUTTON_IDS must be declared in device-journey-runner.js")
        assertEquals(
            listOf("dailyReward_dismissButton", "dailyReward_closeButton"),
            Regex("""'([^']+)'""").findAll(declared).map { it.groupValues[1] }.toList(),
        )
    }
}
