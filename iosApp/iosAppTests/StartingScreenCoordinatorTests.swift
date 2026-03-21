import XCTest
@testable import iosApp

/// Tests for StartingScreenCoordinator state machine transitions.
@MainActor
final class StartingScreenCoordinatorTests: XCTestCase {

    // MARK: - Helpers

    private func makeScreen(
        screenId: String = "testScreen",
        enabled: Bool = true,
        dismissable: Bool = false,
        frequency: String = "every_launch",
        template: String = "warning",
        title: String = "Test",
        message: String = "Test message.",
        contentHash: String = "hash123"
    ) -> StartingScreen {
        return StartingScreen(
            screenId: screenId,
            enabled: enabled,
            dismissable: dismissable,
            frequency: frequency,
            template: template,
            title: title,
            message: message,
            contentHash: contentHash
        )
    }

    private func makeCoordinator(
        service: MockStartingScreenService = MockStartingScreenService(),
        cache: TestableStartingScreenCache? = nil
    ) -> StartingScreenCoordinator {
        let testCache = cache ?? {
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent("CoordinatorTests_\(UUID().uuidString)")
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let defaults = UserDefaults(suiteName: "CoordinatorTests_\(UUID().uuidString)")!
            return TestableStartingScreenCache(cacheDir: dir, userDefaults: defaults)
        }()
        return StartingScreenCoordinator(service: service, cache: testCache)
    }

    // MARK: - Initial State

    func testInitialState() {
        let coordinator = makeCoordinator()

        XCTAssertFalse(coordinator.isBlocked)
        XCTAssertFalse(coordinator.isReady)
        XCTAssertNil(coordinator.blockingScreen)
        XCTAssertTrue(coordinator.dismissableScreens.isEmpty)
    }

    // MARK: - NO_CACHE -> API_LOADING -> BLOCKED

    func testCheckStartingScreens_apiReturnsBlocker_blocksApp() async {
        let service = MockStartingScreenService()
        let blocker = makeScreen(screenId: "blocker", dismissable: false)
        service.mockResult = .success(["blocker": blocker])

        let coordinator = makeCoordinator(service: service)
        await coordinator.checkStartingScreens()

        XCTAssertTrue(coordinator.isBlocked)
        XCTAssertTrue(coordinator.isReady)
        XCTAssertNotNil(coordinator.blockingScreen)
        XCTAssertEqual(coordinator.blockingScreen?.screenId, "blocker")
    }

    // MARK: - NO_CACHE -> API_LOADING -> PROCEED_NORMAL (no blocker)

    func testCheckStartingScreens_apiReturnsNoBlocker_proceeds() async {
        let service = MockStartingScreenService()
        service.mockResult = .success([:])

        let coordinator = makeCoordinator(service: service)
        await coordinator.checkStartingScreens()

        XCTAssertFalse(coordinator.isBlocked)
        XCTAssertTrue(coordinator.isReady)
        XCTAssertNil(coordinator.blockingScreen)
    }

    // MARK: - NO_CACHE -> API_LOADING -> PROCEED_NORMAL (API fail, no cache)

    func testCheckStartingScreens_apiFails_noCachedBlocker_proceeds() async {
        let service = MockStartingScreenService()
        service.mockResult = .failure(URLError(.notConnectedToInternet))

        let coordinator = makeCoordinator(service: service)
        await coordinator.checkStartingScreens()

        XCTAssertFalse(coordinator.isBlocked)
        XCTAssertTrue(coordinator.isReady)
        XCTAssertNil(coordinator.blockingScreen)
    }

    // MARK: - CACHED_BLOCKER -> API_LOADING -> BLOCKED (confirmed by API)

