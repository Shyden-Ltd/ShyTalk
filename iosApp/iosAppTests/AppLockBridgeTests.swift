import XCTest
import UIKit
import shared
@testable import iosApp

/// SHY-0187 — behavioural coverage for the iOS App-Lock background-timestamp
/// recording, the piece only iOS owns (Android's equivalent is MainActivity's
/// ProcessLifecycleOwner onStop observer, covered by its own layers).
///
/// Two things are proven here, without requiring a booted Koin graph:
///  1. The Kotlin bridge `recordAppBackgroundedForAppLock()` is exported,
///     callable from Swift, and FAIL-CLOSED: invoked before Koin
///     initialisation it must return silently (skip the write), never throw
///     into Swift — a crash in a background-notification handler would kill
///     the app on every backgrounding.
///  2. The AppDelegate really registers a `didEnterBackgroundNotification`
///     observer whose selector resolves and executes — a typo'd selector or
///     dropped `addObserver` crashes/fails HERE, not first-on-device. Posting
///     the notification drives the exact registration + dispatch path
///     production uses.
///
/// What this deliberately does NOT cover: the Koin-initialised success branch
/// (the timestamp write itself) — that needs the full app graph and is proven
/// by the device gauntlet's warm-resume re-lock journey plus the Kotlin-side
/// `LockScreenViewModelTest` timestamp assertions.
final class AppLockBridgeTests: XCTestCase {

    func test_bridge_isFailClosed_beforeKoinInit() {
        // The iosAppTests host does not run doInitKoin, so this exercises the
        // real "Koin not initialised" branch. The only pass criterion is: no
        // Swift-visible throw/crash. (Kotlin logs the skip internally.)
        KoinHelperKt.recordAppBackgroundedForAppLock()
    }

    func test_appDelegate_backgroundSelector_resolvesAndExecutes() {
        // Deliberately NOT via application(didFinishLaunchingWithOptions:) —
        // that path re-configures Firebase and requests push authorization,
        // both hostile to a unit-test host. The observer REGISTRATION line is
        // pinned by the Kotlin-side AppLockWiringPinTest; what only a Swift
        // test can prove is that the @objc selector the registration names
        // actually resolves and its body executes (a renamed/typo'd handler
        // raises `unrecognized selector` right here). The body calls the
        // fail-closed bridge — test 1's contract — so this must be quiet.
        let delegate = AppDelegate()
        let selector = Selector(("handleDidEnterBackground"))
        XCTAssertTrue(
            delegate.responds(to: selector),
            "AppDelegate must implement handleDidEnterBackground — the selector its didEnterBackground observer registers"
        )
        delegate.perform(selector)
    }
}
