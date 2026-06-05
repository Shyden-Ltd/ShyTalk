package com.shyden.shytalk.core.push

/**
 * Cross-platform representation of the OS push-notification permission state.
 *
 * Maps onto:
 *   - iOS UNAuthorizationStatus (notDetermined / denied / authorized / provisional / ephemeral)
 *   - Android NotificationManagerCompat.areNotificationsEnabled() + POST_NOTIFICATIONS
 *
 * Closes AppDelegate.swift:38's TODO(v2) by giving Kotlin UI an observable
 * signal it can surface to the user when notifications are blocked.
 */
enum class PushPermissionState {
    /** Permission has not been determined by the OS / user yet (first launch, no prompt shown). */
    NOT_DETERMINED,

    /** User has explicitly authorized notifications. */
    AUTHORIZED,

    /**
     * User has explicitly denied notifications — OR Focus / DnD / parental
     * controls have blocked them. The user must change this via Settings;
     * the app cannot re-prompt.
     */
    DENIED,

    /**
     * iOS-only: quiet delivery (notifications appear in Notification Center
     * but don't interrupt). Treated as effectively-authorized for our UX.
     */
    PROVISIONAL,
}
