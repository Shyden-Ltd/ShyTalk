package com.shyden.shytalk.core.audio

import com.shyden.shytalk.core.model.GiftBracket

actual object GachaSoundPlayer {
    actual fun init() {}
    actual fun release() {}
    actual fun playSpinStart() {}
    actual fun playTick(progress: Float) {}
    actual fun playBlinkClick() {}
    actual fun playWinReveal(bracket: GiftBracket) {}
    actual fun playHighTierFanfare() {}
    actual fun playCoinPurchase() {}
}
