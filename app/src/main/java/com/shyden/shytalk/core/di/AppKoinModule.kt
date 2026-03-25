package com.shyden.shytalk.core.di

import android.provider.Settings
import com.google.firebase.Firebase
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.auth
import com.google.firebase.database.database
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.firestore
import com.shyden.shytalk.BuildConfig
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.util.BiometricAuth
import com.shyden.shytalk.core.util.CryptoKeyPair
import com.shyden.shytalk.core.util.SecureStorage
import com.shyden.shytalk.data.local.StickerStorage
import com.shyden.shytalk.data.remote.AndroidAppConfigService
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.remote.BillingService
import com.shyden.shytalk.data.remote.ConversationWebSocketService
import com.shyden.shytalk.data.remote.LiveKitTokenService
import com.shyden.shytalk.data.remote.LiveKitVoiceService
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.RtdbConversationService
import com.shyden.shytalk.data.remote.RtdbPresenceService
import com.shyden.shytalk.data.remote.TokenService
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.remote.WorkerApiClient
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.AppLockRepositoryImpl
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.AuthRepositoryImpl
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.BannerRepositoryImpl
import com.shyden.shytalk.data.repository.BiometricRepository
import com.shyden.shytalk.data.repository.BiometricRepositoryImpl
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.DeviceRepositoryImpl
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.EconomyRepositoryImpl
import com.shyden.shytalk.data.repository.FunFactRepository
import com.shyden.shytalk.data.repository.FunFactRepositoryImpl
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.data.repository.GiftRepositoryImpl
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.IdentityRepositoryImpl
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.MessageRepositoryImpl
import com.shyden.shytalk.data.repository.NotificationRepository
import com.shyden.shytalk.data.repository.NotificationRepositoryImpl
import com.shyden.shytalk.data.repository.OtpRepository
import com.shyden.shytalk.data.repository.OtpRepositoryImpl
import com.shyden.shytalk.data.repository.PinRepository
import com.shyden.shytalk.data.repository.PinRepositoryImpl
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepositoryImpl
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.ReportRepositoryImpl
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.RoomRepositoryImpl
import com.shyden.shytalk.data.repository.RtdbTypingRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.SeatRequestRepositoryImpl
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.StorageRepositoryImpl
import com.shyden.shytalk.data.repository.TranslationRepository
import com.shyden.shytalk.data.repository.TranslationRepositoryImpl
import com.shyden.shytalk.data.repository.TypingRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.data.repository.UserRepositoryImpl
import com.shyden.shytalk.feature.auth.AuthViewModel
import com.shyden.shytalk.feature.auth.EmailOtpViewModel
import com.shyden.shytalk.feature.auth.LockScreenViewModel
import com.shyden.shytalk.feature.auth.PinSetupViewModel
import com.shyden.shytalk.feature.daily.DailyRewardViewModel
import com.shyden.shytalk.feature.gacha.GachaViewModel
import com.shyden.shytalk.feature.gifting.GiftingViewModel
import com.shyden.shytalk.feature.home.HomeViewModel
import com.shyden.shytalk.feature.messaging.ConversationListViewModel
import com.shyden.shytalk.feature.messaging.GroupSetupViewModel
import com.shyden.shytalk.feature.messaging.NewMessageViewModel
import com.shyden.shytalk.feature.messaging.PrivateChatViewModel
import com.shyden.shytalk.feature.messaging.ReportReviewViewModel
import com.shyden.shytalk.feature.profile.FollowListViewModel
import com.shyden.shytalk.feature.profile.GiftWallViewModel
import com.shyden.shytalk.feature.profile.ProfileViewModel
import com.shyden.shytalk.feature.profile.RequiredDOBViewModel
import com.shyden.shytalk.feature.room.RoomViewModel
import com.shyden.shytalk.feature.settings.AppSettingsViewModel
import com.shyden.shytalk.feature.settings.RoomSettingsViewModel
import com.shyden.shytalk.feature.shop.TransactionHistoryViewModel
import com.shyden.shytalk.feature.shop.WalletViewModel
import com.shyden.shytalk.feature.splash.BannerImagePreloader
import com.shyden.shytalk.feature.splash.CoilBannerImagePreloader
import com.shyden.shytalk.feature.splash.FunFactSplashViewModel
import com.shyden.shytalk.feature.splash.OkHttpWebContentPreloader
import com.shyden.shytalk.feature.splash.WebContentPreloader
import okhttp3.OkHttpClient
import org.koin.android.ext.koin.androidContext
import org.koin.core.module.dsl.singleOf
import org.koin.core.module.dsl.viewModel
import org.koin.core.qualifier.named
import org.koin.dsl.bind
import org.koin.dsl.module

