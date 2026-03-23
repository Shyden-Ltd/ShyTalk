package com.shyden.shytalk.data.remote

import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Tests the VoiceService mock used throughout the test suite.
 * Validates that the mock setup matches the interface contract
 * and that the flows behave correctly in tests.
 */
class VoiceServiceContractTest {
    private val speakingFlow = MutableStateFlow<Set<String>>(emptySet())
    private val joinedFlow = MutableStateFlow(false)
    private val connectionFlow = MutableStateFlow(VoiceConnectionState.DISCONNECTED)
    private val errorFlow = MutableStateFlow<String?>(null)

    private lateinit var voiceService: VoiceService

    @Before
    fun setup() {
        voiceService = mockk(relaxed = true)
        every { voiceService.speakingUsers } returns speakingFlow
        every { voiceService.isJoined } returns joinedFlow
        every { voiceService.connectionState } returns connectionFlow
        every { voiceService.error } returns errorFlow
    }

    @Test
    fun `speakingUsers defaults to empty set`() {
        assertEquals(emptySet<String>(), voiceService.speakingUsers.value)
    }

    @Test
    fun `speakingUsers uses string identities`() {
        speakingFlow.value = setOf("user-1", "user-2")
        assertEquals(setOf("user-1", "user-2"), voiceService.speakingUsers.value)
    }

    @Test
    fun `isJoined defaults to false`() {
        assertFalse(voiceService.isJoined.value)
    }

    @Test
    fun `connectionState defaults to DISCONNECTED`() {
        assertEquals(VoiceConnectionState.DISCONNECTED, voiceService.connectionState.value)
    }

    @Test
    fun `connectionState transitions through expected states`() {
        connectionFlow.value = VoiceConnectionState.CONNECTED
        assertEquals(VoiceConnectionState.CONNECTED, voiceService.connectionState.value)

        connectionFlow.value = VoiceConnectionState.RECONNECTING
        assertEquals(VoiceConnectionState.RECONNECTING, voiceService.connectionState.value)

        connectionFlow.value = VoiceConnectionState.DISCONNECTED
        assertEquals(VoiceConnectionState.DISCONNECTED, voiceService.connectionState.value)
    }

    @Test
    fun `error defaults to null`() {
        assertNull(voiceService.error.value)
    }

    @Test
    fun `clearError can be called`() {
        voiceService.clearError()
        verify { voiceService.clearError() }
    }

    @Test
    fun `leaveChannel can be called`() {
        voiceService.leaveChannel()
        verify { voiceService.leaveChannel() }
    }

    @Test
    fun `setMicrophoneEnabled accepts boolean`() {
        voiceService.setMicrophoneEnabled(true)
        verify { voiceService.setMicrophoneEnabled(true) }

        voiceService.setMicrophoneEnabled(false)
        verify { voiceService.setMicrophoneEnabled(false) }
    }

    @Test
    fun `VoiceConnectionState has exactly three values`() {
        val values = VoiceConnectionState.entries
        assertEquals(3, values.size)
        assertTrue(values.contains(VoiceConnectionState.CONNECTED))
        assertTrue(values.contains(VoiceConnectionState.DISCONNECTED))
        assertTrue(values.contains(VoiceConnectionState.RECONNECTING))
    }
}
