package com.shyden.shytalk.feature.home

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.COHORT_ADULT
import com.shyden.shytalk.core.util.COHORT_MINOR
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Pure-helper tests for the home-screen room cohort gate (UK OSA #17
 * PR 12). The gate is the *client-side mirror* of the Firestore rule
 * gate from PR 3 + the Express room-join gate from PR 7. The server
 * already filters cross-cohort rooms out of the active-rooms listing,
 * so this client gate exists to catch:
 *   - stale offline-cache rooms where the owner aged-up since cache
 *     was populated
 *   - deep-linked rooms (notification, share link) where the listing
 *     filter was bypassed
 *
 * Failure mode: cross-cohort room renders to a minor → safeguarding
 * incident. Therefore the test bias is "drop on any ambiguity"
 * (most-restrictive).
 */
class RoomCohortGateTest {
    private fun room(
        roomId: String,
        ownerId: String,
    ) = ChatRoom(roomId = roomId, ownerId = ownerId)

    private fun adult(uid: String) = User(uid = uid, cohort = COHORT_ADULT)

    private fun minor(uid: String) = User(uid = uid, cohort = COHORT_MINOR)

    @Test
    fun `same-cohort room visible to viewer`() {
        val viewer = adult("v")
        val r = room("r1", "owner-a")
        val cache = mapOf("owner-a" to adult("owner-a"))

        assertTrue(isRoomVisibleToCohort(r, viewer, cache))
    }

    @Test
    fun `cross-cohort room hidden from viewer`() {
        val viewer = adult("v")
        val r = room("r1", "owner-m")
        val cache = mapOf("owner-m" to minor("owner-m"))

        assertFalse(isRoomVisibleToCohort(r, viewer, cache))
    }

    @Test
    fun `cross-cohort room with PLACEHOLDER decision still drops from active list`() {
        // Even when display policy is PLACEHOLDER elsewhere, the room
        // gate at the list level always drops (rooms are an enter-able
        // resource — there is no UX value in showing an un-enterable
        // tile, and rendering the placeholder would leak the existence
        // of cross-cohort rooms in the minor's UI).
        val viewer = minor("v")
        val r = room("r1", "owner-a")
        val cache = mapOf("owner-a" to adult("owner-a"))

        assertFalse(isRoomVisibleToCohort(r, viewer, cache))
    }

    @Test
    fun `owner missing from cache fails closed (drops room)`() {
        // No cached owner doc → cannot prove same-cohort → drop (most
        // restrictive). The active-rooms query batch-loads owners, so
        // a miss usually means the doc was deleted (account reaped).
        val viewer = adult("v")
        val r = room("r1", "owner-ghost")
        val cache = emptyMap<String, User>()

        assertFalse(isRoomVisibleToCohort(r, viewer, cache))
    }

    @Test
    fun `cohortOverride on owner is honored`() {
        // Owner's stored cohort is "adult" but admin clamped them to
        // "minor" → effective cohort = minor → drop for adult viewer.
        val viewer = adult("v")
        val ownerClamped = User(uid = "owner", cohort = COHORT_ADULT, cohortOverride = COHORT_MINOR)
        val r = room("r1", "owner")
        val cache = mapOf("owner" to ownerClamped)

        assertFalse(isRoomVisibleToCohort(r, viewer, cache))
    }

    @Test
    fun `viewer with cohortOverride uses effective cohort`() {
        // Viewer's stored cohort is "minor" but admin uplifted to "adult"
        // → can see adult rooms.
        val viewer = User(uid = "v", cohort = COHORT_MINOR, cohortOverride = COHORT_ADULT)
        val r = room("r1", "owner-a")
        val cache = mapOf("owner-a" to adult("owner-a"))

        assertTrue(isRoomVisibleToCohort(r, viewer, cache))
    }

    @Test
    fun `filterRoomsByCohort drops mixed list to same-cohort only`() {
        val viewer = adult("v")
        val rooms =
            listOf(
                room("r-a1", "owner-a1"),
                room("r-m", "owner-m"),
                room("r-a2", "owner-a2"),
            )
        val cache =
            mapOf(
                "owner-a1" to adult("owner-a1"),
                "owner-m" to minor("owner-m"),
                "owner-a2" to adult("owner-a2"),
            )

        val result = filterRoomsByCohort(rooms, viewer, cache)
        assertEquals(listOf("r-a1", "r-a2"), result.map { it.roomId })
    }

    @Test
    fun `filterRoomsByCohort empty input returns empty`() {
        val viewer = adult("v")
        assertEquals(emptyList(), filterRoomsByCohort(emptyList(), viewer, emptyMap()))
    }

    @Test
    fun `redactCrossCohortSeatUsers replaces foreign-cohort entries with placeholder`() {
        // Defense-in-depth: even if a room slipped through the room
        // gate (e.g. owner same-cohort but a seated user is cross-
        // cohort after their cohort flipped mid-session), the seat-
        // user map should not expose their identity to the viewer.
        val viewer = adult("v")
        val seatUsers =
            mapOf(
                "u1" to adult("u1"),
                "u2" to minor("u2"),
                "u3" to adult("u3"),
            )

        val redacted = redactCrossCohortSeatUsers(seatUsers, viewer)
        assertEquals(setOf("u1", "u3"), redacted.keys)
    }
}
