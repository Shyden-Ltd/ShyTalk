package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.timestampToMillis

data class MessageEdit(
    val editId: String = "",
    val previousText: String = "",
    val editedAt: Long = 0,
) {
    fun toMap(): Map<String, Any?> =
        mapOf(
            "previousText" to previousText,
            "editedAt" to editedAt,
        )

    companion object {
        fun fromMap(
            map: Map<String, Any?>,
            editId: String,
        ): MessageEdit =
            MessageEdit(
                editId = editId,
                previousText = map["previousText"] as? String ?: "",
                editedAt = timestampToMillis(map["editedAt"]),
            )
    }
}
