package com.shyden.shytalk.core.push

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.NotificationRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Shorthand: a legacy registration-token identifier. */
private fun tok(value: String) = PushIdentifier(value, PushIdentifierKind.REGISTRATION_TOKEN)

/** Shorthand: a V1 Firebase Installation ID. */
private fun fid(value: String) = PushIdentifier(value, PushIdentifierKind.INSTALLATION_ID)

@OptIn(ExperimentalCoroutinesApi::class)
class PushTokenManagerTest {
    private fun makeManager(
        bridge: PushTokenBridge?,
        repo: NotificationRepository,
    ) = PushTokenManager(bridgeProvider = { bridge }, notificationRepo = repo)

    // ── syncToken behaviour ─────────────────────────────────────────────

    @Test
    fun syncToken_doesNothingWhenBridgeIsNull() =
        runTest {
            val repo = FakeNotificationRepository()
            makeManager(bridge = null, repo = repo).syncToken("user-1")
            assertEquals(0, repo.saveCalls.size)
        }

    @Test
    fun syncToken_doesNothingWhenCurrentTokenIsNull() =
        runTest {
            val bridge = FakeBridge(currentToken = null, lastRegistered = null)
            val repo = FakeNotificationRepository()
            makeManager(bridge, repo).syncToken("user-1")
            assertEquals(0, repo.saveCalls.size)
            assertNull(bridge.lastRegistered)
        }

    @Test
    fun syncToken_skipsWhenCurrentEqualsLastRegistered() =
        runTest {
            val bridge = FakeBridge(currentToken = tok("token-A"), lastRegistered = tok("token-A"))
            val repo = FakeNotificationRepository()
            makeManager(bridge, repo).syncToken("user-1")
            assertEquals(0, repo.saveCalls.size, "Idempotent — no repo call when token already registered")
            assertEquals(tok("token-A"), bridge.lastRegistered)
        }

    @Test
    fun syncToken_postsAndCachesOnSuccess() =
        runTest {
            val bridge = FakeBridge(currentToken = tok("token-A"), lastRegistered = null)
            val repo = FakeNotificationRepository()
            makeManager(bridge, repo).syncToken("user-1")
            assertEquals(1, repo.saveCalls.size)
            assertEquals("user-1" to tok("token-A"), repo.saveCalls.first())
            assertEquals(tok("token-A"), bridge.lastRegistered)
        }

    @Test
    fun syncToken_postsButDoesNotCacheOnFailure() =
        runTest {
            val bridge = FakeBridge(currentToken = tok("token-A"), lastRegistered = null)
            val repo = FakeNotificationRepository(saveResult = Resource.Error("backend down"))
            makeManager(bridge, repo).syncToken("user-1")
            assertEquals(1, repo.saveCalls.size)
            assertNull(bridge.lastRegistered, "Cache stays null so a later trigger retries")
        }

    @Test
    fun syncToken_replacesExistingRegisteredTokenOnRotation() =
        runTest {
            val bridge = FakeBridge(currentToken = tok("token-NEW"), lastRegistered = tok("token-OLD"))
            val repo = FakeNotificationRepository()
            makeManager(bridge, repo).syncToken("user-1")
            assertEquals(1, repo.saveCalls.size)
            assertEquals("user-1" to tok("token-NEW"), repo.saveCalls.first())
            assertEquals(tok("token-NEW"), bridge.lastRegistered)
        }

    // ── clearToken behaviour ────────────────────────────────────────────

    @Test
    fun clearToken_doesNothingWhenBridgeIsNull() =
        runTest {
            val repo = FakeNotificationRepository()
            makeManager(bridge = null, repo = repo).clearToken("user-1")
            assertEquals(0, repo.removeCalls.size)
        }

    @Test
    fun clearToken_doesNothingWhenLastRegisteredIsNull() =
        runTest {
            val bridge = FakeBridge(currentToken = tok("token-A"), lastRegistered = null)
            val repo = FakeNotificationRepository()
            makeManager(bridge, repo).clearToken("user-1")
            assertEquals(0, repo.removeCalls.size)
        }

