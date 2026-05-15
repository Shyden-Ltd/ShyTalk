import XCTest
@testable import iosApp

/// UK OSA #17 PR 12 — XCTest for the iOS LiveKitBridge defence-in-depth
/// pre-connect URL allow-list. The server-side cohort gate (Express
/// `routes/livekit.js`) refuses to mint tokens for cross-cohort rooms,
/// so a valid token is *expected* to already be cohort-clean. These
/// tests pin the bridge's residual defenses: it must refuse any LiveKit
/// URL that is not localhost (local dev) or the two Oracle Cloud hosts
/// (dev/prod EU + Singapore).
///
/// Regression coverage:
/// - Attacker tampering with the Kotlin layer to swap in a malicious URL
/// - Buggy Region API returning a non-allowed URL
/// - Stale build pointed at a deprecated host
final class AgeSegregationTests: XCTestCase {
    // MARK: - Allowed hosts

    func test_isAllowedURL_acceptsProductionSingapore() {
        XCTAssertTrue(LiveKitBridgeImpl.isAllowedURL("wss://livekit.shytalk.shyden.co.uk"))
    }

    func test_isAllowedURL_acceptsProductionLondon() {
        XCTAssertTrue(LiveKitBridgeImpl.isAllowedURL("wss://livekit-eu.shytalk.shyden.co.uk"))
    }

    func test_isAllowedURL_acceptsLocalhostWS_forLocalDev() {
        XCTAssertTrue(LiveKitBridgeImpl.isAllowedURL("ws://localhost:7880"))
    }

    func test_isAllowedURL_acceptsLocalhost127001() {
        XCTAssertTrue(LiveKitBridgeImpl.isAllowedURL("ws://127.0.0.1:7880"))
    }

    // MARK: - Rejected hosts (attacker / misconfiguration paths)

    func test_isAllowedURL_rejectsArbitraryHost() {
        XCTAssertFalse(LiveKitBridgeImpl.isAllowedURL("wss://evil.example.com"))
    }

    func test_isAllowedURL_rejectsHttpScheme() {
        // LiveKit cannot run over HTTP; this also blocks downgrade attacks.
        XCTAssertFalse(LiveKitBridgeImpl.isAllowedURL("http://livekit.shytalk.shyden.co.uk"))
    }

    func test_isAllowedURL_rejectsHttpsScheme() {
        // HTTPS is not a LiveKit scheme; rejecting prevents subtle misconfig.
        XCTAssertFalse(LiveKitBridgeImpl.isAllowedURL("https://livekit.shytalk.shyden.co.uk"))
    }

    func test_isAllowedURL_rejectsPlainWSToProductionHost() {
        // Production must use wss:// — plain ws:// to a public host would
        // expose the token over an unencrypted channel.
        XCTAssertFalse(LiveKitBridgeImpl.isAllowedURL("ws://livekit.shytalk.shyden.co.uk"))
    }

    func test_isAllowedURL_rejectsEmptyString() {
        XCTAssertFalse(LiveKitBridgeImpl.isAllowedURL(""))
    }

    func test_isAllowedURL_rejectsMalformedURL() {
        XCTAssertFalse(LiveKitBridgeImpl.isAllowedURL("not-a-url"))
    }

    func test_isAllowedURL_rejectsLookalikeDomain() {
        // Subtle phishing — same suffix, different host.
        XCTAssertFalse(LiveKitBridgeImpl.isAllowedURL("wss://livekit.shytalk.shyden-co-uk.attacker.com"))
    }

    // MARK: - Token validation (empty / whitespace-only)

    func test_isValidToken_acceptsRegularToken() {
        XCTAssertTrue(LiveKitBridgeImpl.isValidToken("eyJhbGciOi.JWT.payload.signature"))
    }

    func test_isValidToken_rejectsEmptyString() {
        XCTAssertFalse(LiveKitBridgeImpl.isValidToken(""))
    }

    func test_isValidToken_rejectsWhitespaceOnly() {
        // A whitespace-only token would also crash LiveKit's JWT parser.
        XCTAssertFalse(LiveKitBridgeImpl.isValidToken("   "))
        XCTAssertFalse(LiveKitBridgeImpl.isValidToken("\t\n "))
    }

    func test_isValidToken_acceptsTokenWithInternalWhitespace() {
        // Real JWTs never contain whitespace, but the validator only
        // rejects EMPTY/WHITESPACE-ONLY. A token with leading whitespace
        // followed by content still passes (the JWT decoder will reject
        // it downstream with a clearer error than "missing_livekit_token").
        XCTAssertTrue(LiveKitBridgeImpl.isValidToken(" not-empty "))
    }
}
