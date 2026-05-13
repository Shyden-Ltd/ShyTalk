package com.shyden.shytalk.data.repository

/**
 * Parsed response from `POST /api/users/:uniqueId/pm-lock-check`.
 *
 * The server-side route is shared between the legacy PM-lock auto-
 * unlock (PR 11) and the UK OSA #17 segregation cohort check.
 * Wire fields:
 *
 *  - [pmLocked] / [unlocked] are the PR 11 surface.
 *  - [cohort] / [cohortChanged] / [forceTokenRefresh] are the
 *    PR 2 segregation surface. When [forceTokenRefresh] is `true`,
 *    the caller MUST invoke `AuthRepository.refreshIdToken()` before
 *    the next Firestore read so the rules-layer sees the fresh
 *    `cohort` claim. Otherwise the rules-layer remains stale until
 *    Firebase's ~1h JWT auto-refresh closes the window, opening a
 *    cross-cohort read leak.
 *  - [alreadyCheckedToday] is the same-UTC-day throttle signal.
 *
 * All fields default to safe values so a server response that drops
 * one of them (older server, partial outage) doesn't crash the
 * parser. The default for [forceTokenRefresh] is `false` — most
 * conservative posture, avoids wasting Firebase mint quota on a
 * stale claim that wouldn't change anyway.
 */
data class PmLockCheckResult(
    val pmLocked: Boolean = false,
    val unlocked: Boolean = false,
    val alreadyCheckedToday: Boolean = false,
    val cohort: String = "minor",
    val cohortChanged: Boolean = false,
    val forceTokenRefresh: Boolean = false,
    val claimMintFailed: Boolean = false,
)
