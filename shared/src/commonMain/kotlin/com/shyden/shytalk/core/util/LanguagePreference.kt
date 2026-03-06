package com.shyden.shytalk.core.util

expect object LanguagePreference {
    fun get(): String
    fun set(languageCode: String)
}
