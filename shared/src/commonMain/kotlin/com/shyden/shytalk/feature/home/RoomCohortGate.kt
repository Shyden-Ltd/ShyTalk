package com.shyden.shytalk.feature.home

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.effectiveCohort

/**
 * Returns true iff [room] should be visible to [viewer] under the
 * UK OSA #17 cohort-segregation rule. The room is visible when the
 * resolved owner's effective cohort matches the viewer's. Missing
 * owner from cache fails closed (drop) — there is no safe assumption
 * a minor caller can make about a room whose cohort we cannot prove.
 */
fun isRoomVisibleToCohort(
    room: ChatRoom,
    viewer: User,
    userCache: Map<String, User>,
): Boolean {
    val owner = userCache[room.ownerId] ?: return false
    return owner.effectiveCohort == viewer.effectiveCohort
}

/** Drops cross-cohort rooms from a list. Pure function, no I/O. */
fun filterRoomsByCohort(
    rooms: List<ChatRoom>,
    viewer: User,
    userCache: Map<String, User>,
): List<ChatRoom> = rooms.filter { isRoomVisibleToCohort(it, viewer, userCache) }

/**
 * Defense-in-depth: redact (drop) cross-cohort seated users from the
 * map exposed to the home screen. Same-cohort rooms can still contain
 * a seated user whose cohort flipped mid-session (admin override, age-
 * up); redaction prevents leaking their identity to the viewer.
 */
fun redactCrossCohortSeatUsers(
    seatUsers: Map<String, User>,
    viewer: User,
): Map<String, User> {
    val viewerCohort = viewer.effectiveCohort
    return seatUsers.filterValues { it.effectiveCohort == viewerCohort }
}
