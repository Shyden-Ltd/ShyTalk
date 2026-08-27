package com.shyden.shytalk.util

import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.fake.FakeAuthRepository
import com.shyden.shytalk.fake.FakeUserRepository
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import org.koin.java.KoinJavaComponent.getKoin

/**
 * JUnit rule that resets all fake repositories to their default state before each test.
 * Prevents state leakage between test classes when Koin singletons persist across the run.
 */
class ResetFakesRule : TestWatcher() {
    override fun starting(description: Description) {
        val auth = getKoin().get<AuthRepository>() as? FakeAuthRepository
        auth?.reset()
        // SHY-0474: the user fake is a singleton too, and used not to be reset.
        val users = getKoin().get<UserRepository>() as? FakeUserRepository
        users?.reset()
    }
}
