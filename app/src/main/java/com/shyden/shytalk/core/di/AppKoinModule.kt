package com.shyden.shytalk.core.di

import android.provider.Settings
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.storage.FirebaseStorage
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.core.room.RoomLifecycleManager
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
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.RoomRepositoryImpl
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.SeatRequestRepositoryImpl
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.StorageRepositoryImpl
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.data.repository.UserRepositoryImpl
import com.shyden.shytalk.feature.auth.AuthViewModel
import com.shyden.shytalk.feature.home.HomeViewModel
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

    // Services
    single<TokenService> { LiveKitTokenService() }
    single<VoiceService> { LiveKitVoiceService(androidContext(), get()) }
    single<PresenceService> { FirebasePresenceService(get()) }
    single<AppConfigService> { AndroidAppConfigService(androidContext(), get()) }

    // Repositories
    singleOf(::AuthRepositoryImpl) bind AuthRepository::class
    singleOf(::UserRepositoryImpl) bind UserRepository::class
    singleOf(::RoomRepositoryImpl) bind RoomRepository::class
    singleOf(::MessageRepositoryImpl) bind MessageRepository::class
    singleOf(::SeatRequestRepositoryImpl) bind SeatRequestRepository::class
    singleOf(::StorageRepositoryImpl) bind StorageRepository::class
    singleOf(::DeviceRepositoryImpl) bind DeviceRepository::class

    // ActiveRoomManager
    single { ActiveRoomManager(get(), get(), get(), get(), get(), get(), get(), androidContext()) }
    single<RoomLifecycleManager> { get<ActiveRoomManager>() }

    // ViewModels
    viewModel { AuthViewModel(get(), get(), get(), get(named("deviceId"))) }
    viewModel { HomeViewModel(get(), get(), get()) }
    viewModel { ProfileViewModel(get(), get(), get(), get()) }
    viewModel { RequiredDOBViewModel(get(), get()) }
    viewModel { params -> FollowListViewModel(params[0], params[1], get(), get()) }
    viewModel { params -> RoomViewModel(params[0], get(), get(), get(), get(), get(), get(), get(), get()) }
    viewModel { AppSettingsViewModel(get(), get(), get()) }
    viewModel { RoomSettingsViewModel(get(), get(), get(), get()) }
}