    func testCheckStartingScreens_cachedBlocker_apiConfirms_staysBlocked() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("CoordinatorTests_\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let defaults = UserDefaults(suiteName: "CoordinatorTests_\(UUID().uuidString)")!
        let cache = TestableStartingScreenCache(cacheDir: dir, userDefaults: defaults)

        let blocker = makeScreen(screenId: "blocker", dismissable: false, contentHash: "hash1")
        cache.cacheBlocker(blocker)

        let service = MockStartingScreenService()
        service.mockResult = .success(["blocker": blocker])

        let coordinator = makeCoordinator(service: service, cache: cache)
        await coordinator.checkStartingScreens()

        XCTAssertTrue(coordinator.isBlocked)
        XCTAssertTrue(coordinator.isReady)
        XCTAssertEqual(coordinator.blockingScreen?.screenId, "blocker")
    }

    // MARK: - CACHED_BLOCKER -> API_LOADING -> BLOCKED (API fail, fail-safe)

    func testCheckStartingScreens_cachedBlocker_apiFails_failSafe_blocked() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("CoordinatorTests_\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let defaults = UserDefaults(suiteName: "CoordinatorTests_\(UUID().uuidString)")!
        let cache = TestableStartingScreenCache(cacheDir: dir, userDefaults: defaults)

        let blocker = makeScreen(screenId: "cachedBlocker", dismissable: false)
        cache.cacheBlocker(blocker)

        let service = MockStartingScreenService()
        service.mockResult = .failure(URLError(.timedOut))

        let coordinator = makeCoordinator(service: service, cache: cache)
        await coordinator.checkStartingScreens()

        XCTAssertTrue(coordinator.isBlocked)
        XCTAssertTrue(coordinator.isReady)
        XCTAssertEqual(coordinator.blockingScreen?.screenId, "cachedBlocker")
    }

    // MARK: - CACHED_BLOCKER -> API_LOADING -> PROCEED_NORMAL (blocker removed)

    func testCheckStartingScreens_cachedBlocker_apiSaysRemoved_proceeds() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("CoordinatorTests_\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let defaults = UserDefaults(suiteName: "CoordinatorTests_\(UUID().uuidString)")!
        let cache = TestableStartingScreenCache(cacheDir: dir, userDefaults: defaults)

        let blocker = makeScreen(screenId: "oldBlocker", dismissable: false)
        cache.cacheBlocker(blocker)

        let service = MockStartingScreenService()
        service.mockResult = .success([:])  // No screens

        let coordinator = makeCoordinator(service: service, cache: cache)
        await coordinator.checkStartingScreens()

        XCTAssertFalse(coordinator.isBlocked)
        XCTAssertTrue(coordinator.isReady)
        XCTAssertNil(coordinator.blockingScreen)
        // Cache should be cleared
        XCTAssertNil(cache.getCachedBlocker())
    }

    // MARK: - BLOCKED -> DISMISSED (allowlisted)

    func testDismiss_blockedScreen_unblocks() async {
        let service = MockStartingScreenService()
        let blocker = makeScreen(screenId: "dismissableBlocker", dismissable: true)
        service.mockResult = .success(["dismissableBlocker": blocker])

        let coordinator = makeCoordinator(service: service)
        await coordinator.checkStartingScreens()

        // The blocker here is actually dismissable=true, so it won't be treated as a blocker
        // Let's test with an allowlisted scenario: non-dismissable but user can dismiss
        let service2 = MockStartingScreenService()
        let realBlocker = makeScreen(screenId: "allowlisted", dismissable: false, frequency: "every_launch")
        service2.mockResult = .success(["allowlisted": realBlocker])

        let coordinator2 = makeCoordinator(service: service2)
        await coordinator2.checkStartingScreens()

        XCTAssertTrue(coordinator2.isBlocked)

        coordinator2.dismiss()

        XCTAssertFalse(coordinator2.isBlocked)
        XCTAssertNil(coordinator2.blockingScreen)
    }

    // MARK: - Dismiss Once-Frequency Screen