    @Test
    fun clearToken_postsAndClearsOnSuccess() =
        runTest {
            val bridge = FakeBridge(currentToken = tok("token-A"), lastRegistered = tok("token-A"))
            val repo = FakeNotificationRepository()
            makeManager(bridge, repo).clearToken("user-1")
            assertEquals(1, repo.removeCalls.size)
            assertEquals("user-1" to tok("token-A"), repo.removeCalls.first())
            assertNull(bridge.lastRegistered)
        }

    @Test
    fun clearToken_keepsCacheOnFailure() =
        runTest {
            val bridge = FakeBridge(currentToken = tok("token-A"), lastRegistered = tok("token-A"))
            val repo = FakeNotificationRepository(removeResult = Resource.Error("backend down"))
            makeManager(bridge, repo).clearToken("user-1")
            assertEquals(1, repo.removeCalls.size)
            assertEquals(
                tok("token-A"),
                bridge.lastRegistered,
                "Cache stays so a later remove still has the value to delete",
            )
        }

    @Test
    fun clearToken_usesLastRegisteredNotCurrent() =
        runTest {
            // Live token has rotated since the registered one was saved.
            // Sign-out should remove what was actually registered, not whatever is current.
            val bridge = FakeBridge(currentToken = tok("token-NEW"), lastRegistered = tok("token-OLD"))
            val repo = FakeNotificationRepository()
            makeManager(bridge, repo).clearToken("user-1")
            assertEquals(1, repo.removeCalls.size)
            assertEquals("user-1" to tok("token-OLD"), repo.removeCalls.first())
            assertNull(bridge.lastRegistered)
        }

    // ── concurrency ─────────────────────────────────────────────────────

    @Test
    fun mutex_serialisesSaveRemoveSaveSequence() =
        runTest {
            // Simulate the worst case: rapid sign-out (user A) → sign-in (user B)
            // where each step involves an async backend call. Without the Mutex
            // these would interleave: clearToken would read lastRegisteredToken=null
            // before A's save completes, return early, and userA's token would
            // remain registered indefinitely.
            val bridge = FakeBridge(currentToken = tok("token-A"), lastRegistered = null)
            val repo = SlowNotificationRepository(perCallDelayMs = 50)
            val manager = makeManager(bridge, repo)

            coroutineScope {
                launch { manager.syncToken("user-A") }
                launch { manager.clearToken("user-A") }
                launch {
                    // Token rotates between sign-out and sign-in.
                    bridge.currentToken = tok("token-B")
                    manager.syncToken("user-B")
                }
            }

            // With the Mutex, operations execute strictly in launch order.
            assertEquals(2, repo.saveCalls.size, "Two saves: A then B")
            assertEquals(1, repo.removeCalls.size, "One remove for A")
            assertEquals("user-A" to tok("token-A"), repo.saveCalls[0])
            assertEquals("user-A" to tok("token-A"), repo.removeCalls[0])
            assertEquals("user-B" to tok("token-B"), repo.saveCalls[1])
            assertEquals(tok("token-B"), bridge.lastRegistered)

            assertEquals(
                listOf(
                    "save(user-A, token-A)",
                    "remove(user-A, token-A)",
                    "save(user-B, token-B)",
                ),
                repo.callLog,
                "Strict serialisation: no interleaving of save/remove/save",
            )
        }

    // ── SHY-0244: the installation-ID model ─────────────────────────────

    /**
     * A migrated device registers an installation ID, and the KIND has to
     * survive the trip. If it were dropped the backend would file the value as
     * a registration token, addressing it would fail, and the reaper would
     * delete it — ending push for that device with nothing reporting a fault.
     */
    @Test
    fun syncToken_forwardsTheInstallationIdKind() =
        runTest {
            val bridge = FakeBridge(currentToken = fid("fid-A"), lastRegistered = null)
            val repo = FakeNotificationRepository()
            makeManager(bridge, repo).syncToken("user-1")
            assertEquals(1, repo.saveCalls.size)
            assertEquals("user-1" to fid("fid-A"), repo.saveCalls.first())
            assertEquals(fid("fid-A"), bridge.lastRegistered)
        }

