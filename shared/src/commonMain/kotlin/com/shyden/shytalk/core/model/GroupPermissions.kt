package com.shyden.shytalk.core.model

data class GroupPermissions(
    val whoCanSend: PermissionLevel = PermissionLevel.EVERYONE,
    val whoCanAddMembers: PermissionLevel = PermissionLevel.EVERYONE,
    val whoCanEditInfo: PermissionLevel = PermissionLevel.EVERYONE,
    val whoCanDeleteMessages: PermissionLevel = PermissionLevel.MODS_AND_ABOVE,
    val whoCanMuteMembers: PermissionLevel = PermissionLevel.MODS_AND_ABOVE,
    val whoCanRemoveMembers: PermissionLevel = PermissionLevel.ADMINS_ONLY,
) {
    enum class PermissionLevel(
        val displayName: String,
    ) {
        EVERYONE("Everyone"),
        MODS_AND_ABOVE("Mods & above"),
        ADMINS_ONLY("Admins only"),
        OWNER_ONLY("Owner only"),
        ;

        fun isAllowed(role: GroupRole): Boolean =
            when (this) {
                EVERYONE -> true
                MODS_AND_ABOVE -> role == GroupRole.MOD || role == GroupRole.ADMIN || role == GroupRole.OWNER
                ADMINS_ONLY -> role == GroupRole.ADMIN || role == GroupRole.OWNER
                OWNER_ONLY -> role == GroupRole.OWNER
            }
    }

    fun toMap(): Map<String, String> =
        mapOf(
            "whoCanSend" to whoCanSend.name,
            "whoCanAddMembers" to whoCanAddMembers.name,
            "whoCanEditInfo" to whoCanEditInfo.name,
            "whoCanDeleteMessages" to whoCanDeleteMessages.name,
            "whoCanMuteMembers" to whoCanMuteMembers.name,
            "whoCanRemoveMembers" to whoCanRemoveMembers.name,
        )

    companion object {
        private fun parseLevel(
            value: Any?,
            default: PermissionLevel = PermissionLevel.EVERYONE,
        ): PermissionLevel {
            val str = value as? String ?: return default
            // Backward compat: map old ADMINS_AND_MODS to MODS_AND_ABOVE
            if (str == "ADMINS_AND_MODS") return PermissionLevel.MODS_AND_ABOVE
            return try {
                PermissionLevel.valueOf(str)
            } catch (_: Exception) {
                default
            }
        }

        fun fromMap(map: Map<String, Any?>): GroupPermissions =
            GroupPermissions(
                whoCanSend = parseLevel(map["whoCanSend"]),
                whoCanAddMembers = parseLevel(map["whoCanAddMembers"]),
                whoCanEditInfo = parseLevel(map["whoCanEditInfo"]),
                whoCanDeleteMessages = parseLevel(map["whoCanDeleteMessages"], PermissionLevel.MODS_AND_ABOVE),
                whoCanMuteMembers = parseLevel(map["whoCanMuteMembers"], PermissionLevel.MODS_AND_ABOVE),
                whoCanRemoveMembers = parseLevel(map["whoCanRemoveMembers"], PermissionLevel.ADMINS_ONLY),
            )
    }
}
