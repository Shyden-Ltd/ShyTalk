package com.shyden.shytalk.data.remote

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Await an OkHttp call without blocking a thread, cancelling it if the coroutine
 * is cancelled.
 *
 * This lived as a byte-identical `private` copy in `WorkerApiClient`,
 * `AgeVerificationRepositoryImpl` and `StorageRepositoryImpl`. SHY-0387 needed a
 * fourth for the support-attachment PUT, which is the point at which copying it
 * again stops being cheaper than sharing it.
 *
 * `invokeOnCancellation { cancel() }` is the part worth not re-deriving: without
 * it a cancelled coroutine leaves the HTTP call running, holding a connection and
 * eventually delivering a response nobody is waiting for.
 */
internal suspend fun Call.executeAsync(): Response =
    suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cancel() }
        enqueue(
            object : Callback {
                override fun onFailure(
                    call: Call,
                    e: IOException,
                ) = cont.resumeWithException(e)

                override fun onResponse(
                    call: Call,
                    response: Response,
                ) = cont.resume(response)
            },
        )
    }
