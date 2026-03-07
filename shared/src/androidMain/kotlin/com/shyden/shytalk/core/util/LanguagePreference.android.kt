package com.shyden.shytalk.core.util

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences

@SuppressLint("StaticFieldLeak")
actual object LanguagePreference {
    private const val PREFS_NAME = "shytalk_prefs"
    private const val KEY_LANGUAGE = "preferred_language"
    private const val KEY_AUTO_TRANSLATE = "auto_translate"
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    actual fun get(): String =
        prefs?.getString(KEY_LANGUAGE, null)
            ?: java.util.Locale.getDefault().language.take(2)

    actual fun set(languageCode: String) {
        prefs?.edit()?.putString(KEY_LANGUAGE, languageCode)?.apply()
    }

    actual fun getAutoTranslate(): Boolean =
        prefs?.getBoolean(KEY_AUTO_TRANSLATE, false) ?: false

    actual fun setAutoTranslate(enabled: Boolean) {
        prefs?.edit()?.putBoolean(KEY_AUTO_TRANSLATE, enabled)?.apply()
    }
}
