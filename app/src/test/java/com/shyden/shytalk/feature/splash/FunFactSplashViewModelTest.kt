package com.shyden.shytalk.feature.splash

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.Banner
import com.shyden.shytalk.core.model.BannerActionType
import com.shyden.shytalk.core.model.FunFact
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.FunFactRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import io.mockk.coEvery
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FunFactSplashViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val bannerRepository = mockk<BannerRepository>(relaxed = true)
    private val funFactRepository = mockk<FunFactRepository>(relaxed = true)
    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val roomRepository = mockk<RoomRepository>(relaxed = true)
    private val pmRepository = mockk<PrivateMessageRepository>(relaxed = true)

    private val activeViewModels = mutableListOf<FunFactSplashViewModel>()

    private fun makeFunFact(id: String) =
        FunFact(
            id = id,
            text = "Fact $id",
            category = "trivia",
            emoji = "🤔",
            sourceLanguage = "en",
        )

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns "test-user"
        every { funFactRepository.getCachedFacts() } returns emptyList()
        coEvery { bannerRepository.getActiveBanners() } returns emptyList()
        coEvery { funFactRepository.syncFacts() } returns emptyList()
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
        FunFactSplashViewModel(
            bannerRepository = bannerRepository,
            funFactRepository = funFactRepository,
            imagePreloader = null,
            webContentPreloader = null,
            authRepository = authRepository,
            userRepository = userRepository,
            roomRepository = roomRepository,
            pmRepository = pmRepository,
        ).also { activeViewModels.add(it) }

    @Test
    fun `warmUpComplete becomes true after all jobs finish`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            assertTrue(vm.warmUpComplete.value)
        }

    @Test
    fun `funFacts populated from repository on init`() =
        runTest {
            val facts = listOf(makeFunFact("f1"), makeFunFact("f2"), makeFunFact("f3"))
            coEvery { funFactRepository.syncFacts() } returns facts

            val vm = createViewModel()
            advanceUntilIdle()

            assertEquals(facts.size, vm.funFacts.value.size)
            assertTrue(vm.funFacts.value.containsAll(facts))
        }

    @Test
    fun `warmUpComplete true even if bannerRepository throws`() =
        runTest {
            coEvery { bannerRepository.getActiveBanners() } throws RuntimeException("banner network failure")

            val vm = createViewModel()
            advanceUntilIdle()

            assertTrue(vm.warmUpComplete.value)
        }

    @Test
    fun `warmUpComplete true even if funFactRepository throws`() =
        runTest {
            coEvery { funFactRepository.syncFacts() } throws RuntimeException("fun fact sync failure")

            val vm = createViewModel()
            advanceUntilIdle()

            assertTrue(vm.warmUpComplete.value)
        }

    @Test
    fun `warmUpComplete true when currentUserId is null`() =
        runTest {
            every { authRepository.currentUserId } returns null

            val vm = createViewModel()
            advanceUntilIdle()

            assertTrue(vm.warmUpComplete.value)
        }

    @Test
    fun `funFacts starts with cached facts before sync completes`() =
        runTest {
            val cached = listOf(makeFunFact("cached-1"))
            every { funFactRepository.getCachedFacts() } returns cached
            // syncFacts returns empty — cached value should be loaded synchronously in init
            coEvery { funFactRepository.syncFacts() } returns emptyList()

            val vm = createViewModel()

            // Cached facts are set synchronously during init, before coroutines run
            assertTrue(vm.funFacts.value.isNotEmpty())
            assertEquals(cached[0].id, vm.funFacts.value[0].id)
        }

    @Test
    fun `synced fun facts replace cached facts after warm-up`() =
        runTest {
            val cached = listOf(makeFunFact("cached-1"))
            val synced = listOf(makeFunFact("synced-1"), makeFunFact("synced-2"))
            every { funFactRepository.getCachedFacts() } returns cached
            coEvery { funFactRepository.syncFacts() } returns synced

            val vm = createViewModel()
            advanceUntilIdle()

            assertEquals(synced.size, vm.funFacts.value.size)
            assertTrue(vm.funFacts.value.all { fact -> synced.any { it.id == fact.id } })
        }

    @Test
    fun `funFacts keeps cached value when sync returns empty list`() =
        runTest {
            val cached = listOf(makeFunFact("cached-1"), makeFunFact("cached-2"))
            every { funFactRepository.getCachedFacts() } returns cached
            coEvery { funFactRepository.syncFacts() } returns emptyList()

            val vm = createViewModel()
            advanceUntilIdle()

            // sync returned empty, so cached value remains
            assertEquals(cached.size, vm.funFacts.value.size)
        }

    @Test
    fun `banners with URL action type are fetched without error`() =
        runTest {
            val urlBanner =
                Banner(
                    id = "banner-1",
                    title = "Sale",
                    imageUrl = "https://img.example.com/banner.jpg",
                    actionType = BannerActionType.URL,
                    actionValue = "https://example.com",
                    sortOrder = 1,
                )
            coEvery { bannerRepository.getActiveBanners() } returns listOf(urlBanner)

            val vm = createViewModel()
            advanceUntilIdle()

            assertTrue(vm.warmUpComplete.value)
        }
}
