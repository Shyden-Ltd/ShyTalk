package com.shyden.shytalk.steps

import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.shyden.shytalk.util.ComposeTestRuleHolder
import com.shyden.shytalk.util.waitForText
import io.cucumber.java.en.When

class PinSteps {
    private val rule get() = ComposeTestRuleHolder.rule

    @When("I enter PIN {string}")
    fun iEnterPin(pin: String) {
        pin.forEach { digit ->
            rule.waitForText(digit.toString())
            rule.onNodeWithText(digit.toString()).performClick()
        }
    }

    @When("I fail PIN entry {int} times")
    fun iFailPinEntryTimes(count: Int) {
        repeat(count) {
            iEnterPin("0000")
            rule.waitForText("Unlock")
            rule.onNodeWithText("Unlock").performClick()
            rule.mainClock.advanceTimeBy(1500)
        }
    }
}
