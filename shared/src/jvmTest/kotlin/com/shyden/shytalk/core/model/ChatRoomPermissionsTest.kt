package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Permission matrix for the moderation actions a user can take inside a room.
 *
 * Every test is built around an 8-seat room laid out as follows so the
 * scenarios mirror real usage:
 *
 *   seat 0 → owner            (always seated)
 *   seat 1 → host A
 *   seat 2 → host B
 *   seat 3 → attendee A
 *   seat 4 → attendee B
 *   seat 5 → attendee C
 *   seat 6 → attendee D
 *   seat 7 → attendee E
 *
 * The matrix verifies:
 *   - owners can act on hosts AND attendees
 *   - hosts can act on attendees but NOT on the owner OR other hosts
 *   - attendees can never act on anyone (kick / remove-from-seat / force-mute)
 *   - only the owner can take seat 0; non-owners can never take seat 0
 *   - hosts can self-invite to any non-owner seat ONLY when the room does not
 *     require approval; attendees ALWAYS go through the seat-request queue
 *   - already-muted seats cannot be force-muted again (only self-unmute)
 *
 * Plus boundary cases: empty seats, banned users (room is built without them
 * so kick of a stranger is rejected), invalid seat indices.
 */
class ChatRoomPermissionsTest {
    // ── Test fixture: full 8-seat room with mixed roles ─────────────

    private val owner = "owner-1"
    private val hostA = "host-a"
    private val hostB = "host-b"
    private val attA = "att-a"
    private val attB = "att-b"
    private val attC = "att-c"
    private val attD = "att-d"
    private val attE = "att-e"
    private val outsider = "outsider-1"

    private fun fullRoom(requireApproval: Boolean = false): ChatRoom =
        ChatRoom(
            roomId = "room-1",
            ownerId = owner,
            hostIds = setOf(hostA, hostB),
            participantIds = setOf(owner, hostA, hostB, attA, attB, attC, attD, attE),
            requireApproval = requireApproval,
            seats =
                mapOf(
                    "0" to Seat(userId = owner, state = SeatState.OCCUPIED),
                    "1" to Seat(userId = hostA, state = SeatState.OCCUPIED),
                    "2" to Seat(userId = hostB, state = SeatState.OCCUPIED),
                    "3" to Seat(userId = attA, state = SeatState.OCCUPIED),
                    "4" to Seat(userId = attB, state = SeatState.OCCUPIED),
                    "5" to Seat(userId = attC, state = SeatState.OCCUPIED),
                    "6" to Seat(userId = attD, state = SeatState.OCCUPIED),
                    "7" to Seat(userId = attE, state = SeatState.OCCUPIED),
                ),
        )

    // ─── resolveRole baseline ──────────────────────────────────────

    @Test
    fun `resolveRole identifies owner host attendee correctly`() {
        val r = fullRoom()
        assertTrue(r.resolveRole(owner) == RoomRole.OWNER)
        assertTrue(r.resolveRole(hostA) == RoomRole.HOST)
        assertTrue(r.resolveRole(hostB) == RoomRole.HOST)
        assertTrue(r.resolveRole(attA) == RoomRole.ATTENDEE)
        assertTrue(r.resolveRole(outsider) == RoomRole.ATTENDEE)
    }

    // ─── canKickUser ────────────────────────────────────────────────

    @Test
    fun `owner can kick any host or attendee`() {
        val r = fullRoom()
        assertTrue(r.canKickUser(owner, hostA))
        assertTrue(r.canKickUser(owner, hostB))
        assertTrue(r.canKickUser(owner, attA))
        assertTrue(r.canKickUser(owner, attE))
    }

    @Test
    fun `owner cannot kick themselves`() {
        val r = fullRoom()
        assertFalse(r.canKickUser(owner, owner))
    }

    @Test
    fun `host can kick attendees`() {
        val r = fullRoom()
        assertTrue(r.canKickUser(hostA, attA))
        assertTrue(r.canKickUser(hostA, attE))
        assertTrue(r.canKickUser(hostB, attC))
    }

    @Test
    fun `host cannot kick the owner`() {
        val r = fullRoom()
        assertFalse(r.canKickUser(hostA, owner))
        assertFalse(r.canKickUser(hostB, owner))
    }

