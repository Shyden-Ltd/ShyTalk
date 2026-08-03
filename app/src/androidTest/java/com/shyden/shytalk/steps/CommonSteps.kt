package com.shyden.shytalk.steps

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.fake.FakeAuthRepository
import com.shyden.shytalk.util.ComposeTestRuleHolder
import com.shyden.shytalk.util.launchMainScreen
import com.shyden.shytalk.util.launchNavGraph
import com.shyden.shytalk.util.launchSignIn
import com.shyden.shytalk.util.waitForTag
import com.shyden.shytalk.util.waitForTagToDisappear
import com.shyden.shytalk.util.waitForText
import io.cucumber.java.Before
import io.cucumber.java.en.Given
import io.cucumber.java.en.Then
import io.cucumber.java.en.When
import org.koin.java.KoinJavaComponent.getKoin

class CommonSteps {
    private val rule get() = ComposeTestRuleHolder.rule

    @Before
    fun setUp() {
        ComposeTestRuleHolder.initialize()
        val auth = getKoin().get<AuthRepository>() as? FakeAuthRepository
        auth?.reset()
    }

    // ── Navigation ────────────────────────────────────────────
    @Given("I am on the main screen")
    fun iAmOnTheMainScreen() {
        rule.launchMainScreen()
    }

    @Given("I am on the sign-in screen")
    fun iAmOnTheSignInScreen() {
        val fakeAuth = getKoin().get<AuthRepository>() as FakeAuthRepository
        fakeAuth.fakeAuthenticated = false
        fakeAuth.fakeUserId = null
        rule.launchSignIn()
    }

    @Given("I am on the {string} screen")
    fun iAmOnScreen(screenRoute: String) {
        rule.launchNavGraph(startDestination = screenRoute)
    }

    // ── Tab Navigation ────────────────────────────────────────
    @When("I tap the {string} tab")
    fun iTapTheTab(tabName: String) {
        val tag =
            when (tabName.lowercase()) {
                "rooms" -> "main_roomsTab"
                "messages" -> "main_messagesTab"
                "profile" -> "main_profileTab"
                else -> error("Unknown tab: $tabName")
            }
        rule.waitForTag(tag)
        rule.onNodeWithTag(tag).performClick()
    }

    // ── Interactions ──────────────────────────────────────────
    @When("I tap the element with tag {string}")
    fun iTapElementWithTag(tag: String) {
        rule.waitForTag(tag)
        rule.onNodeWithTag(tag).performClick()
    }

    @When("I tap the text {string}")
    fun iTapText(text: String) {
        rule.waitForText(text)
        rule.onNodeWithText(text).performClick()
    }

    @When("I type {string} into the field with tag {string}")
    fun iTypeIntoField(
        text: String,
        tag: String,
    ) {
        rule.waitForTag(tag)
        rule.onNodeWithTag(tag).performTextInput(text)
    }

    /**
     * One declarative step for "the user agrees to everything", rather than
     * four consecutive tap steps. Keeps the legal scenario within the 6-step
     * cap and keeps the policy LIST an implementation detail — adding a fifth
     * policy changes this step, not every scenario that consents.
     */
    @When("I tick every legal policy checkbox")
    fun iTickEveryLegalCheckbox() {
        listOf(
            "legal_checkbox_PrivacyPolicy",
            "legal_checkbox_CommunityStandards",
            "legal_checkbox_TermsAndConditions",
            "legal_checkbox_CyberBullyingPolicy",
        ).forEach { tag ->
            rule.waitForTag(tag)
            rule.onNodeWithTag(tag).performClick()
        }
    }

    // ── Assertions ────────────────────────────────────────────
    @Then("I should see the element with tag {string}")
    fun iShouldSeeElementWithTag(tag: String) {
        rule.waitForTag(tag)
        rule.onNodeWithTag(tag).assertIsDisplayed()
    }

    @Then("I should see the text {string}")
    fun iShouldSeeText(text: String) {
        rule.waitForText(text)
    }

    @Then("I should not see the element with tag {string}")
    fun iShouldNotSeeElementWithTag(tag: String) {
        // Condition-based, not instantaneous: a dialog dismissal takes a few
        // frames, and the corpus used to pad for it with `I wait N
        // milliseconds`. Polling until absent removes the sleep and the step.
        rule.waitForTagToDisappear(tag)
    }

    // ── Wait Helpers ──────────────────────────────────────────
    @When("I wait for the element with tag {string}")
    fun iWaitForTag(tag: String) {
        rule.waitForTag(tag)
    }

    @When("I wait {int} milliseconds")
    fun iWaitMilliseconds(ms: Int) {
        rule.mainClock.advanceTimeBy(ms.toLong())
        rule.waitForIdle()
    }
}
