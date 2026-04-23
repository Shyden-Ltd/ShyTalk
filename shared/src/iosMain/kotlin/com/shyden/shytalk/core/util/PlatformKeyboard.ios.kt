package com.shyden.shytalk.core.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import platform.Foundation.NSNotificationCenter
import platform.Foundation.NSOperationQueue
import platform.UIKit.UIKeyboardWillHideNotification
import platform.UIKit.UIKeyboardWillShowNotification

@Composable
actual fun isKeyboardVisible(): Boolean {
    var visible by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        val center = NSNotificationCenter.defaultCenter
        val showObserver =
            center.addObserverForName(
                UIKeyboardWillShowNotification,
                null,
                NSOperationQueue.mainQueue,
            ) { _ -> visible = true }
        val hideObserver =
            center.addObserverForName(
                UIKeyboardWillHideNotification,
                null,
                NSOperationQueue.mainQueue,
            ) { _ -> visible = false }

        onDispose {
            center.removeObserver(showObserver)
            center.removeObserver(hideObserver)
        }
    }

    return visible
}
