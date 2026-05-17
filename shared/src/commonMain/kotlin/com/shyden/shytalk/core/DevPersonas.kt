package com.shyden.shytalk.core

/**
 * Registry of test personas baked into dev/local builds for the
 * `/manual-qa` journey test plan. Each persona's email is committed
 * (public — the provisioner's JS file already exposes them) and is
 * paired at sign-in time with the shared `localDevPersonasPassword`
 * baked at build time. Empty password → picker UI never renders, so
 * the email list cannot drive a real sign-in even if surfaced.
 *
 * Source of truth: `express-api/scripts/provision-test-personas.js`.
 * Keep the two lists in sync — a personas-tests integration check in
 * `BuildVariantTest` pins the count so an out-of-sync add is loud.
 */
data class DevPersona(
    /** P-02..P-19 stable identifier mirroring the provisioner registry. */
    val id: String,
    /** Firebase Auth email — sign-in identifier. */
    val email: String,
    /** Human label including persona role hint. */
    val displayName: String,
    /** Cohort label rendered as a badge in the picker row. */
    val cohort: Cohort,
) {
    enum class Cohort { ADULT, MINOR }
}

/**
 * Ordered list shown in the in-screen persona picker. Order mirrors
 * the journey test plan's natural reading order (j01 first → j19).
 * Adding a persona: append to this list AND the provisioner.
 */
val devPersonas: List<DevPersona> =
    listOf(
        DevPersona("P-02", "adult-power@shytalk.dev", "Alice (P-02 adult power)", DevPersona.Cohort.ADULT),
        DevPersona("P-04", "minor-power@shytalk.dev", "Marcus (P-04 minor power)", DevPersona.Cohort.MINOR),
        DevPersona("P-05", "lapsed-adult@shytalk.dev", "Lena (P-05 lapsed)", DevPersona.Cohort.ADULT),
        DevPersona("P-06", "dob-mismatch@shytalk.dev", "Hayato (P-06 DOB mismatch)", DevPersona.Cohort.ADULT),
        DevPersona("P-07", "adult-prober@shytalk.dev", "Vexa (P-07 cross-cohort prober)", DevPersona.Cohort.ADULT),
        DevPersona("P-08", "harasser@shytalk.dev", "Raul (P-08 harasser)", DevPersona.Cohort.ADULT),
        DevPersona("P-09", "victim@shytalk.dev", "Nora (P-09 victim)", DevPersona.Cohort.ADULT),
        DevPersona("P-10", "host@shytalk.dev", "Theo (P-10 voice host)", DevPersona.Cohort.ADULT),
        DevPersona("P-11", "joiner-flaky@shytalk.dev", "Ines (P-11 flaky-net joiner)", DevPersona.Cohort.ADULT),
        DevPersona("P-12", "admin@shytalk.dev", "Greta (P-12 admin)", DevPersona.Cohort.ADULT),
        DevPersona("P-13", "rtl-user@shytalk.dev", "Layla (P-13 ar)", DevPersona.Cohort.ADULT),
        DevPersona("P-14", "cjk-user@shytalk.dev", "Kenji (P-14 ja)", DevPersona.Cohort.ADULT),
        DevPersona("P-15", "mc-singer@shytalk.dev", "Selma (P-15 MC Singer)", DevPersona.Cohort.ADULT),
        DevPersona("P-16", "mc-event-host@shytalk.dev", "Tariq (P-16 Event Host)", DevPersona.Cohort.ADULT),
        DevPersona("P-17", "teacher@shytalk.dev", "Bao (P-17 Teacher)", DevPersona.Cohort.ADULT),
        DevPersona("P-18", "student@shytalk.dev", "Yuki (P-18 Student)", DevPersona.Cohort.ADULT),
        DevPersona("P-19", "officia@shytalk.dev", "ShyTalk Official", DevPersona.Cohort.ADULT),
    )
