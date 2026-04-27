package com.shyden.shytalk.core.di

import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import dev.gitlive.firebase.database.database
import dev.gitlive.firebase.firestore.firestore
import org.koin.core.context.startKoin
import org.koin.mp.KoinPlatformTools

/**
 * Initializes Firebase and Koin for the iOS app.
 *
 * Called from Swift: `KoinHelperKt.doInitKoin(useEmulators: true)` in iOSApp.swift's init().
 *
 * @param useEmulators If true, connects Firebase to local emulators (localhost).
 */
fun doInitKoin(useEmulators: Boolean = false) {
    BuildVariant.initLocalEmulator(useEmulators)
    if (KoinPlatformTools.defaultContext().getOrNull() != null) {
        logI("KoinHelper", "Koin already initialised — skipping")
        return
    }
    try {
        if (useEmulators) {
            configureFirebaseEmulators()
        }
        startKoin {
            modules(viewModelModule, iosPlatformModule)
        }
        logI("KoinHelper", "Koin initialised successfully (emulators=$useEmulators)")
    } catch (e: Exception) {
        logE("KoinHelper", "Koin initialisation failed: ${e.message}", e)
        throw e
    }
}

private fun configureFirebaseEmulators() {
    val host = "localhost"
    Firebase.firestore.useEmulator(host, 8080)
    Firebase.auth.useEmulator(host, 9099)
    Firebase.database.useEmulator(host, 9000)
    logI("KoinHelper", "Firebase emulators: Firestore=$host:8080, Auth=$host:9099, RTDB=$host:9000")
}
