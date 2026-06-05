import UIKit
import UserNotifications
import FirebaseCore
import FirebaseMessaging
import shared

/// Bridges APNs / FCM into the Kotlin Multiplatform shared layer.
///
/// Mirrors `app/src/main/java/com/shyden/shytalk/data/remote/ShyTalkMessagingService.kt`:
/// - Handles `data["type"] = "PM"` payloads only (other types are ignored at v1).
/// - Suppresses notifications when the app is foregrounded (Android: `RoomLifecycleManager.isAppInForeground`).
/// - Masks the body to "New message" when `showPreview=false`.
/// - On tap, emits a `PushDeepLink` via the Kotlin `chatDeepLinks` StateFlow.
///
/// **Backend contract**: FCM payloads MUST be data-only with `content-available: 1`
/// so iOS routes them through `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`.
/// The `notification:` block must NOT be set, or APNs will display the system banner
/// directly with the raw text — bypassing this code's `showPreview` masking.
///
/// Implements the Kotlin `PushTokenBridge` protocol so `PushTokenManager`
/// (commonMain) reads/writes the FCM token cache from a single source of truth.
/// Also implements the `PushPermissionBridge` protocol so the shared
/// `PushPermissionStore` can call back into Swift to open the iOS Settings
/// app at the app-specific notifications page (closes the TODO(v2) below).
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate, MessagingDelegate, PushTokenBridge, PushPermissionBridge {
    static let currentTokenKey = "shytalk.fcm.currentToken"
    static let lastRegisteredTokenKey = "shytalk.fcm.lastRegisteredToken"

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Messaging.messaging().delegate = self

        // Register self as the Kotlin-side bridge so PushTokenManager can read
        // the cached FCM token from NSUserDefaults via this AppDelegate.
        IosPushBridgeKt.registerPushBridge(bridge: self)

        // Register the push-permission bridge so the shared UI's "Open Settings"
        // CTA can defer to the iOS Settings deep-link.
        PushPermissionStore.shared.registerBridge(b: self)

        // Push the current permission state into the shared store so the UI
        // banner reflects reality from the first frame.
        refreshPushPermissionState()

        // Request authorization (user prompt). If already-determined, this is a no-op.
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, error in
            if let error = error {
                NSLog("[ShyTalkPush] auth request error: \(error.localizedDescription)")
                // Refresh the shared store regardless — on an error, the status
                // stays .notDetermined (the OS didn't actually show the prompt),
                // which is correctly NOT a denial signal. The refresh keeps the
                // store in sync with the OS rather than relying on stale state.
                self.refreshPushPermissionState()
                return
            }
            // Refresh the shared store regardless of granted result — the prompt
            // settles the .notDetermined → .authorized OR .denied transition,
            // and the banner UX hinges on the post-prompt state.
            self.refreshPushPermissionState()
            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }

        // Foreground / late-grant flow: when app foregrounds, re-check authorization
        // (catches user granting via Settings.app after a prior denial), and ALSO
        // attempt a token sync (catches FCM rotation that happened while suspended,
        // or first save after a Koin-init race on cold start).
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )

        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Messaging.messaging().apnsToken = deviceToken
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Common causes: missing aps-environment entitlement, expired provisioning
        // profile, no network at first launch, or running in iOS Simulator (which
        // does not deliver real APNs). Logged for diagnostics; no user-visible
        // error surface in v1.
        NSLog("[ShyTalkPush] APNs registration failed: \(error.localizedDescription)")
    }

    /// Silent (data-only) push handler. Called when FCM delivers a payload with
    /// `content-available: 1`, both in foreground and background.
    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        handleRemotePayload(userInfo)
        completionHandler(.newData)
    }

    // MARK: UNUserNotificationCenterDelegate

    /// Foreground notification presentation. Returning empty options suppresses
    /// the system banner — mirroring Android's `isAppInForeground` suppression.
    /// This is reached only if a *visible* notification was scheduled (via the
    /// `notification:` payload block); for the data-only contract documented in
    /// the type comment, this method is rarely reached.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([])
    }

    /// Tap handler — emits the deep link for MainViewController to drive Compose nav.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        emitDeepLink(from: response.notification.request.content.userInfo)
        completionHandler()
    }

    // MARK: MessagingDelegate

    /// Token receipt + rotation. Cache to UserDefaults first (cold-start contract:
    /// Koin may not yet be ready) then attempt a direct backend save via the
    /// `trySync*` helper, which itself handles the Koin-not-ready case gracefully.
    /// This three-layer save (here + sign-in path + foreground retry) closes the
    /// gap where rotation between sign-in and foreground would otherwise be missed.
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken else { return }
        UserDefaults.standard.set(token, forKey: AppDelegate.currentTokenKey)
        IosPushBridgeKt.trySyncFcmTokenForCurrentUser()
    }

    // MARK: PushTokenBridge (called from Kotlin via Objective-C interop)

    func currentFcmToken() -> String? {
        UserDefaults.standard.string(forKey: AppDelegate.currentTokenKey)
    }

    func lastRegisteredToken() -> String? {
        UserDefaults.standard.string(forKey: AppDelegate.lastRegisteredTokenKey)
    }

    func setLastRegisteredToken(token: String?) {
        if let token = token {
            UserDefaults.standard.set(token, forKey: AppDelegate.lastRegisteredTokenKey)
        } else {
            UserDefaults.standard.removeObject(forKey: AppDelegate.lastRegisteredTokenKey)
        }
    }

    // MARK: Helpers

    @objc private func handleDidBecomeActive() {
        // 1) Late permission grant: re-check authorization status. If user granted
        //    via Settings.app after a prior denial, kick off remote registration.
        //    ALSO update the shared permission store so the UI banner reflects
        //    any DENIED → AUTHORIZED transition from the system Settings round-trip.
        refreshPushPermissionState()
        // 2) Foreground token-sync retry: covers FCM rotation while suspended
        //    AND any save that was deferred by a cold-start Koin race.
        IosPushBridgeKt.trySyncFcmTokenForCurrentUser()
    }

    /// Query the OS notification settings, map to the shared
    /// PushPermissionState enum, and push to the shared store. Also kicks
    /// off remote registration when authorized — same UX as the late-grant
    /// path that was previously inlined in handleDidBecomeActive.
    private func refreshPushPermissionState() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let mapped: PushPermissionState
            switch settings.authorizationStatus {
            case .notDetermined:
                mapped = .notDetermined
            case .authorized:
                mapped = .authorized
            case .provisional:
                mapped = .provisional
            case .ephemeral:
                // Ephemeral (App Clip) authorization is, for our UX, the same
                // as provisional — quietly delivers without prompting.
                mapped = .provisional
            case .denied:
                mapped = .denied
            @unknown default:
                // Future iOS may add new statuses. Fail OPEN to .notDetermined
                // rather than .denied — a new permissive status (e.g., a
                // hypothetical "Focus-aware authorized") would be incorrectly
                // accused of denial under fail-closed, surfacing a banner that
                // asks the user to fix already-granted permissions. Log so a
                // future engineer can detect when an unknown status appears
                // in the wild.
                NSLog("[ShyTalkPush] unknown UNAuthorizationStatus rawValue=\(settings.authorizationStatus.rawValue) — defaulting to notDetermined")
                mapped = .notDetermined
            }
            PushPermissionStore.shared.updateState(newState: mapped)
            if settings.authorizationStatus == .authorized {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }

    // MARK: PushPermissionBridge (called from Kotlin via Objective-C interop)

    /// Opens the iOS Settings app at the app-specific notifications page.
    /// Invoked by the shared UI when the user taps the "Open Settings" CTA
    /// on the denial banner. Wrapped in DispatchQueue.main.async because
    /// the Kotlin caller's StateFlow collection may dispatch from a non-main
    /// queue, and UIApplication.open requires main.
    func openSystemSettings() {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url)
        }
    }

    private func handleRemotePayload(_ userInfo: [AnyHashable: Any]) {
        guard let type = userInfo["type"] as? String else {
            NSLog("[ShyTalkPush] payload missing 'type' field — dropped")
            return
        }
        guard UIApplication.shared.applicationState != .active else {
            // App in foreground — suppress. In-app UI handles delivery (mirrors
            // Android's RoomLifecycleManager.isAppInForeground check).
            return
        }
        switch type {
        case "PM":
            handlePmPayload(userInfo)
        case "AGE_VERIF_APPROVED":
            handleAgeVerifApprovedPayload(userInfo)
        case "AGE_VERIF_REJECTED":
            handleAgeVerifRejectedPayload(userInfo)
        case "AGE_VERIF_DOB_MODIFIED":
            handleAgeVerifDobModifiedPayload(userInfo)
        default:
            // Logging makes future on-call diagnose mismatched server
            // payloads. Sanitise `type` before interpolating into NSLog
            // so a compromised FCM sender can't inject newlines /
            // control chars into the device console.
            NSLog("[ShyTalkPush] unrecognised type='\(sanitiseForLog(type))' — dropped")
        }
    }

    private func handlePmPayload(_ userInfo: [AnyHashable: Any]) {
        guard let conversationId = userInfo["conversationId"] as? String else {
            NSLog("[ShyTalkPush] PM payload missing conversationId — dropped")
            return
        }
        guard let _ = userInfo["senderId"] as? String else {
            NSLog("[ShyTalkPush] PM payload missing senderId — dropped")
            return
        }

        let senderName = (userInfo["senderName"] as? String) ?? "Someone"
        let messageText = (userInfo["messageText"] as? String) ?? "New message"
        let showPreview = parseBool(userInfo["showPreview"]) ?? true // Android parity: default true on missing/malformed
        let body = showPreview ? messageText : "New message"

        let content = UNMutableNotificationContent()
        content.title = senderName
        content.body = body
        content.sound = .default
        content.userInfo = userInfo

        let request = UNNotificationRequest(
            identifier: conversationId,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                NSLog("[ShyTalkPush] add notification failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Age verification (PR 10 / iOS parity)

    private func handleAgeVerifApprovedPayload(_ userInfo: [AnyHashable: Any]) {
        scheduleAgeVerifNotification(
            identifier: "age-verif-approved",
            title: "Age verification approved",
            body: "You now have full access to ShyTalk. Tap to learn more.",
            userInfo: userInfo
        )
    }

    private func handleAgeVerifRejectedPayload(_ userInfo: [AnyHashable: Any]) {
        let preview = (userInfo["reasonPreview"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let body: String
        if let preview = preview, !preview.isEmpty {
            body = "Your submission wasn't approved: \(preview)"
        } else {
            body = "Your submission wasn't approved. Tap to read more."
        }
        scheduleAgeVerifNotification(
            identifier: "age-verif-rejected",
            title: "Age verification update",
            body: body,
            userInfo: userInfo
        )
    }

    private func handleAgeVerifDobModifiedPayload(_ userInfo: [AnyHashable: Any]) {
        let becameVerified = parseBool(userInfo["becameVerified"]) ?? false
        let body: String
        if becameVerified {
            body = "Your DOB was corrected and you now have full access. Tap to read more."
        } else {
            body = "Your DOB was corrected. Some features remain age-restricted. Tap to read more."
        }
        scheduleAgeVerifNotification(
            identifier: "age-verif-dob-modified",
            title: "Date of birth updated",
            body: body,
            userInfo: userInfo
        )
    }

    private func scheduleAgeVerifNotification(
        identifier: String,
        title: String,
        body: String,
        userInfo: [AnyHashable: Any]
    ) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        // Preserve the payload so the tap-handler emits the right
        // deep link if/when we wire one. For now the system PM in the
        // inbox carries the full body, so a tap into the app entry
        // is enough.
        content.userInfo = userInfo
        let request = UNNotificationRequest(
            identifier: identifier,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                NSLog("[ShyTalkPush] add age-verif notification failed: \(error.localizedDescription)")
            }
        }
    }

    private func emitDeepLink(from userInfo: [AnyHashable: Any]) {
        guard let type = userInfo["type"] as? String else {
            NSLog("[ShyTalkPush] tap payload missing 'type' — deep link dropped")
            return
        }
        guard type == "PM" else {
            NSLog("[ShyTalkPush] tap on unrecognised type='\(sanitiseForLog(type))' — deep link dropped")
            return
        }
        guard let otherUserId = userInfo["senderId"] as? String,
              let conversationId = userInfo["conversationId"] as? String else {
            NSLog("[ShyTalkPush] tap payload missing senderId or conversationId — deep link dropped")
            return
        }
        let isGroup = parseBool(userInfo["isGroup"]) ?? false
        PushDeepLinkBusKt.emitChatDeepLink(
            otherUserId: otherUserId,
            conversationId: conversationId,
            isGroup: isGroup
        )
    }

    /// Strict parse mirroring Kotlin's `String.toBooleanStrictOrNull()` for parity
    /// with Android's payload handling. Returns nil for unrecognised input so the
    /// caller can apply a documented default.
    private func parseBool(_ value: Any?) -> Bool? {
        if let b = value as? Bool { return b }
        if let n = value as? NSNumber { return n.boolValue }
        if let s = value as? String {
            switch s.lowercased() {
            case "true": return true
            case "false": return false
            default: return nil
            }
        }
        return nil
    }

    /// Sanitise an attacker-controllable string before interpolating into NSLog.
    /// FCM payload fields are signed by the project's server key, so a
    /// compromised key is the threat model — without sanitisation, an attacker
    /// could inject newlines or control characters into the device console,
    /// polluting on-call diagnostic output. Truncate to a fixed length and
    /// strip non-printable ASCII before logging.
    private func sanitiseForLog(_ value: String) -> String {
        let truncated = String(value.prefix(64))
        return truncated.unicodeScalars
            .filter { $0.isASCII && $0.value >= 0x20 && $0.value < 0x7F }
            .reduce(into: "") { $0.append(Character($1)) }
    }
}
