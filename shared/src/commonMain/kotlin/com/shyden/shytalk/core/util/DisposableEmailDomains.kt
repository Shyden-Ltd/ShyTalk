package com.shyden.shytalk.core.util

/**
 * Blocklist of known disposable/temporary email domains.
 * Client-side validation only -- blocks sign-up attempts using throwaway addresses.
 */
object DisposableEmailDomains {
    private val blockedDomains =
        setOf(
            "mailinator.com",
            "guerrillamail.com",
            "guerrillamail.net",
            "tempmail.com",
            "throwaway.email",
            "yopmail.com",
            "10minutemail.com",
            "trashmail.com",
            "dispostable.com",
            "maildrop.cc",
            "fakeinbox.com",
            "sharklasers.com",
            "guerrillamailblock.com",
            "grr.la",
            "getairmail.com",
            "mailnesia.com",
            "temp-mail.org",
            "tempail.com",
            "mohmal.com",
            "burnermail.io",
            "harakirimail.com",
            "mailcatch.com",
            "mailforspam.com",
            "mailinater.com",
            "mytemp.email",
            "spam4.me",
            "trashmail.me",
            "tempr.email",
            "mailsac.com",
        )

    /**
     * Returns true if the email address uses a known disposable domain.
     * The check is case-insensitive.
     */
    fun isDisposable(email: String): Boolean {
        val domain = email.substringAfter("@", "").lowercase()
        return domain in blockedDomains
    }
}
