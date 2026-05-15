package com.shyden.shytalk.core.util

import com.shyden.shytalk.core.model.User

// UK OSA #17 PR 12 — client-side defence-in-depth cohort filter.
//
// KMP mirror of `express-api/src/utils/cohort-filter.js`. The server is
// the primary enforcement layer (rules + Express middleware + list
// filters). This module catches the cases the server can't:
//   1. Stale offline cache items where the OWNER aged-up across cohorts
//      after the cache was populated.
//   2. Direct fetches (deep-link / notification / stale follow id) that
//      bypass the server's list endpoint and its built-in filter.
//   3. Tampered builds where modified clients skip the server's filter.
//
// Pure-function module — no I/O, no Firestore reads. Caller is expected
// to already have the `cohort`/`cohortOverride` fields on the items it
// wants to filter (server stamps these at write-time, PRs 7-10).

/** Cross-cohort handling policy chosen by each call site. */
enum class CrossCohortPolicy {
    /**
     * Preserve list cardinality — render an "unavailable" placeholder
     * tile in the cross-cohort row's place. Use in browse/discovery
     * surfaces where a list-length change would reveal cohort boundaries
     * to a fingerprinting observer (anti-fingerprinting).
     */
    PLACEHOLDER,

    /**
     * Drop cross-cohort entries entirely. Use in picker surfaces (new
     * message recipient, gift recipient, group-add) where an
     * un-selectable row has no UX value and only adds friction.
     */
    HIDE,
}

/** Decision for one item: visible, placeholder, or hidden. */
sealed interface CohortVisibility {
    data object Visible : CohortVisibility

    data object PlaceholderUnavailable : CohortVisibility

    data object Hidden : CohortVisibility
}

/** Resolved entry for a list — either the original item or a placeholder. */
sealed interface CohortFilteredEntry<out T> {
    data class Visible<T>(
        val item: T,
    ) : CohortFilteredEntry<T>

    /** Stable identifier so Compose `LazyColumn` `key {}` blocks remain consistent. */
    data class Placeholder(
        val key: String,
    ) : CohortFilteredEntry<Nothing>
}

private fun normalize(cohort: String): String =
    when (cohort) {
        COHORT_ADULT -> COHORT_ADULT
        COHORT_MINOR -> COHORT_MINOR
        else -> COHORT_MINOR
    }

/**
 * Decide the per-item visibility outcome. Pure function — caller chooses
 * how to render each case. Invalid cohort strings fail closed to "minor"
 * (most-restrictive) per the OSA fail-closed-when-ambiguous rule.
 */
fun cohortVisibility(
    viewerCohort: String,
    itemCohort: String,
    policy: CrossCohortPolicy,
): CohortVisibility {
    val v = normalize(viewerCohort)
    val i = normalize(itemCohort)
    if (v == i) return CohortVisibility.Visible
    return when (policy) {
        CrossCohortPolicy.PLACEHOLDER -> CohortVisibility.PlaceholderUnavailable
        CrossCohortPolicy.HIDE -> CohortVisibility.Hidden
    }
}

/**
 * Filter a list of users for [viewer]. PLACEHOLDER policy preserves
 * cardinality (cross-cohort entries become [CohortFilteredEntry.Placeholder]
 * with a stable key); HIDE drops them entirely.
 */
fun filterUsersByCohort(
    viewer: User,
    users: List<User>,
    policy: CrossCohortPolicy = CrossCohortPolicy.PLACEHOLDER,
): List<CohortFilteredEntry<User>> {
    if (users.isEmpty()) return emptyList()
    val viewerCohort = viewer.effectiveCohort
    return users.mapNotNull { u ->
        when (cohortVisibility(viewerCohort, u.effectiveCohort, policy)) {
            CohortVisibility.Visible -> CohortFilteredEntry.Visible(u)
            CohortVisibility.PlaceholderUnavailable -> CohortFilteredEntry.Placeholder(u.uid)
            CohortVisibility.Hidden -> null
        }
    }
}

/**
 * Drop cross-cohort users from a list (HIDE policy). Use at call sites
 * where placeholder rows have no UX value (recipient pickers, follow
 * lists, stalker lists). Equivalent to filtering on [User.effectiveCohort]
 * but goes through the central [cohortVisibility] decision so the
 * fail-closed-on-invalid-cohort rule applies uniformly.
 */
fun List<User>.filterSameCohortAs(viewer: User): List<User> {
    if (isEmpty()) return this
    val viewerCohort = viewer.effectiveCohort
    return filter { cohortVisibility(viewerCohort, it.effectiveCohort, CrossCohortPolicy.HIDE) == CohortVisibility.Visible }
}
