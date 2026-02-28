package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool

data class Gift(
    val id: String = "",
    val name: String = "",
    val coinValue: Int = 0,
    val animationUrl: String = "",
    val soundUrl: String = "",
    val iconUrl: String = "",
    val order: Int = 0,
    val expiresAfterDays: Int? = null,
    val showInStore: Boolean = true,
    val showOnWheel: Boolean = true
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "name" to name,
        "coinValue" to coinValue,
        "animationUrl" to animationUrl,
        "soundUrl" to soundUrl,
        "iconUrl" to iconUrl,
        "order" to order,
        "expiresAfterDays" to expiresAfterDays,
        "showInStore" to showInStore,
        "showOnWheel" to showOnWheel
    )

    companion object {
        val SUPER_SHY_TRIAL = Gift(
            id = "super_shy_trial",
            name = "Super Shy Trial",
            coinValue = 0,
            iconUrl = "",
            order = -1,
            showInStore = false,
            showOnWheel = false
        )

        fun fromMap(map: Map<String, Any?>, id: String): Gift = Gift(
            id = id,
            name = map["name"] as? String ?: "",
            coinValue = (map["coinValue"] as? Long)?.toInt() ?: 0,
            animationUrl = map["animationUrl"] as? String ?: "",
            soundUrl = map["soundUrl"] as? String ?: "",
            iconUrl = map["iconUrl"] as? String ?: "",
            order = (map["order"] as? Long)?.toInt() ?: 0,
            expiresAfterDays = (map["expiresAfterDays"] as? Long)?.toInt(),
            showInStore = map["showInStore"].asBool(true),
            showOnWheel = map["showOnWheel"].asBool(true)
        )
    }
}
