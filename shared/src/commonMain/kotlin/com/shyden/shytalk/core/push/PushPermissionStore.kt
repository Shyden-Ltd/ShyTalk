package com.shyden.shytalk.core.push

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Singleton state holder for the OS push-notification permission status.
 *
 * Why an `object` instead of a Koin-injected service:
 *   - The state is written from a platform layer (iOS AppDelegate, Android
 *     activity callback) that runs BEFORE Koin's per-screen ViewModels resolve.
 *     The push token equivalent ([IosPushBridge]) uses the same top-level
 *     pattern for the same reason.
 *   - The state has process-singleton semantics — there is one OS-level
 *     permission grant per app, not per screen / per ViewModel.
 *
 * Closes AppDelegate.swift:38's TODO(v2) by giving Kotlin UI an observable
 * source-of-truth for the OS permission status. UI surfaces a denial banner
 * with an "Open Settings" CTA that defers to [openSystemSettings] →
 * [PushPermissionBridge.openSystemSettings].
 */
object PushPermissionStore {
    private val _state = MutableStateFlow(PushPermissionState.NOT_DETERMINED)

    /**
     * Observable permission state. Starts as [PushPermissionState.NOT_DETERMINED]
     * and is updated by the platform layer on launch + on every foreground
     * (catches user toggling the setting via Settings.app while suspended).
     */
    val state: StateFlow<PushPermissionState> = _state.asStateFlow()

    @kotlin.concurrent.Volatile
    private var bridge: PushPermissionBridge? = null

    /** Called by the platform layer on launch + each foreground re-check. */
    fun updateState(newState: PushPermissionState) {
        _state.value = newState
    }

    /**
     * Called by the platform layer (Swift AppDelegate, Android Activity) once
     * the bridge is constructed. Subsequent calls overwrite — last writer wins.
     */
    fun registerBridge(b: PushPermissionBridge) {
        bridge = b
    }

    /**
     * Invoked by UI when the user taps the "Open Settings" CTA on the denial
     * banner. No-op if no bridge has been registered yet (caller should bind
     * the UI to a state that ensures the bridge exists by then — i.e. UI is
     * only shown post-init).
     */
    fun openSystemSettings() {
        bridge?.openSystemSettings()
    }

    /** Reset hook for tests — process-singletons leak across test cases otherwise. */
    internal fun resetForTesting() {
        _state.value = PushPermissionState.NOT_DETERMINED
        bridge = null
    }
}
