import Foundation
import UIKit

/// Fetches starting screen configuration from the ShyTalk API.
/// Pre-auth endpoint — no authentication token required.
class StartingScreenService {
    private let baseURL: String
    private let session: URLSession

    /// Protocol for abstracting UIDevice for testing
    var deviceIdProvider: () -> String? = {
        UIDevice.current.identifierForVendor?.uuidString
    }

    #if DEBUG
    // Simulator uses localhost — host machine's Express API on port 3000
    static let defaultBaseURL = "http://localhost:3000"
    #else
    static let defaultBaseURL = "https://api.shytalk.shyden.co.uk"
    #endif

    init(baseURL: String = StartingScreenService.defaultBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    /// Fetches active starting screens from the API.
    /// Returns a dictionary keyed by screen ID.
    func fetchStartingScreens() async throws -> [String: StartingScreen] {
        guard let url = URL(string: "\(baseURL)/api/config/startingScreens") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url, timeoutInterval: 10)

        // X-Device-Id header for allowlist checking
        if let deviceId = deviceIdProvider() {
            request.setValue(deviceId, forHTTPHeaderField: "X-Device-Id")
        }

        let (data, response) = try await session.data(for: request)

        // Check HTTP status
        if let httpResponse = response as? HTTPURLResponse,
           !(200...299).contains(httpResponse.statusCode) {
            throw URLError(.badServerResponse)
        }

        // No-content body means "no screens active" — return early.
        // Covers zero bytes, whitespace-only, and newline-only bodies.
        // Must precede JSONSerialization.jsonObject(), which THROWS
        // on any of these (NSCocoaError 3840) rather than returning
        // nil for the as? cast to handle. Pinned by
        // testFetchStartingScreens_emptyData,
        // testFetchStartingScreens_whitespaceOnlyBody, and
        // testFetchStartingScreens_newlineOnlyBody.
        if let str = String(data: data, encoding: .utf8),
           str.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return [:]
        }

        // Parse: { "screenId": { ...fields } }
        guard let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw URLError(.cannotParseResponse)
        }

        var screens: [String: StartingScreen] = [:]

        for (id, value) in raw {
            guard let screenDict = value as? [String: Any],
                  let screenData = try? JSONSerialization.data(withJSONObject: screenDict),
                  var screen = try? JSONDecoder().decode(StartingScreen.self, from: screenData) else {
                continue  // Skip malformed entries
            }
            // Set screenId from dictionary key (API doesn't include _screenId)
            screen.screenId = id
            screens[id] = screen
        }

        return screens
    }
}