    func testDismiss_onceFrequency_marksDismissed() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("CoordinatorTests_\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let defaults = UserDefaults(suiteName: "CoordinatorTests_\(UUID().uuidString)")!
        let cache = TestableStartingScreenCache(cacheDir: dir, userDefaults: defaults)

        let service = MockStartingScreenService()
        let blocker = makeScreen(screenId: "onceBlocker", dismissable: false, frequency: "once")
        service.mockResult = .success(["onceBlocker": blocker])

        let coordinator = makeCoordinator(service: service, cache: cache)
        await coordinator.checkStartingScreens()

        XCTAssertTrue(coordinator.isBlocked)

        coordinator.dismiss()

        XCTAssertFalse(coordinator.isBlocked)
        XCTAssertTrue(cache.isDismissed("onceBlocker"))
    }

    // MARK: - Every Launch Frequency — Not Marked Dismissed

    func testDismiss_everyLaunchFrequency_notMarkedDismissed() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("CoordinatorTests_\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let defaults = UserDefaults(suiteName: "CoordinatorTests_\(UUID().uuidString)")!
        let cache = TestableStartingScreenCache(cacheDir: dir, userDefaults: defaults)

        let service = MockStartingScreenService()
        let blocker = makeScreen(screenId: "everyLaunch", dismissable: false, frequency: "every_launch")
        service.mockResult = .success(["everyLaunch": blocker])

        let coordinator = makeCoordinator(service: service, cache: cache)
        await coordinator.checkStartingScreens()
        coordinator.dismiss()

        XCTAssertFalse(cache.isDismissed("everyLaunch"))
    }

    // MARK: - Once-Screen Already Dismissed — Filtered Out

    func testCheckStartingScreens_onceScreenAlreadyDismissed_filteredOut() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("CoordinatorTests_\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let defaults = UserDefaults(suiteName: "CoordinatorTests_\(UUID().uuidString)")!
        let cache = TestableStartingScreenCache(cacheDir: dir, userDefaults: defaults)
        cache.markDismissed("alreadySeen")

        let service = MockStartingScreenService()
        let screen = makeScreen(screenId: "alreadySeen", dismissable: true, frequency: "once")
        service.mockResult = .success(["alreadySeen": screen])

        let coordinator = makeCoordinator(service: service, cache: cache)
        await coordinator.checkStartingScreens()

        XCTAssertFalse(coordinator.isBlocked)
        XCTAssertTrue(coordinator.dismissableScreens.isEmpty)
    }

    // MARK: - Dismissable Screens Collected

    func testCheckStartingScreens_dismissableScreensCollected() async {
        let service = MockStartingScreenService()
        let screen1 = makeScreen(screenId: "promo1", dismissable: true, template: "promotional")
        let screen2 = makeScreen(screenId: "promo2", dismissable: true, template: "announcement")
        service.mockResult = .success(["promo1": screen1, "promo2": screen2])

        let coordinator = makeCoordinator(service: service)
        await coordinator.checkStartingScreens()

        XCTAssertFalse(coordinator.isBlocked)
        XCTAssertEqual(coordinator.dismissableScreens.count, 2)
        // Sorted by screenId
        XCTAssertEqual(coordinator.dismissableScreens[0].screenId, "promo1")
        XCTAssertEqual(coordinator.dismissableScreens[1].screenId, "promo2")
    }

    // MARK: - Dismiss Dismissable Screen

