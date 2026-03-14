package com.shyden.shytalk.steps

import com.shyden.shytalk.feature.suspension.BanScreen
import com.shyden.shytalk.feature.suspension.SuspensionScreen
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import com.shyden.shytalk.util.ComposeTestRuleHolder
import io.cucumber.java.en.Given

class ModerationSteps {

    private val rule get() = ComposeTestRuleHolder.rule

    @Given("the ban screen is displayed for a {string} ban")
    fun banScreenDisplayed(banType: String) {
        rule.setContent {
            ShyTalkTheme {
                BanScreen(
                    banType = banType,
                    reason = "Violation of community standards",
                    expiresAt = "2026-04-01",
                    onSignOut = {}
                )
            }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("the permanent ban screen is displayed")
    fun permanentBanScreenDisplayed() {
        rule.setContent {
            ShyTalkTheme {
                BanScreen(
                    banType = "device",
                    reason = "Severe violation",
                    expiresAt = null,
                    onSignOut = {}
                )
            }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("the suspension screen is displayed with appeal option")
    fun suspensionScreenWithAppeal() {
        rule.setContent {
            ShyTalkTheme {
                SuspensionScreen(
                    reason = "Repeated violations",
                    endDate = System.currentTimeMillis() + 86_400_000L * 365,
                    canAppeal = true,
                    appealStatus = null,
                    onSubmitAppeal = {},
                    onSignOut = {},
                    isLoading = false
                )
            }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("the suspension screen is displayed without appeal")
    fun suspensionScreenWithoutAppeal() {
        rule.setContent {
            ShyTalkTheme {
                SuspensionScreen(
                    reason = "Terms violation",
                    endDate = null,
                    canAppeal = false,
                    appealStatus = null,
                    onSubmitAppeal = {},
                    onSignOut = {},
                    isLoading = false
                )
            }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }
}
