package com.shyden.shytalk.core.di

import android.provider.Settings
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.storage.FirebaseStorage
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.data.local.StickerStorage
import com.shyden.shytalk.data.remote.LiveKitTokenService
import com.shyden.shytalk.data.remote.LiveKitVoiceService
import com.shyden.shytalk.data.remote.AndroidAppConfigService
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.remote.FirebasePresenceService
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.TokenService
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.AuthRepositoryImpl
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.DeviceRepositoryImpl
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.MessageRepositoryImpl
import com.shyden.shytalk.data.repository.NotificationRepository
import com.shyden.shytalk.data.repository.NotificationRepositoryImpl
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepositoryImpl
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.ReportRepositoryImpl
import com.shyden.shytalk.data.repository.TypingRepository
import com.shyden.shytalk.data.repository.TypingRepositoryImpl
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.RoomRepositoryImpl
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.SeatRequestRepositoryImpl
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.StorageRepositoryImpl
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.data.repository.UserRepositoryImpl
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.data.repository.GiftRepositoryImpl
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.EconomyRepositoryImpl
import com.shyden.shytalk.data.remote.BillingService
import com.google.firebase.functions.FirebaseFunctions
import com.shyden.shytalk.feature.auth.AuthViewModel
import com.shyden.shytalk.feature.daily.DailyRewardViewModel
import com.shyden.shytalk.feature.gacha.GachaViewModel
import com.shyden.shytalk.feature.gifting.GiftingViewModel
import com.shyden.shytalk.feature.profile.GiftWallViewModel
import com.shyden.shytalk.feature.shop.TransactionHistoryViewModel
import com.shyden.shytalk.feature.shop.WalletViewModel
import com.shyden.shytalk.feature.home.HomeViewModel
import com.shyden.shytalk.feature.messaging.ConversationListViewModel
import com.shyden.shytalk.feature.messaging.GroupSetupViewModel
import com.shyden.shytalk.feature.messaging.NewMessageViewModel
import com.shyden.shytalk.feature.messaging.PrivateChatViewModel
import com.shyden.shytalk.feature.messaging.ReportReviewViewModel
import com.shyden.shytalk.feature.profile.FollowListViewModel
import com.shyden.shytalk.feature.profile.ProfileViewModel
import com.shyden.shytalk.feature.profile.RequiredDOBViewModel
import com.shyden.shytalk.feature.room.RoomViewModel
import com.shyden.shytalk.feature.settings.AppSettingsViewModel
import com.shyden.shytalk.feature.settings.RoomSettingsViewModel
import org.koin.android.ext.koin.androidContext
import org.koin.core.module.dsl.singleOf
import org.koin.core.module.dsl.viewModel
import org.koin.core.qualifier.named
import org.koin.dsl.bind
import org.koin.dsl.module

val appModule = module {
    // Firebase instances
    single { FirebaseAuth.getInstance() }
    single { FirebaseFirestore.getInstance() }
    single { FirebaseStorage.getInstance() }
    single { FirebaseDatabase.getInstance("https://shytalk-7ba69-default-rtdb.asia-southeast1.firebasedatabase.app") }

    // Device ID
    single(named("deviceId")) {
        Settings.Secure.getString(androidContext().contentResolver, Settings.Secure.ANDROID_ID)
    }

    // Firebase Functions
    single { FirebaseFunctions.getInstance("asia-southeast1") }

    // Services
    single<TokenService> { LiveKitTokenService() }
    single<VoiceService> { LiveKitVoiceService(androidContext(), get()) }
    single<PresenceService> { FirebasePresenceService(get()) }
    single<AppConfigService> { AndroidAppConfigService(androidContext(), get()) }
    single { BillingService(androidContext()) }

    // Repositories
    singleOf(::AuthRepositoryImpl) bind AuthRepository::class
    singleOf(::UserRepositoryImpl) bind UserRepository::class
    singleOf(::RoomRepositoryImpl) bind RoomRepository::class
    singleOf(::MessageRepositoryImpl) bind MessageRepository::class
    singleOf(::SeatRequestRepositoryImpl) bind SeatRequestRepository::class
    singleOf(::StorageRepositoryImpl) bind StorageRepository::class
    singleOf(::DeviceRepositoryImpl) bind DeviceRepository::class
    singleOf(::PrivateMessageRepositoryImpl) bind PrivateMessageRepository::class
    singleOf(::ReportRepositoryImpl) bind ReportRepository::class
    singleOf(::TypingRepositoryImpl) bind TypingRepository::class
    singleOf(::NotificationRepositoryImpl) bind NotificationRepository::class
    singleOf(::GiftRepositoryImpl) bind GiftRepository::class
    single<EconomyRepository> { EconomyRepositoryImpl(get(), get()) }
    single { StickerStorage(androidContext()) }

    // ActiveRoomManager
    single { ActiveRoomManager(get(), get(), get(), get(), get(), get(), get(), androidContext()) }
    single<RoomLifecycleManager> { get<ActiveRoomManager>() }

    // ViewModels
    viewModel { AuthViewModel(get(), get(), get(), get(named("deviceId"))) }
    viewModel { HomeViewModel(get(), get(), get()) }
    viewModel { ProfileViewModel(get(), get(), get(), get(), get(), get()) }
    viewModel { RequiredDOBViewModel(get(), get()) }
    viewModel { params -> FollowListViewModel(params[0], params[1], get(), get()) }
    viewModel { params -> RoomViewModel(params[0], get(), get(), get(), get(), get(), get(), get(), get(), get(), get()) }
    viewModel { AppSettingsViewModel(get(), get(), get()) }
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
            initialConversationId = values.getOrNull(1) as? String
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
}
