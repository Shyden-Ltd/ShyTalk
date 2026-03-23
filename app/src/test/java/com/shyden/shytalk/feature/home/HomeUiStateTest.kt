package com.shyden.shytalk.feature.home

import com.shyden.shytalk.testutil.TestData
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeUiStateTest {
    @Test
    fun `default state has empty rooms`() {
        val state = HomeUiState()
        assertTrue(state.rooms.isEmpty())
    }

    @Test
    fun `default state is loading`() {
        assertTrue(HomeUiState().isLoading)
    }

    @Test
    fun `default state is not refreshing`() {
        assertFalse(HomeUiState().isRefreshing)
    }

    @Test
    fun `default state has no error`() {
        assertNull(HomeUiState().error)
    }

    @Test
    fun `default state has no createdRoomId`() {
        assertNull(HomeUiState().createdRoomId)
    }

    @Test
    fun `default state has empty seatUsers`() {
        assertTrue(HomeUiState().seatUsers.isEmpty())
    }

    @Test
    fun `copy updates rooms`() {
        val room = TestData.createTestRoom()
        val state = HomeUiState().copy(rooms = listOf(room))
        assertEquals(1, state.rooms.size)
        assertEquals(room.roomId, state.rooms[0].roomId)
    }

    @Test
    fun `copy updates error`() {
        val state = HomeUiState().copy(error = "Something went wrong")
        assertEquals("Something went wrong", state.error)
    }

    @Test
    fun `copy updates createdRoomId`() {
        val state = HomeUiState().copy(createdRoomId = "room-42")
        assertEquals("room-42", state.createdRoomId)
    }

    @Test
    fun `copy updates seatUsers`() {
        val user = TestData.createTestUser(uid = "u1")
        val state = HomeUiState().copy(seatUsers = mapOf("u1" to user))
        assertEquals(1, state.seatUsers.size)
        assertEquals("u1", state.seatUsers["u1"]?.uid)
    }

    @Test
    fun `default state has empty lastRoomName`() {
        assertEquals("", HomeUiState().lastRoomName)
    }

    @Test
    fun `copy updates lastRoomName`() {
        val state = HomeUiState().copy(lastRoomName = "My Room")
        assertEquals("My Room", state.lastRoomName)
    }

    @Test
    fun `REFRESH_INTERVAL_MS is 300 seconds`() {
        assertEquals(300_000L, HomeViewModel.REFRESH_INTERVAL_MS)
    }
}
