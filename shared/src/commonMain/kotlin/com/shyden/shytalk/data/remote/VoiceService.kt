package com.shyden.shytalk.data.remote

import kotlinx.coroutines.flow.StateFlow

enum class VoiceConnectionState { CONNECTED, DISCONNECTED, RECONNECTING }

interface VoiceService {
    val speakingUsers: StateFlow<Set<String>>
    val isJoined: StateFlow<Boolean>
    val connectionState: StateFlow<VoiceConnectionState>
    val error: StateFlow<String?>
    suspend fun joinRoom(roomName: String, userId: String)
    fun leaveChannel()
    fun setMicrophoneEnabled(enabled: Boolean)
    fun setAudioMode(voiceMode: Boolean)
    fun clearError()
}
