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

    // MARK: - SHY-0275 — private-LAN cleartext, DEBUG builds only
    //
    // A physical iPhone reaches the developer's Mac by LAN address; unlike
    // Android it has no `adb reverse`, so loopback cannot serve and
    // `ws://<mac-lan-ip>:7880` was rejected before any network call. That is
    // why iOS-local voice had never worked.
    //
    // The relaxation is compiled out of Release. These tests run in a DEBUG
    // test build, so they assert the DEBUG behaviour; the rejection cases
    // below are asserted unconditionally because they must hold in EVERY
    // build, and those are the ones that matter if the guard ever slips.

    func test_isPrivateLAN_acceptsAllThreeRFC1918Blocks() {
        XCTAssertTrue(LiveKitBridgeImpl.isPrivateLAN("10.0.0.5"))
        XCTAssertTrue(LiveKitBridgeImpl.isPrivateLAN("172.16.0.1"))
        XCTAssertTrue(LiveKitBridgeImpl.isPrivateLAN("172.31.255.254"))
        XCTAssertTrue(LiveKitBridgeImpl.isPrivateLAN("192.168.1.9"))
    }

    func test_isPrivateLAN_rejectsJustOutsideThe172Block() {
        // THE case a `hasPrefix("172.")` check gets wrong: the private block is
        // 172.16–172.31, so 172.15 and 172.32 are PUBLIC addresses.
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN("172.15.0.1"))
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN("172.32.0.1"))
    }

    func test_isPrivateLAN_rejectsHostnameThatMerelyStartsLikeOne() {
        // THE case a `hasPrefix("10.")` check gets wrong — an attacker-controlled
        // hostname, not an address. Four components are required AND each must
        // parse as a number.
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN("10.0.0.5.evil.com"))
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN("192.168.1.9.attacker.net"))
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN("10.0.0"))
    }

    func test_isPrivateLAN_rejectsMalformedOctets() {
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN("10.0.0.256"))
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN("10.0.0."))
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN("10.0.0.0x5"))
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN(""))
    }

    func test_isPrivateLAN_rejectsPublicAddresses() {
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN("8.8.8.8"))
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN("192.169.1.1"))
        XCTAssertFalse(LiveKitBridgeImpl.isPrivateLAN("11.0.0.1"))
    }

    func test_isAllowedURL_rejectsCleartextToPublicHost_inEveryBuild() {
        // The property that must survive the DEBUG relaxation: cleartext is
        // permitted to a PRIVATE address only. If this ever passes, the guard
        // has been widened into a hole.
        XCTAssertFalse(LiveKitBridgeImpl.isAllowedURL("ws://8.8.8.8:7880"))
        XCTAssertFalse(LiveKitBridgeImpl.isAllowedURL("ws://172.32.0.1:7880"))
        XCTAssertFalse(LiveKitBridgeImpl.isAllowedURL("ws://evil.com:7880"))
        XCTAssertFalse(LiveKitBridgeImpl.isAllowedURL("ws://10.0.0.5.evil.com:7880"))
    }

    #if DEBUG
    func test_isAllowedURL_acceptsPrivateLANCleartext_inDebugOnly() {
        XCTAssertTrue(LiveKitBridgeImpl.isAllowedURL("ws://192.168.1.9:7880"))
        XCTAssertTrue(LiveKitBridgeImpl.isAllowedURL("ws://10.0.0.5:7880"))
        XCTAssertTrue(LiveKitBridgeImpl.isAllowedURL("ws://172.16.0.1:7880"))
    }
    #endif

    // NOTE: the `AppEnvironment.localHost` / local-URL tests live in
    // AppEnvironmentTests.swift, where they belong — this file's subject is the
    // LiveKit URL allow-list security boundary. Only the allow-list half of
    // SHY-0275 is tested here.
}
