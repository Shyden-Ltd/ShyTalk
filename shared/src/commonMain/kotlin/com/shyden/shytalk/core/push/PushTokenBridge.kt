package com.shyden.shytalk.core.push

/**
 * The platform's view of this device's push registration.
 *
 * SHY-0244 changed these from bare strings to [PushIdentifier]. The old shape
 * could not express WHICH model a value belonged to, so a platform that had
 * migrated to installation IDs would have returned one through a method named
 * for tokens and nothing would have objected — the type was identical and the
 * meaning was not.
 */
interface PushTokenBridge {
    /** The identifier this device is currently registered under, if any. */
    fun currentPushIdentifier(): PushIdentifier?

    /** The identifier last successfully sent to the backend, if any. */
    fun lastRegisteredIdentifier(): PushIdentifier?

    fun setLastRegisteredIdentifier(identifier: PushIdentifier?)
}
