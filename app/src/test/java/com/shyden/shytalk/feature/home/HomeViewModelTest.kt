package com.shyden.shytalk.feature.home

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
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
class HomeViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val roomRepository = mockk<RoomRepository>(relaxed = true)
    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val bannerRepository = mockk<BannerRepository>(relaxed = true)

    private val roomsFlow = MutableSharedFlow<List<ChatRoom>>()
    private val currentUserId = "current-user"

    // Cron-elim PR A0 — currentUserId (Firestore uniqueId) and
    // currentFirebaseUid (Firebase Auth uid) live in different identity
    // namespaces. The HomeViewModel must pass BOTH to createRoom — uniqueId
    // as ownerId and firebaseUid as ownerFirebaseUid. The two values are
    // deliberately distinct in tests so a bug that swaps them surfaces
    // as a coVerify mismatch.
    private val currentFirebaseUid = "current-firebase-uid"

    private val activeViewModels = mutableListOf<HomeViewModel>()

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns currentUserId
        every { authRepository.currentFirebaseUid } returns currentFirebaseUid
        every { roomRepository.getActiveRooms() } returns roomsFlow
        every { userRepository.userUpdates } returns MutableSharedFlow()
        coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(emptySet())
        coEvery { roomRepository.findActiveRoomByOwner(any()) } returns null
        // UK OSA #17 PR 12 — the cohort gate fails closed when the viewer's
        // User doc cannot be resolved. Provide a baseline mock so every test
        // sees a same-cohort viewer by default; tests can `coEvery` override
        // for adult-viewer / null-viewer scenarios.
        coEvery { userRepository.getUser(currentUserId) } returns
            Resource.Success(TestData.createTestUser(uid = currentUserId))
    }

    @After
    fun tearDown() =
        runBlocking {
            activeViewModels.forEach {
                it.viewModelScope.coroutineContext.job
                    .cancelAndJoin()
            }
            activeViewModels.clear()
        }

    private fun createViewModel() =
        HomeViewModel(
            roomRepository = roomRepository,
            authRepository = authRepository,
            userRepository = userRepository,
            bannerRepository = bannerRepository,
        ).also { activeViewModels.add(it) }

    @Test
    fun `room owned by blocked user is excluded`() =
        runTest {
            coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(setOf("blocked-owner"))
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "blocked-owner")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "blocked-owner")))
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.rooms
                    .isEmpty(),
            )
        }

    @Test
    fun `room whose owner blocked current user is excluded`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "hostile-owner", blockedUserIds = setOf(currentUserId))),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "hostile-owner")))
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.rooms
                    .isEmpty(),
            )
        }

    @Test
    fun `normal room is included`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "good-owner")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "good-owner")))
            advanceUntilIdle()

            assertEquals(1, vm.uiState.value.rooms.size)
        }

    @Test
    fun `createRoom with no existing room creates directly`() =
        runTest {
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(TestData.createTestUser(uid = currentUserId).copy(cohort = "adult"))
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("new-room-id")

            vm.createRoom("My Room")
            advanceUntilIdle()

            coVerify(exactly = 0) { roomRepository.closeAllRoomsByOwner(any()) }
            coVerify { roomRepository.createRoom("My Room", currentUserId, currentFirebaseUid, "adult") }
            assertEquals("new-room-id", vm.uiState.value.createdRoomId)
        }

    @Test
    fun `createRoom error sets error`() =
        runTest {
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(TestData.createTestUser(uid = currentUserId))
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Error("failed")

            vm.createRoom("My Room")
            advanceUntilIdle()

            assertNotNull(vm.uiState.value.error)
            assertNull(vm.uiState.value.createdRoomId)
        }

    @Test
    fun `onRoomNavigated clears createdRoomId`() =
        runTest {
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(TestData.createTestUser(uid = currentUserId))
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("new-room")
            vm.createRoom("Room")
            advanceUntilIdle()

            vm.onRoomNavigated()

            assertNull(vm.uiState.value.createdRoomId)
        }

    @Test
    fun `clearError clears error`() =
        runTest {
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(TestData.createTestUser(uid = currentUserId))
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Error("err")
            vm.createRoom("Room")
            advanceUntilIdle()

            vm.clearError()

            assertNull(vm.uiState.value.error)
        }

    @Test
    fun `createRoom passes minor cohort when user is minor`() =
        runTest {
            // UK OSA #17 PR 7 — pinning that the local user's cohort
            // field flows through to createRoom. firestore.rules will
            // reject any mismatch with the JWT claim, so the ViewModel
            // MUST read the cohort from the user doc (the value the
            // server has the right cohort claim for) rather than
            // hard-coding a default.
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(TestData.createTestUser(uid = currentUserId).copy(cohort = "minor"))
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("rid")

            vm.createRoom("Kids Room")
            advanceUntilIdle()

            coVerify { roomRepository.createRoom("Kids Room", currentUserId, currentFirebaseUid, "minor") }
        }

    @Test
    fun `createRoom falls back to minor cohort when user lookup fails`() =
        runTest {
            // Fail-closed: an unreachable user-doc must not surface as
            // "adult" by accident. Most-restrictive default matches
            // the OSA "fail closed when ambiguous" rule.
            coEvery { userRepository.getUser(currentUserId) } returns Resource.Error("rpc timeout")
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("rid")

            vm.createRoom("Fallback Room")
            advanceUntilIdle()

            coVerify { roomRepository.createRoom("Fallback Room", currentUserId, currentFirebaseUid, "minor") }
        }

    @Test
    fun `createRoom honours cohortOverride above cohort field`() =
        runTest {
            // Admin-set `cohortOverride` wins over the DOB-derived
            // `cohort` field. The server-minted JWT claim is derived
            // from `effectiveCohort` which honours the override; if
            // the ViewModel stamps the raw `cohort` instead, the
            // firestore.rules create-bind rejects the create with a
            // generic permission-denied error that the UI cannot
            // surface meaningfully. Mirror the server-side resolver.
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(
                    TestData.createTestUser(uid = currentUserId).copy(
                        cohort = "minor",
                        cohortOverride = "adult",
                    ),
                )
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("rid")

            vm.createRoom("Override Room")
            advanceUntilIdle()

            coVerify { roomRepository.createRoom("Override Room", currentUserId, currentFirebaseUid, "adult") }
        }

    @Test
    fun `createRoom passes Firebase Auth uid as ownerFirebaseUid, not uniqueId`() =
        runTest {
            // Cron-elim PR A0 regression guard for the two-namespace bug
            // class. AuthRepository exposes BOTH:
            //   - currentUserId (Firestore uniqueId, e.g. "10000005")
            //   - currentFirebaseUid (Firebase Auth uid, e.g. "abc123XYZ")
            // The RTDB owner-left signal rule forces writerUid to equal
            // `auth.uid`; the orchestrator attests it against
            // room.ownerFirebaseUid. If the ViewModel accidentally passes
            // currentUserId in BOTH positions, the rules-layer create-bind
            // (which has a `.get(field, request.auth.uid)` default) might
            // still let the write through, but the room would carry the
            // wrong value and every owner-left signal would fail
            // attestation. Pin DIFFERENT values for the two namespaces and
            // assert each one lands in its own slot.
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(TestData.createTestUser(uid = currentUserId).copy(cohort = "adult"))
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("rid")

            vm.createRoom("Namespace Room")
            advanceUntilIdle()

            // Strict positional verification: the 2nd arg is the uniqueId,
            // the 3rd is the firebaseUid. A swap would put firebaseUid in
            // position 2 (where rules check ownerId == callerUniqueId) and
            // PERMISSION_DENIED — but the mock has no rules-layer, so the
            // test must catch the swap by positional pinning.
            coVerify {
                roomRepository.createRoom(
                    "Namespace Room",
                    currentUserId,
                    currentFirebaseUid,
                    "adult",
                )
            }
            // Negative pin: the firebaseUid must NOT equal the uniqueId
            // (otherwise the regression guard above is vacuous).
            assertTrue(currentUserId != currentFirebaseUid)
        }

    @Test
    fun `createRoom passes empty ownerFirebaseUid when AuthRepository returns null`() =
        runTest {
            // Defensive: if currentFirebaseUid is somehow null (impossible
            // when authenticated — but defend in case AuthRepository's
            // implementation introduces a transient null window), the
            // ViewModel substitutes empty string. The Firestore rule's
            // `.get('ownerFirebaseUid', request.auth.uid)` default makes
            // this still pass create-side; the orchestrator's user-doc
            // fallback covers signal attestation.
            every { authRepository.currentFirebaseUid } returns null
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(TestData.createTestUser(uid = currentUserId).copy(cohort = "adult"))
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("rid")

            vm.createRoom("Null Firebase Uid Room")
            advanceUntilIdle()

            coVerify {
                roomRepository.createRoom(
                    "Null Firebase Uid Room",
                    currentUserId,
                    "",
                    "adult",
                )
            }
        }

    @Test
    fun `createRoom ignores invalid cohortOverride and uses cohort field`() =
        runTest {
            // Defence in depth: a corrupted `cohortOverride` (admin-
            // panel bug writing 'super-adult' or similar) must not
            // leak into the room stamp. Allow-list mirror of
            // `effectiveCohort`'s VALID_COHORTS check.
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(
                    TestData.createTestUser(uid = currentUserId).copy(
                        cohort = "adult",
                        cohortOverride = "super-admin",
                    ),
                )
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("rid")

            vm.createRoom("Corrupt Override Room")
            advanceUntilIdle()

            coVerify { roomRepository.createRoom("Corrupt Override Room", currentUserId, currentFirebaseUid, "adult") }
        }

    @Test
    fun `signOut calls auth signOut`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            vm.signOut()

            coVerify { authRepository.signOut() }
        }

    /**
     * `AuthRepositorySignOutContractTest` proves platform sign-out can throw.
     * `HomeViewModel.signOut` is fire-and-forget — an uncaught exception would
     * be swallowed by `viewModelScope`'s default handler and leak into
     * `Thread.UncaughtExceptionHandler` on Android, surfacing as an error log
     * with no diagnostic context. Catch + log explicitly here.
     */
    @Test
    fun `signOut does not crash when authRepository throws`() =
        runTest {
            coEvery { authRepository.signOut() } throws IllegalStateException("platform sign-out failure")

            val vm = createViewModel()
            advanceUntilIdle()

            vm.signOut()
            advanceUntilIdle()

            coVerify { authRepository.signOut() }
        }

    @Test
    fun `isLoading becomes false after rooms emit`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(emptyList())
            advanceUntilIdle()

            assertFalse(vm.uiState.value.isLoading)
        }

    // ===== refreshRooms =====

    @Test
    fun `refreshRooms reloads blocked users and re-filters`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "owner-1")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "owner-1")))
            advanceUntilIdle()
            assertEquals(1, vm.uiState.value.rooms.size)

            // Now block the owner
            coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(setOf("owner-1"))

            vm.refreshRooms()
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.rooms
                    .isEmpty(),
            )
            assertFalse(vm.uiState.value.isRefreshing)
        }

    @Test
    fun `refreshRooms sets isRefreshing false after completion`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            roomsFlow.emit(emptyList())
            advanceUntilIdle()

            vm.refreshRooms()
            advanceUntilIdle()

            assertFalse(vm.uiState.value.isRefreshing)
        }

    @Test
    fun `createRoom stores lastRoomName in state`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("new-room-id")

            vm.createRoom("My Cool Room")
            advanceUntilIdle()

            assertEquals("My Cool Room", vm.uiState.value.lastRoomName)
        }

    @Test
    fun `lastRoomName defaults to empty`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            assertEquals("", vm.uiState.value.lastRoomName)
        }

    @Test
    fun `rooms the user participates in are sorted first`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(
                        TestData.createTestUser(uid = "owner-a"),
                        TestData.createTestUser(uid = "owner-b"),
                    ),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            val roomA =
                TestData.createTestRoom(
                    roomId = "room-a",
                    ownerId = "owner-a",
                    participantIds = setOf("owner-a"), // user NOT participating
                )
            val roomB =
                TestData.createTestRoom(
                    roomId = "room-b",
                    ownerId = "owner-b",
                    participantIds = setOf("owner-b", currentUserId), // user participating
                )
            roomsFlow.emit(listOf(roomA, roomB))
            advanceUntilIdle()

            val rooms = vm.uiState.value.rooms
            assertEquals(2, rooms.size)
            assertEquals("room-b", rooms[0].roomId) // user's room sorted first
            assertEquals("room-a", rooms[1].roomId)
        }

    @Test
    fun `empty rooms list shows empty state`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(emptyList())
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.rooms
                    .isEmpty(),
            )
            assertFalse(vm.uiState.value.isLoading)
        }

    @Test
    fun `multiple rooms with mixed blocked and normal owners`() =
        runTest {
            coEvery { userRepository.getBlockedUserIds(currentUserId) } returns Resource.Success(setOf("blocked-owner"))
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(
                        TestData.createTestUser(uid = "good-owner"),
                        TestData.createTestUser(uid = "blocked-owner"),
                    ),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            val goodRoom = TestData.createTestRoom(roomId = "room-1", ownerId = "good-owner")
            val blockedRoom = TestData.createTestRoom(roomId = "room-2", ownerId = "blocked-owner")
            roomsFlow.emit(listOf(goodRoom, blockedRoom))
            advanceUntilIdle()

            val rooms = vm.uiState.value.rooms
            assertEquals(1, rooms.size)
            assertEquals("room-1", rooms[0].roomId)
        }

    @Test
    fun `own room is sorted first`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(
                        TestData.createTestUser(uid = "other-owner"),
                        TestData.createTestUser(uid = currentUserId),
                    ),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            val otherRoom = TestData.createTestRoom(roomId = "room-other", ownerId = "other-owner")
            val myRoom = TestData.createTestRoom(roomId = "room-mine", ownerId = currentUserId)
            roomsFlow.emit(listOf(otherRoom, myRoom))
            advanceUntilIdle()

            val rooms = vm.uiState.value.rooms
            assertEquals(2, rooms.size)
            assertEquals("room-mine", rooms[0].roomId) // own room first
        }

    @Test
    fun `setActive starts periodic refresh`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            roomsFlow.emit(emptyList())
            advanceUntilIdle()

            vm.setActive(true)
            advanceTimeBy(HomeViewModel.REFRESH_INTERVAL_MS + 1)
            runCurrent()

            // Blocked users should be re-fetched (initial + periodic)
            coVerify(atLeast = 2) { userRepository.getBlockedUserIds(currentUserId) }

            vm.setActive(false)
        }

    // ===== createRoom - auth guard =====

    @Test
    fun `createRoom with null auth user does nothing`() =
        runTest {
            every { authRepository.currentUserId } returns null
            val vm = createViewModel()
            advanceUntilIdle()

            vm.createRoom("My Room")
            advanceUntilIdle()

            coVerify(exactly = 0) { roomRepository.createRoom(any(), any(), any(), any()) }
        }

    // ===== createRoom - persists lastRoomName via updateProfile =====

    @Test
    fun `createRoom persists lastRoomName via updateProfile`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("new-id")

            vm.createRoom("Persisted Room")
            advanceUntilIdle()

            coVerify { userRepository.updateProfile(currentUserId, match { it["lastRoomName"] == "Persisted Room" }) }
        }

    // ===== seatUsers populated for occupied seats =====

    @Test
    fun `seatUsers map is populated for occupied seats in visible rooms`() =
        runTest {
            val seatedUser = TestData.createTestUser(uid = "seated-user")
            val owner = TestData.createTestUser(uid = "room-owner")
            coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(owner, seatedUser))

            val seats = TestData.createSeatsWithOwner("room-owner").toMutableMap()
            seats["1"] = TestData.createTestSeat(userId = "seated-user")
            val room =
                TestData.createTestRoom(
                    ownerId = "room-owner",
                    seats = seats,
                    participantIds = setOf("room-owner", "seated-user"),
                )

            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(room))
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.seatUsers
                    .containsKey("seated-user"),
            )
            assertEquals(seatedUser, vm.uiState.value.seatUsers["seated-user"])
        }

    // ===== setActive(false) stops refresh =====

    @Test
    fun `setActive false stops periodic refresh`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            roomsFlow.emit(emptyList())
            advanceUntilIdle()

            vm.setActive(true)
            vm.setActive(false)

            advanceTimeBy(HomeViewModel.REFRESH_INTERVAL_MS * 2)
            runCurrent()

            // Should only have initial load call, no new periodic calls after deactivation
            coVerify(atMost = 2) { userRepository.getBlockedUserIds(currentUserId) }
        }

    // ===== refreshRooms clears cache so users are re-fetched =====

    @Test
    fun `refreshRooms clears user cache and re-fetches users`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "owner-x")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "owner-x")))
            advanceUntilIdle()

            // First emission fetched users
            coVerify(exactly = 1) { userRepository.getUsers(any()) }

            vm.refreshRooms()
            advanceUntilIdle()

            // After refresh, cache cleared so users re-fetched
            coVerify(exactly = 2) { userRepository.getUsers(any()) }
        }

    // ===== observeRooms error =====

    @Test
    fun `observeRooms flow error sets error state`() =
        runTest {
            val errorFlow =
                kotlinx.coroutines.flow.flow<List<ChatRoom>> {
                    throw RuntimeException("stream failed")
                }
            every { roomRepository.getActiveRooms() } returns errorFlow

            val vm = createViewModel()
            advanceUntilIdle()

            assertEquals("stream failed", vm.uiState.value.error)
            assertFalse(vm.uiState.value.isLoading)
        }

    // ===== loadLastRoomName populates state from user =====

    @Test
    fun `init loads lastRoomName from user profile`() =
        runTest {
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(
                    TestData.createTestUser(uid = currentUserId).copy(lastRoomName = "Saved Room"),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            assertEquals("Saved Room", vm.uiState.value.lastRoomName)
        }

    // ===== signOut with null user =====

    @Test
    fun `signOut calls authRepository even without rooms`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            vm.signOut()

            coVerify { authRepository.signOut() }
        }

    // ===== createRoom sets isLoading during operation =====

    // ===== CLOSED rooms filtered =====

    @Test
    fun `closed room is excluded from list`() =
        runTest {
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "owner-1")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            val closedRoom =
                TestData.createTestRoom(
                    roomId = "room-closed",
                    ownerId = "owner-1",
                    state = RoomState.CLOSED,
                )
            val activeRoom =
                TestData.createTestRoom(
                    roomId = "room-active",
                    ownerId = "owner-1",
                    state = RoomState.ACTIVE,
                )
            roomsFlow.emit(listOf(closedRoom, activeRoom))
            advanceUntilIdle()

            val rooms = vm.uiState.value.rooms
            assertEquals(1, rooms.size)
            assertEquals("room-active", rooms[0].roomId)
        }

    @Test
    fun `createRoom clears previous error before starting`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Error("first error")
            vm.createRoom("Room1")
            advanceUntilIdle()
            assertNotNull(vm.uiState.value.error)

            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("room-2")
            vm.createRoom("Room2")
            advanceUntilIdle()

            assertNull(vm.uiState.value.error)
            assertEquals("room-2", vm.uiState.value.createdRoomId)
        }

    // ===== createRoom - duplicate room prevention =====

    @Test
    fun `createRoom shows confirmation when user has active room`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.findActiveRoomByOwner(currentUserId) } returns "existing-room-id"

            vm.createRoom("New Room")
            advanceUntilIdle()

            // Should show confirmation instead of creating or showing error
            assertTrue(vm.uiState.value.showReplaceRoomConfirmation)
            assertEquals("New Room", vm.uiState.value.pendingRoomName)
            coVerify(exactly = 0) { roomRepository.createRoom(any(), any(), any(), any()) }
        }

    @Test
    fun `createRoom proceeds when no active room exists after close`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.findActiveRoomByOwner(currentUserId) } returns null
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("new-room-id")

            vm.createRoom("New Room")
            advanceUntilIdle()

            coVerify { roomRepository.createRoom("New Room", currentUserId, currentFirebaseUid, any()) }
            assertEquals("new-room-id", vm.uiState.value.createdRoomId)
        }

    @Test
    fun `confirmReplaceRoom closes old rooms then creates new`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.findActiveRoomByOwner(currentUserId) } returns "existing-room-id"
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("new-id")

            // First, createRoom shows confirmation
            vm.createRoom("New Room")
            advanceUntilIdle()
            assertTrue(vm.uiState.value.showReplaceRoomConfirmation)

            // Reset findActiveRoomByOwner so doCreateRoom doesn't loop
            coEvery { roomRepository.findActiveRoomByOwner(currentUserId) } returns null

            // User confirms — closes old and creates new
            vm.confirmReplaceRoom()
            advanceUntilIdle()

            coVerifyOrder {
                roomRepository.closeAllRoomsByOwner(currentUserId)
                roomRepository.createRoom("New Room", currentUserId, currentFirebaseUid, any())
            }
            assertFalse(vm.uiState.value.showReplaceRoomConfirmation)
            assertEquals("new-id", vm.uiState.value.createdRoomId)
        }

    @Test
    fun `cancelReplaceRoom dismisses confirmation`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.findActiveRoomByOwner(currentUserId) } returns "existing-room-id"

            vm.createRoom("New Room")
            advanceUntilIdle()
            assertTrue(vm.uiState.value.showReplaceRoomConfirmation)

            vm.cancelReplaceRoom()

            assertFalse(vm.uiState.value.showReplaceRoomConfirmation)
            assertNull(vm.uiState.value.pendingRoomName)
        }

    // ===== UK OSA #17 PR 12 — client-side cohort gate =====

    @Test
    fun `adult viewer sees only adult-owned rooms when batch is mixed`() =
        runTest {
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(TestData.createTestUser(uid = currentUserId, cohort = "adult"))
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(
                        TestData.createTestUser(uid = "owner-adult", cohort = "adult"),
                        TestData.createTestUser(uid = "owner-minor", cohort = "minor"),
                    ),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(
                listOf(
                    TestData.createTestRoom(roomId = "r-adult", ownerId = "owner-adult"),
                    TestData.createTestRoom(roomId = "r-minor", ownerId = "owner-minor"),
                ),
            )
            advanceUntilIdle()

            val rooms = vm.uiState.value.rooms
            assertEquals(1, rooms.size)
            assertEquals("r-adult", rooms[0].roomId)
        }

    @Test
    fun `minor viewer drops adult-owned room`() =
        runTest {
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(TestData.createTestUser(uid = currentUserId, cohort = "minor"))
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "owner-adult", cohort = "adult")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "owner-adult")))
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.rooms
                    .isEmpty(),
            )
        }

    @Test
    fun `cohort gate fails closed when viewer User cannot be resolved`() =
        runTest {
            // Both batch and direct getUser fallback return Error → viewer
            // unresolvable → drop all rooms (fail-closed, matches
            // ConversationListViewModel for OSA consistency).
            coEvery { userRepository.getUser(currentUserId) } returns Resource.Error("fetch failed")
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "owner-1", cohort = "minor")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "owner-1")))
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.rooms
                    .isEmpty(),
            )
        }

    @Test
    fun `cohortOverride on viewer is honoured by the gate`() =
        runTest {
            // Stored cohort is "minor" but admin override uplifts to "adult".
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(
                    TestData.createTestUser(
                        uid = currentUserId,
                        cohort = "minor",
                        cohortOverride = "adult",
                    ),
                )
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(TestData.createTestUser(uid = "owner-adult", cohort = "adult")),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(listOf(TestData.createTestRoom(ownerId = "owner-adult")))
            advanceUntilIdle()

            assertEquals(1, vm.uiState.value.rooms.size)
        }

    @Test
    fun `cross-cohort seated user is redacted from seatUsers map`() =
        runTest {
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(TestData.createTestUser(uid = currentUserId, cohort = "adult"))
            // Owner is adult (so room passes gate), but a seated user is
            // a minor → must be dropped from seatUsers (defense-in-depth
            // for mid-session cohort flips).
            val seats =
                ChatRoom.DEFAULT_SEATS
                    .toMutableMap()
                    .apply {
                        this["0"] =
                            com.shyden.shytalk.core.model.Seat(
                                userId = "owner-adult",
                                state = com.shyden.shytalk.core.model.SeatState.OCCUPIED,
                            )
                        this["1"] =
                            com.shyden.shytalk.core.model.Seat(
                                userId = "seat-minor",
                                state = com.shyden.shytalk.core.model.SeatState.OCCUPIED,
                            )
                    }
            coEvery { userRepository.getUsers(any()) } returns
                Resource.Success(
                    listOf(
                        TestData.createTestUser(uid = "owner-adult", cohort = "adult"),
                        TestData.createTestUser(uid = "seat-minor", cohort = "minor"),
                    ),
                )
            val vm = createViewModel()
            advanceUntilIdle()

            roomsFlow.emit(
                listOf(TestData.createTestRoom(roomId = "r1", ownerId = "owner-adult", seats = seats)),
            )
            advanceUntilIdle()

            assertEquals(1, vm.uiState.value.rooms.size)
            assertTrue("seat-minor" !in vm.uiState.value.seatUsers)
            assertTrue("owner-adult" in vm.uiState.value.seatUsers)
        }

    @Test
    fun `doCreateRoom uses effectiveCohort with invalid cohort falling back to minor`() =
        runTest {
            // Corrupted Firestore cohort field — must NOT be passed
            // straight through to createRoom; effectiveCohort fails
            // closed to "minor".
            coEvery { userRepository.getUser(currentUserId) } returns
                Resource.Success(
                    TestData.createTestUser(uid = currentUserId, cohort = "corrupted"),
                )
            val vm = createViewModel()
            advanceUntilIdle()
            coEvery { roomRepository.createRoom(any(), any(), any(), any()) } returns Resource.Success("rid")

            vm.createRoom("My Room")
            advanceUntilIdle()

            coVerify { roomRepository.createRoom("My Room", currentUserId, currentFirebaseUid, "minor") }
        }
}
