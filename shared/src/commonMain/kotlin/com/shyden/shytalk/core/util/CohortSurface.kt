package com.shyden.shytalk.core.util

/**
 * A feature the app must not OFFER to a cohort that may not use it.
 *
 * SHY-0459. Spec j02 expects a minor to have the messages tab and the wallet
 * hidden; the shipped app showed both. Cohort enforcement was server-side
 * only, so a minor could see a control, tap it, and be refused by an app that
 * offered in the first place.
 *
 * The server's refusal is real and stays — this is the door, not the lock.
 * Which is why the list is short and named: it is the set of doors, not a
 * second enforcement layer to be trusted.
 */
enum class CohortGatedFeature {
    /** The messages tab, and everything reached only through it. */
    DIRECT_MESSAGES,

    /** The wallet, and the purchase surfaces behind it. */
    WALLET,
}

/**
 * Whether [feature] is offered to somebody whose user document says [cohort]
 * (and optionally [cohortOverride]).
 *
 * Resolution is delegated to [effectiveCohort], so this obeys the same rules
 * as the Firestore gate, the Express middleware and its KMP twin — including
 * failing CLOSED. An unrecognised value is a minor, never an adult.
 *
 * That direction matters. SHY-0468 was a gate that failed the other way: a
 * missing value read as "no restriction", and an adult could open a thread
 * with a minor. A surface that opens on junk is the same mistake with a
 * smaller blast radius.
 */
fun isFeatureOffered(
    feature: CohortGatedFeature,
    cohort: String,
    cohortOverride: String? = null,
): Boolean {
    val isAdult = effectiveCohort(cohort, cohortOverride) != COHORT_MINOR
    // Exhaustive on purpose. Both features currently turn on the same
    // question, and writing that as one expression would have been shorter —
    // but then a feature added later would inherit an answer nobody chose.
    // This way the compiler stops on the new value until somebody decides.
    return when (feature) {
        CohortGatedFeature.DIRECT_MESSAGES -> isAdult
        CohortGatedFeature.WALLET -> isAdult
    }
}