    func testDismissDismissableScreen_removesFromList() async {
        let service = MockStartingScreenService()
        let screen1 = makeScreen(screenId: "d1", dismissable: true, frequency: "once")
        let screen2 = makeScreen(screenId: "d2", dismissable: true, frequency: "every_launch")
        service.mockResult = .success(["d1": screen1, "d2": screen2])

        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("CoordinatorTests_\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let defaults = UserDefaults(suiteName: "CoordinatorTests_\(UUID().uuidString)")!
        let cache = TestableStartingScreenCache(cacheDir: dir, userDefaults: defaults)

        let coordinator = makeCoordinator(service: service, cache: cache)
        await coordinator.checkStartingScreens()

        XCTAssertEqual(coordinator.dismissableScreens.count, 2)

        coordinator.dismissDismissableScreen(screen1)

        XCTAssertEqual(coordinator.dismissableScreens.count, 1)
        XCTAssertEqual(coordinator.dismissableScreens[0].screenId, "d2")
        XCTAssertTrue(cache.isDismissed("d1"))  // once-frequency marked dismissed
        XCTAssertFalse(cache.isDismissed("d2"))  // every_launch not marked
    }

    // MARK: - Mixed Blocking + Dismissable

    func testCheckStartingScreens_blockerPlusDismissable_onlyBlockerShown() async {
        let service = MockStartingScreenService()
        let blocker = makeScreen(screenId: "blocker", dismissable: false)
        let dismissable = makeScreen(screenId: "promo", dismissable: true)
        service.mockResult = .success(["blocker": blocker, "promo": dismissable])

        let coordinator = makeCoordinator(service: service)
        await coordinator.checkStartingScreens()

        XCTAssertTrue(coordinator.isBlocked)
        XCTAssertEqual(coordinator.blockingScreen?.screenId, "blocker")
        // Dismissable screens should not be collected when there's a blocker
        XCTAssertTrue(coordinator.dismissableScreens.isEmpty)
    }

    // MARK: - Content Hash Change Updates Cache

    func testCheckStartingScreens_contentHashChanged_updatesCache() async {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("CoordinatorTests_\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let defaults = UserDefaults(suiteName: "CoordinatorTests_\(UUID().uuidString)")!
        let cache = TestableStartingScreenCache(cacheDir: dir, userDefaults: defaults)

        let oldBlocker = makeScreen(screenId: "screen", dismissable: false, contentHash: "oldHash")
        cache.cacheBlocker(oldBlocker)

        let newBlocker = makeScreen(screenId: "screen", dismissable: false,
                                     title: "Updated Title", contentHash: "newHash")
        let service = MockStartingScreenService()
        service.mockResult = .success(["screen": newBlocker])

        let coordinator = makeCoordinator(service: service, cache: cache)
        await coordinator.checkStartingScreens()

        XCTAssertTrue(coordinator.isBlocked)
        XCTAssertEqual(coordinator.blockingScreen?.title, "Updated Title")
        // Cache should have been updated
        let cached = cache.getCachedBlocker()
        XCTAssertEqual(cached?.contentHash, "newHash")
    }

    // MARK: - isReady Set After Check

    func testCheckStartingScreens_isReadySetAfterCompletion() async {
        let service = MockStartingScreenService()
        service.mockResult = .success([:])

        let coordinator = makeCoordinator(service: service)
        XCTAssertFalse(coordinator.isReady)

        await coordinator.checkStartingScreens()

        XCTAssertTrue(coordinator.isReady)
    }

    func testCheckStartingScreens_isReadySetEvenOnFailure() async {
        let service = MockStartingScreenService()
        service.mockResult = .failure(URLError(.timedOut))

        let coordinator = makeCoordinator(service: service)
        await coordinator.checkStartingScreens()

        XCTAssertTrue(coordinator.isReady)
    }

    // MARK: - Disabled Screens Filtered

    func testCheckStartingScreens_disabledScreens_filtered() async {
        let service = MockStartingScreenService()
        let disabled = makeScreen(screenId: "disabled", enabled: false, dismissable: false)
        service.mockResult = .success(["disabled": disabled])

        let coordinator = makeCoordinator(service: service)
        await coordinator.checkStartingScreens()

        XCTAssertFalse(coordinator.isBlocked)
        XCTAssertNil(coordinator.blockingScreen)
    }
}

// MARK: - MockStartingScreenService

/// Mock service for coordinator tests.
class MockStartingScreenService: StartingScreenService {
    var mockResult: Result<[String: StartingScreen], Error> = .success([:])

    init() {
        super.init(baseURL: "https://test.example.com")
    }

    override func fetchStartingScreens() async throws -> [String: StartingScreen] {
        switch mockResult {
        case .success(let screens):
            return screens
        case .failure(let error):
            throw error
        }
    }
}
