package com.shyden.shytalk.feature.starting

import android.content.Context
import com.shyden.shytalk.data.remote.StartingScreen
import org.json.JSONObject
import java.io.File

/**
 * File-based cache for blocking starting screens.
 *
 * Uses atomic writes (temp file + rename) for the blocking screen cache,
 * and SharedPreferences for dismissed one-time screen IDs.
 */
class StartingScreenCache(
    private val context: Context,
) {
    private val cacheFile = File(context.cacheDir, "starting_screens_cache.json")
    private val prefs = context.getSharedPreferences("starting_screens", Context.MODE_PRIVATE)

    companion object {
        private const val CACHE_VERSION = 1
    }

    data class CachedScreen(
        val screenId: String,
        val contentHash: String,
        val enabled: Boolean,
        val dismissable: Boolean,
        val frequency: String,
        val template: String,
        val title: String,
        val message: String,
        val imageType: String?,
        val backgroundImage: String?,
        val backgroundImagePath: String?,
    ) {
        fun toStartingScreen(): StartingScreen =
            StartingScreen(
                screenId = screenId,
                enabled = enabled,
                dismissable = dismissable,
                frequency = frequency,
                template = template,
                title = title,
                message = message,
                imageType = imageType,
                backgroundImage = backgroundImage,
                contentHash = contentHash,
            )
    }

    fun getCachedBlocker(): CachedScreen? {
        return try {
            if (!cacheFile.exists() || cacheFile.length() == 0L) return null
            val text = cacheFile.readText()
            if (text.isBlank()) return null
            val json = JSONObject(text)
            if (json.optInt("cacheVersion") != CACHE_VERSION) {
                cacheFile.delete()
                return null
            }
            val blocker = json.optJSONObject("blockingScreen") ?: return null
            CachedScreen(
                screenId = blocker.optString("screenId", ""),
                contentHash = blocker.optString("contentHash", ""),
                enabled = blocker.optBoolean("enabled", true),
                dismissable = blocker.optBoolean("dismissable", false),
                frequency = blocker.optString("frequency", "every_launch"),
                template = blocker.optString("template", "warning"),
                title = blocker.optString("title", ""),
                message = blocker.optString("message", ""),
                imageType = blocker.opt("imageType")?.takeIf { it != JSONObject.NULL }?.toString(),
                backgroundImage = blocker.opt("backgroundImage")?.takeIf { it != JSONObject.NULL }?.toString(),
                backgroundImagePath = blocker.opt("backgroundImagePath")?.takeIf { it != JSONObject.NULL }?.toString(),
            )
        } catch (_: Exception) {
            cacheFile.delete()
            null
        }
    }

    fun cacheBlocker(
        screen: StartingScreen,
        backgroundImagePath: String?,
    ) {
        try {
            val json =
                JSONObject().apply {
                    put("cacheVersion", CACHE_VERSION)
                    put(
                        "blockingScreen",
                        JSONObject().apply {
                            put("screenId", screen.screenId)
                            put("contentHash", screen.contentHash)
                            put("enabled", screen.enabled)
                            put("dismissable", screen.dismissable)
                            put("frequency", screen.frequency)
                            put("template", screen.template)
                            put("title", screen.title)
                            put("message", screen.message)
                            put("imageType", screen.imageType ?: JSONObject.NULL)
                            put("backgroundImage", screen.backgroundImage ?: JSONObject.NULL)
                            put("backgroundImagePath", backgroundImagePath ?: JSONObject.NULL)
                        },
                    )
                }
            // Atomic write: write to temp file then rename
            val tempFile = File(context.cacheDir, "starting_screens_cache.tmp")
            tempFile.writeText(json.toString())
            cacheFile.delete() // delete existing before rename
            if (!tempFile.renameTo(cacheFile)) {
                tempFile.delete()
            }
        } catch (_: Exception) {
            // Log but don't crash — proceed with API response only
        }
    }

    fun clearBlocker() {
        cacheFile.delete()
    }

    fun isDismissed(screenId: String): Boolean = prefs.getStringSet("dismissed_once", mutableSetOf())?.contains(screenId) == true

    fun markDismissed(screenId: String) {
        val current = prefs.getStringSet("dismissed_once", mutableSetOf())?.toMutableSet() ?: mutableSetOf()
        current.add(screenId)
        prefs.edit().putStringSet("dismissed_once", current).apply()
    }

    fun clearDismissed() {
        prefs.edit().remove("dismissed_once").apply()
    }
}
