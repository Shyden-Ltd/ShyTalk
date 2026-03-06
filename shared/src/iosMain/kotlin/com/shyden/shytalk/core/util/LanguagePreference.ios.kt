package com.shyden.shytalk.core.util

import platform.Foundation.NSUserDefaults
import platform.Foundation.NSLocale
import platform.Foundation.currentLocale
import platform.Foundation.languageCode

actual object LanguagePreference {
    private const val KEY_LANGUAGE = "preferred_language"

    actual fun get(): String =
        NSUserDefaults.standardUserDefaults.stringForKey(KEY_LANGUAGE)
            ?: NSLocale.currentLocale.languageCode.take(2)

    actual fun set(languageCode: String) {
        NSUserDefaults.standardUserDefaults.setObject(languageCode, KEY_LANGUAGE)
    }
}
