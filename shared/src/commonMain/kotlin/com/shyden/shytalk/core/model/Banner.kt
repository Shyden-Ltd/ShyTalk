package com.shyden.shytalk.core.model

enum class BannerActionType { NONE, URL, ROOM, SCREEN }

data class Banner(
    val id: String,
    val title: String?,
    val imageUrl: String,
    val actionType: BannerActionType,
    val actionValue: String?,
    val sortOrder: Int,
) {
    companion object {
        fun fromMap(
            map: Map<String, Any?>,
            id: String,
        ): Banner =
            Banner(
                id = id,
                title = map["title"] as? String,
                imageUrl = (map["imageUrl"] ?: map["image_url"]) as? String ?: "",
                actionType =
                    try {
                        BannerActionType.valueOf(
                            ((map["actionType"] ?: map["action_type"]) as? String ?: "NONE"),
                        )
                    } catch (_: Exception) {
                        BannerActionType.NONE
                    },
                actionValue = (map["actionValue"] ?: map["action_value"]) as? String,
                sortOrder = ((map["sortOrder"] ?: map["sort_order"]) as? Number)?.toInt() ?: 0,
            )
    }
}
