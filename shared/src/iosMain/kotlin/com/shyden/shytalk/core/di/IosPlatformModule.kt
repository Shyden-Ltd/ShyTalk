package com.shyden.shytalk.core.di

import com.shyden.shytalk.core.di.stubs.IosConversationWebSocketServiceStub
import com.shyden.shytalk.core.di.stubs.IosEconomyRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosGiftRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosPresenceServiceStub
import com.shyden.shytalk.core.di.stubs.IosRoomLifecycleManagerStub
import com.shyden.shytalk.core.di.stubs.IosTypingRepositoryStub
import com.shyden.shytalk.core.di.stubs.IosVoiceServiceStub
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.util.BiometricAuth
import com.shyden.shytalk.core.util.CryptoKeyPair
import com.shyden.shytalk.core.util.SecureStorage
import com.shyden.shytalk.data.local.StickerStorage
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.remote.ConversationWebSocketService
import com.shyden.shytalk.data.remote.IosApiClient
import com.shyden.shytalk.data.remote.IosAppConfigServiceImpl
import com.shyden.shytalk.data.remote.IosTokenServiceImpl
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.TokenService
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.AppLockRepositoryImpl
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.BiometricRepository
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.FunFactRepository
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.IosAuthRepositoryImpl
import com.shyden.shytalk.data.repository.IosBannerRepositoryImpl
import com.shyden.shytalk.data.repository.IosBiometricRepositoryImpl
import com.shyden.shytalk.data.repository.IosDeviceRepositoryImpl
import com.shyden.shytalk.data.repository.IosFunFactRepositoryImpl
import com.shyden.shytalk.data.repository.IosIdentityRepositoryImpl
import com.shyden.shytalk.data.repository.IosMessageRepositoryImpl
import com.shyden.shytalk.data.repository.IosNotificationRepositoryImpl
import com.shyden.shytalk.data.repository.IosOtpRepositoryImpl
import com.shyden.shytalk.data.repository.IosPinRepositoryImpl
import com.shyden.shytalk.data.repository.IosPrivateMessageRepositoryImpl
import com.shyden.shytalk.data.repository.IosReportRepositoryImpl
import com.shyden.shytalk.data.repository.IosRoomRepositoryImpl
import com.shyden.shytalk.data.repository.IosSeatRequestRepositoryImpl
import com.shyden.shytalk.data.repository.IosStorageRepositoryImpl
import com.shyden.shytalk.data.repository.IosTranslationRepositoryImpl
import com.shyden.shytalk.data.repository.IosUserRepositoryImpl
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
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.FirebaseAuth
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.database.FirebaseDatabase
import dev.gitlive.firebase.database.database
import dev.gitlive.firebase.firestore.FirebaseFirestore
import dev.gitlive.firebase.firestore.firestore
import org.koin.core.qualifier.named
import org.koin.dsl.module

val iosPlatformModule =
    module {
        // Firebase instances (initialized by KoinHelper.configureFirebaseEmulators before Koin starts)
        single<FirebaseAuth> { Firebase.auth }
        single<FirebaseFirestore> { Firebase.firestore }
        single<FirebaseDatabase> { Firebase.database }

        // API client (Express.js backend)
        single {
            IosApiClient(
                baseUrl = "http://localhost:3000",
                deviceId = get(named("deviceId")),
            )
        }

        // Named qualifiers required by AuthViewModel
        single(named("deviceId")) { "ios-device" } // TODO: Replace with UIDevice.current.identifierForVendor
        single(named("bypassDeviceChecks")) { true } // TODO: Set to false once real DeviceRepository is implemented

        // Platform utilities (actual classes already exist in iosMain)
        single { StickerStorage() }
        single { BiometricAuth() }
        single { CryptoKeyPair() }

        // Repositories
        single<AuthRepository> { IosAuthRepositoryImpl(get()) }
        single<UserRepository> { IosUserRepositoryImpl(get(), get()) }
        single<RoomRepository> { IosRoomRepositoryImpl(get(), get()) }
        single<MessageRepository> { IosMessageRepositoryImpl(get()) }
        single<SeatRequestRepository> { IosSeatRequestRepositoryImpl(get(), get()) }
        single<StorageRepository> { IosStorageRepositoryImpl(get()) }
        single<DeviceRepository> { IosDeviceRepositoryImpl(get(), get()) }
        single<IdentityRepository> { IosIdentityRepositoryImpl(get(), get()) }
        single<PrivateMessageRepository> { IosPrivateMessageRepositoryImpl(get(), get(), get()) }
        single<ReportRepository> { IosReportRepositoryImpl(get()) }
        single<TypingRepository> { IosTypingRepositoryStub() }
        single<NotificationRepository> { IosNotificationRepositoryImpl(get(), get()) }
        single<GiftRepository> { IosGiftRepositoryStub() }
        single<EconomyRepository> { IosEconomyRepositoryStub() }
        single<BannerRepository> { IosBannerRepositoryImpl(get()) }
        single<FunFactRepository> { IosFunFactRepositoryImpl(get()) }
        single<TranslationRepository> { IosTranslationRepositoryImpl(get()) }
        single<OtpRepository> { IosOtpRepositoryImpl(get()) }
        single<PinRepository> { IosPinRepositoryImpl(get()) }
        single<BiometricRepository> { IosBiometricRepositoryImpl(get()) }
        single { SecureStorage() }
        single<AppLockRepository> { AppLockRepositoryImpl(get<SecureStorage>()) }

        // Services
        single<TokenService> { IosTokenServiceImpl(get()) }
        single<VoiceService> { IosVoiceServiceStub() }
        single<PresenceService> { IosPresenceServiceStub() }
        single<ConversationWebSocketService> { IosConversationWebSocketServiceStub() }
        single<AppConfigService> { IosAppConfigServiceImpl(get()) }

        // Managers
        single<RoomLifecycleManager> { IosRoomLifecycleManagerStub() }

        // Preloaders
        single<BannerImagePreloader> { BannerImagePreloader { } }
        single<WebContentPreloader> { WebContentPreloader { } }
    }
