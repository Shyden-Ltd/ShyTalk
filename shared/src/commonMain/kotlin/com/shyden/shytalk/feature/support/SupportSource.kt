package com.shyden.shytalk.feature.support

import com.shyden.shytalk.data.repository.SupportCategory

/**
 * Where somebody was when they asked for help — SHY-0387.
 *
 * SHY-0385 built this as three inline maps in three Compose files. That is the
 * shape that cannot be tested: a wiring pin can prove each screen passes
 * SOMETHING, and nothing can prove it passes the RIGHT something. Worse, the
 * server's `CONTEXT_ALLOWED_FIELDS` silently drops any key it does not know, so a
 * typo would look present at the call site and be absent in the ticket.
 *
 * As one enum it is ordinary logic with ordinary tests, and the route only has to
 * carry [wireValue].
 */
enum class SupportSource(
    val wireValue: String,
    val category: SupportCategory,
    private val feature: String?,
    private val reason: String?,
    private val screen: String,
) {
    /** Stopped by the age wall on Lucky Spin. */
    LuckySpinAgeWall("lucky_spin_age_wall", SupportCategory.Age, "lucky_spin", "age_restriction", "room"),

    /** Stopped by the age wall on private messages. */
    PrivateMessageAgeWall(
        "private_message_age_wall",
        SupportCategory.Age,
        "private_messages",
        "age_restriction",
        "private_chat",
    ),

    /**
     * The general way in, from settings. Carries no `reason` deliberately —
     * nothing turned this person away, and inventing one would tell an admin
     * about a refusal that never happened.
     */
    Settings("settings", SupportCategory.Other, null, null, "settings"),
    ;

    /** Only the keys the server keeps; absent rather than empty. */
    fun context(): Map<String, String> =
        buildMap {
            feature?.let { put("feature", it) }
            reason?.let { put("reason", it) }
            put("screen", screen)
        }

    companion object {
        /**
         * A source that is no longer recognised falls back to the general route.
         *
         * A deeplink from an older build must still OPEN support: being unable to
         * reach help is a worse outcome than one ticket labelled generically.
         */
        fun fromWire(value: String?): SupportSource = entries.firstOrNull { it.wireValue == value } ?: Settings
    }
}
