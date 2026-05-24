import XCTest
@testable import iosApp

final class StartingScreenServiceTests: XCTestCase {

    // MARK: - Helpers

    /// Creates a URLSession with a mock protocol that returns the given data/response/error.
    private func mockSession(
        data: Data? = nil,
        statusCode: Int = 200,
        error: Error? = nil,
        timeout: TimeInterval? = nil
    ) -> URLSession {
        MockURLProtocol.mockData = data
        MockURLProtocol.mockStatusCode = statusCode
        MockURLProtocol.mockError = error
        MockURLProtocol.mockDelay = timeout

        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }

    private func makeService(session: URLSession) -> StartingScreenService {
        let service = StartingScreenService(
            baseURL: "https://test.example.com",
            session: session
        )
        service.deviceIdProvider = { "TEST-DEVICE-ID-12345" }
        return service
    }

    // MARK: - Successful Parse

    func testFetchStartingScreens_successfulParse() async throws {
        let json: [String: Any] = [
            "preLaunchGate": [
                "enabled": true,
                "dismissable": false,
                "frequency": "every_launch",
                "template": "warning",
                "title": "ShyTalk is not available yet",
                "message": "ShyTalk has not been released yet. Contact Shyden to apply.",
                "imageType": "police_duck",
                "backgroundImage": NSNull(),
                "startDate": NSNull(),
                "endDate": NSNull(),
                "contentHash": "abc123def456",
                "lastModifiedAt": "2026-03-20T12:00:00Z"
            ]
        ]
        let data = try JSONSerialization.data(withJSONObject: json)
        let session = mockSession(data: data)
        let service = makeService(session: session)

        let screens = try await service.fetchStartingScreens()

        XCTAssertEqual(screens.count, 1)
        let screen = try XCTUnwrap(screens["preLaunchGate"])
        XCTAssertEqual(screen.screenId, "preLaunchGate")
        XCTAssertTrue(screen.enabled)
        XCTAssertFalse(screen.dismissable)
        XCTAssertEqual(screen.frequency, "every_launch")
        XCTAssertEqual(screen.template, "warning")
        XCTAssertEqual(screen.title, "ShyTalk is not available yet")
        XCTAssertEqual(screen.imageType, "police_duck")
        XCTAssertNil(screen.backgroundImage)
        XCTAssertNil(screen.startDate)
        XCTAssertNil(screen.endDate)
        XCTAssertEqual(screen.contentHash, "abc123def456")
        XCTAssertEqual(screen.lastModifiedAt, "2026-03-20T12:00:00Z")
    }

    // MARK: - Multiple Screens

    func testFetchStartingScreens_multipleScreens() async throws {
        let json: [String: Any] = [
            "preLaunchGate": [
                "enabled": true,
                "dismissable": false,
                "frequency": "every_launch",
                "template": "warning",
                "title": "Not available",
                "message": "App is not released yet.",
                "contentHash": "hash1"
            ],
            "welcomeBack": [
                "enabled": true,
                "dismissable": true,
                "frequency": "once",
                "template": "announcement",
                "title": "Welcome back!",
                "message": "We have some exciting updates for you.",
                "contentHash": "hash2"
            ]
        ]
        let data = try JSONSerialization.data(withJSONObject: json)
        let session = mockSession(data: data)
        let service = makeService(session: session)

        let screens = try await service.fetchStartingScreens()

        XCTAssertEqual(screens.count, 2)
        XCTAssertNotNil(screens["preLaunchGate"])
        XCTAssertNotNil(screens["welcomeBack"])
        XCTAssertEqual(screens["preLaunchGate"]?.screenId, "preLaunchGate")
        XCTAssertEqual(screens["welcomeBack"]?.screenId, "welcomeBack")
    }

    // MARK: - Empty Response

    func testFetchStartingScreens_emptyObject() async throws {
        let data = "{}".data(using: .utf8)!
        let session = mockSession(data: data)
        let service = makeService(session: session)

        let screens = try await service.fetchStartingScreens()

        XCTAssertTrue(screens.isEmpty)
    }

    // Regression: JSONSerialization.jsonObject(with: Data()) throws
    // NSCocoaError 3840 — not nil for the as? cast to handle. The
    // service must early-return [:] BEFORE the JSONSerialization call.
    // Pinned by PR #716.
    func testFetchStartingScreens_emptyData() async throws {
        let data = Data()
        let session = mockSession(data: data)
        let service = makeService(session: session)

        let screens = try await service.fetchStartingScreens()

        XCTAssertTrue(screens.isEmpty)
    }

