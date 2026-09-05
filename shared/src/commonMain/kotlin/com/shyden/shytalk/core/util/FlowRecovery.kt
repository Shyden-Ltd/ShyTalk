package com.shyden.shytalk.core.util

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch

/**
 * Recovers a real-time-listener [Flow] that ERRORS to a safe [fallback] instead
 * of letting the exception crash the app (SHY-0185).
 *
 * gitlive Firestore's `.snapshots` Flow surfaces an underlying listener error
 * (a rules `PERMISSION_DENIED` or a transient network drop) as a
 * `FirebaseFirestoreException` emitted INTO the Flow. On iOS an uncaught Flow
 * exception reaches Kotlin/Native's final-resort handler and aborts the process
 * (`SIGABRT`) — the confirmed cause of the post-sign-in crash. Android's
 * `addSnapshotListener` callback already swallows the error argument; this gives
 * the iOS Flows the same safety.
 *
 * Place it LAST in the chain: upstream operators (e.g. `map`) run before it, so
 * their errors are recovered too; anything added AFTER it is not protected.
 * Values emitted before the error are preserved; only the error is replaced by
 * [fallback]. Deliberately does NOT retry — a persistent error (e.g. a real rules
 * denial) would hot-loop; the listener therefore stays down until the collector
 * re-subscribes (next sign-in), which is the accepted residual until EPIC-0006.
 *
 * Recovers only an [Exception]. A fatal [Error] (OutOfMemoryError, StackOverflow)
 * is rethrown so a genuinely unrecoverable condition isn't masked as a safe
 * default — matching the boundary in [firebaseCall]. `kotlinx` `catch` already
 * rethrows [kotlinx.coroutines.CancellationException] before this lambda runs, so
 * coroutine cancellation is never swallowed.
 *
 * The proper fix is to stop touching Firestore from the client and route via the
 * Express API ([[feedback-no-direct-backend-all-via-api]] / EPIC-0006); this is
 * the acute crash mitigation.
 */
fun <T> Flow<T>.recoverListenerErrors(fallback: T): Flow<T> =
    catch { e ->
        if (e !is Exception) throw e
        emit(fallback)
    }

/**
 * Completes a realtime-listener [Flow] on an [Exception] instead of letting it
 * escape (SHY-0523).
 *
 * gitlive's `.snapshots` closes its Flow with the listener's
 * `FirebaseFirestoreException` (a rules denial after the session is revoked, a
 * network drop). On Kotlin/Native an exception escaping a `launch` reaches the
 * final-resort handler and aborts the process: the iPhone died 218 ms after the
 * SESSION_EXPIRED redirect because `config/economy` was denied. Android's native
 * listeners swallow the same error, so this gives iOS the same outcome, with a
 * WARN line that names the listener ([what]) instead of Android's silence.
 *
 * The Flow completes; values already emitted are kept and nothing replaces the
 * error. Use [recoverListenerErrors] downstream when a screen needs a safe
 * default value as well. Same boundary as [recoverListenerErrors]: a fatal
 * [Error] is rethrown, and `kotlinx` `catch` never sees a
 * [kotlinx.coroutines.CancellationException].
 */
fun <T> Flow<T>.completeOnListenerError(
    tag: String,
    what: String,
): Flow<T> =
    catch { e ->
        if (e !is Exception) throw e
        logW(tag, "$what listener failed; completing the flow instead of crashing (SHY-0523)", e)
    }
