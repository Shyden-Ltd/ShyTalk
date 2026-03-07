package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject

class TranslationRepositoryImpl(
    private val api: WorkerApiClient
) : TranslationRepository {

    override suspend fun translate(
        text: String, targetLang: String, messagePath: String?
    ): Resource<TranslationResult> = try {
        val body = JSONObject().apply {
            put("text", text)
            put("targetLang", targetLang)
            if (messagePath != null) put("messagePath", messagePath)
        }
        val resp = api.post("/api/translate", body)
        Resource.Success(TranslationResult(
            translatedText = resp.getString("translatedText"),
            detectedSourceLang = resp.optString("detectedSourceLang", "unknown"),
            cached = resp.optBoolean("cached", false)
        ))
    } catch (e: Exception) {
        Resource.Error(e.message ?: "Translation failed")
    }

    override suspend fun getQuota(): Resource<TranslationQuota> = try {
        val resp = api.get("/api/translate/quota")
        Resource.Success(TranslationQuota(
            used = resp.getInt("used"),
            limit = resp.getInt("limit"),
            unlimited = resp.getBoolean("unlimited")
        ))
    } catch (e: Exception) {
        Resource.Error(e.message ?: "Failed to check quota")
    }
}
