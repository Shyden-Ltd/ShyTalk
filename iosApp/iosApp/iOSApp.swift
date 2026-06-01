import SwiftUI
import shared
import FirebaseCore
import GoogleSignIn

@main
struct iOSApp: App {
    @StateObject private var coordinator = StartingScreenCoordinator()
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        // Debug builds use emulators with the demo-shytalk project (matches
        // Android local flavor and local/seed.js). Release builds use the
        // bundled GoogleService-Info.plist (shytalk-dev or shytalk-7ba69).
        #if DEBUG
        let options = FirebaseOptions(googleAppID: "1:0:ios:0",
                                      gcmSenderID: "0")
        // FirebaseInstallations (pulled in by FirebaseMessaging) validates the
        // API key format at app launch: must be 39 chars and start with "A".
        // The previous "demo-api-key" string crashed on launch once
        // FirebaseMessaging was added. The Firebase Emulators ignore the key
        // value, so any well-formed dummy works. Constructed at runtime to
        // avoid pre-commit secret-detector false-positives on the Google
        // API key pattern.
        //
        // Defence-in-depth: this entire block is `#if DEBUG`. If a misconfigured
        // Xcode scheme ever ships a Debug build to TestFlight/App Store, the
        // emulator URL (`http://localhost:9000`) would also fail loudly — not
        // just this dummy key — so the worst-case is a non-functional build,
        // not a credential leak. The startup log below makes the misconfiguration
        // obvious in the device console on first launch.
        options.apiKey = "A" + String(repeating: "0", count: 38)
        NSLog("[ShyTalk] DEBUG build — using Firebase Emulators (project=demo-shytalk, db=localhost:9000). NOT FOR PRODUCTION.")
        options.projectID = "demo-shytalk"
        options.bundleID = Bundle.main.bundleIdentifier ?? "com.shyden.shytalk"
        options.databaseURL = "http://localhost:9000?ns=demo-shytalk"
        options.storageBucket = "demo-shytalk.appspot.com"
        FirebaseApp.configure(options: options)
        // Persona-picker password (shared across the 17 seeded test
        // personas) is passed in only inside #if DEBUG so the literal is
        // stripped from Release iOS binaries at compile time — closes the
        // "reverse-engineer the IPA to learn the seed credential" leak.
        // Source of truth for the value is `local/seed.js` — keep in sync.
        // (The legacy single-account dev-sign-in slot was removed
        // 2026-06-01; only the persona-shared password remains.)
        let emulatorPersonasSeed = "localdev123"
        // Eager device-ID compute. Calling UIDevice.identifierForVendor
        // here (after UIApplication setup, before doInitKoin → Firebase init)
        // is the safe pattern — the previous attempt to read it lazily from
        // a Koin `single` factory inside AuthViewModel construction crashed
        // with a K/N CPointer cast bug (PR #406, reverted by 043cdf47ce).
        // See `project-ios-device-id-revert-rca.md`.
        let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        // PreviewWatermark inputs — version + build come from Info.plist
        // (CFBundleShortVersionString = "1.2.3", CFBundleVersion = "456"),
        // device label from UIDevice. The Kotlin side decides whether to
        // render the watermark based on `environment != "prod"`.
        let appShortVersion = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "?"
        let appBuildNumber = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "?"
        let buildVersion = "\(appShortVersion) (\(appBuildNumber))"
        let deviceInfo = "\(UIDevice.current.model) · iOS \(UIDevice.current.systemVersion)"
        // Local builds talk to the dockerised emulator stack on the dev
        // laptop. apiBaseUrl is the Express API endpoint — the device
        // accesses it via `adb reverse` (Android) / direct localhost
        // (iOS Simulator). googleWebClientId is unused on local because
        // the Google Sign-In button is hidden against the emulator (no
        // real Google OAuth client wired up to the demo project).
        KoinHelperKt.doInitKoin(
            useEmulators: true,
            devPersonasPassword: emulatorPersonasSeed,
            deviceId: deviceId,
            environment: "local",
            buildVersion: buildVersion,
            deviceInfo: deviceInfo,
            apiBaseUrl: "http://localhost:3000",
            googleWebClientId: nil
        )
        #else
        FirebaseApp.configure()
        let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        let appShortVersion = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "?"
        let appBuildNumber = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "?"
        let buildVersion = "\(appShortVersion) (\(appBuildNumber))"
        let deviceInfo = "\(UIDevice.current.model) · iOS \(UIDevice.current.systemVersion)"
        // Release builds default to dev — the App Store / TestFlight
        // distribution targets are dev for now (prod app is a separate
        // bundle ID flow that doesn't yet exist). When the prod target
        // ships, switch the Release env to "prod" by config rather than
        // by `#if DEBUG`, and update apiBaseUrl + googleWebClientId to
        // their prod values (mirrors Android's per-flavour BuildConfig).
        //
        // googleWebClientId is the WEB OAuth client ID for the
        // shytalk-dev Firebase project — Android passes the same value
        // via BuildConfig.WEB_CLIENT_ID for CredentialManager. Without
        // this server-client-ID, GoogleSignIn iOS SDK 9.x returns
        // tokens that may not be accepted by Firebase Auth's
        // signInWithCredential, surfacing as a "no idToken" failure on
        // the user side.
        KoinHelperKt.doInitKoin(
            useEmulators: false,
            devPersonasPassword: nil,
            deviceId: deviceId,
            environment: "dev",
            buildVersion: buildVersion,
            deviceInfo: deviceInfo,
            apiBaseUrl: "https://dev-api.shytalk.shyden.co.uk",
            googleWebClientId: "881846974606-kv99pjv92i6me0emb2j3uacbhnqqvfj4.apps.googleusercontent.com"
        )
        #endif
        setupGoogleSignIn()
        setupLiveKit()
        setupStoreKit()
    }

    private func setupLiveKit() {
        let bridge = LiveKitBridgeImpl()
        IosLiveKitBridgeKt.registerLiveKitBridge(bridge: bridge)
    }

    private func setupStoreKit() {
        // StoreKit 2 requires iOS 15+. App's deployment target is iOS 18
        // (per Podfile), so the availability guard is trivially satisfied
        // at link time — runtime crashes only on a misconfigured installer.
        // The `#available(iOS 15.0, *)` guard is preserved for defence-
        // in-depth and to keep the symbol-availability story explicit
        // even though every device that meets the iOS 18 deployment
        // target also satisfies it.
        if #available(iOS 15.0, *) {
            let bridge = StoreKitBridgeImpl()
            IosStoreKitBridgeKt.registerStoreKitBridge(bridge: bridge)
        }
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
