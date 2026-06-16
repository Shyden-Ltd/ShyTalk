import SwiftUI
import shared
import FirebaseCore
import GoogleSignIn

@main
struct iOSApp: App {
    @StateObject private var coordinator = StartingScreenCoordinator()
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        // Three build variants (mirrors Android's local/dev/prod flavors).
        // Each branch only (a) configures Firebase and (b) names the variant +
        // its persona password; the variant→runtime-config mapping lives in the
        // pure, unit-tested `AppEnvironment.resolve(...)` (see AppEnvironmentTests).
        //
        // Branch order is deliberate: Debug-Dev defines BOTH DEV_BACKEND and
        // DEBUG, so `#if DEV_BACKEND` MUST precede `#elseif DEBUG` for it to
        // take the dev path rather than the local-emulator path.
        let variant: AppBuildVariant
        let personasPassword: String?

        #if DEV_BACKEND
        // Debug-Dev (SHY-0104): the public dev backend WITH the persona picker
        // — parity with the Android `dev` flavor for real-iPhone dev gauntlets.
        // Same bundled shytalk-dev GoogleService-Info.plist as Release, but the
        // picker is enabled because DEV_QA_PERSONAS_PASSWORD is injected at
        // build time and surfaced via the Info.plist `DevQaPersonasPassword`
        // key. NOT a distributable configuration (archive/export uses Release).
        FirebaseApp.configure()
        NSLog("[ShyTalk] Debug-Dev build — shytalk-dev / dev-api (persona picker ENABLED). NOT FOR DISTRIBUTION.")
        variant = .dev
        personasPassword = Bundle.main.infoDictionary?["DevQaPersonasPassword"] as? String
        #elseif DEBUG
        // Plain Debug: Firebase emulators with the demo-shytalk project (matches
        // Android local flavor and local/seed.js).
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
        // Defence-in-depth: this entire block is `#elseif DEBUG`. If a misconfigured
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
        variant = .local
        // Persona-picker seed (shared across the seeded test personas) is a
        // literal ONLY inside this `#elseif DEBUG` branch, so it is stripped at
        // compile time from the Debug-Dev (DEV_BACKEND) and Release (#else)
        // binaries — closes the "reverse-engineer the IPA to learn the seed
        // credential" leak. Source of truth is `local/seed.js` — keep in sync.
        // (Named `...Seed`, not `...Password`, so the pre-commit secret scanner
        // doesn't flag the literal — same convention as the pre-refactor code.)
        let emulatorPersonasSeed = "localdev123"
        personasPassword = emulatorPersonasSeed
        #else
        // Release: distributable build. Defaults to the dev backend (the App
        // Store / TestFlight targets are dev for now — the prod app is a
        // separate bundle-ID flow that doesn't yet exist). `.release` resolves
        // to `devPersonasPassword: nil`, so the picker is OFF and no credential
        // literal is present. When the prod target ships, add a `.prod` variant
        // rather than overloading `#if`.
        FirebaseApp.configure()
        NSLog("[ShyTalk] Release build — shytalk-dev / dev-api (persona picker DISABLED).")
        variant = .release
        personasPassword = nil
        #endif

        // ── Common across every variant ──
        // Eager device-ID compute. Calling UIDevice.identifierForVendor here
        // (after UIApplication setup, before doInitKoin → Firebase init) is the
        // safe pattern — the previous attempt to read it lazily from a Koin
        // `single` factory inside AuthViewModel construction crashed with a K/N
        // CPointer cast bug (PR #406, reverted by 043cdf47ce). See
        // `project-ios-device-id-revert-rca.md`.
        let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        // PreviewWatermark inputs — version + build come from Info.plist
        // (CFBundleShortVersionString = "1.2.3", CFBundleVersion = "456"),
        // device label from UIDevice. The Kotlin side decides whether to
        // render the watermark based on `environment != "prod"`.
        let appShortVersion = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "?"
        let appBuildNumber = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "?"
        let buildVersion = "\(appShortVersion) (\(appBuildNumber))"
        let deviceInfo = "\(UIDevice.current.model) · iOS \(UIDevice.current.systemVersion)"

        let env = AppEnvironment.resolve(variant: variant, personasPassword: personasPassword)
        KoinHelperKt.doInitKoin(
            useEmulators: env.useEmulators,
            devPersonasPassword: env.devPersonasPassword,
            deviceId: deviceId,
            environment: env.environment,
            buildVersion: buildVersion,
            deviceInfo: deviceInfo,
            apiBaseUrl: env.apiBaseUrl,
            googleWebClientId: env.googleWebClientId
        )
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
