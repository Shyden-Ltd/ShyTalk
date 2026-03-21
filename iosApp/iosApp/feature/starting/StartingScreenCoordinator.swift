import Foundation
import SwiftUI

/// Orchestrates the starting screen startup flow.
/// Manages API-first, cache-fallback blocking screen logic.
///
/// State machine:
/// - `NO_CACHE -> API_LOADING -> BLOCKED` (API returns blocker)
/// - `NO_CACHE -> API_LOADING -> PROCEED_NORMAL` (no blocker)
/// - `CACHED_BLOCKER -> API_LOADING -> BLOCKED` (confirmed by API or API fail = fail-safe)
/// - `CACHED_BLOCKER -> API_LOADING -> PROCEED_NORMAL` (blocker removed from API)
/// - `BLOCKED -> DISMISSED` (allowlisted device dismisses)
@MainActor
class StartingScreenCoordinator: ObservableObject {
    @Published var isBlocked: Bool = false
    @Published var isReady: Bool = false
    @Published var blockingScreen: StartingScreen?
    @Published var dismissableScreens: [StartingScreen] = []

    private let service: StartingScreenService
    private let cache: StartingScreenCache

    init(service: StartingScreenService = StartingScreenService(),
         cache: StartingScreenCache = StartingScreenCache()) {
        self.service = service
        self.cache = cache
    }

    /// Check for starting screens. Call once at app launch.
    /// API-first with cache fallback.
    func checkStartingScreens() async {
        do {
            let screens = try await service.fetchStartingScreens()

            // Filter to enabled screens (API already filters, but defensive)
            let enabledScreens = screens.filter { $0.value.enabled }

            // Filter out dismissed once-screens
            let activeScreens = enabledScreens.filter { (_, screen) in
                if screen.frequency == "once" && cache.isDismissed(screen.screenId) {
                    return false
                }
                return true
            }

            // Find first non-dismissable (blocking) screen
            let blocker = activeScreens.values.first { !$0.dismissable }

            if let blocker = blocker {
                // Check if cache needs updating (content hash comparison)
                if cache.getCachedBlocker()?.contentHash != blocker.contentHash {
                    cache.cacheBlocker(blocker, backgroundImagePath: nil)
                }
                blockingScreen = blocker
                isBlocked = true
            } else {
                // No blocker — clear cache if present
                cache.clearBlocker()

                // Collect dismissable screens for showing after app loads
                dismissableScreens = activeScreens.values
                    .filter { $0.dismissable }
                    .sorted { $0.screenId < $1.screenId }

                isBlocked = false
            }
        } catch {
            // API failed — use cache (fail-safe for blockers)
            if let cached = cache.getCachedBlocker() {
                blockingScreen = cached
                isBlocked = true
            } else {
                // No cache — fail-open, let app proceed
                isBlocked = false
            }
        }

        isReady = true
    }

    /// Dismiss the current blocking screen (for allowlisted devices).
    /// Marks one-time screens as dismissed.
    func dismiss() {
        if let screen = blockingScreen, screen.frequency == "once" {
            cache.markDismissed(screen.screenId)
        }
        isBlocked = false
        blockingScreen = nil
    }

    /// Dismiss a specific dismissable screen from the queue.
    func dismissDismissableScreen(_ screen: StartingScreen) {
        if screen.frequency == "once" {
            cache.markDismissed(screen.screenId)
        }
        dismissableScreens.removeAll { $0.screenId == screen.screenId }
    }
}
