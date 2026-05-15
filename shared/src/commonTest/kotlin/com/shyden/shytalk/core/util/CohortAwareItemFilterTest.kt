package com.shyden.shytalk.core.util

import com.shyden.shytalk.core.model.User
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Tests for [cohortVisibility] and [filterUsersByCohort] — the client-side
 * defence-in-depth layer (UK OSA #17 PR 12). The server already filters
 * lists per cohort, so this layer only catches:
 *   - stale offline-cache items that have aged-up across cohorts
 *   - direct fetches that bypass the server's list endpoint
 *   - tampered builds whose modified clients skip server filters
 *
 * Semantics MUST mirror `express-api/src/utils/cohort-filter.js` so a
 * server-blocked user is also client-blocked, and vice versa.
 */
class CohortAwareItemFilterTest {
    @Test
    fun `same-cohort returns Visible regardless of policy`() {
        assertEquals(
            CohortVisibility.Visible,
            cohortVisibility(COHORT_ADULT, COHORT_ADULT, CrossCohortPolicy.PLACEHOLDER),
        )
        assertEquals(
            CohortVisibility.Visible,
            cohortVisibility(COHORT_ADULT, COHORT_ADULT, CrossCohortPolicy.HIDE),
        )
        assertEquals(
            CohortVisibility.Visible,
            cohortVisibility(COHORT_MINOR, COHORT_MINOR, CrossCohortPolicy.HIDE),
        )
    }

    @Test
    fun `cross-cohort PLACEHOLDER policy returns Unavailable`() {
        assertEquals(
            CohortVisibility.PlaceholderUnavailable,
            cohortVisibility(COHORT_ADULT, COHORT_MINOR, CrossCohortPolicy.PLACEHOLDER),
        )
        assertEquals(
            CohortVisibility.PlaceholderUnavailable,
            cohortVisibility(COHORT_MINOR, COHORT_ADULT, CrossCohortPolicy.PLACEHOLDER),
        )
    }

    @Test
    fun `cross-cohort HIDE policy returns Hidden`() {
        assertEquals(
            CohortVisibility.Hidden,
            cohortVisibility(COHORT_ADULT, COHORT_MINOR, CrossCohortPolicy.HIDE),
        )
        assertEquals(
            CohortVisibility.Hidden,
            cohortVisibility(COHORT_MINOR, COHORT_ADULT, CrossCohortPolicy.HIDE),
        )
    }

    @Test
    fun `invalid cohort strings fall back to minor — most restrictive`() {
        // Garbage viewerCohort treated as minor → cross with adult item
        assertEquals(
            CohortVisibility.PlaceholderUnavailable,
            cohortVisibility("garbage", COHORT_ADULT, CrossCohortPolicy.PLACEHOLDER),
        )
        // Garbage itemCohort treated as minor → adult viewer is cross
        assertEquals(
            CohortVisibility.PlaceholderUnavailable,
            cohortVisibility(COHORT_ADULT, "", CrossCohortPolicy.PLACEHOLDER),
        )
        // Both garbage → both minor → Visible
        assertEquals(
            CohortVisibility.Visible,
            cohortVisibility("foo", "bar", CrossCohortPolicy.PLACEHOLDER),
        )
    }

    @Test
    fun `filterUsersByCohort with PLACEHOLDER preserves cardinality`() {
        val viewer = User(uid = "v", cohort = COHORT_ADULT)
        val users =
            listOf(
                User(uid = "a", cohort = COHORT_ADULT),
                User(uid = "m", cohort = COHORT_MINOR),
                User(uid = "a2", cohort = COHORT_ADULT),
            )

        val result = filterUsersByCohort(viewer, users, CrossCohortPolicy.PLACEHOLDER)

        assertEquals(3, result.size, "PLACEHOLDER preserves count")
        assertTrue(result[0] is CohortFilteredEntry.Visible)
        assertTrue(result[1] is CohortFilteredEntry.Placeholder)
        assertTrue(result[2] is CohortFilteredEntry.Visible)
    }

    @Test
    fun `filterUsersByCohort with HIDE drops cross-cohort`() {
        val viewer = User(uid = "v", cohort = COHORT_ADULT)
        val users =
            listOf(
                User(uid = "a", cohort = COHORT_ADULT),
                User(uid = "m", cohort = COHORT_MINOR),
                User(uid = "a2", cohort = COHORT_ADULT),
            )

        val result = filterUsersByCohort(viewer, users, CrossCohortPolicy.HIDE)

        assertEquals(2, result.size, "HIDE removes cross-cohort entries")
        val visibleUids = result.filterIsInstance<CohortFilteredEntry.Visible<User>>().map { it.item.uid }
        assertEquals(listOf("a", "a2"), visibleUids)
    }

    @Test
    fun `filterUsersByCohort honours cohortOverride on viewer and item`() {
        // Viewer's cohort is "minor" but admin override makes them effective adult
        val viewer = User(uid = "v", cohort = COHORT_MINOR, cohortOverride = COHORT_ADULT)
        val users =
            listOf(
                User(uid = "a", cohort = COHORT_ADULT, cohortOverride = null),
                // Item's underlying cohort adult but admin clamped to minor → cross-cohort
                User(uid = "clamped", cohort = COHORT_ADULT, cohortOverride = COHORT_MINOR),
            )

        val result = filterUsersByCohort(viewer, users, CrossCohortPolicy.HIDE)
        assertEquals(1, result.size)
        assertEquals(
            "a",
            (result.single() as CohortFilteredEntry.Visible<User>).item.uid,
        )
    }

    @Test
    fun `empty list returns empty result`() {
        val viewer = User(uid = "v", cohort = COHORT_ADULT)
        assertEquals(emptyList(), filterUsersByCohort(viewer, emptyList(), CrossCohortPolicy.PLACEHOLDER))
        assertEquals(emptyList(), filterUsersByCohort(viewer, emptyList(), CrossCohortPolicy.HIDE))
    }

    @Test
    fun `placeholder entries carry stable item key for Compose re-keying`() {
        val viewer = User(uid = "v", cohort = COHORT_ADULT)
        val users = listOf(User(uid = "minor-1", cohort = COHORT_MINOR))

        val result = filterUsersByCohort(viewer, users, CrossCohortPolicy.PLACEHOLDER)
        val placeholder = result.single() as CohortFilteredEntry.Placeholder
        assertEquals("minor-1", placeholder.key)
    }

    @Test
    fun `filterSameCohortAs is shorthand for HIDE-policy filter`() {
        val viewer = User(uid = "v", cohort = COHORT_ADULT)
        val users =
            listOf(
                User(uid = "a", cohort = COHORT_ADULT),
                User(uid = "m", cohort = COHORT_MINOR),
                User(uid = "a2", cohort = COHORT_ADULT),
            )

        assertEquals(listOf("a", "a2"), users.filterSameCohortAs(viewer).map { it.uid })
    }

    @Test
    fun `filterSameCohortAs on empty list returns empty`() {
        val viewer = User(uid = "v", cohort = COHORT_ADULT)
        assertEquals(emptyList(), emptyList<User>().filterSameCohortAs(viewer))
    }

    @Test
    fun `filterSameCohortAs honours cohortOverride end-to-end`() {
        val viewer = User(uid = "v", cohort = COHORT_MINOR, cohortOverride = COHORT_ADULT)
        val users =
            listOf(
                User(uid = "a", cohort = COHORT_ADULT),
                User(uid = "a-clamped", cohort = COHORT_ADULT, cohortOverride = COHORT_MINOR),
                User(uid = "m", cohort = COHORT_MINOR),
            )

        assertEquals(listOf("a"), users.filterSameCohortAs(viewer).map { it.uid })
    }
}
