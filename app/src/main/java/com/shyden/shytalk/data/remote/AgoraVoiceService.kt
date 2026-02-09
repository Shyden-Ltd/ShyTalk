package com.shyden.shytalk.data.remote

import android.content.Context
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import io.agora.rtc2.ChannelMediaOptions
import io.agora.rtc2.Constants
import io.agora.rtc2.IRtcEngineEventHandler
import io.agora.rtc2.RtcEngine
import io.agora.rtc2.RtcEngineConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Wrapper around the Agora RtcEngine for voice chat functionality.
 *
 * Prerequisites:
 * - Set your Agora App ID in the AGORA_APP_ID constant below
 * - For production, use AgoraTokenService to fetch tokens
 */
@Singleton
class AgoraVoiceService @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val tokenService: AgoraTokenService
) {
    enum class ConnectionState { CONNECTED, DISCONNECTED, RECONNECTING }

    companion object {
        private const val TAG = "AgoraVoiceService"
        const val AGORA_APP_ID = "7bdf5596c88f49edba75568f529c4389"
    }

    private var rtcEngine: RtcEngine? = null

    private val _speakingUsers = MutableStateFlow<Set<Int>>(emptySet())
    val speakingUsers: StateFlow<Set<Int>> = _speakingUsers.asStateFlow()

    private val _isJoined = MutableStateFlow(false)
    val isJoined: StateFlow<Boolean> = _isJoined.asStateFlow()

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val rtcEventHandler = object : IRtcEngineEventHandler() {
        override fun onJoinChannelSuccess(channel: String?, uid: Int, elapsed: Int) {
            _isJoined.value = true
            _connectionState.value = ConnectionState.CONNECTED
        }

        override fun onLeaveChannel(stats: RtcStats?) {
            _isJoined.value = false
            _speakingUsers.value = emptySet()
            _connectionState.value = ConnectionState.DISCONNECTED
        }

        override fun onConnectionStateChanged(state: Int, reason: Int) {
            _connectionState.value = when (state) {
                3 -> ConnectionState.CONNECTED      // CONNECTION_STATE_CONNECTED
                1, 5 -> ConnectionState.DISCONNECTED // DISCONNECTED or FAILED
                else -> ConnectionState.RECONNECTING // CONNECTING or RECONNECTING
            }
        }

        override fun onAudioVolumeIndication(
            speakers: Array<out AudioVolumeInfo>?,
            totalVolume: Int
        ) {
            val speaking = speakers
                ?.filter { it.volume > 50 }
                ?.map { it.uid }
                ?.toSet() ?: emptySet()
            _speakingUsers.value = speaking
        }

        override fun onUserOffline(uid: Int, reason: Int) {
            _speakingUsers.value = _speakingUsers.value - uid
        }
    }

    fun initialize() {
        if (AGORA_APP_ID.isEmpty()) return
        if (rtcEngine != null) return

        try {
            val config = RtcEngineConfig().apply {
                mContext = context
                mAppId = AGORA_APP_ID
                mEventHandler = rtcEventHandler
            }
            rtcEngine = RtcEngine.create(config)
            rtcEngine?.apply {
                setChannelProfile(Constants.CHANNEL_PROFILE_LIVE_BROADCASTING)
                setAudioProfile(
                    Constants.AUDIO_PROFILE_SPEECH_STANDARD,
                    Constants.AUDIO_SCENARIO_CHATROOM
                )
                enableAudioVolumeIndication(300, 3, true)
                enableAudio()
                setDefaultAudioRoutetoSpeakerphone(true)
            }
        } catch (e: Exception) {
            // Log or handle initialization failure
            rtcEngine = null
        }
    }

    suspend fun joinChannel(channelName: String, uid: Int) {
        initialize()
        val engine = rtcEngine ?: return

        val token = try {
            tokenService.fetchToken(channelName, uid)
        } catch (e: Exception) {
            Log.w(TAG, "Token fetch failed, joining without token", e)
            ""
        }

        val options = ChannelMediaOptions().apply {
            clientRoleType = Constants.CLIENT_ROLE_BROADCASTER
            channelProfile = Constants.CHANNEL_PROFILE_LIVE_BROADCASTING
            autoSubscribeAudio = true
            publishMicrophoneTrack = true
            autoSubscribeVideo = false
        }

        Log.d(TAG, "Joining channel=$channelName uid=$uid")
        engine.joinChannel(token, channelName, uid, options)
    }

    fun leaveChannel() {
        rtcEngine?.leaveChannel()
    }

    fun muteLocalAudio(mute: Boolean) {
        rtcEngine?.muteLocalAudioStream(mute)
    }

    fun destroy() {
        rtcEngine?.leaveChannel()
        RtcEngine.destroy()
        rtcEngine = null
        _isJoined.value = false
        _speakingUsers.value = emptySet()
        _connectionState.value = ConnectionState.DISCONNECTED
    }
}
