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
    fun `the server's unknown sentinel is absence, not a sha`() {
        // Express answers `sha: "unknown"` when no DEPLOYED_SHA env var and
        // no .deployed-sha file exist (src/index.js resolveDeployedSha) —
        // i.e. "I do not know my build", which is normal on a local stack.
        //
        // That word is EXACTLY 7 characters, the same budget
        // WatermarkFormat.SHA_DISPLAY_CHARS gives a short sha, so it used
        // to survive truncation untouched and render as `api unknown`
        // beside a GREEN dot — a line the operator could not read as
        // anything but a contradiction (2026-08-22, journey J38 step 10).
        // The server's vocabulary is translated to ours HERE, at the
        // boundary, so every downstream slot sees plain absence.
        val verdict =
            ServerHealth.verdict(
                Resource.Success(
                    BackendHealthStatus(status = "ok", firestoreAvailable = true, timestamp = 1L, sha = "unknown"),
                ),
            )
        assertEquals(ServerHealthVerdict(sha = null, ok = true), verdict)
    }

    @Test
    fun `the sentinel is rejected whatever case or padding it arrives in`() {
        listOf("UNKNOWN", "Unknown", "  unknown  ").forEach { sentinel ->
            val verdict =
                ServerHealth.verdict(
                    Resource.Success(
                        BackendHealthStatus(status = "ok", firestoreAvailable = true, timestamp = 1L, sha = sentinel),
                    ),
                )
            assertEquals(ServerHealthVerdict(sha = null, ok = true), verdict, "sentinel: <$sentinel>")
        }
    }

    @Test
    fun `a real sha that merely starts with the sentinel is kept`() {
        // Guards the narrowing: rejecting a PREFIX rather than the whole
        // value would throw away a legitimate commit whose short sha
        // happens to begin with those letters.
        val verdict =
            ServerHealth.verdict(
                Resource.Success(
                    BackendHealthStatus(status = "ok", firestoreAvailable = true, timestamp = 1L, sha = "unknown0feed"),
                ),
            )
        assertEquals(ServerHealthVerdict(sha = "unknown0feed", ok = true), verdict)
    }
}
