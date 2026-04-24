package com.shyden.shytalk.data.remote

/**
 * Bridge interface for LiveKit on iOS.
 *
 * The Swift app registers an implementation at startup that wraps the
 * LiveKit Swift SDK Room API. Kotlin cannot call Swift directly — this
 * interface provides the Objective-C-compatible bridge.
 */
interface LiveKitBridgeHandler {
    fun connect(
        url: String,
        token: String,
    )

    fun disconnect()

    fun setMicrophoneEnabled(enabled: Boolean)

    fun isMicrophoneEnabled(): Boolean

    fun isConnected(): Boolean
}

/**
 * Delegate interface that LiveKit events are forwarded through.
 * The Kotlin VoiceService sets itself as the delegate to receive events.
 */
interface LiveKitBridgeDelegate {
    fun onConnected()

    fun onDisconnected()

    fun onReconnecting()

    fun onReconnected()

    fun onActiveSpeakersChanged(speakerIdentities: List<String>)

    fun onParticipantDisconnected(identity: String)

    fun onConnectionFailed(error: String)
}

/**
 * Combines the bridge handler with a way to set the delegate.
 */
interface LiveKitBridge : LiveKitBridgeHandler {
    fun setDelegate(delegate: LiveKitBridgeDelegate)
}

@kotlin.concurrent.Volatile
private var liveKitBridge: LiveKitBridge? = null

/**
 * Called from Swift during app init to register the LiveKit bridge.
 */
fun registerLiveKitBridge(bridge: LiveKitBridge) {
    liveKitBridge = bridge
}

/**
 * Access the registered LiveKit bridge from Kotlin.
 */
fun getLiveKitBridge(): LiveKitBridge? = liveKitBridge
