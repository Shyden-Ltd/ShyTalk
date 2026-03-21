import Foundation

/// File-based cache for starting screen blocking state.
/// Blocking screen stored as JSON in FileManager.cachesDirectory.
/// Dismissed one-time screen IDs stored in UserDefaults.
class StartingScreenCache {
    private let cacheVersion = 1
    private let fileManager: FileManager
    private let userDefaults: UserDefaults
    private let dismissedKey = "dismissed_once_screens"

    /// Overridable cache directory for testing
    var cacheDirectoryURL: URL {
        fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }

    private var cacheFileURL: URL {
        cacheDirectoryURL.appendingPathComponent("starting_screens_cache.json")
    }

    init(fileManager: FileManager = .default, userDefaults: UserDefaults = .standard) {
        self.fileManager = fileManager
        self.userDefaults = userDefaults
    }

    // MARK: - Blocking Screen Cache

    /// Retrieves the cached blocking screen, if valid.
    /// Returns nil if cache is missing, corrupt, empty, zero-byte, or version mismatch.
    func getCachedBlocker() -> StartingScreen? {
        guard fileManager.fileExists(atPath: cacheFileURL.path) else {
            return nil
        }

        do {
            let data = try Data(contentsOf: cacheFileURL)

            // Zero-byte or empty file
            guard !data.isEmpty else {
                return nil
            }

            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return nil
            }

            // Version check
            guard let version = json["cacheVersion"] as? Int, version == cacheVersion else {
                // Version mismatch — discard cache
                clearBlocker()
                return nil
            }

            // Parse blocking screen content
            guard let content = json["blockingScreen"] as? [String: Any],
                  let contentData = try? JSONSerialization.data(withJSONObject: content),
                  let screen = try? JSONDecoder().decode(StartingScreen.self, from: contentData) else {
                return nil
            }

            return screen
        } catch {
            // Corrupt/unreadable cache — treat as empty
            return nil
        }
    }

    /// Caches a blocking screen atomically (write to temp file, then rename).
    func cacheBlocker(_ screen: StartingScreen, backgroundImagePath: String? = nil) {
        do {
            // Encode the screen to JSON
            let screenData = try JSONEncoder().encode(screen)
            guard let screenDict = try JSONSerialization.jsonObject(with: screenData) as? [String: Any] else {
                return
            }

            var cacheDict: [String: Any] = [
                "cacheVersion": cacheVersion,
                "blockingScreen": screenDict
            ]

            if let bgPath = backgroundImagePath {
                cacheDict["backgroundImagePath"] = bgPath
            }

            let data = try JSONSerialization.data(withJSONObject: cacheDict, options: [.sortedKeys])

            // Atomic write: write to temp file, then rename
            let tempURL = cacheDirectoryURL.appendingPathComponent(
                "starting_screens_cache_\(UUID().uuidString).tmp"
            )

            try data.write(to: tempURL, options: .atomic)

            // Remove existing cache file if present
            if fileManager.fileExists(atPath: cacheFileURL.path) {
                try fileManager.removeItem(at: cacheFileURL)
            }

            // Rename temp to final
            try fileManager.moveItem(at: tempURL, to: cacheFileURL)
        } catch {
            // Disk full or other IO error — logged, proceed without caching
            // In production, this would use os_log or similar
            print("[StartingScreenCache] Failed to write cache: \(error.localizedDescription)")
        }
    }

    /// Removes the cached blocking screen file.
    func clearBlocker() {
        try? fileManager.removeItem(at: cacheFileURL)
    }

    // MARK: - Dismissed One-Time Screen IDs

    /// Whether a screen ID has been dismissed (for frequency == "once" screens).
    func isDismissed(_ screenId: String) -> Bool {
        let dismissed = userDefaults.stringArray(forKey: dismissedKey) ?? []
        return dismissed.contains(screenId)
    }

    /// Marks a screen ID as dismissed. Idempotent — does not add duplicates.
    func markDismissed(_ screenId: String) {
        var dismissed = userDefaults.stringArray(forKey: dismissedKey) ?? []
        guard !dismissed.contains(screenId) else { return }
        dismissed.append(screenId)
        userDefaults.set(dismissed, forKey: dismissedKey)
    }

    /// Returns all dismissed screen IDs.
    func getDismissedIds() -> [String] {
        return userDefaults.stringArray(forKey: dismissedKey) ?? []
    }

    /// Clears all dismissed screen IDs (for testing).
    func clearDismissedIds() {
        userDefaults.removeObject(forKey: dismissedKey)
    }
}
