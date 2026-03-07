package com.shyden.shytalk.core.util

import platform.Foundation.NSUserDefaults
import platform.Foundation.NSLocale
import platform.Foundation.currentLocale
import platform.Foundation.languageCode

actual object LanguagePreference {
    private const val KEY_LANGUAGE = "preferred_language"
    private const val KEY_AUTO_TRANSLATE = "auto_translate"

    actual fun get(): String =
        NSUserDefaults.standardUserDefaults.stringForKey(KEY_LANGUAGE)
            ?: NSLocale.currentLocale.languageCode.take(2)

    actual fun set(languageCode: String) {
        NSUserDefaults.standardUserDefaults.setObject(languageCode, KEY_LANGUAGE)
    }

    actual fun getAutoTranslate(): Boolean =
        NSUserDefaults.standardUserDefaults.boolForKey(KEY_AUTO_TRANSLATE)

    actual fun setAutoTranslate(enabled: Boolean) {
        NSUserDefaults.standardUserDefaults.setBool(enabled, KEY_AUTO_TRANSLATE)
    }
}
