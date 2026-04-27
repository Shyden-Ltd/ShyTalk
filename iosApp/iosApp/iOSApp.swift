import SwiftUI
import shared
import FirebaseCore
import GoogleSignIn

@main
struct iOSApp: App {
    @StateObject private var coordinator = StartingScreenCoordinator()

    init() {
        // Debug builds use emulators with the demo-shytalk project (matches
        // Android local flavor and local/seed.js). Release builds use the
        // bundled GoogleService-Info.plist (shytalk-dev or shytalk-7ba69).
        #if DEBUG
        let options = FirebaseOptions(googleAppID: "1:0:ios:0",
                                      gcmSenderID: "0")
        options.apiKey = "demo-api-key"
        options.projectID = "demo-shytalk"
        options.bundleID = Bundle.main.bundleIdentifier ?? "com.shyden.shytalk"
        options.databaseURL = "http://localhost:9000?ns=demo-shytalk"
        options.storageBucket = "demo-shytalk.appspot.com"
        FirebaseApp.configure(options: options)
        KoinHelperKt.doInitKoin(useEmulators: true)
        #else
        FirebaseApp.configure()
        KoinHelperKt.doInitKoin(useEmulators: false)
        #endif
        setupGoogleSignIn()
        setupLiveKit()
    }

    private func setupLiveKit() {
        let bridge = LiveKitBridgeImpl()
        IosLiveKitBridgeKt.registerLiveKitBridge(bridge: bridge)
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
            .onOpenURL { url in
                GIDSignIn.sharedInstance.handle(url)
            }
        }
    }
}
