package com.shyden.shytalk.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Pins the `devPersonas` registry against the provisioner contract:
 *
 *  - Every id matches the `P-NN` pattern from
 *    `express-api/scripts/provision-test-personas.js`.
 *  - Every email lives under `@shytalk.dev` (the dev Firebase Auth tenant).
 *  - No duplicate ids or emails (would silently make a picker row
 *    sign in as the wrong account).
 *  - The 17 well-known journey-critical personas are present
 *    (P-02 Alice, P-04 Marcus, P-06 Hayato, P-07 Vexa, P-12 Greta,
 *    P-19 Officia) — explicit pins so a refactor that accidentally
 *    drops one is loud.
 */
class DevPersonasTest {
    @Test
    fun `registry has the 17 stable personas`() {
        // P-02..P-19 minus P-03 (Mia is ephemeral, not provisioned).
        assertEquals(17, devPersonas.size)
    }

    @Test
    fun `every id matches P-NN format`() {
        val pattern = Regex("""^P-\d{2}$""")
        for (p in devPersonas) {
            assertTrue(pattern.matches(p.id), "Bad id format: ${p.id}")
        }
    }

    @Test
    fun `every email lives under shytalk dot dev`() {
        for (p in devPersonas) {
            assertTrue(
                p.email.endsWith("@shytalk.dev"),
                "Email not in dev tenant: ${p.email}",
            )
        }
    }

    @Test
    fun `ids are unique`() {
        val ids = devPersonas.map { it.id }
        assertEquals(ids.size, ids.toSet().size, "Duplicate persona ids")
    }

    @Test
    fun `emails are unique`() {
        val emails = devPersonas.map { it.email }
        assertEquals(emails.size, emails.toSet().size, "Duplicate persona emails")
    }

    @Test
    fun `display names are non-blank`() {
        for (p in devPersonas) {
            assertTrue(p.displayName.isNotBlank(), "Blank displayName for ${p.id}")
        }
    }

    @Test
    fun `journey-critical personas are pinned by id`() {
        // If a refactor accidentally drops one of these, the journey
        // test plan breaks silently — pin them explicitly.
        val byId = devPersonas.associateBy { it.id }
        for (id in listOf("P-02", "P-04", "P-06", "P-07", "P-12", "P-19")) {
            assertNotNull(byId[id], "Missing journey-critical persona $id")
        }
    }

    @Test
    fun `P-04 Marcus is the minor cohort`() {
        val marcus = devPersonas.first { it.id == "P-04" }
        assertEquals(DevPersona.Cohort.MINOR, marcus.cohort)
        assertEquals("minor-power@shytalk.dev", marcus.email)
    }

    @Test
    fun `P-07 Vexa is the cross-cohort prober (adult cohort)`() {
        val vexa = devPersonas.first { it.id == "P-07" }
        assertEquals(DevPersona.Cohort.ADULT, vexa.cohort)
        assertEquals("adult-prober@shytalk.dev", vexa.email)
    }

    @Test
    fun `P-12 Greta is the admin (adult cohort)`() {
        val greta = devPersonas.first { it.id == "P-12" }
        assertEquals(DevPersona.Cohort.ADULT, greta.cohort)
        assertEquals("admin@shytalk.dev", greta.email)
    }

    @Test
    fun `exactly one MINOR cohort persona is registered`() {
        // The journey plan only includes Marcus as a stable minor. Mia
        // (the post-flip minor) is ephemeral. If a future change adds
        // another stable minor, update this expectation deliberately.
        val minors = devPersonas.filter { it.cohort == DevPersona.Cohort.MINOR }
        assertEquals(1, minors.size, "Expected exactly 1 stable minor persona")
        assertEquals("P-04", minors[0].id)
    }
}
