package com.shyden.shytalk.feature.settings

import org.junit.Assert.assertEquals
import org.junit.Test

class CensorEmailTest {
    @Test
    fun `standard email censors middle of local part`() {
        assertEquals("jo*****e@gmail.com", censorEmail("john.doe@gmail.com"))
    }

    @Test
    fun `short local part of 4 chars`() {
        assertEquals("te*t@gmail.com", censorEmail("test@gmail.com"))
    }

    @Test
    fun `3 char local part`() {
        assertEquals("ab*c@example.com", censorEmail("abc@example.com"))
    }

    @Test
    fun `2 char local part shows first char and star`() {
        assertEquals("a*@example.com", censorEmail("ab@example.com"))
    }

    @Test
    fun `1 char local part shows char and star`() {
        assertEquals("a*@example.com", censorEmail("a@example.com"))
    }

    @Test
    fun `no at sign returns original`() {
        assertEquals("notanemail", censorEmail("notanemail"))
    }

    @Test
    fun `domain is preserved fully`() {
        val result = censorEmail("user@my.long.domain.co.uk")
        assertEquals("us*r@my.long.domain.co.uk", result)
    }

    @Test
    fun `long local part censors correctly`() {
        // "verylongname" = 12 chars → first 2 + 9 stars + last char
        assertEquals("ve*********e@test.com", censorEmail("verylongname@test.com"))
    }
}
