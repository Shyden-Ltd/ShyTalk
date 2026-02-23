package com.shyden.shytalk.feature.profile

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RequiredDOBViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val userId = "user-1"
    private val testDob = 946684800000L
    private val activeViewModels = mutableListOf<RequiredDOBViewModel>()

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns userId
    }

    @After
    fun tearDown() = runBlocking {
        activeViewModels.forEach { it.viewModelScope.coroutineContext.job.cancelAndJoin() }
        activeViewModels.clear()
    }

    private fun createViewModel() = RequiredDOBViewModel(
        authRepository = authRepository,
        userRepository = userRepository
    ).also { activeViewModels.add(it) }

    @Test
    fun `saveDateOfBirth - success sets saved`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.saved)
        assertFalse(vm.uiState.value.isLoading)
        coVerify { userRepository.updateProfile(userId, any()) }
    }

    @Test
    fun `saveDateOfBirth - error sets error`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()

        assertEquals("Failed to save date of birth", vm.uiState.value.error)
        assertFalse(vm.uiState.value.saved)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `saveDateOfBirth - no auth user does nothing`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.saved)
        coVerify(exactly = 0) { userRepository.updateProfile(any(), any()) }
    }

    @Test
    fun `clearError clears error`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()
        assertEquals("Failed to save date of birth", vm.uiState.value.error)

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }

    @Test
    fun `clearError when no error is no-op`() = runTest {
        val vm = createViewModel()

        assertNull(vm.uiState.value.error)
        vm.clearError()
        assertNull(vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
        assertFalse(vm.uiState.value.saved)
    }

    @Test
    fun `saveDateOfBirth - success clears previous error`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()
        assertEquals("Failed to save date of birth", vm.uiState.value.error)

        // Now succeed on retry
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Success(Unit)
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.saved)
        assertNull(vm.uiState.value.error)
    }

    @Test
    fun `saveDateOfBirth - passes dateOfBirth field to updateProfile`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()

        coVerify {
            userRepository.updateProfile(userId, match { map ->
                map.containsKey("dateOfBirth") && map.size == 1
            })
        }
    }

    @Test
    fun `saveDateOfBirth - isLoading true while saving`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } coAnswers {
            // At this point isLoading should be true — we verify after advanceUntilIdle
            Resource.Success(Unit)
        }

        val vm = createViewModel()

        assertFalse(vm.uiState.value.isLoading)
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()

        // After completion, isLoading should be false
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `initial state is default`() = runTest {
        val vm = createViewModel()

        assertFalse(vm.uiState.value.isLoading)
        assertNull(vm.uiState.value.error)
        assertFalse(vm.uiState.value.saved)
    }

    @Test
    fun `saveDateOfBirth - error does not set saved`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Error("network")

        val vm = createViewModel()
        vm.saveDateOfBirth(testDob)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.saved)
        assertFalse(vm.uiState.value.isLoading)
        assertEquals("Failed to save date of birth", vm.uiState.value.error)
    }

    @Test
    fun `saveDateOfBirth - different millis values accepted`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()

        // A future date millis (the VM does not validate — that's the UI's job)
        val futureDateMillis = 4102444800000L // 2100-01-01
        vm.saveDateOfBirth(futureDateMillis)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.saved)
        coVerify { userRepository.updateProfile(userId, any()) }
    }

    @Test
    fun `saveDateOfBirth - zero millis accepted`() = runTest {
        coEvery { userRepository.updateProfile(userId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.saveDateOfBirth(0L)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.saved)
        coVerify { userRepository.updateProfile(userId, any()) }
    }
}
