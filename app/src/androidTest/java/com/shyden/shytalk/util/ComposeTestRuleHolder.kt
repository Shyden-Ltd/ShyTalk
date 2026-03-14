package com.shyden.shytalk.util

import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.createComposeRule

/**
 * Singleton that holds the ComposeTestRule shared across Cucumber step definition classes.
 * Cucumber creates fresh instances of step classes for each scenario, but we need a single
 * ComposeTestRule instance per scenario. This holder is initialized in CommonSteps @Before
 * and accessed by all other step definition classes.
 */
object ComposeTestRuleHolder {
    lateinit var rule: ComposeContentTestRule
        private set

    fun initialize() {
        rule = createComposeRule()
    }

    val isInitialized: Boolean
        get() = ::rule.isInitialized
}
