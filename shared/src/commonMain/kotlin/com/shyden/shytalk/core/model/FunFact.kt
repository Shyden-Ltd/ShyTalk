package com.shyden.shytalk.core.model

data class FunFact(
    val id: String,
    val text: String,
    val category: String,
    val emoji: String,
    val sourceLanguage: String,
) {
    companion object {
        fun fromMap(
            map: Map<String, Any?>,
            id: String,
        ): FunFact =
            FunFact(
                id = id,
                text = map["text"] as? String ?: "",
                category = map["category"] as? String ?: "trivia",
                emoji = map["emoji"] as? String ?: "",
                sourceLanguage = (map["sourceLanguage"] ?: map["source_language"]) as? String ?: "",
            )
    }
}
