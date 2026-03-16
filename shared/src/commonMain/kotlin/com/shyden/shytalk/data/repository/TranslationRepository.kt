package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

data class TranslationResult(
    val translatedText: String,
    val detectedSourceLang: String,
    val cached: Boolean,
)

data class TranslationQuota(
    val used: Int,
    val limit: Int,
    val unlimited: Boolean,
)

interface TranslationRepository {
    suspend fun translate(
        text: String,
        targetLang: String,
        messagePath: String?,
    ): Resource<TranslationResult>

    suspend fun getQuota(): Resource<TranslationQuota>
}
