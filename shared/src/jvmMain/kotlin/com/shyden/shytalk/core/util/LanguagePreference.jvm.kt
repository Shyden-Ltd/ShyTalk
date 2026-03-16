package com.shyden.shytalk.core.util

actual object LanguagePreference {
    private var lang: String = "en"
    private var autoTranslate: Boolean = false
    private var version: Int = 0

    actual fun get(): String = lang

    actual fun set(languageCode: String) {
        lang = languageCode
    }

    actual fun getAutoTranslate(): Boolean = autoTranslate

    actual fun setAutoTranslate(enabled: Boolean) {
        autoTranslate = enabled
    }

    actual fun getAcceptedLegalVersion(): Int = version

    actual fun setAcceptedLegalVersion(version: Int) {
        this.version = version
    }
}
