package com.shyden.shytalk

import android.app.Application
import com.shyden.shytalk.di.testModule
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin

class ShyTalkTestApp : Application() {
    override fun onCreate() {
        super.onCreate()
        startKoin {
            androidContext(this@ShyTalkTestApp)
            modules(testModule)
        }
    }
}
