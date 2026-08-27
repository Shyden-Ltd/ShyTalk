package com.shyden.shytalk.steps

import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserFlags
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.fake.FakeAuthRepository
import com.shyden.shytalk.fake.FakeUserRepository
import io.cucumber.java.en.Given
import org.koin.java.KoinJavaComponent.getKoin

class AuthSteps {
    @Given("I am not authenticated")
    fun iAmNotAuthenticated() {
        val auth = getKoin().get<AuthRepository>() as FakeAuthRepository
        auth.fakeAuthenticated = false
        auth.fakeUserId = null
    }

    @Given("I am authenticated as {string}")
    fun iAmAuthenticatedAs(userId: String) {
        val auth = getKoin().get<AuthRepository>() as FakeAuthRepository
        auth.fakeAuthenticated = true
        auth.fakeUserId = userId
        auth.fakeUserEmail = "test@example.com"
    }

    @Given("I have default user flags")
    fun iHaveDefaultUserFlags() {
        val user = getKoin().get<UserRepository>() as FakeUserRepository
        user.userFlagsFlow.value = UserFlags()
    }
}

/**
 * The unique id a launched test signs in as.
 *
 * Must be the id the fakes are KEYED ON. `FakeUserRepository` seeds
 * `"test-user-1" to TestData.currentUser` and `FakeAuthRepository.fakeUserId`
 * is the same string, so any other value signs the test in as somebody who does
 * not exist — profile, rooms and follow all then fail looking up a missing
 * document.
 */
const val TEST_UNIQUE_ID: String = "test-user-1"

/**
 * Put the fakes into a signed-in state for somebody of [cohort].
 *
 * SHY-0474. `SharedNavGraph` reads `authRepository.resolvedUniqueId`
 * — deliberately, since SHY-0143 — and only subscribes to the user-flags
 * listener when it is non-null. The fake defaults it to null and
 * `ResetFakesRule` re-nulls it, so the listener never ran in a single
 * instrumentation test and `ownCohort` stayed at its initial `COHORT_MINOR`.
 *
 * Lives here rather than in the launch helper because this file already reaches
 * for the fakes, and the no-new-stubs ratchet (EPIC-0003) counts double-bearing
 * FILES: teaching a new one to name them would have raised a debt that may only
 * shrink.
 *
 * An identity the test chose is never overwritten.
 */
fun signInFakesAs(cohort: String) {
    val auth = getKoin().get<AuthRepository>() as FakeAuthRepository
    if (auth.resolvedUniqueId == null) auth.resolvedUniqueId = TEST_UNIQUE_ID

    val users = getKoin().get<UserRepository>() as FakeUserRepository

    // The cohort has TWO readers, and they read different things: the messages
    // tab asks the nav graph's `ownCohort`, filled from this LISTENER; the
    // wallet asks `user.cohort` on the profile DOCUMENT, which also defaults to
    // minor. Setting one left the other correctly hidden.
    users.userFlagsFlow.value = users.userFlagsFlow.value.copy(cohort = cohort)

    // EVERY seeded person moves, not just the signed-in one. The fixtures
    // describe a coherent world: `sampleConversations` is a thread between
    // test-user-1 and test-user-2, which can only exist if they share a cohort.
    // Leaving one a minor made that thread cross-cohort and the app correctly
    // stopped showing it — three messaging tests failing on a screen obeying
    // UK OSA #17.
    for (id in users.users.keys.toList()) {
        users.users[id] = users.users.getValue(id).copy(cohort = cohort)
    }
}
