package com.shyden.shytalk.steps

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.shyden.shytalk.data.remote.StartingScreen
import com.shyden.shytalk.feature.starting.StartingScreenComposable
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import com.shyden.shytalk.util.ComposeTestRuleHolder
import io.cucumber.java.en.Given

class StartingScreenSteps {
    private val rule get() = ComposeTestRuleHolder.rule

    @Given("a blocking starting screen is configured with title {string} and message {string}")
    fun blockingScreenConfigured(
        title: String,
        message: String,
    ) {
        rule.setContent {
            ShyTalkTheme(darkTheme = true) {
                StartingScreenComposable(
                    screen =
                        StartingScreen(
                            screenId = "blocking_test",
                            enabled = true,
                            dismissable = false,
                            frequency = "every_launch",
                            template = "warning",
                            title = title,
                            message = message,
                            imageType = "police_duck",
                        ),
                    onDismiss = {},
                )
            }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("a dismissable starting screen is configured with title {string} and message {string}")
    fun dismissableScreenConfigured(
        title: String,
        message: String,
    ) {
        rule.setContent {
            var dismissed by remember { mutableStateOf(false) }
            ShyTalkTheme(darkTheme = true) {
                if (!dismissed) {
                    StartingScreenComposable(
                        screen =
                            StartingScreen(
                                screenId = "dismissable_test",
                                enabled = true,
                                dismissable = true,
                                frequency = "once",
                                template = "announcement",
                                title = title,
                                message = message,
                            ),
                        onDismiss = { dismissed = true },
                    )
                }
            }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }

    @Given("a starting screen with template {string} is configured")
    fun screenWithTemplateConfigured(template: String) {
        rule.setContent {
            ShyTalkTheme(darkTheme = true) {
                StartingScreenComposable(
                    screen =
                        StartingScreen(
                            screenId = "template_test",
                            enabled = true,
                            dismissable = true,
                            frequency = "every_launch",
                            template = template,
                            title = "Test Title",
                            message = "This is a test message for the starting screen",
                        ),
                    onDismiss = {},
                )
            }
        }
        rule.mainClock.autoAdvance = false
        rule.mainClock.advanceTimeBy(500)
        rule.waitForIdle()
    }
}
