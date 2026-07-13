package com.shyden.shytalk.core.util

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import androidx.annotation.VisibleForTesting

@SuppressLint("StaticFieldLeak")
actual object LanguagePreference {
    private const val PREFS_NAME = "shytalk_prefs"
    private const val KEY_LANGUAGE = "preferred_language"
    private const val KEY_AUTO_TRANSLATE = "auto_translate"
    private const val KEY_LEGAL_VERSION = "accepted_legal_version"
    private var prefs: SharedPreferences? = null

    // In-memory fallback used when no Android context has been wired yet — i.e.
    // any get/set before init(), and (crucially) the androidHost unit-test target
    // where SharedPreferences is inert. Keeps LanguagePreference functional +
    // makes commonTest deterministic across jvm AND androidHost (mirrors the jvm
    // actual). When prefs IS present it stays authoritative, so production
    // behaviour is unchanged; set() writes both so the two never diverge.
    private var memLanguage: String? = null
    private var memAutoTranslate: Boolean = false
    private var memLegalVersion: Int = 0

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    /**
     * Clears both the wired `prefs` and the in-memory fallback back to a
     * pristine state. Test-support for this process-singleton (host tests must
     * be able to isolate the prefs-present vs prefs-absent paths); never called
     * by production code.
     */
    @VisibleForTesting
    fun resetForTest() {
        prefs = null
        memLanguage = null
        memAutoTranslate = false
        memLegalVersion = 0
    }

    actual fun get(): String =
        (
            prefs?.getString(KEY_LANGUAGE, null)
                ?: memLanguage
                ?: java.util.Locale
                    .getDefault()
                    .language
        ).take(2)

    actual fun set(languageCode: String) {
        val value = languageCode.take(2)
        memLanguage = value
        prefs?.edit()?.putString(KEY_LANGUAGE, value)?.apply()
    }

    actual fun getAutoTranslate(): Boolean = prefs?.getBoolean(KEY_AUTO_TRANSLATE, memAutoTranslate) ?: memAutoTranslate

    actual fun setAutoTranslate(enabled: Boolean) {
        memAutoTranslate = enabled
        prefs?.edit()?.putBoolean(KEY_AUTO_TRANSLATE, enabled)?.apply()
    }

    actual fun getAcceptedLegalVersion(): Int = prefs?.getInt(KEY_LEGAL_VERSION, memLegalVersion) ?: memLegalVersion

    actual fun setAcceptedLegalVersion(version: Int) {
        memLegalVersion = version
        prefs?.edit()?.putInt(KEY_LEGAL_VERSION, version)?.apply()
    }
}
