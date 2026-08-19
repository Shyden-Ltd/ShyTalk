package com.shyden.shytalk.navigation

sealed class Screen(
    val route: String,
) {
    data object SignIn : Screen("sign_in")

    data object ProfileSetup : Screen("profile_setup")

    data object Main : Screen("main")

    data object Room : Screen("room/{roomId}") {
        fun createRoute(roomId: String) = "room/$roomId"
    }

    data object UserProfile : Screen("profile/{userId}") {
        fun createRoute(userId: String) = "profile/$userId"
    }

    data object FollowList : Screen("follow_list/{userId}/{tab}") {
        fun createRoute(
            userId: String,
            tab: String,
        ) = "follow_list/$userId/$tab"
    }

    data object RequiredDOB : Screen("required_dob")

    data object PrivacyPolicy : Screen("privacy_policy")

    data object Settings : Screen("settings")

    data object PrivateChat : Screen("chat/{otherUserId}") {
        fun createRoute(otherUserId: String) = "chat/$otherUserId"
    }

    data object CommunityStandards : Screen("community_standards")

    data object TermsAndConditions : Screen("terms_and_conditions")

    data object CyberBullyingPolicy : Screen("cyber_bullying_policy")

    data object LegalAcceptance : Screen("legal_acceptance")

    data object ReportReview : Screen("report_review")

    data object GroupChat : Screen("group_chat/{conversationId}") {
        fun createRoute(conversationId: String) = "group_chat/$conversationId"
    }

    data object NewMessage : Screen("new_message")

    data object GroupSetup : Screen("group_setup/{selectedIds}") {
        fun createRoute(selectedIds: String) = "group_setup/$selectedIds"
    }

    data object Warning : Screen("warning")

    data object Wallet : Screen("wallet")

    data object Transactions : Screen("transactions")

    data object GiftWall : Screen("gift_wall/{userId}") {
        fun createRoute(userId: String) = "gift_wall/$userId"
    }

    data object Browser : Screen("browser/{url}") {
        fun createRoute(encodedUrl: String) = "browser/$encodedUrl"
    }

    data object EmailSignIn : Screen("email_sign_in")

    data object Lock : Screen("lock")

    /**
     * SHY-0143 — ban destinations reachable BEFORE the route decision.
     *
     * The ban UI used to exist only inside `SignInScreen`, driven by
     * `AuthUiState.isDeviceBanned/isNetworkBanned`. That was sufficient while
     * every session started at sign-in, but SHY-0187's optimistic cold start
     * routes a restored session straight to [Main] — so the only surface that
     * could render a ban became unreachable exactly when a banned user
     * returns. These are top-level destinations so the ban can be shown
     * without the user passing through, or even seeing, the login screen.
     *
     * Two variants rather than one parameterised screen because they are
     * different facts with different copy and different appeal routes: a
     * device ban follows the hardware, a network ban follows the IP / subnet /
     * ASN (which is also how VPNs are blocked, and is far more likely to catch
     * an innocent bystander on shared infrastructure).
     */
    data object BanDevice : Screen("ban_device")

    data object BanNetwork : Screen("ban_network")

    data object PinSetup : Screen("pin_setup")

    data object SecuritySettings : Screen("security_settings")

    /** Age-verification submit flow (PR 9). User reaches it from the
     *  AgeRestrictionDialog "Verify now" CTA in PM / gacha. */
    data object AgeVerificationSubmit : Screen("age_verification_submit")
}
