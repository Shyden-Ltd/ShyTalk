package com.shyden.shytalk.steps

import com.shyden.shytalk.feature.security.UnsafeDeviceScreen
import com.shyden.shytalk.feature.update.DegradedModeScreen
import com.shyden.shytalk.feature.update.ForceUpdateScreen
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import com.shyden.shytalk.util.ComposeTestRuleHolder
import io.cucumber.java.en.Given

class SystemScreenSteps {
    private val rule get() = ComposeTestRuleHolder.rule

    @Given("the force update screen is displayed")
    fun forceUpdateScreenIsDisplayed() {
        rule.setContent {
            ShyTalkTheme { ForceUpdateScreen() }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("the degraded mode screen is displayed")
    fun degradedModeScreenIsDisplayed() {
        rule.setContent {
            ShyTalkTheme { DegradedModeScreen(onAcknowledge = {}) }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("the unsafe device screen is displayed")
    fun unsafeDeviceScreenIsDisplayed() {
        rule.setContent {
            ShyTalkTheme { UnsafeDeviceScreen() }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }
}
