/**
 * Admin panel translations — all 20 locales.
 *
 * Loaded by admin/index.html. Works with the shared language-selector.js.
 * Each key maps to a data-i18n attribute in the HTML.
 */

var ADMIN_TRANSLATIONS = {
  // ─── Navigation tabs ───
  en: {
    // Tabs
    tab_users: 'Users', tab_appeals: 'Appeals', tab_reports: 'Reports', tab_gifts: 'Gifts',
    tab_economy: 'Economy', tab_maintenance: 'Maintenance', tab_monitor: 'Spin Monitor',
    tab_banners: 'Banners', tab_funfacts: 'Fun Facts', tab_backups: 'Backups',
    tab_logs: 'Logs', tab_devices: 'Devices', tab_starting_screens: 'Starting Screens',
    // Auth
    btn_sign_in: 'Sign In', btn_sign_out: 'Sign Out',
    // Search
    btn_search: 'Search', placeholder_search_uid: 'Enter ShyTalk User ID',
    // User subtabs
    subtab_profile: 'Profile', subtab_moderation: 'Moderation',
    subtab_security: 'Security', subtab_economy: 'Economy',
    // User profile labels
    label_uid: 'UID', label_display_name: 'Display Name', label_user_type: 'User Type',
    label_nationality: 'Nationality', label_description: 'Description', label_email: 'Email',
    label_date_of_birth: 'Date of Birth', label_unique_id: 'Unique ID',
    // Actions
    btn_suspend_user: 'Suspend User', btn_unsuspend_user: 'Unsuspend',
    btn_warn: 'Issue Warning', btn_reset_device: 'Reset Device Binding',
    btn_reset_gcs: 'Reset GCS',
    // Economy
    label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans',
    label_super_shy: 'Super Shy', label_login_streak: 'Login Streak',
    // Status
    status_banned: 'BANNED', status_active: 'Active', status_suspended: 'Suspended',
    status_pending: 'Pending',
    // Filters
    filter_pending: 'Pending', filter_approved: 'Approved', filter_denied: 'Denied',
    filter_resolved: 'Resolved', filter_archived: 'Archived',
    // Actions
    btn_approve: 'Approve', btn_deny: 'Deny', btn_resolve: 'Resolve',
    // General
    btn_save: 'Save', btn_cancel: 'Cancel', btn_delete: 'Delete', btn_apply: 'Apply',
    btn_refresh: 'Refresh', btn_load_more: 'Load More',
    msg_loading: 'Loading...', msg_no_data: 'No data found',
    msg_saved: 'Saved', msg_error: 'Error',
    // Logs
    label_log_level: 'Level', label_log_source: 'Source',
    btn_export_json: 'Export JSON', btn_export_csv: 'Export CSV',
    // Devices
    table_device_id: 'Device ID', table_user: 'User', table_model: 'Model',
    table_os: 'OS', table_last_ip: 'Last IP', table_isp: 'ISP',
    table_country: 'Country', table_last_seen: 'Last Seen',
    // Tabs / sub-tabs (User panel — Age Verification + Identity + Audit Log + Suggestions)
    tab_suggestions: 'Suggestions', tab_audit_log: 'Audit Log',
    // Age Segregation tab (UK OSA #17 PR 13) — full 20-locale translations land in PR 14
    tab_age_segregation: 'Age Segregation',
    age_seg_title: 'Age Segregation',
    age_seg_subtitle: 'Cohort distribution and override controls for UK OSA compliance.',
    age_seg_stats_heading: 'Cohort Distribution',
    age_seg_refresh: 'Refresh',
    age_seg_adult: 'Adult',
    age_seg_minor: 'Minor',
    age_seg_missing: 'Missing cohort',
    age_seg_total: 'Total users',
    age_seg_override_adult: 'Override → adult',
    age_seg_override_minor: 'Override → minor',
    age_seg_override_heading: 'Cohort Override',
    age_seg_override_note: 'Overrides bypass the DOB-derived cohort. Only allowed on staff or admin accounts. Every change is audit-logged with the supplied reason.',
    age_seg_target_label: 'Target user ID',
    age_seg_override_value_label: 'New cohort',
    age_seg_pick: '— pick —',
    age_seg_clear: 'Clear override',
    age_seg_reason_label: 'Reason (required, ≤500 chars)',
    age_seg_apply: 'Apply Override',
    age_seg_confirm_title: 'Confirm cohort override',
    age_seg_confirm_body: 'This change is audit-logged and may force a token refresh on the target user. Review the details before confirming.',
    age_seg_cancel: 'Cancel',
    age_seg_confirm_ok: 'Confirm',
    subtab_identity: 'Identity', subtab_age_verification: 'Age Verification',
    // User → Age Verification panel
    age_verif_panel_title: 'Age Verification',
    age_verif_panel_subtitle: "Review the user's submitted government ID and decide. Approve confirms the user is 18+. Reject keeps them sub-18 and notifies them. If the ID shows a different DOB, use Modify-DOB to correct the record.",
    age_verif_no_pending_for_user: 'No pending verification submission for this user.',
    age_verif_other_pending_label: 'Other pending submissions across the system:',
    age_verif_jump_next: 'Jump to next pending',
    age_verif_image_disclaimer: 'Image is destroyed when the decision is recorded.',
    age_verif_field_method: 'ID method:',
    age_verif_field_recorded_dob: 'Recorded DOB:',
    age_verif_field_submitted_at: 'Submitted at:',
    age_verif_field_submission_id: 'Submission ID:',
    age_verif_match_question: "Does the ID confirm the user's recorded date of birth?",
    age_verif_match_yes: 'Yes — DOB on the ID matches the recorded value',
    age_verif_match_no: 'No — the ID shows a different DOB',
    age_verif_approve_help: 'Approve: confirms the user as 18+ verified. Reject: keeps them sub-18 and sends a system PM with the reason.',
    age_verif_approve_button: 'Approve (mark verified)',
    age_verif_reject_summary: 'Reject instead…',
    age_verif_reject_button: 'Reject submission',
    age_verif_modify_help: "Update the user's DOB to match the value shown on the ID. The user is unlocked or kept locked automatically based on the new age.",
    age_verif_new_dob_label: 'Date of birth on the ID:',
    age_verif_modify_button: 'Update DOB & decide',
    confirm_reset_pin_lockout: 'Reset PIN lockout for this user?',
    confirm_unsuspend_user: 'Unsuspend this user? Their account will be fully restored.',
    confirm_reset_gcs: 'Reset this user\'s GCS to 100 and clear all warnings?',
    confirm_schedule_deletion: 'Are you sure you want to schedule this account for deletion?',
    alert_deletion_scheduled: 'Account deletion scheduled.',
    confirm_cancel_deletion: 'Cancel the scheduled account deletion?',
    confirm_remove_all_device_bindings: 'Remove all device bindings for this user?',
    confirm_remove_device_ban: 'Remove this device ban?',
    confirm_remove_network_ban: 'Remove this network ban?',
    confirm_unban_device: 'Unban this device?',
    confirm_ban_all_devices: 'Ban all devices for this user?',
    confirm_remove_all_bans: 'Remove all bans for this user?',
    confirm_unsuspend_identity_graph: 'Unsuspend identity graph for this user?',
    alert_deletion_cancelled: 'Account deletion cancelled.',
    confirm_clear_temp_id: 'Clear the temporary ID?',
    confirm_revoke_warning: 'Revoke this warning? +{deduction} GCS will be restored.',
    confirm_revoke_biometric: 'Revoke biometric key for device {deviceId}?',
    confirm_issue_warning: 'Issue a warning for "{reason}" (severity {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: 'Failed to schedule deletion: {error}',
    alert_cancel_deletion_failed: 'Failed to cancel deletion: {error}',
    confirm_ban_ip: 'Ban IP {ip}?',
    confirm_suspend_identity_graph: 'Suspend identity graph for this user ({duration}, {scope})?',
    btn_searching: 'Searching...',
    btn_email_show: 'Show',
    btn_email_hide: 'Hide',
    btn_email_saving: 'Saving…',
    btn_undo: 'Undo',
    msg_no_warnings: 'No warnings',
    btn_revoke: 'Revoke',
    toast_display_name_empty: 'Display name cannot be empty',
    toast_undo_successful: 'Undo successful',
    toast_already_in_list: 'Already in list',
    toast_autosave_failed: 'Auto-save failed: {error}',
    toast_undo_failed: 'Undo failed: {error}',
    status_suspended_badge: 'Suspended since {since}, until {until}. Reason: {reason}',
    status_not_suspended: 'Not Suspended',
    status_deletion_scheduled: 'Deletion scheduled — {days} days remaining ({date})',
    status_severity_gcs: 'Severity {severity} (-{deduction} GCS)',
    msg_permanent: 'permanent',
    msg_no_reason_provided: 'No reason provided',
    msg_suspended_since_until_format: 'Suspended since {since}, until {until}',
    inline_revoked: 'Revoked',
    inline_warning_note: 'Note: {note}',
    inline_warning_meta: 'By: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}',
    toast_warning_revoked_gcs: 'Warning revoked, +{deduction} GCS restored',
    toast_pin_lockout_reset: 'PIN lockout reset',
    toast_biometric_revoked: 'Biometric key revoked',
    toast_gcs_reset_100: 'GCS reset to 100',
    toast_action_failed: 'Failed: {error}',
    btn_issuing: 'Issuing...',
    btn_issue_warning: 'Issue Warning',
    btn_resetting: 'Resetting...',
    toast_reason_required: 'Reason is required',
    toast_select_reason: 'Select a reason',
    toast_no_user_loaded: 'No user loaded',
    toast_device_bindings_removed: 'Removed {count} device binding(s)',
    btn_reset_device_binding: 'Reset Device Binding',
    toast_auto_escalate_5_warnings: 'This user has 5+ warnings. Consider suspending.',
    toast_no_ip_found: 'No IP address found',
    toast_banned_n_devices: 'Banned {count} device(s)',
    toast_removed_n_bans: 'Removed {count} ban(s)',
    toast_partial_retry: 'Partial: {summary}. Please retry the failed step.',
    toast_user_suspended: 'User suspended',
    toast_user_unsuspended: 'User unsuspended',
    toast_warning_issued_successfully: 'Warning issued successfully',
    toast_ip_banned: 'IP banned',
    toast_identity_graph_suspended: 'Identity graph suspended',
    toast_identity_graph_unsuspended: 'Identity graph unsuspended',
    prompt_deletion_reason: 'Enter reason for account deletion (optional):',
    prompt_ban_reason: 'Reason (optional):',
    bio_device_label: 'Device:',
    bio_registered_label: 'Registered:',
    segment_ban_call_failed: '{count}/{total} ban call(s) failed (first: {error})',
    segment_pm_failed: '{count}/{total} PMs failed',
    toast_no_devices_to_ban: 'No devices to ban',
    toast_enter_positive_amount: 'Enter a positive amount',
    toast_coins_added: 'Added {amount} coins (now {balance})',
    toast_coins_deducted: 'Deducted {amount} coins (now {balance})',
    toast_beans_added: 'Added {amount} beans (now {balance})',
    toast_beans_deducted: 'Deducted {amount} beans (now {balance})',
    toast_select_gift_qty: 'Select a gift and enter a quantity',
    toast_gift_added: 'Added {qty} (total now {total})',
    toast_backpack_empty_already: 'Backpack is already empty',
    msg_loading_backpack: 'Loading backpack...',
    msg_backpack_empty: 'Backpack is empty',
    msg_no_matching_gifts: 'No matching gifts',
    btn_confirm_clear_all: 'Confirm Clear All',
    btn_confirming: 'Confirm ({countdown})',
    btn_clearing: 'Clearing...',
    toast_backpack_cleared: 'Backpack cleared ({count} items removed)',
    toast_cleared_with_errors: 'Cleared {cleared}, failed {errors}',
    toast_failed_to_save: 'Failed to save: {error}',
  },
  ar: {
    tab_users: '\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u0648\u0646', tab_appeals: '\u0627\u0644\u0637\u0639\u0648\u0646', tab_reports: '\u0627\u0644\u062A\u0642\u0627\u0631\u064A\u0631', tab_gifts: '\u0627\u0644\u0647\u062F\u0627\u064A\u0627',
    tab_economy: '\u0627\u0644\u0627\u0642\u062A\u0635\u0627\u062F', tab_maintenance: '\u0627\u0644\u0635\u064A\u0627\u0646\u0629', tab_monitor: '\u0645\u0631\u0627\u0642\u0628\u0629 \u0627\u0644\u062F\u0648\u0631\u0627\u0646',
    tab_banners: '\u0627\u0644\u0644\u0627\u0641\u062A\u0627\u062A', tab_funfacts: '\u062D\u0642\u0627\u0626\u0642 \u0645\u0645\u062A\u0639\u0629', tab_backups: '\u0627\u0644\u0646\u0633\u062E \u0627\u0644\u0627\u062D\u062A\u064A\u0627\u0637\u064A\u0629',
    tab_logs: '\u0627\u0644\u0633\u062C\u0644\u0627\u062A', tab_devices: '\u0627\u0644\u0623\u062C\u0647\u0632\u0629', tab_starting_screens: '\u0634\u0627\u0634\u0627\u062A \u0627\u0644\u0628\u062F\u0627\u064A\u0629',
    btn_sign_in: '\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644', btn_sign_out: '\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062E\u0631\u0648\u062C',
    btn_search: '\u0628\u062D\u062B', placeholder_search_uid: '\u0623\u062F\u062E\u0644 \u0645\u0639\u0631\u0641 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645',
    subtab_profile: '\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062E\u0635\u064A', subtab_moderation: '\u0627\u0644\u0625\u0634\u0631\u0627\u0641',
    subtab_security: '\u0627\u0644\u0623\u0645\u0627\u0646', subtab_economy: '\u0627\u0644\u0627\u0642\u062A\u0635\u0627\u062F',
    label_uid: '\u0627\u0644\u0645\u0639\u0631\u0641', label_display_name: '\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0638\u0627\u0647\u0631', label_user_type: '\u0646\u0648\u0639 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645',
    label_nationality: '\u0627\u0644\u062C\u0646\u0633\u064A\u0629', label_description: '\u0627\u0644\u0648\u0635\u0641', label_email: '\u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A',
    label_date_of_birth: '\u062A\u0627\u0631\u064A\u062E \u0627\u0644\u0645\u064A\u0644\u0627\u062F', label_unique_id: '\u0627\u0644\u0645\u0639\u0631\u0641 \u0627\u0644\u0641\u0631\u064A\u062F',
    btn_suspend_user: '\u062A\u0639\u0644\u064A\u0642 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645', btn_unsuspend_user: '\u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u062A\u0639\u0644\u064A\u0642',
    btn_warn: '\u0625\u0635\u062F\u0627\u0631 \u062A\u062D\u0630\u064A\u0631', btn_reset_device: '\u0625\u0639\u0627\u062F\u0629 \u062A\u0639\u064A\u064A\u0646 \u0627\u0644\u062C\u0647\u0627\u0632',
    btn_reset_gcs: '\u0625\u0639\u0627\u062F\u0629 \u062A\u0639\u064A\u064A\u0646 GCS',
    label_shy_coins: '\u0639\u0645\u0644\u0627\u062A Shy', label_shy_beans: '\u062D\u0628\u0648\u0628 Shy',
    label_super_shy: '\u0633\u0648\u0628\u0631 \u0634\u0627\u064A', label_login_streak: '\u0633\u0644\u0633\u0644\u0629 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644',
    status_banned: '\u0645\u062D\u0638\u0648\u0631', status_active: '\u0646\u0634\u0637', status_suspended: '\u0645\u0639\u0644\u0642',
    status_pending: '\u0642\u064A\u062F \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631',
    filter_pending: '\u0642\u064A\u062F \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631', filter_approved: '\u0645\u0648\u0627\u0641\u0642 \u0639\u0644\u064A\u0647', filter_denied: '\u0645\u0631\u0641\u0648\u0636',
    filter_resolved: '\u062A\u0645 \u0627\u0644\u062D\u0644', filter_archived: '\u0645\u0624\u0631\u0634\u0641',
    btn_approve: '\u0645\u0648\u0627\u0641\u0642\u0629', btn_deny: '\u0631\u0641\u0636', btn_resolve: '\u062D\u0644',
    btn_save: '\u062D\u0641\u0638', btn_cancel: '\u0625\u0644\u063A\u0627\u0621', btn_delete: '\u062D\u0630\u0641', btn_apply: '\u062A\u0637\u0628\u064A\u0642',
    btn_refresh: '\u062A\u062D\u062F\u064A\u062B', btn_load_more: '\u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0645\u0632\u064A\u062F',
    msg_loading: '\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u062D\u0645\u064A\u0644...', msg_no_data: '\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u064A\u0627\u0646\u0627\u062A',
    msg_saved: '\u062A\u0645 \u0627\u0644\u062D\u0641\u0638', msg_error: '\u062E\u0637\u0623',
    label_log_level: '\u0627\u0644\u0645\u0633\u062A\u0648\u0649', label_log_source: '\u0627\u0644\u0645\u0635\u062F\u0631',
    btn_export_json: '\u062A\u0635\u062F\u064A\u0631 JSON', btn_export_csv: '\u062A\u0635\u062F\u064A\u0631 CSV',
    table_device_id: '\u0645\u0639\u0631\u0641 \u0627\u0644\u062C\u0647\u0627\u0632', table_user: '\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645', table_model: '\u0627\u0644\u0637\u0631\u0627\u0632',
    table_os: '\u0627\u0644\u0646\u0638\u0627\u0645', table_last_ip: '\u0622\u062E\u0631 IP', table_isp: '\u0645\u0632\u0648\u062F \u0627\u0644\u062E\u062F\u0645\u0629',
    table_country: '\u0627\u0644\u062F\u0648\u0644\u0629', table_last_seen: '\u0622\u062E\u0631 \u0638\u0647\u0648\u0631',
    confirm_reset_pin_lockout: 'إعادة تعيين قفل رمز PIN لهذا المستخدم؟',
    confirm_unsuspend_user: 'رفع تعليق هذا المستخدم؟ ستتم استعادة حسابه بالكامل.',
    confirm_reset_gcs: 'إعادة تعيين GCS لهذا المستخدم إلى 100 ومسح جميع التحذيرات؟',
    confirm_schedule_deletion: 'هل أنت متأكد من رغبتك في جدولة حذف هذا الحساب؟',
    alert_deletion_scheduled: 'تم جدولة حذف الحساب.',
    confirm_cancel_deletion: 'إلغاء حذف الحساب المجدول؟',
    confirm_remove_all_device_bindings: 'إزالة جميع روابط الأجهزة لهذا المستخدم؟',
    confirm_remove_device_ban: 'إزالة حظر هذا الجهاز؟',
    confirm_remove_network_ban: 'إزالة حظر هذه الشبكة؟',
    confirm_unban_device: 'رفع حظر هذا الجهاز؟',
    confirm_ban_all_devices: 'حظر جميع أجهزة هذا المستخدم؟',
    confirm_remove_all_bans: 'إزالة جميع الحظر لهذا المستخدم؟',
    confirm_unsuspend_identity_graph: 'رفع تعليق رسم الهوية لهذا المستخدم؟',
    alert_deletion_cancelled: 'تم إلغاء حذف الحساب.',
    confirm_clear_temp_id: 'مسح المعرّف المؤقت؟',
    confirm_revoke_warning: 'إلغاء هذا التحذير؟ ستتم استعادة +{deduction} نقطة GCS.',
    confirm_revoke_biometric: 'إلغاء مفتاح القياسات الحيوية للجهاز {deviceId}؟',
    confirm_issue_warning: 'إصدار تحذير بسبب "{reason}" (الخطورة {severity}، -{deduction} GCS)؟',
    alert_schedule_deletion_failed: 'فشل جدولة الحذف: {error}',
    alert_cancel_deletion_failed: 'فشل إلغاء الحذف: {error}',
    confirm_ban_ip: 'حظر IP {ip}؟',
    confirm_suspend_identity_graph: 'تعليق رسم الهوية لهذا المستخدم ({duration}, {scope})؟',
    btn_searching: 'جارٍ البحث...',
    btn_email_show: 'إظهار',
    btn_email_hide: 'إخفاء',
    btn_email_saving: 'جارٍ الحفظ…',
    btn_undo: 'تراجع',
    msg_no_warnings: 'لا توجد تحذيرات',
    btn_revoke: 'إلغاء',
    toast_display_name_empty: 'لا يمكن أن يكون اسم العرض فارغًا',
    toast_undo_successful: 'تم التراجع بنجاح',
    toast_already_in_list: 'موجود بالفعل في القائمة',
    toast_autosave_failed: 'فشل الحفظ التلقائي: {error}',
    toast_undo_failed: 'فشل التراجع: {error}',
    status_suspended_badge: 'معلق منذ {since}، حتى {until}. السبب: {reason}',
    status_not_suspended: 'غير معلق',
    status_deletion_scheduled: 'تمت جدولة الحذف — {days} يومًا متبقيًا ({date})',
    status_severity_gcs: 'الخطورة {severity} (-{deduction} GCS)',
    msg_permanent: 'دائم',
    msg_no_reason_provided: 'لم يُذكر سبب',
    msg_suspended_since_until_format: 'معلق منذ {since}، حتى {until}',
    inline_revoked: 'تم الإلغاء',
    inline_warning_note: 'ملاحظة: {note}',
    // override-translated 2026-06-02
    inline_warning_meta: "بواسطة: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}",
    toast_warning_revoked_gcs: 'تم إلغاء التحذير، تمت إعادة +{deduction} GCS',
    toast_pin_lockout_reset: 'تمت إعادة تعيين قفل PIN',
    toast_biometric_revoked: 'تم إلغاء مفتاح القياسات الحيوية',
    toast_gcs_reset_100: 'تمت إعادة تعيين GCS إلى 100',
    toast_action_failed: 'فشل: {error}',
    btn_issuing: 'جارٍ الإصدار...',
    btn_issue_warning: 'إصدار تحذير',
    btn_resetting: 'جارٍ إعادة التعيين...',
    toast_reason_required: 'السبب مطلوب',
    toast_select_reason: 'اختر سببًا',
    toast_no_user_loaded: 'لم يتم تحميل أي مستخدم',
    toast_device_bindings_removed: 'تم إزالة {count} ربط جهاز',
    btn_reset_device_binding: 'إعادة تعيين ربط الجهاز',
    toast_auto_escalate_5_warnings: 'هذا المستخدم لديه 5 تحذيرات أو أكثر. فكر في تعليق حسابه.',
    toast_no_ip_found: 'لم يتم العثور على عنوان IP',
    toast_banned_n_devices: 'تم حظر {count} جهاز',
    toast_removed_n_bans: 'تم إزالة {count} حظر',
    toast_partial_retry: 'جزئي: {summary}. يرجى إعادة محاولة الخطوة الفاشلة.',
    toast_user_suspended: 'تم تعليق المستخدم',
    toast_user_unsuspended: 'تم رفع التعليق عن المستخدم',
    toast_warning_issued_successfully: 'تم إصدار التحذير بنجاح',
    toast_ip_banned: 'تم حظر عنوان IP',
    toast_identity_graph_suspended: 'تم تعليق رسم الهوية',
    toast_identity_graph_unsuspended: 'تم رفع تعليق رسم الهوية',
    prompt_deletion_reason: 'أدخل سبب حذف الحساب (اختياري):',
    prompt_ban_reason: 'السبب (اختياري):',
    bio_device_label: 'الجهاز:',
    bio_registered_label: 'مسجل:',
    segment_ban_call_failed: '{count}/{total} استدعاء حظر فشل (الأول: {error})',
    segment_pm_failed: '{count}/{total} رسائل خاصة فشلت',
    toast_no_devices_to_ban: 'لا توجد أجهزة للحظر',
    toast_enter_positive_amount: 'أدخل مبلغًا موجبًا',
    toast_coins_added: 'تمت إضافة {amount} عملة (الآن {balance})',
    toast_coins_deducted: 'تم خصم {amount} عملة (الآن {balance})',
    toast_beans_added: 'تمت إضافة {amount} فول (الآن {balance})',
    toast_beans_deducted: 'تم خصم {amount} فول (الآن {balance})',
    toast_select_gift_qty: 'اختر هدية وأدخل الكمية',
    toast_gift_added: 'تمت إضافة {qty} (الإجمالي الآن {total})',
    toast_backpack_empty_already: 'حقيبة الظهر فارغة بالفعل',
    msg_loading_backpack: 'جارٍ تحميل حقيبة الظهر...',
    msg_backpack_empty: 'حقيبة الظهر فارغة',
    msg_no_matching_gifts: 'لا توجد هدايا مطابقة',
    btn_confirm_clear_all: 'تأكيد المسح الكامل',
    btn_confirming: 'تأكيد ({countdown})',
    btn_clearing: 'جارٍ المسح...',
    toast_backpack_cleared: 'تم مسح حقيبة الظهر (تم إزالة {count} عنصر)',
    toast_cleared_with_errors: 'تم مسح {cleared}، فشل {errors}',
    toast_failed_to_save: 'فشل الحفظ: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "اقتراحات",
    // google-translated 2026-06-02
    tab_audit_log: "سجل التدقيق",
    // google-translated 2026-06-02
    tab_age_segregation: "الفصل العمري",
    // google-translated 2026-06-02
    age_seg_title: "الفصل العمري",
    // google-translated 2026-06-02
    age_seg_subtitle: "توزيع الفوج وتجاوز الضوابط للامتثال OSA في المملكة المتحدة.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "توزيع الفوج",
    // override-translated 2026-06-02
    age_seg_refresh: "تحديث",
    // google-translated 2026-06-02
    age_seg_adult: "الكبار",
    // override-translated 2026-06-02
    age_seg_minor: "قاصر",
    // google-translated 2026-06-02
    age_seg_missing: "الفوج المفقود",
    // google-translated 2026-06-02
    age_seg_total: "إجمالي المستخدمين",
    // google-translated 2026-06-02
    age_seg_override_adult: "تجاوز → الكبار",
    // google-translated 2026-06-02
    age_seg_override_minor: "تجاوز → قاصر",
    // google-translated 2026-06-02
    age_seg_override_heading: "تجاوز الفوج",
    // google-translated 2026-06-02
    age_seg_override_note: "تتجاوز التجاوزات المجموعة النموذجية المشتقة من DOB. مسموح به فقط على حسابات الموظفين أو المشرفين. يتم تسجيل كل تغيير مع السبب المقدم.",
    // google-translated 2026-06-02
    age_seg_target_label: "معرف المستخدم المستهدف",
    // google-translated 2026-06-02
    age_seg_override_value_label: "فوج جديد",
    // override-translated 2026-06-02
    age_seg_pick: "— اختر —",
    // override-translated 2026-06-02
    age_seg_clear: "مسح التجاوز",
    // override-translated 2026-06-02
    age_seg_reason_label: "السبب (مطلوب، ≤500 حرف)",
    // google-translated 2026-06-02
    age_seg_apply: "تطبيق التجاوز",
    // google-translated 2026-06-02
    age_seg_confirm_title: "تأكيد تجاوز المجموعة النموذجية",
    // google-translated 2026-06-02
    age_seg_confirm_body: "يتم تسجيل هذا التغيير وقد يفرض تحديث الرمز المميز على المستخدم المستهدف. قم بمراجعة التفاصيل قبل التأكيد.",
    // override-translated 2026-06-02
    age_seg_cancel: "إلغاء",
    // override-translated 2026-06-02
    age_seg_confirm_ok: "تأكيد",
    // google-translated 2026-06-02
    subtab_identity: "هوية",
    // google-translated 2026-06-02
    subtab_age_verification: "التحقق من العمر",
    // google-translated 2026-06-02
    age_verif_panel_title: "التحقق من العمر",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "قم بمراجعة بطاقة الهوية الحكومية المقدمة للمستخدم ثم اتخذ القرار. الموافقة تؤكد أن عمر المستخدم 18+. الرفض يبقيهم دون سن 18 عامًا ويخطرهم. إذا أظهر المعرف DOB مختلفًا، فاستخدم Modify-DOB لتصحيح السجل.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "لا يوجد إرسال التحقق المعلق لهذا المستخدم.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "عمليات الإرسال المعلقة الأخرى عبر النظام:",
    // google-translated 2026-06-02
    age_verif_jump_next: "انتقل إلى التالي المعلق",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "يتم إتلاف الصورة عند تسجيل القرار.",
    // google-translated 2026-06-02
    age_verif_field_method: "طريقة الهوية:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "تاريخ الميلاد المسجل:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "تم تقديمه في:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "معرف التقديم:",
    // google-translated 2026-06-02
    age_verif_match_question: "هل تؤكد الهوية تاريخ الميلاد المسجل للمستخدم؟",
    // google-translated 2026-06-02
    age_verif_match_yes: "نعم — DOB الموجود على المعرف يطابق القيمة المسجلة",
    // google-translated 2026-06-02
    age_verif_match_no: "لا — يُظهر المعرف تاريخ ميلاد مختلفًا",
    // google-translated 2026-06-02
    age_verif_approve_help: "الموافقة: تؤكد أن المستخدم تم التحقق منه بعمر 18+. الرفض: يبقيهم دون سن 18 عامًا ويرسل رسالة للنظام مع السبب.",
    // google-translated 2026-06-02
    age_verif_approve_button: "الموافقة (تم التحقق من العلامة)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "رفض بدلاً من ذلك...",
    // google-translated 2026-06-02
    age_verif_reject_button: "رفض التقديم",
    // google-translated 2026-06-02
    age_verif_modify_help: "قم بتحديث DOB الخاص بالمستخدم ليطابق القيمة الموضحة في المعرف. يتم إلغاء قفل المستخدم أو إبقائه مقفلاً تلقائيًا بناءً على العصر الجديد.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "تاريخ الميلاد على الهوية:",
    // google-translated 2026-06-02
    age_verif_modify_button: "قم بتحديث DOB ثم قرر",
  },
  de: {
    tab_users: 'Benutzer', tab_appeals: 'Einsprüche', tab_reports: 'Berichte', tab_gifts: 'Geschenke',
    tab_economy: 'Wirtschaft', tab_maintenance: 'Wartung', tab_monitor: 'Drehmonitor',
    tab_banners: 'Banner', tab_funfacts: 'Fakten', tab_backups: 'Backups',
    tab_logs: 'Protokolle', tab_devices: 'Geräte', tab_starting_screens: 'Startbildschirme',
    btn_sign_in: 'Anmelden', btn_sign_out: 'Abmelden',
    btn_search: 'Suchen', placeholder_search_uid: 'ShyTalk-Benutzer-ID eingeben',
    subtab_profile: 'Profil', subtab_moderation: 'Moderation',
    subtab_security: 'Sicherheit', subtab_economy: 'Wirtschaft',
    label_uid: 'UID', label_display_name: 'Anzeigename', label_user_type: 'Benutzertyp',
    label_nationality: 'Nationalität', label_description: 'Beschreibung', label_email: 'E-Mail',
    label_date_of_birth: 'Geburtsdatum', label_unique_id: 'Eindeutige ID',
    btn_suspend_user: 'Benutzer sperren', btn_unsuspend_user: 'Entsperren',
    btn_warn: 'Verwarnung erteilen', btn_reset_device: 'Gerätebindung zurücksetzen',
    btn_reset_gcs: 'GCS zurücksetzen',
    label_shy_coins: 'Shy-Münzen', label_shy_beans: 'Shy-Bohnen',
    label_super_shy: 'Super Shy', label_login_streak: 'Anmeldeserie',
    status_banned: 'GESPERRT', status_active: 'Aktiv', status_suspended: 'Suspendiert',
    status_pending: 'Ausstehend',
    filter_pending: 'Ausstehend', filter_approved: 'Genehmigt', filter_denied: 'Abgelehnt',
    filter_resolved: 'Gelöst', filter_archived: 'Archiviert',
    btn_approve: 'Genehmigen', btn_deny: 'Ablehnen', btn_resolve: 'Lösen',
    btn_save: 'Speichern', btn_cancel: 'Abbrechen', btn_delete: 'Löschen', btn_apply: 'Anwenden',
    btn_refresh: 'Aktualisieren', btn_load_more: 'Mehr laden',
    msg_loading: 'Laden...', msg_no_data: 'Keine Daten gefunden',
    msg_saved: 'Gespeichert', msg_error: 'Fehler',
    label_log_level: 'Stufe', label_log_source: 'Quelle',
    btn_export_json: 'JSON exportieren', btn_export_csv: 'CSV exportieren',
    table_device_id: 'Geräte-ID', table_user: 'Benutzer', table_model: 'Modell',
    table_os: 'Betriebssystem', table_last_ip: 'Letzte IP', table_isp: 'Anbieter',
    table_country: 'Land', table_last_seen: 'Zuletzt gesehen',
    confirm_reset_pin_lockout: 'PIN-Sperre für diesen Benutzer zurücksetzen?',
    confirm_unsuspend_user: 'Sperre für diesen Benutzer aufheben? Das Konto wird vollständig wiederhergestellt.',
    confirm_reset_gcs: 'GCS dieses Benutzers auf 100 zurücksetzen und alle Warnungen löschen?',
    confirm_schedule_deletion: 'Sind Sie sicher, dass Sie dieses Konto zur Löschung einplanen möchten?',
    alert_deletion_scheduled: 'Kontolöschung geplant.',
    confirm_cancel_deletion: 'Geplante Kontolöschung abbrechen?',
    confirm_remove_all_device_bindings: 'Alle Gerätebindungen für diesen Benutzer entfernen?',
    confirm_remove_device_ban: 'Diesen Gerätebann entfernen?',
    confirm_remove_network_ban: 'Diesen Netzwerkbann entfernen?',
    confirm_unban_device: 'Bann für dieses Gerät aufheben?',
    confirm_ban_all_devices: 'Alle Geräte dieses Benutzers sperren?',
    confirm_remove_all_bans: 'Alle Sperren für diesen Benutzer entfernen?',
    confirm_unsuspend_identity_graph: 'Sperre des Identitätsgraphen für diesen Benutzer aufheben?',
    alert_deletion_cancelled: 'Kontolöschung abgebrochen.',
    confirm_clear_temp_id: 'Temporäre ID löschen?',
    confirm_revoke_warning: 'Diese Warnung widerrufen? +{deduction} GCS werden wiederhergestellt.',
    confirm_revoke_biometric: 'Biometrischen Schlüssel für Gerät {deviceId} widerrufen?',
    confirm_issue_warning: 'Eine Warnung für "{reason}" ausstellen (Schweregrad {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: 'Löschung konnte nicht geplant werden: {error}',
    alert_cancel_deletion_failed: 'Löschung konnte nicht abgebrochen werden: {error}',
    confirm_ban_ip: 'IP {ip} sperren?',
    confirm_suspend_identity_graph: 'Identitätsgraph für diesen Benutzer sperren ({duration}, {scope})?',
    btn_searching: 'Suche läuft...',
    btn_email_show: 'Anzeigen',
    btn_email_hide: 'Verbergen',
    btn_email_saving: 'Speichern…',
    btn_undo: 'Rückgängig',
    msg_no_warnings: 'Keine Warnungen',
    btn_revoke: 'Widerrufen',
    toast_display_name_empty: 'Anzeigename darf nicht leer sein',
    toast_undo_successful: 'Rückgängig erfolgreich',
    toast_already_in_list: 'Bereits in der Liste',
    toast_autosave_failed: 'Auto-Speichern fehlgeschlagen: {error}',
    toast_undo_failed: 'Rückgängig fehlgeschlagen: {error}',
    status_suspended_badge: 'Gesperrt seit {since}, bis {until}. Grund: {reason}',
    status_not_suspended: 'Nicht gesperrt',
    status_deletion_scheduled: 'Löschung geplant — {days} Tage verbleibend ({date})',
    status_severity_gcs: 'Schweregrad {severity} (-{deduction} GCS)',
    msg_permanent: 'dauerhaft',
    msg_no_reason_provided: 'Kein Grund angegeben',
    msg_suspended_since_until_format: 'Gesperrt seit {since}, bis {until}',
    inline_revoked: 'Widerrufen',
    inline_warning_note: 'Hinweis: {note}',
    inline_warning_meta: 'Von: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}',
    toast_warning_revoked_gcs: 'Verwarnung widerrufen, +{deduction} GCS wiederhergestellt',
    toast_pin_lockout_reset: 'PIN-Sperre zurückgesetzt',
    toast_biometric_revoked: 'Biometrischer Schlüssel widerrufen',
    toast_gcs_reset_100: 'GCS auf 100 zurückgesetzt',
    toast_action_failed: 'Fehlgeschlagen: {error}',
    btn_issuing: 'Wird ausgestellt...',
    btn_issue_warning: 'Verwarnung ausstellen',
    btn_resetting: 'Wird zurückgesetzt...',
    toast_reason_required: 'Begründung erforderlich',
    toast_select_reason: 'Begründung auswählen',
    toast_no_user_loaded: 'Kein Benutzer geladen',
    toast_device_bindings_removed: '{count} Geräteverknüpfung(en) entfernt',
    btn_reset_device_binding: 'Geräteverknüpfung zurücksetzen',
    toast_auto_escalate_5_warnings: 'Dieser Benutzer hat 5+ Verwarnungen. Sperrung erwägen.',
    toast_no_ip_found: 'Keine IP-Adresse gefunden',
    toast_banned_n_devices: '{count} Gerät(e) gesperrt',
    toast_removed_n_bans: '{count} Sperre(n) entfernt',
    toast_partial_retry: 'Teilweise: {summary}. Bitte den fehlgeschlagenen Schritt wiederholen.',
    toast_user_suspended: 'Benutzer gesperrt',
    toast_user_unsuspended: 'Benutzersperre aufgehoben',
    toast_warning_issued_successfully: 'Verwarnung erfolgreich ausgestellt',
    toast_ip_banned: 'IP gesperrt',
    toast_identity_graph_suspended: 'Identitätsgraph gesperrt',
    toast_identity_graph_unsuspended: 'Identitätsgraph-Sperre aufgehoben',
    prompt_deletion_reason: 'Grund für die Kontolöschung eingeben (optional):',
    prompt_ban_reason: 'Begründung (optional):',
    bio_device_label: 'Gerät:',
    bio_registered_label: 'Registriert:',
    segment_ban_call_failed: '{count}/{total} Sperraufrufe fehlgeschlagen (erster: {error})',
    segment_pm_failed: '{count}/{total} PNs fehlgeschlagen',
    toast_no_devices_to_ban: 'Keine Geräte zum Sperren',
    toast_enter_positive_amount: 'Positiven Betrag eingeben',
    toast_coins_added: '{amount} Münzen hinzugefügt (jetzt {balance})',
    toast_coins_deducted: '{amount} Münzen abgezogen (jetzt {balance})',
    toast_beans_added: '{amount} Beans hinzugefügt (jetzt {balance})',
    toast_beans_deducted: '{amount} Beans abgezogen (jetzt {balance})',
    toast_select_gift_qty: 'Geschenk auswählen und Menge eingeben',
    toast_gift_added: '{qty} hinzugefügt (Gesamt jetzt {total})',
    toast_backpack_empty_already: 'Rucksack ist bereits leer',
    msg_loading_backpack: 'Rucksack wird geladen...',
    msg_backpack_empty: 'Rucksack ist leer',
    msg_no_matching_gifts: 'Keine passenden Geschenke',
    btn_confirm_clear_all: 'Alles löschen bestätigen',
    btn_confirming: 'Bestätigen ({countdown})',
    btn_clearing: 'Wird gelöscht...',
    toast_backpack_cleared: 'Rucksack geleert ({count} Gegenstände entfernt)',
    toast_cleared_with_errors: '{cleared} gelöscht, {errors} fehlgeschlagen',
    toast_failed_to_save: 'Speichern fehlgeschlagen: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Vorschläge",
    // google-translated 2026-06-02
    tab_audit_log: "Audit-Protokoll",
    // google-translated 2026-06-02
    tab_age_segregation: "Alterstrennung",
    // google-translated 2026-06-02
    age_seg_title: "Alterstrennung",
    // google-translated 2026-06-02
    age_seg_subtitle: "Kohortenverteilung und Überschreibungskontrollen für die Einhaltung der OSA im Vereinigten Königreich.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Kohortenverteilung",
    // google-translated 2026-06-02
    age_seg_refresh: "Aktualisieren",
    // google-translated 2026-06-02
    age_seg_adult: "Erwachsene",
    // override-translated 2026-06-02
    age_seg_minor: "Minderjährig",
    // google-translated 2026-06-02
    age_seg_missing: "Fehlende Kohorte",
    // google-translated 2026-06-02
    age_seg_total: "Gesamtzahl der Benutzer",
    // google-translated 2026-06-02
    age_seg_override_adult: "Überschreiben → Erwachsener",
    // override-translated 2026-06-02
    age_seg_override_minor: "Überschreiben → Minderjährig",
    // google-translated 2026-06-02
    age_seg_override_heading: "Kohortenüberschreibung",
    // google-translated 2026-06-02
    age_seg_override_note: "Überschreibungen umgehen die vom Geburtsdatum abgeleitete Kohorte. Nur für Mitarbeiter- oder Administratorkonten zulässig. Jede Änderung wird mit dem angegebenen Grund protokolliert.",
    // google-translated 2026-06-02
    age_seg_target_label: "Zielbenutzer-ID",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Neue Kohorte",
    // google-translated 2026-06-02
    age_seg_pick: "- wählen -",
    // google-translated 2026-06-02
    age_seg_clear: "Überschreibung löschen",
    // google-translated 2026-06-02
    age_seg_reason_label: "Grund (erforderlich, ≤500 Zeichen)",
    // google-translated 2026-06-02
    age_seg_apply: "Überschreibung anwenden",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Kohortenüberschreibung bestätigen",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Diese Änderung wird protokolliert und erzwingt möglicherweise eine Token-Aktualisierung für den Zielbenutzer. Überprüfen Sie die Details, bevor Sie sie bestätigen.",
    // override-translated 2026-06-02
    age_seg_cancel: "Abbrechen",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Bestätigen",
    // google-translated 2026-06-02
    subtab_identity: "Identität",
    // google-translated 2026-06-02
    subtab_age_verification: "Altersüberprüfung",
    // google-translated 2026-06-02
    age_verif_panel_title: "Altersüberprüfung",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Überprüfen Sie den vom Benutzer übermittelten amtlichen Ausweis und entscheiden Sie. Genehmigen bestätigt, dass der Benutzer mindestens 18 Jahre alt ist. Reject hält sie unter 18 Jahren und benachrichtigt sie. Wenn die ID ein anderes Geburtsdatum anzeigt, korrigieren Sie den Eintrag mit „Ändern-Geburtsdatum“.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Für diesen Benutzer steht keine Bestätigungsübermittlung aus.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Weitere ausstehende Einreichungen im gesamten System:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Zum nächsten ausstehenden springen",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "Bei der Protokollierung der Entscheidung wird das Bild vernichtet.",
    // google-translated 2026-06-02
    age_verif_field_method: "ID-Methode:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "Eingetragenes Geburtsdatum:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Eingereicht bei:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "Einreichungs-ID:",
    // google-translated 2026-06-02
    age_verif_match_question: "Bestätigt der Ausweis das erfasste Geburtsdatum des Benutzers?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Ja – Geburtsdatum auf dem Ausweis stimmt mit dem aufgezeichneten Wert überein",
    // google-translated 2026-06-02
    age_verif_match_no: "Nein – der Ausweis zeigt ein anderes Geburtsdatum",
    // google-translated 2026-06-02
    age_verif_approve_help: "Genehmigen: Bestätigt, dass der Benutzer über 18 Jahre alt ist. Ablehnen: Behält sie unter 18 Jahren und sendet eine System-PM mit dem Grund.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Genehmigen (als bestätigt markieren)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Stattdessen ablehnen…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Einreichung ablehnen",
    // google-translated 2026-06-02
    age_verif_modify_help: "Aktualisieren Sie das Geburtsdatum des Benutzers so, dass es mit dem auf der ID angezeigten Wert übereinstimmt. Der Benutzer wird basierend auf dem neuen Alter automatisch entsperrt oder gesperrt.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Geburtsdatum im Ausweis:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Geburtsdatum aktualisieren und entscheiden",
  },
  es: {
    tab_users: 'Usuarios', tab_appeals: 'Apelaciones', tab_reports: 'Informes', tab_gifts: 'Regalos',
    tab_economy: 'Economía', tab_maintenance: 'Mantenimiento', tab_monitor: 'Monitor de giros',
    tab_banners: 'Banners', tab_funfacts: 'Datos curiosos', tab_backups: 'Copias de seguridad',
    tab_logs: 'Registros', tab_devices: 'Dispositivos', tab_starting_screens: 'Pantallas iniciales',
    btn_sign_in: 'Iniciar sesión', btn_sign_out: 'Cerrar sesión',
    btn_search: 'Buscar', placeholder_search_uid: 'Introduce el ID de usuario',
    subtab_profile: 'Perfil', subtab_moderation: 'Moderación',
    subtab_security: 'Seguridad', subtab_economy: 'Economía',
    label_uid: 'UID', label_display_name: 'Nombre', label_user_type: 'Tipo de usuario',
    label_nationality: 'Nacionalidad', label_description: 'Descripción', label_email: 'Correo',
    label_date_of_birth: 'Fecha de nacimiento', label_unique_id: 'ID único',
    btn_suspend_user: 'Suspender usuario', btn_unsuspend_user: 'Reactivar',
    btn_warn: 'Emitir advertencia', btn_reset_device: 'Restablecer dispositivo',
    btn_reset_gcs: 'Restablecer GCS',
    label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans',
    label_super_shy: 'Super Shy', label_login_streak: 'Racha de inicio',
    status_banned: 'BANEADO', status_active: 'Activo', status_suspended: 'Suspendido',
    status_pending: 'Pendiente',
    filter_pending: 'Pendiente', filter_approved: 'Aprobado', filter_denied: 'Denegado',
    filter_resolved: 'Resuelto', filter_archived: 'Archivado',
    btn_approve: 'Aprobar', btn_deny: 'Denegar', btn_resolve: 'Resolver',
    btn_save: 'Guardar', btn_cancel: 'Cancelar', btn_delete: 'Eliminar', btn_apply: 'Aplicar',
    btn_refresh: 'Actualizar', btn_load_more: 'Cargar más',
    msg_loading: 'Cargando...', msg_no_data: 'No se encontraron datos',
    msg_saved: 'Guardado', msg_error: 'Error',
    label_log_level: 'Nivel', label_log_source: 'Origen',
    btn_export_json: 'Exportar JSON', btn_export_csv: 'Exportar CSV',
    table_device_id: 'ID de dispositivo', table_user: 'Usuario', table_model: 'Modelo',
    table_os: 'SO', table_last_ip: 'Última IP', table_isp: 'ISP',
    table_country: 'País', table_last_seen: 'Última vez visto',
    confirm_reset_pin_lockout: '¿Restablecer el bloqueo PIN de este usuario?',
    confirm_unsuspend_user: '¿Quitar la suspensión a este usuario? Su cuenta se restaurará por completo.',
    confirm_reset_gcs: '¿Restablecer el GCS de este usuario a 100 y borrar todas las advertencias?',
    confirm_schedule_deletion: '¿Está seguro de que desea programar la eliminación de esta cuenta?',
    alert_deletion_scheduled: 'Eliminación de cuenta programada.',
    confirm_cancel_deletion: '¿Cancelar la eliminación de cuenta programada?',
    confirm_remove_all_device_bindings: '¿Eliminar todas las vinculaciones de dispositivos de este usuario?',
    confirm_remove_device_ban: '¿Eliminar este bloqueo de dispositivo?',
    confirm_remove_network_ban: '¿Eliminar este bloqueo de red?',
    confirm_unban_device: '¿Desbloquear este dispositivo?',
    confirm_ban_all_devices: '¿Bloquear todos los dispositivos de este usuario?',
    confirm_remove_all_bans: '¿Eliminar todos los bloqueos de este usuario?',
    confirm_unsuspend_identity_graph: '¿Reactivar el gráfico de identidad de este usuario?',
    alert_deletion_cancelled: 'Eliminación de cuenta cancelada.',
    confirm_clear_temp_id: '¿Borrar el ID temporal?',
    confirm_revoke_warning: '¿Revocar esta advertencia? Se restaurarán +{deduction} GCS.',
    confirm_revoke_biometric: '¿Revocar la clave biométrica del dispositivo {deviceId}?',
    confirm_issue_warning: '¿Emitir una advertencia por "{reason}" (gravedad {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: 'No se pudo programar la eliminación: {error}',
    alert_cancel_deletion_failed: 'No se pudo cancelar la eliminación: {error}',
    confirm_ban_ip: '¿Bloquear IP {ip}?',
    confirm_suspend_identity_graph: '¿Suspender el gráfico de identidad de este usuario ({duration}, {scope})?',
    btn_searching: 'Buscando...',
    btn_email_show: 'Mostrar',
    btn_email_hide: 'Ocultar',
    btn_email_saving: 'Guardando…',
    btn_undo: 'Deshacer',
    msg_no_warnings: 'Sin advertencias',
    btn_revoke: 'Revocar',
    toast_display_name_empty: 'El nombre para mostrar no puede estar vacío',
    toast_undo_successful: 'Deshacer correcto',
    toast_already_in_list: 'Ya está en la lista',
    toast_autosave_failed: 'Error de autoguardado: {error}',
    toast_undo_failed: 'Error al deshacer: {error}',
    status_suspended_badge: 'Suspendido desde {since}, hasta {until}. Motivo: {reason}',
    status_not_suspended: 'No suspendido',
    status_deletion_scheduled: 'Eliminación programada — {days} días restantes ({date})',
    status_severity_gcs: 'Gravedad {severity} (-{deduction} GCS)',
    msg_permanent: 'permanente',
    msg_no_reason_provided: 'Sin motivo proporcionado',
    msg_suspended_since_until_format: 'Suspendido desde {since}, hasta {until}',
    inline_revoked: 'Revocado',
    inline_warning_note: 'Nota: {note}',
    inline_warning_meta: 'Por: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}',
    toast_warning_revoked_gcs: 'Advertencia revocada, +{deduction} GCS restaurados',
    toast_pin_lockout_reset: 'Bloqueo de PIN restablecido',
    toast_biometric_revoked: 'Clave biométrica revocada',
    toast_gcs_reset_100: 'GCS restablecido a 100',
    toast_action_failed: 'Error: {error}',
    btn_issuing: 'Emitiendo...',
    btn_issue_warning: 'Emitir advertencia',
    btn_resetting: 'Restableciendo...',
    toast_reason_required: 'Se requiere un motivo',
    toast_select_reason: 'Selecciona un motivo',
    toast_no_user_loaded: 'Ningún usuario cargado',
    toast_device_bindings_removed: 'Se eliminaron {count} vínculo(s) de dispositivo',
    btn_reset_device_binding: 'Restablecer vínculo de dispositivo',
    toast_auto_escalate_5_warnings: 'Este usuario tiene 5+ advertencias. Considera suspenderlo.',
    toast_no_ip_found: 'No se encontró ninguna dirección IP',
    toast_banned_n_devices: 'Se prohibieron {count} dispositivo(s)',
    toast_removed_n_bans: 'Se eliminaron {count} prohibición(es)',
    toast_partial_retry: 'Parcial: {summary}. Reintenta el paso que falló.',
    toast_user_suspended: 'Usuario suspendido',
    toast_user_unsuspended: 'Suspensión del usuario levantada',
    toast_warning_issued_successfully: 'Advertencia emitida correctamente',
    toast_ip_banned: 'IP prohibida',
    toast_identity_graph_suspended: 'Gráfico de identidad suspendido',
    toast_identity_graph_unsuspended: 'Gráfico de identidad reactivado',
    prompt_deletion_reason: 'Introduce el motivo de la eliminación de la cuenta (opcional):',
    prompt_ban_reason: 'Motivo (opcional):',
    bio_device_label: 'Dispositivo:',
    bio_registered_label: 'Registrado:',
    segment_ban_call_failed: '{count}/{total} llamada(s) de ban fallaron (primero: {error})',
    segment_pm_failed: '{count}/{total} MPs fallaron',
    toast_no_devices_to_ban: 'No hay dispositivos para prohibir',
    toast_enter_positive_amount: 'Introduce una cantidad positiva',
    toast_coins_added: 'Se añadieron {amount} monedas (ahora {balance})',
    toast_coins_deducted: 'Se dedujeron {amount} monedas (ahora {balance})',
    toast_beans_added: 'Se añadieron {amount} beans (ahora {balance})',
    toast_beans_deducted: 'Se dedujeron {amount} beans (ahora {balance})',
    toast_select_gift_qty: 'Selecciona un regalo e introduce una cantidad',
    toast_gift_added: 'Se añadieron {qty} (total ahora {total})',
    toast_backpack_empty_already: 'La mochila ya está vacía',
    msg_loading_backpack: 'Cargando mochila...',
    msg_backpack_empty: 'La mochila está vacía',
    msg_no_matching_gifts: 'No hay regalos coincidentes',
    btn_confirm_clear_all: 'Confirmar borrar todo',
    btn_confirming: 'Confirmar ({countdown})',
    btn_clearing: 'Borrando...',
    toast_backpack_cleared: 'Mochila vaciada (se eliminaron {count} elementos)',
    toast_cleared_with_errors: 'Se borraron {cleared}, fallaron {errors}',
    toast_failed_to_save: 'No se pudo guardar: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Sugerencias",
    // google-translated 2026-06-02
    tab_audit_log: "Registro de auditoría",
    // google-translated 2026-06-02
    tab_age_segregation: "Segregación por edades",
    // google-translated 2026-06-02
    age_seg_title: "Segregación por edades",
    // google-translated 2026-06-02
    age_seg_subtitle: "Distribución de cohortes y controles de anulación para el cumplimiento de OSA en el Reino Unido.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Distribución de cohortes",
    // google-translated 2026-06-02
    age_seg_refresh: "Refrescar",
    // google-translated 2026-06-02
    age_seg_adult: "Adulto",
    // google-translated 2026-06-02
    age_seg_minor: "Menor",
    // google-translated 2026-06-02
    age_seg_missing: "Cohorte faltante",
    // google-translated 2026-06-02
    age_seg_total: "Usuarios totales",
    // google-translated 2026-06-02
    age_seg_override_adult: "Anular → adulto",
    // google-translated 2026-06-02
    age_seg_override_minor: "Anular → menor",
    // google-translated 2026-06-02
    age_seg_override_heading: "Anulación de cohorte",
    // google-translated 2026-06-02
    age_seg_override_note: "Las anulaciones omiten la cohorte derivada de DOB. Solo permitido en cuentas de personal o administrador. Cada cambio se registra en una auditoría con el motivo proporcionado.",
    // google-translated 2026-06-02
    age_seg_target_label: "ID de usuario de destino",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Nueva cohorte",
    // google-translated 2026-06-02
    age_seg_pick: "- elegir -",
    // google-translated 2026-06-02
    age_seg_clear: "Borrar anulación",
    // google-translated 2026-06-02
    age_seg_reason_label: "Motivo (obligatorio, ≤500 caracteres)",
    // google-translated 2026-06-02
    age_seg_apply: "Aplicar anulación",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Confirmar anulación de cohorte",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Este cambio se registra en la auditoría y puede forzar una actualización del token en el usuario de destino. Revise los detalles antes de confirmar.",
    // google-translated 2026-06-02
    age_seg_cancel: "Cancelar",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Confirmar",
    // google-translated 2026-06-02
    subtab_identity: "Identidad",
    // google-translated 2026-06-02
    subtab_age_verification: "Verificación de edad",
    // google-translated 2026-06-02
    age_verif_panel_title: "Verificación de edad",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Revise la identificación gubernamental enviada por el usuario y decida. Aprobar confirma que el usuario es mayor de 18 años. El rechazo los mantiene menores de 18 años y les notifica. Si el ID muestra una fecha de nacimiento diferente, use Modificar-DOB para corregir el registro.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "No hay envío de verificación pendiente para este usuario.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Otras presentaciones pendientes en todo el sistema:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Saltar al siguiente pendiente",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "La imagen se destruye cuando se registra la decisión.",
    // google-translated 2026-06-02
    age_verif_field_method: "método de identificación:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "Fecha de nacimiento registrada:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Presentado en:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "ID de envío:",
    // google-translated 2026-06-02
    age_verif_match_question: "¿La identificación confirma la fecha de nacimiento registrada del usuario?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Sí, la fecha de nacimiento en el ID coincide con el valor registrado",
    // google-translated 2026-06-02
    age_verif_match_no: "No, la identificación muestra una fecha de nacimiento diferente",
    // google-translated 2026-06-02
    age_verif_approve_help: "Aprobar: confirma que el usuario es mayor de 18 años verificado. Rechazar: los mantiene por debajo de 18 y envía un MP al sistema con el motivo.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Aprobar (marcar verificado)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Rechazar en su lugar...",
    // google-translated 2026-06-02
    age_verif_reject_button: "Rechazar envío",
    // google-translated 2026-06-02
    age_verif_modify_help: "Actualice la fecha de nacimiento del usuario para que coincida con el valor que se muestra en la identificación. El usuario se desbloquea o se mantiene bloqueado automáticamente según la nueva era.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Fecha de nacimiento en el DNI:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Actualiza fecha de nacimiento y decide",
  },
  fr: {
    tab_users: 'Utilisateurs', tab_appeals: 'Appels', tab_reports: 'Signalements', tab_gifts: 'Cadeaux',
    tab_economy: 'Économie', tab_maintenance: 'Maintenance', tab_monitor: 'Moniteur de tours',
    tab_banners: 'Bannières', tab_funfacts: 'Anecdotes', tab_backups: 'Sauvegardes',
    tab_logs: 'Journaux', tab_devices: 'Appareils', tab_starting_screens: 'Écrans de démarrage',
    btn_sign_in: 'Se connecter', btn_sign_out: 'Se déconnecter',
    btn_search: 'Rechercher', placeholder_search_uid: 'Entrez l\'ID utilisateur',
    subtab_profile: 'Profil', subtab_moderation: 'Modération',
    subtab_security: 'Sécurité', subtab_economy: 'Économie',
    label_uid: 'UID', label_display_name: 'Nom affiché', label_user_type: 'Type',
    label_nationality: 'Nationalité', label_description: 'Description', label_email: 'E-mail',
    label_date_of_birth: 'Date de naissance', label_unique_id: 'ID unique',
    btn_suspend_user: 'Suspendre', btn_unsuspend_user: 'Réactiver',
    btn_warn: 'Avertir', btn_reset_device: 'Réinitialiser appareil',
    btn_reset_gcs: 'Réinitialiser GCS',
    label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans',
    label_super_shy: 'Super Shy', label_login_streak: 'Série de connexions',
    status_banned: 'BANNI', status_active: 'Actif', status_suspended: 'Suspendu',
    status_pending: 'En attente',
    filter_pending: 'En attente', filter_approved: 'Approuvé', filter_denied: 'Refusé',
    filter_resolved: 'Résolu', filter_archived: 'Archivé',
    btn_approve: 'Approuver', btn_deny: 'Refuser', btn_resolve: 'Résoudre',
    btn_save: 'Enregistrer', btn_cancel: 'Annuler', btn_delete: 'Supprimer', btn_apply: 'Appliquer',
    btn_refresh: 'Actualiser', btn_load_more: 'Charger plus',
    msg_loading: 'Chargement...', msg_no_data: 'Aucune donnée trouvée',
    msg_saved: 'Enregistré', msg_error: 'Erreur',
    label_log_level: 'Niveau', label_log_source: 'Source',
    btn_export_json: 'Exporter JSON', btn_export_csv: 'Exporter CSV',
    table_device_id: 'ID appareil', table_user: 'Utilisateur', table_model: 'Modèle',
    table_os: 'SE', table_last_ip: 'Dernière IP', table_isp: 'FAI',
    table_country: 'Pays', table_last_seen: 'Dernière vue',
    confirm_reset_pin_lockout: 'Réinitialiser le verrouillage PIN de cet utilisateur ?',
    confirm_unsuspend_user: 'Lever la suspension de cet utilisateur ? Son compte sera entièrement restauré.',
    confirm_reset_gcs: 'Réinitialiser le GCS de cet utilisateur à 100 et effacer tous les avertissements ?',
    confirm_schedule_deletion: 'Êtes-vous sûr de vouloir programmer la suppression de ce compte ?',
    alert_deletion_scheduled: 'Suppression du compte programmée.',
    confirm_cancel_deletion: 'Annuler la suppression de compte programmée ?',
    confirm_remove_all_device_bindings: 'Supprimer toutes les liaisons d\'appareils pour cet utilisateur ?',
    confirm_remove_device_ban: 'Supprimer ce bannissement d\'appareil ?',
    confirm_remove_network_ban: 'Supprimer ce bannissement réseau ?',
    confirm_unban_device: 'Débannir cet appareil ?',
    confirm_ban_all_devices: 'Bannir tous les appareils de cet utilisateur ?',
    confirm_remove_all_bans: 'Supprimer tous les bannissements de cet utilisateur ?',
    confirm_unsuspend_identity_graph: 'Lever la suspension du graphe d\'identité de cet utilisateur ?',
    alert_deletion_cancelled: 'Suppression du compte annulée.',
    confirm_clear_temp_id: 'Effacer l\'ID temporaire ?',
    confirm_revoke_warning: 'Révoquer cet avertissement ? +{deduction} GCS seront restaurés.',
    confirm_revoke_biometric: 'Révoquer la clé biométrique pour l\'appareil {deviceId} ?',
    confirm_issue_warning: 'Émettre un avertissement pour "{reason}" (gravité {severity}, -{deduction} GCS) ?',
    alert_schedule_deletion_failed: 'Échec de la programmation de la suppression : {error}',
    alert_cancel_deletion_failed: 'Échec de l\'annulation de la suppression : {error}',
    confirm_ban_ip: 'Bannir l\'IP {ip} ?',
    confirm_suspend_identity_graph: 'Suspendre le graphe d\'identité de cet utilisateur ({duration}, {scope}) ?',
    btn_searching: 'Recherche...',
    btn_email_show: 'Afficher',
    btn_email_hide: 'Masquer',
    btn_email_saving: 'Enregistrement…',
    btn_undo: 'Annuler',
    msg_no_warnings: 'Aucun avertissement',
    btn_revoke: 'Révoquer',
    toast_display_name_empty: 'Le nom affiché ne peut pas être vide',
    toast_undo_successful: 'Annulation réussie',
    toast_already_in_list: 'Déjà dans la liste',
    toast_autosave_failed: 'Échec de l\'enregistrement auto : {error}',
    toast_undo_failed: 'Échec de l\'annulation : {error}',
    status_suspended_badge: 'Suspendu depuis {since}, jusqu\'au {until}. Motif : {reason}',
    status_not_suspended: 'Non suspendu',
    status_deletion_scheduled: 'Suppression programmée — {days} jours restants ({date})',
    status_severity_gcs: 'Gravité {severity} (-{deduction} GCS)',
    msg_permanent: 'permanent',
    msg_no_reason_provided: 'Aucun motif fourni',
    msg_suspended_since_until_format: 'Suspendu depuis {since}, jusqu\'au {until}',
    inline_revoked: 'Révoqué',
    inline_warning_note: 'Note : {note}',
    inline_warning_meta: 'Par : {issuedBy} | GCS : {gcsBefore} → {gcsAfter}',
    toast_warning_revoked_gcs: 'Avertissement révoqué, +{deduction} GCS restaurés',
    toast_pin_lockout_reset: 'Verrouillage du PIN réinitialisé',
    toast_biometric_revoked: 'Clé biométrique révoquée',
    toast_gcs_reset_100: 'GCS réinitialisé à 100',
    toast_action_failed: 'Échec : {error}',
    btn_issuing: 'Émission en cours...',
    btn_issue_warning: 'Émettre un avertissement',
    btn_resetting: 'Réinitialisation...',
    toast_reason_required: 'Le motif est requis',
    toast_select_reason: 'Sélectionner un motif',
    toast_no_user_loaded: 'Aucun utilisateur chargé',
    toast_device_bindings_removed: '{count} liaison(s) d\'appareil supprimée(s)',
    btn_reset_device_binding: 'Réinitialiser la liaison de l\'appareil',
    toast_auto_escalate_5_warnings: 'Cet utilisateur a 5+ avertissements. Envisagez de le suspendre.',
    toast_no_ip_found: 'Aucune adresse IP trouvée',
    toast_banned_n_devices: '{count} appareil(s) banni(s)',
    toast_removed_n_bans: '{count} bannissement(s) supprimé(s)',
    toast_partial_retry: 'Partiel : {summary}. Veuillez réessayer l\'étape échouée.',
    toast_user_suspended: 'Utilisateur suspendu',
    toast_user_unsuspended: 'Suspension de l\'utilisateur levée',
    toast_warning_issued_successfully: 'Avertissement émis avec succès',
    toast_ip_banned: 'IP bannie',
    toast_identity_graph_suspended: 'Graphe d\'identité suspendu',
    toast_identity_graph_unsuspended: 'Suspension du graphe d\'identité levée',
    prompt_deletion_reason: 'Entrez le motif de la suppression du compte (facultatif) :',
    prompt_ban_reason: 'Motif (facultatif) :',
    bio_device_label: 'Appareil :',
    bio_registered_label: 'Enregistré :',
    segment_ban_call_failed: '{count}/{total} appel(s) de bannissement échoué(s) (premier : {error})',
    segment_pm_failed: '{count}/{total} MP échoués',
    toast_no_devices_to_ban: 'Aucun appareil à bannir',
    toast_enter_positive_amount: 'Saisissez un montant positif',
    toast_coins_added: '{amount} pièces ajoutées (maintenant {balance})',
    toast_coins_deducted: '{amount} pièces déduites (maintenant {balance})',
    toast_beans_added: '{amount} beans ajoutés (maintenant {balance})',
    toast_beans_deducted: '{amount} beans déduits (maintenant {balance})',
    toast_select_gift_qty: 'Sélectionnez un cadeau et saisissez une quantité',
    toast_gift_added: '{qty} ajoutés (total maintenant {total})',
    toast_backpack_empty_already: 'Le sac à dos est déjà vide',
    msg_loading_backpack: 'Chargement du sac à dos...',
    msg_backpack_empty: 'Le sac à dos est vide',
    msg_no_matching_gifts: 'Aucun cadeau correspondant',
    btn_confirm_clear_all: 'Confirmer tout effacer',
    btn_confirming: 'Confirmer ({countdown})',
    btn_clearing: 'Effacement...',
    toast_backpack_cleared: 'Sac à dos vidé ({count} objets supprimés)',
    toast_cleared_with_errors: '{cleared} effacés, {errors} échoués',
    toast_failed_to_save: 'Échec de l\'enregistrement : {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Suggestions",
    // google-translated 2026-06-02
    tab_audit_log: "Journal d'audit",
    // google-translated 2026-06-02
    tab_age_segregation: "Ségrégation par âge",
    // google-translated 2026-06-02
    age_seg_title: "Ségrégation par âge",
    // google-translated 2026-06-02
    age_seg_subtitle: "Répartition des cohortes et contrôles prioritaires pour la conformité au Royaume-Uni OSA.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Répartition des cohortes",
    // google-translated 2026-06-02
    age_seg_refresh: "Rafraîchir",
    // google-translated 2026-06-02
    age_seg_adult: "Adulte",
    // google-translated 2026-06-02
    age_seg_minor: "Mineure",
    // google-translated 2026-06-02
    age_seg_missing: "Cohorte manquante",
    // google-translated 2026-06-02
    age_seg_total: "Nombre total d'utilisateurs",
    // google-translated 2026-06-02
    age_seg_override_adult: "Remplacer → adulte",
    // google-translated 2026-06-02
    age_seg_override_minor: "Remplacer → mineur",
    // google-translated 2026-06-02
    age_seg_override_heading: "Remplacement de cohorte",
    // google-translated 2026-06-02
    age_seg_override_note: "Les remplacements contournent la cohorte dérivée de la date de naissance. Autorisé uniquement sur les comptes du personnel ou de l'administrateur. Chaque modification est enregistrée dans un journal d'audit avec la raison fournie.",
    // google-translated 2026-06-02
    age_seg_target_label: "ID utilisateur cible",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Nouvelle cohorte",
    // google-translated 2026-06-02
    age_seg_pick: "- prendre -",
    // google-translated 2026-06-02
    age_seg_clear: "Effacer le remplacement",
    // google-translated 2026-06-02
    age_seg_reason_label: "Raison (obligatoire, ≤500 caractères)",
    // google-translated 2026-06-02
    age_seg_apply: "Appliquer le remplacement",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Confirmer le remplacement de la cohorte",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Cette modification est consignée dans un journal d'audit et peut forcer une actualisation du jeton sur l'utilisateur cible. Vérifiez les détails avant de confirmer.",
    // google-translated 2026-06-02
    age_seg_cancel: "Annuler",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Confirmer",
    // google-translated 2026-06-02
    subtab_identity: "Identité",
    // google-translated 2026-06-02
    subtab_age_verification: "Vérification de l'âge",
    // google-translated 2026-06-02
    age_verif_panel_title: "Vérification de l'âge",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Examinez la pièce d'identité gouvernementale soumise par l'utilisateur et décidez. Approuver confirme que l’utilisateur a 18 ans et plus. Reject les maintient en dessous de 18 ans et les informe. Si l'ID indique une date de naissance différente, utilisez Modifier-DOB pour corriger l'enregistrement.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Aucune soumission de vérification en attente pour cet utilisateur.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Autres soumissions en attente dans le système :",
    // google-translated 2026-06-02
    age_verif_jump_next: "Passer au suivant en attente",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "L'image est détruite lorsque la décision est enregistrée.",
    // google-translated 2026-06-02
    age_verif_field_method: "Méthode d'identification :",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "Date de naissance enregistrée :",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Soumis à :",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "ID de soumission :",
    // google-translated 2026-06-02
    age_verif_match_question: "La pièce d'identité confirme-t-elle la date de naissance enregistrée de l'utilisateur ?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Oui - DOB sur l'ID correspond à la valeur enregistrée",
    // google-translated 2026-06-02
    age_verif_match_no: "Non : l'ID indique une date de naissance différente",
    // google-translated 2026-06-02
    age_verif_approve_help: "Approuver : confirme que l'utilisateur est âgé de 18 + vérifié. Rejeter : les maintient en dessous de 18 ans et envoie un MP système avec la raison.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Approuver (marquer vérifié)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Rejetez plutôt…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Rejeter la soumission",
    // google-translated 2026-06-02
    age_verif_modify_help: "Mettez à jour la date de naissance de l'utilisateur pour qu'elle corresponde à la valeur indiquée sur l'ID. L'utilisateur est déverrouillé ou maintenu verrouillé automatiquement en fonction du nouvel âge.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Date de naissance sur la pièce d'identité :",
    // google-translated 2026-06-02
    age_verif_modify_button: "Mettre à jour la date de naissance et décider",
  },
  hi: {
    tab_users: '\u0909\u092A\u092F\u094B\u0917\u0915\u0930\u094D\u0924\u093E', tab_appeals: '\u0905\u092A\u0940\u0932', tab_reports: '\u0930\u093F\u092A\u094B\u0930\u094D\u091F', tab_gifts: '\u0909\u092A\u0939\u093E\u0930',
    tab_economy: '\u0905\u0930\u094D\u0925\u0935\u094D\u092F\u0935\u0938\u094D\u0925\u093E', tab_maintenance: '\u0930\u0916\u0930\u0916\u093E\u0935', tab_monitor: '\u0938\u094D\u092A\u093F\u0928 \u092E\u0949\u0928\u093F\u091F\u0930',
    tab_banners: '\u092C\u0948\u0928\u0930', tab_funfacts: '\u0930\u094B\u091A\u0915 \u0924\u0925\u094D\u092F', tab_backups: '\u092C\u0948\u0915\u0905\u092A',
    tab_logs: '\u0932\u0949\u0917', tab_devices: '\u0921\u093F\u0935\u093E\u0907\u0938', tab_starting_screens: '\u0938\u094D\u091F\u093E\u0930\u094D\u091F \u0938\u094D\u0915\u094D\u0930\u0940\u0928',
    btn_sign_in: '\u0938\u093E\u0907\u0928 \u0907\u0928', btn_sign_out: '\u0938\u093E\u0907\u0928 \u0906\u0909\u091F',
    btn_search: '\u0916\u094B\u091C\u0947\u0902', placeholder_search_uid: '\u0909\u092A\u092F\u094B\u0917\u0915\u0930\u094D\u0924\u093E ID \u0926\u0930\u094D\u091C \u0915\u0930\u0947\u0902',
    subtab_profile: '\u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932', subtab_moderation: '\u0938\u0902\u091A\u093E\u0932\u0928',
    subtab_security: '\u0938\u0941\u0930\u0915\u094D\u0937\u093E', subtab_economy: '\u0905\u0930\u094D\u0925\u0935\u094D\u092F\u0935\u0938\u094D\u0925\u093E',
    label_uid: 'UID', label_display_name: '\u092A\u094D\u0930\u0926\u0930\u094D\u0936\u0928 \u0928\u093E\u092E', label_user_type: '\u092A\u094D\u0930\u0915\u093E\u0930',
    label_nationality: '\u0930\u093E\u0937\u094D\u091F\u094D\u0930\u0940\u092F\u0924\u093E', label_description: '\u0935\u093F\u0935\u0930\u0923', label_email: '\u0908\u092E\u0947\u0932',
    label_date_of_birth: '\u091C\u0928\u094D\u092E \u0924\u093F\u0925\u093F', label_unique_id: '\u0905\u0926\u094D\u0935\u093F\u0924\u0940\u092F ID',
    btn_suspend_user: '\u0928\u093F\u0932\u0902\u092C\u093F\u0924 \u0915\u0930\u0947\u0902', btn_unsuspend_user: '\u092C\u0939\u093E\u0932 \u0915\u0930\u0947\u0902',
    btn_warn: '\u091A\u0947\u0924\u093E\u0935\u0928\u0940 \u0926\u0947\u0902', btn_reset_device: '\u0921\u093F\u0935\u093E\u0907\u0938 \u0930\u0940\u0938\u0947\u091F',
    btn_reset_gcs: 'GCS \u0930\u0940\u0938\u0947\u091F',
    label_shy_coins: 'Shy \u0938\u093F\u0915\u094D\u0915\u0947', label_shy_beans: 'Shy \u092C\u0940\u0928\u094D\u0938',
    label_super_shy: '\u0938\u0941\u092A\u0930 \u0936\u093E\u0908', label_login_streak: '\u0932\u0949\u0917\u093F\u0928 \u0938\u094D\u091F\u094D\u0930\u0940\u0915',
    status_banned: '\u092A\u094D\u0930\u0924\u093F\u092C\u0902\u0927\u093F\u0924', status_active: '\u0938\u0915\u094D\u0930\u093F\u092F', status_suspended: '\u0928\u093F\u0932\u0902\u092C\u093F\u0924',
    status_pending: '\u0932\u0902\u092C\u093F\u0924',
    filter_pending: '\u0932\u0902\u092C\u093F\u0924', filter_approved: '\u0938\u094D\u0935\u0940\u0915\u0943\u0924', filter_denied: '\u0905\u0938\u094D\u0935\u0940\u0915\u0943\u0924',
    filter_resolved: '\u0939\u0932', filter_archived: '\u0938\u0902\u0917\u094D\u0930\u0939\u093F\u0924',
    btn_approve: '\u0938\u094D\u0935\u0940\u0915\u0943\u0924', btn_deny: '\u0905\u0938\u094D\u0935\u0940\u0915\u0943\u0924', btn_resolve: '\u0939\u0932',
    btn_save: '\u0938\u0939\u0947\u091C\u0947\u0902', btn_cancel: '\u0930\u0926\u094D\u0926 \u0915\u0930\u0947\u0902', btn_delete: '\u0939\u091F\u093E\u090F\u0902', btn_apply: '\u0932\u093E\u0917\u0942 \u0915\u0930\u0947\u0902',
    btn_refresh: '\u0924\u093E\u091C\u093C\u093E \u0915\u0930\u0947\u0902', btn_load_more: '\u0914\u0930 \u0932\u094B\u0921 \u0915\u0930\u0947\u0902',
    msg_loading: '\u0932\u094B\u0921 \u0939\u094B \u0930\u0939\u093E \u0939\u0948...', msg_no_data: '\u0915\u094B\u0908 \u0921\u0947\u091F\u093E \u0928\u0939\u0940\u0902 \u092E\u093F\u0932\u093E',
    msg_saved: '\u0938\u0939\u0947\u091C\u093E \u0917\u092F\u093E', msg_error: '\u0924\u094D\u0930\u0941\u091F\u093F',
    label_log_level: '\u0938\u094D\u0924\u0930', label_log_source: '\u0938\u094D\u0930\u094B\u0924',
    btn_export_json: 'JSON \u0928\u093F\u0930\u094D\u092F\u093E\u0924', btn_export_csv: 'CSV \u0928\u093F\u0930\u094D\u092F\u093E\u0924',
    table_device_id: '\u0921\u093F\u0935\u093E\u0907\u0938 ID', table_user: '\u0909\u092A\u092F\u094B\u0917\u0915\u0930\u094D\u0924\u093E', table_model: '\u092E\u0949\u0921\u0932',
    table_os: 'OS', table_last_ip: '\u0905\u0902\u0924\u093F\u092E IP', table_isp: 'ISP',
    table_country: '\u0926\u0947\u0936', table_last_seen: '\u0905\u0902\u0924\u093F\u092E \u0926\u0947\u0916\u093E',
    confirm_reset_pin_lockout: 'इस उपयोगकर्ता के लिए PIN लॉकआउट रीसेट करें?',
    confirm_unsuspend_user: 'इस उपयोगकर्ता को निलंबन हटाएं? उनका खाता पूरी तरह बहाल हो जाएगा।',
    confirm_reset_gcs: 'इस उपयोगकर्ता का GCS 100 पर रीसेट करें और सभी चेतावनियाँ साफ़ करें?',
    confirm_schedule_deletion: 'क्या आप वाकई इस खाते को हटाने के लिए शेड्यूल करना चाहते हैं?',
    alert_deletion_scheduled: 'खाता हटाने का शेड्यूल किया गया।',
    confirm_cancel_deletion: 'अनुसूचित खाता हटाने को रद्द करें?',
    confirm_remove_all_device_bindings: 'इस उपयोगकर्ता के लिए सभी डिवाइस बाइंडिंग हटाएं?',
    confirm_remove_device_ban: 'इस डिवाइस प्रतिबंध को हटाएं?',
    confirm_remove_network_ban: 'इस नेटवर्क प्रतिबंध को हटाएं?',
    confirm_unban_device: 'इस डिवाइस से प्रतिबंध हटाएं?',
    confirm_ban_all_devices: 'इस उपयोगकर्ता के सभी डिवाइस प्रतिबंधित करें?',
    confirm_remove_all_bans: 'इस उपयोगकर्ता के सभी प्रतिबंध हटाएं?',
    confirm_unsuspend_identity_graph: 'इस उपयोगकर्ता का पहचान ग्राफ़ निलंबन हटाएं?',
    alert_deletion_cancelled: 'खाता हटाना रद्द किया गया।',
    confirm_clear_temp_id: 'अस्थायी ID साफ़ करें?',
    confirm_revoke_warning: 'इस चेतावनी को निरस्त करें? +{deduction} GCS पुनर्स्थापित होंगे।',
    confirm_revoke_biometric: 'डिवाइस {deviceId} के लिए बायोमेट्रिक कुंजी निरस्त करें?',
    confirm_issue_warning: '"{reason}" के लिए चेतावनी जारी करें (गंभीरता {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: 'हटाने की शेड्यूल विफल: {error}',
    alert_cancel_deletion_failed: 'हटाना रद्द करना विफल: {error}',
    confirm_ban_ip: 'IP {ip} प्रतिबंधित करें?',
    confirm_suspend_identity_graph: 'इस उपयोगकर्ता के लिए पहचान ग्राफ निलंबित करें ({duration}, {scope})?',
    btn_searching: 'खोज रहे हैं...',
    btn_email_show: 'दिखाएं',
    btn_email_hide: 'छिपाएं',
    btn_email_saving: 'सहेज रहे हैं…',
    btn_undo: 'वापस लें',
    msg_no_warnings: 'कोई चेतावनी नहीं',
    btn_revoke: 'निरस्त करें',
    toast_display_name_empty: 'प्रदर्शन नाम खाली नहीं हो सकता',
    toast_undo_successful: 'वापस लिया सफलतापूर्वक',
    toast_already_in_list: 'पहले से सूची में',
    toast_autosave_failed: 'ऑटो-सेव विफल: {error}',
    toast_undo_failed: 'वापस लेना विफल: {error}',
    status_suspended_badge: '{since} से निलंबित, {until} तक। कारण: {reason}',
    status_not_suspended: 'निलंबित नहीं',
    status_deletion_scheduled: 'हटाना शेड्यूल किया गया — {days} दिन शेष ({date})',
    status_severity_gcs: 'गंभीरता {severity} (-{deduction} GCS)',
    msg_permanent: 'स्थायी',
    msg_no_reason_provided: 'कोई कारण नहीं दिया गया',
    msg_suspended_since_until_format: '{since} से निलंबित, {until} तक',
    inline_revoked: 'रद्द किया गया',
    inline_warning_note: 'नोट: {note}',
    inline_warning_meta: 'द्वारा: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}',
    toast_warning_revoked_gcs: 'चेतावनी रद्द की गई, +{deduction} GCS पुनः जोड़ा गया',
    toast_pin_lockout_reset: 'PIN लॉकआउट रीसेट किया गया',
    toast_biometric_revoked: 'बायोमेट्रिक कुंजी रद्द की गई',
    toast_gcs_reset_100: 'GCS को 100 पर रीसेट किया गया',
    toast_action_failed: 'विफल: {error}',
    btn_issuing: 'जारी किया जा रहा है...',
    btn_issue_warning: 'चेतावनी जारी करें',
    btn_resetting: 'रीसेट किया जा रहा है...',
    toast_reason_required: 'कारण आवश्यक है',
    toast_select_reason: 'एक कारण चुनें',
    toast_no_user_loaded: 'कोई उपयोगकर्ता लोड नहीं हुआ',
    toast_device_bindings_removed: '{count} डिवाइस बाइंडिंग हटाई गई',
    btn_reset_device_binding: 'डिवाइस बाइंडिंग रीसेट करें',
    toast_auto_escalate_5_warnings: 'इस उपयोगकर्ता को 5+ चेतावनियाँ मिल चुकी हैं। निलंबन पर विचार करें।',
    toast_no_ip_found: 'कोई IP पता नहीं मिला',
    toast_banned_n_devices: '{count} डिवाइस को बैन किया',
    toast_removed_n_bans: '{count} बैन हटाए गए',
    toast_partial_retry: 'आंशिक: {summary}। कृपया विफल चरण को पुनः आज़माएँ।',
    toast_user_suspended: 'उपयोगकर्ता निलंबित',
    toast_user_unsuspended: 'उपयोगकर्ता का निलंबन हटाया',
    toast_warning_issued_successfully: 'चेतावनी सफलतापूर्वक जारी की गई',
    toast_ip_banned: 'IP बैन किया गया',
    toast_identity_graph_suspended: 'पहचान ग्राफ निलंबित',
    toast_identity_graph_unsuspended: 'पहचान ग्राफ का निलंबन हटाया',
    prompt_deletion_reason: 'खाता हटाने का कारण दर्ज करें (वैकल्पिक):',
    prompt_ban_reason: 'कारण (वैकल्पिक):',
    bio_device_label: 'डिवाइस:',
    bio_registered_label: 'पंजीकृत:',
    segment_ban_call_failed: '{count}/{total} बैन कॉल विफल (पहली: {error})',
    segment_pm_failed: '{count}/{total} निजी संदेश विफल',
    toast_no_devices_to_ban: 'बैन करने के लिए कोई डिवाइस नहीं',
    toast_enter_positive_amount: 'एक धनात्मक राशि दर्ज करें',
    toast_coins_added: '{amount} सिक्के जोड़े गए (अब {balance})',
    toast_coins_deducted: '{amount} सिक्के घटाए गए (अब {balance})',
    toast_beans_added: '{amount} बीन्स जोड़े गए (अब {balance})',
    toast_beans_deducted: '{amount} बीन्स घटाए गए (अब {balance})',
    toast_select_gift_qty: 'एक उपहार चुनें और मात्रा दर्ज करें',
    toast_gift_added: '{qty} जोड़े गए (कुल अब {total})',
    toast_backpack_empty_already: 'बैकपैक पहले से ही खाली है',
    msg_loading_backpack: 'बैकपैक लोड हो रहा है...',
    msg_backpack_empty: 'बैकपैक खाली है',
    msg_no_matching_gifts: 'कोई मेल खाने वाले उपहार नहीं',
    btn_confirm_clear_all: 'सभी साफ़ करें की पुष्टि करें',
    btn_confirming: 'पुष्टि करें ({countdown})',
    btn_clearing: 'साफ़ किया जा रहा है...',
    toast_backpack_cleared: 'बैकपैक साफ़ ({count} आइटम हटाए गए)',
    toast_cleared_with_errors: '{cleared} साफ़ किए, {errors} विफल',
    toast_failed_to_save: 'सहेजने में विफल: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "सुझाव",
    // google-translated 2026-06-02
    tab_audit_log: "ऑडिट लॉग",
    // google-translated 2026-06-02
    tab_age_segregation: "आयु पृथक्करण",
    // google-translated 2026-06-02
    age_seg_title: "आयु पृथक्करण",
    // google-translated 2026-06-02
    age_seg_subtitle: "यूके ओएसए अनुपालन के लिए समूह वितरण और ओवरराइड नियंत्रण।",
    // google-translated 2026-06-02
    age_seg_stats_heading: "समूह वितरण",
    // google-translated 2026-06-02
    age_seg_refresh: "ताज़ा करना",
    // google-translated 2026-06-02
    age_seg_adult: "वयस्क",
    // google-translated 2026-06-02
    age_seg_minor: "नाबालिग",
    // google-translated 2026-06-02
    age_seg_missing: "लापता दल",
    // google-translated 2026-06-02
    age_seg_total: "कुल उपयोगकर्ता",
    // google-translated 2026-06-02
    age_seg_override_adult: "ओवरराइड → वयस्क",
    // override-translated 2026-06-02
    age_seg_override_minor: "ओवरराइड → नाबालिग",
    // google-translated 2026-06-02
    age_seg_override_heading: "समूह ओवरराइड",
    // google-translated 2026-06-02
    age_seg_override_note: "ओवरराइड्स जन्मतिथि-व्युत्पन्न समूह को बायपास करता है। केवल स्टाफ़ या व्यवस्थापक खातों पर अनुमति है। प्रत्येक परिवर्तन को दिए गए कारण के साथ ऑडिट-लॉग किया जाता है।",
    // google-translated 2026-06-02
    age_seg_target_label: "लक्ष्य उपयोगकर्ता आईडी",
    // google-translated 2026-06-02
    age_seg_override_value_label: "नया दल",
    // google-translated 2026-06-02
    age_seg_pick: "- चुनना -",
    // google-translated 2026-06-02
    age_seg_clear: "स्पष्ट ओवरराइड",
    // google-translated 2026-06-02
    age_seg_reason_label: "कारण (आवश्यक, ≤500 वर्ण)",
    // google-translated 2026-06-02
    age_seg_apply: "ओवरराइड लागू करें",
    // google-translated 2026-06-02
    age_seg_confirm_title: "समूह ओवरराइड की पुष्टि करें",
    // google-translated 2026-06-02
    age_seg_confirm_body: "यह परिवर्तन ऑडिट-लॉग किया गया है और लक्षित उपयोगकर्ता पर टोकन रीफ्रेश को बाध्य कर सकता है। पुष्टि करने से पहले विवरण की समीक्षा करें.",
    // google-translated 2026-06-02
    age_seg_cancel: "रद्द करना",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "पुष्टि करना",
    // google-translated 2026-06-02
    subtab_identity: "पहचान",
    // google-translated 2026-06-02
    subtab_age_verification: "आयु सत्यापन",
    // google-translated 2026-06-02
    age_verif_panel_title: "आयु सत्यापन",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "उपयोगकर्ता की सबमिट की गई सरकारी आईडी की समीक्षा करें और निर्णय लें। Approve पुष्टि करता है कि उपयोगकर्ता 18+ है। अस्वीकार उन्हें उप-18 रखता है और उन्हें सूचित करता है। यदि आईडी एक अलग जन्मतिथि दिखाती है, तो रिकॉर्ड को सही करने के लिए Modify-DOB का उपयोग करें।",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "इस उपयोगकर्ता के लिए कोई सत्यापन सबमिशन लंबित नहीं है।",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "पूरे सिस्टम में अन्य लंबित प्रस्तुतियाँ:",
    // google-translated 2026-06-02
    age_verif_jump_next: "अगले लंबित पर जाएँ",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "निर्णय दर्ज होने पर छवि नष्ट हो जाती है।",
    // google-translated 2026-06-02
    age_verif_field_method: "आईडी विधि:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "रिकॉर्ड की गई जन्मतिथि:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "यहां प्रस्तुत किया गया:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "सबमिशन आईडी:",
    // google-translated 2026-06-02
    age_verif_match_question: "क्या आईडी उपयोगकर्ता की दर्ज की गई जन्मतिथि की पुष्टि करती है?",
    // google-translated 2026-06-02
    age_verif_match_yes: "हाँ - आईडी पर जन्मतिथि दर्ज मूल्य से मेल खाती है",
    // google-translated 2026-06-02
    age_verif_match_no: "नहीं - आईडी एक अलग जन्म तिथि दिखाती है",
    // google-translated 2026-06-02
    age_verif_approve_help: "स्वीकृत करें: उपयोगकर्ता को 18+ सत्यापित के रूप में पुष्टि करता है। अस्वीकार करें: उन्हें 18 से कम रखता है और कारण सहित एक सिस्टम पीएम भेजता है।",
    // google-translated 2026-06-02
    age_verif_approve_button: "स्वीकृत (सत्यापित चिह्न)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "इसके बजाय अस्वीकार करें...",
    // google-translated 2026-06-02
    age_verif_reject_button: "सबमिशन अस्वीकार करें",
    // google-translated 2026-06-02
    age_verif_modify_help: "आईडी पर दिखाए गए मान से मिलान करने के लिए उपयोगकर्ता की जन्मतिथि को अपडेट करें। नई आयु के आधार पर उपयोगकर्ता को स्वचालित रूप से अनलॉक या लॉक रखा जाता है।",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "आईडी पर जन्मतिथि:",
    // google-translated 2026-06-02
    age_verif_modify_button: "जन्मतिथि अद्यतन करें और निर्णय लें",
  },
  id: {
    tab_users: 'Pengguna', tab_appeals: 'Banding', tab_reports: 'Laporan', tab_gifts: 'Hadiah',
    tab_economy: 'Ekonomi', tab_maintenance: 'Pemeliharaan', tab_monitor: 'Monitor Putaran',
    tab_banners: 'Banner', tab_funfacts: 'Fakta Menarik', tab_backups: 'Cadangan',
    tab_logs: 'Log', tab_devices: 'Perangkat', tab_starting_screens: 'Layar Awal',
    btn_sign_in: 'Masuk', btn_sign_out: 'Keluar',
    btn_search: 'Cari', placeholder_search_uid: 'Masukkan ID Pengguna',
    subtab_profile: 'Profil', subtab_moderation: 'Moderasi',
    subtab_security: 'Keamanan', subtab_economy: 'Ekonomi',
    label_uid: 'UID', label_display_name: 'Nama Tampilan', label_user_type: 'Tipe',
    label_nationality: 'Kebangsaan', label_description: 'Deskripsi', label_email: 'Email',
    label_date_of_birth: 'Tanggal Lahir', label_unique_id: 'ID Unik',
    btn_suspend_user: 'Tangguhkan', btn_unsuspend_user: 'Aktifkan',
    btn_warn: 'Beri Peringatan', btn_reset_device: 'Reset Perangkat', btn_reset_gcs: 'Reset GCS',
    label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans',
    label_super_shy: 'Super Shy', label_login_streak: 'Seri Login',
    status_banned: 'DIBLOKIR', status_active: 'Aktif', status_suspended: 'Ditangguhkan', status_pending: 'Tertunda',
    filter_pending: 'Tertunda', filter_approved: 'Disetujui', filter_denied: 'Ditolak',
    filter_resolved: 'Diselesaikan', filter_archived: 'Diarsipkan',
    btn_approve: 'Setujui', btn_deny: 'Tolak', btn_resolve: 'Selesaikan',
    btn_save: 'Simpan', btn_cancel: 'Batal', btn_delete: 'Hapus', btn_apply: 'Terapkan',
    btn_refresh: 'Segarkan', btn_load_more: 'Muat lebih',
    msg_loading: 'Memuat...', msg_no_data: 'Data tidak ditemukan',
    msg_saved: 'Disimpan', msg_error: 'Kesalahan',
    label_log_level: 'Level', label_log_source: 'Sumber',
    btn_export_json: 'Ekspor JSON', btn_export_csv: 'Ekspor CSV',
    table_device_id: 'ID Perangkat', table_user: 'Pengguna', table_model: 'Model',
    table_os: 'OS', table_last_ip: 'IP Terakhir', table_isp: 'ISP',
    table_country: 'Negara', table_last_seen: 'Terakhir Dilihat',
    confirm_reset_pin_lockout: 'Reset penguncian PIN untuk pengguna ini?',
    confirm_unsuspend_user: 'Cabut penangguhan pengguna ini? Akunnya akan dipulihkan sepenuhnya.',
    confirm_reset_gcs: 'Reset GCS pengguna ini ke 100 dan hapus semua peringatan?',
    confirm_schedule_deletion: 'Anda yakin ingin menjadwalkan penghapusan akun ini?',
    alert_deletion_scheduled: 'Penghapusan akun dijadwalkan.',
    confirm_cancel_deletion: 'Batalkan penghapusan akun terjadwal?',
    confirm_remove_all_device_bindings: 'Hapus semua keterikatan perangkat untuk pengguna ini?',
    confirm_remove_device_ban: 'Hapus larangan perangkat ini?',
    confirm_remove_network_ban: 'Hapus larangan jaringan ini?',
    confirm_unban_device: 'Buka blokir perangkat ini?',
    confirm_ban_all_devices: 'Blokir semua perangkat pengguna ini?',
    confirm_remove_all_bans: 'Hapus semua larangan untuk pengguna ini?',
    confirm_unsuspend_identity_graph: 'Cabut penangguhan grafik identitas untuk pengguna ini?',
    alert_deletion_cancelled: 'Penghapusan akun dibatalkan.',
    confirm_clear_temp_id: 'Hapus ID sementara?',
    confirm_revoke_warning: 'Cabut peringatan ini? +{deduction} GCS akan dipulihkan.',
    confirm_revoke_biometric: 'Cabut kunci biometrik untuk perangkat {deviceId}?',
    confirm_issue_warning: 'Terbitkan peringatan untuk "{reason}" (tingkat {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: 'Gagal menjadwalkan penghapusan: {error}',
    alert_cancel_deletion_failed: 'Gagal membatalkan penghapusan: {error}',
    confirm_ban_ip: 'Blokir IP {ip}?',
    confirm_suspend_identity_graph: 'Tangguhkan grafik identitas untuk pengguna ini ({duration}, {scope})?',
    btn_searching: 'Mencari...',
    btn_email_show: 'Tampilkan',
    btn_email_hide: 'Sembunyikan',
    btn_email_saving: 'Menyimpan…',
    btn_undo: 'Urungkan',
    msg_no_warnings: 'Tidak ada peringatan',
    btn_revoke: 'Cabut',
    toast_display_name_empty: 'Nama tampilan tidak boleh kosong',
    toast_undo_successful: 'Urungkan berhasil',
    toast_already_in_list: 'Sudah ada dalam daftar',
    toast_autosave_failed: 'Penyimpanan otomatis gagal: {error}',
    toast_undo_failed: 'Urungkan gagal: {error}',
    status_suspended_badge: 'Ditangguhkan sejak {since}, hingga {until}. Alasan: {reason}',
    status_not_suspended: 'Tidak ditangguhkan',
    status_deletion_scheduled: 'Penghapusan dijadwalkan — {days} hari tersisa ({date})',
    status_severity_gcs: 'Tingkat {severity} (-{deduction} GCS)',
    msg_permanent: 'permanen',
    msg_no_reason_provided: 'Tidak ada alasan',
    msg_suspended_since_until_format: 'Ditangguhkan sejak {since}, hingga {until}',
    inline_revoked: 'Dicabut',
    inline_warning_note: 'Catatan: {note}',
    inline_warning_meta: 'Oleh: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}',
    toast_warning_revoked_gcs: 'Peringatan dicabut, +{deduction} GCS dipulihkan',
    toast_pin_lockout_reset: 'Kunci PIN diatur ulang',
    toast_biometric_revoked: 'Kunci biometrik dicabut',
    toast_gcs_reset_100: 'GCS diatur ulang ke 100',
    toast_action_failed: 'Gagal: {error}',
    btn_issuing: 'Menerbitkan...',
    btn_issue_warning: 'Terbitkan Peringatan',
    btn_resetting: 'Mengatur ulang...',
    toast_reason_required: 'Alasan diperlukan',
    toast_select_reason: 'Pilih alasan',
    toast_no_user_loaded: 'Tidak ada pengguna dimuat',
    toast_device_bindings_removed: 'Menghapus {count} pengikatan perangkat',
    btn_reset_device_binding: 'Atur Ulang Pengikatan Perangkat',
    toast_auto_escalate_5_warnings: 'Pengguna ini memiliki 5+ peringatan. Pertimbangkan untuk menangguhkan.',
    toast_no_ip_found: 'Alamat IP tidak ditemukan',
    toast_banned_n_devices: 'Memblokir {count} perangkat',
    toast_removed_n_bans: 'Menghapus {count} larangan',
    toast_partial_retry: 'Sebagian: {summary}. Silakan coba ulang langkah yang gagal.',
    toast_user_suspended: 'Pengguna ditangguhkan',
    toast_user_unsuspended: 'Penangguhan pengguna dicabut',
    toast_warning_issued_successfully: 'Peringatan berhasil diterbitkan',
    toast_ip_banned: 'IP diblokir',
    toast_identity_graph_suspended: 'Grafik identitas ditangguhkan',
    toast_identity_graph_unsuspended: 'Penangguhan grafik identitas dicabut',
    prompt_deletion_reason: 'Masukkan alasan penghapusan akun (opsional):',
    prompt_ban_reason: 'Alasan (opsional):',
    bio_device_label: 'Perangkat:',
    bio_registered_label: 'Terdaftar:',
    segment_ban_call_failed: '{count}/{total} panggilan ban gagal (pertama: {error})',
    segment_pm_failed: '{count}/{total} PM gagal',
    toast_no_devices_to_ban: 'Tidak ada perangkat untuk diblokir',
    toast_enter_positive_amount: 'Masukkan jumlah positif',
    toast_coins_added: 'Menambahkan {amount} koin (sekarang {balance})',
    toast_coins_deducted: 'Mengurangi {amount} koin (sekarang {balance})',
    toast_beans_added: 'Menambahkan {amount} beans (sekarang {balance})',
    toast_beans_deducted: 'Mengurangi {amount} beans (sekarang {balance})',
    toast_select_gift_qty: 'Pilih hadiah dan masukkan jumlah',
    toast_gift_added: 'Menambahkan {qty} (total sekarang {total})',
    toast_backpack_empty_already: 'Tas ransel sudah kosong',
    msg_loading_backpack: 'Memuat tas ransel...',
    msg_backpack_empty: 'Tas ransel kosong',
    msg_no_matching_gifts: 'Tidak ada hadiah yang cocok',
    btn_confirm_clear_all: 'Konfirmasi Hapus Semua',
    btn_confirming: 'Konfirmasi ({countdown})',
    btn_clearing: 'Menghapus...',
    toast_backpack_cleared: 'Tas ransel dikosongkan ({count} item dihapus)',
    toast_cleared_with_errors: 'Dihapus {cleared}, gagal {errors}',
    toast_failed_to_save: 'Gagal menyimpan: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Saran",
    // google-translated 2026-06-02
    tab_audit_log: "Catatan Audit",
    // google-translated 2026-06-02
    tab_age_segregation: "Pemisahan Usia",
    // google-translated 2026-06-02
    age_seg_title: "Pemisahan Usia",
    // google-translated 2026-06-02
    age_seg_subtitle: "Distribusi kelompok dan kontrol penggantian untuk kepatuhan OSA Inggris.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Distribusi Kelompok",
    // google-translated 2026-06-02
    age_seg_refresh: "Menyegarkan",
    // google-translated 2026-06-02
    age_seg_adult: "Dewasa",
    // override-translated 2026-06-02
    age_seg_minor: "Di bawah umur",
    // google-translated 2026-06-02
    age_seg_missing: "Kelompok tidak ada",
    // google-translated 2026-06-02
    age_seg_total: "Jumlah pengguna",
    // google-translated 2026-06-02
    age_seg_override_adult: "Timpa → dewasa",
    // override-translated 2026-06-02
    age_seg_override_minor: "Timpa → di bawah umur",
    // google-translated 2026-06-02
    age_seg_override_heading: "Penggantian Kelompok",
    // google-translated 2026-06-02
    age_seg_override_note: "Penggantian melewati kelompok turunan DOB. Hanya diperbolehkan pada akun staf atau admin. Setiap perubahan dicatat secara audit dengan alasan yang diberikan.",
    // google-translated 2026-06-02
    age_seg_target_label: "ID pengguna target",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Kelompok baru",
    // google-translated 2026-06-02
    age_seg_pick: "- memilih -",
    // google-translated 2026-06-02
    age_seg_clear: "Hapus penggantian",
    // google-translated 2026-06-02
    age_seg_reason_label: "Alasan (wajib, ≤500 karakter)",
    // google-translated 2026-06-02
    age_seg_apply: "Terapkan Penggantian",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Konfirmasikan penggantian kelompok",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Perubahan ini dicatat dalam log audit dan mungkin memaksa penyegaran token pada pengguna target. Tinjau detailnya sebelum mengonfirmasi.",
    // google-translated 2026-06-02
    age_seg_cancel: "Membatalkan",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Mengonfirmasi",
    // google-translated 2026-06-02
    subtab_identity: "Identitas",
    // google-translated 2026-06-02
    subtab_age_verification: "Verifikasi Usia",
    // google-translated 2026-06-02
    age_verif_panel_title: "Verifikasi Usia",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Tinjau tanda pengenal pemerintah yang dikirimkan pengguna dan putuskan. Setujui mengonfirmasi bahwa pengguna berusia 18+. Tolak membuat mereka tetap di bawah 18 dan memberi tahu mereka. Jika ID menunjukkan DOB yang berbeda, gunakan Modify-DOB untuk memperbaiki catatan.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Tidak ada pengiriman verifikasi yang tertunda untuk pengguna ini.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Pengiriman lain yang tertunda di seluruh sistem:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Lompat ke berikutnya yang tertunda",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "Gambar hancur ketika keputusan direkam.",
    // google-translated 2026-06-02
    age_verif_field_method: "Metode ID:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "DOB yang tercatat:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Dikirim pada:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "ID Pengiriman:",
    // google-translated 2026-06-02
    age_verif_match_question: "Apakah ID mengonfirmasi tanggal lahir pengguna yang tercatat?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Ya — DOB pada ID cocok dengan nilai yang tercatat",
    // google-translated 2026-06-02
    age_verif_match_no: "Tidak — ID menunjukkan DOB yang berbeda",
    // google-translated 2026-06-02
    age_verif_approve_help: "Setujui: mengonfirmasi pengguna berusia 18+ terverifikasi. Tolak: simpan di bawah 18 dan kirimkan PM sistem beserta alasannya.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Setujui (tandai terverifikasi)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Tolak saja…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Tolak pengajuan",
    // google-translated 2026-06-02
    age_verif_modify_help: "Perbarui DOB pengguna agar sesuai dengan nilai yang tertera pada ID. Pengguna tidak terkunci atau tetap terkunci secara otomatis berdasarkan usia baru.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Tanggal lahir pada KTP:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Perbarui DOB & putuskan",
  },
  it: {
    tab_users: 'Utenti', tab_appeals: 'Ricorsi', tab_reports: 'Segnalazioni', tab_gifts: 'Regali',
    tab_economy: 'Economia', tab_maintenance: 'Manutenzione', tab_monitor: 'Monitor rotazioni',
    tab_banners: 'Banner', tab_funfacts: 'Curiosità', tab_backups: 'Backup',
    tab_logs: 'Registri', tab_devices: 'Dispositivi', tab_starting_screens: 'Schermate iniziali',
    btn_sign_in: 'Accedi', btn_sign_out: 'Esci',
    btn_search: 'Cerca', placeholder_search_uid: 'Inserisci ID utente',
    subtab_profile: 'Profilo', subtab_moderation: 'Moderazione',
    subtab_security: 'Sicurezza', subtab_economy: 'Economia',
    label_uid: 'UID', label_display_name: 'Nome visualizzato', label_user_type: 'Tipo',
    label_nationality: 'Nazionalità', label_description: 'Descrizione', label_email: 'Email',
    label_date_of_birth: 'Data di nascita', label_unique_id: 'ID univoco',
    btn_suspend_user: 'Sospendi', btn_unsuspend_user: 'Riattiva',
    btn_warn: 'Avverti', btn_reset_device: 'Reimposta dispositivo', btn_reset_gcs: 'Reimposta GCS',
    label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans',
    label_super_shy: 'Super Shy', label_login_streak: 'Serie accessi',
    status_banned: 'BANNATO', status_active: 'Attivo', status_suspended: 'Sospeso', status_pending: 'In attesa',
    filter_pending: 'In attesa', filter_approved: 'Approvato', filter_denied: 'Rifiutato',
    filter_resolved: 'Risolto', filter_archived: 'Archiviato',
    btn_approve: 'Approva', btn_deny: 'Rifiuta', btn_resolve: 'Risolvi',
    btn_save: 'Salva', btn_cancel: 'Annulla', btn_delete: 'Elimina', btn_apply: 'Applica',
    btn_refresh: 'Aggiorna', btn_load_more: 'Carica altro',
    msg_loading: 'Caricamento...', msg_no_data: 'Nessun dato trovato',
    msg_saved: 'Salvato', msg_error: 'Errore',
    label_log_level: 'Livello', label_log_source: 'Origine',
    btn_export_json: 'Esporta JSON', btn_export_csv: 'Esporta CSV',
    table_device_id: 'ID dispositivo', table_user: 'Utente', table_model: 'Modello',
    table_os: 'SO', table_last_ip: 'Ultimo IP', table_isp: 'ISP',
    table_country: 'Paese', table_last_seen: 'Ultimo accesso',
    confirm_reset_pin_lockout: 'Reimpostare il blocco PIN per questo utente?',
    confirm_unsuspend_user: 'Annullare la sospensione di questo utente? Il suo account verrà ripristinato completamente.',
    confirm_reset_gcs: 'Reimpostare il GCS di questo utente a 100 e cancellare tutti gli avvisi?',
    confirm_schedule_deletion: 'Sei sicuro di voler programmare l\'eliminazione di questo account?',
    alert_deletion_scheduled: 'Eliminazione account programmata.',
    confirm_cancel_deletion: 'Annullare l\'eliminazione account programmata?',
    confirm_remove_all_device_bindings: 'Rimuovere tutte le associazioni di dispositivi per questo utente?',
    confirm_remove_device_ban: 'Rimuovere questo ban dispositivo?',
    confirm_remove_network_ban: 'Rimuovere questo ban di rete?',
    confirm_unban_device: 'Sbannare questo dispositivo?',
    confirm_ban_all_devices: 'Bannare tutti i dispositivi di questo utente?',
    confirm_remove_all_bans: 'Rimuovere tutti i ban per questo utente?',
    confirm_unsuspend_identity_graph: 'Annullare la sospensione del grafo identità per questo utente?',
    alert_deletion_cancelled: 'Eliminazione account annullata.',
    confirm_clear_temp_id: 'Cancellare l\'ID temporaneo?',
    confirm_revoke_warning: 'Revocare questo avviso? +{deduction} GCS verranno ripristinati.',
    confirm_revoke_biometric: 'Revocare la chiave biometrica per il dispositivo {deviceId}?',
    confirm_issue_warning: 'Emettere un avviso per "{reason}" (gravità {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: 'Impossibile programmare l\'eliminazione: {error}',
    alert_cancel_deletion_failed: 'Impossibile annullare l\'eliminazione: {error}',
    confirm_ban_ip: 'Bannare IP {ip}?',
    confirm_suspend_identity_graph: 'Sospendere il grafo identità per questo utente ({duration}, {scope})?',
    btn_searching: 'Ricerca...',
    btn_email_show: 'Mostra',
    btn_email_hide: 'Nascondi',
    btn_email_saving: 'Salvataggio…',
    btn_undo: 'Annulla',
    msg_no_warnings: 'Nessun avviso',
    btn_revoke: 'Revoca',
    toast_display_name_empty: 'Il nome visualizzato non può essere vuoto',
    toast_undo_successful: 'Annullamento riuscito',
    toast_already_in_list: 'Già presente nell\'elenco',
    toast_autosave_failed: 'Salvataggio automatico non riuscito: {error}',
    toast_undo_failed: 'Annullamento non riuscito: {error}',
    status_suspended_badge: 'Sospeso da {since}, fino al {until}. Motivo: {reason}',
    status_not_suspended: 'Non sospeso',
    status_deletion_scheduled: 'Eliminazione programmata — {days} giorni rimanenti ({date})',
    status_severity_gcs: 'Gravità {severity} (-{deduction} GCS)',
    msg_permanent: 'permanente',
    msg_no_reason_provided: 'Nessun motivo fornito',
    msg_suspended_since_until_format: 'Sospeso da {since}, fino al {until}',
    inline_revoked: 'Revocato',
    inline_warning_note: 'Nota: {note}',
    inline_warning_meta: 'Da: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}',
    toast_warning_revoked_gcs: 'Avviso revocato, +{deduction} GCS ripristinati',
    toast_pin_lockout_reset: 'Blocco PIN reimpostato',
    toast_biometric_revoked: 'Chiave biometrica revocata',
    toast_gcs_reset_100: 'GCS reimpostato a 100',
    toast_action_failed: 'Non riuscito: {error}',
    btn_issuing: 'Emissione in corso...',
    btn_issue_warning: 'Emetti avviso',
    btn_resetting: 'Reimpostazione in corso...',
    toast_reason_required: 'Motivo richiesto',
    toast_select_reason: 'Seleziona un motivo',
    toast_no_user_loaded: 'Nessun utente caricato',
    toast_device_bindings_removed: 'Rimossi {count} collegamenti dispositivo',
    btn_reset_device_binding: 'Reimposta collegamento dispositivo',
    toast_auto_escalate_5_warnings: 'Questo utente ha 5+ avvisi. Considera la sospensione.',
    toast_no_ip_found: 'Nessun indirizzo IP trovato',
    toast_banned_n_devices: 'Bloccati {count} dispositivi',
    toast_removed_n_bans: 'Rimossi {count} ban',
    toast_partial_retry: 'Parziale: {summary}. Riprova il passaggio fallito.',
    toast_user_suspended: 'Utente sospeso',
    toast_user_unsuspended: 'Sospensione utente revocata',
    toast_warning_issued_successfully: 'Avviso emesso con successo',
    toast_ip_banned: 'IP bloccato',
    toast_identity_graph_suspended: 'Grafo identità sospeso',
    toast_identity_graph_unsuspended: 'Sospensione grafo identità revocata',
    prompt_deletion_reason: 'Inserisci il motivo dell\'eliminazione dell\'account (facoltativo):',
    prompt_ban_reason: 'Motivo (facoltativo):',
    bio_device_label: 'Dispositivo:',
    bio_registered_label: 'Registrato:',
    segment_ban_call_failed: '{count}/{total} chiamate ban fallite (prima: {error})',
    segment_pm_failed: '{count}/{total} MP falliti',
    toast_no_devices_to_ban: 'Nessun dispositivo da bloccare',
    toast_enter_positive_amount: 'Inserisci un importo positivo',
    toast_coins_added: 'Aggiunte {amount} monete (ora {balance})',
    toast_coins_deducted: 'Dedotte {amount} monete (ora {balance})',
    toast_beans_added: 'Aggiunti {amount} beans (ora {balance})',
    toast_beans_deducted: 'Dedotti {amount} beans (ora {balance})',
    toast_select_gift_qty: 'Seleziona un regalo e inserisci una quantità',
    toast_gift_added: 'Aggiunti {qty} (totale ora {total})',
    toast_backpack_empty_already: 'Lo zaino è già vuoto',
    msg_loading_backpack: 'Caricamento zaino...',
    msg_backpack_empty: 'Lo zaino è vuoto',
    msg_no_matching_gifts: 'Nessun regalo corrispondente',
    btn_confirm_clear_all: 'Conferma cancella tutto',
    btn_confirming: 'Conferma ({countdown})',
    btn_clearing: 'Cancellazione...',
    toast_backpack_cleared: 'Zaino svuotato ({count} oggetti rimossi)',
    toast_cleared_with_errors: 'Cancellati {cleared}, falliti {errors}',
    toast_failed_to_save: 'Salvataggio non riuscito: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Suggerimenti",
    // google-translated 2026-06-02
    tab_audit_log: "Registro di controllo",
    // google-translated 2026-06-02
    tab_age_segregation: "Segregazione per età",
    // google-translated 2026-06-02
    age_seg_title: "Segregazione per età",
    // google-translated 2026-06-02
    age_seg_subtitle: "Distribuzione di coorte e controlli di override per la conformità OSA del Regno Unito.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Distribuzione di coorte",
    // google-translated 2026-06-02
    age_seg_refresh: "Aggiorna",
    // google-translated 2026-06-02
    age_seg_adult: "Adulto",
    // google-translated 2026-06-02
    age_seg_minor: "Minore",
    // google-translated 2026-06-02
    age_seg_missing: "Coorte mancante",
    // google-translated 2026-06-02
    age_seg_total: "Utenti totali",
    // google-translated 2026-06-02
    age_seg_override_adult: "Ignora → adulto",
    // google-translated 2026-06-02
    age_seg_override_minor: "Ignora → minore",
    // google-translated 2026-06-02
    age_seg_override_heading: "Sostituzione della coorte",
    // google-translated 2026-06-02
    age_seg_override_note: "Le sostituzioni ignorano la coorte derivata dalla DOB. Consentito solo su account staff o amministratore. Ogni modifica viene registrata in audit con il motivo fornito.",
    // google-translated 2026-06-02
    age_seg_target_label: "ID utente di destinazione",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Nuova coorte",
    // google-translated 2026-06-02
    age_seg_pick: "- scegliere -",
    // google-translated 2026-06-02
    age_seg_clear: "Cancella override",
    // google-translated 2026-06-02
    age_seg_reason_label: "Motivo (richiesto, ≤500 caratteri)",
    // google-translated 2026-06-02
    age_seg_apply: "Applica la sostituzione",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Conferma l'override della coorte",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Questa modifica viene registrata in un registro di controllo e potrebbe imporre un aggiornamento del token all'utente di destinazione. Controlla i dettagli prima di confermare.",
    // google-translated 2026-06-02
    age_seg_cancel: "Cancellare",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Confermare",
    // google-translated 2026-06-02
    subtab_identity: "Identità",
    // google-translated 2026-06-02
    subtab_age_verification: "Verifica dell'età",
    // google-translated 2026-06-02
    age_verif_panel_title: "Verifica dell'età",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Esamina l'ID governativo inviato dall'utente e decidi. Approva conferma che l'utente ha più di 18 anni. Rifiuta li mantiene sotto i 18 anni e li avvisa. Se l'ID mostra un DOB diverso, utilizzare Modifica-DOB per correggere il record.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Nessun invio di verifica in sospeso per questo utente.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Altri invii in sospeso nel sistema:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Passa al successivo in sospeso",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "L'immagine viene distrutta quando la decisione viene registrata.",
    // google-translated 2026-06-02
    age_verif_field_method: "Metodo di identificazione:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "Data di nascita registrata:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Inserito a:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "ID invio:",
    // google-translated 2026-06-02
    age_verif_match_question: "L'ID conferma la data di nascita registrata dell'utente?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Sì: il DOB sull'ID corrisponde al valore registrato",
    // google-translated 2026-06-02
    age_verif_match_no: "No, l'ID mostra un DOB diverso",
    // google-translated 2026-06-02
    age_verif_approve_help: "Approva: conferma l'utente come verificato con più di 18 anni. Rifiuta: mantiene i minori di 18 anni e invia un PM di sistema con la motivazione.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Approva (contrassegna come verificato)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Rifiuta invece...",
    // google-translated 2026-06-02
    age_verif_reject_button: "Rifiutare l'invio",
    // google-translated 2026-06-02
    age_verif_modify_help: "Aggiorna il DOB dell'utente in modo che corrisponda al valore mostrato nell'ID. L'utente viene sbloccato o mantenuto bloccato automaticamente in base alla nuova età.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Data di nascita sulla carta d'identità:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Aggiorna DOB e decidi",
  },
  ja: {
    tab_users: '\u30E6\u30FC\u30B6\u30FC', tab_appeals: '\u7570\u8B70\u7533\u7ACB', tab_reports: '\u5831\u544A', tab_gifts: '\u30AE\u30D5\u30C8',
    tab_economy: '\u7D4C\u6E08', tab_maintenance: '\u30E1\u30F3\u30C6\u30CA\u30F3\u30B9', tab_monitor: '\u30B9\u30D4\u30F3\u30E2\u30CB\u30BF\u30FC',
    tab_banners: '\u30D0\u30CA\u30FC', tab_funfacts: '\u8C46\u77E5\u8B58', tab_backups: '\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7',
    tab_logs: '\u30ED\u30B0', tab_devices: '\u30C7\u30D0\u30A4\u30B9', tab_starting_screens: '\u958B\u59CB\u753B\u9762',
    btn_sign_in: '\u30B5\u30A4\u30F3\u30A4\u30F3', btn_sign_out: '\u30B5\u30A4\u30F3\u30A2\u30A6\u30C8',
    btn_search: '\u691C\u7D22', placeholder_search_uid: '\u30E6\u30FC\u30B6\u30FCID\u3092\u5165\u529B',
    subtab_profile: '\u30D7\u30ED\u30D5\u30A3\u30FC\u30EB', subtab_moderation: '\u30E2\u30C7\u30EC\u30FC\u30B7\u30E7\u30F3',
    subtab_security: '\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3', subtab_economy: '\u7D4C\u6E08',
    label_uid: 'UID', label_display_name: '\u8868\u793A\u540D', label_user_type: '\u30BF\u30A4\u30D7',
    label_nationality: '\u56FD\u7C4D', label_description: '\u8AAC\u660E', label_email: '\u30E1\u30FC\u30EB',
    label_date_of_birth: '\u751F\u5E74\u6708\u65E5', label_unique_id: '\u56FA\u6709ID',
    btn_suspend_user: '\u505C\u6B62', btn_unsuspend_user: '\u89E3\u9664',
    btn_warn: '\u8B66\u544A', btn_reset_device: '\u30C7\u30D0\u30A4\u30B9\u30EA\u30BB\u30C3\u30C8', btn_reset_gcs: 'GCS\u30EA\u30BB\u30C3\u30C8',
    label_shy_coins: 'Shy\u30B3\u30A4\u30F3', label_shy_beans: 'Shy\u30D3\u30FC\u30F3\u30BA',
    label_super_shy: '\u30B9\u30FC\u30D1\u30FC\u30B7\u30E3\u30A4', label_login_streak: '\u30ED\u30B0\u30A4\u30F3\u9023\u7D9A',
    status_banned: '\u7981\u6B62', status_active: '\u6709\u52B9', status_suspended: '\u505C\u6B62\u4E2D', status_pending: '\u4FDD\u7559\u4E2D',
    filter_pending: '\u4FDD\u7559', filter_approved: '\u627F\u8A8D', filter_denied: '\u5374\u4E0B',
    filter_resolved: '\u89E3\u6C7A\u6E08', filter_archived: '\u30A2\u30FC\u30AB\u30A4\u30D6',
    btn_approve: '\u627F\u8A8D', btn_deny: '\u5374\u4E0B', btn_resolve: '\u89E3\u6C7A',
    btn_save: '\u4FDD\u5B58', btn_cancel: '\u30AD\u30E3\u30F3\u30BB\u30EB', btn_delete: '\u524A\u9664', btn_apply: '\u9069\u7528',
    btn_refresh: '\u66F4\u65B0', btn_load_more: '\u3082\u3063\u3068\u8AAD\u307F\u8FBC\u3080',
    msg_loading: '\u8AAD\u307F\u8FBC\u307F\u4E2D...', msg_no_data: '\u30C7\u30FC\u30BF\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093',
    msg_saved: '\u4FDD\u5B58\u3057\u307E\u3057\u305F', msg_error: '\u30A8\u30E9\u30FC',
    label_log_level: '\u30EC\u30D9\u30EB', label_log_source: '\u30BD\u30FC\u30B9',
    btn_export_json: 'JSON\u51FA\u529B', btn_export_csv: 'CSV\u51FA\u529B',
    table_device_id: '\u30C7\u30D0\u30A4\u30B9ID', table_user: '\u30E6\u30FC\u30B6\u30FC', table_model: '\u30E2\u30C7\u30EB',
    table_os: 'OS', table_last_ip: '\u6700\u7D42IP', table_isp: 'ISP',
    table_country: '\u56FD', table_last_seen: '\u6700\u7D42\u30A2\u30AF\u30BB\u30B9',
    confirm_reset_pin_lockout: 'このユーザーのPINロックアウトをリセットしますか?',
    confirm_unsuspend_user: 'このユーザーの停止を解除しますか? アカウントは完全に復元されます。',
    confirm_reset_gcs: 'このユーザーのGCSを100にリセットし、すべての警告を消去しますか?',
    confirm_schedule_deletion: 'このアカウントを削除予約しますか?',
    alert_deletion_scheduled: 'アカウント削除を予約しました。',
    confirm_cancel_deletion: '予約済みのアカウント削除をキャンセルしますか?',
    confirm_remove_all_device_bindings: 'このユーザーのすべてのデバイス紐付けを削除しますか?',
    confirm_remove_device_ban: 'このデバイスの禁止を解除しますか?',
    confirm_remove_network_ban: 'このネットワークの禁止を解除しますか?',
    confirm_unban_device: 'このデバイスの禁止を解除しますか?',
    confirm_ban_all_devices: 'このユーザーのすべてのデバイスを禁止しますか?',
    confirm_remove_all_bans: 'このユーザーのすべての禁止を解除しますか?',
    confirm_unsuspend_identity_graph: 'このユーザーのアイデンティティグラフ停止を解除しますか?',
    alert_deletion_cancelled: 'アカウント削除をキャンセルしました。',
    confirm_clear_temp_id: '一時IDをクリアしますか?',
    confirm_revoke_warning: 'この警告を取り消しますか? +{deduction} GCSが復元されます。',
    confirm_revoke_biometric: 'デバイス {deviceId} の生体認証キーを取り消しますか?',
    confirm_issue_warning: '「{reason}」について警告を発行しますか (重大度 {severity}、-{deduction} GCS)?',
    alert_schedule_deletion_failed: '削除の予約に失敗しました: {error}',
    alert_cancel_deletion_failed: '削除のキャンセルに失敗しました: {error}',
    confirm_ban_ip: 'IP {ip} を禁止しますか?',
    confirm_suspend_identity_graph: 'このユーザーのアイデンティティグラフを停止しますか ({duration}, {scope})?',
    btn_searching: '検索中...',
    btn_email_show: '表示',
    btn_email_hide: '非表示',
    btn_email_saving: '保存中…',
    btn_undo: '元に戻す',
    msg_no_warnings: '警告はありません',
    btn_revoke: '取り消し',
    toast_display_name_empty: '表示名は空にできません',
    toast_undo_successful: '元に戻しました',
    toast_already_in_list: 'すでにリストにあります',
    toast_autosave_failed: '自動保存に失敗しました: {error}',
    toast_undo_failed: '元に戻すに失敗しました: {error}',
    status_suspended_badge: '{since}から{until}まで停止中。理由: {reason}',
    status_not_suspended: '停止なし',
    status_deletion_scheduled: '削除予約済み — 残り{days}日 ({date})',
    status_severity_gcs: '重大度 {severity} (-{deduction} GCS)',
    msg_permanent: '永続',
    msg_no_reason_provided: '理由なし',
    msg_suspended_since_until_format: '{since}から{until}まで停止中',
    inline_revoked: '取り消し済み',
    inline_warning_note: 'メモ: {note}',
    inline_warning_meta: '発行者: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}',
    toast_warning_revoked_gcs: '警告を取り消しました。+{deduction} GCS を回復しました',
    toast_pin_lockout_reset: 'PINロックアウトをリセットしました',
    toast_biometric_revoked: '生体認証キーを取り消しました',
    toast_gcs_reset_100: 'GCSを100にリセットしました',
    toast_action_failed: '失敗: {error}',
    btn_issuing: '発行中...',
    btn_issue_warning: '警告を発行',
    btn_resetting: 'リセット中...',
    toast_reason_required: '理由が必要です',
    toast_select_reason: '理由を選択してください',
    toast_no_user_loaded: 'ユーザーが読み込まれていません',
    toast_device_bindings_removed: '{count} 件のデバイス連携を解除しました',
    btn_reset_device_binding: 'デバイス連携をリセット',
    toast_auto_escalate_5_warnings: 'このユーザーは 5 件以上の警告があります。停止を検討してください。',
    toast_no_ip_found: 'IP アドレスが見つかりません',
    toast_banned_n_devices: '{count} 台のデバイスをBANしました',
    toast_removed_n_bans: '{count} 件のBANを解除しました',
    toast_partial_retry: '一部完了: {summary}。失敗したステップを再試行してください。',
    toast_user_suspended: 'ユーザーを停止しました',
    toast_user_unsuspended: 'ユーザーの停止を解除しました',
    toast_warning_issued_successfully: '警告を発行しました',
    toast_ip_banned: 'IP をBANしました',
    toast_identity_graph_suspended: 'アイデンティティグラフを停止しました',
    toast_identity_graph_unsuspended: 'アイデンティティグラフの停止を解除しました',
    prompt_deletion_reason: 'アカウント削除の理由を入力してください（任意）:',
    prompt_ban_reason: '理由（任意）:',
    bio_device_label: 'デバイス:',
    bio_registered_label: '登録日:',
    segment_ban_call_failed: '{count}/{total} 件のBAN呼び出しが失敗しました (最初: {error})',
    segment_pm_failed: '{count}/{total} 件のPMが失敗しました',
    toast_no_devices_to_ban: 'BANするデバイスがありません',
    toast_enter_positive_amount: '正の数を入力してください',
    toast_coins_added: '{amount} コインを追加しました（現在 {balance}）',
    toast_coins_deducted: '{amount} コインを差し引きました（現在 {balance}）',
    toast_beans_added: '{amount} ビーンズを追加しました（現在 {balance}）',
    toast_beans_deducted: '{amount} ビーンズを差し引きました（現在 {balance}）',
    toast_select_gift_qty: 'ギフトを選択して数量を入力してください',
    toast_gift_added: '{qty} を追加しました（合計 {total}）',
    toast_backpack_empty_already: 'バックパックは既に空です',
    msg_loading_backpack: 'バックパックを読み込み中...',
    msg_backpack_empty: 'バックパックは空です',
    msg_no_matching_gifts: '一致するギフトはありません',
    btn_confirm_clear_all: 'すべてクリアを確認',
    btn_confirming: '確認 ({countdown})',
    btn_clearing: 'クリア中...',
    toast_backpack_cleared: 'バックパックをクリアしました（{count} 件削除）',
    toast_cleared_with_errors: '{cleared} 件クリア、{errors} 件失敗',
    toast_failed_to_save: '保存に失敗しました: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "提案",
    // google-translated 2026-06-02
    tab_audit_log: "監査ログ",
    // override-translated 2026-06-02
    tab_age_segregation: "年齢分離",
    // override-translated 2026-06-02
    age_seg_title: "年齢分離",
    // google-translated 2026-06-02
    age_seg_subtitle: "英国 OSA 準拠のためのコホート分布とオーバーライド制御。",
    // google-translated 2026-06-02
    age_seg_stats_heading: "コホート分布",
    // google-translated 2026-06-02
    age_seg_refresh: "リフレッシュ",
    // google-translated 2026-06-02
    age_seg_adult: "アダルト",
    // override-translated 2026-06-02
    age_seg_minor: "未成年",
    // google-translated 2026-06-02
    age_seg_total: "総ユーザー数",
    // override-translated 2026-06-02
    age_seg_override_minor: "オーバーライド → 未成年",
    // google-translated 2026-06-02
    age_seg_override_heading: "コホートオーバーライド",
    // google-translated 2026-06-02
    age_seg_override_note: "オーバーライドは DOB 由来のコホートをバイパスします。スタッフまたは管理者のアカウントでのみ許可されます。すべての変更は、指定された理由とともに監査ログに記録されます。",
    // google-translated 2026-06-02
    age_seg_target_label: "対象ユーザーID",
    // google-translated 2026-06-02
    age_seg_override_value_label: "新しいコホート",
    // google-translated 2026-06-02
    age_seg_pick: "- 選ぶ -",
    // google-translated 2026-06-02
    age_seg_clear: "オーバーライドのクリア",
    // google-translated 2026-06-02
    age_seg_reason_label: "理由 (必須、≤500 文字)",
    // google-translated 2026-06-02
    age_seg_apply: "オーバーライドを適用",
    // google-translated 2026-06-02
    age_seg_confirm_title: "コホートの上書きを確認する",
    // google-translated 2026-06-02
    age_seg_confirm_body: "この変更は監査ログに記録され、ターゲット ユーザーに対してトークンの更新が強制される可能性があります。確認する前に詳細を確認してください。",
    // google-translated 2026-06-02
    age_seg_cancel: "キャンセル",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "確認する",
    // google-translated 2026-06-02
    subtab_identity: "身元",
    // google-translated 2026-06-02
    subtab_age_verification: "年齢認証",
    // google-translated 2026-06-02
    age_verif_panel_title: "年齢認証",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "ユーザーが提出した政府 ID を確認して決定します。承認すると、ユーザーが 18 歳以上であることが確認されます。 Reject は彼らを 18 歳以下に保ち、通知します。 ID が異なる DOB を示している場合は、Modify-DOB を使用してレコードを修正します。",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "このユーザーには保留中の検証送信はありません。",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "システム全体のその他の保留中の送信:",
    // google-translated 2026-06-02
    age_verif_jump_next: "次の保留中にジャンプ",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "決定が記録されると、画像は破壊されます。",
    // google-translated 2026-06-02
    age_verif_field_method: "ID方式：",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "記録された生年月日:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "提出先:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "提出ID:",
    // google-translated 2026-06-02
    age_verif_match_question: "ID はユーザーの記録された生年月日を確認しますか?",
    // google-translated 2026-06-02
    age_verif_match_yes: "はい - ID の DOB が記録された値と一致します",
    // google-translated 2026-06-02
    age_verif_match_no: "いいえ - ID は別の DOB を示しています",
    // google-translated 2026-06-02
    age_verif_approve_help: "承認: ユーザーが 18 歳以上であることを確認します。拒否: それらを 18 未満に保ち、その理由をシステム PM に送信します。",
    // google-translated 2026-06-02
    age_verif_approve_button: "承認（確認済みのマークを付ける）",
    // google-translated 2026-06-02
    age_verif_reject_summary: "代わりに拒否してください…",
    // google-translated 2026-06-02
    age_verif_reject_button: "提出を拒否する",
    // google-translated 2026-06-02
    age_verif_modify_help: "ID に表示されている値と一致するようにユーザーの DOB を更新します。ユーザーは、新しい年齢に基づいて自動的にロックが解除されるか、ロックされたままになります。",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "IDに記載されている生年月日:",
    // google-translated 2026-06-02
    age_verif_modify_button: "DOBを更新して決定する",
    // google-translated 2026-06-02
    age_seg_missing: "欠落コホート",
    // google-translated 2026-06-02
    age_seg_override_adult: "オーバーライド→大人",
  },
  km: {
    tab_users: '\u1780\u17B6\u179A\u17B7\u1794\u17D2\u179A\u17BE\u1794\u17D2\u179A\u17B6\u179F\u17CB', tab_appeals: '\u1794\u178E\u17D2\u178F\u17B9\u1784\u17A7\u1791\u17D2\u1792\u179A\u178E\u17CD', tab_reports: '\u179A\u17B6\u1799\u1780\u17B6\u179A\u178E\u17CD', tab_gifts: '\u17A2\u17C6\u178E\u17C4\u1799',
    tab_economy: '\u179F\u17C1\u178A\u17D2\u178B\u1780\u17B7\u1785\u17D2\u1785', tab_maintenance: '\u1780\u17B6\u179A\u1787\u17BD\u179F\u1787\u17BB\u179B', tab_monitor: '\u1798\u17C9\u17BB\u1793\u17B8\u1791\u17D0\u179A\u1780\u17B6\u179A\u1794\u17D2\u179A\u17C0',
    tab_banners: '\u1794\u17D2\u179A\u178E\u17B6\u179F', tab_funfacts: '\u1780\u17B6\u179A\u178E\u17CD\u179F\u1793\u17BB\u1780\u179F\u17D2\u1794\u17B6\u1799', tab_backups: '\u1785\u17C6\u179B\u1784\u1791\u17BB\u1780',
    tab_logs: '\u1780\u17C6\u178E\u17B6\u178F\u17CB\u17A0\u17C1\u178F\u17BB', tab_devices: '\u17A7\u1794\u1780\u179A\u178E\u17CD', tab_starting_screens: '\u17A2\u17C1\u1780\u17D2\u179A\u1784\u17CB\u1785\u17B6\u1794\u17CB\u1795\u17D2\u178F\u17BE\u1798',
    btn_sign_in: '\u1785\u17BC\u179B', btn_sign_out: '\u1785\u17C1\u1789',
    btn_search: '\u179F\u17D2\u179C\u17C2\u1784\u179A\u1780', placeholder_search_uid: '\u1794\u1789\u17D2\u1785\u17BC\u179B\u179B\u17C1\u1781\u179F\u1798\u17D2\u1782\u17B6\u179B\u17CB\u17A2\u17D2\u1793\u1780\u1794\u17D2\u179A\u17BE\u1794\u17D2\u179A\u17B6\u179F\u17CB',
    subtab_profile: '\u1794\u17D2\u179A\u179C\u178F\u17D2\u178F\u17B7\u179A\u17BC\u1794', subtab_moderation: '\u1780\u17B6\u179A\u178F\u17D2\u179A\u17BD\u178F\u1796\u17B7\u1793\u17B7\u178F\u17D2\u1799',
    subtab_security: '\u179F\u17BB\u179C\u178F\u17D2\u1790\u17B7\u1797\u17B6\u1796', subtab_economy: '\u179F\u17C1\u178A\u17D2\u178B\u1780\u17B7\u1785\u17D2\u1785',
    label_uid: 'UID', label_display_name: '\u1788\u17D2\u1798\u17C4\u17C7\u1794\u1784\u17D2\u17A0\u17B6\u1789', label_user_type: '\u1794\u17D2\u179A\u1797\u17C1\u1791',
    label_nationality: '\u179F\u1789\u17D2\u1787\u17B6\u178F\u17B7', label_description: '\u1780\u17B6\u179A\u1796\u17B7\u1796\u178E\u17CC\u1793\u17B6', label_email: '\u17A2\u17CA\u17B8\u1798\u17C2\u179B',
    label_date_of_birth: '\u1790\u17D2\u1784\u17C3\u1781\u17C2\u1786\u17D2\u1793\u17B6\u17C6\u1780\u17C6\u178E\u17BE\u178F', label_unique_id: '\u179B\u17C1\u1781\u179F\u1798\u17D2\u1782\u17B6\u179B\u17CB\u178F\u17C2\u1798\u17BD\u1799',
    btn_suspend_user: '\u1795\u17D2\u17A2\u17B6\u1780', btn_unsuspend_user: '\u1789\u17C2\u1780\u1780\u17B6\u179A\u1795\u17D2\u17A2\u17B6\u1780',
    btn_warn: '\u1795\u17D2\u178F\u179B\u17CB\u1780\u17B6\u179A\u178F\u17D2\u179A\u17BD\u178F\u1796\u17B7\u1793\u17B7\u178F\u17D2\u1799', btn_reset_device: '\u1780\u17C6\u178E\u178F\u17CB\u17A7\u1794\u1780\u179A\u178E\u17CD\u17A1\u17BE\u1784\u179C\u17B7\u1789',
    btn_reset_gcs: '\u1780\u17C6\u178E\u178F\u17CB GCS \u17A1\u17BE\u1784\u179C\u17B7\u1789',
    label_shy_coins: 'Shy \u1780\u17B6\u1780\u17CB', label_shy_beans: 'Shy \u179F\u17B6\u1794\u17C9\u17C1',
    label_super_shy: '\u179F\u17CA\u17BC\u1796\u17C0\u179A\u179F\u17B6\u1799', label_login_streak: '\u179F\u17D2\u179B\u179F\u17CB\u1785\u17BC\u179B\u1787\u17B6\u1794\u17CB\u178F\u17B6\u1798\u1780\u17B6\u1793\u17CB',
    status_banned: '\u179A\u17B6\u179A\u17B6\u17B6\u17B6\u17B6\u1784\u17CB', status_active: '\u179F\u1780\u1798\u17D2\u1798', status_suspended: '\u1795\u17D2\u17A2\u17B6\u1780',
    status_pending: '\u179A\u17C4\u1785\u1780\u17B6\u179A',
    filter_pending: '\u179A\u17C4\u1785\u1780\u17B6\u179A', filter_approved: '\u17A2\u1793\u17BB\u1798\u17D0\u178F', filter_denied: '\u1794\u178A\u17B7\u179F\u17C1\u1792',
    filter_resolved: '\u178A\u17C4\u17C7\u179F\u17D2\u179A\u17B6\u1799\u17A0\u17BE\u1799', filter_archived: '\u179A\u1780\u17D2\u179F\u17B6\u1791\u17BB\u1780',
    btn_approve: '\u17A2\u1793\u17BB\u1798\u17D0\u178F', btn_deny: '\u1794\u178A\u17B7\u179F\u17C1\u1792', btn_resolve: '\u178A\u17C4\u17C7\u179F\u17D2\u179A\u17B6\u1799',
    btn_save: '\u179A\u1780\u17D2\u179F\u17B6\u1791\u17BB\u1780', btn_cancel: '\u1794\u17C4\u17C7\u1794\u1784\u17CB', btn_delete: '\u179B\u17BB\u1794', btn_apply: '\u17A2\u1793\u17BB\u179C\u178F\u17D2\u178F',
    btn_refresh: '\u1795\u17D2\u1791\u17BB\u1780\u17A1\u17BE\u1784\u179C\u17B7\u1789', btn_load_more: '\u1794\u1784\u17D2\u17A0\u17B6\u1789\u1794\u1793\u17D2\u1790\u17C2\u1798',
    msg_loading: '\u1780\u17C6\u1796\u17BB\u1784\u1795\u17D2\u1791\u17BB\u1780...', msg_no_data: '\u1798\u17B7\u1793\u1798\u17B6\u1793\u1791\u17B7\u1793\u17D2\u1793\u1793\u17D0\u1799',
    msg_saved: '\u1794\u17B6\u1793\u179A\u1780\u17D2\u179F\u17B6\u1791\u17BB\u1780', msg_error: '\u1780\u17C6\u17A0\u17BB\u179F',
    label_log_level: '\u1780\u1798\u17D2\u179A\u17B7\u178F', label_log_source: '\u1794\u17D2\u179A\u1797\u1796',
    btn_export_json: '\u1793\u17B6\u17C6\u1785\u17C1\u1789 JSON', btn_export_csv: '\u1793\u17B6\u17C6\u1785\u17C1\u1789 CSV',
    table_device_id: '\u179B\u17C1\u1781\u179F\u1798\u17D2\u1782\u17B6\u179B\u17CB\u17A7\u1794\u1780\u179A\u178E\u17CD', table_user: '\u17A2\u17D2\u1793\u1780\u1794\u17D2\u179A\u17BE\u1794\u17D2\u179A\u17B6\u179F\u17CB', table_model: '\u1798\u17C9\u17BC\u178A\u17C2\u179B',
    table_os: 'OS', table_last_ip: 'IP \u1785\u17BB\u1784\u1780\u17D2\u179A\u17C4\u1799', table_isp: 'ISP',
    table_country: '\u1794\u17D2\u179A\u1791\u17C1\u179F', table_last_seen: '\u1781\u17C1\u17B6\u17C7\u1785\u17BB\u1784\u1780\u17D2\u179A\u17C4\u1799',
    confirm_reset_pin_lockout: 'កំណត់ការចាក់សោ PIN សម្រាប់អ្នកប្រើនេះឡើងវិញ?',
    confirm_unsuspend_user: 'ដកការផ្អាកអ្នកប្រើនេះ? គណនីរបស់ពួកគេនឹងត្រូវស្ដារពេញលេញ។',
    confirm_reset_gcs: 'កំណត់ GCS របស់អ្នកប្រើនេះទៅ 100 ហើយលុបការព្រមានទាំងអស់?',
    confirm_schedule_deletion: 'តើអ្នកប្រាកដក្នុងការកំណត់ពេលលុបគណនីនេះ?',
    alert_deletion_scheduled: 'បានកំណត់ពេលលុបគណនី។',
    confirm_cancel_deletion: 'បោះបង់ការលុបគណនីដែលបានកំណត់ពេល?',
    confirm_remove_all_device_bindings: 'លុបការភ្ជាប់ឧបករណ៍ទាំងអស់សម្រាប់អ្នកប្រើនេះ?',
    confirm_remove_device_ban: 'លុបការហាមឃាត់ឧបករណ៍នេះ?',
    confirm_remove_network_ban: 'លុបការហាមឃាត់បណ្ដាញនេះ?',
    confirm_unban_device: 'ដកការហាមឃាត់ឧបករណ៍នេះ?',
    confirm_ban_all_devices: 'ហាមឃាត់ឧបករណ៍ទាំងអស់សម្រាប់អ្នកប្រើនេះ?',
    confirm_remove_all_bans: 'លុបការហាមឃាត់ទាំងអស់សម្រាប់អ្នកប្រើនេះ?',
    confirm_unsuspend_identity_graph: 'ដកការផ្អាកក្រាហ្វអត្តសញ្ញាណសម្រាប់អ្នកប្រើនេះ?',
    alert_deletion_cancelled: 'បោះបង់ការលុបគណនីហើយ។',
    confirm_clear_temp_id: 'សម្អាត ID បណ្ដោះអាសន្ន?',
    confirm_revoke_warning: 'ដកការព្រមាននេះ? +{deduction} GCS នឹងត្រូវស្ដារ។',
    confirm_revoke_biometric: 'ដកសោជីវភាពសម្រាប់ឧបករណ៍ {deviceId}?',
    confirm_issue_warning: 'ចេញការព្រមានសម្រាប់ "{reason}" (កម្រិត {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: 'មិនអាចកំណត់ពេលលុបបាន: {error}',
    alert_cancel_deletion_failed: 'មិនអាចបោះបង់ការលុបបាន: {error}',
    confirm_ban_ip: 'ហាមឃាត់ IP {ip}?',
    confirm_suspend_identity_graph: 'ផ្អាកក្រាហ្វអត្តសញ្ញាណសម្រាប់អ្នកប្រើនេះ ({duration}, {scope})?',
    btn_searching: 'កំពុងស្វែងរក...',
    btn_email_show: 'បង្ហាញ',
    btn_email_hide: 'លាក់',
    btn_email_saving: 'កំពុងរក្សាទុក…',
    btn_undo: 'មិនធ្វើវិញ',
    msg_no_warnings: 'មិនមានការព្រមាន',
    btn_revoke: 'ដក',
    toast_display_name_empty: 'ឈ្មោះបង្ហាញមិនអាចទទេ',
    toast_undo_successful: 'មិនធ្វើវិញបានជោគជ័យ',
    toast_already_in_list: 'មាននៅក្នុងបញ្ជីហើយ',
    toast_autosave_failed: 'ការរក្សាទុកស្វ័យប្រវត្តិបរាជ័យ: {error}',
    toast_undo_failed: 'ការមិនធ្វើវិញបរាជ័យ: {error}',
    status_suspended_badge: 'ផ្អាកតាំងពី {since} រហូតដល់ {until}។ ហេតុផល: {reason}',
    status_not_suspended: 'មិនបានផ្អាក',
    status_deletion_scheduled: 'កំណត់ពេលលុប — នៅសល់ {days} ថ្ងៃ ({date})',
    status_severity_gcs: 'កម្រិត {severity} (-{deduction} GCS)',
    msg_permanent: 'អចិន្ត្រៃយ៍',
    msg_no_reason_provided: 'មិនបានផ្ដល់ហេតុផល',
    msg_suspended_since_until_format: 'ផ្អាកតាំងពី {since} រហូតដល់ {until}',
    inline_revoked: 'បានដកហូត',
    inline_warning_note: 'កំណត់ចំណាំ៖ {note}',
    inline_warning_meta: 'ដោយ៖ {issuedBy} | GCS៖ {gcsBefore} → {gcsAfter}',
    toast_warning_revoked_gcs: 'បានដកហូតការព្រមាន +{deduction} GCS ត្រូវបានស្ដារ',
    toast_pin_lockout_reset: 'បានកំណត់ឡើងវិញនូវការចាក់សោ PIN',
    toast_biometric_revoked: 'បានដកហូតសោជីវមាត្រ',
    toast_gcs_reset_100: 'បានកំណត់ឡើងវិញ GCS ទៅ 100',
    toast_action_failed: 'បរាជ័យ៖ {error}',
    btn_issuing: 'កំពុងចេញ...',
    btn_issue_warning: 'ចេញការព្រមាន',
    btn_resetting: 'កំពុងកំណត់ឡើងវិញ...',
    toast_reason_required: 'ត្រូវការហេតុផល',
    toast_select_reason: 'ជ្រើសរើសហេតុផល',
    toast_no_user_loaded: 'មិនបានផ្ទុកអ្នកប្រើ',
    toast_device_bindings_removed: 'បានដក {count} ការភ្ជាប់ឧបករណ៍',
    btn_reset_device_binding: 'កំណត់ឡើងវិញការភ្ជាប់ឧបករណ៍',
    toast_auto_escalate_5_warnings: 'អ្នកប្រើនេះមានការព្រមាន 5+។ ពិចារណាផ្អាក។',
    toast_no_ip_found: 'រកមិនឃើញអាស័យដ្ឋាន IP',
    toast_banned_n_devices: 'បានហាមឃាត់ {count} ឧបករណ៍',
    toast_removed_n_bans: 'បានដក {count} ការហាមឃាត់',
    toast_partial_retry: 'ដោយផ្នែក៖ {summary}។ សូមព្យាយាមជំហានដែលបរាជ័យឡើងវិញ។',
    toast_user_suspended: 'បានផ្អាកអ្នកប្រើ',
    toast_user_unsuspended: 'បានដកការផ្អាកអ្នកប្រើ',
    toast_warning_issued_successfully: 'បានចេញការព្រមានដោយជោគជ័យ',
    toast_ip_banned: 'បានហាមឃាត់ IP',
    toast_identity_graph_suspended: 'បានផ្អាកក្រាហ្វអត្តសញ្ញាណ',
    toast_identity_graph_unsuspended: 'បានដកការផ្អាកក្រាហ្វអត្តសញ្ញាណ',
    prompt_deletion_reason: 'បញ្ចូលហេតុផលលុបគណនី (ស្រេចចិត្ត)៖',
    prompt_ban_reason: 'ហេតុផល (ស្រេចចិត្ត)៖',
    bio_device_label: 'ឧបករណ៍៖',
    bio_registered_label: 'បានចុះឈ្មោះ៖',
    segment_ban_call_failed: '{count}/{total} ការហៅហាមឃាត់បរាជ័យ (ដំបូង៖ {error})',
    segment_pm_failed: '{count}/{total} PM បរាជ័យ',
    toast_no_devices_to_ban: 'មិនមានឧបករណ៍ដើម្បីហាមឃាត់',
    toast_enter_positive_amount: 'បញ្ចូលចំនួនវិជ្ជមាន',
    toast_coins_added: 'បានបន្ថែម {amount} កាក់ (ឥឡូវ {balance})',
    toast_coins_deducted: 'បានកាត់ {amount} កាក់ (ឥឡូវ {balance})',
    toast_beans_added: 'បានបន្ថែម {amount} សណ្តែក (ឥឡូវ {balance})',
    toast_beans_deducted: 'បានកាត់ {amount} សណ្តែក (ឥឡូវ {balance})',
    toast_select_gift_qty: 'ជ្រើសរើសអំណោយ ហើយបញ្ចូលចំនួន',
    toast_gift_added: 'បានបន្ថែម {qty} (សរុបឥឡូវ {total})',
    toast_backpack_empty_already: 'កាបូបស្ពាយទទេរួចហើយ',
    msg_loading_backpack: 'កំពុងផ្ទុកកាបូបស្ពាយ...',
    msg_backpack_empty: 'កាបូបស្ពាយទទេ',
    msg_no_matching_gifts: 'មិនមានអំណោយដែលត្រូវគ្នា',
    btn_confirm_clear_all: 'បញ្ជាក់សម្អាតទាំងអស់',
    btn_confirming: 'បញ្ជាក់ ({countdown})',
    btn_clearing: 'កំពុងសម្អាត...',
    toast_backpack_cleared: 'បានសម្អាតកាបូបស្ពាយ (បានដក {count} ធាតុ)',
    toast_cleared_with_errors: 'បានសម្អាត {cleared}, បរាជ័យ {errors}',
    toast_failed_to_save: 'បរាជ័យក្នុងការរក្សាទុក៖ {error}',
    // google-translated 2026-06-02
    tab_suggestions: "ការណែនាំ",
    // google-translated 2026-06-02
    tab_audit_log: "កំណត់ហេតុសវនកម្ម",
    // google-translated 2026-06-02
    tab_age_segregation: "ការបែងចែកអាយុ",
    // google-translated 2026-06-02
    age_seg_title: "ការបែងចែកអាយុ",
    // google-translated 2026-06-02
    age_seg_subtitle: "ការចែកចាយតាមក្រុម និងការគ្រប់គ្រងត្រួតលើគ្នាសម្រាប់ការអនុលោមតាម OSA របស់ចក្រភពអង់គ្លេស។",
    // google-translated 2026-06-02
    age_seg_stats_heading: "ការចែកចាយក្រុម",
    // google-translated 2026-06-02
    age_seg_refresh: "ធ្វើឱ្យស្រស់",
    // google-translated 2026-06-02
    age_seg_adult: "មនុស្សពេញវ័យ",
    // google-translated 2026-06-02
    age_seg_minor: "អនីតិជន",
    // google-translated 2026-06-02
    age_seg_missing: "បាត់ក្រុម",
    // google-translated 2026-06-02
    age_seg_total: "អ្នកប្រើប្រាស់សរុប",
    // google-translated 2026-06-02
    age_seg_override_adult: "បដិសេធ → មនុស្សពេញវ័យ",
    // override-translated 2026-06-02
    age_seg_override_minor: "បដិសេធ → អនីតិជន",
    // google-translated 2026-06-02
    age_seg_override_heading: "ការបដិសេធក្រុម",
    // google-translated 2026-06-02
    age_seg_override_note: "បដិសេធ​រំលង​ក្រុម​ដែល​បាន​មក​ពី DOB ។ អនុញ្ញាតតែលើគណនីបុគ្គលិក ឬអ្នកគ្រប់គ្រងប៉ុណ្ណោះ។ រាល់ការផ្លាស់ប្តូរត្រូវបានកត់ត្រាដោយសវនកម្មជាមួយនឹងហេតុផលដែលបានផ្តល់ឱ្យ។",
    // google-translated 2026-06-02
    age_seg_target_label: "កំណត់អត្តសញ្ញាណអ្នកប្រើប្រាស់គោលដៅ",
    // google-translated 2026-06-02
    age_seg_override_value_label: "ក្រុមថ្មី។",
    // google-translated 2026-06-02
    age_seg_pick: "- រើស -",
    // google-translated 2026-06-02
    age_seg_clear: "ជម្រះការបដិសេធ",
    // google-translated 2026-06-02
    age_seg_reason_label: "ហេតុផល (ទាមទារ ≤500 តួអក្សរ)",
    // google-translated 2026-06-02
    age_seg_apply: "អនុវត្តការបដិសេធ",
    // google-translated 2026-06-02
    age_seg_confirm_title: "បញ្ជាក់ការបដិសេធក្រុម",
    // google-translated 2026-06-02
    age_seg_confirm_body: "ការផ្លាស់ប្តូរនេះត្រូវបានកត់ត្រាដោយសវនកម្ម ហើយអាចបង្ខំឱ្យផ្ទុកឡើងវិញនូវសញ្ញាសម្ងាត់នៅលើអ្នកប្រើប្រាស់គោលដៅ។ ពិនិត្យព័ត៌មានលម្អិតមុនពេលបញ្ជាក់។",
    // google-translated 2026-06-02
    age_seg_cancel: "បោះបង់",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "បញ្ជាក់",
    // google-translated 2026-06-02
    subtab_identity: "អត្តសញ្ញាណ",
    // google-translated 2026-06-02
    subtab_age_verification: "ការផ្ទៀងផ្ទាត់អាយុ",
    // google-translated 2026-06-02
    age_verif_panel_title: "ការផ្ទៀងផ្ទាត់អាយុ",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "ពិនិត្យមើលលេខសម្គាល់រដ្ឋាភិបាលដែលបានដាក់ជូនរបស់អ្នកប្រើប្រាស់ ហើយសម្រេចចិត្ត។ Approve បញ្ជាក់ថាអ្នកប្រើប្រាស់មានអាយុ 18+។ បដិសេធ​រក្សា​ពួកគេ​អនុ 18 និង​ជូន​ដំណឹង​ពួកគេ។ ប្រសិនបើ ID បង្ហាញ DOB ផ្សេង ប្រើ Modify-DOB ដើម្បីកែកំណត់ត្រា។",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "គ្មាន​ការ​បញ្ជូន​ការ​ផ្ទៀងផ្ទាត់​ដែល​កំពុង​រង់ចាំ​សម្រាប់​អ្នក​ប្រើ​នេះ​ទេ។",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "ការដាក់ស្នើដែលមិនទាន់សម្រេចផ្សេងទៀតនៅទូទាំងប្រព័ន្ធ៖",
    // google-translated 2026-06-02
    age_verif_jump_next: "លោតទៅការរង់ចាំបន្ទាប់",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "រូបភាពត្រូវបានបំផ្លាញនៅពេលដែលការសម្រេចចិត្តត្រូវបានកត់ត្រា។",
    // google-translated 2026-06-02
    age_verif_field_method: "វិធីសាស្រ្តលេខសម្គាល់៖",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "ថត DOB៖",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "បានដាក់ជូននៅ៖",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "លេខសម្គាល់ការដាក់ស្នើ៖",
    // google-translated 2026-06-02
    age_verif_match_question: "តើអត្តសញ្ញាណប័ណ្ណបញ្ជាក់ថ្ងៃខែឆ្នាំកំណើតដែលបានកត់ត្រារបស់អ្នកប្រើដែរឬទេ?",
    // google-translated 2026-06-02
    age_verif_match_yes: "បាទ/ចាស - DOB នៅលើ ID ត្រូវនឹងតម្លៃដែលបានកត់ត្រា",
    // google-translated 2026-06-02
    age_verif_match_no: "ទេ — លេខសម្គាល់បង្ហាញ DOB ផ្សេង",
    // google-translated 2026-06-02
    age_verif_approve_help: "យល់ព្រម៖ បញ្ជាក់អ្នកប្រើប្រាស់ថាបានផ្ទៀងផ្ទាត់ 18+។ ច្រានចោល៖ រក្សាពួកគេអនុ-១៨ ហើយផ្ញើប្រព័ន្ធ PM ដោយមានហេតុផល។",
    // google-translated 2026-06-02
    age_verif_approve_button: "អនុម័ត (សម្គាល់បានផ្ទៀងផ្ទាត់)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "បដិសេធ​ជំនួស...",
    // google-translated 2026-06-02
    age_verif_reject_button: "បដិសេធការដាក់ស្នើ",
    // google-translated 2026-06-02
    age_verif_modify_help: "ធ្វើបច្ចុប្បន្នភាព DOB របស់អ្នកប្រើដើម្បីផ្គូផ្គងតម្លៃដែលបង្ហាញនៅលើលេខសម្គាល់។ អ្នក​ប្រើ​ត្រូវ​បាន​ដោះ​សោ ឬ​រក្សា​ទុក​ចាក់សោ​ដោយ​ស្វ័យ​ប្រវត្តិ​ដោយ​ផ្អែក​លើ​អាយុ​ថ្មី។",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "ថ្ងៃខែឆ្នាំកំណើតនៅលើអត្តសញ្ញាណប័ណ្ណ៖",
    // google-translated 2026-06-02
    age_verif_modify_button: "ធ្វើបច្ចុប្បន្នភាព DOB និងសម្រេចចិត្ត",
  },
  ko: {
    tab_users: '\uC0AC\uC6A9\uC790', tab_appeals: '\uC774\uC758 \uC2E0\uCCAD', tab_reports: '\uC2E0\uACE0', tab_gifts: '\uC120\uBB3C',
    tab_economy: '\uACBD\uC81C', tab_maintenance: '\uC720\uC9C0\uBCF4\uC218', tab_monitor: '\uC2A4\uD540 \uBAA8\uB2C8\uD130',
    tab_banners: '\uBC30\uB108', tab_funfacts: '\uC7AC\uBBF8\uC788\uB294 \uC0AC\uC2E4', tab_backups: '\uBC31\uC5C5',
    tab_logs: '\uB85C\uADF8', tab_devices: '\uAE30\uAE30', tab_starting_screens: '\uC2DC\uC791 \uD654\uBA74',
    btn_sign_in: '\uB85C\uADF8\uC778', btn_sign_out: '\uB85C\uADF8\uC544\uC6C3',
    btn_search: '\uAC80\uC0C9', placeholder_search_uid: '\uC0AC\uC6A9\uC790 ID \uC785\uB825',
    subtab_profile: '\uD504\uB85C\uD544', subtab_moderation: '\uAD00\uB9AC',
    subtab_security: '\uBCF4\uC548', subtab_economy: '\uACBD\uC81C',
    label_uid: 'UID', label_display_name: '\uD45C\uC2DC \uC774\uB984', label_user_type: '\uC720\uD615',
    label_nationality: '\uAD6D\uC801', label_description: '\uC124\uBA85', label_email: '\uC774\uBA54\uC77C',
    label_date_of_birth: '\uC0DD\uB144\uC6D4\uC77C', label_unique_id: '\uACE0\uC720 ID',
    btn_suspend_user: '\uC815\uC9C0', btn_unsuspend_user: '\uD574\uC81C',
    btn_warn: '\uACBD\uACE0', btn_reset_device: '\uAE30\uAE30 \uCD08\uAE30\uD654', btn_reset_gcs: 'GCS \uCD08\uAE30\uD654',
    label_shy_coins: 'Shy \uCF54\uC778', label_shy_beans: 'Shy \uBE48\uC988',
    label_super_shy: '\uC288\uD37C \uC0E4\uC774', label_login_streak: '\uB85C\uADF8\uC778 \uC5F0\uC18D',
    status_banned: '\uCC28\uB2E8', status_active: '\uD65C\uC131', status_suspended: '\uC815\uC9C0', status_pending: '\uB300\uAE30',
    filter_pending: '\uB300\uAE30', filter_approved: '\uC2B9\uC778', filter_denied: '\uAC70\uBD80',
    filter_resolved: '\uD574\uACB0', filter_archived: '\uBCF4\uAD00',
    btn_approve: '\uC2B9\uC778', btn_deny: '\uAC70\uBD80', btn_resolve: '\uD574\uACB0',
    btn_save: '\uC800\uC7A5', btn_cancel: '\uCDE8\uC18C', btn_delete: '\uC0AD\uC81C', btn_apply: '\uC801\uC6A9',
    btn_refresh: '\uC0C8\uB85C\uACE0\uCE68', btn_load_more: '\uB354 \uBCF4\uAE30',
    msg_loading: '\uB85C\uB529 \uC911...', msg_no_data: '\uB370\uC774\uD130 \uC5C6\uC74C',
    msg_saved: '\uC800\uC7A5\uB428', msg_error: '\uC624\uB958',
    label_log_level: '\uB808\uBCA8', label_log_source: '\uC18C\uC2A4',
    btn_export_json: 'JSON \uB0B4\uBCF4\uB0B4\uAE30', btn_export_csv: 'CSV \uB0B4\uBCF4\uB0B4\uAE30',
    table_device_id: '\uAE30\uAE30 ID', table_user: '\uC0AC\uC6A9\uC790', table_model: '\uBAA8\uB378',
    table_os: 'OS', table_last_ip: '\uB9C8\uC9C0\uB9C9 IP', table_isp: 'ISP',
    table_country: '\uAD6D\uAC00', table_last_seen: '\uB9C8\uC9C0\uB9C9 \uC811\uC18D',
    confirm_reset_pin_lockout: '이 사용자의 PIN 잠금을 재설정하시겠습니까?',
    confirm_unsuspend_user: '이 사용자의 정지를 해제하시겠습니까? 계정이 완전히 복구됩니다.',
    confirm_reset_gcs: '이 사용자의 GCS를 100으로 재설정하고 모든 경고를 삭제하시겠습니까?',
    confirm_schedule_deletion: '이 계정 삭제를 예약하시겠습니까?',
    alert_deletion_scheduled: '계정 삭제가 예약되었습니다.',
    confirm_cancel_deletion: '예약된 계정 삭제를 취소하시겠습니까?',
    confirm_remove_all_device_bindings: '이 사용자의 모든 기기 바인딩을 제거하시겠습니까?',
    confirm_remove_device_ban: '이 기기 차단을 해제하시겠습니까?',
    confirm_remove_network_ban: '이 네트워크 차단을 해제하시겠습니까?',
    confirm_unban_device: '이 기기의 차단을 해제하시겠습니까?',
    confirm_ban_all_devices: '이 사용자의 모든 기기를 차단하시겠습니까?',
    confirm_remove_all_bans: '이 사용자의 모든 차단을 제거하시겠습니까?',
    confirm_unsuspend_identity_graph: '이 사용자의 신원 그래프 정지를 해제하시겠습니까?',
    alert_deletion_cancelled: '계정 삭제가 취소되었습니다.',
    confirm_clear_temp_id: '임시 ID를 지우시겠습니까?',
    confirm_revoke_warning: '이 경고를 철회하시겠습니까? +{deduction} GCS가 복구됩니다.',
    confirm_revoke_biometric: '기기 {deviceId}의 생체 인증 키를 철회하시겠습니까?',
    confirm_issue_warning: '"{reason}"에 대해 경고를 발급하시겠습니까 (심각도 {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: '삭제 예약 실패: {error}',
    alert_cancel_deletion_failed: '삭제 취소 실패: {error}',
    confirm_ban_ip: 'IP {ip}을(를) 차단하시겠습니까?',
    confirm_suspend_identity_graph: '이 사용자의 신원 그래프를 정지하시겠습니까 ({duration}, {scope})?',
    btn_searching: '검색 중...',
    btn_email_show: '표시',
    btn_email_hide: '숨기기',
    btn_email_saving: '저장 중…',
    btn_undo: '실행 취소',
    msg_no_warnings: '경고 없음',
    btn_revoke: '철회',
    toast_display_name_empty: '표시 이름은 비워둘 수 없습니다',
    toast_undo_successful: '실행 취소 성공',
    toast_already_in_list: '이미 목록에 있습니다',
    toast_autosave_failed: '자동 저장 실패: {error}',
    toast_undo_failed: '실행 취소 실패: {error}',
    status_suspended_badge: '{since}부터 {until}까지 정지됨. 사유: {reason}',
    status_not_suspended: '정지 안 됨',
    status_deletion_scheduled: '삭제 예약됨 — {days}일 남음 ({date})',
    status_severity_gcs: '심각도 {severity} (-{deduction} GCS)',
    msg_permanent: '영구',
    msg_no_reason_provided: '사유 없음',
    msg_suspended_since_until_format: '{since}부터 {until}까지 정지됨',
    inline_revoked: '취소됨',
    inline_warning_note: '메모: {note}',
    inline_warning_meta: '발급자: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}',
    toast_warning_revoked_gcs: '경고가 취소되었습니다. +{deduction} GCS가 복원되었습니다',
    toast_pin_lockout_reset: 'PIN 잠금이 초기화되었습니다',
    toast_biometric_revoked: '생체 인식 키가 취소되었습니다',
    toast_gcs_reset_100: 'GCS가 100으로 초기화되었습니다',
    toast_action_failed: '실패: {error}',
    btn_issuing: '발급 중...',
    btn_issue_warning: '경고 발급',
    btn_resetting: '재설정 중...',
    toast_reason_required: '사유가 필요합니다',
    toast_select_reason: '사유를 선택하세요',
    toast_no_user_loaded: '사용자가 로드되지 않았습니다',
    toast_device_bindings_removed: '{count}개의 기기 연결이 해제되었습니다',
    btn_reset_device_binding: '기기 연결 재설정',
    toast_auto_escalate_5_warnings: '이 사용자에게 경고가 5건 이상 있습니다. 정지를 고려하세요.',
    toast_no_ip_found: 'IP 주소를 찾을 수 없습니다',
    toast_banned_n_devices: '{count}개의 기기가 차단되었습니다',
    toast_removed_n_bans: '{count}개의 차단이 해제되었습니다',
    toast_partial_retry: '부분 완료: {summary}. 실패한 단계를 다시 시도하세요.',
    toast_user_suspended: '사용자가 정지되었습니다',
    toast_user_unsuspended: '사용자 정지가 해제되었습니다',
    toast_warning_issued_successfully: '경고가 성공적으로 발급되었습니다',
    toast_ip_banned: 'IP가 차단되었습니다',
    toast_identity_graph_suspended: '신원 그래프가 정지되었습니다',
    toast_identity_graph_unsuspended: '신원 그래프 정지가 해제되었습니다',
    prompt_deletion_reason: '계정 삭제 사유를 입력하세요 (선택):',
    prompt_ban_reason: '사유 (선택):',
    bio_device_label: '기기:',
    bio_registered_label: '등록됨:',
    segment_ban_call_failed: '{count}/{total} 차단 호출이 실패했습니다 (첫 번째: {error})',
    segment_pm_failed: '{count}/{total} PM 실패',
    toast_no_devices_to_ban: '차단할 기기가 없습니다',
    toast_enter_positive_amount: '양수를 입력하세요',
    toast_coins_added: '{amount} 코인이 추가되었습니다 (현재 {balance})',
    toast_coins_deducted: '{amount} 코인이 차감되었습니다 (현재 {balance})',
    toast_beans_added: '{amount} 빈이 추가되었습니다 (현재 {balance})',
    toast_beans_deducted: '{amount} 빈이 차감되었습니다 (현재 {balance})',
    toast_select_gift_qty: '선물을 선택하고 수량을 입력하세요',
    toast_gift_added: '{qty}개 추가되었습니다 (현재 총 {total})',
    toast_backpack_empty_already: '배낭이 이미 비어 있습니다',
    msg_loading_backpack: '배낭을 불러오는 중...',
    msg_backpack_empty: '배낭이 비어 있습니다',
    msg_no_matching_gifts: '일치하는 선물이 없습니다',
    btn_confirm_clear_all: '모두 지우기 확인',
    btn_confirming: '확인 ({countdown})',
    btn_clearing: '지우는 중...',
    toast_backpack_cleared: '배낭이 비워졌습니다 ({count}개 항목 제거됨)',
    toast_cleared_with_errors: '{cleared}개 지움, {errors}개 실패',
    toast_failed_to_save: '저장 실패: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "제안",
    // google-translated 2026-06-02
    tab_audit_log: "감사 로그",
    // google-translated 2026-06-02
    tab_age_segregation: "연령 분리",
    // google-translated 2026-06-02
    age_seg_title: "연령 분리",
    // google-translated 2026-06-02
    age_seg_subtitle: "영국 OSA 규정 준수를 위한 코호트 배포 및 재정의 제어.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "코호트 분포",
    // google-translated 2026-06-02
    age_seg_refresh: "새로 고치다",
    // google-translated 2026-06-02
    age_seg_adult: "성인",
    // google-translated 2026-06-02
    age_seg_minor: "미성년자",
    // google-translated 2026-06-02
    age_seg_missing: "누락된 집단",
    // google-translated 2026-06-02
    age_seg_total: "총 사용자",
    // google-translated 2026-06-02
    age_seg_override_adult: "재정의 → 성인",
    // override-translated 2026-06-02
    age_seg_override_minor: "재정의 → 미성년자",
    // google-translated 2026-06-02
    age_seg_override_heading: "코호트 재정의",
    // google-translated 2026-06-02
    age_seg_override_note: "재정의는 DOB 파생 코호트를 우회합니다. 직원 또는 관리자 계정에서만 허용됩니다. 모든 변경 사항은 제공된 이유와 함께 감사 기록됩니다.",
    // google-translated 2026-06-02
    age_seg_target_label: "대상 사용자 ID",
    // google-translated 2026-06-02
    age_seg_override_value_label: "새로운 집단",
    // google-translated 2026-06-02
    age_seg_pick: "- 선택하다 -",
    // google-translated 2026-06-02
    age_seg_clear: "재정의 지우기",
    // google-translated 2026-06-02
    age_seg_reason_label: "이유(필수, 500자 이하)",
    // google-translated 2026-06-02
    age_seg_apply: "재정의 적용",
    // google-translated 2026-06-02
    age_seg_confirm_title: "집단 재정의 확인",
    // google-translated 2026-06-02
    age_seg_confirm_body: "이 변경 사항은 감사 기록되며 대상 사용자의 토큰 새로 고침이 강제로 실행될 수 있습니다. 확인하기 전에 세부정보를 검토하세요.",
    // google-translated 2026-06-02
    age_seg_cancel: "취소",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "확인하다",
    // google-translated 2026-06-02
    subtab_identity: "신원",
    // google-translated 2026-06-02
    subtab_age_verification: "연령 확인",
    // google-translated 2026-06-02
    age_verif_panel_title: "연령 확인",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "사용자가 제출한 정부 발급 신분증을 검토하고 결정합니다. 승인은 사용자가 18세 이상임을 확인합니다. 거부는 18세 이하를 유지하고 이를 알립니다. ID에 다른 DOB가 표시되면 수정-DOB를 사용하여 기록을 수정하세요.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "이 사용자에 대해 보류 중인 확인 제출이 없습니다.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "시스템 전반에 걸쳐 보류 중인 기타 제출물:",
    // google-translated 2026-06-02
    age_verif_jump_next: "보류 중인 다음 항목으로 이동",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "결정이 기록되면 이미지가 파기됩니다.",
    // google-translated 2026-06-02
    age_verif_field_method: "ID 방법:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "기록된 생년월일:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "제출된 주소:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "제출 ID:",
    // google-translated 2026-06-02
    age_verif_match_question: "ID로 사용자의 생년월일을 확인할 수 있나요?",
    // google-translated 2026-06-02
    age_verif_match_yes: "예 — ID의 DOB가 기록된 값과 일치합니다.",
    // google-translated 2026-06-02
    age_verif_match_no: "아니요 - ID가 다른 DOB를 표시합니다.",
    // google-translated 2026-06-02
    age_verif_approve_help: "승인: 사용자가 18세 이상임을 확인합니다. 거부: 하위 18을 유지하고 이유와 함께 시스템 PM을 보냅니다.",
    // google-translated 2026-06-02
    age_verif_approve_button: "승인(확인 표시)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "대신 거절하세요…",
    // google-translated 2026-06-02
    age_verif_reject_button: "제출 거부",
    // google-translated 2026-06-02
    age_verif_modify_help: "ID에 표시된 값과 일치하도록 사용자의 DOB를 업데이트하세요. 사용자는 새로운 연령에 따라 자동으로 잠금 해제되거나 잠긴 상태로 유지됩니다.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "신분증의 생년월일:",
    // google-translated 2026-06-02
    age_verif_modify_button: "DOB 업데이트 및 결정",
  },
  nl: { tab_users: 'Gebruikers', tab_appeals: 'Bezwaren', tab_reports: 'Meldingen', tab_gifts: 'Cadeaus', tab_economy: 'Economie', tab_maintenance: 'Onderhoud', tab_monitor: 'Spin Monitor', tab_banners: 'Banners', tab_funfacts: 'Weetjes', tab_backups: 'Backups', tab_logs: 'Logboeken', tab_devices: 'Apparaten', tab_starting_screens: 'Startschermen', btn_sign_in: 'Inloggen', btn_sign_out: 'Uitloggen', btn_search: 'Zoeken', placeholder_search_uid: 'Voer gebruikers-ID in', subtab_profile: 'Profiel', subtab_moderation: 'Moderatie', subtab_security: 'Beveiliging', subtab_economy: 'Economie', label_uid: 'UID', label_display_name: 'Weergavenaam', label_user_type: 'Type', label_nationality: 'Nationaliteit', label_description: 'Beschrijving', label_email: 'E-mail', label_date_of_birth: 'Geboortedatum', label_unique_id: 'Uniek ID', btn_suspend_user: 'Opschorten', btn_unsuspend_user: 'Heractiveren', btn_warn: 'Waarschuwen', btn_reset_device: 'Apparaat resetten', btn_reset_gcs: 'GCS resetten', label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans', label_super_shy: 'Super Shy', label_login_streak: 'Inlogserie', status_banned: 'GEBLOKKEERD', status_active: 'Actief', status_suspended: 'Opgeschort', status_pending: 'In afwachting', filter_pending: 'In afwachting', filter_approved: 'Goedgekeurd', filter_denied: 'Geweigerd', filter_resolved: 'Opgelost', filter_archived: 'Gearchiveerd', btn_approve: 'Goedkeuren', btn_deny: 'Weigeren', btn_resolve: 'Oplossen', btn_save: 'Opslaan', btn_cancel: 'Annuleren', btn_delete: 'Verwijderen', btn_apply: 'Toepassen', btn_refresh: 'Vernieuwen', btn_load_more: 'Meer laden', msg_loading: 'Laden...', msg_no_data: 'Geen gegevens gevonden', msg_saved: 'Opgeslagen', msg_error: 'Fout', label_log_level: 'Niveau', label_log_source: 'Bron', btn_export_json: 'JSON exporteren', btn_export_csv: 'CSV exporteren', table_device_id: 'Apparaat-ID', table_user: 'Gebruiker', table_model: 'Model', table_os: 'OS', table_last_ip: 'Laatste IP', table_isp: 'ISP', table_country: 'Land', table_last_seen: 'Laatst gezien' , confirm_reset_pin_lockout: 'PIN-vergrendeling voor deze gebruiker resetten?', confirm_unsuspend_user: 'Schorsing voor deze gebruiker opheffen? Het account wordt volledig hersteld.', confirm_reset_gcs: 'GCS van deze gebruiker resetten naar 100 en alle waarschuwingen wissen?', confirm_schedule_deletion: 'Weet u zeker dat u dit account voor verwijdering wilt inplannen?', alert_deletion_scheduled: 'Verwijdering van account ingepland.', confirm_cancel_deletion: 'Geplande accountverwijdering annuleren?' , confirm_remove_all_device_bindings: 'Alle apparaatkoppelingen voor deze gebruiker verwijderen?', confirm_remove_device_ban: 'Deze apparaatban verwijderen?', confirm_remove_network_ban: 'Deze netwerkban verwijderen?', confirm_unban_device: 'Apparaat ontbannen?', confirm_ban_all_devices: 'Alle apparaten van deze gebruiker bannen?', confirm_remove_all_bans: 'Alle bans voor deze gebruiker verwijderen?', confirm_unsuspend_identity_graph: 'Schorsing van identiteitsgrafiek voor deze gebruiker opheffen?', alert_deletion_cancelled: 'Verwijdering van account geannuleerd.' , confirm_clear_temp_id: 'Tijdelijke ID wissen?' , confirm_revoke_warning: 'Deze waarschuwing intrekken? +{deduction} GCS wordt hersteld.', confirm_revoke_biometric: 'Biometrische sleutel voor apparaat {deviceId} intrekken?', confirm_issue_warning: 'Een waarschuwing afgeven voor "{reason}" (ernst {severity}, -{deduction} GCS)?', alert_schedule_deletion_failed: 'Verwijdering kon niet worden ingepland: {error}', alert_cancel_deletion_failed: 'Verwijdering kon niet worden geannuleerd: {error}', confirm_ban_ip: 'IP {ip} bannen?', confirm_suspend_identity_graph: 'Identiteitsgrafiek voor deze gebruiker schorsen ({duration}, {scope})?' , btn_searching: 'Zoeken...', btn_email_show: 'Tonen', btn_email_hide: 'Verbergen', btn_email_saving: 'Opslaan…', btn_undo: 'Ongedaan maken', msg_no_warnings: 'Geen waarschuwingen', btn_revoke: 'Intrekken', toast_display_name_empty: 'Weergavenaam mag niet leeg zijn', toast_undo_successful: 'Ongedaan maken gelukt', toast_already_in_list: 'Al in de lijst' , toast_autosave_failed: 'Automatisch opslaan mislukt: {error}', toast_undo_failed: 'Ongedaan maken mislukt: {error}', status_suspended_badge: 'Geschorst sinds {since}, tot {until}. Reden: {reason}', status_not_suspended: 'Niet geschorst', status_deletion_scheduled: 'Verwijdering gepland — nog {days} dagen ({date})', status_severity_gcs: 'Ernst {severity} (-{deduction} GCS)', msg_permanent: 'permanent', msg_no_reason_provided: 'Geen reden opgegeven', msg_suspended_since_until_format: 'Geschorst sinds {since}, tot {until}', inline_revoked: 'Ingetrokken', inline_warning_note: 'Notitie: {note}', inline_warning_meta: 'Door: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}', toast_warning_revoked_gcs: 'Waarschuwing ingetrokken, +{deduction} GCS hersteld', toast_pin_lockout_reset: 'PIN-vergrendeling gereset', toast_biometric_revoked: 'Biometrische sleutel ingetrokken', toast_gcs_reset_100: 'GCS gereset naar 100', toast_action_failed: 'Mislukt: {error}', btn_issuing: 'Wordt uitgegeven...', btn_issue_warning: 'Waarschuwing geven', btn_resetting: 'Bezig met resetten...', toast_reason_required: 'Reden is verplicht', toast_select_reason: 'Selecteer een reden', toast_no_user_loaded: 'Geen gebruiker geladen', toast_device_bindings_removed: '{count} apparaatkoppeling(en) verwijderd', btn_reset_device_binding: 'Apparaatkoppeling resetten', toast_auto_escalate_5_warnings: 'Deze gebruiker heeft 5+ waarschuwingen. Overweeg schorsing.', toast_no_ip_found: 'Geen IP-adres gevonden', toast_banned_n_devices: '{count} apparaat(en) verbannen', toast_removed_n_bans: '{count} verbanning(en) verwijderd', toast_partial_retry: 'Gedeeltelijk: {summary}. Probeer de mislukte stap opnieuw.', toast_user_suspended: 'Gebruiker geschorst', toast_user_unsuspended: 'Gebruikersschorsing opgeheven', toast_warning_issued_successfully: 'Waarschuwing succesvol uitgegeven', toast_ip_banned: 'IP verbannen', toast_identity_graph_suspended: 'Identiteitsgrafiek opgeschort', toast_identity_graph_unsuspended: 'Schorsing van identiteitsgrafiek opgeheven', prompt_deletion_reason: 'Voer de reden in voor accountverwijdering (optioneel):', prompt_ban_reason: 'Reden (optioneel):', bio_device_label: 'Apparaat:', bio_registered_label: 'Geregistreerd:', segment_ban_call_failed: '{count}/{total} ban-aanroep(en) mislukt (eerste: {error})', segment_pm_failed: '{count}/{total} PB\'s mislukt', toast_no_devices_to_ban: 'Geen apparaten om te verbannen', toast_enter_positive_amount: 'Voer een positief bedrag in', toast_coins_added: '{amount} munten toegevoegd (nu {balance})', toast_coins_deducted: '{amount} munten afgetrokken (nu {balance})', toast_beans_added: '{amount} beans toegevoegd (nu {balance})', toast_beans_deducted: '{amount} beans afgetrokken (nu {balance})', toast_select_gift_qty: 'Selecteer een geschenk en voer een aantal in', toast_gift_added: '{qty} toegevoegd (totaal nu {total})', toast_backpack_empty_already: 'Rugzak is al leeg', msg_loading_backpack: 'Rugzak laden...', msg_backpack_empty: 'Rugzak is leeg', msg_no_matching_gifts: 'Geen overeenkomende geschenken', btn_confirm_clear_all: 'Alles wissen bevestigen', btn_confirming: 'Bevestigen ({countdown})', btn_clearing: 'Wissen...', toast_backpack_cleared: 'Rugzak leeggemaakt ({count} items verwijderd)', toast_cleared_with_errors: '{cleared} gewist, {errors} mislukt', toast_failed_to_save: 'Opslaan mislukt: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Suggesties",
    // google-translated 2026-06-02
    tab_audit_log: "Auditlogboek",
    // google-translated 2026-06-02
    tab_age_segregation: "Segregatie op leeftijd",
    // google-translated 2026-06-02
    age_seg_title: "Segregatie op leeftijd",
    // google-translated 2026-06-02
    age_seg_subtitle: "Cohortdistributie en override-controles voor Britse OSA-naleving.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Cohortverdeling",
    // google-translated 2026-06-02
    age_seg_refresh: "Vernieuwen",
    // google-translated 2026-06-02
    age_seg_adult: "Volwassen",
    // google-translated 2026-06-02
    age_seg_minor: "Minderjarige",
    // google-translated 2026-06-02
    age_seg_missing: "Ontbrekend cohort",
    // google-translated 2026-06-02
    age_seg_total: "Totaal aantal gebruikers",
    // google-translated 2026-06-02
    age_seg_override_adult: "Overschrijven → volwassene",
    // override-translated 2026-06-02
    age_seg_override_minor: "Overschrijven → minderjarig",
    // google-translated 2026-06-02
    age_seg_override_heading: "Cohortoverschrijving",
    // google-translated 2026-06-02
    age_seg_override_note: "Overschrijvingen omzeilen het van DOB afkomstige cohort. Alleen toegestaan ​​op personeels- of beheerdersaccounts. Elke wijziging wordt bij een audit geregistreerd met de opgegeven reden.",
    // google-translated 2026-06-02
    age_seg_target_label: "Doelgebruikers-ID",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Nieuw cohort",
    // google-translated 2026-06-02
    age_seg_pick: "— kies —",
    // google-translated 2026-06-02
    age_seg_clear: "Overschrijving wissen",
    // google-translated 2026-06-02
    age_seg_reason_label: "Reden (vereist, ≤500 tekens)",
    // google-translated 2026-06-02
    age_seg_apply: "Overschrijving toepassen",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Cohortoverschrijving bevestigen",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Deze wijziging wordt bij een audit geregistreerd en kan een tokenvernieuwing voor de doelgebruiker afdwingen. Controleer de details voordat u bevestigt.",
    // google-translated 2026-06-02
    age_seg_cancel: "Annuleren",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Bevestigen",
    // google-translated 2026-06-02
    subtab_identity: "Identiteit",
    // google-translated 2026-06-02
    subtab_age_verification: "Leeftijdsverificatie",
    // google-translated 2026-06-02
    age_verif_panel_title: "Leeftijdsverificatie",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Controleer het ingediende overheids-ID van de gebruiker en beslis. Goedkeuren bevestigt dat de gebruiker 18+ is. Weigeren houdt ze onder de 18 en brengt ze op de hoogte. Als de ID een andere geboortedatum weergeeft, gebruikt u Modify-DOB om de record te corrigeren.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Er is geen verificatie-inzending in behandeling voor deze gebruiker.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Andere openstaande inzendingen in het systeem:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Ga naar de volgende in behandeling",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "Het beeld wordt vernietigd wanneer de beslissing wordt vastgelegd.",
    // google-translated 2026-06-02
    age_verif_field_method: "ID-methode:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "Opgenomen geboortedatum:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Ingediend bij:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "Inzendings-ID:",
    // google-translated 2026-06-02
    age_verif_match_question: "Bevestigt het identiteitsbewijs de geregistreerde geboortedatum van de gebruiker?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Ja: het geboortedatum op het ID komt overeen met de geregistreerde waarde",
    // google-translated 2026-06-02
    age_verif_match_no: "Nee: op het identiteitsbewijs staat een andere geboortedatum",
    // google-translated 2026-06-02
    age_verif_approve_help: "Goedkeuren: bevestigt dat de gebruiker 18+ is geverifieerd. Afwijzen: houdt ze onder de 18 en stuurt een systeem-PM met de reden.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Goedkeuren (markeren als geverifieerd)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "In plaats daarvan weigeren…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Inzending afwijzen",
    // google-translated 2026-06-02
    age_verif_modify_help: "Update het geboortedatum van de gebruiker zodat deze overeenkomt met de waarde die op de ID wordt weergegeven. De gebruiker wordt automatisch ontgrendeld of vergrendeld gehouden op basis van de nieuwe leeftijd.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Geboortedatum op identiteitsbewijs:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Update geboortedatum en beslis",
  },
  pl: { tab_users: 'Użytkownicy', tab_appeals: 'Odwołania', tab_reports: 'Zgłoszenia', tab_gifts: 'Prezenty', tab_economy: 'Ekonomia', tab_maintenance: 'Konserwacja', tab_monitor: 'Monitor losowań', tab_banners: 'Banery', tab_funfacts: 'Ciekawostki', tab_backups: 'Kopie zapasowe', tab_logs: 'Logi', tab_devices: 'Urządzenia', tab_starting_screens: 'Ekrany startowe', btn_sign_in: 'Zaloguj się', btn_sign_out: 'Wyloguj się', btn_search: 'Szukaj', placeholder_search_uid: 'Wpisz ID użytkownika', subtab_profile: 'Profil', subtab_moderation: 'Moderacja', subtab_security: 'Bezpieczeństwo', subtab_economy: 'Ekonomia', label_uid: 'UID', label_display_name: 'Wyświetlana nazwa', label_user_type: 'Typ', label_nationality: 'Narodowość', label_description: 'Opis', label_email: 'E-mail', label_date_of_birth: 'Data urodzenia', label_unique_id: 'Unikalny ID', btn_suspend_user: 'Zawieś', btn_unsuspend_user: 'Przywróć', btn_warn: 'Ostrzeżenie', btn_reset_device: 'Resetuj urządzenie', btn_reset_gcs: 'Resetuj GCS', label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans', label_super_shy: 'Super Shy', label_login_streak: 'Seria logowań', status_banned: 'ZBANOWANY', status_active: 'Aktywny', status_suspended: 'Zawieszony', status_pending: 'Oczekujący', filter_pending: 'Oczekujące', filter_approved: 'Zatwierdzone', filter_denied: 'Odrzucone', filter_resolved: 'Rozwiązane', filter_archived: 'Zarchiwizowane', btn_approve: 'Zatwierdź', btn_deny: 'Odrzuć', btn_resolve: 'Rozwiąż', btn_save: 'Zapisz', btn_cancel: 'Anuluj', btn_delete: 'Usuń', btn_apply: 'Zastosuj', btn_refresh: 'Odśwież', btn_load_more: 'Załaduj więcej', msg_loading: 'Ładowanie...', msg_no_data: 'Nie znaleziono danych', msg_saved: 'Zapisano', msg_error: 'Błąd', label_log_level: 'Poziom', label_log_source: 'Źródło', btn_export_json: 'Eksport JSON', btn_export_csv: 'Eksport CSV', table_device_id: 'ID urządzenia', table_user: 'Użytkownik', table_model: 'Model', table_os: 'OS', table_last_ip: 'Ostatni IP', table_isp: 'ISP', table_country: 'Kraj', table_last_seen: 'Ostatnio widziany' , confirm_reset_pin_lockout: 'Zresetować blokadę PIN dla tego użytkownika?', confirm_unsuspend_user: 'Zdjąć zawieszenie z tego użytkownika? Konto zostanie w pełni przywrócone.', confirm_reset_gcs: 'Zresetować GCS tego użytkownika do 100 i wyczyścić wszystkie ostrzeżenia?', confirm_schedule_deletion: 'Czy na pewno chcesz zaplanować usunięcie tego konta?', alert_deletion_scheduled: 'Usunięcie konta zaplanowane.', confirm_cancel_deletion: 'Anulować zaplanowane usunięcie konta?' , confirm_remove_all_device_bindings: 'Usunąć wszystkie powiązania urządzeń dla tego użytkownika?', confirm_remove_device_ban: 'Usunąć tę blokadę urządzenia?', confirm_remove_network_ban: 'Usunąć tę blokadę sieci?', confirm_unban_device: 'Odblokować to urządzenie?', confirm_ban_all_devices: 'Zablokować wszystkie urządzenia tego użytkownika?', confirm_remove_all_bans: 'Usunąć wszystkie blokady dla tego użytkownika?', confirm_unsuspend_identity_graph: 'Anulować zawieszenie grafu tożsamości dla tego użytkownika?', alert_deletion_cancelled: 'Usunięcie konta anulowane.' , confirm_clear_temp_id: 'Wyczyścić tymczasowy identyfikator?' , confirm_revoke_warning: 'Cofnąć to ostrzeżenie? Zostanie przywrócone +{deduction} GCS.', confirm_revoke_biometric: 'Cofnąć klucz biometryczny dla urządzenia {deviceId}?', confirm_issue_warning: 'Wystawić ostrzeżenie za "{reason}" (waga {severity}, -{deduction} GCS)?', alert_schedule_deletion_failed: 'Zaplanowanie usunięcia nie powiodło się: {error}', alert_cancel_deletion_failed: 'Anulowanie usunięcia nie powiodło się: {error}', confirm_ban_ip: 'Zablokować IP {ip}?', confirm_suspend_identity_graph: 'Zawiesić graf tożsamości dla tego użytkownika ({duration}, {scope})?' , btn_searching: 'Wyszukiwanie...', btn_email_show: 'Pokaż', btn_email_hide: 'Ukryj', btn_email_saving: 'Zapisywanie…', btn_undo: 'Cofnij', msg_no_warnings: 'Brak ostrzeżeń', btn_revoke: 'Cofnij', toast_display_name_empty: 'Nazwa wyświetlana nie może być pusta', toast_undo_successful: 'Pomyślnie cofnięto', toast_already_in_list: 'Już na liście' , toast_autosave_failed: 'Automatyczny zapis nie powiódł się: {error}', toast_undo_failed: 'Cofnięcie nie powiodło się: {error}', status_suspended_badge: 'Zawieszony od {since} do {until}. Powód: {reason}', status_not_suspended: 'Niezawieszony', status_deletion_scheduled: 'Usunięcie zaplanowane — pozostało {days} dni ({date})', status_severity_gcs: 'Waga {severity} (-{deduction} GCS)', msg_permanent: 'stały', msg_no_reason_provided: 'Nie podano powodu', msg_suspended_since_until_format: 'Zawieszony od {since} do {until}', inline_revoked: 'Cofnięte', inline_warning_note: 'Notatka: {note}', inline_warning_meta: 'Przez: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}', toast_warning_revoked_gcs: 'Ostrzeżenie cofnięte, przywrócono +{deduction} GCS', toast_pin_lockout_reset: 'Blokada PIN zresetowana', toast_biometric_revoked: 'Klucz biometryczny cofnięty', toast_gcs_reset_100: 'GCS zresetowany do 100', toast_action_failed: 'Nie powiodło się: {error}', btn_issuing: 'Wystawianie...', btn_issue_warning: 'Wystaw ostrzeżenie', btn_resetting: 'Resetowanie...', toast_reason_required: 'Powód jest wymagany', toast_select_reason: 'Wybierz powód', toast_no_user_loaded: 'Brak załadowanego użytkownika', toast_device_bindings_removed: 'Usunięto {count} powiązań urządzeń', btn_reset_device_binding: 'Resetuj powiązanie urządzenia', toast_auto_escalate_5_warnings: 'Ten użytkownik ma 5+ ostrzeżeń. Rozważ zawieszenie.', toast_no_ip_found: 'Nie znaleziono adresu IP', toast_banned_n_devices: 'Zbanowano {count} urządzeń', toast_removed_n_bans: 'Usunięto {count} banów', toast_partial_retry: 'Częściowo: {summary}. Spróbuj ponownie nieudanego kroku.', toast_user_suspended: 'Użytkownik zawieszony', toast_user_unsuspended: 'Zawieszenie użytkownika cofnięte', toast_warning_issued_successfully: 'Ostrzeżenie wystawione pomyślnie', toast_ip_banned: 'IP zbanowane', toast_identity_graph_suspended: 'Wykres tożsamości zawieszony', toast_identity_graph_unsuspended: 'Zawieszenie wykresu tożsamości cofnięte', prompt_deletion_reason: 'Wprowadź powód usunięcia konta (opcjonalnie):', prompt_ban_reason: 'Powód (opcjonalnie):', bio_device_label: 'Urządzenie:', bio_registered_label: 'Zarejestrowany:', segment_ban_call_failed: '{count}/{total} wywołań bana nie powiodło się (pierwszy: {error})', segment_pm_failed: '{count}/{total} PW nie powiodło się', toast_no_devices_to_ban: 'Brak urządzeń do zbanowania', toast_enter_positive_amount: 'Wprowadź dodatnią kwotę', toast_coins_added: 'Dodano {amount} monet (teraz {balance})', toast_coins_deducted: 'Odjęto {amount} monet (teraz {balance})', toast_beans_added: 'Dodano {amount} ziaren (teraz {balance})', toast_beans_deducted: 'Odjęto {amount} ziaren (teraz {balance})', toast_select_gift_qty: 'Wybierz prezent i wprowadź ilość', toast_gift_added: 'Dodano {qty} (łącznie teraz {total})', toast_backpack_empty_already: 'Plecak jest już pusty', msg_loading_backpack: 'Ładowanie plecaka...', msg_backpack_empty: 'Plecak jest pusty', msg_no_matching_gifts: 'Brak pasujących prezentów', btn_confirm_clear_all: 'Potwierdź wyczyszczenie wszystkiego', btn_confirming: 'Potwierdź ({countdown})', btn_clearing: 'Czyszczenie...', toast_backpack_cleared: 'Plecak wyczyszczony (usunięto {count} elementów)', toast_cleared_with_errors: 'Wyczyszczono {cleared}, nie powiodło się {errors}', toast_failed_to_save: 'Nie udało się zapisać: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Sugestie",
    // google-translated 2026-06-02
    tab_audit_log: "Dziennik audytu",
    // google-translated 2026-06-02
    tab_age_segregation: "Segregacja wiekowa",
    // google-translated 2026-06-02
    age_seg_title: "Segregacja wiekowa",
    // google-translated 2026-06-02
    age_seg_subtitle: "Dystrybucja kohort i kontrole obejścia w celu zapewnienia zgodności z brytyjskim OSA.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Dystrybucja kohortowa",
    // google-translated 2026-06-02
    age_seg_refresh: "Odświeżać",
    // google-translated 2026-06-02
    age_seg_adult: "Dorosły",
    // override-translated 2026-06-02
    age_seg_minor: "Niepełnoletni",
    // google-translated 2026-06-02
    age_seg_missing: "Brakująca kohorta",
    // google-translated 2026-06-02
    age_seg_total: "Całkowita liczba użytkowników",
    // google-translated 2026-06-02
    age_seg_override_adult: "Zastąp → dorosły",
    // override-translated 2026-06-02
    age_seg_override_minor: "Zastąp → niepełnoletni",
    // google-translated 2026-06-02
    age_seg_override_heading: "Zastąpienie kohorty",
    // google-translated 2026-06-02
    age_seg_override_note: "Zastępuje pominięcie kohorty pochodzącej z DOB. Dozwolone tylko na kontach personelu lub administratora. Każda zmiana jest rejestrowana w dzienniku audytu z podanym powodem.",
    // google-translated 2026-06-02
    age_seg_target_label: "Docelowy identyfikator użytkownika",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Nowa kohorta",
    // google-translated 2026-06-02
    age_seg_pick: "- wybierać -",
    // google-translated 2026-06-02
    age_seg_clear: "Wyczyść zastąpienie",
    // google-translated 2026-06-02
    age_seg_reason_label: "Powód (wymagany, ≤500 znaków)",
    // google-translated 2026-06-02
    age_seg_apply: "Zastosuj zastąpienie",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Potwierdź zastąpienie kohorty",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Ta zmiana jest rejestrowana w dzienniku audytu i może wymusić odświeżenie tokena na użytkowniku docelowym. Przed potwierdzeniem przejrzyj szczegóły.",
    // google-translated 2026-06-02
    age_seg_cancel: "Anulować",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Potwierdzać",
    // google-translated 2026-06-02
    subtab_identity: "Tożsamość",
    // google-translated 2026-06-02
    subtab_age_verification: "Weryfikacja wieku",
    // google-translated 2026-06-02
    age_verif_panel_title: "Weryfikacja wieku",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Przejrzyj przesłany przez użytkownika dokument tożsamości i podejmij decyzję. Zatwierdzenie potwierdza, że ​​użytkownik ma ukończone 18 lat. Odrzucenie zatrzymuje ich poniżej 18 roku życia i powiadamia ich. Jeśli identyfikator wskazuje inny DOB, użyj opcji Modify-DOB, aby poprawić rekord.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Brak oczekującego przesłania weryfikacji dla tego użytkownika.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Inne oczekujące zgłoszenia w systemie:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Przejdź do następnego oczekującego",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "Wizerunek ulega zniszczeniu w momencie zarejestrowania decyzji.",
    // google-translated 2026-06-02
    age_verif_field_method: "Metoda identyfikacji:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "Nagrana data urodzenia:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Przesłano pod adresem:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "Identyfikator zgłoszenia:",
    // google-translated 2026-06-02
    age_verif_match_question: "Czy dokument potwierdza zarejestrowaną datę urodzenia użytkownika?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Tak — DOB na identyfikatorze jest zgodny z zarejestrowaną wartością",
    // google-translated 2026-06-02
    age_verif_match_no: "Nie — identyfikator wskazuje inny DOB",
    // google-translated 2026-06-02
    age_verif_approve_help: "Zatwierdź: potwierdza, że ​​użytkownik ma ukończone 18 lat. Odrzuć: utrzymuje ich poniżej 18 lat i wysyła wiadomość PM systemu z powodem.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Zatwierdź (oznacz jako zweryfikowane)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Zamiast tego odrzuć…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Odrzuć przesłanie",
    // google-translated 2026-06-02
    age_verif_modify_help: "Zaktualizuj DOB użytkownika, aby był zgodny z wartością pokazaną w identyfikatorze. Użytkownik jest automatycznie odblokowywany lub blokowany w zależności od nowego wieku.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Data urodzenia w dowodzie osobistym:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Zaktualizuj DOB i zdecyduj",
  },
  pt: { tab_users: 'Usuários', tab_appeals: 'Recursos', tab_reports: 'Denúncias', tab_gifts: 'Presentes', tab_economy: 'Economia', tab_maintenance: 'Manutenção', tab_monitor: 'Monitor de giros', tab_banners: 'Banners', tab_funfacts: 'Curiosidades', tab_backups: 'Backups', tab_logs: 'Registros', tab_devices: 'Dispositivos', tab_starting_screens: 'Telas iniciais', btn_sign_in: 'Entrar', btn_sign_out: 'Sair', btn_search: 'Buscar', placeholder_search_uid: 'Digite o ID do usuário', subtab_profile: 'Perfil', subtab_moderation: 'Moderação', subtab_security: 'Segurança', subtab_economy: 'Economia', label_uid: 'UID', label_display_name: 'Nome', label_user_type: 'Tipo', label_nationality: 'Nacionalidade', label_description: 'Descrição', label_email: 'E-mail', label_date_of_birth: 'Data de nascimento', label_unique_id: 'ID único', btn_suspend_user: 'Suspender', btn_unsuspend_user: 'Reativar', btn_warn: 'Advertir', btn_reset_device: 'Redefinir dispositivo', btn_reset_gcs: 'Redefinir GCS', label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans', label_super_shy: 'Super Shy', label_login_streak: 'Sequência de login', status_banned: 'BANIDO', status_active: 'Ativo', status_suspended: 'Suspenso', status_pending: 'Pendente', filter_pending: 'Pendente', filter_approved: 'Aprovado', filter_denied: 'Negado', filter_resolved: 'Resolvido', filter_archived: 'Arquivado', btn_approve: 'Aprovar', btn_deny: 'Negar', btn_resolve: 'Resolver', btn_save: 'Salvar', btn_cancel: 'Cancelar', btn_delete: 'Excluir', btn_apply: 'Aplicar', btn_refresh: 'Atualizar', btn_load_more: 'Carregar mais', msg_loading: 'Carregando...', msg_no_data: 'Nenhum dado encontrado', msg_saved: 'Salvo', msg_error: 'Erro', label_log_level: 'Nível', label_log_source: 'Fonte', btn_export_json: 'Exportar JSON', btn_export_csv: 'Exportar CSV', table_device_id: 'ID dispositivo', table_user: 'Usuário', table_model: 'Modelo', table_os: 'SO', table_last_ip: 'Último IP', table_isp: 'ISP', table_country: 'País', table_last_seen: 'Último acesso' , confirm_reset_pin_lockout: 'Redefinir o bloqueio PIN deste usuário?', confirm_unsuspend_user: 'Reativar este usuário? A conta será totalmente restaurada.', confirm_reset_gcs: 'Redefinir o GCS deste usuário para 100 e limpar todos os avisos?', confirm_schedule_deletion: 'Tem certeza de que deseja agendar a exclusão desta conta?', alert_deletion_scheduled: 'Exclusão de conta agendada.', confirm_cancel_deletion: 'Cancelar a exclusão de conta agendada?' , confirm_remove_all_device_bindings: 'Remover todas as vinculações de dispositivos deste usuário?', confirm_remove_device_ban: 'Remover esta proibição de dispositivo?', confirm_remove_network_ban: 'Remover esta proibição de rede?', confirm_unban_device: 'Desbloquear este dispositivo?', confirm_ban_all_devices: 'Banir todos os dispositivos deste usuário?', confirm_remove_all_bans: 'Remover todas as proibições deste usuário?', confirm_unsuspend_identity_graph: 'Reativar o grafo de identidade deste usuário?', alert_deletion_cancelled: 'Exclusão de conta cancelada.' , confirm_clear_temp_id: 'Limpar o ID temporário?' , confirm_revoke_warning: 'Revogar este aviso? +{deduction} GCS serão restaurados.', confirm_revoke_biometric: 'Revogar chave biométrica para o dispositivo {deviceId}?', confirm_issue_warning: 'Emitir um aviso para "{reason}" (gravidade {severity}, -{deduction} GCS)?', alert_schedule_deletion_failed: 'Falha ao agendar exclusão: {error}', alert_cancel_deletion_failed: 'Falha ao cancelar exclusão: {error}', confirm_ban_ip: 'Banir IP {ip}?', confirm_suspend_identity_graph: 'Suspender o grafo de identidade deste usuário ({duration}, {scope})?' , btn_searching: 'Buscando...', btn_email_show: 'Mostrar', btn_email_hide: 'Ocultar', btn_email_saving: 'Salvando…', btn_undo: 'Desfazer', msg_no_warnings: 'Sem avisos', btn_revoke: 'Revogar', toast_display_name_empty: 'O nome de exibição não pode estar vazio', toast_undo_successful: 'Desfazer com sucesso', toast_already_in_list: 'Já está na lista' , toast_autosave_failed: 'Auto-salvar falhou: {error}', toast_undo_failed: 'Desfazer falhou: {error}', status_suspended_badge: 'Suspenso desde {since}, até {until}. Motivo: {reason}', status_not_suspended: 'Não suspenso', status_deletion_scheduled: 'Exclusão agendada — {days} dias restantes ({date})', status_severity_gcs: 'Gravidade {severity} (-{deduction} GCS)', msg_permanent: 'permanente', msg_no_reason_provided: 'Sem motivo informado', msg_suspended_since_until_format: 'Suspenso desde {since}, até {until}', inline_revoked: 'Revogado', inline_warning_note: 'Nota: {note}', inline_warning_meta: 'Por: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}', toast_warning_revoked_gcs: 'Aviso revogado, +{deduction} GCS restaurados', toast_pin_lockout_reset: 'Bloqueio de PIN redefinido', toast_biometric_revoked: 'Chave biométrica revogada', toast_gcs_reset_100: 'GCS redefinido para 100', toast_action_failed: 'Falhou: {error}', btn_issuing: 'Emitindo...', btn_issue_warning: 'Emitir aviso', btn_resetting: 'Redefinindo...', toast_reason_required: 'Motivo é obrigatório', toast_select_reason: 'Selecione um motivo', toast_no_user_loaded: 'Nenhum usuário carregado', toast_device_bindings_removed: 'Removidos {count} vínculo(s) de dispositivo', btn_reset_device_binding: 'Redefinir vínculo do dispositivo', toast_auto_escalate_5_warnings: 'Este usuário tem 5+ avisos. Considere suspender.', toast_no_ip_found: 'Nenhum endereço IP encontrado', toast_banned_n_devices: 'Banidos {count} dispositivo(s)', toast_removed_n_bans: 'Removidos {count} banimento(s)', toast_partial_retry: 'Parcial: {summary}. Tente novamente a etapa com falha.', toast_user_suspended: 'Usuário suspenso', toast_user_unsuspended: 'Suspensão do usuário removida', toast_warning_issued_successfully: 'Aviso emitido com sucesso', toast_ip_banned: 'IP banido', toast_identity_graph_suspended: 'Gráfico de identidade suspenso', toast_identity_graph_unsuspended: 'Suspensão do gráfico de identidade removida', prompt_deletion_reason: 'Insira o motivo da exclusão da conta (opcional):', prompt_ban_reason: 'Motivo (opcional):', bio_device_label: 'Dispositivo:', bio_registered_label: 'Registrado:', segment_ban_call_failed: '{count}/{total} chamada(s) de ban falharam (primeiro: {error})', segment_pm_failed: '{count}/{total} MPs falharam', toast_no_devices_to_ban: 'Nenhum dispositivo para banir', toast_enter_positive_amount: 'Insira um valor positivo', toast_coins_added: 'Adicionadas {amount} moedas (agora {balance})', toast_coins_deducted: 'Deduzidas {amount} moedas (agora {balance})', toast_beans_added: 'Adicionados {amount} beans (agora {balance})', toast_beans_deducted: 'Deduzidos {amount} beans (agora {balance})', toast_select_gift_qty: 'Selecione um presente e insira uma quantidade', toast_gift_added: 'Adicionados {qty} (total agora {total})', toast_backpack_empty_already: 'A mochila já está vazia', msg_loading_backpack: 'Carregando mochila...', msg_backpack_empty: 'A mochila está vazia', msg_no_matching_gifts: 'Nenhum presente correspondente', btn_confirm_clear_all: 'Confirmar limpar tudo', btn_confirming: 'Confirmar ({countdown})', btn_clearing: 'Limpando...', toast_backpack_cleared: 'Mochila esvaziada ({count} itens removidos)', toast_cleared_with_errors: 'Limpos {cleared}, falharam {errors}', toast_failed_to_save: 'Falha ao salvar: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Sugestões",
    // google-translated 2026-06-02
    tab_audit_log: "Registro de auditoria",
    // google-translated 2026-06-02
    tab_age_segregation: "Segregação etária",
    // google-translated 2026-06-02
    age_seg_title: "Segregação etária",
    // google-translated 2026-06-02
    age_seg_subtitle: "Distribuição de coorte e controles de substituição para conformidade com OSA no Reino Unido.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Distribuição de coorte",
    // google-translated 2026-06-02
    age_seg_refresh: "Atualizar",
    // google-translated 2026-06-02
    age_seg_adult: "Adulto",
    // google-translated 2026-06-02
    age_seg_minor: "Menor",
    // google-translated 2026-06-02
    age_seg_missing: "Coorte ausente",
    // google-translated 2026-06-02
    age_seg_total: "Total de usuários",
    // google-translated 2026-06-02
    age_seg_override_adult: "Substituir → adulto",
    // google-translated 2026-06-02
    age_seg_override_minor: "Substituir → menor",
    // google-translated 2026-06-02
    age_seg_override_heading: "Substituição de coorte",
    // google-translated 2026-06-02
    age_seg_override_note: "As substituições ignoram a coorte derivada de DOB. Permitido apenas em contas de funcionários ou administradores. Cada alteração é registrada em log de auditoria com o motivo fornecido.",
    // google-translated 2026-06-02
    age_seg_target_label: "ID do usuário de destino",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Nova coorte",
    // google-translated 2026-06-02
    age_seg_pick: "- escolha -",
    // google-translated 2026-06-02
    age_seg_clear: "Limpar substituição",
    // google-translated 2026-06-02
    age_seg_reason_label: "Motivo (obrigatório, ≤500 caracteres)",
    // google-translated 2026-06-02
    age_seg_apply: "Aplicar substituição",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Confirmar substituição de coorte",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Essa alteração é registrada em log de auditoria e pode forçar uma atualização de token no usuário de destino. Revise os detalhes antes de confirmar.",
    // google-translated 2026-06-02
    age_seg_cancel: "Cancelar",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Confirmar",
    // google-translated 2026-06-02
    subtab_identity: "Identidade",
    // google-translated 2026-06-02
    subtab_age_verification: "Verificação de idade",
    // google-translated 2026-06-02
    age_verif_panel_title: "Verificação de idade",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Revise a identificação governamental enviada pelo usuário e decida. Aprovar confirma que o usuário tem mais de 18 anos. Rejeitar os mantém com menos de 18 anos e os notifica. Se o ID mostrar um DOB diferente, use Modify-DOB para corrigir o registro.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Nenhum envio de verificação pendente para este usuário.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Outros envios pendentes em todo o sistema:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Ir para a próxima pendência",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "A imagem é destruída quando a decisão é registrada.",
    // google-translated 2026-06-02
    age_verif_field_method: "Método de identificação:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "Data de nascimento registrada:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Enviado em:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "ID de envio:",
    // google-translated 2026-06-02
    age_verif_match_question: "O documento de identidade confirma a data de nascimento registrada do usuário?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Sim — o DOB ​​no ID corresponde ao valor registrado",
    // google-translated 2026-06-02
    age_verif_match_no: "Não – o ID mostra uma data de nascimento diferente",
    // google-translated 2026-06-02
    age_verif_approve_help: "Aprovar: confirma o usuário como maior de 18 anos verificado. Rejeitar: mantém menores de 18 anos e envia uma PM do sistema com o motivo.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Aprovar (marcar verificado)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Em vez disso, rejeite…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Rejeitar envio",
    // google-translated 2026-06-02
    age_verif_modify_help: "Atualize o DOB ​​do usuário para corresponder ao valor mostrado no ID. O usuário é desbloqueado ou mantido bloqueado automaticamente com base na nova era.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Data de nascimento no documento de identidade:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Atualizar data de nascimento e decidir",
  },
  ru: { tab_users: '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438', tab_appeals: '\u0410\u043F\u0435\u043B\u043B\u044F\u0446\u0438\u0438', tab_reports: '\u0416\u0430\u043B\u043E\u0431\u044B', tab_gifts: '\u041F\u043E\u0434\u0430\u0440\u043A\u0438', tab_economy: '\u042D\u043A\u043E\u043D\u043E\u043C\u0438\u043A\u0430', tab_maintenance: '\u041E\u0431\u0441\u043B\u0443\u0436\u0438\u0432\u0430\u043D\u0438\u0435', tab_monitor: '\u041C\u043E\u043D\u0438\u0442\u043E\u0440 \u0432\u0440\u0430\u0449\u0435\u043D\u0438\u0439', tab_banners: '\u0411\u0430\u043D\u043D\u0435\u0440\u044B', tab_funfacts: '\u0418\u043D\u0442\u0435\u0440\u0435\u0441\u043D\u044B\u0435 \u0444\u0430\u043A\u0442\u044B', tab_backups: '\u0420\u0435\u0437\u0435\u0440\u0432\u043D\u044B\u0435 \u043A\u043E\u043F\u0438\u0438', tab_logs: '\u0416\u0443\u0440\u043D\u0430\u043B\u044B', tab_devices: '\u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430', tab_starting_screens: '\u0421\u0442\u0430\u0440\u0442\u043E\u0432\u044B\u0435 \u044D\u043A\u0440\u0430\u043D\u044B', btn_sign_in: '\u0412\u043E\u0439\u0442\u0438', btn_sign_out: '\u0412\u044B\u0439\u0442\u0438', btn_search: '\u041F\u043E\u0438\u0441\u043A', placeholder_search_uid: '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 ID \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F', subtab_profile: '\u041F\u0440\u043E\u0444\u0438\u043B\u044C', subtab_moderation: '\u041C\u043E\u0434\u0435\u0440\u0430\u0446\u0438\u044F', subtab_security: '\u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C', subtab_economy: '\u042D\u043A\u043E\u043D\u043E\u043C\u0438\u043A\u0430', label_uid: 'UID', label_display_name: '\u0418\u043C\u044F', label_user_type: '\u0422\u0438\u043F', label_nationality: '\u041D\u0430\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u044C', label_description: '\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435', label_email: '\u042D\u043B. \u043F\u043E\u0447\u0442\u0430', label_date_of_birth: '\u0414\u0430\u0442\u0430 \u0440\u043E\u0436\u0434\u0435\u043D\u0438\u044F', label_unique_id: '\u0423\u043D\u0438\u043A\u0430\u043B\u044C\u043D\u044B\u0439 ID', btn_suspend_user: '\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C', btn_unsuspend_user: '\u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C', btn_warn: '\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0434\u0438\u0442\u044C', btn_reset_device: '\u0421\u0431\u0440\u043E\u0441 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430', btn_reset_gcs: '\u0421\u0431\u0440\u043E\u0441 GCS', label_shy_coins: 'Shy \u043C\u043E\u043D\u0435\u0442\u044B', label_shy_beans: 'Shy \u0431\u043E\u0431\u044B', label_super_shy: '\u0421\u0443\u043F\u0435\u0440 \u0428\u0430\u0439', label_login_streak: '\u0421\u0435\u0440\u0438\u044F \u0432\u0445\u043E\u0434\u043E\u0432', status_banned: '\u0417\u0410\u0411\u0410\u041D\u0415\u041D', status_active: '\u0410\u043A\u0442\u0438\u0432\u0435\u043D', status_suspended: '\u041F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D', status_pending: '\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435', filter_pending: '\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435', filter_approved: '\u041E\u0434\u043E\u0431\u0440\u0435\u043D\u043E', filter_denied: '\u041E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u043E', filter_resolved: '\u0420\u0435\u0448\u0435\u043D\u043E', filter_archived: '\u0412 \u0430\u0440\u0445\u0438\u0432\u0435', btn_approve: '\u041E\u0434\u043E\u0431\u0440\u0438\u0442\u044C', btn_deny: '\u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C', btn_resolve: '\u0420\u0435\u0448\u0438\u0442\u044C', btn_save: '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C', btn_cancel: '\u041E\u0442\u043C\u0435\u043D\u0430', btn_delete: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C', btn_apply: '\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C', btn_refresh: '\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C', btn_load_more: '\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0435\u0449\u0451', msg_loading: '\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...', msg_no_data: '\u0414\u0430\u043D\u043D\u044B\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B', msg_saved: '\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E', msg_error: '\u041E\u0448\u0438\u0431\u043A\u0430', label_log_level: '\u0423\u0440\u043E\u0432\u0435\u043D\u044C', label_log_source: '\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A', btn_export_json: '\u042D\u043A\u0441\u043F\u043E\u0440\u0442 JSON', btn_export_csv: '\u042D\u043A\u0441\u043F\u043E\u0440\u0442 CSV', table_device_id: 'ID \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430', table_user: '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C', table_model: '\u041C\u043E\u0434\u0435\u043B\u044C', table_os: 'OC', table_last_ip: '\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 IP', table_isp: '\u041F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440', table_country: '\u0421\u0442\u0440\u0430\u043D\u0430', table_last_seen: '\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0432\u0445\u043E\u0434' , confirm_reset_pin_lockout: 'Сбросить блокировку PIN для этого пользователя?', confirm_unsuspend_user: 'Снять блокировку с этого пользователя? Учётная запись будет полностью восстановлена.', confirm_reset_gcs: 'Сбросить GCS этого пользователя на 100 и удалить все предупреждения?', confirm_schedule_deletion: 'Вы уверены, что хотите запланировать удаление этой учётной записи?', alert_deletion_scheduled: 'Удаление учётной записи запланировано.', confirm_cancel_deletion: 'Отменить запланированное удаление учётной записи?' , confirm_remove_all_device_bindings: 'Удалить все привязки устройств для этого пользователя?', confirm_remove_device_ban: 'Снять блокировку этого устройства?', confirm_remove_network_ban: 'Снять блокировку этой сети?', confirm_unban_device: 'Разблокировать это устройство?', confirm_ban_all_devices: 'Заблокировать все устройства этого пользователя?', confirm_remove_all_bans: 'Снять все блокировки с этого пользователя?', confirm_unsuspend_identity_graph: 'Снять блокировку графа идентификации этого пользователя?', alert_deletion_cancelled: 'Удаление учётной записи отменено.' , confirm_clear_temp_id: 'Очистить временный ID?' , confirm_revoke_warning: 'Отозвать это предупреждение? +{deduction} GCS будет восстановлено.', confirm_revoke_biometric: 'Отозвать биометрический ключ для устройства {deviceId}?', confirm_issue_warning: 'Выдать предупреждение за "{reason}" (серьёзность {severity}, -{deduction} GCS)?', alert_schedule_deletion_failed: 'Не удалось запланировать удаление: {error}', alert_cancel_deletion_failed: 'Не удалось отменить удаление: {error}', confirm_ban_ip: 'Заблокировать IP {ip}?', confirm_suspend_identity_graph: 'Заблокировать граф идентификации этого пользователя ({duration}, {scope})?' , btn_searching: 'Поиск...', btn_email_show: 'Показать', btn_email_hide: 'Скрыть', btn_email_saving: 'Сохранение…', btn_undo: 'Отменить', msg_no_warnings: 'Нет предупреждений', btn_revoke: 'Отозвать', toast_display_name_empty: 'Отображаемое имя не может быть пустым', toast_undo_successful: 'Отмена выполнена', toast_already_in_list: 'Уже в списке' , toast_autosave_failed: 'Автосохранение не удалось: {error}', toast_undo_failed: 'Отмена не удалась: {error}', status_suspended_badge: 'Заблокирован с {since} до {until}. Причина: {reason}', status_not_suspended: 'Не заблокирован', status_deletion_scheduled: 'Удаление запланировано — осталось {days} дн. ({date})', status_severity_gcs: 'Серьёзность {severity} (-{deduction} GCS)', msg_permanent: 'постоянно', msg_no_reason_provided: 'Причина не указана', msg_suspended_since_until_format: 'Заблокирован с {since} до {until}', inline_revoked: 'Отозвано', inline_warning_note: 'Заметка: {note}', inline_warning_meta: 'Кем: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}', toast_warning_revoked_gcs: 'Предупреждение отозвано, восстановлено +{deduction} GCS', toast_pin_lockout_reset: 'Блокировка PIN сброшена', toast_biometric_revoked: 'Биометрический ключ отозван', toast_gcs_reset_100: 'GCS сброшен до 100', toast_action_failed: 'Ошибка: {error}', btn_issuing: 'Выдача...', btn_issue_warning: 'Выдать предупреждение', btn_resetting: 'Сброс...', toast_reason_required: 'Требуется причина', toast_select_reason: 'Выберите причину', toast_no_user_loaded: 'Пользователь не загружен', toast_device_bindings_removed: 'Удалено {count} привязок устройств', btn_reset_device_binding: 'Сбросить привязку устройства', toast_auto_escalate_5_warnings: 'У этого пользователя 5+ предупреждений. Рассмотрите блокировку.', toast_no_ip_found: 'IP-адрес не найден', toast_banned_n_devices: 'Заблокировано {count} устройств', toast_removed_n_bans: 'Удалено {count} блокировок', toast_partial_retry: 'Частично: {summary}. Повторите неудачный шаг.', toast_user_suspended: 'Пользователь заблокирован', toast_user_unsuspended: 'Блокировка пользователя снята', toast_warning_issued_successfully: 'Предупреждение успешно выдано', toast_ip_banned: 'IP заблокирован', toast_identity_graph_suspended: 'Граф идентичности заблокирован', toast_identity_graph_unsuspended: 'Блокировка графа идентичности снята', prompt_deletion_reason: 'Введите причину удаления аккаунта (необязательно):', prompt_ban_reason: 'Причина (необязательно):', bio_device_label: 'Устройство:', bio_registered_label: 'Зарегистрирован:', segment_ban_call_failed: '{count}/{total} вызовов блокировки не удалось (первый: {error})', segment_pm_failed: '{count}/{total} ЛС не удалось', toast_no_devices_to_ban: 'Нет устройств для блокировки', toast_enter_positive_amount: 'Введите положительное число', toast_coins_added: 'Добавлено {amount} монет (сейчас {balance})', toast_coins_deducted: 'Списано {amount} монет (сейчас {balance})', toast_beans_added: 'Добавлено {amount} бинов (сейчас {balance})', toast_beans_deducted: 'Списано {amount} бинов (сейчас {balance})', toast_select_gift_qty: 'Выберите подарок и введите количество', toast_gift_added: 'Добавлено {qty} (всего сейчас {total})', toast_backpack_empty_already: 'Рюкзак уже пуст', msg_loading_backpack: 'Загрузка рюкзака...', msg_backpack_empty: 'Рюкзак пуст', msg_no_matching_gifts: 'Подходящих подарков нет', btn_confirm_clear_all: 'Подтвердить очистку', btn_confirming: 'Подтвердить ({countdown})', btn_clearing: 'Очистка...', toast_backpack_cleared: 'Рюкзак очищен (удалено {count} предметов)', toast_cleared_with_errors: 'Очищено {cleared}, не удалось {errors}', toast_failed_to_save: 'Не удалось сохранить: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Предложения",
    // google-translated 2026-06-02
    tab_audit_log: "Журнал аудита",
    // google-translated 2026-06-02
    tab_age_segregation: "Возрастная сегрегация",
    // google-translated 2026-06-02
    age_seg_title: "Возрастная сегрегация",
    // google-translated 2026-06-02
    age_seg_subtitle: "Распределение когорт и контроль над соблюдением требований OSA в Великобритании.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Распределение когорт",
    // google-translated 2026-06-02
    age_seg_refresh: "Обновить",
    // google-translated 2026-06-02
    age_seg_adult: "Взрослый",
    // override-translated 2026-06-02
    age_seg_minor: "Несовершеннолетний",
    // google-translated 2026-06-02
    age_seg_missing: "Отсутствующая когорта",
    // google-translated 2026-06-02
    age_seg_total: "Всего пользователей",
    // google-translated 2026-06-02
    age_seg_override_adult: "Переопределить → взрослый",
    // override-translated 2026-06-02
    age_seg_override_minor: "Переопределить → несовершеннолетний",
    // google-translated 2026-06-02
    age_seg_override_heading: "Переопределение когорты",
    // google-translated 2026-06-02
    age_seg_override_note: "Переопределения обходят когорту, полученную из DOB. Разрешено только для учетных записей сотрудников или администраторов. Каждое изменение регистрируется в журнале аудита с указанием причины.",
    // google-translated 2026-06-02
    age_seg_target_label: "Целевой идентификатор пользователя",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Новая когорта",
    // google-translated 2026-06-02
    age_seg_pick: "- выбирать -",
    // google-translated 2026-06-02
    age_seg_clear: "Очистить переопределение",
    // google-translated 2026-06-02
    age_seg_reason_label: "Причина (обязательно, не более 500 символов)",
    // google-translated 2026-06-02
    age_seg_apply: "Применить переопределение",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Подтвердить переопределение когорты",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Это изменение регистрируется в журнале аудита и может привести к принудительному обновлению токена целевого пользователя. Перед подтверждением проверьте детали.",
    // google-translated 2026-06-02
    age_seg_cancel: "Отмена",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Подтверждать",
    // google-translated 2026-06-02
    subtab_identity: "Личность",
    // google-translated 2026-06-02
    subtab_age_verification: "Проверка возраста",
    // google-translated 2026-06-02
    age_verif_panel_title: "Проверка возраста",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Просмотрите предоставленный пользователем государственный идентификатор и примите решение. Одобрение подтверждает, что пользователю исполнилось 18 лет. Отклонение сохраняет их до 18 лет и уведомляет их. Если идентификатор показывает другую дату рождения, используйте Modify-DOB, чтобы исправить запись.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Для этого пользователя нет ожидающих подтверждения.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Другие ожидающие отправки в системе:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Перейти к следующему ожидающему",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "Изображение уничтожается при записи решения.",
    // google-translated 2026-06-02
    age_verif_field_method: "Метод идентификации:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "Записано дата рождения:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Отправлено по адресу:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "Идентификатор отправки:",
    // google-translated 2026-06-02
    age_verif_match_question: "Подтверждает ли идентификатор зарегистрированную дату рождения пользователя?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Да — дата рождения в идентификаторе соответствует записанному значению.",
    // google-translated 2026-06-02
    age_verif_match_no: "Нет — в идентификаторе указан другой день рождения.",
    // google-translated 2026-06-02
    age_verif_approve_help: "Утвердить: подтверждает, что пользователь имеет подтвержденный возраст 18+. Отклонить: оставляет им младше 18 лет и отправляет системное сообщение с указанием причины.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Одобрить (отметить как проверенное)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Вместо этого отклоните…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Отклонить отправку",
    // google-translated 2026-06-02
    age_verif_modify_help: "Обновите DOB пользователя, чтобы он соответствовал значению, указанному в идентификаторе. Пользователь разблокируется или остается заблокированным автоматически в зависимости от нового возраста.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Дата рождения в удостоверении личности:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Обновите дату рождения и примите решение",
  },
  sv: { tab_users: 'Användare', tab_appeals: 'Överklaganden', tab_reports: 'Rapporter', tab_gifts: 'Gåvor', tab_economy: 'Ekonomi', tab_maintenance: 'Underhåll', tab_monitor: 'Snurrmonitor', tab_banners: 'Banderoller', tab_funfacts: 'Fakta', tab_backups: 'Säkerhetskopior', tab_logs: 'Loggar', tab_devices: 'Enheter', tab_starting_screens: 'Startskärmar', btn_sign_in: 'Logga in', btn_sign_out: 'Logga ut', btn_search: 'Sök', placeholder_search_uid: 'Ange användar-ID', subtab_profile: 'Profil', subtab_moderation: 'Moderering', subtab_security: 'Säkerhet', subtab_economy: 'Ekonomi', label_uid: 'UID', label_display_name: 'Visningsnamn', label_user_type: 'Typ', label_nationality: 'Nationalitet', label_description: 'Beskrivning', label_email: 'E-post', label_date_of_birth: 'Födelsedatum', label_unique_id: 'Unikt ID', btn_suspend_user: 'Stäng av', btn_unsuspend_user: 'Återaktivera', btn_warn: 'Varna', btn_reset_device: 'Återställ enhet', btn_reset_gcs: 'Återställ GCS', label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans', label_super_shy: 'Super Shy', label_login_streak: 'Inloggningsserie', status_banned: 'BANNAD', status_active: 'Aktiv', status_suspended: 'Avstängd', status_pending: 'Väntande', filter_pending: 'Väntande', filter_approved: 'Godkänd', filter_denied: 'Nekad', filter_resolved: 'Löst', filter_archived: 'Arkiverad', btn_approve: 'Godkänn', btn_deny: 'Neka', btn_resolve: 'Lös', btn_save: 'Spara', btn_cancel: 'Avbryt', btn_delete: 'Ta bort', btn_apply: 'Tillämpa', btn_refresh: 'Uppdatera', btn_load_more: 'Ladda mer', msg_loading: 'Laddar...', msg_no_data: 'Ingen data hittades', msg_saved: 'Sparat', msg_error: 'Fel', label_log_level: 'Nivå', label_log_source: 'Källa', btn_export_json: 'Exportera JSON', btn_export_csv: 'Exportera CSV', table_device_id: 'Enhets-ID', table_user: 'Användare', table_model: 'Modell', table_os: 'OS', table_last_ip: 'Senaste IP', table_isp: 'ISP', table_country: 'Land', table_last_seen: 'Senast sedd' , confirm_reset_pin_lockout: 'Återställa PIN-låsningen för denna användare?', confirm_unsuspend_user: 'Häva avstängningen för denna användare? Kontot återställs helt.', confirm_reset_gcs: 'Återställa denna användares GCS till 100 och rensa alla varningar?', confirm_schedule_deletion: 'Är du säker på att du vill schemalägga att radera detta konto?', alert_deletion_scheduled: 'Kontoborttagning schemalagd.', confirm_cancel_deletion: 'Avbryta schemalagd kontoborttagning?' , confirm_remove_all_device_bindings: 'Ta bort alla enhetsbindningar för denna användare?', confirm_remove_device_ban: 'Ta bort denna enhetsblockering?', confirm_remove_network_ban: 'Ta bort denna nätverksblockering?', confirm_unban_device: 'Häva blockeringen för enheten?', confirm_ban_all_devices: 'Blockera alla enheter för denna användare?', confirm_remove_all_bans: 'Ta bort alla blockeringar för denna användare?', confirm_unsuspend_identity_graph: 'Häva avstängningen av identitetsgrafen för denna användare?', alert_deletion_cancelled: 'Kontoborttagning avbruten.' , confirm_clear_temp_id: 'Rensa det tillfälliga ID:t?' , confirm_revoke_warning: 'Återkalla denna varning? +{deduction} GCS återställs.', confirm_revoke_biometric: 'Återkalla biometrisk nyckel för enhet {deviceId}?', confirm_issue_warning: 'Utfärda en varning för "{reason}" (allvarlighet {severity}, -{deduction} GCS)?', alert_schedule_deletion_failed: 'Det gick inte att schemalägga radering: {error}', alert_cancel_deletion_failed: 'Det gick inte att avbryta raderingen: {error}', confirm_ban_ip: 'Blockera IP {ip}?', confirm_suspend_identity_graph: 'Stänga av identitetsgrafen för denna användare ({duration}, {scope})?' , btn_searching: 'Söker...', btn_email_show: 'Visa', btn_email_hide: 'Dölj', btn_email_saving: 'Sparar…', btn_undo: 'Ångra', msg_no_warnings: 'Inga varningar', btn_revoke: 'Återkalla', toast_display_name_empty: 'Visningsnamn får inte vara tomt', toast_undo_successful: 'Ångra lyckades', toast_already_in_list: 'Redan i listan' , toast_autosave_failed: 'Autospar misslyckades: {error}', toast_undo_failed: 'Ångra misslyckades: {error}', status_suspended_badge: 'Avstängd sedan {since}, fram till {until}. Skäl: {reason}', status_not_suspended: 'Ej avstängd', status_deletion_scheduled: 'Borttagning schemalagd — {days} dagar kvar ({date})', status_severity_gcs: 'Allvarlighet {severity} (-{deduction} GCS)', msg_permanent: 'permanent', msg_no_reason_provided: 'Inget skäl angivet', msg_suspended_since_until_format: 'Avstängd sedan {since}, fram till {until}', inline_revoked: 'Återkallad', inline_warning_note: 'Anteckning: {note}', inline_warning_meta: 'Av: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}', toast_warning_revoked_gcs: 'Varning återkallad, +{deduction} GCS återställd', toast_pin_lockout_reset: 'PIN-låsning återställd', toast_biometric_revoked: 'Biometrisk nyckel återkallad', toast_gcs_reset_100: 'GCS återställd till 100', toast_action_failed: 'Misslyckades: {error}', btn_issuing: 'Utfärdar...', btn_issue_warning: 'Utfärda varning', btn_resetting: 'Återställer...', toast_reason_required: 'Anledning krävs', toast_select_reason: 'Välj en anledning', toast_no_user_loaded: 'Ingen användare laddad', toast_device_bindings_removed: 'Tog bort {count} enhetsbindning(ar)', btn_reset_device_binding: 'Återställ enhetsbindning', toast_auto_escalate_5_warnings: 'Denna användare har 5+ varningar. Överväg avstängning.', toast_no_ip_found: 'Ingen IP-adress hittades', toast_banned_n_devices: 'Bannade {count} enhet(er)', toast_removed_n_bans: 'Tog bort {count} bannlysning(ar)', toast_partial_retry: 'Delvis: {summary}. Försök igen med det misslyckade steget.', toast_user_suspended: 'Användare avstängd', toast_user_unsuspended: 'Användaravstängning hävd', toast_warning_issued_successfully: 'Varning utfärdad', toast_ip_banned: 'IP bannlyst', toast_identity_graph_suspended: 'Identitetsgraf avstängd', toast_identity_graph_unsuspended: 'Identitetsgraf-avstängning hävd', prompt_deletion_reason: 'Ange anledning för kontoradering (valfritt):', prompt_ban_reason: 'Anledning (valfritt):', bio_device_label: 'Enhet:', bio_registered_label: 'Registrerad:', segment_ban_call_failed: '{count}/{total} bannlysningsanrop misslyckades (första: {error})', segment_pm_failed: '{count}/{total} PM misslyckades', toast_no_devices_to_ban: 'Inga enheter att banna', toast_enter_positive_amount: 'Ange ett positivt belopp', toast_coins_added: 'Lade till {amount} mynt (nu {balance})', toast_coins_deducted: 'Drog av {amount} mynt (nu {balance})', toast_beans_added: 'Lade till {amount} beans (nu {balance})', toast_beans_deducted: 'Drog av {amount} beans (nu {balance})', toast_select_gift_qty: 'Välj en gåva och ange en kvantitet', toast_gift_added: 'Lade till {qty} (totalt nu {total})', toast_backpack_empty_already: 'Ryggsäcken är redan tom', msg_loading_backpack: 'Laddar ryggsäck...', msg_backpack_empty: 'Ryggsäcken är tom', msg_no_matching_gifts: 'Inga matchande gåvor', btn_confirm_clear_all: 'Bekräfta rensa allt', btn_confirming: 'Bekräfta ({countdown})', btn_clearing: 'Rensar...', toast_backpack_cleared: 'Ryggsäcken tömd ({count} föremål borttagna)', toast_cleared_with_errors: 'Rensade {cleared}, misslyckades {errors}', toast_failed_to_save: 'Det gick inte att spara: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Förslag",
    // google-translated 2026-06-02
    tab_audit_log: "Revisionslogg",
    // google-translated 2026-06-02
    tab_age_segregation: "Ålderssegregation",
    // google-translated 2026-06-02
    age_seg_title: "Ålderssegregation",
    // google-translated 2026-06-02
    age_seg_subtitle: "Kohortdistribution och åsidosättande av kontroller för UK OSA-efterlevnad.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Kohortfördelning",
    // google-translated 2026-06-02
    age_seg_refresh: "Uppdatera",
    // google-translated 2026-06-02
    age_seg_adult: "Vuxen",
    // override-translated 2026-06-02
    age_seg_minor: "Minderårig",
    // google-translated 2026-06-02
    age_seg_missing: "Kohort saknas",
    // google-translated 2026-06-02
    age_seg_total: "Totalt antal användare",
    // google-translated 2026-06-02
    age_seg_override_adult: "Åsidosätt → vuxen",
    // override-translated 2026-06-02
    age_seg_override_minor: "Åsidosätt → minderårig",
    // google-translated 2026-06-02
    age_seg_override_heading: "Kohort Åsidosätt",
    // google-translated 2026-06-02
    age_seg_override_note: "Åsidosättningar förbigår den DOB-härledda kohorten. Endast tillåtet på personal- eller administratörskonton. Varje ändring revisionsloggas med den angivna orsaken.",
    // google-translated 2026-06-02
    age_seg_target_label: "Målanvändar-ID",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Ny kohort",
    // google-translated 2026-06-02
    age_seg_pick: "— välja —",
    // google-translated 2026-06-02
    age_seg_clear: "Rensa åsidosättande",
    // google-translated 2026-06-02
    age_seg_reason_label: "Orsak (obligatoriskt, ≤500 tecken)",
    // google-translated 2026-06-02
    age_seg_apply: "Tillämpa åsidosättande",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Bekräfta åsidosättning av kohorten",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Denna ändring är granskningsloggad och kan tvinga målanvändaren att uppdatera en token. Granska detaljerna innan du bekräftar.",
    // google-translated 2026-06-02
    age_seg_cancel: "Avboka",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Bekräfta",
    // google-translated 2026-06-02
    subtab_identity: "Identitet",
    // google-translated 2026-06-02
    subtab_age_verification: "Åldersverifiering",
    // google-translated 2026-06-02
    age_verif_panel_title: "Åldersverifiering",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Granska användarens inlämnade myndighets-ID och bestäm dig. Godkänn bekräftar att användaren är 18+. Reject behåller dem under 18 och meddelar dem. Om ID:t visar en annan DOB, använd Modify-DOB för att korrigera posten.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Ingen väntande verifieringsinlämning för denna användare.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Andra väntande inlämningar i hela systemet:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Hoppa till nästa väntande",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "Bilden förstörs när beslutet registreras.",
    // google-translated 2026-06-02
    age_verif_field_method: "ID-metod:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "Inspelad DOB:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Skickat till:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "Inlämnings-ID:",
    // google-translated 2026-06-02
    age_verif_match_question: "Bekräftar ID:t användarens registrerade födelsedatum?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Ja — DOB på ID:t matchar det registrerade värdet",
    // google-translated 2026-06-02
    age_verif_match_no: "Nej – ID:t visar en annan DOB",
    // google-translated 2026-06-02
    age_verif_approve_help: "Godkänn: bekräftar att användaren är 18+ verifierad. Avvisa: behåller dem under 18 och skickar ett system-PM med anledningen.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Godkänn (markera verifierad)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Avvisa istället...",
    // google-translated 2026-06-02
    age_verif_reject_button: "Avvisa inlämning",
    // google-translated 2026-06-02
    age_verif_modify_help: "Uppdatera användarens DOB så att den matchar värdet som visas på ID:t. Användaren låses upp eller hålls låst automatiskt baserat på den nya åldern.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Födelsedatum på ID:t:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Uppdatera DOB och bestäm dig",
  },
  th: { tab_users: '\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49', tab_appeals: '\u0E2D\u0E38\u0E17\u0E18\u0E23\u0E13\u0E4C', tab_reports: '\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19', tab_gifts: '\u0E02\u0E2D\u0E07\u0E02\u0E27\u0E31\u0E0D', tab_economy: '\u0E40\u0E28\u0E23\u0E29\u0E10\u0E01\u0E34\u0E08', tab_maintenance: '\u0E01\u0E32\u0E23\u0E1A\u0E33\u0E23\u0E38\u0E07\u0E23\u0E31\u0E01\u0E29\u0E32', tab_monitor: '\u0E21\u0E2D\u0E19\u0E34\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E2A\u0E1B\u0E34\u0E19', tab_banners: '\u0E41\u0E1A\u0E19\u0E40\u0E19\u0E2D\u0E23\u0E4C', tab_funfacts: '\u0E2A\u0E32\u0E23\u0E30\u0E19\u0E48\u0E32\u0E23\u0E39\u0E49', tab_backups: '\u0E2A\u0E33\u0E23\u0E2D\u0E07', tab_logs: '\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01', tab_devices: '\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C', tab_starting_screens: '\u0E2B\u0E19\u0E49\u0E32\u0E08\u0E2D\u0E40\u0E23\u0E34\u0E48\u0E21', btn_sign_in: '\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A', btn_sign_out: '\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E23\u0E30\u0E1A\u0E1A', btn_search: '\u0E04\u0E49\u0E19\u0E2B\u0E32', placeholder_search_uid: '\u0E01\u0E23\u0E2D\u0E01 ID \u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49', subtab_profile: '\u0E42\u0E1B\u0E23\u0E44\u0E1F\u0E25\u0E4C', subtab_moderation: '\u0E01\u0E32\u0E23\u0E14\u0E39\u0E41\u0E25', subtab_security: '\u0E04\u0E27\u0E32\u0E21\u0E1B\u0E25\u0E2D\u0E14\u0E20\u0E31\u0E22', subtab_economy: '\u0E40\u0E28\u0E23\u0E29\u0E10\u0E01\u0E34\u0E08', label_uid: 'UID', label_display_name: '\u0E0A\u0E37\u0E48\u0E2D\u0E17\u0E35\u0E48\u0E41\u0E2A\u0E14\u0E07', label_user_type: '\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17', label_nationality: '\u0E2A\u0E31\u0E0D\u0E0A\u0E32\u0E15\u0E34', label_description: '\u0E04\u0E33\u0E2D\u0E18\u0E34\u0E1A\u0E32\u0E22', label_email: '\u0E2D\u0E35\u0E40\u0E21\u0E25', label_date_of_birth: '\u0E27\u0E31\u0E19\u0E40\u0E01\u0E34\u0E14', label_unique_id: 'ID \u0E40\u0E09\u0E1E\u0E32\u0E30', btn_suspend_user: '\u0E23\u0E30\u0E07\u0E31\u0E1A', btn_unsuspend_user: '\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01', btn_warn: '\u0E40\u0E15\u0E37\u0E2D\u0E19', btn_reset_device: '\u0E23\u0E35\u0E40\u0E0B\u0E47\u0E15\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C', btn_reset_gcs: '\u0E23\u0E35\u0E40\u0E0B\u0E47\u0E15 GCS', label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans', label_super_shy: 'Super Shy', label_login_streak: '\u0E2A\u0E15\u0E23\u0E35\u0E04\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A', status_banned: '\u0E16\u0E39\u0E01\u0E41\u0E1A\u0E19', status_active: '\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19', status_suspended: '\u0E16\u0E39\u0E01\u0E23\u0E30\u0E07\u0E31\u0E1A', status_pending: '\u0E23\u0E2D\u0E14\u0E33\u0E40\u0E19\u0E34\u0E19\u0E01\u0E32\u0E23', filter_pending: '\u0E23\u0E2D', filter_approved: '\u0E2D\u0E19\u0E38\u0E21\u0E31\u0E15\u0E34', filter_denied: '\u0E1B\u0E0F\u0E34\u0E40\u0E2A\u0E18', filter_resolved: '\u0E41\u0E01\u0E49\u0E44\u0E02\u0E41\u0E25\u0E49\u0E27', filter_archived: '\u0E40\u0E01\u0E47\u0E1A\u0E16\u0E32\u0E27\u0E23', btn_approve: '\u0E2D\u0E19\u0E38\u0E21\u0E31\u0E15\u0E34', btn_deny: '\u0E1B\u0E0F\u0E34\u0E40\u0E2A\u0E18', btn_resolve: '\u0E41\u0E01\u0E49\u0E44\u0E02', btn_save: '\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01', btn_cancel: '\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01', btn_delete: '\u0E25\u0E1A', btn_apply: '\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19', btn_refresh: '\u0E23\u0E35\u0E40\u0E1F\u0E23\u0E0A', btn_load_more: '\u0E42\u0E2B\u0E25\u0E14\u0E40\u0E1E\u0E34\u0E48\u0E21', msg_loading: '\u0E01\u0E33\u0E25\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14...', msg_no_data: '\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25', msg_saved: '\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E41\u0E25\u0E49\u0E27', msg_error: '\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14', label_log_level: '\u0E23\u0E30\u0E14\u0E31\u0E1A', label_log_source: '\u0E41\u0E2B\u0E25\u0E48\u0E07', btn_export_json: '\u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01 JSON', btn_export_csv: '\u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01 CSV', table_device_id: 'ID \u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C', table_user: '\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49', table_model: '\u0E23\u0E38\u0E48\u0E19', table_os: 'OS', table_last_ip: 'IP \u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14', table_isp: 'ISP', table_country: '\u0E1B\u0E23\u0E30\u0E40\u0E17\u0E28', table_last_seen: '\u0E40\u0E2B\u0E47\u0E19\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14' , confirm_reset_pin_lockout: 'รีเซ็ตการล็อก PIN สำหรับผู้ใช้นี้?', confirm_unsuspend_user: 'ยกเลิกการระงับผู้ใช้นี้? บัญชีจะกู้คืนอย่างสมบูรณ์', confirm_reset_gcs: 'รีเซ็ต GCS ของผู้ใช้นี้เป็น 100 และล้างคำเตือนทั้งหมด?', confirm_schedule_deletion: 'คุณแน่ใจว่าต้องการกำหนดการลบบัญชีนี้?', alert_deletion_scheduled: 'กำหนดการลบบัญชีแล้ว', confirm_cancel_deletion: 'ยกเลิกการลบบัญชีที่กำหนดไว้?' , confirm_remove_all_device_bindings: 'ลบการเชื่อมโยงอุปกรณ์ทั้งหมดสำหรับผู้ใช้นี้?', confirm_remove_device_ban: 'ลบการแบนอุปกรณ์นี้?', confirm_remove_network_ban: 'ลบการแบนเครือข่ายนี้?', confirm_unban_device: 'ปลดแบนอุปกรณ์นี้?', confirm_ban_all_devices: 'แบนอุปกรณ์ทั้งหมดของผู้ใช้นี้?', confirm_remove_all_bans: 'ลบการแบนทั้งหมดสำหรับผู้ใช้นี้?', confirm_unsuspend_identity_graph: 'ยกเลิกการระงับกราฟตัวตนสำหรับผู้ใช้นี้?', alert_deletion_cancelled: 'ยกเลิกการลบบัญชีแล้ว' , confirm_clear_temp_id: 'ล้าง ID ชั่วคราว?' , confirm_revoke_warning: 'เพิกถอนคำเตือนนี้? จะคืน +{deduction} GCS', confirm_revoke_biometric: 'เพิกถอนคีย์ไบโอเมตริกสำหรับอุปกรณ์ {deviceId}?', confirm_issue_warning: 'ออกคำเตือนสำหรับ "{reason}" (ความรุนแรง {severity}, -{deduction} GCS)?', alert_schedule_deletion_failed: 'กำหนดการลบล้มเหลว: {error}', alert_cancel_deletion_failed: 'ยกเลิกการลบล้มเหลว: {error}', confirm_ban_ip: 'แบน IP {ip}?', confirm_suspend_identity_graph: 'ระงับกราฟตัวตนสำหรับผู้ใช้นี้ ({duration}, {scope})?' , btn_searching: 'กำลังค้นหา...', btn_email_show: 'แสดง', btn_email_hide: 'ซ่อน', btn_email_saving: 'กำลังบันทึก…', btn_undo: 'เลิกทำ', msg_no_warnings: 'ไม่มีคำเตือน', btn_revoke: 'เพิกถอน', toast_display_name_empty: 'ชื่อที่แสดงต้องไม่ว่าง', toast_undo_successful: 'เลิกทำสำเร็จ', toast_already_in_list: 'อยู่ในรายการแล้ว' , toast_autosave_failed: 'การบันทึกอัตโนมัติล้มเหลว: {error}', toast_undo_failed: 'การเลิกทำล้มเหลว: {error}', status_suspended_badge: 'ระงับตั้งแต่ {since}, จนถึง {until}. เหตุผล: {reason}', status_not_suspended: 'ไม่ถูกระงับ', status_deletion_scheduled: 'กำหนดการลบ — เหลืออีก {days} วัน ({date})', status_severity_gcs: 'ความรุนแรง {severity} (-{deduction} GCS)', msg_permanent: 'ถาวร', msg_no_reason_provided: 'ไม่ได้ระบุเหตุผล', msg_suspended_since_until_format: 'ระงับตั้งแต่ {since}, จนถึง {until}', inline_revoked: 'เพิกถอนแล้ว', inline_warning_note: 'หมายเหตุ: {note}', inline_warning_meta: 'โดย: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}', toast_warning_revoked_gcs: 'เพิกถอนคำเตือนแล้ว คืน +{deduction} GCS', toast_pin_lockout_reset: 'รีเซ็ตการล็อก PIN แล้ว', toast_biometric_revoked: 'เพิกถอนคีย์ไบโอเมตริกแล้ว', toast_gcs_reset_100: 'รีเซ็ต GCS เป็น 100', toast_action_failed: 'ล้มเหลว: {error}', btn_issuing: 'กำลังออก...', btn_issue_warning: 'ออกคำเตือน', btn_resetting: 'กำลังรีเซ็ต...', toast_reason_required: 'ต้องระบุเหตุผล', toast_select_reason: 'เลือกเหตุผล', toast_no_user_loaded: 'ยังไม่ได้โหลดผู้ใช้', toast_device_bindings_removed: 'ลบการผูกอุปกรณ์แล้ว {count} รายการ', btn_reset_device_binding: 'รีเซ็ตการผูกอุปกรณ์', toast_auto_escalate_5_warnings: 'ผู้ใช้นี้มีคำเตือน 5+ ครั้ง พิจารณาระงับ', toast_no_ip_found: 'ไม่พบที่อยู่ IP', toast_banned_n_devices: 'แบนอุปกรณ์ {count} เครื่อง', toast_removed_n_bans: 'ลบการแบน {count} รายการ', toast_partial_retry: 'บางส่วน: {summary} โปรดลองขั้นตอนที่ล้มเหลวอีกครั้ง', toast_user_suspended: 'ระงับผู้ใช้แล้ว', toast_user_unsuspended: 'ยกเลิกการระงับผู้ใช้แล้ว', toast_warning_issued_successfully: 'ออกคำเตือนสำเร็จ', toast_ip_banned: 'แบน IP แล้ว', toast_identity_graph_suspended: 'ระงับกราฟตัวตนแล้ว', toast_identity_graph_unsuspended: 'ยกเลิกการระงับกราฟตัวตนแล้ว', prompt_deletion_reason: 'ระบุเหตุผลการลบบัญชี (ไม่บังคับ):', prompt_ban_reason: 'เหตุผล (ไม่บังคับ):', bio_device_label: 'อุปกรณ์:', bio_registered_label: 'ลงทะเบียนแล้ว:', segment_ban_call_failed: '{count}/{total} การเรียกใช้แบนล้มเหลว (แรก: {error})', segment_pm_failed: '{count}/{total} PM ล้มเหลว', toast_no_devices_to_ban: 'ไม่มีอุปกรณ์ที่จะแบน', toast_enter_positive_amount: 'ป้อนจำนวนที่เป็นบวก', toast_coins_added: 'เพิ่ม {amount} เหรียญ (ตอนนี้ {balance})', toast_coins_deducted: 'หัก {amount} เหรียญ (ตอนนี้ {balance})', toast_beans_added: 'เพิ่ม {amount} bean (ตอนนี้ {balance})', toast_beans_deducted: 'หัก {amount} bean (ตอนนี้ {balance})', toast_select_gift_qty: 'เลือกของขวัญและระบุจำนวน', toast_gift_added: 'เพิ่ม {qty} (รวม {total})', toast_backpack_empty_already: 'เป้สะพายว่างอยู่แล้ว', msg_loading_backpack: 'กำลังโหลดเป้สะพาย...', msg_backpack_empty: 'เป้สะพายว่างเปล่า', msg_no_matching_gifts: 'ไม่มีของขวัญที่ตรงกัน', btn_confirm_clear_all: 'ยืนยันการล้างทั้งหมด', btn_confirming: 'ยืนยัน ({countdown})', btn_clearing: 'กำลังล้าง...', toast_backpack_cleared: 'ล้างเป้สะพายแล้ว (ลบ {count} รายการ)', toast_cleared_with_errors: 'ล้าง {cleared}, ล้มเหลว {errors}', toast_failed_to_save: 'บันทึกล้มเหลว: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "ข้อเสนอแนะ",
    // google-translated 2026-06-02
    tab_audit_log: "บันทึกการตรวจสอบ",
    // google-translated 2026-06-02
    tab_age_segregation: "การแบ่งแยกอายุ",
    // google-translated 2026-06-02
    age_seg_title: "การแบ่งแยกอายุ",
    // google-translated 2026-06-02
    age_seg_subtitle: "การกระจายตามรุ่นและการควบคุมแทนที่สำหรับการปฏิบัติตามข้อกำหนด OSA ของสหราชอาณาจักร",
    // google-translated 2026-06-02
    age_seg_stats_heading: "การกระจายตามรุ่น",
    // google-translated 2026-06-02
    age_seg_refresh: "รีเฟรช",
    // google-translated 2026-06-02
    age_seg_adult: "ผู้ใหญ่",
    // override-translated 2026-06-02
    age_seg_minor: "ผู้เยาว์",
    // google-translated 2026-06-02
    age_seg_missing: "ไม่มีกลุ่มประชากรตามรุ่น",
    // google-translated 2026-06-02
    age_seg_total: "ผู้ใช้ทั้งหมด",
    // google-translated 2026-06-02
    age_seg_override_adult: "แทนที่ → ผู้ใหญ่",
    // override-translated 2026-06-02
    age_seg_override_minor: "แทนที่ → ผู้เยาว์",
    // google-translated 2026-06-02
    age_seg_override_heading: "การแทนที่กลุ่มตามรุ่น",
    // google-translated 2026-06-02
    age_seg_override_note: "แทนที่การข้ามกลุ่มประชากรตามรุ่นที่ได้มาจาก DOB อนุญาตเฉพาะกับบัญชีพนักงานหรือผู้ดูแลระบบเท่านั้น การเปลี่ยนแปลงทุกอย่างจะถูกบันทึกการตรวจสอบพร้อมเหตุผลที่ให้ไว้",
    // google-translated 2026-06-02
    age_seg_target_label: "ID ผู้ใช้เป้าหมาย",
    // google-translated 2026-06-02
    age_seg_override_value_label: "กลุ่มประชากรตามรุ่นใหม่",
    // google-translated 2026-06-02
    age_seg_pick: "- เลือก -",
    // google-translated 2026-06-02
    age_seg_clear: "ล้างการแทนที่",
    // google-translated 2026-06-02
    age_seg_reason_label: "เหตุผล (จำเป็น ≤500 ตัวอักษร)",
    // google-translated 2026-06-02
    age_seg_apply: "ใช้แทนที่",
    // google-translated 2026-06-02
    age_seg_confirm_title: "ยืนยันการแทนที่กลุ่มประชากรตามรุ่น",
    // google-translated 2026-06-02
    age_seg_confirm_body: "การเปลี่ยนแปลงนี้ได้รับการบันทึกการตรวจสอบและอาจบังคับให้รีเฟรชโทเค็นกับผู้ใช้เป้าหมาย ตรวจสอบรายละเอียดก่อนยืนยัน",
    // google-translated 2026-06-02
    age_seg_cancel: "ยกเลิก",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "ยืนยัน",
    // google-translated 2026-06-02
    subtab_identity: "ตัวตน",
    // google-translated 2026-06-02
    subtab_age_verification: "การตรวจสอบอายุ",
    // google-translated 2026-06-02
    age_verif_panel_title: "การตรวจสอบอายุ",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "ตรวจสอบบัตรประจำตัวรัฐบาลที่ผู้ใช้ส่งมาและตัดสินใจ อนุมัติยืนยันว่าผู้ใช้มีอายุ 18 ปีขึ้นไป Reject ทำให้พวกเขาอายุต่ำกว่า 18 ปีและแจ้งให้พวกเขาทราบ หาก ID แสดง DOB อื่น ให้ใช้ Modify-DOB เพื่อแก้ไขเรกคอร์ด",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "ไม่มีการส่งการยืนยันที่รอดำเนินการสำหรับผู้ใช้รายนี้",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "การส่งที่รอดำเนินการอื่น ๆ ทั่วทั้งระบบ:",
    // google-translated 2026-06-02
    age_verif_jump_next: "ข้ามไปที่รอดำเนินการถัดไป",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "ภาพจะถูกทำลายเมื่อมีการบันทึกการตัดสินใจ",
    // google-translated 2026-06-02
    age_verif_field_method: "วิธีระบุตัวตน:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "วันเกิดที่บันทึกไว้:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "ส่งที่:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "รหัสการส่ง:",
    // google-translated 2026-06-02
    age_verif_match_question: "ID ยืนยันวันเกิดที่บันทึกไว้ของผู้ใช้หรือไม่?",
    // google-translated 2026-06-02
    age_verif_match_yes: "ใช่ — DOB บน ID ตรงกับค่าที่บันทึกไว้",
    // google-translated 2026-06-02
    age_verif_match_no: "ไม่ — ID แสดงวันเกิดที่แตกต่างกัน",
    // google-translated 2026-06-02
    age_verif_approve_help: "อนุมัติ: ยืนยันว่าผู้ใช้ได้รับการยืนยันว่ามีอายุ 18 ปีขึ้นไป ปฏิเสธ: คงอายุต่ำกว่า 18 ปี และส่ง PM ระบบพร้อมเหตุผล",
    // google-translated 2026-06-02
    age_verif_approve_button: "อนุมัติ (ทำเครื่องหมายยืนยันแล้ว)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "ปฏิเสธแทน...",
    // google-translated 2026-06-02
    age_verif_reject_button: "ปฏิเสธการส่ง",
    // google-translated 2026-06-02
    age_verif_modify_help: "อัปเดตวันเกิดของผู้ใช้ให้ตรงกับค่าที่แสดงบนรหัส ผู้ใช้จะถูกปลดล็อคหรือล็อคไว้โดยอัตโนมัติตามยุคใหม่",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "วันเกิดใน ID:",
    // google-translated 2026-06-02
    age_verif_modify_button: "อัปเดต DOB และตัดสินใจ",
  },
  tr: { tab_users: 'Kullanıcılar', tab_appeals: 'İtirazlar', tab_reports: 'Raporlar', tab_gifts: 'Hediyeler', tab_economy: 'Ekonomi', tab_maintenance: 'Bakım', tab_monitor: 'Çevirme Monitörü', tab_banners: 'Afişler', tab_funfacts: 'İlginç Bilgiler', tab_backups: 'Yedekler', tab_logs: 'Günlükler', tab_devices: 'Cihazlar', tab_starting_screens: 'Başlangıç Ekranları', btn_sign_in: 'Giriş Yap', btn_sign_out: 'Çıkış Yap', btn_search: 'Ara', placeholder_search_uid: 'Kullanıcı ID\'sini girin', subtab_profile: 'Profil', subtab_moderation: 'Moderasyon', subtab_security: 'Güvenlik', subtab_economy: 'Ekonomi', label_uid: 'UID', label_display_name: 'Görünen Ad', label_user_type: 'Tür', label_nationality: 'Milliyet', label_description: 'Açıklama', label_email: 'E-posta', label_date_of_birth: 'Doğum Tarihi', label_unique_id: 'Benzersiz ID', btn_suspend_user: 'Askıya Al', btn_unsuspend_user: 'Yeniden Etkinleştir', btn_warn: 'Uyar', btn_reset_device: 'Cihaz Sıfırla', btn_reset_gcs: 'GCS Sıfırla', label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans', label_super_shy: 'Super Shy', label_login_streak: 'Giriş Serisi', status_banned: 'YASAKLI', status_active: 'Aktif', status_suspended: 'Askıda', status_pending: 'Bekliyor', filter_pending: 'Bekliyor', filter_approved: 'Onaylandı', filter_denied: 'Reddedildi', filter_resolved: 'Çözüldü', filter_archived: 'Arşivlendi', btn_approve: 'Onayla', btn_deny: 'Reddet', btn_resolve: 'Çöz', btn_save: 'Kaydet', btn_cancel: 'İptal', btn_delete: 'Sil', btn_apply: 'Uygula', btn_refresh: 'Yenile', btn_load_more: 'Daha fazla yükle', msg_loading: 'Yükleniyor...', msg_no_data: 'Veri bulunamadı', msg_saved: 'Kaydedildi', msg_error: 'Hata', label_log_level: 'Seviye', label_log_source: 'Kaynak', btn_export_json: 'JSON Dışa Aktar', btn_export_csv: 'CSV Dışa Aktar', table_device_id: 'Cihaz ID', table_user: 'Kullanıcı', table_model: 'Model', table_os: 'İS', table_last_ip: 'Son IP', table_isp: 'İSS', table_country: 'Ülke', table_last_seen: 'Son görülme' , confirm_reset_pin_lockout: 'Bu kullanıcı için PIN kilidini sıfırlansın mı?', confirm_unsuspend_user: 'Bu kullanıcının askısı kaldırılsın mı? Hesap tamamen geri yüklenecek.', confirm_reset_gcs: 'Bu kullanıcının GCS\'si 100\'e sıfırlansın ve tüm uyarılar silinsin mi?', confirm_schedule_deletion: 'Bu hesabın silinmesini planlamak istediğinizden emin misiniz?', alert_deletion_scheduled: 'Hesap silme planlandı.', confirm_cancel_deletion: 'Planlanan hesap silme işlemi iptal edilsin mi?' , confirm_remove_all_device_bindings: 'Bu kullanıcının tüm cihaz bağlantılarını kaldırılsın mı?', confirm_remove_device_ban: 'Bu cihaz yasağı kaldırılsın mı?', confirm_remove_network_ban: 'Bu ağ yasağı kaldırılsın mı?', confirm_unban_device: 'Bu cihazın yasağı kaldırılsın mı?', confirm_ban_all_devices: 'Bu kullanıcının tüm cihazları yasaklansın mı?', confirm_remove_all_bans: 'Bu kullanıcının tüm yasakları kaldırılsın mı?', confirm_unsuspend_identity_graph: 'Bu kullanıcının kimlik grafiği askısı kaldırılsın mı?', alert_deletion_cancelled: 'Hesap silme iptal edildi.' , confirm_clear_temp_id: 'Geçici kimliği silinsin mi?' , confirm_revoke_warning: 'Bu uyarı iptal edilsin mi? +{deduction} GCS geri yüklenecek.', confirm_revoke_biometric: '{deviceId} cihazının biyometrik anahtarı iptal edilsin mi?', confirm_issue_warning: '"{reason}" için uyarı verilsin mi (önem {severity}, -{deduction} GCS)?', alert_schedule_deletion_failed: 'Silme planlanamadı: {error}', alert_cancel_deletion_failed: 'Silme iptal edilemedi: {error}', confirm_ban_ip: 'IP {ip} yasaklansın mı?', confirm_suspend_identity_graph: 'Bu kullanıcının kimlik grafiği askıya alınsın mı ({duration}, {scope})?' , btn_searching: 'Aranıyor...', btn_email_show: 'Göster', btn_email_hide: 'Gizle', btn_email_saving: 'Kaydediliyor…', btn_undo: 'Geri al', msg_no_warnings: 'Uyarı yok', btn_revoke: 'İptal et', toast_display_name_empty: 'Görünen ad boş olamaz', toast_undo_successful: 'Geri alma başarılı', toast_already_in_list: 'Zaten listede' , toast_autosave_failed: 'Otomatik kaydetme başarısız: {error}', toast_undo_failed: 'Geri alma başarısız: {error}', status_suspended_badge: '{since}\'den {until}\'e kadar askıda. Neden: {reason}', status_not_suspended: 'Askıya alınmamış', status_deletion_scheduled: 'Silme planlandı — {days} gün kaldı ({date})', status_severity_gcs: 'Önem {severity} (-{deduction} GCS)', msg_permanent: 'kalıcı', msg_no_reason_provided: 'Neden belirtilmemiş', msg_suspended_since_until_format: '{since}\'den {until}\'e kadar askıda', inline_revoked: 'İptal edildi', inline_warning_note: 'Not: {note}', inline_warning_meta: 'Veren: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}', toast_warning_revoked_gcs: 'Uyarı iptal edildi, +{deduction} GCS geri yüklendi', toast_pin_lockout_reset: 'PIN kilidi sıfırlandı', toast_biometric_revoked: 'Biyometrik anahtar iptal edildi', toast_gcs_reset_100: 'GCS 100\'e sıfırlandı', toast_action_failed: 'Başarısız: {error}', btn_issuing: 'Veriliyor...', btn_issue_warning: 'Uyarı Ver', btn_resetting: 'Sıfırlanıyor...', toast_reason_required: 'Sebep gerekli', toast_select_reason: 'Bir sebep seçin', toast_no_user_loaded: 'Hiçbir kullanıcı yüklenmedi', toast_device_bindings_removed: '{count} cihaz bağlantısı kaldırıldı', btn_reset_device_binding: 'Cihaz Bağlantısını Sıfırla', toast_auto_escalate_5_warnings: 'Bu kullanıcının 5+ uyarısı var. Askıya almayı düşünün.', toast_no_ip_found: 'IP adresi bulunamadı', toast_banned_n_devices: '{count} cihaz yasaklandı', toast_removed_n_bans: '{count} yasak kaldırıldı', toast_partial_retry: 'Kısmen: {summary}. Lütfen başarısız adımı yeniden deneyin.', toast_user_suspended: 'Kullanıcı askıya alındı', toast_user_unsuspended: 'Kullanıcı askısı kaldırıldı', toast_warning_issued_successfully: 'Uyarı başarıyla verildi', toast_ip_banned: 'IP yasaklandı', toast_identity_graph_suspended: 'Kimlik grafiği askıya alındı', toast_identity_graph_unsuspended: 'Kimlik grafiği askısı kaldırıldı', prompt_deletion_reason: 'Hesap silme nedenini girin (isteğe bağlı):', prompt_ban_reason: 'Sebep (isteğe bağlı):', bio_device_label: 'Cihaz:', bio_registered_label: 'Kayıtlı:', segment_ban_call_failed: '{count}/{total} yasak çağrısı başarısız (ilk: {error})', segment_pm_failed: '{count}/{total} ÖM başarısız', toast_no_devices_to_ban: 'Yasaklanacak cihaz yok', toast_enter_positive_amount: 'Pozitif bir miktar girin', toast_coins_added: '{amount} jeton eklendi (şimdi {balance})', toast_coins_deducted: '{amount} jeton düşüldü (şimdi {balance})', toast_beans_added: '{amount} bean eklendi (şimdi {balance})', toast_beans_deducted: '{amount} bean düşüldü (şimdi {balance})', toast_select_gift_qty: 'Bir hediye seçin ve miktar girin', toast_gift_added: '{qty} eklendi (toplam şimdi {total})', toast_backpack_empty_already: 'Sırt çantası zaten boş', msg_loading_backpack: 'Sırt çantası yükleniyor...', msg_backpack_empty: 'Sırt çantası boş', msg_no_matching_gifts: 'Eşleşen hediye yok', btn_confirm_clear_all: 'Tümünü Temizlemeyi Onayla', btn_confirming: 'Onayla ({countdown})', btn_clearing: 'Temizleniyor...', toast_backpack_cleared: 'Sırt çantası temizlendi ({count} öğe silindi)', toast_cleared_with_errors: '{cleared} temizlendi, {errors} başarısız', toast_failed_to_save: 'Kaydedilemedi: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Öneriler",
    // google-translated 2026-06-02
    tab_audit_log: "Denetim Günlüğü",
    // google-translated 2026-06-02
    tab_age_segregation: "Yaş Ayrımı",
    // google-translated 2026-06-02
    age_seg_title: "Yaş Ayrımı",
    // google-translated 2026-06-02
    age_seg_subtitle: "Birleşik Krallık OSA uyumluluğu için kohort dağıtımı ve geçersiz kılma kontrolleri.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Kohort Dağılımı",
    // google-translated 2026-06-02
    age_seg_refresh: "Yenile",
    // google-translated 2026-06-02
    age_seg_adult: "Yetişkin",
    // override-translated 2026-06-02
    age_seg_minor: "Reşit değil",
    // google-translated 2026-06-02
    age_seg_missing: "Eksik grup",
    // google-translated 2026-06-02
    age_seg_total: "Toplam kullanıcı",
    // google-translated 2026-06-02
    age_seg_override_adult: "Geçersiz kıl → yetişkin",
    // override-translated 2026-06-02
    age_seg_override_minor: "Geçersiz kıl → reşit değil",
    // google-translated 2026-06-02
    age_seg_override_heading: "Kohortu Geçersiz Kılma",
    // google-translated 2026-06-02
    age_seg_override_note: "Geçersiz kılmalar DOB'dan türetilen kohortu atlar. Yalnızca personel veya yönetici hesaplarında izin verilir. Her değişiklik, belirtilen neden ile birlikte denetim günlüğüne kaydedilir.",
    // google-translated 2026-06-02
    age_seg_target_label: "Hedef kullanıcı kimliği",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Yeni grup",
    // google-translated 2026-06-02
    age_seg_pick: "- seçmek -",
    // google-translated 2026-06-02
    age_seg_clear: "Geçersiz kılmayı temizle",
    // google-translated 2026-06-02
    age_seg_reason_label: "Sebep (gerekli, ≤500 karakter)",
    // google-translated 2026-06-02
    age_seg_apply: "Geçersiz Kılmayı Uygula",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Grup geçersiz kılmayı onaylayın",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Bu değişiklik denetim günlüğüne kaydedilir ve hedef kullanıcıyı jetonun yenilenmesine zorlayabilir. Onaylamadan önce ayrıntıları inceleyin.",
    // google-translated 2026-06-02
    age_seg_cancel: "İptal etmek",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Onaylamak",
    // google-translated 2026-06-02
    subtab_identity: "Kimlik",
    // google-translated 2026-06-02
    subtab_age_verification: "Yaş Doğrulaması",
    // google-translated 2026-06-02
    age_verif_panel_title: "Yaş Doğrulaması",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Kullanıcının gönderilen resmi kimliğini inceleyin ve karar verin. Onayla kullanıcının 18+ olduğunu onaylar. Reddet, onları 18'in altında tutar ve bilgilendirir. Kimlik farklı bir DOB gösteriyorsa, kaydı düzeltmek için Modify-DOB'u kullanın.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Bu kullanıcı için bekleyen doğrulama gönderimi yok.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Sistem genelinde bekleyen diğer gönderimler:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Sonraki beklemeye atla",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "Karar kaydedildiğinde görüntü yok edilir.",
    // google-translated 2026-06-02
    age_verif_field_method: "Kimlik yöntemi:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "Kaydedilen DOB:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Gönderilme tarihi:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "Gönderim Kimliği:",
    // google-translated 2026-06-02
    age_verif_match_question: "Kimlik, kullanıcının kayıtlı doğum tarihini doğruluyor mu?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Evet — Kimlikteki DOB kayıtlı değerle eşleşiyor",
    // google-translated 2026-06-02
    age_verif_match_no: "Hayır — kimlik farklı bir DOB gösteriyor",
    // google-translated 2026-06-02
    age_verif_approve_help: "Onayla: Kullanıcının 18+ doğrulanmış olduğunu onaylar. Reddet: Onları 18'in altında tutar ve nedeni ile birlikte bir sistem PM'si gönderir.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Onayla (doğrulandı olarak işaretle)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Bunun yerine reddet…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Gönderimi reddet",
    // google-translated 2026-06-02
    age_verif_modify_help: "Kullanıcının DOB'unu, kimlikte gösterilen değerle eşleşecek şekilde güncelleyin. Kullanıcının kilidi yeni çağa göre otomatik olarak açılır veya kilitli tutulur.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Kimlikteki doğum tarihi:",
    // google-translated 2026-06-02
    age_verif_modify_button: "DOB'u güncelleyin ve karar verin",
  },
  uk: { tab_users: '\u041A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0456', tab_appeals: '\u0410\u043F\u0435\u043B\u044F\u0446\u0456\u0457', tab_reports: '\u0421\u043A\u0430\u0440\u0433\u0438', tab_gifts: '\u041F\u043E\u0434\u0430\u0440\u0443\u043D\u043A\u0438', tab_economy: '\u0415\u043A\u043E\u043D\u043E\u043C\u0456\u043A\u0430', tab_maintenance: '\u041E\u0431\u0441\u043B\u0443\u0433\u043E\u0432\u0443\u0432\u0430\u043D\u043D\u044F', tab_monitor: '\u041C\u043E\u043D\u0456\u0442\u043E\u0440 \u043E\u0431\u0435\u0440\u0442\u0456\u0432', tab_banners: '\u0411\u0430\u043D\u0435\u0440\u0438', tab_funfacts: '\u0426\u0456\u043A\u0430\u0432\u0456 \u0444\u0430\u043A\u0442\u0438', tab_backups: '\u0420\u0435\u0437\u0435\u0440\u0432\u043D\u0456 \u043A\u043E\u043F\u0456\u0457', tab_logs: '\u0416\u0443\u0440\u043D\u0430\u043B\u0438', tab_devices: '\u041F\u0440\u0438\u0441\u0442\u0440\u043E\u0457', tab_starting_screens: '\u0421\u0442\u0430\u0440\u0442\u043E\u0432\u0456 \u0435\u043A\u0440\u0430\u043D\u0438', btn_sign_in: '\u0423\u0432\u0456\u0439\u0442\u0438', btn_sign_out: '\u0412\u0438\u0439\u0442\u0438', btn_search: '\u041F\u043E\u0448\u0443\u043A', placeholder_search_uid: '\u0412\u0432\u0435\u0434\u0456\u0442\u044C ID \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430', subtab_profile: '\u041F\u0440\u043E\u0444\u0456\u043B\u044C', subtab_moderation: '\u041C\u043E\u0434\u0435\u0440\u0430\u0446\u0456\u044F', subtab_security: '\u0411\u0435\u0437\u043F\u0435\u043A\u0430', subtab_economy: '\u0415\u043A\u043E\u043D\u043E\u043C\u0456\u043A\u0430', label_uid: 'UID', label_display_name: '\u0406\u043C\u2019\u044F', label_user_type: '\u0422\u0438\u043F', label_nationality: '\u041D\u0430\u0446\u0456\u043E\u043D\u0430\u043B\u044C\u043D\u0456\u0441\u0442\u044C', label_description: '\u041E\u043F\u0438\u0441', label_email: '\u0415\u043B. \u043F\u043E\u0448\u0442\u0430', label_date_of_birth: '\u0414\u0430\u0442\u0430 \u043D\u0430\u0440\u043E\u0434\u0436\u0435\u043D\u043D\u044F', label_unique_id: '\u0423\u043D\u0456\u043A\u0430\u043B\u044C\u043D\u0438\u0439 ID', btn_suspend_user: '\u0417\u0430\u0431\u043B\u043E\u043A\u0443\u0432\u0430\u0442\u0438', btn_unsuspend_user: '\u0420\u043E\u0437\u0431\u043B\u043E\u043A\u0443\u0432\u0430\u0442\u0438', btn_warn: '\u041F\u043E\u043F\u0435\u0440\u0435\u0434\u0438\u0442\u0438', btn_reset_device: '\u0421\u043A\u0438\u043D\u0443\u0442\u0438 \u043F\u0440\u0438\u0441\u0442\u0440\u0456\u0439', btn_reset_gcs: '\u0421\u043A\u0438\u043D\u0443\u0442\u0438 GCS', label_shy_coins: 'Shy \u043C\u043E\u043D\u0435\u0442\u0438', label_shy_beans: 'Shy \u0431\u043E\u0431\u0438', label_super_shy: '\u0421\u0443\u043F\u0435\u0440 \u0428\u0430\u0439', label_login_streak: '\u0421\u0435\u0440\u0456\u044F \u0432\u0445\u043E\u0434\u0456\u0432', status_banned: '\u0417\u0410\u0411\u0410\u041D\u0415\u041D\u041E', status_active: '\u0410\u043A\u0442\u0438\u0432\u043D\u0438\u0439', status_suspended: '\u041F\u0440\u0438\u0437\u0443\u043F\u0438\u043D\u0435\u043D\u043E', status_pending: '\u041E\u0447\u0456\u043A\u0443\u0432\u0430\u043D\u043D\u044F', filter_pending: '\u041E\u0447\u0456\u043A\u0443\u0432\u0430\u043D\u043D\u044F', filter_approved: '\u0421\u0445\u0432\u0430\u043B\u0435\u043D\u043E', filter_denied: '\u0412\u0456\u0434\u0445\u0438\u043B\u0435\u043D\u043E', filter_resolved: '\u0412\u0438\u0440\u0456\u0448\u0435\u043D\u043E', filter_archived: '\u0410\u0440\u0445\u0456\u0432', btn_approve: '\u0421\u0445\u0432\u0430\u043B\u0438\u0442\u0438', btn_deny: '\u0412\u0456\u0434\u0445\u0438\u043B\u0438\u0442\u0438', btn_resolve: '\u0412\u0438\u0440\u0456\u0448\u0438\u0442\u0438', btn_save: '\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438', btn_cancel: '\u0421\u043A\u0430\u0441\u0443\u0432\u0430\u0442\u0438', btn_delete: '\u0412\u0438\u0434\u0430\u043B\u0438\u0442\u0438', btn_apply: '\u0417\u0430\u0441\u0442\u043E\u0441\u0443\u0432\u0430\u0442\u0438', btn_refresh: '\u041E\u043D\u043E\u0432\u0438\u0442\u0438', btn_load_more: '\u0417\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0438\u0442\u0438 \u0449\u0435', msg_loading: '\u0417\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0435\u043D\u043D\u044F...', msg_no_data: '\u0414\u0430\u043D\u0456 \u043D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E', msg_saved: '\u0417\u0431\u0435\u0440\u0435\u0436\u0435\u043D\u043E', msg_error: '\u041F\u043E\u043C\u0438\u043B\u043A\u0430', label_log_level: '\u0420\u0456\u0432\u0435\u043D\u044C', label_log_source: '\u0414\u0436\u0435\u0440\u0435\u043B\u043E', btn_export_json: '\u0415\u043A\u0441\u043F\u043E\u0440\u0442 JSON', btn_export_csv: '\u0415\u043A\u0441\u043F\u043E\u0440\u0442 CSV', table_device_id: 'ID \u043F\u0440\u0438\u0441\u0442\u0440\u043E\u044E', table_user: '\u041A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447', table_model: '\u041C\u043E\u0434\u0435\u043B\u044C', table_os: 'OC', table_last_ip: '\u041E\u0441\u0442\u0430\u043D\u043D\u0456\u0439 IP', table_isp: '\u041F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440', table_country: '\u041A\u0440\u0430\u0457\u043D\u0430', table_last_seen: '\u041E\u0441\u0442\u0430\u043D\u043D\u0456\u0439 \u0432\u0445\u0456\u0434' , confirm_reset_pin_lockout: 'Скинути блокування PIN для цього користувача?', confirm_unsuspend_user: 'Скасувати блокування цього користувача? Обліковий запис буде повністю відновлено.', confirm_reset_gcs: 'Скинути GCS цього користувача до 100 і очистити всі попередження?', confirm_schedule_deletion: 'Ви впевнені, що хочете запланувати видалення цього облікового запису?', alert_deletion_scheduled: 'Видалення облікового запису заплановано.', confirm_cancel_deletion: 'Скасувати заплановане видалення облікового запису?' , confirm_remove_all_device_bindings: 'Видалити всі прив\'язки пристроїв для цього користувача?', confirm_remove_device_ban: 'Видалити це блокування пристрою?', confirm_remove_network_ban: 'Видалити це блокування мережі?', confirm_unban_device: 'Розблокувати цей пристрій?', confirm_ban_all_devices: 'Заблокувати всі пристрої цього користувача?', confirm_remove_all_bans: 'Видалити всі блокування для цього користувача?', confirm_unsuspend_identity_graph: 'Скасувати блокування графа ідентифікації для цього користувача?', alert_deletion_cancelled: 'Видалення облікового запису скасовано.' , confirm_clear_temp_id: 'Очистити тимчасовий ідентифікатор?' , confirm_revoke_warning: 'Скасувати це попередження? +{deduction} GCS буде відновлено.', confirm_revoke_biometric: 'Скасувати біометричний ключ для пристрою {deviceId}?', confirm_issue_warning: 'Видати попередження за "{reason}" (серйозність {severity}, -{deduction} GCS)?', alert_schedule_deletion_failed: 'Не вдалося запланувати видалення: {error}', alert_cancel_deletion_failed: 'Не вдалося скасувати видалення: {error}', confirm_ban_ip: 'Заблокувати IP {ip}?', confirm_suspend_identity_graph: 'Заблокувати граф ідентифікації цього користувача ({duration}, {scope})?' , btn_searching: 'Пошук...', btn_email_show: 'Показати', btn_email_hide: 'Сховати', btn_email_saving: 'Збереження…', btn_undo: 'Скасувати', msg_no_warnings: 'Немає попереджень', btn_revoke: 'Скасувати', toast_display_name_empty: 'Відображуване ім\'я не може бути порожнім', toast_undo_successful: 'Скасування виконано', toast_already_in_list: 'Вже у списку' , toast_autosave_failed: 'Не вдалося автоматично зберегти: {error}', toast_undo_failed: 'Не вдалося скасувати: {error}', status_suspended_badge: 'Заблоковано з {since} до {until}. Причина: {reason}', status_not_suspended: 'Не заблоковано', status_deletion_scheduled: 'Видалення заплановано — залишилось {days} дн. ({date})', status_severity_gcs: 'Серйозність {severity} (-{deduction} GCS)', msg_permanent: 'постійно', msg_no_reason_provided: 'Причину не вказано', msg_suspended_since_until_format: 'Заблоковано з {since} до {until}', inline_revoked: 'Скасовано', inline_warning_note: 'Примітка: {note}', inline_warning_meta: 'Видав: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}', toast_warning_revoked_gcs: 'Попередження скасовано, відновлено +{deduction} GCS', toast_pin_lockout_reset: 'Блокування PIN скинуто', toast_biometric_revoked: 'Біометричний ключ скасовано', toast_gcs_reset_100: 'GCS скинуто до 100', toast_action_failed: 'Помилка: {error}', btn_issuing: 'Видається...', btn_issue_warning: 'Видати попередження', btn_resetting: 'Скидання...', toast_reason_required: 'Потрібна причина', toast_select_reason: 'Виберіть причину', toast_no_user_loaded: 'Користувача не завантажено', toast_device_bindings_removed: 'Видалено {count} прив\'язок пристроїв', btn_reset_device_binding: 'Скинути прив\'язку пристрою', toast_auto_escalate_5_warnings: 'У цього користувача 5+ попереджень. Розгляньте блокування.', toast_no_ip_found: 'IP-адресу не знайдено', toast_banned_n_devices: 'Заблоковано {count} пристроїв', toast_removed_n_bans: 'Видалено {count} блокувань', toast_partial_retry: 'Частково: {summary}. Спробуйте невдалий крок ще раз.', toast_user_suspended: 'Користувача заблоковано', toast_user_unsuspended: 'Блокування користувача знято', toast_warning_issued_successfully: 'Попередження видано успішно', toast_ip_banned: 'IP заблоковано', toast_identity_graph_suspended: 'Графік ідентичності призупинено', toast_identity_graph_unsuspended: 'Блокування графа ідентичності знято', prompt_deletion_reason: 'Введіть причину видалення облікового запису (необов\'язково):', prompt_ban_reason: 'Причина (необов\'язково):', bio_device_label: 'Пристрій:', bio_registered_label: 'Зареєстровано:', segment_ban_call_failed: '{count}/{total} викликів блокування не вдалося (перший: {error})', segment_pm_failed: '{count}/{total} ОМ не вдалося', toast_no_devices_to_ban: 'Немає пристроїв для блокування', toast_enter_positive_amount: 'Введіть додатну суму', toast_coins_added: 'Додано {amount} монет (зараз {balance})', toast_coins_deducted: 'Знято {amount} монет (зараз {balance})', toast_beans_added: 'Додано {amount} бінів (зараз {balance})', toast_beans_deducted: 'Знято {amount} бінів (зараз {balance})', toast_select_gift_qty: 'Виберіть подарунок і введіть кількість', toast_gift_added: 'Додано {qty} (всього {total})', toast_backpack_empty_already: 'Рюкзак уже порожній', msg_loading_backpack: 'Завантаження рюкзака...', msg_backpack_empty: 'Рюкзак порожній', msg_no_matching_gifts: 'Немає відповідних подарунків', btn_confirm_clear_all: 'Підтвердити очищення', btn_confirming: 'Підтвердити ({countdown})', btn_clearing: 'Очищення...', toast_backpack_cleared: 'Рюкзак очищено (видалено {count} предметів)', toast_cleared_with_errors: 'Очищено {cleared}, не вдалося {errors}', toast_failed_to_save: 'Не вдалося зберегти: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Пропозиції",
    // google-translated 2026-06-02
    tab_audit_log: "Журнал аудиту",
    // google-translated 2026-06-02
    tab_age_segregation: "Вікова сегрегація",
    // google-translated 2026-06-02
    age_seg_title: "Вікова сегрегація",
    // google-translated 2026-06-02
    age_seg_subtitle: "Розподіл когорт і елементи керування для відповідності OSA у Великобританії.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Когортний розподіл",
    // google-translated 2026-06-02
    age_seg_refresh: "Оновити",
    // google-translated 2026-06-02
    age_seg_adult: "Дорослий",
    // override-translated 2026-06-02
    age_seg_minor: "Неповнолітній",
    // google-translated 2026-06-02
    age_seg_missing: "Відсутня когорта",
    // google-translated 2026-06-02
    age_seg_total: "Всього користувачів",
    // google-translated 2026-06-02
    age_seg_override_adult: "Перевизначити → дорослий",
    // override-translated 2026-06-02
    age_seg_override_minor: "Перевизначити → неповнолітній",
    // google-translated 2026-06-02
    age_seg_override_heading: "Перевизначення когорти",
    // google-translated 2026-06-02
    age_seg_override_note: "Заміни обходять когорту, отриману за DOB. Дозволено лише для облікових записів персоналу або адміністратора. Кожна зміна реєструється в журналі аудиту з указанням причини.",
    // google-translated 2026-06-02
    age_seg_target_label: "Цільовий ідентифікатор користувача",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Нова когорта",
    // google-translated 2026-06-02
    age_seg_pick: "— вибрати —",
    // google-translated 2026-06-02
    age_seg_clear: "Очистити перевизначення",
    // google-translated 2026-06-02
    age_seg_reason_label: "Причина (обов’язково, ≤500 символів)",
    // google-translated 2026-06-02
    age_seg_apply: "Застосувати перевизначення",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Підтвердити заміну когорти",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Ця зміна реєструється під час аудиту й може примусово оновити маркер для цільового користувача. Перегляньте деталі перед підтвердженням.",
    // google-translated 2026-06-02
    age_seg_cancel: "Скасувати",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Підтвердити",
    // google-translated 2026-06-02
    subtab_identity: "Ідентичність",
    // google-translated 2026-06-02
    subtab_age_verification: "Перевірка віку",
    // google-translated 2026-06-02
    age_verif_panel_title: "Перевірка віку",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Перегляньте подане державне посвідчення особи користувача та вирішіть. Підтвердити підтверджує, що користувачеві 18+. Reject тримає їх віком до 18 років і сповіщає їх. Якщо ID показує інший DOB, скористайтеся командою Modify-DOB, щоб виправити запис.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Для цього користувача немає запитів на перевірку.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Інші подання в системі, що очікують на розгляд:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Перейти до наступного незавершеного",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "Під час запису рішення зображення знищується.",
    // google-translated 2026-06-02
    age_verif_field_method: "Метод ідентифікації:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "Дата народження:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Надіслано за адресою:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "ID подання:",
    // google-translated 2026-06-02
    age_verif_match_question: "Чи підтверджує ідентифікатор записану дату народження користувача?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Так — DOB на ID відповідає записаному значенню",
    // google-translated 2026-06-02
    age_verif_match_no: "Ні — ідентифікатор вказує інший DOB",
    // google-translated 2026-06-02
    age_verif_approve_help: "Підтвердити: підтверджує, що користувач підтверджений як 18+. Відхилити: залишає їх віком до 18 років і надсилає системне PM із причиною.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Підтвердити (позначити перевіреним)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Натомість відхилити…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Відхилити подання",
    // google-translated 2026-06-02
    age_verif_modify_help: "Оновіть DOB користувача відповідно до значення, указаного в ідентифікаторі. Користувач розблоковується або залишається заблокованим автоматично залежно від нового віку.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Дата народження в ID:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Оновіть дату народження та вирішіть",
  },
  vi: { tab_users: 'Người dùng', tab_appeals: 'Khiếu nại', tab_reports: 'Báo cáo', tab_gifts: 'Quà tặng', tab_economy: 'Kinh tế', tab_maintenance: 'Bảo trì', tab_monitor: 'Giám sát quay', tab_banners: 'Banner', tab_funfacts: 'Thú vị', tab_backups: 'Sao lưu', tab_logs: 'Nhật ký', tab_devices: 'Thiết bị', tab_starting_screens: 'Màn hình khởi động', btn_sign_in: 'Đăng nhập', btn_sign_out: 'Đăng xuất', btn_search: 'Tìm kiếm', placeholder_search_uid: 'Nhập ID người dùng', subtab_profile: 'Hồ sơ', subtab_moderation: 'Kiểm duyệt', subtab_security: 'Bảo mật', subtab_economy: 'Kinh tế', label_uid: 'UID', label_display_name: 'Tên hiển thị', label_user_type: 'Loại', label_nationality: 'Quốc tịch', label_description: 'Mô tả', label_email: 'Email', label_date_of_birth: 'Ngày sinh', label_unique_id: 'ID duy nhất', btn_suspend_user: 'Đình chỉ', btn_unsuspend_user: 'Khôi phục', btn_warn: 'Cảnh báo', btn_reset_device: 'Đặt lại thiết bị', btn_reset_gcs: 'Đặt lại GCS', label_shy_coins: 'Shy Coins', label_shy_beans: 'Shy Beans', label_super_shy: 'Super Shy', label_login_streak: 'Chuỗi đăng nhập', status_banned: 'CẤM', status_active: 'Hoạt động', status_suspended: 'Đình chỉ', status_pending: 'Đang chờ', filter_pending: 'Đang chờ', filter_approved: 'Đã duyệt', filter_denied: 'Từ chối', filter_resolved: 'Đã giải quyết', filter_archived: 'Lưu trữ', btn_approve: 'Duyệt', btn_deny: 'Từ chối', btn_resolve: 'Giải quyết', btn_save: 'Lưu', btn_cancel: 'Hủy', btn_delete: 'Xóa', btn_apply: 'Áp dụng', btn_refresh: 'Làm mới', btn_load_more: 'Tải thêm', msg_loading: 'Đang tải...', msg_no_data: 'Không tìm thấy dữ liệu', msg_saved: 'Đã lưu', msg_error: 'Lỗi', label_log_level: 'Mức', label_log_source: 'Nguồn', btn_export_json: 'Xuất JSON', btn_export_csv: 'Xuất CSV', table_device_id: 'ID Thiết bị', table_user: 'Người dùng', table_model: 'Model', table_os: 'HĐH', table_last_ip: 'IP cuối', table_isp: 'ISP', table_country: 'Quốc gia', table_last_seen: 'Lần cuối' , confirm_reset_pin_lockout: 'Đặt lại khoá PIN cho người dùng này?', confirm_unsuspend_user: 'Bỏ đình chỉ người dùng này? Tài khoản sẽ được khôi phục hoàn toàn.', confirm_reset_gcs: 'Đặt lại GCS của người dùng này về 100 và xoá tất cả cảnh báo?', confirm_schedule_deletion: 'Bạn có chắc muốn lên lịch xoá tài khoản này?', alert_deletion_scheduled: 'Đã lên lịch xoá tài khoản.', confirm_cancel_deletion: 'Huỷ lịch xoá tài khoản?' , confirm_remove_all_device_bindings: 'Xoá tất cả ràng buộc thiết bị cho người dùng này?', confirm_remove_device_ban: 'Xoá lệnh cấm thiết bị này?', confirm_remove_network_ban: 'Xoá lệnh cấm mạng này?', confirm_unban_device: 'Bỏ cấm thiết bị này?', confirm_ban_all_devices: 'Cấm tất cả thiết bị của người dùng này?', confirm_remove_all_bans: 'Xoá tất cả lệnh cấm cho người dùng này?', confirm_unsuspend_identity_graph: 'Bỏ đình chỉ đồ thị danh tính cho người dùng này?', alert_deletion_cancelled: 'Đã huỷ xoá tài khoản.' , confirm_clear_temp_id: 'Xoá ID tạm thời?' , confirm_revoke_warning: 'Thu hồi cảnh báo này? +{deduction} GCS sẽ được khôi phục.', confirm_revoke_biometric: 'Thu hồi khoá sinh trắc cho thiết bị {deviceId}?', confirm_issue_warning: 'Phát hành cảnh báo cho "{reason}" (mức độ {severity}, -{deduction} GCS)?', alert_schedule_deletion_failed: 'Không thể lên lịch xoá: {error}', alert_cancel_deletion_failed: 'Không thể huỷ xoá: {error}', confirm_ban_ip: 'Cấm IP {ip}?', confirm_suspend_identity_graph: 'Đình chỉ đồ thị danh tính cho người dùng này ({duration}, {scope})?' , btn_searching: 'Đang tìm kiếm...', btn_email_show: 'Hiện', btn_email_hide: 'Ẩn', btn_email_saving: 'Đang lưu…', btn_undo: 'Hoàn tác', msg_no_warnings: 'Không có cảnh báo', btn_revoke: 'Thu hồi', toast_display_name_empty: 'Tên hiển thị không được để trống', toast_undo_successful: 'Hoàn tác thành công', toast_already_in_list: 'Đã có trong danh sách' , toast_autosave_failed: 'Tự động lưu thất bại: {error}', toast_undo_failed: 'Hoàn tác thất bại: {error}', status_suspended_badge: 'Đình chỉ từ {since} đến {until}. Lý do: {reason}', status_not_suspended: 'Không bị đình chỉ', status_deletion_scheduled: 'Đã lên lịch xoá — còn {days} ngày ({date})', status_severity_gcs: 'Mức độ {severity} (-{deduction} GCS)', msg_permanent: 'vĩnh viễn', msg_no_reason_provided: 'Không có lý do', msg_suspended_since_until_format: 'Đình chỉ từ {since} đến {until}', inline_revoked: 'Đã thu hồi', inline_warning_note: 'Ghi chú: {note}', inline_warning_meta: 'Bởi: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}', toast_warning_revoked_gcs: 'Đã thu hồi cảnh báo, đã khôi phục +{deduction} GCS', toast_pin_lockout_reset: 'Đã đặt lại khóa PIN', toast_biometric_revoked: 'Đã thu hồi khóa sinh trắc', toast_gcs_reset_100: 'Đã đặt lại GCS về 100', toast_action_failed: 'Thất bại: {error}', btn_issuing: 'Đang phát hành...', btn_issue_warning: 'Phát hành cảnh báo', btn_resetting: 'Đang đặt lại...', toast_reason_required: 'Cần lý do', toast_select_reason: 'Chọn một lý do', toast_no_user_loaded: 'Chưa tải người dùng', toast_device_bindings_removed: 'Đã xóa {count} liên kết thiết bị', btn_reset_device_binding: 'Đặt lại liên kết thiết bị', toast_auto_escalate_5_warnings: 'Người dùng này có hơn 5 cảnh báo. Hãy cân nhắc tạm khóa.', toast_no_ip_found: 'Không tìm thấy địa chỉ IP', toast_banned_n_devices: 'Đã chặn {count} thiết bị', toast_removed_n_bans: 'Đã xóa {count} lệnh cấm', toast_partial_retry: 'Một phần: {summary}. Vui lòng thử lại bước thất bại.', toast_user_suspended: 'Đã tạm khóa người dùng', toast_user_unsuspended: 'Đã bỏ tạm khóa người dùng', toast_warning_issued_successfully: 'Đã phát hành cảnh báo', toast_ip_banned: 'Đã chặn IP', toast_identity_graph_suspended: 'Đã tạm khóa đồ thị danh tính', toast_identity_graph_unsuspended: 'Đã bỏ tạm khóa đồ thị danh tính', prompt_deletion_reason: 'Nhập lý do xóa tài khoản (tùy chọn):', prompt_ban_reason: 'Lý do (tùy chọn):', bio_device_label: 'Thiết bị:', bio_registered_label: 'Đã đăng ký:', segment_ban_call_failed: '{count}/{total} lệnh cấm thất bại (đầu tiên: {error})', segment_pm_failed: '{count}/{total} PM thất bại', toast_no_devices_to_ban: 'Không có thiết bị để chặn', toast_enter_positive_amount: 'Nhập số dương', toast_coins_added: 'Đã thêm {amount} xu (hiện tại {balance})', toast_coins_deducted: 'Đã trừ {amount} xu (hiện tại {balance})', toast_beans_added: 'Đã thêm {amount} bean (hiện tại {balance})', toast_beans_deducted: 'Đã trừ {amount} bean (hiện tại {balance})', toast_select_gift_qty: 'Chọn quà và nhập số lượng', toast_gift_added: 'Đã thêm {qty} (tổng hiện tại {total})', toast_backpack_empty_already: 'Ba lô đã trống', msg_loading_backpack: 'Đang tải ba lô...', msg_backpack_empty: 'Ba lô trống', msg_no_matching_gifts: 'Không có quà phù hợp', btn_confirm_clear_all: 'Xác nhận xóa tất cả', btn_confirming: 'Xác nhận ({countdown})', btn_clearing: 'Đang xóa...', toast_backpack_cleared: 'Đã xóa ba lô ({count} mục đã bị xóa)', toast_cleared_with_errors: 'Đã xóa {cleared}, thất bại {errors}', toast_failed_to_save: 'Lưu thất bại: {error}',
    // google-translated 2026-06-02
    tab_suggestions: "Đề xuất",
    // google-translated 2026-06-02
    tab_audit_log: "Nhật ký kiểm tra",
    // google-translated 2026-06-02
    tab_age_segregation: "Phân chia độ tuổi",
    // google-translated 2026-06-02
    age_seg_title: "Phân chia độ tuổi",
    // google-translated 2026-06-02
    age_seg_subtitle: "Kiểm soát phân phối và ghi đè theo nhóm để tuân thủ OSA của Vương quốc Anh.",
    // google-translated 2026-06-02
    age_seg_stats_heading: "Phân phối theo nhóm",
    // override-translated 2026-06-02
    age_seg_refresh: "Làm mới",
    // google-translated 2026-06-02
    age_seg_adult: "Người lớn",
    // google-translated 2026-06-02
    age_seg_minor: "Người vị thành niên",
    // google-translated 2026-06-02
    age_seg_missing: "Thiếu nhóm thuần tập",
    // google-translated 2026-06-02
    age_seg_total: "Tổng số người dùng",
    // google-translated 2026-06-02
    age_seg_override_adult: "Ghi đè → người lớn",
    // override-translated 2026-06-02
    age_seg_override_minor: "Ghi đè → vị thành niên",
    // google-translated 2026-06-02
    age_seg_override_heading: "Ghi đè nhóm thuần tập",
    // google-translated 2026-06-02
    age_seg_override_note: "Ghi đè bỏ qua nhóm thuần tập có nguồn gốc từ DOB. Chỉ được phép trên tài khoản nhân viên hoặc quản trị viên. Mọi thay đổi đều được ghi lại kiểm tra kèm theo lý do được cung cấp.",
    // google-translated 2026-06-02
    age_seg_target_label: "ID người dùng mục tiêu",
    // google-translated 2026-06-02
    age_seg_override_value_label: "Nhóm thuần tập mới",
    // google-translated 2026-06-02
    age_seg_pick: "- nhặt -",
    // google-translated 2026-06-02
    age_seg_clear: "Xóa ghi đè",
    // override-translated 2026-06-02
    age_seg_reason_label: "Lý do (bắt buộc, tối đa 500 ký tự)",
    // google-translated 2026-06-02
    age_seg_apply: "Áp dụng ghi đè",
    // google-translated 2026-06-02
    age_seg_confirm_title: "Xác nhận ghi đè nhóm thuần tập",
    // google-translated 2026-06-02
    age_seg_confirm_body: "Thay đổi này được ghi lại kiểm tra và có thể buộc người dùng mục tiêu phải làm mới mã thông báo. Xem lại chi tiết trước khi xác nhận.",
    // google-translated 2026-06-02
    age_seg_cancel: "Hủy bỏ",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "Xác nhận",
    // google-translated 2026-06-02
    subtab_identity: "Danh tính",
    // google-translated 2026-06-02
    subtab_age_verification: "Xác minh tuổi",
    // google-translated 2026-06-02
    age_verif_panel_title: "Xác minh tuổi",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "Xem lại ID chính phủ đã gửi của người dùng và quyết định. Phê duyệt xác nhận người dùng là 18+. Từ chối giữ họ dưới 18 tuổi và thông báo cho họ. Nếu ID hiển thị DOB khác, hãy sử dụng Modify-DOB để sửa bản ghi.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "Không có gửi xác minh đang chờ xử lý cho người dùng này.",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "Các bài nộp đang chờ xử lý khác trên toàn hệ thống:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Chuyển tới phần tiếp theo đang chờ xử lý",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "Hình ảnh bị phá hủy khi quyết định được ghi lại.",
    // google-translated 2026-06-02
    age_verif_field_method: "Phương thức nhận dạng:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "DOB đã ghi:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Đã gửi tại:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "ID gửi:",
    // google-translated 2026-06-02
    age_verif_match_question: "ID có xác nhận ngày sinh được ghi lại của người dùng không?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Có - DOB trên ID khớp với giá trị được ghi",
    // google-translated 2026-06-02
    age_verif_match_no: "Không - ID hiển thị DOB khác",
    // google-translated 2026-06-02
    age_verif_approve_help: "Phê duyệt: xác nhận người dùng đã được xác minh trên 18 tuổi. Từ chối: giữ họ dưới 18 tuổi và gửi PM hệ thống kèm theo lý do.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Phê duyệt (đánh dấu đã xác minh)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Thay vào đó hãy từ chối…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Từ chối gửi",
    // google-translated 2026-06-02
    age_verif_modify_help: "Cập nhật DOB của người dùng để khớp với giá trị hiển thị trên ID. Người dùng được mở khóa hoặc giữ khóa tự động theo độ tuổi mới.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Ngày sinh trên giấy tờ tùy thân:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Cập nhật DOB và quyết định",
  },
  zh: { tab_users: '\u7528\u6237', tab_appeals: '\u7533\u8BC9', tab_reports: '\u4E3E\u62A5', tab_gifts: '\u793C\u7269', tab_economy: '\u7ECF\u6D4E', tab_maintenance: '\u7EF4\u62A4', tab_monitor: '\u8F6C\u76D8\u76D1\u63A7', tab_banners: '\u6A2A\u5E45', tab_funfacts: '\u8DA3\u95FB', tab_backups: '\u5907\u4EFD', tab_logs: '\u65E5\u5FD7', tab_devices: '\u8BBE\u5907', tab_starting_screens: '\u542F\u52A8\u5C4F\u5E55', btn_sign_in: '\u767B\u5F55', btn_sign_out: '\u9000\u51FA', btn_search: '\u641C\u7D22', placeholder_search_uid: '\u8F93\u5165\u7528\u6237ID', subtab_profile: '\u4E2A\u4EBA\u8D44\u6599', subtab_moderation: '\u7BA1\u7406', subtab_security: '\u5B89\u5168', subtab_economy: '\u7ECF\u6D4E', label_uid: 'UID', label_display_name: '\u663E\u793A\u540D', label_user_type: '\u7C7B\u578B', label_nationality: '\u56FD\u7C4D', label_description: '\u63CF\u8FF0', label_email: '\u90AE\u7BB1', label_date_of_birth: '\u51FA\u751F\u65E5\u671F', label_unique_id: '\u552F\u4E00ID', btn_suspend_user: '\u6682\u505C', btn_unsuspend_user: '\u6062\u590D', btn_warn: '\u8B66\u544A', btn_reset_device: '\u91CD\u7F6E\u8BBE\u5907', btn_reset_gcs: '\u91CD\u7F6EGCS', label_shy_coins: 'Shy\u5E01', label_shy_beans: 'Shy\u8C46', label_super_shy: '\u8D85\u7EA7Shy', label_login_streak: '\u767B\u5F55\u8FDE\u7EED', status_banned: '\u5C01\u7981', status_active: '\u6D3B\u8DC3', status_suspended: '\u6682\u505C', status_pending: '\u5F85\u5904\u7406', filter_pending: '\u5F85\u5904\u7406', filter_approved: '\u5DF2\u6279\u51C6', filter_denied: '\u5DF2\u62D2\u7EDD', filter_resolved: '\u5DF2\u89E3\u51B3', filter_archived: '\u5DF2\u5F52\u6863', btn_approve: '\u6279\u51C6', btn_deny: '\u62D2\u7EDD', btn_resolve: '\u89E3\u51B3', btn_save: '\u4FDD\u5B58', btn_cancel: '\u53D6\u6D88', btn_delete: '\u5220\u9664', btn_apply: '\u5E94\u7528', btn_refresh: '\u5237\u65B0', btn_load_more: '\u52A0\u8F7D\u66F4\u591A', msg_loading: '\u52A0\u8F7D\u4E2D...', msg_no_data: '\u672A\u627E\u5230\u6570\u636E', msg_saved: '\u5DF2\u4FDD\u5B58', msg_error: '\u9519\u8BEF', label_log_level: '\u7EA7\u522B', label_log_source: '\u6765\u6E90', btn_export_json: '\u5BFC\u51FAJSON', btn_export_csv: '\u5BFC\u51FACSV', table_device_id: '\u8BBE\u5907ID', table_user: '\u7528\u6237', table_model: '\u578B\u53F7', table_os: '\u7CFB\u7EDF', table_last_ip: '\u6700\u540EIP', table_isp: '\u8FD0\u8425\u5546', table_country: '\u56FD\u5BB6', table_last_seen: '\u6700\u540E\u767B\u5F55' , confirm_reset_pin_lockout: '重置此用户的 PIN 锁定?', confirm_unsuspend_user: '解除此用户的封禁? 账户将完全恢复。', confirm_reset_gcs: '将此用户的 GCS 重置为 100 并清除所有警告?', confirm_schedule_deletion: '您确定要安排删除此账户吗?', alert_deletion_scheduled: '已安排账户删除。', confirm_cancel_deletion: '取消已安排的账户删除?' , confirm_remove_all_device_bindings: '移除此用户的所有设备绑定?', confirm_remove_device_ban: '移除此设备封禁?', confirm_remove_network_ban: '移除此网络封禁?', confirm_unban_device: '解封此设备?', confirm_ban_all_devices: '封禁此用户的所有设备?', confirm_remove_all_bans: '移除此用户的所有封禁?', confirm_unsuspend_identity_graph: '解除此用户的身份图谱封禁?', alert_deletion_cancelled: '账户删除已取消。' , confirm_clear_temp_id: '清除临时 ID?' , confirm_revoke_warning: '撤销此警告? 将恢复 +{deduction} GCS。', confirm_revoke_biometric: '撤销设备 {deviceId} 的生物识别密钥?', confirm_issue_warning: '为 "{reason}" 发出警告 (严重程度 {severity}, -{deduction} GCS)?', alert_schedule_deletion_failed: '无法安排删除: {error}', alert_cancel_deletion_failed: '无法取消删除: {error}', confirm_ban_ip: '封禁 IP {ip}?', confirm_suspend_identity_graph: '暂停此用户的身份图谱 ({duration}, {scope})?' , btn_searching: '搜索中...', btn_email_show: '显示', btn_email_hide: '隐藏', btn_email_saving: '保存中…', btn_undo: '撤销', msg_no_warnings: '没有警告', btn_revoke: '撤销', toast_display_name_empty: '显示名称不能为空', toast_undo_successful: '撤销成功', toast_already_in_list: '已在列表中' , toast_autosave_failed: '自动保存失败: {error}', toast_undo_failed: '撤销失败: {error}', status_suspended_badge: '自 {since} 起暂停, 直到 {until}. 原因: {reason}', status_not_suspended: '未暂停', status_deletion_scheduled: '已安排删除 — 剩余 {days} 天 ({date})', status_severity_gcs: '严重程度 {severity} (-{deduction} GCS)', msg_permanent: '永久', msg_no_reason_provided: '未提供原因', msg_suspended_since_until_format: '自 {since} 起暂停, 直到 {until}', inline_revoked: '已撤销', inline_warning_note: '备注：{note}', inline_warning_meta: '由：{issuedBy} | GCS：{gcsBefore} → {gcsAfter}', toast_warning_revoked_gcs: '警告已撤销，已恢复 +{deduction} GCS', toast_pin_lockout_reset: 'PIN 锁定已重置', toast_biometric_revoked: '已撤销生物识别密钥', toast_gcs_reset_100: 'GCS 已重置为 100', toast_action_failed: '失败：{error}', btn_issuing: '正在签发...', btn_issue_warning: '签发警告', btn_resetting: '正在重置...', toast_reason_required: '必须填写原因', toast_select_reason: '选择一个原因', toast_no_user_loaded: '未加载任何用户', toast_device_bindings_removed: '已移除 {count} 个设备绑定', btn_reset_device_binding: '重置设备绑定', toast_auto_escalate_5_warnings: '该用户有 5+ 条警告。考虑暂停。', toast_no_ip_found: '未找到 IP 地址', toast_banned_n_devices: '已封禁 {count} 台设备', toast_removed_n_bans: '已移除 {count} 个封禁', toast_partial_retry: '部分完成：{summary}。请重试失败的步骤。', toast_user_suspended: '用户已暂停', toast_user_unsuspended: '已解除用户暂停', toast_warning_issued_successfully: '已成功签发警告', toast_ip_banned: 'IP 已封禁', toast_identity_graph_suspended: '已暂停身份图', toast_identity_graph_unsuspended: '已解除身份图暂停', prompt_deletion_reason: '输入账户删除原因（可选）：', prompt_ban_reason: '原因（可选）：', bio_device_label: '设备：', bio_registered_label: '已注册：', segment_ban_call_failed: '{count}/{total} 个封禁调用失败（首个：{error}）', segment_pm_failed: '{count}/{total} 个私信失败', toast_no_devices_to_ban: '没有要封禁的设备', toast_enter_positive_amount: '请输入正数', toast_coins_added: '已添加 {amount} 金币（当前 {balance}）', toast_coins_deducted: '已扣除 {amount} 金币（当前 {balance}）', toast_beans_added: '已添加 {amount} 豆（当前 {balance}）', toast_beans_deducted: '已扣除 {amount} 豆（当前 {balance}）', toast_select_gift_qty: '选择礼物并输入数量', toast_gift_added: '已添加 {qty}（现在共 {total}）', toast_backpack_empty_already: '背包已为空', msg_loading_backpack: '正在加载背包...', msg_backpack_empty: '背包为空', msg_no_matching_gifts: '没有匹配的礼物', btn_confirm_clear_all: '确认全部清空', btn_confirming: '确认 ({countdown})', btn_clearing: '正在清空...', toast_backpack_cleared: '背包已清空（已移除 {count} 个项目）', toast_cleared_with_errors: '已清空 {cleared}，失败 {errors}', toast_failed_to_save: '保存失败：{error}',
    // google-translated 2026-06-02
    tab_suggestions: "建议",
    // google-translated 2026-06-02
    tab_audit_log: "审核日志",
    // google-translated 2026-06-02
    tab_age_segregation: "年龄隔离",
    // google-translated 2026-06-02
    age_seg_title: "年龄隔离",
    // google-translated 2026-06-02
    age_seg_subtitle: "队列分配和覆盖控制，以符合英国 OSA 合规性。",
    // google-translated 2026-06-02
    age_seg_stats_heading: "群组分布",
    // google-translated 2026-06-02
    age_seg_refresh: "刷新",
    // google-translated 2026-06-02
    age_seg_adult: "成人",
    // override-translated 2026-06-02
    age_seg_minor: "未成年",
    // google-translated 2026-06-02
    age_seg_missing: "失踪队列",
    // google-translated 2026-06-02
    age_seg_total: "用户总数",
    // google-translated 2026-06-02
    age_seg_override_adult: "覆盖 → 成人",
    // override-translated 2026-06-02
    age_seg_override_minor: "覆盖 → 未成年",
    // google-translated 2026-06-02
    age_seg_override_heading: "群组覆盖",
    // google-translated 2026-06-02
    age_seg_override_note: "覆盖绕过 DOB 派生的群组。仅允许在员工或管理员帐户上使用。每项更改都经过审核并附有提供的原因。",
    // google-translated 2026-06-02
    age_seg_target_label: "目标用户ID",
    // google-translated 2026-06-02
    age_seg_override_value_label: "新队列",
    // google-translated 2026-06-02
    age_seg_pick: "- 挑选 -",
    // google-translated 2026-06-02
    age_seg_clear: "清除覆盖",
    // google-translated 2026-06-02
    age_seg_reason_label: "原因（必填，≤500个字符）",
    // google-translated 2026-06-02
    age_seg_apply: "应用覆盖",
    // google-translated 2026-06-02
    age_seg_confirm_title: "确认群组覆盖",
    // google-translated 2026-06-02
    age_seg_confirm_body: "此更改会进行审核记录，并可能会强制目标用户刷新令牌。确认前请检查详细信息。",
    // google-translated 2026-06-02
    age_seg_cancel: "取消",
    // google-translated 2026-06-02
    age_seg_confirm_ok: "确认",
    // google-translated 2026-06-02
    subtab_identity: "身份",
    // google-translated 2026-06-02
    subtab_age_verification: "年龄验证",
    // google-translated 2026-06-02
    age_verif_panel_title: "年龄验证",
    // google-translated 2026-06-02
    age_verif_panel_subtitle: "审核用户提交的政府 ID 并做出决定。批准确认用户已年满 18 岁。拒绝让他们低于 18 岁并通知他们。如果 ID 显示不同的 DOB，请使用修改 DOB 更正记录。",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user: "该用户没有待处理的验证提交。",
    // google-translated 2026-06-02
    age_verif_other_pending_label: "整个系统中其他待提交的内容：",
    // google-translated 2026-06-02
    age_verif_jump_next: "跳转到下一个待处理",
    // google-translated 2026-06-02
    age_verif_image_disclaimer: "当决定被记录时，图像被破坏。",
    // google-translated 2026-06-02
    age_verif_field_method: "识别方法：",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "记录出生日期：",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "提交于：",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "提交ID：",
    // google-translated 2026-06-02
    age_verif_match_question: "ID 是否确认用户记录的出生日期？",
    // google-translated 2026-06-02
    age_verif_match_yes: "是 — ID 上的 DOB 与记录值匹配",
    // google-translated 2026-06-02
    age_verif_match_no: "否 — ID 显示不同的出生日期",
    // google-translated 2026-06-02
    age_verif_approve_help: "批准：确认用户已年满 18 岁。拒绝：保留 sub-18 并发送系统 PM 并说明原因。",
    // google-translated 2026-06-02
    age_verif_approve_button: "批准（标记已验证）",
    // google-translated 2026-06-02
    age_verif_reject_summary: "而是拒绝...",
    // google-translated 2026-06-02
    age_verif_reject_button: "拒绝提交",
    // google-translated 2026-06-02
    age_verif_modify_help: "更新用户的出生日期以匹配 ID 上显示的值。根据新年龄自动解锁或保持锁定用户。",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "身份证上的出生日期：",
    // google-translated 2026-06-02
    age_verif_modify_button: "更新 DOB 并决定",
  },
};

// Apply translations to elements with data-i18n attribute.
// When the element has child elements (e.g. a notification-badge <span>
// inside a tab button), replace only the first text node so the children
// survive — setting `textContent` would wipe them. Without this guard,
// adding a translation key for a button-with-badge silently destroys
// the badge on every applyLanguage() call.
function applyAdminTranslations(lang) {
  var t = ADMIN_TRANSLATIONS[lang] || ADMIN_TRANSLATIONS.en;
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    var key = el.getAttribute('data-i18n');
    if (!t[key]) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = t[key];
      return;
    }
    if (el.children.length > 0) {
      // Has child elements — find first text node and replace ONLY that.
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === Node.TEXT_NODE) {
          el.childNodes[i].nodeValue = t[key];
          return;
        }
      }
      // No text node yet — prepend one so we don't disturb the children.
      el.insertBefore(document.createTextNode(t[key]), el.firstChild);
      return;
    }
    el.textContent = t[key];
  });
}

// Hook into language selector
window.applyLanguage = function(lang) {
  applyAdminTranslations(lang);
};

// Runtime translation helper for JS-generated strings (confirm() /
// alert() / showToast() / dynamic textContent). The HTML attribute
// walker above only handles strings rendered via [data-i18n="key"];
// dialogs and toasts triggered by user actions need a plain function
// call. tAdmin('key') reads the current language fresh on each call so
// language switches mid-session take effect for subsequent dialogs.
//
// Falls back to English then to the key itself, mirroring sgT() in
// suggestions-i18n.js. Never returns undefined — callers can safely
// pass the result straight to confirm() / alert() without null guards.
function tAdmin(key) {
  var lang = (window.ShyTalkLanguage && typeof window.ShyTalkLanguage.get === 'function')
    ? window.ShyTalkLanguage.get()
    : (function() {
        try { return localStorage.getItem('shytalk_language') || 'en'; }
        catch (_e) { return 'en'; }
      })();
  var dict = ADMIN_TRANSLATIONS[lang] || ADMIN_TRANSLATIONS.en || {};
  if (dict[key] !== undefined) return dict[key];
  if (ADMIN_TRANSLATIONS.en && ADMIN_TRANSLATIONS.en[key] !== undefined) return ADMIN_TRANSLATIONS.en[key];
  return key;
}
window.tAdmin = tAdmin;

// Interpolating sibling of tAdmin. Replaces `{name}` placeholders in
// the template with values from `vars` (uses String() so numeric vars
// like severity counts coerce cleanly). Placeholder-by-name (vs %s
// positional) lets translators reorder placeholders for grammar — many
// non-English locales prefer different ordering inside parenthesised
// clauses. Missing vars leave the literal `{name}` in place so the
// problem is visible at runtime rather than producing 'undefined'
// strings that confuse operators.
function tAdminFmt(key, vars) {
  var template = tAdmin(key);
  return template.replace(/\{(\w+)\}/g, function(match, name) {
    return (vars && vars[name] !== undefined && vars[name] !== null)
      ? String(vars[name])
      : match;
  });
}
window.tAdminFmt = tAdminFmt;
