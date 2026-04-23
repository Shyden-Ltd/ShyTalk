import SwiftUI
import shared

@main
struct iOSApp: App {
    @StateObject private var coordinator = StartingScreenCoordinator()

    init() {
        // TODO: Replace #if DEBUG with a proper build flavor system (local/dev/prod)
        // matching Android's 3 flavors. Currently all debug builds use emulators,
        // which differs from Android where only the "local" flavor does.
        #if DEBUG
        KoinHelperKt.doInitKoin(useEmulators: true)
        #else
        KoinHelperKt.doInitKoin(useEmulators: false)
        #endif
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if coordinator.isBlocked, let screen = coordinator.blockingScreen {
                    StartingScreenView(screen: screen,
                                       onDismiss: { coordinator.dismiss() })
                } else if !coordinator.isReady {
                    // Loading state while checking API
                    ProgressView(NSLocalizedString("starting_screen_loading", comment: "Loading"))
                        .accessibilityIdentifier("startingScreen_loading")
                } else if let screen = coordinator.dismissableScreens.first {
                    StartingScreenView(screen: screen,
                                       onDismiss: { coordinator.dismissDismissableScreen(screen) })
                } else {
                    ContentView()
                }
            }
            .task {
                await coordinator.checkStartingScreens()
            }
        }
    }
}
