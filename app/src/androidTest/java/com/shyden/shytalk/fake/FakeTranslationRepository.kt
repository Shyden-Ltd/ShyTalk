package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.TranslationQuota
import com.shyden.shytalk.data.repository.TranslationRepository
import com.shyden.shytalk.data.repository.TranslationResult

class FakeTranslationRepository : TranslationRepository {
    override suspend fun translate(text: String, targetLang: String, messagePath: String?) =
        Resource.Success(TranslationResult("[Translated] $text", "en", false))

    override suspend fun getQuota() =
        Resource.Success(TranslationQuota(0, 50, false))
}
