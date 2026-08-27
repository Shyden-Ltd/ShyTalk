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
/// 2.14.1's RoomDelegate inherits Sendable).
///
/// Thread-safety justification (per-property):
///
///   `kotlinDelegate` — effectively write-once at Koin DI init.
///   The Kotlin side calls `setDelegate(...)` ONCE during DI
///   wiring, before any Room is created and before any
///   RoomDelegate callback can fire. So the bare `self.kotlinDelegate
///   = delegate` store in setDelegate is safe: by the time any
///   read happens (from a RoomDelegate callback OR from a Task's
///   error path inside connect/setMicrophoneEnabled), the value
///   is established and stable for the app's lifetime. The reads
///   that DO use `await MainActor.run { ... }` (the error-path
///   forwards inside connect/setMicrophoneEnabled) are there to
///   marshal the kotlinDelegate INVOCATION onto the main thread
///   for UI safety on the Kotlin side, not to synchronise access
///   to the property itself.
///
///   `room` — written in TWO places:
///     1. `connect(...)` — synchronous main-thread write before
///        the async Task is launched. Safe.
///     2. `disconnect()` — the `room = nil` write is dispatched
///        via `await MainActor.run { ... }` to serialise it with
///        the main-thread write in connect(...) and with any
///        callback that might be holding a reference. Without
///        the MainActor.run wrapper, this would be a data race
///        against concurrent reads in delegate callbacks. (R1
///        review fix.)
///   Reads of `room` from delegate callbacks and from
///   setMicrophoneEnabled's Task may see a transient nil during
///   disconnect, which is acceptable — the call sites all use
///   `room?.<method>` optional chaining and treat nil as no-op.
///
/// Switching to `@MainActor` for the entire class would be
/// cleaner but would force every RoomDelegate callback to
/// dispatch through main, adding latency to high-frequency
/// events like `didUpdateSpeakingParticipants` (fires multiple
/// times per second per room). `@unchecked Sendable` + targeted
/// MainActor dispatches on writes preserves the callback path
/// lock-free.
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

    /// Is `host` an RFC1918 private IPv4 **literal**? (SHY-0275)
    ///
    /// Decided by parsing the four octets NUMERICALLY, because the two ways a
    /// string check gets this wrong are both reachable:
    ///
    ///   - `172.32.0.1` is **public**. The private block is 172.16–172.31, so
    ///     `hasPrefix("172.")` hands an attacker a public host.
    ///   - `10.0.0.5.evil.com` is a **hostname** the attacker controls, not an
    ///     address, and `hasPrefix("10.")` accepts it.
    ///
    /// Requiring exactly four ASCII-numeric components in 0...255 rejects both.
    /// ASCII is required explicitly: `Character.isNumber` is also true for
    /// non-ASCII digit forms, which `Int()` would then refuse inconsistently.
    ///
    /// Not itself gated on `#if DEBUG` so it stays unit-testable; it is inert in
    /// a Release binary because its only caller is inside the guard below.
    static func isPrivateLAN(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        var octets: [Int] = []
        for part in parts {
            guard !part.isEmpty,
                  part.allSatisfy({ $0.isASCII && $0.isNumber }),
                  let value = Int(part),
                  (0...255).contains(value)
            else { return false }
            octets.append(value)
        }
        switch (octets[0], octets[1]) {
        case (10, _): return true
        case (172, 16...31): return true
        case (192, 168): return true
        default: return false
        }
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

        #if DEBUG
        // SHY-0275 — a physical iPhone reaches the developer's Mac by its LAN
        // address; unlike Android it has no `adb reverse`, so loopback cannot
        // serve and `ws://<mac-lan-ip>:7880` was rejected here before any
        // network call. That is why iOS-local voice had never worked.
        //
        // Deliberately narrow: cleartext only, private IPv4 literals only, and
        // compiled OUT of Release entirely — a shipped build's allow-list is
        // byte-for-byte the expression below, unchanged. Cleartext signalling
        // carries the join token, so this must never reach a distributable
        // binary.
        if scheme == "ws" && isPrivateLAN(host) { return true }
        #endif

        return isLoopbackOk || (isTLS && allowedHosts.contains(host))
    }

    func disconnect() {
        Task {
            await room?.disconnect()
            // R1 review fix: write must be on the main actor to
            // serialise with the main-thread write in connect()
            // and with any concurrent reads from delegate callbacks
            // or Tasks. Without this dispatch, the bare `room = nil`
            // would be a data race that @unchecked Sendable cannot
            // legitimately guarantee away.
            await MainActor.run {
                self.room = nil
            }
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
