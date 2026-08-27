package com.shyden.shytalk.feature.room

/**
 * Why voice is not available in a room.
 *
 * SHY-0466. Four sites used to mark voice unavailable and only one recorded a
 * reason; the other three were the connect watchdog. The banner reads
 * `reason ?: generic`, so those three could only ever produce "Voice chat is
 * temporarily unavailable" — a sentence that names neither the layer nor the
 * cause, and the one a full session of diagnosis started from.
 *
 * A value here, rather than the service's own message, for two reasons:
 *
 *   - the service's message is English and technical ("Voice token error:
 *     connection refused"). Showing it to a reader in Thai is not a
 *     translation problem that can be fixed later; it is untranslatable by
 *     construction.
 *   - a value can be exhausted. A `String?` cannot, so a site that forgets to
 *     set one is invisible until somebody reads a screenshot.
 *
 * The service's own text is still worth having — it is kept for the log, not
 * for the screen.
 */
enum class VoiceUnavailableReason {
    /** The connect watchdog expired before voice joined. */
    CONNECT_TIMED_OUT,

    /** The voice service reported a failure of its own. */
    SERVICE_ERROR,

    /** Voice was connected and then dropped. */
    CONNECTION_LOST,
}
