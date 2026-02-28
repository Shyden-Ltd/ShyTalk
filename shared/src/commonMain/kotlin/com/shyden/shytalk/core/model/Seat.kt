package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool

data class Seat(
    val userId: String? = null,
    val state: SeatState = SeatState.EMPTY,
    val isMuted: Boolean = false
) {
    fun isOccupiedBy(uid: String): Boolean =
        userId == uid && state == SeatState.OCCUPIED

    fun toMap(): Map<String, Any?> = mapOf(
        "userId" to userId,
        "state" to state.name,
        "isMuted" to isMuted
    )

    companion object {
        /** Cached toMap() result for a default empty seat — avoids repeated allocations. */
        val EMPTY_MAP: Map<String, Any?> = Seat().toMap()

        fun fromMap(map: Map<String, Any?>): Seat = Seat(
            userId = map["userId"] as? String,
            state = (map["state"] as? String)?.let {
                try { SeatState.valueOf(it) } catch (_: Exception) { SeatState.EMPTY }
            } ?: SeatState.EMPTY,
            isMuted = map["isMuted"].asBool()
        )
    }
}
