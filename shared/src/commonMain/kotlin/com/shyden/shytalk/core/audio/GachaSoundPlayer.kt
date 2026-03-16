package com.shyden.shytalk.core.audio

expect object GachaSoundPlayer {
    fun init()

    fun release()

    fun playSpinStart()

    fun playTick(progress: Float)

    fun playBlinkClick()

    fun playWinReveal(coinValue: Int)

    fun playHighTierFanfare()

    fun playCoinPurchase()
}