    // Regression: a whitespace-only body (`"   "`, `" \n "`, etc.) is
    // semantically equivalent to empty — JSONSerialization throws
    // NSCocoaError 3840 on it too. The empty-body guard must use
    // `String(data:).trimmingCharacters(in: .whitespacesAndNewlines)`
    // so the same fast-path catches both. PR #716 review round 1 I1.
    func testFetchStartingScreens_whitespaceOnlyBody() async throws {
        let data = "   \n  \r\n  ".data(using: .utf8)!
        let session = mockSession(data: data)
        let service = makeService(session: session)

        let screens = try await service.fetchStartingScreens()

        XCTAssertTrue(screens.isEmpty)
    }

    func testFetchStartingScreens_newlineOnlyBody() async throws {
        let data = "\n".data(using: .utf8)!
        let session = mockSession(data: data)
        let service = makeService(session: session)

        let screens = try await service.fetchStartingScreens()

        XCTAssertTrue(screens.isEmpty)
    }

    // HTTP 204 No Content — the API's "no screens active" semantic.
    // Status passes the 200-299 guard, then the empty-body fast-path
    // returns [:]. PR #716 review round 1 M2.
    func testFetchStartingScreens_http204_returnsEmpty() async throws {
        let session = mockSession(data: Data(), statusCode: 204)
        let service = makeService(session: session)

        let screens = try await service.fetchStartingScreens()

        XCTAssertTrue(screens.isEmpty)
    }

    // MARK: - Malformed JSON

    func testFetchStartingScreens_malformedJSON() async throws {
        let data = "not json".data(using: .utf8)!
        let session = mockSession(data: data)
        let service = makeService(session: session)

        do {
            _ = try await service.fetchStartingScreens()
            XCTFail("Expected error for malformed JSON")
        } catch let error as NSError {
            // NSCocoaError 3840 from JSONSerialization, OR
            // URLError(.cannotParseResponse) if the parse returns a
            // value that fails the dict cast — both are acceptable
            // for malformed input. Reject any other error class.
            let isCocoaParse = error.domain == NSCocoaErrorDomain && error.code == 3840
            let isURLParse = (error as? URLError)?.code == .cannotParseResponse
            XCTAssertTrue(
                isCocoaParse || isURLParse,
                "Expected NSCocoaError 3840 or URLError.cannotParseResponse, got \(error)"
            )
        }
    }

    func testFetchStartingScreens_jsonArray() async throws {
        let data = "[1,2,3]".data(using: .utf8)!
        let session = mockSession(data: data)
        let service = makeService(session: session)

        do {
            _ = try await service.fetchStartingScreens()
            XCTFail("Expected error for JSON array")
        } catch let error as URLError {
            // JSON parses successfully but the as? [String: Any] cast
            // fails, hitting the explicit throw URLError(.cannotParseResponse).
            XCTAssertEqual(error.code, .cannotParseResponse)
        } catch {
            XCTFail("Expected URLError.cannotParseResponse, got \(error)")
        }
    }

    // MARK: - Malformed Screen Entry Skipped

    func testFetchStartingScreens_malformedEntrySkipped() async throws {
        let json: [String: Any] = [
            "good": [
                "enabled": true,
                "dismissable": false,
                "frequency": "every_launch",
                "template": "warning",
                "title": "Valid",
                "message": "Valid message here.",
                "contentHash": "hash1"
            ],
            "bad": [
                "enabled": "not_a_bool"  // Missing required fields, wrong type
            ]
        ]
        let data = try JSONSerialization.data(withJSONObject: json)
        let session = mockSession(data: data)
        let service = makeService(session: session)

        let screens = try await service.fetchStartingScreens()

        XCTAssertEqual(screens.count, 1)
        XCTAssertNotNil(screens["good"])
        XCTAssertNil(screens["bad"])
    }

    // MARK: - Unknown Fields Ignored

    func testFetchStartingScreens_unknownFieldsIgnored() async throws {
        let json: [String: Any] = [
            "screen1": [
                "enabled": true,
                "dismissable": true,
                "frequency": "once",
                "template": "info",
                "title": "Test Screen",
                "message": "Test message body here.",
                "contentHash": "hash1",
                "unknownField": "should be ignored",
                "anotherUnknown": 42
            ]
        ]
        let data = try JSONSerialization.data(withJSONObject: json)
        let session = mockSession(data: data)
        let service = makeService(session: session)

        let screens = try await service.fetchStartingScreens()

        XCTAssertEqual(screens.count, 1)
        XCTAssertEqual(screens["screen1"]?.title, "Test Screen")
    }

    // MARK: - API Error Responses

