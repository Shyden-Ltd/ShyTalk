package com.shyden.shytalk.core

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.BackendHealthStatus
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Maps a completed `checkBackendHealth()` call onto the watermark's
 * server slots (SHY-0205). Pinned here because the two platform impls
 * differ in failure shape: Android surfaces Resource.Error, while the
 * iOS impl catches transport failures into a SUCCESS carrying
 * `status = "degraded"` — both must read as a red dot.
 */
class ServerHealthTest {
    @Test
    fun `ok status with sha maps to green verdict carrying the sha`() {
        val verdict =
            ServerHealth.verdict(
                Resource.Success(
                    BackendHealthStatus(status = "ok", firestoreAvailable = true, timestamp = 1L, sha = "abc1234"),
                ),
            )
        assertEquals(ServerHealthVerdict(sha = "abc1234", ok = true), verdict)
    }

    @Test
    fun `ok status without sha maps to green verdict with null sha`() {
        val verdict =
            ServerHealth.verdict(
                Resource.Success(
                    BackendHealthStatus(status = "ok", firestoreAvailable = true, timestamp = 1L),
                ),
            )
        assertEquals(ServerHealthVerdict(sha = null, ok = true), verdict)
    }

    @Test
    fun `degraded status maps to red verdict retaining any sha`() {
        val verdict =
            ServerHealth.verdict(
                Resource.Success(
                    BackendHealthStatus(status = "degraded", firestoreAvailable = false, timestamp = 1L, sha = "abc1234"),
                ),
            )
        assertEquals(ServerHealthVerdict(sha = "abc1234", ok = false), verdict)
    }

    @Test
    fun `error resource maps to red verdict with null sha`() {
        val verdict = ServerHealth.verdict(Resource.Error("connection refused"))
        assertEquals(ServerHealthVerdict(sha = null, ok = false), verdict)
    }

    @Test
    fun `loading resource maps to red verdict so a stuck poll never fakes green`() {
        val verdict = ServerHealth.verdict(Resource.Loading)
        assertEquals(ServerHealthVerdict(sha = null, ok = false), verdict)
    }

    @Test
    fun `unknown emulator sha literal passes through for local builds`() {
        // Local Express reports sha "unknown" (no .deployed-sha file) —
        // the verdict passes it through; WatermarkFormat trims to 7 chars
        // rendering "unknown", which IS the honest local answer.
        val verdict =
            ServerHealth.verdict(
                Resource.Success(
                    BackendHealthStatus(status = "ok", firestoreAvailable = true, timestamp = 1L, sha = "unknown"),
                ),
            )
        assertEquals(ServerHealthVerdict(sha = "unknown", ok = true), verdict)
    }
}
