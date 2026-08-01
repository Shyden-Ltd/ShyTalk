package com.shyden.shytalk.core.di

import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.push.PushTokenManager
import com.shyden.shytalk.core.push.getPushBridge
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.core.room.IosRoomServiceController
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.room.RoomServiceController
import com.shyden.shytalk.core.util.BiometricAuth
import com.shyden.shytalk.core.util.CryptoKeyPair
import com.shyden.shytalk.core.util.SecureStorage
import com.shyden.shytalk.data.local.StickerStorage
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.remote.ConversationWebSocketService
import com.shyden.shytalk.data.remote.IosApiClient
import com.shyden.shytalk.data.remote.IosAppConfigServiceImpl
import com.shyden.shytalk.data.remote.IosConversationWebSocketServiceImpl
import com.shyden.shytalk.data.remote.IosEventsApi
import com.shyden.shytalk.data.remote.IosLiveKitVoiceService
import com.shyden.shytalk.data.remote.IosPresenceServiceImpl
import com.shyden.shytalk.data.remote.IosTokenServiceImpl
import com.shyden.shytalk.data.remote.IosTypingRepositoryImpl
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.TokenService
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.repository.AgeVerificationRepository
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.AppLockRepositoryImpl
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.BiometricRepository
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.EventsApi
import com.shyden.shytalk.data.repository.EventsRepository
import com.shyden.shytalk.data.repository.EventsRepositoryImpl
import com.shyden.shytalk.data.repository.FunFactRepository
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.IosAgeVerificationRepositoryImpl
import com.shyden.shytalk.data.repository.IosAuthRepositoryImpl
import com.shyden.shytalk.data.repository.IosBannerRepositoryImpl
import com.shyden.shytalk.data.repository.IosBiometricRepositoryImpl
import com.shyden.shytalk.data.repository.IosDeviceRepositoryImpl
import com.shyden.shytalk.data.repository.IosEconomyRepositoryImpl
import com.shyden.shytalk.data.repository.IosFunFactRepositoryImpl
import com.shyden.shytalk.data.repository.IosGiftRepositoryImpl
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
import org.koin.dsl.bind
import org.koin.dsl.module

val iosPlatformModule =
    module {
        // Firebase instances (initialized by KoinHelper.configureFirebaseEmulators before Koin starts)
        single<FirebaseAuth> { Firebase.auth }
        single<FirebaseFirestore> { Firebase.firestore }
        single<FirebaseDatabase> { Firebase.database }

        // API client (Express.js backend). baseUrl is per-environment,
        // pre-populated from Swift via `KoinHelper.doInitKoin(apiBaseUrl)`:
        //   local  → http://localhost:3000
        //   dev    → https://dev-api.shytalk.shyden.co.uk
        //   prod   → https://api.shytalk.shyden.co.uk
        // The `?: error(...)` gate trips loudly if Swift forgot to pass it,
        // surfacing as a Koin DI failure at app launch rather than every
        // post-sign-in API call silently posting to nowhere (which is what
        // the previous hardcoded localhost:3000 did on TestFlight).
        single {
            val baseUrl =
                BuildVariant.apiBaseUrl
                    ?: error(
                        "BuildVariant.apiBaseUrl not set — iOSApp.swift must call " +
                            "KoinHelper.doInitKoin(apiBaseUrl:) with the env-specific URL " +
                            "(http://localhost:3000 for local, https://dev-api.shytalk.shyden.co.uk for dev, etc.)",
                    )
            IosApiClient(baseUrl = baseUrl, deviceId = get(named("deviceId")))
        }

        // Named qualifiers required by AuthViewModel.
        //
        // The deviceId is computed eagerly in `iOSApp.swift` `init()`
        // (`UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString`),
        // passed via `KoinHelper.doInitKoin(deviceId:)`, and stored in
        // `BuildVariant.iosDeviceId`. This Koin factory just reads the
        // pre-computed value — it does NOT call `UIDevice.currentDevice`
        // here. A previous attempt to invoke UIKit lazily inside this
        // factory crashed with `ClassCastException: HashMap cannot be cast
        // to CPointer` during AuthViewModel construction → Firebase
        // Firestore init (K/N + GitLive Firebase + Kotlin 2.4.0-Beta2
        // timing fragility). See `project-ios-device-id-revert-rca.md`.
        // The `?: error(...)` fail-closed gate surfaces a misconfigured
        // boot order rather than passing a placeholder to the Express API.
        single(named("deviceId")) {
            BuildVariant.iosDeviceId
                ?: error(
                    "BuildVariant.iosDeviceId not set — iOSApp.swift must call " +
                        "KoinHelper.doInitKoin(deviceId:) before any Koin " +
                        "resolution that depends on `named(\"deviceId\")`",
                )
        }
        single(named("bypassDeviceChecks")) { true }

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
        single<AgeVerificationRepository> { IosAgeVerificationRepositoryImpl(get()) }
        single<DeviceRepository> { IosDeviceRepositoryImpl(get()) }
        single<IdentityRepository> { IosIdentityRepositoryImpl(get(), get()) }
        single<PrivateMessageRepository> { IosPrivateMessageRepositoryImpl(get(), get(), get()) }
        single<ReportRepository> { IosReportRepositoryImpl(get()) }
        single<TypingRepository> { IosTypingRepositoryImpl(get()) }
        single<NotificationRepository> { IosNotificationRepositoryImpl(get(), get()) }
        single<GiftRepository> { IosGiftRepositoryImpl(get()) }
        single<EconomyRepository> { IosEconomyRepositoryImpl(get(), get(), get()) }
        // Mirror of the Android binding — same shared implementation, different
        // transport. That symmetry is what stops the two phones drifting.
        single<EventsApi> { IosEventsApi(get()) }
        single<EventsRepository> { EventsRepositoryImpl(get()) }
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
        single<VoiceService> { IosLiveKitVoiceService(get()) }
        single<PresenceService> { IosPresenceServiceImpl(get()) }
        single<ConversationWebSocketService> { IosConversationWebSocketServiceImpl(get()) }
        single<AppConfigService> { IosAppConfigServiceImpl(get()) }

        // Managers
        single { IosRoomServiceController() } bind RoomServiceController::class
        single {
            ActiveRoomManager(
                get(), // RoomRepository
                get(), // MessageRepository
                get(), // AuthRepository
                get(), // UserRepository
                get(), // SeatRequestRepository
                get(), // VoiceService
                get(), // PresenceService
                get(), // RoomServiceController
            )
        }
        single<RoomLifecycleManager> { get<ActiveRoomManager>() }

        // Platform services
        single<com.shyden.shytalk.core.platform.PlatformSettingsService> {
            com.shyden.shytalk.core.platform
                .IosPlatformSettingsService()
        }

        // Push notification token manager (single Mutex serialises save/clear).
        // Bridge is registered from Swift after Koin init, hence lazy `::getPushBridge`.
        single { PushTokenManager(bridgeProvider = ::getPushBridge, notificationRepo = get()) }

        // Preloaders
        single<BannerImagePreloader> { BannerImagePreloader { } }
        single<WebContentPreloader> { WebContentPreloader { } }
    }