    @Test
    fun `host cannot kick another host`() {
        val r = fullRoom()
        assertFalse(r.canKickUser(hostA, hostB))
        assertFalse(r.canKickUser(hostB, hostA))
        // And not themselves
        assertFalse(r.canKickUser(hostA, hostA))
    }

    @Test
    fun `attendee cannot kick anyone — owner host attendee or themselves`() {
        val r = fullRoom()
        assertFalse(r.canKickUser(attA, owner))
        assertFalse(r.canKickUser(attA, hostA))
        assertFalse(r.canKickUser(attA, attB))
        assertFalse(r.canKickUser(attA, attA))
    }

    @Test
    fun `outsider (not in room at all) cannot kick anyone`() {
        val r = fullRoom()
        assertFalse(r.canKickUser(outsider, owner))
        assertFalse(r.canKickUser(outsider, hostA))
        assertFalse(r.canKickUser(outsider, attA))
    }

    // ─── canRemoveFromSeat ─────────────────────────────────────────

    @Test
    fun `nobody can remove the user in seat 0 (owner seat)`() {
        val r = fullRoom()
        assertFalse(r.canRemoveFromSeat(owner, 0))
        assertFalse(r.canRemoveFromSeat(hostA, 0))
        assertFalse(r.canRemoveFromSeat(attA, 0))
    }

    @Test
    fun `owner can remove host or attendee from any non-owner seat`() {
        val r = fullRoom()
        assertTrue(r.canRemoveFromSeat(owner, 1)) // host A
        assertTrue(r.canRemoveFromSeat(owner, 2)) // host B
        assertTrue(r.canRemoveFromSeat(owner, 3)) // att A
        assertTrue(r.canRemoveFromSeat(owner, 7)) // att E
    }

    @Test
    fun `host can remove attendees but NOT other hosts`() {
        val r = fullRoom()
        assertFalse(r.canRemoveFromSeat(hostA, 2)) // host B's seat
        assertFalse(r.canRemoveFromSeat(hostB, 1)) // host A's seat
        assertTrue(r.canRemoveFromSeat(hostA, 3)) // att A
        assertTrue(r.canRemoveFromSeat(hostB, 7)) // att E
    }

    @Test
    fun `attendee cannot remove anyone — including themselves`() {
        val r = fullRoom()
        assertFalse(r.canRemoveFromSeat(attA, 1)) // host A
        assertFalse(r.canRemoveFromSeat(attA, 4)) // att B
        assertFalse(r.canRemoveFromSeat(attA, 3)) // their own seat
    }

    @Test
    fun `removeFromSeat returns false for an empty seat`() {
        val r = fullRoom().copy(seats = fullRoom().seats + ("3" to Seat(userId = null, state = SeatState.EMPTY)))
        assertFalse(r.canRemoveFromSeat(owner, 3)) // empty
    }

    @Test
    fun `removeFromSeat returns false for an out-of-range index`() {
        val r = fullRoom()
        assertFalse(r.canRemoveFromSeat(owner, 99))
    }

    // ─── canForceMute ──────────────────────────────────────────────

    @Test
    fun `nobody can force-mute the owner (seat 0)`() {
        val r = fullRoom()
        assertFalse(r.canForceMute(owner, 0))
        assertFalse(r.canForceMute(hostA, 0))
        assertFalse(r.canForceMute(attA, 0))
    }

    @Test
    fun `owner can force-mute any host or attendee`() {
        val r = fullRoom()
        assertTrue(r.canForceMute(owner, 1))
        assertTrue(r.canForceMute(owner, 3))
        assertTrue(r.canForceMute(owner, 7))
    }

    @Test
    fun `host can force-mute attendees but NOT other hosts`() {
        val r = fullRoom()
        assertFalse(r.canForceMute(hostA, 2))
        assertFalse(r.canForceMute(hostB, 1))
        assertTrue(r.canForceMute(hostA, 3))
        assertTrue(r.canForceMute(hostB, 7))
    }

    @Test
    fun `attendee cannot force-mute anyone`() {
        val r = fullRoom()
        assertFalse(r.canForceMute(attA, 1)) // host
        assertFalse(r.canForceMute(attA, 4)) // another attendee
    }

