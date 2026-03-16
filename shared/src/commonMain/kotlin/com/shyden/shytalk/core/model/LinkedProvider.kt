package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.timestampToMillis

/**
 * Represents a linked authentication provider on a user account.
 * Users can have multiple providers (Google, Apple, email+OTP).
 */
data class LinkedProvider(
    val type: ProviderType,
    val identifier: String,
    val active: Boolean,
    val linkedAt: Long,
    val unlinkedAt: Long? = null,
) {
    fun toMap(): Map<String, Any?> =
        mapOf(
            "type" to type.key,
            "identifier" to identifier,
            "active" to active,
            "linkedAt" to linkedAt,
            "unlinkedAt" to unlinkedAt,
        )

    companion object {
        fun fromMap(map: Map<String, Any?>): LinkedProvider =
            LinkedProvider(
                type = ProviderType.fromKey(map["type"] as? String ?: ""),
                identifier = map["identifier"] as? String ?: "",
                active = map["active"] as? Boolean ?: true,
                linkedAt = timestampToMillis(map["linkedAt"]),
                unlinkedAt = map["unlinkedAt"]?.let { timestampToMillis(it) },
            )
    }
}

/**
 * Supported authentication provider types.
 */
enum class ProviderType(
    val key: String,
) {
    GOOGLE("google"),
    APPLE("apple"),
    EMAIL("email"),
    UNKNOWN("unknown"),
    ;

    companion object {
        fun fromKey(key: String): ProviderType = entries.firstOrNull { it.key == key } ?: UNKNOWN
    }
}
