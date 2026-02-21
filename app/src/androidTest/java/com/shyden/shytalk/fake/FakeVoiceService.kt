package com.shyden.shytalk.fake

import com.shyden.shytalk.data.remote.VoiceConnectionState
import com.shyden.shytalk.data.remote.VoiceService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class FakeVoiceService : VoiceService {
    override val speakingUsers: StateFlow<Set<String>> = MutableStateFlow(emptySet())
    private val _isJoined = MutableStateFlow(false)
    override val isJoined: StateFlow<Boolean> = _isJoined
    private val _connectionState = MutableStateFlow(VoiceConnectionState.DISCONNECTED)
    override val connectionState: StateFlow<VoiceConnectionState> = _connectionState
    override val error: StateFlow<String?> = MutableStateFlow(null)

    override suspend fun joinRoom(roomName: String, userId: String) {
        _connectionState.value = VoiceConnectionState.CONNECTED
        _isJoined.value = true
    }
    override fun leaveChannel() {
        _connectionState.value = VoiceConnectionState.DISCONNECTED
        _isJoined.value = false
    }
    override fun setMicrophoneEnabled(enabled: Boolean) { /* no-op */ }
    override fun setAudioMode(voiceMode: Boolean) { /* no-op */ }
    override fun clearError() { /* no-op */ }
}
