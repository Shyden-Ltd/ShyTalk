package com.shyden.shytalk.feature.splash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.BannerActionType
import com.shyden.shytalk.core.model.FunFact
import com.shyden.shytalk.core.util.logD
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.FunFactRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch

class FunFactSplashViewModel(
    private val bannerRepository: BannerRepository,
    private val funFactRepository: FunFactRepository,
    private val imagePreloader: BannerImagePreloader? = null,
    private val webContentPreloader: WebContentPreloader? = null,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val roomRepository: RoomRepository,
    private val pmRepository: PrivateMessageRepository,
) : ViewModel() {
    companion object {
        private const val TAG = "FunFactSplashViewModel"
    }

    private val _warmUpComplete = MutableStateFlow(false)
    val warmUpComplete: StateFlow<Boolean> = _warmUpComplete.asStateFlow()

    private val _funFacts = MutableStateFlow<List<FunFact>>(emptyList())
    val funFacts: StateFlow<List<FunFact>> = _funFacts.asStateFlow()

    init {
        // Show cached facts immediately while syncing fresh ones
        val cached = funFactRepository.getCachedFacts()
        logI(TAG, "Loaded ${cached.size} cached fun facts")
        _funFacts.value = cached.shuffled()

        viewModelScope.launch {
            logI(TAG, "Starting warm-up: banners, fun facts, user data")
            val jobs =
                listOf(
                    launch {
                        try {
                            val banners = bannerRepository.getActiveBanners()
                            logI(TAG, "Preloading ${banners.size} banners")
                            banners.forEach { banner ->
                                launch {
                                    try {
                                        imagePreloader?.preload(banner.imageUrl)
                                    } catch (e: CancellationException) {
                                        throw e
                                    } catch (e: Exception) {
                                        logD(TAG, "Banner image preload failed: ${e.message}")
                                    }
                                }
                                val actionValue = banner.actionValue
                                if (banner.actionType == BannerActionType.URL && !actionValue.isNullOrBlank()) {
                                    launch {
                                        try {
                                            webContentPreloader?.preload(actionValue)
                                        } catch (e: CancellationException) {
                                            throw e
                                        } catch (e: Exception) {
                                            logD(TAG, "Web content preload failed: ${e.message}")
                                        }
                                    }
                                }
                            }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            logE(TAG, "Banner preload failed: ${e.message}")
                        }
                    },
                    launch {
                        try {
                            val fresh = funFactRepository.syncFacts()
                            if (fresh.isNotEmpty()) {
                                logI(TAG, "Synced ${fresh.size} fresh fun facts")
                                _funFacts.value = fresh.shuffled()
                            }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            logE(TAG, "Fun fact sync failed: ${e.message}")
                        }
                    },
                    launch {
                        val userId = authRepository.currentUserId ?: return@launch
                        listOf(
                            launch { userRepository.getUser(userId) },
                            launch { userRepository.getBlockedUserIds(userId) },
                            launch { roomRepository.prefetchActiveRooms() },
                            launch { pmRepository.prefetchConversations() },
                        ).joinAll()
                    },
                )
            jobs.joinAll()
            logI(TAG, "Warm-up complete")
            _warmUpComplete.value = true
        }
    }
}
