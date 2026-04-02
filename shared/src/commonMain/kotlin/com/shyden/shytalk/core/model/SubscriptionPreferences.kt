package com.shyden.shytalk.core.model

/**
 * User subscription preferences for roadmap/suggestion notifications.
 * Controls which notification channels (email, push, in-app, system message)
 * are enabled for each event type.
 */
data class ChannelPreference(
    val email: Boolean = false,
    val push: Boolean = false,
    val inApp: Boolean = true,
    val systemMessage: Boolean = false,
)

data class SubscriptionPreferences(
    val uid: String = "",
    val roadmapUpdate: ChannelPreference = ChannelPreference(),
    val suggestionAccepted: ChannelPreference = ChannelPreference(systemMessage = true),
    val suggestionPlanned: ChannelPreference = ChannelPreference(),
    val suggestionCompleted: ChannelPreference = ChannelPreference(systemMessage = true),
    val suggestionRejected: ChannelPreference = ChannelPreference(systemMessage = true),
    val suggestionMerged: ChannelPreference = ChannelPreference(systemMessage = true),
    val commentOnSuggestion: ChannelPreference = ChannelPreference(),
    val scope: String = "all",
    val watchedFeatures: List<String> = emptyList(),
    val watchedSuggestions: List<String> = emptyList(),
    val language: String = "en",
    val pushToken: String? = null,
    val email: String? = null,
    val emailConsentAt: Long? = null,
)
