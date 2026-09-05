package com.shyden.shytalk.core.util

import dev.gitlive.firebase.firestore.CollectionReference
import dev.gitlive.firebase.firestore.DocumentReference
import dev.gitlive.firebase.firestore.DocumentSnapshot
import dev.gitlive.firebase.firestore.Query
import dev.gitlive.firebase.firestore.QuerySnapshot
import kotlinx.coroutines.flow.Flow

private const val TAG = "FirestoreListener"

/**
 * The only sanctioned way to open a Firestore realtime listener on iOS
 * (SHY-0523). The raw gitlive `.snapshots` closes its Flow with the listener's
 * exception, and an unguarded collector aborts the process on Kotlin/Native;
 * [completeOnListenerError] logs the failure with the path and completes the
 * Flow instead. `IosFirestoreListenersAreGuardedPinTest` fails on any raw
 * `.snapshots` outside this file.
 */
val DocumentReference.guardedSnapshots: Flow<DocumentSnapshot>
    get() = snapshots.completeOnListenerError(TAG, "document $path")

/** Collection listener; the collection path is known, so the log names it. */
val CollectionReference.guardedSnapshots: Flow<QuerySnapshot>
    get() = snapshots.completeOnListenerError(TAG, "collection $path")

/** Filtered or ordered query listener; gitlive exposes no path for a query. */
val Query.guardedSnapshots: Flow<QuerySnapshot>
    get() = snapshots.completeOnListenerError(TAG, "query")
