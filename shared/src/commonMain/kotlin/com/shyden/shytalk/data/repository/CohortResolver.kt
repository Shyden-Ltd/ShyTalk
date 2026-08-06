package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.COHORT_MINOR
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.effectiveCohort

/**
 * Resolve the caller's effective cohort for an OSA-segregated query, failing
 * CLOSED to [COHORT_MINOR] when the user cannot be resolved.
 *
 * UK OSA #17 / SHY-0102 — the rooms read rule (`firestore.rules` L192) gates a
 * `list` on `resource.data.cohort == request.auth.token.cohort`. A client query
 * must therefore pin `where('cohort','==', <this value>)` or be denied. Two
 * properties make this the safe single source of the cohort a query pins:
 *
 *  - **Fail closed.** A missing/failed user lookup (or a `null` [userId]) yields
 *    the most-restrictive cohort `"minor"`. The worst case for an unresolved
 *    adult is a denied/empty list — NEVER a cross-cohort leak, because the rule
 *    rejects any pin that doesn't equal the signed JWT cohort claim.
 *  - **Honour the override.** [effectiveCohort] resolves `cohortOverride ?: cohort`
 *    and fails closed on a corrupted `cohort` value, matching exactly the value
 *    the server mints into the JWT claim (the same value `createRoom` stamps).
 *
 * Centralising the default here keeps the OSA "fail closed when ambiguous"
 * decision in ONE auditable place rather than duplicated at each call-site.
 */
suspend fun UserRepository.resolveEffectiveCohort(userId: String?): String =
    if (userId == null) {
        COHORT_MINOR
    } else {
        when (val result = getUser(userId)) {
            is Resource.Success -> result.data.effectiveCohort
            else -> COHORT_MINOR
        }
    }
