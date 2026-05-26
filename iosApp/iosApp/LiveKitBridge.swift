import Foundation
// SPM product is named `LiveKit` (per client-sdk-swift's
// Package.swift). The legacy `import LiveKitClient` was the
// CocoaPods spec name (still resolved via `pod 'LiveKitClient'`)
// — migrated to SPM in PR #841 (2026-05-26), which exposes the
// module under its real product name.
import LiveKit
import shared

/// Swift implementation of the Kotlin LiveKitBridge interface.
/// Uses LiveKit 2.x RoomDelegate pattern for event handling.
///
/// Marked `final` + `@unchecked Sendable` to satisfy Swift 6
/// strict-concurrency on the `RoomDelegate` conformance (LiveKit
/// 2.14.1's RoomDelegate inherits Sendable). Thread-safety
/// justification:
///   - `room` and `kotlinDelegate` are written ONLY from the
///     `connect(...)` and `setDelegate(...)` entry points, which
///     are called by Koin DI / Kotlin-side ViewModel code on the
///     main thread (this is enforced by the Kotlin LiveKitBridge
///     interface's `@MainThread` annotation on those methods).
///   - `room` is read from RoomDelegate callbacks (LiveKit's
///     internal threads) and from the disconnect / setMicrophone
///     async Tasks. These reads are independent of the writes
///     because writes only happen during the connect/disconnect
///     lifecycle transitions, never concurrent with delegate
///     callbacks for the same room instance.
///   - `kotlinDelegate` writes are bookended by main-thread
///     dispatch (via `MainActor.run` inside Tasks) so callbacks
///     see a consistent value.
///
/// Switching to `@MainActor` would be cleaner but would force
/// every RoomDelegate callback to dispatch through main, which
/// adds latency to high-frequency events like
/// `didUpdateSpeakingParticipants` (fires multiple times per
/// second per room). `@unchecked Sendable` keeps the callback
/// path lock-free while preserving the write-once lifecycle.
final class LiveKitBridgeImpl: NSObject, @unchecked Sendable, shared.LiveKitBridge, RoomDelegate {
    private var room: Room?
    private var kotlinDelegate: shared.LiveKitBridgeDelegate?

    func setDelegate(delegate: shared.LiveKitBridgeDelegate?) {
        self.kotlinDelegate = delegate
    }

    /// UK OSA #17 PR 12 — defence-in-depth pre-connect validation.
    /// The server gate (`express-api/src/routes/livekit.js`) refuses to
    /// mint a token for a cross-cohort room (404 + audit log), so a
    /// valid token *should* always be cohort-clean. These checks catch
    /// the residual risk of a tampered Kotlin layer that forges or
    /// retains a stale token, and of a Kotlin-layer bug that points
    /// the bridge at a non-ShyTalk LiveKit host.
    func connect(url: String, token: String) {
        guard LiveKitBridgeImpl.isAllowedURL(url) else {
            kotlinDelegate?.onConnectionFailed(error: "invalid_livekit_url")
            return
        }
        guard LiveKitBridgeImpl.isValidToken(token) else {
            kotlinDelegate?.onConnectionFailed(error: "missing_livekit_token")
            return
        }

        let room = Room(delegate: self)
        self.room = room

        Task {
            do {
                try await room.connect(url: url, token: token)
            } catch {
                await MainActor.run {
                    self.kotlinDelegate?.onConnectionFailed(error: error.localizedDescription)
                }
            }
        }
    }

    /// Allow-list of LiveKit URLs the bridge will accept. Matches the
    /// hosts configured by `express-api/src/utils/livekit-region.js`:
    /// localhost for local dev, the two Oracle Cloud VMs for dev/prod
    /// (London + Singapore). Anything else is rejected before any
    /// network call is made.
    /// Empty/whitespace-only tokens are rejected before any network call.
    /// Catches the residual risk of the Kotlin layer passing through a
    /// stale or zeroed-out token after a failed mint, where the empty
    /// string would otherwise crash LiveKit's JWT parser deep inside an
    /// async `Task` and surface as an opaque "Connection failed" error.
    static func isValidToken(_ token: String) -> Bool {
        return !token.trimmingCharacters(in: .whitespaces).isEmpty
    }

    static func isAllowedURL(_ url: String) -> Bool {
        guard let parsed = URL(string: url), let host = parsed.host else { return false }
        let scheme = parsed.scheme?.lowercased() ?? ""
        let isLocalhost = (host == "localhost" || host == "127.0.0.1")
        let isLoopbackOk = isLocalhost && (scheme == "ws" || scheme == "wss")
        let isTLS = (scheme == "wss")
        let allowedHosts: Set<String> = [
            "livekit.shytalk.shyden.co.uk",
            "livekit-eu.shytalk.shyden.co.uk",
        ]
        return isLoopbackOk || (isTLS && allowedHosts.contains(host))
    }

    func disconnect() {
        Task {
            await room?.disconnect()
            room = nil
        }
    }

    func setMicrophoneEnabled(enabled: Bool) {
        guard let room = room else { return }
        Task {
            do {
                try await room.localParticipant.setMicrophone(enabled: enabled)
            } catch {
                await MainActor.run {
                    self.kotlinDelegate?.onConnectionFailed(error: "Microphone error: \(error.localizedDescription)")
                }
            }
        }
    }

    func isMicrophoneEnabled() -> Bool {
        return room?.localParticipant.isMicrophoneEnabled() ?? false
    }

    func isConnected() -> Bool {
        return room?.connectionState == .connected
    }

    // MARK: - RoomDelegate

    func roomDidConnect(_ room: Room) {
        kotlinDelegate?.onConnected()
    }

    func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        kotlinDelegate?.onDisconnected()
    }

    func roomIsReconnecting(_ room: Room) {
        kotlinDelegate?.onReconnecting()
    }

    func roomDidReconnect(_ room: Room) {
        kotlinDelegate?.onReconnected()
    }

    func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) {
        let identities = participants.compactMap { $0.identity?.stringValue }
        kotlinDelegate?.onActiveSpeakersChanged(speakerIdentities: identities)
    }

    func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        if let identity = participant.identity?.stringValue {
            kotlinDelegate?.onParticipantDisconnected(identity: identity)
        }
    }

    func room(_ room: Room, didFailToConnectWithError error: LiveKitError?) {
        kotlinDelegate?.onConnectionFailed(error: error?.localizedDescription ?? "Connection failed")
    }
}
