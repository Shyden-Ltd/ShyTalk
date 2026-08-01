package com.shyden.shytalk.core.di

import com.shyden.shytalk.feature.ageverification.AgeRestrictionService
import com.shyden.shytalk.feature.ageverification.AgeVerificationSubmitViewModel
import com.shyden.shytalk.feature.auth.AuthViewModel
import com.shyden.shytalk.feature.auth.EmailOtpViewModel
import com.shyden.shytalk.feature.auth.LockScreenViewModel
import com.shyden.shytalk.feature.auth.PinSetupViewModel
import com.shyden.shytalk.feature.daily.DailyRewardViewModel
import com.shyden.shytalk.feature.events.EventHostViewModel
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
import com.shyden.shytalk.feature.splash.FunFactSplashViewModel
import org.koin.core.module.dsl.viewModel
import org.koin.core.qualifier.named
import org.koin.dsl.module

/**
 * Koin module containing all ViewModel bindings.
 *
 * ViewModels live in shared/commonMain and depend only on repository/service
 * interfaces (also in commonMain). The actual implementations are resolved
 * at runtime from the platform-specific module loaded alongside this one.
 */
val viewModelModule =
    module {
        // Age-verification service — pure logic, no construction args.
        // Bound here so VMs that gate on age (PR 8b GachaViewModel,
        // future PrivateMessageViewModel) can `get()` it.
        single { AgeRestrictionService() }

        viewModel { AuthViewModel(get(), get(), get(), get(), get(named("deviceId")), get(named("bypassDeviceChecks")), get(), get()) }
        viewModel { LockScreenViewModel(get(), get(), get(), get(), get(), get()) }
        viewModel { PinSetupViewModel(get(), get(), get(), get(named("deviceId"))) }
        viewModel { EmailOtpViewModel(get()) }
        viewModel { EventHostViewModel(get(), get()) }
        viewModel { HomeViewModel(get(), get(), get(), get()) }
        viewModel { ProfileViewModel(get(), get(), get(), get(), get(), get(), get()) }
        viewModel { RequiredDOBViewModel(get(), get()) }
        viewModel { AgeVerificationSubmitViewModel(get()) }
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
                ageRestrictionService = get(),
            )
        }
        viewModel { ReportReviewViewModel(get(), get()) }
        viewModel { NewMessageViewModel(get(), get(), get()) }
        viewModel { params -> GroupSetupViewModel(params[0], get(), get(), get(), get()) }
        viewModel { GachaViewModel(get(), get(), get(), get(), get()) }
        viewModel { WalletViewModel(get(), get(), get()) }
        viewModel { TransactionHistoryViewModel(get()) }
        viewModel { GiftingViewModel(get(), get(), get()) }
        viewModel { params -> GiftWallViewModel(params[0], get()) }
        viewModel { DailyRewardViewModel(get(), get()) }
        viewModel { FunFactSplashViewModel(get(), get(), get(), get(), get(), get(), get(), get()) }
    }