    @Test
    fun `force-mute returns false when the seat is already muted`() {
        // Once a seat is muted, only the user themselves can unmute — host/owner
        // cannot toggle it back via force-mute.
        val mutedSeats = fullRoom().seats + ("3" to Seat(userId = attA, state = SeatState.OCCUPIED, isMuted = true))
        val r = fullRoom().copy(seats = mutedSeats)
        assertFalse(r.canForceMute(owner, 3))
        assertFalse(r.canForceMute(hostA, 3))
    }

    // ─── canTakeSeatDirectly ───────────────────────────────────────

    @Test
    fun `seat 0 can only be taken by the owner`() {
        val emptySeats = fullRoom().seats + ("0" to Seat(userId = null, state = SeatState.EMPTY))
        val r = fullRoom().copy(seats = emptySeats)
        assertTrue(r.canTakeSeatDirectly(owner, 0))
        assertFalse(r.canTakeSeatDirectly(hostA, 0))
        assertFalse(r.canTakeSeatDirectly(attA, 0))
    }

    @Test
    fun `owner cannot take any non-owner seat directly`() {
        val withEmpty =
            fullRoom().copy(
                seats = fullRoom().seats + ("3" to Seat(userId = null, state = SeatState.EMPTY)),
            )
        assertFalse(withEmpty.canTakeSeatDirectly(owner, 3))
    }

    @Test
    fun `host can self-invite to a non-owner seat when room does NOT require approval`() {
        val withEmpty =
            fullRoom(requireApproval = false).copy(
                seats = fullRoom().seats + ("3" to Seat(userId = null, state = SeatState.EMPTY)),
            )
        assertTrue(withEmpty.canTakeSeatDirectly(hostA, 3))
    }

    @Test
    fun `host CANNOT self-invite when room requires approval — they queue too`() {
        val withEmpty =
            fullRoom(requireApproval = true).copy(
                seats = fullRoom().seats + ("3" to Seat(userId = null, state = SeatState.EMPTY)),
            )
        assertFalse(withEmpty.canTakeSeatDirectly(hostA, 3))
    }

    @Test
    fun `attendee can NEVER take a seat directly — must go through seat-request flow`() {
        val openRoom =
            fullRoom(requireApproval = false).copy(
                seats = fullRoom().seats + ("3" to Seat(userId = null, state = SeatState.EMPTY)),
            )
        val approvalRoom =
            fullRoom(requireApproval = true).copy(
                seats = fullRoom().seats + ("3" to Seat(userId = null, state = SeatState.EMPTY)),
            )
        assertFalse(openRoom.canTakeSeatDirectly(attA, 3))
        assertFalse(approvalRoom.canTakeSeatDirectly(attA, 3))
    }

    @Test
    fun `cannot take a seat that is already occupied — even by the owner`() {
        val r = fullRoom() // every seat occupied
        assertFalse(r.canTakeSeatDirectly(owner, 0)) // already in seat 0
        assertFalse(r.canTakeSeatDirectly(hostA, 3))
        assertFalse(r.canTakeSeatDirectly(attA, 4))
    }

    @Test
    fun `cannot take a seat at an invalid index`() {
        val r = fullRoom()
        assertFalse(r.canTakeSeatDirectly(owner, 99))
        assertFalse(r.canTakeSeatDirectly(hostA, 99))
    }

    // ─── canInvite ─────────────────────────────────────────────────

    @Test
    fun `owner can always invite`() {
        assertTrue(fullRoom(requireApproval = false).canInvite(owner))
        assertTrue(fullRoom(requireApproval = true).canInvite(owner))
    }

    @Test
    fun `host can invite when approval is not required`() {
        assertTrue(fullRoom(requireApproval = false).canInvite(hostA))
    }

    @Test
    fun `host CANNOT invite when approval is required`() {
        assertFalse(fullRoom(requireApproval = true).canInvite(hostA))
    }

    @Test
    fun `attendee can never invite`() {
        assertFalse(fullRoom(requireApproval = false).canInvite(attA))
        assertFalse(fullRoom(requireApproval = true).canInvite(attA))
    }
}
