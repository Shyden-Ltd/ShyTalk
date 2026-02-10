package com.shyden.shytalk.data.remote

import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PresenceServiceTest {

    private lateinit var database: FirebaseDatabase
    private lateinit var presenceService: PresenceService
    private lateinit var rootRef: DatabaseReference

    @Before
    fun setup() {
        database = mockk(relaxed = true)
        rootRef = mockk(relaxed = true)
        every { database.getReference(any<String>()) } returns rootRef
        presenceService = PresenceService(database)
    }

    @Test
    fun `setPresence writes to correct path`() {
        presenceService.setPresence("room-1", "user-1")

        verify { database.getReference("presence/room-1/user-1") }
        verify { rootRef.setValue(any()) }
        verify { rootRef.onDisconnect() }
    }

    @Test
    fun `removePresence clears reference and cancels onDisconnect`() {
        presenceService.setPresence("room-1", "user-1")
        presenceService.removePresence()

        verify { rootRef.removeValue() }
    }

    @Test
    fun `removePresence is no-op when not in room`() {
        // No setPresence called
        presenceService.removePresence()

        verify(exactly = 0) { rootRef.removeValue() }
    }

    @Test
    fun `setPresence cleans up previous room when switching`() {
        val ref1 = mockk<DatabaseReference>(relaxed = true)
        val ref2 = mockk<DatabaseReference>(relaxed = true)

        every { database.getReference("presence/room-1/user-1") } returns ref1
        every { database.getReference("presence/room-2/user-1") } returns ref2

        presenceService.setPresence("room-1", "user-1")
        presenceService.setPresence("room-2", "user-1")

        // First room should have been cleaned up
        verify { ref1.removeValue() }
        verify { ref2.setValue(any()) }
    }

    @Test
    fun `observeRoomPresence emits present user IDs`() = runTest {
        val listenerSlot = slot<ValueEventListener>()
        val presenceRef = mockk<DatabaseReference>(relaxed = true)
        every { database.getReference("presence/room-1") } returns presenceRef
        every { presenceRef.addValueEventListener(capture(listenerSlot)) } answers { listenerSlot.captured }

        var emittedUsers: Set<String>? = null
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            presenceService.observeRoomPresence("room-1").first { users ->
                emittedUsers = users
                true
            }
        }

        // Simulate RTDB snapshot with 2 users
        val child1 = mockk<DataSnapshot> { every { key } returns "user-1" }
        val child2 = mockk<DataSnapshot> { every { key } returns "user-2" }
        val snapshot = mockk<DataSnapshot> {
            every { children } returns listOf(child1, child2)
        }

        listenerSlot.captured.onDataChange(snapshot)

        assertEquals(setOf("user-1", "user-2"), emittedUsers)
        job.cancel()
    }

    @Test
    fun `observeRoomPresence emits empty set when no users present`() = runTest {
        val listenerSlot = slot<ValueEventListener>()
        val presenceRef = mockk<DatabaseReference>(relaxed = true)
        every { database.getReference("presence/room-1") } returns presenceRef
        every { presenceRef.addValueEventListener(capture(listenerSlot)) } answers { listenerSlot.captured }

        var emittedUsers: Set<String>? = null
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            presenceService.observeRoomPresence("room-1").first { users ->
                emittedUsers = users
                true
            }
        }

        val snapshot = mockk<DataSnapshot> {
            every { children } returns emptyList()
        }

        listenerSlot.captured.onDataChange(snapshot)

        assertTrue(emittedUsers!!.isEmpty())
        job.cancel()
    }

    @Test
    fun `observeRoomPresence removes listener on cancel`() = runTest {
        val listenerSlot = slot<ValueEventListener>()
        val presenceRef = mockk<DatabaseReference>(relaxed = true)
        every { database.getReference("presence/room-1") } returns presenceRef
        every { presenceRef.addValueEventListener(capture(listenerSlot)) } answers { listenerSlot.captured }

        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            presenceService.observeRoomPresence("room-1").collect { }
        }

        job.cancel()

        verify { presenceRef.removeEventListener(listenerSlot.captured) }
    }
}
