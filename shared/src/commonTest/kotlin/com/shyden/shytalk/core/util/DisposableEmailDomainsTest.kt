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
}