val appModule =
    module {
        // Firebase Auth + Firestore (free Spark plan)
        single { FirebaseAuth.getInstance() }
        single { FirebaseFirestore.getInstance() }

        // Connect to Firebase Emulators for local development
        if (BuildConfig.FLAVOR == "local") {
            Firebase.firestore.useEmulator("10.0.2.2", 8080)
            Firebase.auth.useEmulator("10.0.2.2", 9099)
            Firebase.database.useEmulator("10.0.2.2", 9000)
        }

        // HTTP client
        single {
            OkHttpClient
                .Builder()
                .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
                .writeTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
                .build()
        }

        // API client (Express.js on Oracle Cloud)
        single { WorkerApiClient(get(), BuildConfig.API_BASE_URL, get(), get(named("deviceId"))) }

        // Device ID
        single(named("deviceId")) {
            Settings.Secure.getString(androidContext().contentResolver, Settings.Secure.ANDROID_ID)
        }

        // Device check bypass (true in debug builds for emulator/E2E testing)
        single(named("bypassDeviceChecks")) { BuildConfig.BYPASS_DEVICE_CHECKS }

        // Services
        single<TokenService> { LiveKitTokenService(get()) }
        single<VoiceService> { LiveKitVoiceService(androidContext(), get()) }
        single<PresenceService> { RtdbPresenceService(get(), BuildConfig.API_BASE_URL) }
        single<ConversationWebSocketService> { RtdbConversationService() }
        single<AppConfigService> { AndroidAppConfigService(androidContext(), get()) }
        single { BillingService(androidContext()) }

        // Repositories
        single<AuthRepository> { AuthRepositoryImpl(get(), BuildConfig.APPLICATION_ID, BuildConfig.EMAIL_LINK_DOMAIN) }
        singleOf(::UserRepositoryImpl) bind UserRepository::class
        singleOf(::RoomRepositoryImpl) bind RoomRepository::class
        singleOf(::MessageRepositoryImpl) bind MessageRepository::class
        singleOf(::SeatRequestRepositoryImpl) bind SeatRequestRepository::class
        single<StorageRepository> { StorageRepositoryImpl(get(), BuildConfig.WORKER_URL, get()) }
        singleOf(::DeviceRepositoryImpl) bind DeviceRepository::class
        singleOf(::IdentityRepositoryImpl) bind IdentityRepository::class
        singleOf(::PrivateMessageRepositoryImpl) bind PrivateMessageRepository::class
        singleOf(::ReportRepositoryImpl) bind ReportRepository::class
        single<TypingRepository> { RtdbTypingRepository() }
        singleOf(::NotificationRepositoryImpl) bind NotificationRepository::class
        singleOf(::GiftRepositoryImpl) bind GiftRepository::class
        singleOf(::EconomyRepositoryImpl) bind EconomyRepository::class
        singleOf(::BannerRepositoryImpl) bind BannerRepository::class
        single<FunFactRepository> { FunFactRepositoryImpl(get(), androidContext()) }
        singleOf(::TranslationRepositoryImpl) bind TranslationRepository::class
        single { StickerStorage(androidContext()) }
        singleOf(::OtpRepositoryImpl) bind OtpRepository::class
        singleOf(::PinRepositoryImpl) bind PinRepository::class
        singleOf(::BiometricRepositoryImpl) bind BiometricRepository::class
        single { SecureStorage(androidContext()) }
        single<AppLockRepository> { AppLockRepositoryImpl(get()) }
        single { BiometricAuth(androidContext()) }
        single { CryptoKeyPair() }

        // ActiveRoomManager
        single { ActiveRoomManager(get(), get(), get(), get(), get(), get(), get(), androidContext()) }
        single<RoomLifecycleManager> { get<ActiveRoomManager>() }

        // ViewModels
        viewModel { AuthViewModel(get(), get(), get(), get(), get(named("deviceId")), get(named("bypassDeviceChecks")), get(), get()) }
        viewModel { LockScreenViewModel(get(), get(), get(), get(), get()) }
        viewModel { PinSetupViewModel(get(), get()) }
        viewModel { EmailOtpViewModel(get()) }
        viewModel { HomeViewModel(get(), get(), get(), get()) }
        viewModel { ProfileViewModel(get(), get(), get(), get(), get(), get(), get()) }
        viewModel { RequiredDOBViewModel(get(), get()) }
        viewModel { params -> FollowListViewModel(params[0], params[1], get(), get()) }
        viewModel { params -> RoomViewModel(params[0], get(), get(), get(), get(), get(), get(), get(), get(), get(), get(), get(), get()) }
        viewModel { AppSettingsViewModel(get(), get(), get(), get()) }
        viewModel { RoomSettingsViewModel(get(), get(), get(), get()) }
        viewModel { ConversationListViewModel(get(), get(), get()) }
        viewModel { params ->
            val values = params.values
            PrivateChatViewModel(
                otherUserId = (values.getOrNull(0) as? String) ?: "",
                pmRepository = get(),
                userRepository = get(),
                authRepository = get(),
                typingRepository = get(),
                reportRepository = get(),
                storageRepository = get(),
                stickerStorage = get(),
                initialConversationId = values.getOrNull(1) as? String,
                conversationWs = get(),
                roomRepository = get(),
                translationRepository = get(),
            )
        }
        viewModel { ReportReviewViewModel(get(), get()) }
        viewModel { NewMessageViewModel(get(), get(), get()) }
        viewModel { params -> GroupSetupViewModel(params[0], get(), get(), get(), get()) }

        // Monetization ViewModels
        viewModel { GachaViewModel(get(), get()) }
        viewModel { WalletViewModel(get(), get(), get()) }
        viewModel { TransactionHistoryViewModel(get()) }
        viewModel { GiftingViewModel(get(), get(), get()) }
        viewModel { params -> GiftWallViewModel(params[0], get()) }
        viewModel { DailyRewardViewModel(get(), get()) }
        single<BannerImagePreloader> { CoilBannerImagePreloader(androidContext()) }
        single<WebContentPreloader> { OkHttpWebContentPreloader(get()) }
        viewModel { FunFactSplashViewModel(get(), get(), get(), get(), get(), get(), get(), get()) }
    }
