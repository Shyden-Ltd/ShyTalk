package com.shyden.shytalk.navigation

sealed class Screen(val route: String) {
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
        fun createRoute(userId: String, tab: String) = "follow_list/$userId/$tab"
    }
    data object RequiredDOB : Screen("required_dob")
    data object PrivacyPolicy : Screen("privacy_policy")
    data object Settings : Screen("settings")
    data object PrivateChat : Screen("chat/{otherUserId}") {
        fun createRoute(otherUserId: String) = "chat/$otherUserId"
    }
    data object CommunityStandards : Screen("community_standards")
    data object TermsAndConditions : Screen("terms_and_conditions")
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
}
