package com.shyden.shytalk.data.repository

import android.content.Context
import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.model.FunFact
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class FunFactRepositoryImpl(
    private val firestore: FirebaseFirestore,
    private val context: Context,
) : FunFactRepository {
    companion object {
        private const val TAG = "FunFactRepository"
    }

    private val cacheFile get() = File(context.filesDir, "fun_facts_cache.json")

    @Volatile
    private var memoryCache: List<FunFact>? = null

    override suspend fun syncFacts(): List<FunFact> {
        val snapshot = firestore.collection("funFacts").get().await()
        val facts =
            snapshot.documents.mapNotNull { doc ->
                val data = doc.data ?: return@mapNotNull null
                FunFact.fromMap(data, doc.id)
            }

        // Persist to local cache
        val jsonArray = JSONArray()
        for (fact in facts) {
            val obj = JSONObject()
            obj.put("id", fact.id)
            obj.put("text", fact.text)
            obj.put("category", fact.category)
            obj.put("emoji", fact.emoji)
            obj.put("sourceLanguage", fact.sourceLanguage)
            jsonArray.put(obj)
        }
        cacheFile.writeText(jsonArray.toString())
        memoryCache = facts
        return facts
    }

    override fun getCachedFacts(): List<FunFact> {
        memoryCache?.let { return it }

        if (!cacheFile.exists()) return emptyList()

        return try {
            val arr = JSONArray(cacheFile.readText())
            val facts =
                (0 until arr.length()).map { i ->
                    val obj = arr.getJSONObject(i)
                    FunFact(
                        id = obj.getString("id"),
                        text = obj.getString("text"),
                        category = obj.optString("category", "trivia"),
                        emoji = obj.optString("emoji", ""),
                        sourceLanguage = obj.optString("sourceLanguage", ""),
                    )
                }
            memoryCache = facts
            facts
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse cached fun facts", e)
            emptyList()
        }
    }
}
