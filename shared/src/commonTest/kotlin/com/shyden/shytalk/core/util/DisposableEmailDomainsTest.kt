package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DisposableEmailDomainsTest {
    @Test
    fun detects_disposable_email_domains() {
        assertTrue(DisposableEmailDomains.isDisposable("user@mailinator.com"))
        assertTrue(DisposableEmailDomains.isDisposable("test@guerrillamail.com"))
        assertTrue(DisposableEmailDomains.isDisposable("me@yopmail.com"))
        assertTrue(DisposableEmailDomains.isDisposable("x@tempmail.com"))
        assertTrue(DisposableEmailDomains.isDisposable("a@trashmail.com"))
        assertTrue(DisposableEmailDomains.isDisposable("b@maildrop.cc"))
        assertTrue(DisposableEmailDomains.isDisposable("c@burnermail.io"))
    }

    @Test
    fun accepts_normal_email_domains() {
        assertFalse(DisposableEmailDomains.isDisposable("user@gmail.com"))
        assertFalse(DisposableEmailDomains.isDisposable("user@outlook.com"))
        assertFalse(DisposableEmailDomains.isDisposable("user@company.co.uk"))
        assertFalse(DisposableEmailDomains.isDisposable("user@yahoo.com"))
        assertFalse(DisposableEmailDomains.isDisposable("user@protonmail.com"))
        assertFalse(DisposableEmailDomains.isDisposable("user@icloud.com"))
    }

    @Test
    fun case_insensitive_check() {
        assertTrue(DisposableEmailDomains.isDisposable("user@MAILINATOR.COM"))
        assertTrue(DisposableEmailDomains.isDisposable("user@Yopmail.Com"))
        assertTrue(DisposableEmailDomains.isDisposable("user@GUERRILLAMAIL.COM"))
    }

    @Test
    fun handles_edge_cases() {
        // No @ symbol -- substringAfter returns empty string
        assertFalse(DisposableEmailDomains.isDisposable("noemailformat"))
        // Empty string
        assertFalse(DisposableEmailDomains.isDisposable(""))
        // Just @
        assertFalse(DisposableEmailDomains.isDisposable("@"))
        // Domain without user part
        assertTrue(DisposableEmailDomains.isDisposable("@mailinator.com"))
    }

    // ── Extended: all blocked domains ───────────────────────────────

    @Test
    fun detects_all_blocked_domains() {
        val allBlocked =
            listOf(
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

        allBlocked.forEach { domain ->
            assertTrue(
                DisposableEmailDomains.isDisposable("user@$domain"),
                "Expected $domain to be detected as disposable",
            )
        }
    }

    // ── Bare domain input ───────────────────────────────────────────

    @Test
    fun detects_bare_disposable_domain() {
        assertTrue(DisposableEmailDomains.isDisposable("mailinator.com"))
        assertTrue(DisposableEmailDomains.isDisposable("yopmail.com"))
        assertTrue(DisposableEmailDomains.isDisposable("tempmail.com"))
    }

    @Test
    fun rejects_bare_normal_domain() {
        assertFalse(DisposableEmailDomains.isDisposable("gmail.com"))
        assertFalse(DisposableEmailDomains.isDisposable("outlook.com"))
        assertFalse(DisposableEmailDomains.isDisposable("company.co.uk"))
    }

    @Test
    fun bare_domain_is_case_insensitive() {
        assertTrue(DisposableEmailDomains.isDisposable("MAILINATOR.COM"))
        assertTrue(DisposableEmailDomains.isDisposable("Yopmail.Com"))
    }

    // ── Multiple @ symbols ──────────────────────────────────────────

    @Test
    fun handles_multiple_at_symbols() {
        // substringAfter('@') returns everything after the FIRST @
        // "user@@mailinator.com" -> "@mailinator.com" which is not in blocklist
        assertFalse(DisposableEmailDomains.isDisposable("user@@mailinator.com"))
    }

    @Test
    fun handles_at_in_local_part() {
        // This is technically invalid but tests the parsing:
        // "user@name@mailinator.com" -> substringAfter first @ = "name@mailinator.com"
        assertFalse(DisposableEmailDomains.isDisposable("user@name@mailinator.com"))
    }

    // ── Whitespace handling ─────────────────────────────────────────

    @Test
    fun does_not_trim_whitespace() {
        // Whitespace in domain means it's not a blocklisted domain
        assertFalse(DisposableEmailDomains.isDisposable("user@ mailinator.com"))
        assertFalse(DisposableEmailDomains.isDisposable("user@mailinator.com "))
    }
}
