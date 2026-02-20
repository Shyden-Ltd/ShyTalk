package com.shyden.shytalk.core.audio

import com.shyden.shytalk.core.model.GiftBracket

expect object GachaSoundPlayer {
    fun init()
    fun release()
    fun playSpinStart()
    fun playTick(progress: Float)
    fun playBlinkClick()
    fun playWinReveal(bracket: GiftBracket)
    fun playHighTierFanfare()
    fun playCoinPurchase()
}
