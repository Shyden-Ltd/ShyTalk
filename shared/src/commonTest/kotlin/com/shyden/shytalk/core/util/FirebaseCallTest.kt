package com.shyden.shytalk.core.util

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Tests for [firebaseCall] — the generic suspend-wrapper that every
 * repository uses to convert thrown exceptions into [Resource.Error] and
 * non-throwing results into [Resource.Success].
 *
 * The wrapper is in commonMain and is exercised here from commonTest so the
 * contract is verified for both Android and iOS targets without requiring
 * platform-specific test infrastructure.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FirebaseCallTest {
    // ── Success path ───────────────────────────────────────────────────

    @Test
    fun `success returns Resource Success with the block's value`() =
        runTest {
            val result = firebaseCall { 42 }
            assertTrue(result is Resource.Success, "expected Success, got $result")
            assertEquals(42, result.data)
        }

    @Test
    fun `success path works for Unit returns (fire-and-forget repository methods)`() =
        runTest {
            // Every mutation method in IosRoomRepositoryImpl + RoomRepositoryImpl
            // returns Resource<Unit>; the wrapper must hand back Resource.Success(Unit).
            // The lambda body intentionally has no statements — it implicitly returns
            // Unit, which is what we want to assert is propagated through.
            val result: Resource<Unit> = firebaseCall { }
            assertTrue(result is Resource.Success, "expected Success, got $result")
            assertEquals(Unit, result.data)
        }

    @Test
    fun `success path works for String returns (e g  ID-returning create methods)`() =
        runTest {
            val result = firebaseCall { "room-abc-123" }
            assertTrue(result is Resource.Success, "expected Success, got $result")
            assertEquals("room-abc-123", result.data)
        }

    @Test
    fun `success path handles null return for nullable T`() =
        runTest {
            // Some repository methods return `Resource<T?>` where the block
            // legitimately returns null (e.g. "lookup a user that may not exist").
            // The wrapper must propagate null through Resource.Success(null), NOT
            // convert it to Resource.Error or short-circuit.
            val result: Resource<String?> = firebaseCall { null }
            assertTrue(result is Resource.Success, "expected Success, got $result")
            assertEquals(null, result.data)
        }

    // ── Error path: exception with a message ───────────────────────────

    @Test
    fun `exception with a message converts to Resource Error with that message`() =
        runTest {
            val result = firebaseCall<Unit> { throw RuntimeException("Room is closed") }
            assertTrue(result is Resource.Error, "expected Error, got $result")
            assertEquals("Room is closed", result.message)
        }

    // ── Error path: null exception message → default / custom errorMessage ──

    @Test
    fun `exception with null message falls back to the default errorMessage`() =
        runTest {
            // Mirrors the production contract: when an underlying library throws
            // with a null .message (some Firebase SDKs do this on dropped txns),
            // the wrapper's default "Operation failed" must surface so the user
            // sees SOMETHING instead of an empty string.
            val result = firebaseCall<Unit> { throw RuntimeException() }
            assertTrue(result is Resource.Error, "expected Error, got $result")
            assertEquals("Operation failed", result.message)
        }

    @Test
    fun `exception with null message uses the custom errorMessage parameter`() =
        runTest {
            // Each repository call site passes its own descriptive errorMessage
            // ("Failed to kick user", "Failed to add host", etc.) so the user-
            // facing error is actionable even when the underlying exception is
            // anonymous. This pins that contract.
            val result =
                firebaseCall<Unit>(errorMessage = "Failed to kick user") {
                    throw RuntimeException()
                }
            assertTrue(result is Resource.Error, "expected Error, got $result")
            assertEquals("Failed to kick user", result.message)
        }

    @Test
    fun `exception with empty string message also falls back to the errorMessage`() =
        runTest {
            // A bare `?:` operator only catches `null`, not empty string.
            // An empty exception message gives the user no actionable info,
            // so empty must also fall back to the call-site's descriptive
            // errorMessage. The production fix uses `?.takeIf { it.isNotEmpty() } ?:`
            // to handle both null and empty cases uniformly.
            val result =
                firebaseCall<Unit>(errorMessage = "Failed to kick user") {
                    throw RuntimeException("")
                }
            assertTrue(result is Resource.Error, "expected Error, got $result")
            assertEquals("Failed to kick user", result.message)
        }

    // ── Error path: original exception preserved ───────────────────────

    @Test
    fun `the original exception instance is preserved on Resource Error exception field`() =
        runTest {
            // Sentry / logcat upstream relies on the original Throwable for
            // stack-trace symbolication; the wrapper MUST NOT replace it with
            // a synthetic exception.
            val original = IllegalStateException("specific cause")
            val result = firebaseCall<Unit> { throw original }
            assertTrue(result is Resource.Error, "expected Error, got $result")
            assertSame(original, result.exception, "wrapper must keep the original throwable")
        }

    // ── Structured concurrency: CancellationException rethrows ─────────

    @Test
    fun `CancellationException is rethrown as the exact same instance (structured concurrency)`() =
        runTest {
            // Swallowing CancellationException breaks coroutine cancellation
            // propagation — a scope canceller would never get its cancel signal.
            // The wrapper's contract is to RETHROW it verbatim (same instance,
            // not a wrapper), NOT convert to Resource.Error.
            val original = CancellationException("user-cancelled")
            try {
                firebaseCall<Unit> { throw original }
                fail("expected CancellationException to propagate, but firebaseCall returned normally")
            } catch (e: CancellationException) {
                assertSame(original, e, "rethrown exception must be the exact same instance")
            }
        }

    // ── Generic exception types ────────────────────────────────────────

    @Test
    fun `non-Exception Error subtypes (OutOfMemoryError, etc) propagate uncaught — not converted to Resource Error`() =
        runTest {
            // The catch on `Exception` is deliberately narrower than `Throwable`:
            // fatal JVM errors (OOM, stack overflow, etc.) should crash the
            // coroutine rather than be silently wrapped. This test pins that
            // intentional catch boundary — a future "let me catch Throwable
            // instead" change would now be a deliberate, reviewable diff.
            try {
                firebaseCall<Unit> { throw OutOfMemoryError("test OOM") }
                fail("expected OutOfMemoryError to propagate uncaught, but firebaseCall returned normally")
            } catch (e: OutOfMemoryError) {
                assertEquals("test OOM", e.message)
            }
        }

    @Test
    fun `wrapper handles arbitrary Exception subtypes (IllegalStateException, IllegalArgumentException, etc)`() =
        runTest {
            // Mirrors the wide range of exception types Firebase / ApiException
            // can throw in production — the catch must be on Exception broadly,
            // not narrowly typed.
            val cases =
                listOf(
                    IllegalStateException("state"),
                    IllegalArgumentException("arg"),
                    NoSuchElementException("element"),
                )
            for (e in cases) {
                val result = firebaseCall<Unit> { throw e }
                assertTrue(result is Resource.Error, "expected Error for $e, got $result")
                assertEquals(e.message, result.message)
                assertSame(e, result.exception, "expected same instance for $e")
            }
        }
}
