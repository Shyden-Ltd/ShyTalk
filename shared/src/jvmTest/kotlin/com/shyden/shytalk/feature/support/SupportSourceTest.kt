package com.shyden.shytalk.feature.support

import com.shyden.shytalk.data.repository.SupportCategory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * SHY-0387 — where somebody came from decides what the admin is told.
 *
 * SHY-0385 built this as three inline maps in three Compose files, which is
 * exactly the shape that cannot be tested: the wiring pin could prove each screen
 * passed SOMETHING, and nothing could prove it passed the RIGHT something. As one
 * mapping it is ordinary logic with ordinary tests.
 */
class SupportSourceTest {
    @Test
    fun `every source produces only fields the server keeps`() {
        // Mirrors CONTEXT_ALLOWED_FIELDS in routes/support-tickets.js. A field
        // outside this set is silently dropped server-side, so it would look
        // present here and be absent in the ticket.
        val allowed = setOf("feature", "reason", "screen", "appVersion", "platform")

        for (source in SupportSource.entries) {
            val unknown = source.context().keys - allowed
            assertTrue(unknown.isEmpty(), "${source.name} sends fields the server drops: $unknown")
        }
    }

    @Test
    fun `every source says which screen it came from`() {
        for (source in SupportSource.entries) {
            assertTrue(
                source.context()["screen"]?.isNotBlank() == true,
                "${source.name} does not say which screen it came from",
            )
        }
    }

    @Test
    fun `no two sources look identical to an admin`() {
        val contexts = SupportSource.entries.map { it.context() }

        assertEquals(
            contexts.size,
            contexts.toSet().size,
            "two entry points produce the same context, so an admin cannot tell them apart",
        )
    }

    @Test
    fun `an age refusal says what refused them and why`() {
        val fromSpin = SupportSource.LuckySpinAgeWall.context()

        assertEquals("lucky_spin", fromSpin["feature"])
        assertEquals("age_restriction", fromSpin["reason"])
    }

    @Test
    fun `the general route claims no refusal`() {
        // Settings is where somebody goes when nothing turned them away. A
        // `reason` here would tell the admin about a refusal that never happened.
        assertTrue(
            "reason" !in SupportSource.Settings.context(),
            "the general entry point must not invent a reason",
        )
    }

    @Test
    fun `an age refusal is categorised as age, and the general route is not`() {
        assertEquals(SupportCategory.Age, SupportSource.LuckySpinAgeWall.category)
        assertEquals(SupportCategory.Age, SupportSource.PrivateMessageAgeWall.category)
        assertEquals(SupportCategory.Other, SupportSource.Settings.category)
    }

    @Test
    fun `a source survives a round trip through a navigation route`() {
        for (source in SupportSource.entries) {
            assertEquals(source, SupportSource.fromWire(source.wireValue))
        }
    }

    @Test
    fun `an unknown source falls back to the general route rather than failing`() {
        // A deeplink carrying a source we removed must still open support. Being
        // unable to reach support is worse than mislabelling one ticket.
        assertEquals(SupportSource.Settings, SupportSource.fromWire("no-such-source"))
    }
}
