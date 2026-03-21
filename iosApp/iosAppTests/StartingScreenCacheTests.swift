import XCTest
@testable import iosApp

final class StartingScreenCacheTests: XCTestCase {

    private var cache: StartingScreenCache!
    private var testDirectory: URL!
    private var testDefaults: UserDefaults!

    override func setUp() {
        super.setUp()
        // Use a temp directory for each test to avoid cross-contamination
        testDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("StartingScreenCacheTests_\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: testDirectory, withIntermediateDirectories: true)

        testDefaults = UserDefaults(suiteName: "StartingScreenCacheTests_\(UUID().uuidString)")!

        cache = StartingScreenCache(userDefaults: testDefaults)
        // Override the cache directory
        cache = TestableStartingScreenCache(
            cacheDir: testDirectory,
            userDefaults: testDefaults
        )
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: testDirectory)
        testDefaults.removePersistentDomain(forName: testDefaults.description)
        super.tearDown()
    }

    // MARK: - Helpers

    private func makeScreen(
        screenId: String = "testScreen",
        enabled: Bool = true,
        dismissable: Bool = false,
        frequency: String = "every_launch",
        template: String = "warning",
        title: String = "Test Title",
        message: String = "Test message body.",
        contentHash: String = "testhash123"
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

    // MARK: - Round-Trip

    func testCacheBlocker_roundTrip() {
        let screen = makeScreen()
        cache.cacheBlocker(screen)

        let cached = cache.getCachedBlocker()
        XCTAssertNotNil(cached)
        XCTAssertEqual(cached?.screenId, "testScreen")
        XCTAssertEqual(cached?.title, "Test Title")
        XCTAssertEqual(cached?.message, "Test message body.")
        XCTAssertEqual(cached?.contentHash, "testhash123")
        XCTAssertEqual(cached?.template, "warning")
        XCTAssertFalse(cached!.dismissable)
    }

    func testCacheBlocker_roundTripPreservesAllFields() {
        let screen = StartingScreen(
            screenId: "fullScreen",
            enabled: true,
            dismissable: true,
            frequency: "once",
            template: "promotional",
            title: "Full Test",
            message: "All fields populated here.",
            imageType: "police_duck",
            backgroundImage: "bg/image.jpg",
            startDate: "2026-01-01T00:00:00Z",
            endDate: "2026-12-31T23:59:59Z",
            contentHash: "fullhash",
            lastModifiedAt: "2026-03-20T12:00:00Z"
        )
        cache.cacheBlocker(screen, backgroundImagePath: "/local/bg.jpg")

        let cached = cache.getCachedBlocker()
        XCTAssertNotNil(cached)
        XCTAssertEqual(cached?.screenId, "fullScreen")
        XCTAssertTrue(cached!.dismissable)
        XCTAssertEqual(cached?.frequency, "once")
        XCTAssertEqual(cached?.template, "promotional")
        XCTAssertEqual(cached?.imageType, "police_duck")
        XCTAssertEqual(cached?.backgroundImage, "bg/image.jpg")
        XCTAssertEqual(cached?.startDate, "2026-01-01T00:00:00Z")
        XCTAssertEqual(cached?.endDate, "2026-12-31T23:59:59Z")
        XCTAssertEqual(cached?.contentHash, "fullhash")
        XCTAssertEqual(cached?.lastModifiedAt, "2026-03-20T12:00:00Z")
    }

    // MARK: - Empty/Missing Cache

    func testGetCachedBlocker_noFile_returnsNil() {
        XCTAssertNil(cache.getCachedBlocker())
    }

    func testGetCachedBlocker_emptyFile_returnsNil() {
        let cacheURL = testDirectory.appendingPathComponent("starting_screens_cache.json")
        try? Data().write(to: cacheURL)

        XCTAssertNil(cache.getCachedBlocker())
    }

    func testGetCachedBlocker_zeroByteFile_returnsNil() {
        let cacheURL = testDirectory.appendingPathComponent("starting_screens_cache.json")
        FileManager.default.createFile(atPath: cacheURL.path, contents: nil)

        XCTAssertNil(cache.getCachedBlocker())
    }

    // MARK: - Corrupt Cache

    func testGetCachedBlocker_corruptJSON_returnsNil() {
        let cacheURL = testDirectory.appendingPathComponent("starting_screens_cache.json")
        try? "not valid json".data(using: .utf8)?.write(to: cacheURL)

        XCTAssertNil(cache.getCachedBlocker())
    }

    func testGetCachedBlocker_truncatedJSON_returnsNil() {
        let cacheURL = testDirectory.appendingPathComponent("starting_screens_cache.json")
        try? "{\"cacheVersion\": 1, \"blockingScreen\":".data(using: .utf8)?.write(to: cacheURL)

        XCTAssertNil(cache.getCachedBlocker())
    }

    func testGetCachedBlocker_validJSONButNoBlockingScreen_returnsNil() {
        let cacheURL = testDirectory.appendingPathComponent("starting_screens_cache.json")
        let data = try? JSONSerialization.data(withJSONObject: ["cacheVersion": 1])
        try? data?.write(to: cacheURL)

        XCTAssertNil(cache.getCachedBlocker())
    }

    // MARK: - Version Mismatch

    func testGetCachedBlocker_versionMismatch_returnsNilAndClearsCache() {
        // Write cache with wrong version
        let cacheURL = testDirectory.appendingPathComponent("starting_screens_cache.json")
        let wrongVersion: [String: Any] = [
            "cacheVersion": 999,
            "blockingScreen": [
                "_screenId": "old",
                "enabled": true,
                "dismissable": false,
                "frequency": "every_launch",
                "template": "warning",
                "title": "Old",
                "message": "Old message content.",
                "contentHash": "oldhash"
            ]
        ]
        let data = try? JSONSerialization.data(withJSONObject: wrongVersion)
        try? data?.write(to: cacheURL)

        XCTAssertNil(cache.getCachedBlocker())
        // Cache file should be cleared
        XCTAssertFalse(FileManager.default.fileExists(atPath: cacheURL.path))
    }

    func testGetCachedBlocker_missingVersion_returnsNil() {
        let cacheURL = testDirectory.appendingPathComponent("starting_screens_cache.json")
        let noVersion: [String: Any] = [
            "blockingScreen": [
                "_screenId": "test",
                "enabled": true,
                "dismissable": false,
                "frequency": "every_launch",
                "template": "warning",
                "title": "Test",
                "message": "Test message.",
                "contentHash": "hash"
            ]
        ]
        let data = try? JSONSerialization.data(withJSONObject: noVersion)
        try? data?.write(to: cacheURL)

        XCTAssertNil(cache.getCachedBlocker())
    }

    // MARK: - Clear Blocker

    func testClearBlocker_removesFile() {
        let screen = makeScreen()
        cache.cacheBlocker(screen)
        XCTAssertNotNil(cache.getCachedBlocker())

        cache.clearBlocker()
        XCTAssertNil(cache.getCachedBlocker())
    }

    func testClearBlocker_noFile_noError() {
        // Should not throw
        cache.clearBlocker()
    }

    // MARK: - Cache Update (Content Hash Change)

    func testCacheBlocker_overwritesExisting() {
        let screen1 = makeScreen(title: "First", contentHash: "hash1")
        cache.cacheBlocker(screen1)

        let screen2 = makeScreen(title: "Second", contentHash: "hash2")
        cache.cacheBlocker(screen2)

        let cached = cache.getCachedBlocker()
        XCTAssertEqual(cached?.title, "Second")
        XCTAssertEqual(cached?.contentHash, "hash2")
    }

    // MARK: - Dismissed IDs

    func testIsDismissed_notDismissed() {
        XCTAssertFalse(cache.isDismissed("screen1"))
    }

    func testMarkDismissed_thenIsDismissed() {
        cache.markDismissed("screen1")
        XCTAssertTrue(cache.isDismissed("screen1"))
    }

    func testMarkDismissed_multipleTimes_idempotent() {
        cache.markDismissed("screen1")
        cache.markDismissed("screen1")
        cache.markDismissed("screen1")

        let dismissed = cache.getDismissedIds()
        XCTAssertEqual(dismissed.filter { $0 == "screen1" }.count, 1)
    }

    func testMarkDismissed_multipleScreens() {
        cache.markDismissed("screen1")
        cache.markDismissed("screen2")
        cache.markDismissed("screen3")

        XCTAssertTrue(cache.isDismissed("screen1"))
        XCTAssertTrue(cache.isDismissed("screen2"))
        XCTAssertTrue(cache.isDismissed("screen3"))
        XCTAssertFalse(cache.isDismissed("screen4"))
    }

    func testClearDismissedIds() {
        cache.markDismissed("screen1")
        cache.markDismissed("screen2")

        cache.clearDismissedIds()

        XCTAssertFalse(cache.isDismissed("screen1"))
        XCTAssertFalse(cache.isDismissed("screen2"))
    }

    func testGetDismissedIds_empty() {
        XCTAssertTrue(cache.getDismissedIds().isEmpty)
    }

    func testGetDismissedIds_returnsAll() {
        cache.markDismissed("a")
        cache.markDismissed("b")
        cache.markDismissed("c")

        let ids = cache.getDismissedIds()
        XCTAssertEqual(Set(ids), Set(["a", "b", "c"]))
    }

    // MARK: - Dismissed IDs Independent of Blocker Cache

    func testDismissedIds_surviveCacheClear() {
        cache.markDismissed("screen1")
        cache.clearBlocker()

        XCTAssertTrue(cache.isDismissed("screen1"))
    }
}

// MARK: - TestableStartingScreenCache

/// Subclass that overrides cache directory for testing.
class TestableStartingScreenCache: StartingScreenCache {
    private let testCacheDir: URL

    init(cacheDir: URL, userDefaults: UserDefaults) {
        self.testCacheDir = cacheDir
        super.init(userDefaults: userDefaults)
    }

    override var cacheDirectoryURL: URL {
        return testCacheDir
    }
}
