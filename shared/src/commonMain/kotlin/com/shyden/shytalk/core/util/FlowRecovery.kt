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
 * Terminal `catch` so it also covers any downstream `map`. Values emitted before
 * the error are preserved; only the error is replaced by [fallback]. Deliberately
 * does NOT retry — a persistent error (e.g. a real rules denial) would hot-loop.
 *
 * The proper fix is to stop touching Firestore from the client and route via the
 * Express API ([[feedback-no-direct-backend-all-via-api]] / EPIC-0006); this is
 * the acute crash mitigation.
 */
fun <T> Flow<T>.recoverListenerErrors(fallback: T): Flow<T> = catch { emit(fallback) }
