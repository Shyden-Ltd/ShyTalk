package com.shyden.shytalk.core.push

/**
 * Which push registration model an identifier belongs to.
 *
 * SHY-0244. Firebase Messaging deprecated the registration-token model in
 * favour of one keyed on the Firebase Installation ID. The two are mutually
 * exclusive per app instance — a manifest flag decides which the SDK will
 * serve, and calling the wrong API throws — so a build speaks exactly one.
 * A fleet mid-upgrade speaks both.
 */
enum class PushIdentifierKind {
    /** The deprecated FCM registration token. */
    REGISTRATION_TOKEN,

    /** The Firebase Installation ID (FID). */
    INSTALLATION_ID,
}

/**
 * A push identifier together with the model it belongs to.
 *
 * The kind travels WITH the value on purpose. Both models are opaque strings,
 * and the backend cannot tell them apart by shape — so if the kind were
 * dropped anywhere along the way, a fid could be stored as a token. The send
 * would then fail, the reaper would delete the entry, and the device would go
 * permanently dark with nothing reporting a fault.
 *
 * Making the pair a type means that mistake cannot be written: there is no
 * bare string to pass to the wrong field.
 */
data class PushIdentifier(
    val value: String,
    val kind: PushIdentifierKind,
) {
    val isInstallationId: Boolean get() = kind == PushIdentifierKind.INSTALLATION_ID
}
