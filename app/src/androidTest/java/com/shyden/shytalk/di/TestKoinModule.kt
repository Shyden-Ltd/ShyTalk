package com.shyden.shytalk.di

import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.data.local.StickerStorage
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.remote.BillingService
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.TokenService
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.NotificationRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.TypingRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.fake.FakeActiveRoomManager
import com.shyden.shytalk.fake.FakeAppConfigService
import com.shyden.shytalk.fake.FakeAuthRepository
import com.shyden.shytalk.fake.FakeDeviceRepository
import com.shyden.shytalk.fake.FakeEconomyRepository
import com.shyden.shytalk.fake.FakeGiftRepository
import com.shyden.shytalk.fake.FakeMessageRepository
import com.shyden.shytalk.fake.FakeNotificationRepository
import com.shyden.shytalk.fake.FakePresenceService
import com.shyden.shytalk.fake.FakePrivateMessageRepository
import com.shyden.shytalk.fake.FakeReportRepository
import com.shyden.shytalk.fake.FakeRoomRepository
import com.shyden.shytalk.fake.FakeSeatRequestRepository
import com.shyden.shytalk.fake.FakeStorageRepository
import com.shyden.shytalk.fake.FakeTokenService
import com.shyden.shytalk.fake.FakeTypingRepository
import com.shyden.shytalk.fake.FakeUserRepository
import com.shyden.shytalk.fake.FakeVoiceService
import com.shyden.shytalk.feature.auth.AuthViewModel
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
import org.koin.core.qualifier.named
import org.koin.dsl.bind
import org.koin.dsl.module
import org.koin.core.module.dsl.viewModel

val testModule = module {
    // Device ID
    single(named("deviceId")) { "test-device-id" }

    // Fake services
    single { FakeTokenService() } bind TokenService::class
    single { FakeVoiceService() } bind VoiceService::class
    single { FakePresenceService() } bind PresenceService::class
    single { FakeAppConfigService() } bind AppConfigService::class

    // Fake repositories
    single { FakeAuthRepository() } bind AuthRepository::class
    single { FakeUserRepository() } bind UserRepository::class
    single { FakeRoomRepository() } bind RoomRepository::class
    single { FakeMessageRepository() } bind MessageRepository::class
    single { FakeSeatRequestRepository() } bind SeatRequestRepository::class
    single { FakeStorageRepository() } bind StorageRepository::class
    single { FakeDeviceRepository() } bind DeviceRepository::class
    single { FakePrivateMessageRepository() } bind PrivateMessageRepository::class
    single { FakeReportRepository() } bind ReportRepository::class
    single { FakeTypingRepository() } bind TypingRepository::class
    single { FakeNotificationRepository() } bind NotificationRepository::class
    single { FakeGiftRepository() } bind GiftRepository::class
    single { FakeEconomyRepository() } bind EconomyRepository::class

    // Fake managers
    single { FakeActiveRoomManager() } bind RoomLifecycleManager::class

    // BillingService (concrete class — use real instance with test context; won't connect to Play)
    single { BillingService(get()) }

    // ViewModels — same wiring as production, Koin resolves fakes automatically
    viewModel { AuthViewModel(get(), get(), get(), get(named("deviceId"))) }
    viewModel { HomeViewModel(get(), get(), get()) }
    viewModel { ProfileViewModel(get(), get(), get(), get(), get(), get()) }
    viewModel { RequiredDOBViewModel(get(), get()) }
    viewModel { params -> FollowListViewModel(params[0], params[1], get(), get()) }
    viewModel { params -> RoomViewModel(params[0], get(), get(), get(), get(), get(), get(), get(), get(), get(), get(), get()) }
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
            initialConversationId = values.getOrNull(1) as? String
        )
    }
    viewModel { ReportReviewViewModel(get(), get()) }
    viewModel { NewMessageViewModel(get(), get(), get()) }
    viewModel { params -> GroupSetupViewModel(params[0], get(), get(), get(), get()) }
    viewModel { GachaViewModel(get(), get()) }
    viewModel { WalletViewModel(get(), get(), get()) }
    viewModel { TransactionHistoryViewModel(get()) }
    viewModel { GiftingViewModel(get(), get(), get()) }
    viewModel { params -> GiftWallViewModel(params[0], get()) }
    viewModel { DailyRewardViewModel(get(), get()) }
}