    /**
     * The same string under two models is two different registrations. Only
     * comparing values would treat an upgrade as "already registered" and
     * never tell the backend the model changed.
     */
    @Test
    fun syncToken_treatsAChangeOfKindAsAChange() =
        runTest {
            val bridge = FakeBridge(currentToken = fid("same-value"), lastRegistered = tok("same-value"))
            val repo = FakeNotificationRepository()
            makeManager(bridge, repo).syncToken("user-1")
            assertEquals(1, repo.saveCalls.size, "A model change must be re-registered")
            assertEquals("user-1" to fid("same-value"), repo.saveCalls.first())
        }

    @Test
    fun clearToken_removesTheInstallationIdItRegistered() =
        runTest {
            // Sign-out has to clear the identifier under the model it was
            // stored with, or the next person on this device receives the
            // previous user's notifications.
            val bridge = FakeBridge(currentToken = fid("fid-A"), lastRegistered = fid("fid-A"))
            val repo = FakeNotificationRepository()
            makeManager(bridge, repo).clearToken("user-1")
            assertEquals(1, repo.removeCalls.size)
            assertEquals("user-1" to fid("fid-A"), repo.removeCalls.first())
            assertNull(bridge.lastRegistered)
        }

    @Test
    fun mutex_doesNotDeadlockOnSequentialCalls() =
        runTest {
            val bridge = FakeBridge(currentToken = tok("token-A"), lastRegistered = null)
            val repo = FakeNotificationRepository()
            val manager = makeManager(bridge, repo)
            manager.syncToken("user-1")
            manager.syncToken("user-1")
            manager.clearToken("user-1")
            assertTrue(true, "Reached end without deadlock")
        }
}

// ── Test fakes ──────────────────────────────────────────────────────────

private class FakeBridge(
    var currentToken: PushIdentifier?,
    var lastRegistered: PushIdentifier?,
) : PushTokenBridge {
    override fun currentPushIdentifier(): PushIdentifier? = currentToken

    override fun lastRegisteredIdentifier(): PushIdentifier? = lastRegistered

    override fun setLastRegisteredIdentifier(identifier: PushIdentifier?) {
        lastRegistered = identifier
    }
}

private class FakeNotificationRepository(
    private val saveResult: Resource<Unit> = Resource.Success(Unit),
    private val removeResult: Resource<Unit> = Resource.Success(Unit),
) : NotificationRepository {
    val saveCalls = mutableListOf<Pair<String, PushIdentifier>>()
    val removeCalls = mutableListOf<Pair<String, PushIdentifier>>()

    override suspend fun savePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> {
        saveCalls.add(userId to identifier)
        return saveResult
    }

    override suspend fun removePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> {
        removeCalls.add(userId to identifier)
        return removeResult
    }

    override suspend fun setPmNotificationsEnabled(
        userId: String,
        enabled: Boolean,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean> = Resource.Success(true)
}

private class SlowNotificationRepository(
    private val perCallDelayMs: Long,
) : NotificationRepository {
    val saveCalls = mutableListOf<Pair<String, PushIdentifier>>()
    val removeCalls = mutableListOf<Pair<String, PushIdentifier>>()
    val callLog = mutableListOf<String>()

    override suspend fun savePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> {
        callLog.add("save($userId, ${identifier.value})")
        delay(perCallDelayMs)
        saveCalls.add(userId to identifier)
        return Resource.Success(Unit)
    }

    override suspend fun removePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> {
        callLog.add("remove($userId, ${identifier.value})")
        delay(perCallDelayMs)
        removeCalls.add(userId to identifier)
        return Resource.Success(Unit)
    }

    override suspend fun setPmNotificationsEnabled(
        userId: String,
        enabled: Boolean,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean> = Resource.Success(true)
}
