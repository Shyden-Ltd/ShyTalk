package com.shyden.shytalk.core.audio

actual object GachaSoundPlayer {
    actual fun init() {}
    actual fun release() {}
    actual fun playSpinStart() {}
    actual fun playTick(progress: Float) {}
    actual fun playBlinkClick() {}
    actual fun playWinReveal(coinValue: Int) {}
    actual fun playHighTierFanfare() {}
    actual fun playCoinPurchase() {}
}
