package com.shyden.shytalk

import android.Manifest
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.AndroidJUnitRunner

class ShyTalkTestRunner : AndroidJUnitRunner() {
    override fun newApplication(cl: ClassLoader, className: String, context: Context): Application {
        return super.newApplication(cl, ShyTalkTestApp::class.java.name, context)
    }

    override fun onStart() {
        // Auto-grant POST_NOTIFICATIONS so the system dialog doesn't block tests
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                InstrumentationRegistry.getInstrumentation().uiAutomation
                    .grantRuntimePermission(
                        targetContext.packageName,
                        Manifest.permission.POST_NOTIFICATIONS
                    )
            } catch (_: SecurityException) {
                // Some devices don't allow granting permissions via UiAutomation — skip
            }
        }
        super.onStart()
    }
}
