package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool

data class SystemMessageConfig(
    val showJoins: Boolean = true,
    val showLeaves: Boolean = true,
    val showRoleChanges: Boolean = true,
    val showPermissionChanges: Boolean = true
) {
    fun toMap(): Map<String, Boolean> = mapOf(
        "showJoins" to showJoins,
        "showLeaves" to showLeaves,
        "showRoleChanges" to showRoleChanges,
        "showPermissionChanges" to showPermissionChanges
    )

    companion object {
        fun fromMap(map: Map<String, Any?>): SystemMessageConfig = SystemMessageConfig(
            showJoins = map["showJoins"].asBool(true),
            showLeaves = map["showLeaves"].asBool(true),
            showRoleChanges = map["showRoleChanges"].asBool(true),
            showPermissionChanges = map["showPermissionChanges"].asBool(true)
        )
    }
}
