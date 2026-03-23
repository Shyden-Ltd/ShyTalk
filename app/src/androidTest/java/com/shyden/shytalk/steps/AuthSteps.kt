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
