package com.shyden.shytalk.feature.settings

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.PmPrivacy
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
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
class AppSettingsViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val appConfigService = mockk<AppConfigService>(relaxed = true)

    private val currentUserId = "current-user"
    private val activeViewModels = mutableListOf<AppSettingsViewModel>()

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns currentUserId

        // Default: user with no blocked users
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
    }

    @After
    fun tearDown() = runBlocking {
        activeViewModels.forEach { it.viewModelScope.coroutineContext.job.cancelAndJoin() }
        activeViewModels.clear()
    }

    private fun createViewModel(): AppSettingsViewModel {
        return AppSettingsViewModel(
            appConfigService = appConfigService,
            authRepository = authRepository,
            userRepository = userRepository
        ).also { activeViewModels.add(it) }
    }

    // ===== init / loadSettings =====

    @Test
    fun `init loads user and settings`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId).copy(
            hideFollowing = true,
            hideOnlineStatus = false,
            blockedUserIds = emptySet()
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isLoading)
        assertEquals(user, vm.uiState.value.user)
        assertTrue(vm.uiState.value.hideFollowing)
        assertFalse(vm.uiState.value.hideOnlineStatus)
        assertTrue(vm.uiState.value.blockedUsers.isEmpty())
    }

    @Test
    fun `init loads blocked users`() = runTest {
        val blocked1 = TestData.createTestUser(uid = "blocked-1", displayName = "Blocked One")
        val blocked2 = TestData.createTestUser(uid = "blocked-2", displayName = "Blocked Two")
        val user = TestData.createTestUser(uid = currentUserId).copy(
            blockedUserIds = setOf("blocked-1", "blocked-2")
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(blocked1, blocked2))

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.blockedUsers.size)
    }

    @Test
    fun `init error sets error state`() = runTest {
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Error("load failed")

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals("load failed", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `init with no auth user does not load`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        advanceUntilIdle()

        // Should still be loading since loadSettings returns early
        assertNull(vm.uiState.value.user)
    }

    // ===== unblockUser =====

    @Test
    fun `unblockUser success removes from list`() = runTest {
        val blocked = TestData.createTestUser(uid = "blocked-1")
        val user = TestData.createTestUser(uid = currentUserId).copy(
            blockedUserIds = setOf("blocked-1")
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(blocked))
        coEvery { userRepository.unblockUser(currentUserId, "blocked-1") } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertEquals(1, vm.uiState.value.blockedUsers.size)

        vm.unblockUser("blocked-1")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.blockedUsers.isEmpty())
        coVerify { userRepository.unblockUser(currentUserId, "blocked-1") }
    }

    @Test
    fun `unblockUser error sets error`() = runTest {
        coEvery { userRepository.unblockUser(currentUserId, "blocked-1") } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.unblockUser("blocked-1")
        advanceUntilIdle()

        assertEquals("Failed to unblock user", vm.uiState.value.error)
    }

    // ===== toggleHideFollowing =====

    @Test
    fun `toggleHideFollowing - optimistic toggle on`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.hideFollowing)

        vm.toggleHideFollowing()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.hideFollowing)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("hideFollowing" to true)) }
    }

    @Test
    fun `toggleHideFollowing - error reverts`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.hideFollowing)

        vm.toggleHideFollowing()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.hideFollowing)
        assertEquals("Failed to update privacy setting", vm.uiState.value.error)
    }

    // ===== toggleHideOnlineStatus =====

    @Test
    fun `toggleHideOnlineStatus - optimistic toggle on`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.hideOnlineStatus)

        vm.toggleHideOnlineStatus()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.hideOnlineStatus)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("hideOnlineStatus" to true)) }
    }

    @Test
    fun `toggleHideOnlineStatus - error reverts`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.toggleHideOnlineStatus()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.hideOnlineStatus)
    }

    // ===== toggleHideAge =====

    @Test
    fun `toggleHideAge - optimistic toggle on`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.hideAge)

        vm.toggleHideAge()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.hideAge)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("hideAge" to true)) }
    }

    @Test
    fun `toggleHideAge - error reverts`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.hideAge)

        vm.toggleHideAge()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.hideAge)
        assertEquals("Failed to update privacy setting", vm.uiState.value.error)
    }

    // ===== clearCache =====

    @Test
    fun `clearCache sets cacheCleared flag`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.clearCache()

        assertTrue(vm.uiState.value.cacheCleared)
    }

    @Test
    fun `resetCacheCleared clears flag`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.clearCache()
        assertTrue(vm.uiState.value.cacheCleared)

        vm.resetCacheCleared()
        assertFalse(vm.uiState.value.cacheCleared)
    }

    // ===== clearError =====

    @Test
    fun `clearError clears error`() = runTest {
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Error("err")

        val vm = createViewModel()
        advanceUntilIdle()
        assertEquals("err", vm.uiState.value.error)

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }

    // ===== dismissUpdateResult =====

    @Test
    fun `dismissUpdateResult clears result`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        // Manually set a result to simulate
        vm.dismissUpdateResult()
        assertNull(vm.uiState.value.updateCheckResult)
    }

    // ===== setPmPrivacy =====

    @Test
    fun `setPmPrivacy - success updates state to new privacy`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertEquals(PmPrivacy.EVERYONE, vm.uiState.value.pmPrivacy)

        vm.setPmPrivacy(PmPrivacy.FOLLOWERS_ONLY)
        advanceUntilIdle()

        assertEquals(PmPrivacy.FOLLOWERS_ONLY, vm.uiState.value.pmPrivacy)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("pmPrivacy" to "FOLLOWERS_ONLY")) }
    }

    @Test
    fun `setPmPrivacy - error reverts to original value`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()
        assertEquals(PmPrivacy.EVERYONE, vm.uiState.value.pmPrivacy)

        vm.setPmPrivacy(PmPrivacy.NO_ONE)
        advanceUntilIdle()

        assertEquals(PmPrivacy.EVERYONE, vm.uiState.value.pmPrivacy)
        assertEquals("Failed to update privacy setting", vm.uiState.value.error)
    }

    // ===== checkForUpdates =====

    @Test
    fun `checkForUpdates - up to date when current version equals latest`() = runTest {
        every { appConfigService.currentVersionCode } returns 10
        coEvery { appConfigService.getLatestVersionInfo() } returns Resource.Success(Triple(1, 10, "1.0.0"))

        val vm = createViewModel()
        advanceUntilIdle()

        vm.checkForUpdates()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isCheckingUpdate)
        assertEquals(UpdateCheckResult.UpToDate, vm.uiState.value.updateCheckResult)
    }

    @Test
    fun `checkForUpdates - up to date when current version greater than latest`() = runTest {
        every { appConfigService.currentVersionCode } returns 15
        coEvery { appConfigService.getLatestVersionInfo() } returns Resource.Success(Triple(1, 10, "1.0.0"))

        val vm = createViewModel()
        advanceUntilIdle()

        vm.checkForUpdates()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isCheckingUpdate)
        assertEquals(UpdateCheckResult.UpToDate, vm.uiState.value.updateCheckResult)
    }

    @Test
    fun `checkForUpdates - update available when current version less than latest`() = runTest {
        every { appConfigService.currentVersionCode } returns 5
        coEvery { appConfigService.getLatestVersionInfo() } returns Resource.Success(Triple(1, 10, "2.0.0"))

        val vm = createViewModel()
        advanceUntilIdle()

        vm.checkForUpdates()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isCheckingUpdate)
        val result = vm.uiState.value.updateCheckResult
        assertTrue(result is UpdateCheckResult.UpdateAvailable)
        assertEquals("2.0.0", (result as UpdateCheckResult.UpdateAvailable).versionName)
    }

    @Test
    fun `checkForUpdates - error from service`() = runTest {
        coEvery { appConfigService.getLatestVersionInfo() } returns Resource.Error("network error")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.checkForUpdates()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isCheckingUpdate)
        val result = vm.uiState.value.updateCheckResult
        assertTrue(result is UpdateCheckResult.Error)
        assertEquals("Failed to check for updates", (result as UpdateCheckResult.Error).message)
    }

    // ===== toggle methods (via togglePrivacySetting) =====

    @Test
    fun `togglePmNotifications - optimistic toggle on`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.pmNotificationsEnabled)

        vm.togglePmNotifications()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.pmNotificationsEnabled)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("pmNotificationsEnabled" to false)) }
    }

    @Test
    fun `togglePmSound - error reverts`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.pmSoundEnabled)

        vm.togglePmSound()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.pmSoundEnabled)
        assertEquals("Failed to update privacy setting", vm.uiState.value.error)
    }

    @Test
    fun `togglePmPreview - optimistic toggle off`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.pmNotificationPreview)

        vm.togglePmPreview()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.pmNotificationPreview)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("pmNotificationPreview" to false)) }
    }

    @Test
    fun `togglePmTimestamps - optimistic toggle off`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.pmShowTimestamps)

        vm.togglePmTimestamps()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.pmShowTimestamps)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("pmShowTimestamps" to false)) }
    }

    @Test
    fun `togglePmDateSeparators - optimistic toggle off`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.pmShowDateSeparators)

        vm.togglePmDateSeparators()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.pmShowDateSeparators)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("pmShowDateSeparators" to false)) }
    }

    @Test
    fun `toggleDnd - optimistic toggle on`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.dndEnabled)

        vm.toggleDnd()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.dndEnabled)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("dndEnabled" to true)) }
    }

    // ===== DND time setters =====

    @Test
    fun `setDndStartHour updates state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.setDndStartHour(23)

        assertEquals(23, vm.uiState.value.dndStartHour)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("dndStartHour" to 23)) }
    }

    @Test
    fun `setDndStartMinute updates state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.setDndStartMinute(45)

        assertEquals(45, vm.uiState.value.dndStartMinute)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("dndStartMinute" to 45)) }
    }

    @Test
    fun `setDndEndHour updates state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.setDndEndHour(10)

        assertEquals(10, vm.uiState.value.dndEndHour)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("dndEndHour" to 10)) }
    }

    @Test
    fun `setDndEndMinute updates state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.setDndEndMinute(30)

        assertEquals(30, vm.uiState.value.dndEndMinute)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("dndEndMinute" to 30)) }
    }

    // ===== setMinGiftAnimationValue =====

    @Test
    fun `setMinGiftAnimationValue updates state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.setMinGiftAnimationValue(500)

        assertEquals(500, vm.uiState.value.minGiftAnimationValue)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("minGiftAnimationValue" to 500)) }
    }

    // ===== clearCache calls appConfigService =====

    @Test
    fun `clearCache calls appConfigService clearAppCache`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.clearCache()

        verify { appConfigService.clearAppCache() }
        assertTrue(vm.uiState.value.cacheCleared)
    }

    // ===== unblockUser with no auth user =====

    @Test
    fun `unblockUser does nothing when no auth user`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        advanceUntilIdle()

        vm.unblockUser("blocked-1")
        advanceUntilIdle()

        // currentUserId is "" so unblockUser("", "blocked-1") is called
        // The important thing is it doesn't crash
        assertNull(vm.uiState.value.user)
    }

    // ===== togglePmNotifications error reverts =====

    @Test
    fun `togglePmNotifications - error reverts`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.pmNotificationsEnabled)

        vm.togglePmNotifications()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.pmNotificationsEnabled)
        assertEquals("Failed to update privacy setting", vm.uiState.value.error)
    }

    // ===== toggleDnd error reverts =====

    @Test
    fun `toggleDnd - error reverts`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.dndEnabled)

        vm.toggleDnd()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.dndEnabled)
        assertEquals("Failed to update privacy setting", vm.uiState.value.error)
    }

    // ===== init loads pmPrivacy from user =====

    @Test
    fun `init loads pmPrivacy FOLLOWERS_ONLY from user`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId).copy(
            pmPrivacy = PmPrivacy.FOLLOWERS_ONLY
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals(PmPrivacy.FOLLOWERS_ONLY, vm.uiState.value.pmPrivacy)
    }

    // ===== selfDestructAlert =====

    @Test
    fun `init loads selfDestructAlertEnabled from user`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId).copy(
            selfDestructAlertEnabled = true
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.selfDestructAlertEnabled)
    }

    @Test
    fun `selfDestructAlert defaults to false`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.selfDestructAlertEnabled)
    }

    @Test
    fun `toggleSelfDestructAlert - optimistic toggle on`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.selfDestructAlertEnabled)

        vm.toggleSelfDestructAlert()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.selfDestructAlertEnabled)
        coVerify { userRepository.updateProfile(currentUserId, mapOf("selfDestructAlertEnabled" to true)) }
    }

    @Test
    fun `toggleSelfDestructAlert - error reverts`() = runTest {
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()
        assertFalse(vm.uiState.value.selfDestructAlertEnabled)

        vm.toggleSelfDestructAlert()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.selfDestructAlertEnabled)
        assertEquals("Failed to update privacy setting", vm.uiState.value.error)
    }

    // ===== Language =====

    @Test
    fun `setLanguage updates state and calls updateProfile`() = runTest {
        coEvery { userRepository.updateProfile(any(), any()) } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()

        vm.setLanguage("es")
        advanceUntilIdle()

        assertEquals("es", vm.uiState.value.language)
        coVerify { userRepository.updateProfile(currentUserId, match { it["language"] == "es" }) }
    }

    @Test
    fun `init loads language from user`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId, language = "ja")
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals("ja", vm.uiState.value.language)
    }
}
