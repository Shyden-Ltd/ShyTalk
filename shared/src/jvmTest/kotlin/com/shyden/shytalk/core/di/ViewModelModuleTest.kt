package com.shyden.shytalk.core.di

import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.util.BiometricAuth
import com.shyden.shytalk.core.util.CryptoKeyPair
import com.shyden.shytalk.data.local.StickerStorage
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.remote.ConversationWebSocketService
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.TokenService
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.repository.AgeVerificationRepository
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.BiometricRepository
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.EventsRepository
import com.shyden.shytalk.data.repository.FunFactRepository
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.NotificationRepository
import com.shyden.shytalk.data.repository.OtpRepository
import com.shyden.shytalk.data.repository.PinRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.TranslationRepository
import com.shyden.shytalk.data.repository.TypingRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.splash.BannerImagePreloader
import com.shyden.shytalk.feature.splash.WebContentPreloader
import org.koin.core.annotation.KoinExperimentalAPI
import org.koin.test.verify.verify
import kotlin.test.Test

class ViewModelModuleTest {
    @Test
    @OptIn(KoinExperimentalAPI::class)
    fun `viewModelModule verifies all ViewModel dependency graphs`() {
        // verify() performs static analysis of the module's dependency graph.
        // extraTypes lists types provided by platform modules at runtime —
        // without these, verify() would report them as missing.
        viewModelModule.verify(
            extraTypes =
                listOf(
                    // Repositories (bound by platform modules)
                    AuthRepository::class,
                    UserRepository::class,
                    RoomRepository::class,
                    MessageRepository::class,
                    SeatRequestRepository::class,
                    StorageRepository::class,
                    AgeVerificationRepository::class,
                    DeviceRepository::class,
                    IdentityRepository::class,
                    PrivateMessageRepository::class,
                    ReportRepository::class,
                    TypingRepository::class,
                    NotificationRepository::class,
                    GiftRepository::class,
                    EconomyRepository::class,
                    EventsRepository::class,
                    BannerRepository::class,
                    FunFactRepository::class,
                    TranslationRepository::class,
                    OtpRepository::class,
                    PinRepository::class,
                    BiometricRepository::class,
                    AppLockRepository::class,
                    // Services (bound by platform modules)
                    VoiceService::class,
                    TokenService::class,
                    PresenceService::class,
                    ConversationWebSocketService::class,
                    AppConfigService::class,
                    // Platform utilities (expect/actual)
                    StickerStorage::class,
                    BiometricAuth::class,
                    CryptoKeyPair::class,
                    // Platform-specific implementations
                    RoomLifecycleManager::class,
                    BannerImagePreloader::class,
                    WebContentPreloader::class,
                    // Named qualifiers (String for deviceId, Boolean for bypassDeviceChecks)
                    String::class,
                    Boolean::class,
                ),
        )
    }
}
