package com.shyden.shytalk.core.push

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.NotificationRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * SHY-0494 — signing out must REMOVE this device's push registration, and must
 * do it before the credential that authorises the removal is thrown away.
 *
 * Found on dev: four accounts on one phone all held the same installation ID,
 * among them a minor and an admin. A push to any of them arrived on that
 * device.
 *
 * The cause was ORDERING, not the removal code. `onSignOut` fired the removal
 * into a coroutine scope and then, synchronously, signed out of auth and
 * navigated away — so the removal lost two races at once: its scope was
 * cancelled by the navigation, and its credential was revoked before the
 * request landed. Both are invisible: removal is best-effort and logged.
 *
 * These tests pin the ORDER. A test that only asserted "removal was called"
 * would have passed against the broken code, which called it too.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignOutCoordinatorTest {
    @Test
    fun signOut_removesTheIdentifierBeforeSigningOut() =
        runTest {
            val log = mutableListOf<String>()
            val bridge = RecordingBridge(fid("fid-A"), fid("fid-A"))
            val repo = RecordingRepository(log)
            val coordinator = SignOutCoordinator()
            val mgr = PushTokenManager({ bridge }, repo)

            coordinator.signOut("user-1", { mgr.clearToken(it) }) { log.add("auth-signed-out") }

            assertEquals(listOf("remove(user-1)", "auth-signed-out"), log)
        }

    @Test
    fun signOut_doesNotReturnUntilSigningOutHasActuallyFINISHED() =
        runTest {
            // SHY-0497. The caller navigates to the sign-in screen on the line
            // after this returns, and the screen it lands on immediately asks
            // Firebase whether anybody is signed in. If this returns early the
            // answer is still "yes", and the app goes straight back to Home with
            // the person who just signed out back inside their account.
            //
            // The broken callers passed a lambda that LAUNCHED the sign-out and
            // returned, so the await here awaited nothing. This asserts what a
            // caller has to honour: when signOut() returns, it is done.
            val bridge = RecordingBridge(fid("fid-A"), fid("fid-A"))
            val repo = RecordingRepository(mutableListOf())
            val coordinator = SignOutCoordinator()
            val mgr = PushTokenManager({ bridge }, repo)
            var signedOut = false

            coordinator.signOut("user-1", { mgr.clearToken(it) }) {
                // A real sign-out reaches the Keychain and Firebase; it does not
                // complete on the tick the caller invoked it on.
                kotlinx.coroutines.yield()
                signedOut = true
            }

            assertTrue(signedOut, "signOut() returned before the sign-out completed")
        }

    @Test
    fun signOut_stillSignsOutWhenRemovalHangs() =
        runTest {
            // Offline sign-out must not trap somebody in the app. The identifier
            // being left behind is a real problem, but refusing to sign out is a
            // worse one — and it is the person in front of the phone who pays.
            val log = mutableListOf<String>()
            val bridge = RecordingBridge(fid("fid-A"), fid("fid-A"))
            val repo = HangingRepository()
            val coordinator = SignOutCoordinator(timeoutMs = 50)
            val mgr = PushTokenManager({ bridge }, repo)

            coordinator.signOut("user-1", { mgr.clearToken(it) }) { log.add("auth-signed-out") }

            assertEquals(listOf("auth-signed-out"), log)
        }

    @Test
    fun signOut_stillSignsOutWhenRemovalFails() =
        runTest {
            val log = mutableListOf<String>()
            val bridge = RecordingBridge(fid("fid-A"), fid("fid-A"))
            val repo = FailingRepository()
            val coordinator = SignOutCoordinator()
            val mgr = PushTokenManager({ bridge }, repo)

            coordinator.signOut("user-1", { mgr.clearToken(it) }) { log.add("auth-signed-out") }

            assertTrue(log.contains("auth-signed-out"))
        }

    @Test
    fun signOut_withNoUserStillSignsOut() =
        runTest {
            val log = mutableListOf<String>()
            val bridge = RecordingBridge(fid("fid-A"), fid("fid-A"))
            val coordinator = SignOutCoordinator()
            val mgr = PushTokenManager({ bridge }, RecordingRepository(log))

            coordinator.signOut(null, { mgr.clearToken(it) }) { log.add("auth-signed-out") }

            assertEquals(listOf("auth-signed-out"), log)
        }

    @Test
    fun signOut_clearsTheCachedIdentifierSoTheNextPersonDoesNotInheritIt() =
        runTest {
            // The residue that started this story. If the cache survives, the
            // next account signing in on this phone re-registers the SAME
            // identifier and both accounts then claim the device.
            val bridge = RecordingBridge(fid("fid-A"), fid("fid-A"))
            val coordinator = SignOutCoordinator()
            val mgr = PushTokenManager({ bridge }, RecordingRepository(mutableListOf()))

            coordinator.signOut("user-1", { mgr.clearToken(it) }) {}

            assertEquals(null, bridge.lastRegistered)
        }
}

private fun fid(v: String) = PushIdentifier(v, PushIdentifierKind.INSTALLATION_ID)

private class RecordingBridge(
    var current: PushIdentifier?,
    var lastRegistered: PushIdentifier?,
) : PushTokenBridge {
    override fun currentPushIdentifier() = current

    override fun lastRegisteredIdentifier() = lastRegistered

    override fun setLastRegisteredIdentifier(identifier: PushIdentifier?) {
        lastRegistered = identifier
    }
}

private open class RecordingRepository(
    private val log: MutableList<String>,
) : NotificationRepository {
    override suspend fun savePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun removePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> {
        log.add("remove($userId)")
        return Resource.Success(Unit)
    }

    override suspend fun setPmNotificationsEnabled(
        userId: String,
        enabled: Boolean,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean> = Resource.Success(true)
}

private class HangingRepository : RecordingRepository(mutableListOf()) {
    override suspend fun removePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> {
        delay(10_000)
        return Resource.Success(Unit)
    }
}

private class FailingRepository : RecordingRepository(mutableListOf()) {
    override suspend fun removePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> = Resource.Error("backend unreachable")
}
