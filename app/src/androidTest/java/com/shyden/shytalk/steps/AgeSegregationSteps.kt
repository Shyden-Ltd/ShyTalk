package com.shyden.shytalk.steps

import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.age_seg_age_down_admin_pm
import com.shyden.shytalk.resources.age_seg_age_up_welcome_pm
import com.shyden.shytalk.resources.age_seg_cross_cohort_blocked_toast
import com.shyden.shytalk.resources.age_seg_group_frozen_banner
import com.shyden.shytalk.resources.age_seg_relationship_removed_pm
import com.shyden.shytalk.resources.age_seg_room_removed_pm
import com.shyden.shytalk.resources.age_seg_room_unavailable
import com.shyden.shytalk.resources.age_seg_thread_hidden_pm
import com.shyden.shytalk.resources.age_seg_unavailable
import com.shyden.shytalk.resources.age_seg_user_unavailable
import io.cucumber.java.en.Then
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import kotlin.test.assertTrue

// UK OSA #17 PR 14 — Gherkin step definitions for the two age-segregation
// E2E feature files (age_segregation_discovery.feature,
// age_segregation_age_up.feature). Asserts that every age_seg_* string
// key shipped in PR 14 is present in the active locale bundle by
// resolving the generated StringResource accessor at test time. A
// missing key fails at the compile step (the import line won't resolve);
// an empty or whitespace-only resolved value fails at the assertion.
class AgeSegregationSteps {
    private val keyToResource: Map<String, StringResource> =
        mapOf(
            "age_seg_unavailable" to Res.string.age_seg_unavailable,
            "age_seg_user_unavailable" to Res.string.age_seg_user_unavailable,
            "age_seg_room_unavailable" to Res.string.age_seg_room_unavailable,
            "age_seg_cross_cohort_blocked_toast" to Res.string.age_seg_cross_cohort_blocked_toast,
            "age_seg_relationship_removed_pm" to Res.string.age_seg_relationship_removed_pm,
            "age_seg_room_removed_pm" to Res.string.age_seg_room_removed_pm,
            "age_seg_thread_hidden_pm" to Res.string.age_seg_thread_hidden_pm,
            "age_seg_group_frozen_banner" to Res.string.age_seg_group_frozen_banner,
            "age_seg_age_up_welcome_pm" to Res.string.age_seg_age_up_welcome_pm,
            "age_seg_age_down_admin_pm" to Res.string.age_seg_age_down_admin_pm,
        )

    @Then("the locale bundle contains the string {string}")
    fun theLocaleBundleContainsTheString(key: String) {
        val resource =
            keyToResource[key]
                ?: error("Unknown age_seg_* string key in test fixture: '$key'. Add it to AgeSegregationSteps.keyToResource.")
        val resolved = runBlocking { getString(resource) }
        assertTrue(
            resolved.isNotBlank(),
            "Expected key '$key' to resolve to a non-blank string in the active locale bundle, but got '$resolved'.",
        )
    }
}