    func testFetchStartingScreens_serverError500() async throws {
        let data = "{\"error\": \"Internal Server Error\"}".data(using: .utf8)!
        let session = mockSession(data: data, statusCode: 500)
        let service = makeService(session: session)

        do {
            _ = try await service.fetchStartingScreens()
            XCTFail("Expected error for 500 response")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .badServerResponse)
        } catch {
            XCTFail("Expected URLError.badServerResponse, got \(error)")
        }
    }

    func testFetchStartingScreens_notFoundError404() async throws {
        let data = "{\"error\": \"Not found\"}".data(using: .utf8)!
        let session = mockSession(data: data, statusCode: 404)
        let service = makeService(session: session)

        do {
            _ = try await service.fetchStartingScreens()
            XCTFail("Expected error for 404 response")
        } catch let error as URLError {
            XCTAssertEqual(error.code, .badServerResponse)
        } catch {
            XCTFail("Expected URLError.badServerResponse, got \(error)")
        }
    }

    // MARK: - Network Error

    func testFetchStartingScreens_networkError() async throws {
        let session = mockSession(error: URLError(.notConnectedToInternet))
        let service = makeService(session: session)

        do {
            _ = try await service.fetchStartingScreens()
            XCTFail("Expected network error")
        } catch {
            XCTAssertTrue(error is URLError)
        }
    }

    // MARK: - X-Device-Id Header

    func testFetchStartingScreens_sendsDeviceIdHeader() async throws {
        let data = "{}".data(using: .utf8)!
        MockURLProtocol.requestValidator = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Device-Id"), "TEST-DEVICE-ID-12345")
        }
        let session = mockSession(data: data)
        let service = makeService(session: session)

        _ = try await service.fetchStartingScreens()
    }

    func testFetchStartingScreens_nilDeviceId_omitsHeader() async throws {
        let data = "{}".data(using: .utf8)!
        MockURLProtocol.requestValidator = { request in
            XCTAssertNil(request.value(forHTTPHeaderField: "X-Device-Id"))
        }
        let session = mockSession(data: data)
        let service = StartingScreenService(
            baseURL: "https://test.example.com",
            session: session
        )
        service.deviceIdProvider = { nil }

        _ = try await service.fetchStartingScreens()
    }

    // MARK: - URL Construction

    func testFetchStartingScreens_correctURL() async throws {
        let data = "{}".data(using: .utf8)!
        MockURLProtocol.requestValidator = { request in
            XCTAssertEqual(request.url?.absoluteString, "https://test.example.com/api/config/startingScreens")
        }
        let session = mockSession(data: data)
        let service = makeService(session: session)

        _ = try await service.fetchStartingScreens()
    }

    // MARK: - Optional Fields Nil

    func testFetchStartingScreens_optionalFieldsNil() async throws {
        let json: [String: Any] = [
            "minimal": [
                "enabled": true,
                "dismissable": true,
                "frequency": "once",
                "template": "info",
                "title": "Minimal Screen",
                "message": "Just the required fields.",
                "contentHash": "minhash"
            ]
        ]
        let data = try JSONSerialization.data(withJSONObject: json)
        let session = mockSession(data: data)
        let service = makeService(session: session)

        let screens = try await service.fetchStartingScreens()
        let screen = try XCTUnwrap(screens["minimal"])

        XCTAssertNil(screen.imageType)
        XCTAssertNil(screen.backgroundImage)
        XCTAssertNil(screen.startDate)
        XCTAssertNil(screen.endDate)
        XCTAssertNil(screen.lastModifiedAt)
    }

    // MARK: - Content Hash Missing Defaults to Empty

    func testFetchStartingScreens_missingContentHash_defaultsToEmpty() async throws {
        let json: [String: Any] = [
            "screen1": [
                "enabled": true,
                "dismissable": false,
                "frequency": "every_launch",
                "template": "warning",
                "title": "No Hash",
                "message": "This screen has no content hash."
            ]
        ]
        let data = try JSONSerialization.data(withJSONObject: json)
        let session = mockSession(data: data)
        let service = makeService(session: session)

        let screens = try await service.fetchStartingScreens()
        let screen = try XCTUnwrap(screens["screen1"])

        XCTAssertEqual(screen.contentHash, "")
    }

    // MARK: - Teardown

    override func tearDown() {
        MockURLProtocol.mockData = nil
        MockURLProtocol.mockStatusCode = 200
        MockURLProtocol.mockError = nil
        MockURLProtocol.mockDelay = nil
        MockURLProtocol.requestValidator = nil
        super.tearDown()
    }
}

// MARK: - MockURLProtocol

/// A mock URL protocol for intercepting URLSession requests in tests.
class MockURLProtocol: URLProtocol {
    static var mockData: Data?
    static var mockStatusCode: Int = 200
    static var mockError: Error?
    static var mockDelay: TimeInterval?
    static var requestValidator: ((URLRequest) -> Void)?

    override class func canInit(with request: URLRequest) -> Bool {
        return true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        return request
    }

    override func startLoading() {
        MockURLProtocol.requestValidator?(request)

        if let error = MockURLProtocol.mockError {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }

        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: MockURLProtocol.mockStatusCode,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!

        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)

        if let data = MockURLProtocol.mockData {
            client?.urlProtocol(self, didLoad: data)
        }

        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
