package com.shyden.shytalk.feature.profile

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProfileViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val storageRepository = mockk<StorageRepository>(relaxed = true)
    private val roomRepository = mockk<RoomRepository>(relaxed = true)
    private val reportRepository = mockk<ReportRepository>(relaxed = true)
    private val economyRepository = mockk<EconomyRepository>(relaxed = true)

    private val currentUserId = "current-user"
    private val otherUserId = "other-user"

    private val activeViewModels = mutableListOf<ProfileViewModel>()

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns currentUserId
        every { authRepository.currentUserEmail } returns "test@example.com"
        every { userRepository.userUpdates } returns MutableSharedFlow()
    }

    @After
    fun tearDown() = runBlocking {
        activeViewModels.forEach { it.viewModelScope.coroutineContext.job.cancelAndJoin() }
        activeViewModels.clear()
    }

    private fun createViewModel(): ProfileViewModel {
        return ProfileViewModel(
            authRepository = authRepository,
            userRepository = userRepository,
            storageRepository = storageRepository,
            roomRepository = roomRepository,
            reportRepository = reportRepository,
            economyRepository = economyRepository
        ).also { activeViewModels.add(it) }
    }

    // ===== init =====

    @Test
    fun `init sets currentUserId from auth`() {
        val vm = createViewModel()
        assertEquals(currentUserId, vm.uiState.value.currentUserId)
    }

    @Test
    fun `init with no auth user sets empty currentUserId`() {
        every { authRepository.currentUserId } returns null
        val vm = createViewModel()
        assertEquals("", vm.uiState.value.currentUserId)
    }

    // ===== loadProfile - own profile =====

    @Test
    fun `loadProfile - own profile loads user`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isOwnProfile)
        assertEquals(user, vm.uiState.value.user)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `loadProfile - own profile with empty string is treated as own`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile("")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isOwnProfile)
    }

    @Test
    fun `loadProfile - own profile with currentUid is treated as own`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(currentUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isOwnProfile)
    }

    @Test
    fun `loadProfile - own profile triggers uniqueId generation when zero`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId, uniqueId = 0L)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { userRepository.generateUniqueId(currentUserId) } returns Resource.Success(99999L)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        coVerify { userRepository.generateUniqueId(currentUserId) }
        assertEquals(99999L, vm.uiState.value.user?.uniqueId)
    }

    @Test
    fun `loadProfile - own profile skips uniqueId generation when nonzero`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId, uniqueId = 12345L)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.generateUniqueId(any()) }
    }

    @Test
    fun `loadProfile - uniqueId generation error sets error`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId, uniqueId = 0L)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { userRepository.generateUniqueId(currentUserId) } returns Resource.Error("gen failed")

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.error)
    }

    // ===== loadProfile - other profile =====

    @Test
    fun `loadProfile - other user sets isOwnProfile false`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isOwnProfile)
        assertEquals(user, vm.uiState.value.user)
    }

    @Test
    fun `loadProfile - detects target blocked viewer`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId, blockedUserIds = setOf(currentUserId))
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBlockedByTarget)
        assertFalse(vm.uiState.value.isBlockedByViewer)
    }

    @Test
    fun `loadProfile - detects viewer blocked target`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(setOf(otherUserId))

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isBlockedByTarget)
        assertTrue(vm.uiState.value.isBlockedByViewer)
    }

    @Test
    fun `loadProfile - blocked list error defaults to not blocked`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Error("network")

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isBlockedByViewer)
    }

    // ===== loadProfile - error =====

    @Test
    fun `loadProfile - error sets error state`() = runTest {
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Error("not found")

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        assertEquals("not found", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `loadProfile - no auth user does nothing`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        assertNull(vm.uiState.value.user)
    }

    // ===== saveProfile =====

    @Test
    fun `saveProfile - success sets profileSaved`() = runTest {
        coEvery { userRepository.createOrUpdateUser(any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.saveProfile("My Name", 946684800000L)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.profileSaved)
        assertEquals("My Name", vm.uiState.value.user?.displayName)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `saveProfile - error sets error`() = runTest {
        coEvery { userRepository.createOrUpdateUser(any()) } returns Resource.Error("save failed")

        val vm = createViewModel()
        vm.saveProfile("My Name", 946684800000L)
        advanceUntilIdle()

        assertEquals("save failed", vm.uiState.value.error)
        assertFalse(vm.uiState.value.profileSaved)
    }

    @Test
    fun `saveProfile - no auth user does nothing`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        vm.saveProfile("My Name", 946684800000L)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.createOrUpdateUser(any()) }
    }

    // ===== saveProfileEdits =====

    @Test
    fun `saveProfileEdits - success with nationality`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { userRepository.updateProfile(any(), any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        vm.toggleEditing()
        vm.saveProfileEdits("New Name", "New desc", "US")
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isEditing)
        assertEquals("New Name", vm.uiState.value.user?.displayName)
        assertEquals("New desc", vm.uiState.value.user?.description)
        assertEquals("US", vm.uiState.value.user?.nationality)
    }

    @Test
    fun `saveProfileEdits - null nationality omits field`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { userRepository.updateProfile(eq(currentUserId), any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        vm.saveProfileEdits("Name", "Desc", null)
        advanceUntilIdle()

        coVerify {
            userRepository.updateProfile(currentUserId, match { fields ->
                !fields.containsKey("nationality")
            })
        }
    }

    @Test
    fun `saveProfileEdits - error sets error`() = runTest {
        coEvery { userRepository.updateProfile(any(), any()) } returns Resource.Error("edit failed")

        val vm = createViewModel()
        vm.saveProfileEdits("Name", "Desc", null)
        advanceUntilIdle()

        assertEquals("edit failed", vm.uiState.value.error)
    }

    // ===== updateDisplayName =====

    @Test
    fun `updateDisplayName - success updates user`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId, displayName = "Old Name")
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { userRepository.updateDisplayName(currentUserId, "New Name") } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        vm.updateDisplayName("New Name")
        advanceUntilIdle()

        assertEquals("New Name", vm.uiState.value.user?.displayName)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `updateDisplayName - error sets error`() = runTest {
        coEvery { userRepository.updateDisplayName(any(), any()) } returns Resource.Error("name failed")

        val vm = createViewModel()
        vm.updateDisplayName("New Name")
        advanceUntilIdle()

        assertEquals("name failed", vm.uiState.value.error)
    }

    // ===== uploadProfilePhoto =====

    @Test
    fun `uploadProfilePhoto - success updates user`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { storageRepository.uploadImage(currentUserId, "profile_photos", any()) } returns Resource.Success("https://photo.url")
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        vm.uploadProfilePhoto(byteArrayOf(1, 2, 3))
        advanceUntilIdle()

        assertEquals("https://photo.url", vm.uiState.value.user?.profilePhotoUrl)
        assertFalse(vm.uiState.value.isUploadingPhoto)
    }

    @Test
    fun `uploadProfilePhoto - upload error sets error`() = runTest {
        coEvery { storageRepository.uploadImage(any(), any(), any()) } returns Resource.Error("upload failed")

        val vm = createViewModel()
        vm.uploadProfilePhoto(byteArrayOf(1))
        advanceUntilIdle()

        assertEquals("upload failed", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isUploadingPhoto)
    }

    @Test
    fun `uploadProfilePhoto - save url error sets error`() = runTest {
        coEvery { storageRepository.uploadImage(any(), any(), any()) } returns Resource.Success("https://url")
        coEvery { userRepository.updateProfile(any(), any()) } returns Resource.Error("save failed")

        val vm = createViewModel()
        vm.uploadProfilePhoto(byteArrayOf(1))
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.error)
        assertFalse(vm.uiState.value.isUploadingPhoto)
    }

    @Test
    fun `uploadProfilePhoto - deletes old photo after successful upload`() = runTest {
        val oldUrl = "https://firebase.storage/old-profile.jpg"
        val user = TestData.createTestUser(uid = currentUserId, profilePhotoUrl = oldUrl)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { storageRepository.uploadImage(currentUserId, "profile_photos", any()) } returns Resource.Success("https://new.url")
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        vm.uploadProfilePhoto(byteArrayOf(1, 2))
        advanceUntilIdle()

        coVerify { storageRepository.deleteImageByUrl(oldUrl) }
    }

    @Test
    fun `uploadProfilePhoto - no old photo skips delete`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId, profilePhotoUrl = null)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { storageRepository.uploadImage(currentUserId, "profile_photos", any()) } returns Resource.Success("https://new.url")
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        vm.uploadProfilePhoto(byteArrayOf(1, 2))
        advanceUntilIdle()

        coVerify(exactly = 0) { storageRepository.deleteImageByUrl(any()) }
    }

    @Test
    fun `uploadProfilePhoto - upload failure does not delete old photo`() = runTest {
        val oldUrl = "https://firebase.storage/old-profile.jpg"
        val user = TestData.createTestUser(uid = currentUserId, profilePhotoUrl = oldUrl)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { storageRepository.uploadImage(any(), any(), any()) } returns Resource.Error("upload failed")

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        vm.uploadProfilePhoto(byteArrayOf(1))
        advanceUntilIdle()

        coVerify(exactly = 0) { storageRepository.deleteImageByUrl(any()) }
    }

    @Test
    fun `uploadProfilePhoto - save url failure does not delete old photo`() = runTest {
        val oldUrl = "https://firebase.storage/old-profile.jpg"
        val user = TestData.createTestUser(uid = currentUserId, profilePhotoUrl = oldUrl)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { storageRepository.uploadImage(any(), any(), any()) } returns Resource.Success("https://new.url")
        coEvery { userRepository.updateProfile(any(), any()) } returns Resource.Error("save failed")

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        vm.uploadProfilePhoto(byteArrayOf(1))
        advanceUntilIdle()

        coVerify(exactly = 0) { storageRepository.deleteImageByUrl(any()) }
    }

    // ===== uploadCoverPhoto =====

    @Test
    fun `uploadCoverPhoto - success updates user`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { storageRepository.uploadImage(currentUserId, "cover_photos", any()) } returns Resource.Success("https://cover.url")
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        vm.uploadCoverPhoto(byteArrayOf(1, 2))
        advanceUntilIdle()

        assertEquals("https://cover.url", vm.uiState.value.user?.coverPhotoUrl)
        assertFalse(vm.uiState.value.isUploadingPhoto)
    }

    @Test
    fun `uploadCoverPhoto - deletes old cover after successful upload`() = runTest {
        val oldUrl = "https://firebase.storage/old-cover.jpg"
        val user = TestData.createTestUser(uid = currentUserId, coverPhotoUrl = oldUrl)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { storageRepository.uploadImage(currentUserId, "cover_photos", any()) } returns Resource.Success("https://new-cover.url")
        coEvery { userRepository.updateProfile(currentUserId, any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        vm.uploadCoverPhoto(byteArrayOf(1, 2))
        advanceUntilIdle()

        coVerify { storageRepository.deleteImageByUrl(oldUrl) }
    }

    @Test
    fun `uploadCoverPhoto - upload error sets error`() = runTest {
        coEvery { storageRepository.uploadImage(any(), any(), any()) } returns Resource.Error("cover upload failed")

        val vm = createViewModel()
        vm.uploadCoverPhoto(byteArrayOf(1))
        advanceUntilIdle()

        assertEquals("cover upload failed", vm.uiState.value.error)
    }

    // ===== blockUser / unblockUser =====

    @Test
    fun `blockUser - success sets isBlockedByViewer`() = runTest {
        coEvery { userRepository.blockUser(currentUserId, otherUserId) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.blockUser(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBlockedByViewer)
    }

    @Test
    fun `blockUser - error sets error`() = runTest {
        coEvery { userRepository.blockUser(currentUserId, otherUserId) } returns Resource.Error("block failed")

        val vm = createViewModel()
        vm.blockUser(otherUserId)
        advanceUntilIdle()

        assertEquals("Failed to block user", vm.uiState.value.error)
    }

    @Test
    fun `unblockUser - success clears isBlockedByViewer`() = runTest {
        coEvery { userRepository.blockUser(currentUserId, otherUserId) } returns Resource.Success(Unit)
        coEvery { userRepository.unblockUser(currentUserId, otherUserId) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.blockUser(otherUserId)
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isBlockedByViewer)

        vm.unblockUser(otherUserId)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isBlockedByViewer)
    }

    @Test
    fun `unblockUser - error sets error`() = runTest {
        coEvery { userRepository.unblockUser(currentUserId, otherUserId) } returns Resource.Error("unblock failed")

        val vm = createViewModel()
        vm.unblockUser(otherUserId)
        advanceUntilIdle()

        assertEquals("Failed to unblock user", vm.uiState.value.error)
    }

    // ===== toggleEditing =====

    @Test
    fun `toggleEditing flips isEditing`() {
        val vm = createViewModel()
        assertFalse(vm.uiState.value.isEditing)

        vm.toggleEditing()
        assertTrue(vm.uiState.value.isEditing)

        vm.toggleEditing()
        assertFalse(vm.uiState.value.isEditing)
    }

    // ===== clearError =====

    @Test
    fun `clearError clears error`() = runTest {
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Error("err")

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()
        assertNotNull(vm.uiState.value.error)

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }

    // ===== online status =====

    @Test
    fun `loadProfile - online when lastSeenAt is recent`() = runTest {
        val recentTs = System.currentTimeMillis() - 60_000L
        val user = TestData.createTestUser(uid = currentUserId).copy(lastSeenAt = recentTs)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isOnline)
    }

    @Test
    fun `loadProfile - offline when lastSeenAt is old`() = runTest {
        val oldTs = System.currentTimeMillis() - 600_000L
        val user = TestData.createTestUser(uid = currentUserId).copy(lastSeenAt = oldTs)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isOnline)
    }

    @Test
    fun `loadProfile - hidden online status shows offline`() = runTest {
        val recentTs = System.currentTimeMillis() - 60_000L
        val user = TestData.createTestUser(uid = currentUserId).copy(
            lastSeenAt = recentTs,
            hideOnlineStatus = true
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isOnline)
    }

    // ===== activeRoomId gated by online status =====

    @Test
    fun `loadProfile - offline user with currentRoomId has null activeRoomId`() = runTest {
        val oldTs = System.currentTimeMillis() - 600_000L
        val user = TestData.createTestUser(uid = otherUserId).copy(
            lastSeenAt = oldTs,
            currentRoomId = "room-123"
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isOnline)
        assertNull(vm.uiState.value.activeRoomId)
    }

    @Test
    fun `loadProfile - online user with currentRoomId and active room has activeRoomId set`() = runTest {
        val recentTs = System.currentTimeMillis() - 60_000L
        val user = TestData.createTestUser(uid = otherUserId).copy(
            lastSeenAt = recentTs,
            currentRoomId = "room-123"
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        every { roomRepository.getRoomFlow("room-123") } returns flowOf(
            ChatRoom(roomId = "room-123", state = RoomState.ACTIVE)
        )

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isOnline)
        assertEquals("room-123", vm.uiState.value.activeRoomId)
    }

    @Test
    fun `loadProfile - online user with currentRoomId but closed room has null activeRoomId`() = runTest {
        val recentTs = System.currentTimeMillis() - 60_000L
        val user = TestData.createTestUser(uid = otherUserId).copy(
            lastSeenAt = recentTs,
            currentRoomId = "room-123"
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        every { roomRepository.getRoomFlow("room-123") } returns flowOf(
            ChatRoom(roomId = "room-123", state = RoomState.CLOSED)
        )

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isOnline)
        assertNull(vm.uiState.value.activeRoomId)
    }

    @Test
    fun `loadProfile - online user with currentRoomId but missing room has null activeRoomId`() = runTest {
        val recentTs = System.currentTimeMillis() - 60_000L
        val user = TestData.createTestUser(uid = otherUserId).copy(
            lastSeenAt = recentTs,
            currentRoomId = "room-123"
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        every { roomRepository.getRoomFlow("room-123") } returns flowOf(null)

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isOnline)
        assertNull(vm.uiState.value.activeRoomId)
    }

    @Test
    fun `loadProfile - hidden online status with currentRoomId has null activeRoomId`() = runTest {
        val recentTs = System.currentTimeMillis() - 60_000L
        val user = TestData.createTestUser(uid = otherUserId).copy(
            lastSeenAt = recentTs,
            hideOnlineStatus = true,
            currentRoomId = "room-123"
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isOnline)
        assertNull(vm.uiState.value.activeRoomId)
    }

    // ===== hideFollowing =====

    @Test
    fun `loadProfile - hideFollowing is set from user`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId).copy(hideFollowing = true)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.hideFollowing)
    }

    // ===== follow / unfollow =====

    @Test
    fun `followUser - success sets isFollowingTarget and increments count`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        coEvery { userRepository.followUser(currentUserId, otherUserId) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        val countBefore = vm.uiState.value.followerCount
        vm.followUser(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isFollowingTarget)
        assertEquals(countBefore + 1, vm.uiState.value.followerCount)
    }

    @Test
    fun `unfollowUser - success clears isFollowingTarget and decrements count`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId).copy(
            followerIds = setOf(currentUserId)
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        coEvery { userRepository.unfollowUser(currentUserId, otherUserId) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isFollowingTarget)

        val countBefore = vm.uiState.value.followerCount
        vm.unfollowUser(otherUserId)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isFollowingTarget)
        assertEquals(countBefore - 1, vm.uiState.value.followerCount)
    }

    @Test
    fun `followUser - error reverts optimistic update`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        coEvery { userRepository.followUser(currentUserId, otherUserId) } returns Resource.Error("fail")

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        vm.followUser(otherUserId)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isFollowingTarget)
        assertEquals("Failed to follow user", vm.uiState.value.error)
    }

    @Test
    fun `unfollowUser - error reverts optimistic update`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId).copy(
            followerIds = setOf(currentUserId)
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        coEvery { userRepository.unfollowUser(currentUserId, otherUserId) } returns Resource.Error("fail")

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        vm.unfollowUser(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isFollowingTarget)
        assertEquals("Failed to unfollow user", vm.uiState.value.error)
    }

    // ===== follower / following counts =====

    @Test
    fun `loadProfile sets follower and following counts`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId).copy(
            followerIds = setOf("a", "b"),
            followingIds = setOf("c", "d", "e")
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.followerCount)
        assertEquals(3, vm.uiState.value.followingCount)
    }

    // ===== Stalker tracking =====

    @Test
    fun `loadProfile - own profile sets stalker counts from user`() = runTest {
        val user = TestData.createTestUser(
            uid = currentUserId,
            stalkerCount = 10,
            newStalkerCount = 3
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        assertEquals(10, vm.uiState.value.stalkerCount)
        assertEquals(3, vm.uiState.value.newStalkerCount)
    }

    @Test
    fun `loadProfile - own profile with zero stalker counts`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        assertEquals(0, vm.uiState.value.stalkerCount)
        assertEquals(0, vm.uiState.value.newStalkerCount)
    }

    @Test
    fun `loadProfile - other user records profile visit`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        coEvery { userRepository.recordProfileVisit(otherUserId, currentUserId) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        coVerify { userRepository.recordProfileVisit(otherUserId, currentUserId) }
    }

    @Test
    fun `loadProfile - own profile does NOT record visit`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.recordProfileVisit(any(), any()) }
    }

    @Test
    fun `loadProfile - blocked by target does NOT record visit`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId, blockedUserIds = setOf(currentUserId))
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.recordProfileVisit(any(), any()) }
    }

    @Test
    fun `loadProfile - other user does NOT set stalker counts`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId, stalkerCount = 5, newStalkerCount = 2)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertEquals(0, vm.uiState.value.stalkerCount)
        assertEquals(0, vm.uiState.value.newStalkerCount)
    }

    // ===== Suspension =====

    @Test
    fun `loadProfile - suspended other user sets isTargetSuspended`() = runTest {
        val user = TestData.createTestUser(
            uid = otherUserId,
            isSuspended = true,
            suspensionEndDate = System.currentTimeMillis() + 86_400_000L
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isTargetSuspended)
        assertFalse(vm.uiState.value.isOwnProfile)
    }

    @Test
    fun `loadProfile - own profile even if suspended loads normally`() = runTest {
        val user = TestData.createTestUser(
            uid = currentUserId,
            isSuspended = true,
            suspensionEndDate = System.currentTimeMillis() + 86_400_000L
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isOwnProfile)
        assertFalse(vm.uiState.value.isTargetSuspended)
        assertEquals(user, vm.uiState.value.user)
    }

    @Test
    fun `loadProfile - permanently suspended other user sets isTargetSuspended`() = runTest {
        val user = TestData.createTestUser(
            uid = otherUserId,
            isSuspended = true,
            suspensionEndDate = null
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isTargetSuspended)
    }

    @Test
    fun `loadProfile - expired suspension on other user does NOT set isTargetSuspended`() = runTest {
        val user = TestData.createTestUser(
            uid = otherUserId,
            isSuspended = true,
            suspensionEndDate = System.currentTimeMillis() - 86_400_000L
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isTargetSuspended)
    }

    // ===== Report User =====

    @Test
    fun `reportUser success sets reportSubmitted`() = runTest {
        val targetUser = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(targetUser)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val currentUser = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)
        coEvery { reportRepository.reportUser(any(), any(), any(), any(), any(), any(), any(), any(), any(), any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        vm.reportUser("Spam", "Sending spam messages")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.reportSubmitted)
        assertFalse(vm.uiState.value.isSubmittingReport)
    }

    @Test
    fun `reportUser failure sets reportError`() = runTest {
        val targetUser = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(targetUser)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val currentUser = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)
        coEvery { reportRepository.reportUser(any(), any(), any(), any(), any(), any(), any(), any(), any(), any()) } returns Resource.Error("Failed")

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        vm.reportUser("Spam", "Bad")
        advanceUntilIdle()

        assertEquals("Failed to submit report", vm.uiState.value.reportError)
        assertFalse(vm.uiState.value.isSubmittingReport)
    }

    @Test
    fun `reportUser with evidence uploads images first`() = runTest {
        val targetUser = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(targetUser)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val currentUser = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)

        val imageData = byteArrayOf(1, 2, 3)
        coEvery { storageRepository.uploadImage(any(), "report_evidence", imageData, "image/png") } returns Resource.Success("https://img.url")
        coEvery { reportRepository.reportUser(any(), any(), any(), any(), any(), any(), any(), any(), any(), any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        vm.reportUser("Spam", "Bad", listOf(Pair(imageData, "image/png")))
        advanceUntilIdle()

        coVerify { storageRepository.uploadImage(currentUserId, "report_evidence", imageData, "image/png") }
        assertTrue(vm.uiState.value.reportSubmitted)
    }

    // ===== Validate SuperShy Purchase =====

    @Test
    fun `validateSuperShyPurchase success reloads profile`() = runTest {
        coEvery { economyRepository.purchaseSubscription("sub_gold", "token123") } returns Resource.Success(emptyMap())
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(TestData.createTestUser(uid = currentUserId))

        val vm = createViewModel()
        advanceUntilIdle()

        vm.validateSuperShyPurchase("sub_gold", "token123")
        advanceUntilIdle()

        coVerify { economyRepository.purchaseSubscription("sub_gold", "token123") }
    }

    @Test
    fun `validateSuperShyPurchase failure sets error`() = runTest {
        coEvery { economyRepository.purchaseSubscription("sub_gold", "bad") } returns Resource.Error("Invalid token")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.validateSuperShyPurchase("sub_gold", "bad")
        advanceUntilIdle()

        assertEquals("Invalid token", vm.uiState.value.error)
    }

    // ===== blockUser clears follow state =====

    @Test
    fun `blockUser clears isFollowingTarget and decrements followerCount`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId).copy(
            followerIds = setOf(currentUserId)
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        coEvery { userRepository.blockUser(currentUserId, otherUserId) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isFollowingTarget)
        val countBefore = vm.uiState.value.followerCount

        vm.blockUser(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBlockedByViewer)
        assertFalse(vm.uiState.value.isFollowingTarget)
        assertEquals(countBefore - 1, vm.uiState.value.followerCount)
    }

    // ===== blockUser / unblockUser - auth guard =====

    @Test
    fun `blockUser with null auth user does nothing`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        vm.blockUser(otherUserId)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.blockUser(any(), any()) }
    }

    @Test
    fun `unblockUser with null auth user does nothing`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        vm.unblockUser(otherUserId)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.unblockUser(any(), any()) }
    }

    // ===== followUser blocked guards =====

    @Test
    fun `followUser when blocked by target is no-op`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId, blockedUserIds = setOf(currentUserId))
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isBlockedByTarget)

        vm.followUser(otherUserId)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.followUser(any(), any()) }
        assertFalse(vm.uiState.value.isFollowingTarget)
    }

    @Test
    fun `followUser when viewer blocked target is no-op`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(setOf(otherUserId))

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isBlockedByViewer)

        vm.followUser(otherUserId)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.followUser(any(), any()) }
        assertFalse(vm.uiState.value.isFollowingTarget)
    }

    @Test
    fun `followUser with null auth user does nothing`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        vm.followUser(otherUserId)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.followUser(any(), any()) }
    }

    @Test
    fun `unfollowUser with null auth user does nothing`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        vm.unfollowUser(otherUserId)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.unfollowUser(any(), any()) }
    }

    // ===== claimSuperShyTrial =====

    @Test
    fun `claimSuperShyTrial success updates hasClaimedSuperShyTrial`() = runTest {
        val user = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(user)
        coEvery { economyRepository.claimSuperShyTrial() } returns Resource.Success(emptyMap())

        val vm = createViewModel()
        vm.loadProfile(null)
        advanceUntilIdle()
        assertFalse(vm.uiState.value.user!!.hasClaimedSuperShyTrial)

        vm.claimSuperShyTrial()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.user!!.hasClaimedSuperShyTrial)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `claimSuperShyTrial error sets error`() = runTest {
        coEvery { economyRepository.claimSuperShyTrial() } returns Resource.Error("Trial expired")

        val vm = createViewModel()
        vm.claimSuperShyTrial()
        advanceUntilIdle()

        assertEquals("Trial expired", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
    }

    // ===== clearReportSubmitted =====

    @Test
    fun `clearReportSubmitted clears report state`() = runTest {
        val targetUser = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(targetUser)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        val currentUser = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)
        coEvery { reportRepository.reportUser(any(), any(), any(), any(), any(), any(), any(), any(), any(), any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()
        vm.reportUser("Spam", "Bad")
        advanceUntilIdle()
        assertTrue(vm.uiState.value.reportSubmitted)

        vm.clearReportSubmitted()

        assertFalse(vm.uiState.value.reportSubmitted)
        assertNull(vm.uiState.value.reportError)
    }

    // ===== reportUser - reporter fetch fails =====

    @Test
    fun `reportUser when reporter fetch fails sets reportError`() = runTest {
        val targetUser = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(targetUser)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Error("network error")

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        vm.reportUser("Spam", "Bad")
        advanceUntilIdle()

        assertEquals("Could not submit report", vm.uiState.value.reportError)
        assertFalse(vm.uiState.value.isSubmittingReport)
    }

    // ===== reportUser - evidence upload fails =====

    @Test
    fun `reportUser evidence upload failure sets reportError`() = runTest {
        val targetUser = TestData.createTestUser(uid = otherUserId)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(targetUser)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        val currentUser = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)
        coEvery { storageRepository.uploadImage(any(), eq("report_evidence"), any(), any()) } returns Resource.Error("upload failed")

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        vm.reportUser("Spam", "Bad", listOf(Pair(byteArrayOf(1), "image/png")))
        advanceUntilIdle()

        assertEquals("Failed to upload evidence", vm.uiState.value.reportError)
        assertFalse(vm.uiState.value.isSubmittingReport)
        assertFalse(vm.uiState.value.reportSubmitted)
    }

    // ===== saveProfileEdits - auth guard =====

    @Test
    fun `saveProfileEdits with null auth user does nothing`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        vm.saveProfileEdits("Name", "Desc", null)
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.updateProfile(any(), any()) }
    }

    // ===== updateDisplayName - auth guard =====

    @Test
    fun `updateDisplayName with null auth user does nothing`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        vm.updateDisplayName("New Name")
        advanceUntilIdle()

        coVerify(exactly = 0) { userRepository.updateDisplayName(any(), any()) }
    }

    // ===== uploadProfilePhoto - auth guard =====

    @Test
    fun `uploadProfilePhoto with null auth user does nothing`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        vm.uploadProfilePhoto(byteArrayOf(1, 2, 3))
        advanceUntilIdle()

        coVerify(exactly = 0) { storageRepository.uploadImage(any(), any(), any()) }
    }

    // ===== testPurchaseSuperShy =====

    @Test
    fun `testPurchaseSuperShy success reloads profile`() = runTest {
        coEvery { economyRepository.purchaseSubscription("sub_test", "test_token") } returns Resource.Success(emptyMap())
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(
            TestData.createTestUser(uid = currentUserId, isSuperShy = true)
        )

        val vm = createViewModel()
        advanceUntilIdle()

        vm.testPurchaseSuperShy("sub_test")
        advanceUntilIdle()

        coVerify { economyRepository.purchaseSubscription("sub_test", "test_token") }
    }

    @Test
    fun `testPurchaseSuperShy failure sets error`() = runTest {
        coEvery { economyRepository.purchaseSubscription("sub_test", "test_token") } returns Resource.Error("Test failed")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.testPurchaseSuperShy("sub_test")
        advanceUntilIdle()

        assertEquals("Test failed", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
    }

    // ===== loadProfile - isFollowingTarget set from followerIds =====

    @Test
    fun `loadProfile - other user with currentUser in followerIds sets isFollowingTarget`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId).copy(
            followerIds = setOf(currentUserId, "other-follower")
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isFollowingTarget)
        assertEquals(2, vm.uiState.value.followerCount)
    }

    @Test
    fun `loadProfile - other user without currentUser in followerIds clears isFollowingTarget`() = runTest {
        val user = TestData.createTestUser(uid = otherUserId).copy(
            followerIds = setOf("someone-else")
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(user)
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())

        val vm = createViewModel()
        vm.loadProfile(otherUserId)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isFollowingTarget)
        assertEquals(1, vm.uiState.value.followerCount)
    }

    // ===== reportUser - no target user does nothing =====

    @Test
    fun `reportUser with no loaded user does nothing`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.reportUser("Spam", "Bad")
        advanceUntilIdle()

        assertFalse(vm.uiState.value.reportSubmitted)
        coVerify(exactly = 0) { reportRepository.reportUser(any(), any(), any(), any(), any(), any(), any(), any(), any(), any()) }
    }

    // ===== reportUser - null auth does nothing =====

    @Test
    fun `reportUser with null auth user does nothing`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        vm.reportUser("Spam", "Bad")
        advanceUntilIdle()

        coVerify(exactly = 0) { reportRepository.reportUser(any(), any(), any(), any(), any(), any(), any(), any(), any(), any()) }
    }
}
