import Foundation
import LiveKit
import shared

/// Swift implementation of the Kotlin LiveKitBridge interface.
/// Wraps the LiveKit Swift SDK Room API and forwards events to the Kotlin delegate.
class LiveKitBridgeImpl: shared.LiveKitBridge {
    private var room: Room?
    private var kotlinDelegate: shared.LiveKitBridgeDelegate?
    private var eventTask: Task<Void, Never>?

    func setDelegate(delegate: shared.LiveKitBridgeDelegate?) {
        self.kotlinDelegate = delegate
    }

    func connect(url: String, token: String) {
        let room = Room()
        self.room = room

        // Listen for room events
        eventTask?.cancel()
        eventTask = Task { [weak self] in
            for await event in room.events {
                await MainActor.run {
                    self?.handleEvent(event)
                }
            }
        }

        // Connect to LiveKit server
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

    func disconnect() {
        Task {
            await room?.disconnect()
            eventTask?.cancel()
            eventTask = nil
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

    private func handleEvent(_ event: RoomEvent) {
        switch event {
        case .connected:
            kotlinDelegate?.onConnected()

        case .disconnected:
            kotlinDelegate?.onDisconnected()

        case .reconnecting:
            kotlinDelegate?.onReconnecting()

        case .reconnected:
            kotlinDelegate?.onReconnected()

        case .activeSpeakersChanged(let speakers):
            let identities = speakers.compactMap { $0.identity?.stringValue }
            kotlinDelegate?.onActiveSpeakersChanged(speakerIdentities: identities)

        case .participantDisconnected(let participant):
            if let identity = participant.identity?.stringValue {
                kotlinDelegate?.onParticipantDisconnected(identity: identity)
            }

        default:
            break
        }
    }
}
