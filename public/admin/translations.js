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
    tab_users: "Users",
    tab_appeals: "Appeals",
    tab_support: "Support",
    tab_reports: "Reports",
    tab_gifts: "Gifts",
    tab_economy: "Economy",
    tab_maintenance: "Maintenance",
    tab_monitor: "Spin Monitor",
    tab_banners: "Banners",
    tab_backups: "Backups",
    tab_logs: "Logs",
    tab_devices: "Devices",
    tab_starting_screens: "Starting Screens",
    // Auth
    btn_sign_in: "Sign In",
    btn_sign_out: "Sign Out",
    // Search
    btn_search: "Search",
    placeholder_search_uid: "Enter ShyTalk User ID",
    // User subtabs
    subtab_profile: "Profile",
    subtab_moderation: "Moderation",
    subtab_security: "Security",
    subtab_economy: "Economy",
    // User profile labels
    label_uid: "UID",
    label_display_name: "Display Name",
    label_user_type: "User Type",
    label_nationality: "Nationality",
    label_description: "Description",
    label_email: "Email",
    label_date_of_birth: "Date of Birth",
    label_unique_id: "Unique ID",
    // Actions
    btn_suspend_user: "Suspend User",
    btn_unsuspend_user: "Unsuspend",
    btn_warn: "Issue Warning",
    btn_reset_device: "Reset Device Binding",
    btn_reset_gcs: "Reset GCS",
    // Economy
    label_shy_coins: "Shy Coins",
    label_shy_beans: "Shy Beans",
    label_super_shy: "Super Shy",
    label_login_streak: "Login Streak",
    // Status
    status_banned: "BANNED",
    status_active: "Active",
    status_suspended: "Suspended",
    status_pending: "Pending",
    // Filters
    filter_pending: "Pending",
    filter_approved: "Approved",
    filter_denied: "Denied",
    filter_resolved: "Resolved",
    filter_archived: "Archived",
    // Actions
    btn_approve: "Approve",
    btn_deny: "Deny",
    btn_resolve: "Resolve",
    // General
    btn_save: "Save",
    btn_cancel: "Cancel",
    btn_delete: "Delete",
    btn_apply: "Apply",
    btn_refresh: "Refresh",
    btn_load_more: "Load More",
    msg_loading: "Loading...",
    msg_no_data: "No data found",
    msg_saved: "Saved",
    msg_error: "Error",
    // Logs
    label_log_level: "Level",
    label_log_source: "Source",
    btn_export_json: "Export JSON",
    btn_export_csv: "Export CSV",
    // Devices
    table_device_id: "Device ID",
    table_user: "User",
    table_model: "Model",
    table_os: "OS",
    table_last_ip: "Last IP",
    table_isp: "ISP",
    table_country: "Country",
    table_last_seen: "Last Seen",
    // Tabs / sub-tabs (User panel — Age Verification + Identity + Audit Log + Suggestions)
    tab_suggestions: "Suggestions",
    tab_audit_log: "Audit Log",
    // Age Segregation tab (UK OSA #17 PR 13) — full 20-locale translations land in PR 14
    tab_age_segregation: "Age Segregation",
    age_seg_title: "Age Segregation",
    age_seg_subtitle:
      "Cohort distribution and override controls for UK OSA compliance.",
    age_seg_stats_heading: "Cohort Distribution",
    age_seg_refresh: "Refresh",
    age_seg_adult: "Adult",
    age_seg_minor: "Minor",
    age_seg_missing: "Missing cohort",
    age_seg_total: "Total users",
    age_seg_override_adult: "Override → adult",
    age_seg_override_minor: "Override → minor",
    age_seg_override_heading: "Cohort Override",
    age_seg_override_note:
      "Overrides bypass the DOB-derived cohort. Only allowed on staff or admin accounts. Every change is audit-logged with the supplied reason.",
    age_seg_target_label: "Target user ID",
    age_seg_override_value_label: "New cohort",
    age_seg_pick: "— pick —",
    age_seg_clear: "Clear override",
    age_seg_reason_label: "Reason (required, ≤500 chars)",
    age_seg_apply: "Apply Override",
    age_seg_confirm_title: "Confirm cohort override",
    age_seg_confirm_body:
      "This change is audit-logged and may force a token refresh on the target user. Review the details before confirming.",
    age_seg_cancel: "Cancel",
    age_seg_confirm_ok: "Confirm",
    subtab_identity: "Identity",
    subtab_age_verification: "Age Verification",
    // User → Age Verification panel
    age_verif_panel_title: "Age Verification",
    age_verif_panel_subtitle:
      "Review the user's submitted government ID and decide. Approve confirms the user is 18+. Reject keeps them sub-18 and notifies them. If the ID shows a different DOB, use Modify-DOB to correct the record.",
    age_verif_no_pending_for_user:
      "No pending verification submission for this user.",
    age_verif_other_pending_label:
      "Other pending submissions across the system:",
    age_verif_jump_next: "Jump to next pending",
    age_verif_image_disclaimer:
      "Image is destroyed when the decision is recorded.",
    age_verif_field_method: "ID method:",
    age_verif_field_recorded_dob: "Recorded DOB:",
    age_verif_field_submitted_at: "Submitted at:",
    age_verif_field_submission_id: "Submission ID:",
    age_verif_match_question:
      "Does the ID confirm the user's recorded date of birth?",
    age_verif_match_yes: "Yes — DOB on the ID matches the recorded value",
    age_verif_match_no: "No — the ID shows a different DOB",
    age_verif_approve_help:
      "Approve: confirms the user as 18+ verified. Reject: keeps them sub-18 and sends a system PM with the reason.",
    age_verif_approve_button: "Approve (mark verified)",
    age_verif_reject_summary: "Reject instead…",
    age_verif_reject_button: "Reject submission",
    age_verif_modify_help:
      "Update the user's DOB to match the value shown on the ID. The user is unlocked or kept locked automatically based on the new age.",
    age_verif_new_dob_label: "Date of birth on the ID:",
    age_verif_modify_button: "Update DOB & decide",
    confirm_reset_pin_lockout: "Reset PIN lockout for this user?",
    confirm_unsuspend_user:
      "Unsuspend this user? Their account will be fully restored.",
    confirm_reset_gcs: "Reset this user's GCS to 100 and clear all warnings?",
    confirm_schedule_deletion:
      "Are you sure you want to schedule this account for deletion?",
    alert_deletion_scheduled: "Account deletion scheduled.",
    confirm_cancel_deletion: "Cancel the scheduled account deletion?",
    confirm_remove_all_device_bindings:
      "Remove all device bindings for this user?",
    confirm_remove_device_ban: "Remove this device ban?",
    confirm_remove_network_ban: "Remove this network ban?",
    confirm_unban_device: "Unban this device?",
    confirm_ban_all_devices: "Ban all devices for this user?",
    confirm_remove_all_bans: "Remove all bans for this user?",
    confirm_unsuspend_identity_graph: "Unsuspend identity graph for this user?",
    alert_deletion_cancelled: "Account deletion cancelled.",
    confirm_clear_temp_id: "Clear the temporary ID?",
    confirm_revoke_warning:
      "Revoke this warning? +{deduction} GCS will be restored.",
    confirm_revoke_biometric: "Revoke biometric key for device {deviceId}?",
    confirm_issue_warning:
      'Issue a warning for "{reason}" (severity {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: "Failed to schedule deletion: {error}",
    alert_cancel_deletion_failed: "Failed to cancel deletion: {error}",
    confirm_ban_ip: "Ban IP {ip}?",
    confirm_suspend_identity_graph:
      "Suspend identity graph for this user ({duration}, {scope})?",
    btn_searching: "Searching...",
    btn_email_show: "Show",
    btn_email_hide: "Hide",
    btn_email_saving: "Saving…",
    btn_undo: "Undo",
    msg_no_warnings: "No warnings",
    btn_revoke: "Revoke",
    toast_display_name_empty: "Display name cannot be empty",
    toast_undo_successful: "Undo successful",
    toast_already_in_list: "Already in list",
    toast_autosave_failed: "Auto-save failed: {error}",
    toast_undo_failed: "Undo failed: {error}",
    status_suspended_badge:
      "Suspended since {since}, until {until}. Reason: {reason}",
    status_not_suspended: "Not Suspended",
    status_deletion_scheduled:
      "Deletion scheduled — {days} days remaining ({date})",
    status_severity_gcs: "Severity {severity} (-{deduction} GCS)",
    msg_permanent: "permanent",
    msg_no_reason_provided: "No reason provided",
    msg_suspended_since_until_format: "Suspended since {since}, until {until}",
    inline_revoked: "Revoked",
    inline_warning_note: "Note: {note}",
    inline_warning_meta: "By: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}",
    toast_warning_revoked_gcs: "Warning revoked, +{deduction} GCS restored",
    toast_pin_lockout_reset: "PIN lockout reset",
    toast_biometric_revoked: "Biometric key revoked",
    toast_gcs_reset_100: "GCS reset to 100",
    toast_action_failed: "Failed: {error}",
    btn_issuing: "Issuing...",
    btn_issue_warning: "Issue Warning",
    btn_resetting: "Resetting...",
    toast_reason_required: "Reason is required",
    toast_select_reason: "Select a reason",
    toast_no_user_loaded: "No user loaded",
    toast_device_bindings_removed: "Removed {count} device binding(s)",
    btn_reset_device_binding: "Reset Device Binding",
    toast_auto_escalate_5_warnings:
      "This user has 5+ warnings. Consider suspending.",
    toast_no_ip_found: "No IP address found",
    toast_banned_n_devices: "Banned {count} device(s)",
    toast_removed_n_bans: "Removed {count} ban(s)",
    toast_partial_retry: "Partial: {summary}. Please retry the failed step.",
    toast_user_suspended: "User suspended",
    toast_user_unsuspended: "User unsuspended",
    toast_user_already_unsuspended: "User is already unsuspended",
    toast_warning_issued_successfully: "Warning issued successfully",
    toast_ip_banned: "IP banned",
    toast_identity_graph_suspended: "Identity graph suspended",
    toast_identity_graph_unsuspended: "Identity graph unsuspended",
    prompt_deletion_reason: "Enter reason for account deletion (optional):",
    prompt_ban_reason: "Reason (optional):",
    bio_device_label: "Device:",
    bio_registered_label: "Registered:",
    segment_ban_call_failed:
      "{count}/{total} ban call(s) failed (first: {error})",
    segment_pm_failed: "{count}/{total} PMs failed",
    toast_no_devices_to_ban: "No devices to ban",
    toast_enter_positive_amount: "Enter a positive amount",
    toast_coins_added: "Added {amount} coins (now {balance})",
    toast_coins_deducted: "Deducted {amount} coins (now {balance})",
    toast_beans_added: "Added {amount} beans (now {balance})",
    toast_beans_deducted: "Deducted {amount} beans (now {balance})",
    toast_select_gift_qty: "Select a gift and enter a quantity",
    toast_gift_added: "Added {qty} (total now {total})",
    toast_backpack_empty_already: "Backpack is already empty",
    msg_loading_backpack: "Loading backpack...",
    msg_backpack_empty: "Backpack is empty",
    msg_no_matching_gifts: "No matching gifts",
    btn_confirm_clear_all: "Confirm Clear All",
    btn_confirming: "Confirm ({countdown})",
    btn_clearing: "Clearing...",
    toast_backpack_cleared: "Backpack cleared ({count} items removed)",
    toast_cleared_with_errors: "Cleared {cleared}, failed {errors}",
    toast_failed_to_save: "Failed to save: {error}",
  },
  id: {
    tab_users: "Pengguna",
    tab_appeals: "Banding",
    tab_support: "Dukungan",
    tab_reports: "Laporan",
    tab_gifts: "Hadiah",
    tab_economy: "Ekonomi",
    tab_maintenance: "Pemeliharaan",
    tab_monitor: "Monitor Putaran",
    tab_banners: "Banner",
    tab_backups: "Cadangan",
    tab_logs: "Log",
    tab_devices: "Perangkat",
    tab_starting_screens: "Layar Awal",
    btn_sign_in: "Masuk",
    btn_sign_out: "Keluar",
    btn_search: "Cari",
    placeholder_search_uid: "Masukkan ID Pengguna",
    subtab_profile: "Profil",
    subtab_moderation: "Moderasi",
    subtab_security: "Keamanan",
    subtab_economy: "Ekonomi",
    label_uid: "UID",
    label_display_name: "Nama Tampilan",
    label_user_type: "Tipe",
    label_nationality: "Kebangsaan",
    label_description: "Deskripsi",
    label_email: "Email",
    label_date_of_birth: "Tanggal Lahir",
    label_unique_id: "ID Unik",
    btn_suspend_user: "Tangguhkan",
    btn_unsuspend_user: "Aktifkan",
    btn_warn: "Beri Peringatan",
    btn_reset_device: "Reset Perangkat",
    btn_reset_gcs: "Reset GCS",
    label_shy_coins: "Shy Coins",
    label_shy_beans: "Shy Beans",
    label_super_shy: "Super Shy",
    label_login_streak: "Seri Login",
    status_banned: "DIBLOKIR",
    status_active: "Aktif",
    status_suspended: "Ditangguhkan",
    status_pending: "Tertunda",
    filter_pending: "Tertunda",
    filter_approved: "Disetujui",
    filter_denied: "Ditolak",
    filter_resolved: "Diselesaikan",
    filter_archived: "Diarsipkan",
    btn_approve: "Setujui",
    btn_deny: "Tolak",
    btn_resolve: "Selesaikan",
    btn_save: "Simpan",
    btn_cancel: "Batal",
    btn_delete: "Hapus",
    btn_apply: "Terapkan",
    btn_refresh: "Segarkan",
    btn_load_more: "Muat lebih",
    msg_loading: "Memuat...",
    msg_no_data: "Data tidak ditemukan",
    msg_saved: "Disimpan",
    msg_error: "Kesalahan",
    label_log_level: "Level",
    label_log_source: "Sumber",
    btn_export_json: "Ekspor JSON",
    btn_export_csv: "Ekspor CSV",
    table_device_id: "ID Perangkat",
    table_user: "Pengguna",
    table_model: "Model",
    table_os: "OS",
    table_last_ip: "IP Terakhir",
    table_isp: "ISP",
    table_country: "Negara",
    table_last_seen: "Terakhir Dilihat",
    confirm_reset_pin_lockout: "Reset penguncian PIN untuk pengguna ini?",
    confirm_unsuspend_user:
      "Cabut penangguhan pengguna ini? Akunnya akan dipulihkan sepenuhnya.",
    confirm_reset_gcs:
      "Reset GCS pengguna ini ke 100 dan hapus semua peringatan?",
    confirm_schedule_deletion:
      "Anda yakin ingin menjadwalkan penghapusan akun ini?",
    alert_deletion_scheduled: "Penghapusan akun dijadwalkan.",
    confirm_cancel_deletion: "Batalkan penghapusan akun terjadwal?",
    confirm_remove_all_device_bindings:
      "Hapus semua keterikatan perangkat untuk pengguna ini?",
    confirm_remove_device_ban: "Hapus larangan perangkat ini?",
    confirm_remove_network_ban: "Hapus larangan jaringan ini?",
    confirm_unban_device: "Buka blokir perangkat ini?",
    confirm_ban_all_devices: "Blokir semua perangkat pengguna ini?",
    confirm_remove_all_bans: "Hapus semua larangan untuk pengguna ini?",
    confirm_unsuspend_identity_graph:
      "Cabut penangguhan grafik identitas untuk pengguna ini?",
    alert_deletion_cancelled: "Penghapusan akun dibatalkan.",
    confirm_clear_temp_id: "Hapus ID sementara?",
    confirm_revoke_warning:
      "Cabut peringatan ini? +{deduction} GCS akan dipulihkan.",
    confirm_revoke_biometric:
      "Cabut kunci biometrik untuk perangkat {deviceId}?",
    confirm_issue_warning:
      'Terbitkan peringatan untuk "{reason}" (tingkat {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: "Gagal menjadwalkan penghapusan: {error}",
    alert_cancel_deletion_failed: "Gagal membatalkan penghapusan: {error}",
    confirm_ban_ip: "Blokir IP {ip}?",
    confirm_suspend_identity_graph:
      "Tangguhkan grafik identitas untuk pengguna ini ({duration}, {scope})?",
    btn_searching: "Mencari...",
    btn_email_show: "Tampilkan",
    btn_email_hide: "Sembunyikan",
    btn_email_saving: "Menyimpan…",
    btn_undo: "Urungkan",
    msg_no_warnings: "Tidak ada peringatan",
    btn_revoke: "Cabut",
    toast_display_name_empty: "Nama tampilan tidak boleh kosong",
    toast_undo_successful: "Urungkan berhasil",
    toast_already_in_list: "Sudah ada dalam daftar",
    toast_autosave_failed: "Penyimpanan otomatis gagal: {error}",
    toast_undo_failed: "Urungkan gagal: {error}",
    status_suspended_badge:
      "Ditangguhkan sejak {since}, hingga {until}. Alasan: {reason}",
    status_not_suspended: "Tidak ditangguhkan",
    status_deletion_scheduled:
      "Penghapusan dijadwalkan — {days} hari tersisa ({date})",
    status_severity_gcs: "Tingkat {severity} (-{deduction} GCS)",
    msg_permanent: "permanen",
    msg_no_reason_provided: "Tidak ada alasan",
    msg_suspended_since_until_format:
      "Ditangguhkan sejak {since}, hingga {until}",
    inline_revoked: "Dicabut",
    inline_warning_note: "Catatan: {note}",
    inline_warning_meta: "Oleh: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}",
    toast_warning_revoked_gcs:
      "Peringatan dicabut, +{deduction} GCS dipulihkan",
    toast_pin_lockout_reset: "Kunci PIN diatur ulang",
    toast_biometric_revoked: "Kunci biometrik dicabut",
    toast_gcs_reset_100: "GCS diatur ulang ke 100",
    toast_action_failed: "Gagal: {error}",
    btn_issuing: "Menerbitkan...",
    btn_issue_warning: "Terbitkan Peringatan",
    btn_resetting: "Mengatur ulang...",
    toast_reason_required: "Alasan diperlukan",
    toast_select_reason: "Pilih alasan",
    toast_no_user_loaded: "Tidak ada pengguna dimuat",
    toast_device_bindings_removed: "Menghapus {count} pengikatan perangkat",
    btn_reset_device_binding: "Atur Ulang Pengikatan Perangkat",
    toast_auto_escalate_5_warnings:
      "Pengguna ini memiliki 5+ peringatan. Pertimbangkan untuk menangguhkan.",
    toast_no_ip_found: "Alamat IP tidak ditemukan",
    toast_banned_n_devices: "Memblokir {count} perangkat",
    toast_removed_n_bans: "Menghapus {count} larangan",
    toast_partial_retry:
      "Sebagian: {summary}. Silakan coba ulang langkah yang gagal.",
    toast_user_suspended: "Pengguna ditangguhkan",
    toast_user_unsuspended: "Penangguhan pengguna dicabut",
    toast_warning_issued_successfully: "Peringatan berhasil diterbitkan",
    toast_ip_banned: "IP diblokir",
    toast_identity_graph_suspended: "Grafik identitas ditangguhkan",
    toast_identity_graph_unsuspended: "Penangguhan grafik identitas dicabut",
    prompt_deletion_reason: "Masukkan alasan penghapusan akun (opsional):",
    prompt_ban_reason: "Alasan (opsional):",
    bio_device_label: "Perangkat:",
    bio_registered_label: "Terdaftar:",
    segment_ban_call_failed:
      "{count}/{total} panggilan ban gagal (pertama: {error})",
    segment_pm_failed: "{count}/{total} PM gagal",
    toast_no_devices_to_ban: "Tidak ada perangkat untuk diblokir",
    toast_enter_positive_amount: "Masukkan jumlah positif",
    toast_coins_added: "Menambahkan {amount} koin (sekarang {balance})",
    toast_coins_deducted: "Mengurangi {amount} koin (sekarang {balance})",
    toast_beans_added: "Menambahkan {amount} beans (sekarang {balance})",
    toast_beans_deducted: "Mengurangi {amount} beans (sekarang {balance})",
    toast_select_gift_qty: "Pilih hadiah dan masukkan jumlah",
    toast_gift_added: "Menambahkan {qty} (total sekarang {total})",
    toast_backpack_empty_already: "Tas ransel sudah kosong",
    msg_loading_backpack: "Memuat tas ransel...",
    msg_backpack_empty: "Tas ransel kosong",
    msg_no_matching_gifts: "Tidak ada hadiah yang cocok",
    btn_confirm_clear_all: "Konfirmasi Hapus Semua",
    btn_confirming: "Konfirmasi ({countdown})",
    btn_clearing: "Menghapus...",
    toast_backpack_cleared: "Tas ransel dikosongkan ({count} item dihapus)",
    toast_cleared_with_errors: "Dihapus {cleared}, gagal {errors}",
    toast_failed_to_save: "Gagal menyimpan: {error}",
    // google-translated 2026-06-02
    tab_suggestions: "Saran",
    // google-translated 2026-06-02
    tab_audit_log: "Catatan Audit",
    // google-translated 2026-06-02
    tab_age_segregation: "Pemisahan Usia",
    // google-translated 2026-06-02
    age_seg_title: "Pemisahan Usia",
    // google-translated 2026-06-02
    age_seg_subtitle:
      "Distribusi kelompok dan kontrol penggantian untuk kepatuhan OSA Inggris.",
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
    age_seg_override_note:
      "Penggantian melewati kelompok turunan DOB. Hanya diperbolehkan pada akun staf atau admin. Setiap perubahan dicatat secara audit dengan alasan yang diberikan.",
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
    age_seg_confirm_body:
      "Perubahan ini dicatat dalam log audit dan mungkin memaksa penyegaran token pada pengguna target. Tinjau detailnya sebelum mengonfirmasi.",
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
    age_verif_panel_subtitle:
      "Tinjau tanda pengenal pemerintah yang dikirimkan pengguna dan putuskan. Setujui mengonfirmasi bahwa pengguna berusia 18+. Tolak membuat mereka tetap di bawah 18 dan memberi tahu mereka. Jika ID menunjukkan DOB yang berbeda, gunakan Modify-DOB untuk memperbaiki catatan.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user:
      "Tidak ada pengiriman verifikasi yang tertunda untuk pengguna ini.",
    // google-translated 2026-06-02
    age_verif_other_pending_label:
      "Pengiriman lain yang tertunda di seluruh sistem:",
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
    age_verif_match_question:
      "Apakah ID mengonfirmasi tanggal lahir pengguna yang tercatat?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Ya — DOB pada ID cocok dengan nilai yang tercatat",
    // google-translated 2026-06-02
    age_verif_match_no: "Tidak — ID menunjukkan DOB yang berbeda",
    // google-translated 2026-06-02
    age_verif_approve_help:
      "Setujui: mengonfirmasi pengguna berusia 18+ terverifikasi. Tolak: simpan di bawah 18 dan kirimkan PM sistem beserta alasannya.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Setujui (tandai terverifikasi)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Tolak saja…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Tolak pengajuan",
    // google-translated 2026-06-02
    age_verif_modify_help:
      "Perbarui DOB pengguna agar sesuai dengan nilai yang tertera pada ID. Pengguna tidak terkunci atau tetap terkunci secara otomatis berdasarkan usia baru.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Tanggal lahir pada KTP:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Perbarui DOB & putuskan",
    // google-translated 2026-06-03
    toast_user_already_unsuspended: "Penangguhan pengguna sudah dibatalkan",
  },
  th: {
    tab_users: "\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49",
    tab_appeals: "\u0E2D\u0E38\u0E17\u0E18\u0E23\u0E13\u0E4C",
    tab_support:
      "\u0E1D\u0E48\u0E32\u0E22\u0E2A\u0E19\u0E31\u0E1A\u0E2A\u0E19\u0E38\u0E19",
    tab_reports: "\u0E23\u0E32\u0E22\u0E07\u0E32\u0E19",
    tab_gifts: "\u0E02\u0E2D\u0E07\u0E02\u0E27\u0E31\u0E0D",
    tab_economy: "\u0E40\u0E28\u0E23\u0E29\u0E10\u0E01\u0E34\u0E08",
    tab_maintenance:
      "\u0E01\u0E32\u0E23\u0E1A\u0E33\u0E23\u0E38\u0E07\u0E23\u0E31\u0E01\u0E29\u0E32",
    tab_monitor:
      "\u0E21\u0E2D\u0E19\u0E34\u0E40\u0E15\u0E2D\u0E23\u0E4C\u0E2A\u0E1B\u0E34\u0E19",
    tab_banners: "\u0E41\u0E1A\u0E19\u0E40\u0E19\u0E2D\u0E23\u0E4C",
    tab_backups: "\u0E2A\u0E33\u0E23\u0E2D\u0E07",
    tab_logs: "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01",
    tab_devices: "\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C",
    tab_starting_screens:
      "\u0E2B\u0E19\u0E49\u0E32\u0E08\u0E2D\u0E40\u0E23\u0E34\u0E48\u0E21",
    btn_sign_in:
      "\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A",
    btn_sign_out:
      "\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E23\u0E30\u0E1A\u0E1A",
    btn_search: "\u0E04\u0E49\u0E19\u0E2B\u0E32",
    placeholder_search_uid:
      "\u0E01\u0E23\u0E2D\u0E01 ID \u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49",
    subtab_profile: "\u0E42\u0E1B\u0E23\u0E44\u0E1F\u0E25\u0E4C",
    subtab_moderation: "\u0E01\u0E32\u0E23\u0E14\u0E39\u0E41\u0E25",
    subtab_security:
      "\u0E04\u0E27\u0E32\u0E21\u0E1B\u0E25\u0E2D\u0E14\u0E20\u0E31\u0E22",
    subtab_economy: "\u0E40\u0E28\u0E23\u0E29\u0E10\u0E01\u0E34\u0E08",
    label_uid: "UID",
    label_display_name:
      "\u0E0A\u0E37\u0E48\u0E2D\u0E17\u0E35\u0E48\u0E41\u0E2A\u0E14\u0E07",
    label_user_type: "\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17",
    label_nationality: "\u0E2A\u0E31\u0E0D\u0E0A\u0E32\u0E15\u0E34",
    label_description: "\u0E04\u0E33\u0E2D\u0E18\u0E34\u0E1A\u0E32\u0E22",
    label_email: "\u0E2D\u0E35\u0E40\u0E21\u0E25",
    label_date_of_birth: "\u0E27\u0E31\u0E19\u0E40\u0E01\u0E34\u0E14",
    label_unique_id: "ID \u0E40\u0E09\u0E1E\u0E32\u0E30",
    btn_suspend_user: "\u0E23\u0E30\u0E07\u0E31\u0E1A",
    btn_unsuspend_user: "\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01",
    btn_warn: "\u0E40\u0E15\u0E37\u0E2D\u0E19",
    btn_reset_device:
      "\u0E23\u0E35\u0E40\u0E0B\u0E47\u0E15\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C",
    btn_reset_gcs: "\u0E23\u0E35\u0E40\u0E0B\u0E47\u0E15 GCS",
    label_shy_coins: "Shy Coins",
    label_shy_beans: "Shy Beans",
    label_super_shy: "Super Shy",
    label_login_streak:
      "\u0E2A\u0E15\u0E23\u0E35\u0E04\u0E40\u0E02\u0E49\u0E32\u0E2A\u0E39\u0E48\u0E23\u0E30\u0E1A\u0E1A",
    status_banned: "\u0E16\u0E39\u0E01\u0E41\u0E1A\u0E19",
    status_active: "\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19",
    status_suspended: "\u0E16\u0E39\u0E01\u0E23\u0E30\u0E07\u0E31\u0E1A",
    status_pending:
      "\u0E23\u0E2D\u0E14\u0E33\u0E40\u0E19\u0E34\u0E19\u0E01\u0E32\u0E23",
    filter_pending: "\u0E23\u0E2D",
    filter_approved: "\u0E2D\u0E19\u0E38\u0E21\u0E31\u0E15\u0E34",
    filter_denied: "\u0E1B\u0E0F\u0E34\u0E40\u0E2A\u0E18",
    filter_resolved: "\u0E41\u0E01\u0E49\u0E44\u0E02\u0E41\u0E25\u0E49\u0E27",
    filter_archived: "\u0E40\u0E01\u0E47\u0E1A\u0E16\u0E32\u0E27\u0E23",
    btn_approve: "\u0E2D\u0E19\u0E38\u0E21\u0E31\u0E15\u0E34",
    btn_deny: "\u0E1B\u0E0F\u0E34\u0E40\u0E2A\u0E18",
    btn_resolve: "\u0E41\u0E01\u0E49\u0E44\u0E02",
    btn_save: "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01",
    btn_cancel: "\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01",
    btn_delete: "\u0E25\u0E1A",
    btn_apply: "\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19",
    btn_refresh: "\u0E23\u0E35\u0E40\u0E1F\u0E23\u0E0A",
    btn_load_more: "\u0E42\u0E2B\u0E25\u0E14\u0E40\u0E1E\u0E34\u0E48\u0E21",
    msg_loading: "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E42\u0E2B\u0E25\u0E14...",
    msg_no_data:
      "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E02\u0E49\u0E2D\u0E21\u0E39\u0E25",
    msg_saved: "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E41\u0E25\u0E49\u0E27",
    msg_error: "\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14",
    label_log_level: "\u0E23\u0E30\u0E14\u0E31\u0E1A",
    label_log_source: "\u0E41\u0E2B\u0E25\u0E48\u0E07",
    btn_export_json: "\u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01 JSON",
    btn_export_csv: "\u0E2A\u0E48\u0E07\u0E2D\u0E2D\u0E01 CSV",
    table_device_id: "ID \u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C",
    table_user: "\u0E1C\u0E39\u0E49\u0E43\u0E0A\u0E49",
    table_model: "\u0E23\u0E38\u0E48\u0E19",
    table_os: "OS",
    table_last_ip: "IP \u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14",
    table_isp: "ISP",
    table_country: "\u0E1B\u0E23\u0E30\u0E40\u0E17\u0E28",
    table_last_seen:
      "\u0E40\u0E2B\u0E47\u0E19\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14",
    confirm_reset_pin_lockout: "รีเซ็ตการล็อก PIN สำหรับผู้ใช้นี้?",
    confirm_unsuspend_user:
      "ยกเลิกการระงับผู้ใช้นี้? บัญชีจะกู้คืนอย่างสมบูรณ์",
    confirm_reset_gcs: "รีเซ็ต GCS ของผู้ใช้นี้เป็น 100 และล้างคำเตือนทั้งหมด?",
    confirm_schedule_deletion: "คุณแน่ใจว่าต้องการกำหนดการลบบัญชีนี้?",
    alert_deletion_scheduled: "กำหนดการลบบัญชีแล้ว",
    confirm_cancel_deletion: "ยกเลิกการลบบัญชีที่กำหนดไว้?",
    confirm_remove_all_device_bindings:
      "ลบการเชื่อมโยงอุปกรณ์ทั้งหมดสำหรับผู้ใช้นี้?",
    confirm_remove_device_ban: "ลบการแบนอุปกรณ์นี้?",
    confirm_remove_network_ban: "ลบการแบนเครือข่ายนี้?",
    confirm_unban_device: "ปลดแบนอุปกรณ์นี้?",
    confirm_ban_all_devices: "แบนอุปกรณ์ทั้งหมดของผู้ใช้นี้?",
    confirm_remove_all_bans: "ลบการแบนทั้งหมดสำหรับผู้ใช้นี้?",
    confirm_unsuspend_identity_graph: "ยกเลิกการระงับกราฟตัวตนสำหรับผู้ใช้นี้?",
    alert_deletion_cancelled: "ยกเลิกการลบบัญชีแล้ว",
    confirm_clear_temp_id: "ล้าง ID ชั่วคราว?",
    confirm_revoke_warning: "เพิกถอนคำเตือนนี้? จะคืน +{deduction} GCS",
    confirm_revoke_biometric: "เพิกถอนคีย์ไบโอเมตริกสำหรับอุปกรณ์ {deviceId}?",
    confirm_issue_warning:
      'ออกคำเตือนสำหรับ "{reason}" (ความรุนแรง {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: "กำหนดการลบล้มเหลว: {error}",
    alert_cancel_deletion_failed: "ยกเลิกการลบล้มเหลว: {error}",
    confirm_ban_ip: "แบน IP {ip}?",
    confirm_suspend_identity_graph:
      "ระงับกราฟตัวตนสำหรับผู้ใช้นี้ ({duration}, {scope})?",
    btn_searching: "กำลังค้นหา...",
    btn_email_show: "แสดง",
    btn_email_hide: "ซ่อน",
    btn_email_saving: "กำลังบันทึก…",
    btn_undo: "เลิกทำ",
    msg_no_warnings: "ไม่มีคำเตือน",
    btn_revoke: "เพิกถอน",
    toast_display_name_empty: "ชื่อที่แสดงต้องไม่ว่าง",
    toast_undo_successful: "เลิกทำสำเร็จ",
    toast_already_in_list: "อยู่ในรายการแล้ว",
    toast_autosave_failed: "การบันทึกอัตโนมัติล้มเหลว: {error}",
    toast_undo_failed: "การเลิกทำล้มเหลว: {error}",
    status_suspended_badge:
      "ระงับตั้งแต่ {since}, จนถึง {until}. เหตุผล: {reason}",
    status_not_suspended: "ไม่ถูกระงับ",
    status_deletion_scheduled: "กำหนดการลบ — เหลืออีก {days} วัน ({date})",
    status_severity_gcs: "ความรุนแรง {severity} (-{deduction} GCS)",
    msg_permanent: "ถาวร",
    msg_no_reason_provided: "ไม่ได้ระบุเหตุผล",
    msg_suspended_since_until_format: "ระงับตั้งแต่ {since}, จนถึง {until}",
    inline_revoked: "เพิกถอนแล้ว",
    inline_warning_note: "หมายเหตุ: {note}",
    inline_warning_meta: "โดย: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}",
    toast_warning_revoked_gcs: "เพิกถอนคำเตือนแล้ว คืน +{deduction} GCS",
    toast_pin_lockout_reset: "รีเซ็ตการล็อก PIN แล้ว",
    toast_biometric_revoked: "เพิกถอนคีย์ไบโอเมตริกแล้ว",
    toast_gcs_reset_100: "รีเซ็ต GCS เป็น 100",
    toast_action_failed: "ล้มเหลว: {error}",
    btn_issuing: "กำลังออก...",
    btn_issue_warning: "ออกคำเตือน",
    btn_resetting: "กำลังรีเซ็ต...",
    toast_reason_required: "ต้องระบุเหตุผล",
    toast_select_reason: "เลือกเหตุผล",
    toast_no_user_loaded: "ยังไม่ได้โหลดผู้ใช้",
    toast_device_bindings_removed: "ลบการผูกอุปกรณ์แล้ว {count} รายการ",
    btn_reset_device_binding: "รีเซ็ตการผูกอุปกรณ์",
    toast_auto_escalate_5_warnings: "ผู้ใช้นี้มีคำเตือน 5+ ครั้ง พิจารณาระงับ",
    toast_no_ip_found: "ไม่พบที่อยู่ IP",
    toast_banned_n_devices: "แบนอุปกรณ์ {count} เครื่อง",
    toast_removed_n_bans: "ลบการแบน {count} รายการ",
    toast_partial_retry: "บางส่วน: {summary} โปรดลองขั้นตอนที่ล้มเหลวอีกครั้ง",
    toast_user_suspended: "ระงับผู้ใช้แล้ว",
    toast_user_unsuspended: "ยกเลิกการระงับผู้ใช้แล้ว",
    toast_warning_issued_successfully: "ออกคำเตือนสำเร็จ",
    toast_ip_banned: "แบน IP แล้ว",
    toast_identity_graph_suspended: "ระงับกราฟตัวตนแล้ว",
    toast_identity_graph_unsuspended: "ยกเลิกการระงับกราฟตัวตนแล้ว",
    prompt_deletion_reason: "ระบุเหตุผลการลบบัญชี (ไม่บังคับ):",
    prompt_ban_reason: "เหตุผล (ไม่บังคับ):",
    bio_device_label: "อุปกรณ์:",
    bio_registered_label: "ลงทะเบียนแล้ว:",
    segment_ban_call_failed:
      "{count}/{total} การเรียกใช้แบนล้มเหลว (แรก: {error})",
    segment_pm_failed: "{count}/{total} PM ล้มเหลว",
    toast_no_devices_to_ban: "ไม่มีอุปกรณ์ที่จะแบน",
    toast_enter_positive_amount: "ป้อนจำนวนที่เป็นบวก",
    toast_coins_added: "เพิ่ม {amount} เหรียญ (ตอนนี้ {balance})",
    toast_coins_deducted: "หัก {amount} เหรียญ (ตอนนี้ {balance})",
    toast_beans_added: "เพิ่ม {amount} bean (ตอนนี้ {balance})",
    toast_beans_deducted: "หัก {amount} bean (ตอนนี้ {balance})",
    toast_select_gift_qty: "เลือกของขวัญและระบุจำนวน",
    toast_gift_added: "เพิ่ม {qty} (รวม {total})",
    toast_backpack_empty_already: "เป้สะพายว่างอยู่แล้ว",
    msg_loading_backpack: "กำลังโหลดเป้สะพาย...",
    msg_backpack_empty: "เป้สะพายว่างเปล่า",
    msg_no_matching_gifts: "ไม่มีของขวัญที่ตรงกัน",
    btn_confirm_clear_all: "ยืนยันการล้างทั้งหมด",
    btn_confirming: "ยืนยัน ({countdown})",
    btn_clearing: "กำลังล้าง...",
    toast_backpack_cleared: "ล้างเป้สะพายแล้ว (ลบ {count} รายการ)",
    toast_cleared_with_errors: "ล้าง {cleared}, ล้มเหลว {errors}",
    toast_failed_to_save: "บันทึกล้มเหลว: {error}",
    // google-translated 2026-06-02
    tab_suggestions: "ข้อเสนอแนะ",
    // google-translated 2026-06-02
    tab_audit_log: "บันทึกการตรวจสอบ",
    // google-translated 2026-06-02
    tab_age_segregation: "การแบ่งแยกอายุ",
    // google-translated 2026-06-02
    age_seg_title: "การแบ่งแยกอายุ",
    // google-translated 2026-06-02
    age_seg_subtitle:
      "การกระจายตามรุ่นและการควบคุมแทนที่สำหรับการปฏิบัติตามข้อกำหนด OSA ของสหราชอาณาจักร",
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
    age_seg_override_note:
      "แทนที่การข้ามกลุ่มประชากรตามรุ่นที่ได้มาจาก DOB อนุญาตเฉพาะกับบัญชีพนักงานหรือผู้ดูแลระบบเท่านั้น การเปลี่ยนแปลงทุกอย่างจะถูกบันทึกการตรวจสอบพร้อมเหตุผลที่ให้ไว้",
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
    age_seg_confirm_body:
      "การเปลี่ยนแปลงนี้ได้รับการบันทึกการตรวจสอบและอาจบังคับให้รีเฟรชโทเค็นกับผู้ใช้เป้าหมาย ตรวจสอบรายละเอียดก่อนยืนยัน",
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
    age_verif_panel_subtitle:
      "ตรวจสอบบัตรประจำตัวรัฐบาลที่ผู้ใช้ส่งมาและตัดสินใจ อนุมัติยืนยันว่าผู้ใช้มีอายุ 18 ปีขึ้นไป Reject ทำให้พวกเขาอายุต่ำกว่า 18 ปีและแจ้งให้พวกเขาทราบ หาก ID แสดง DOB อื่น ให้ใช้ Modify-DOB เพื่อแก้ไขเรกคอร์ด",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user:
      "ไม่มีการส่งการยืนยันที่รอดำเนินการสำหรับผู้ใช้รายนี้",
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
    age_verif_approve_help:
      "อนุมัติ: ยืนยันว่าผู้ใช้ได้รับการยืนยันว่ามีอายุ 18 ปีขึ้นไป ปฏิเสธ: คงอายุต่ำกว่า 18 ปี และส่ง PM ระบบพร้อมเหตุผล",
    // google-translated 2026-06-02
    age_verif_approve_button: "อนุมัติ (ทำเครื่องหมายยืนยันแล้ว)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "ปฏิเสธแทน...",
    // google-translated 2026-06-02
    age_verif_reject_button: "ปฏิเสธการส่ง",
    // google-translated 2026-06-02
    age_verif_modify_help:
      "อัปเดตวันเกิดของผู้ใช้ให้ตรงกับค่าที่แสดงบนรหัส ผู้ใช้จะถูกปลดล็อคหรือล็อคไว้โดยอัตโนมัติตามยุคใหม่",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "วันเกิดใน ID:",
    // google-translated 2026-06-02
    age_verif_modify_button: "อัปเดต DOB และตัดสินใจ",
    // google-translated 2026-06-03
    toast_user_already_unsuspended: "ผู้ใช้ยกเลิกการระงับแล้ว",
  },
  vi: {
    tab_users: "Người dùng",
    tab_appeals: "Khiếu nại",
    tab_support: "Hỗ trợ",
    tab_reports: "Báo cáo",
    tab_gifts: "Quà tặng",
    tab_economy: "Kinh tế",
    tab_maintenance: "Bảo trì",
    tab_monitor: "Giám sát quay",
    tab_banners: "Banner",
    tab_backups: "Sao lưu",
    tab_logs: "Nhật ký",
    tab_devices: "Thiết bị",
    tab_starting_screens: "Màn hình khởi động",
    btn_sign_in: "Đăng nhập",
    btn_sign_out: "Đăng xuất",
    btn_search: "Tìm kiếm",
    placeholder_search_uid: "Nhập ID người dùng",
    subtab_profile: "Hồ sơ",
    subtab_moderation: "Kiểm duyệt",
    subtab_security: "Bảo mật",
    subtab_economy: "Kinh tế",
    label_uid: "UID",
    label_display_name: "Tên hiển thị",
    label_user_type: "Loại",
    label_nationality: "Quốc tịch",
    label_description: "Mô tả",
    label_email: "Email",
    label_date_of_birth: "Ngày sinh",
    label_unique_id: "ID duy nhất",
    btn_suspend_user: "Đình chỉ",
    btn_unsuspend_user: "Khôi phục",
    btn_warn: "Cảnh báo",
    btn_reset_device: "Đặt lại thiết bị",
    btn_reset_gcs: "Đặt lại GCS",
    label_shy_coins: "Shy Coins",
    label_shy_beans: "Shy Beans",
    label_super_shy: "Super Shy",
    label_login_streak: "Chuỗi đăng nhập",
    status_banned: "CẤM",
    status_active: "Hoạt động",
    status_suspended: "Đình chỉ",
    status_pending: "Đang chờ",
    filter_pending: "Đang chờ",
    filter_approved: "Đã duyệt",
    filter_denied: "Từ chối",
    filter_resolved: "Đã giải quyết",
    filter_archived: "Lưu trữ",
    btn_approve: "Duyệt",
    btn_deny: "Từ chối",
    btn_resolve: "Giải quyết",
    btn_save: "Lưu",
    btn_cancel: "Hủy",
    btn_delete: "Xóa",
    btn_apply: "Áp dụng",
    btn_refresh: "Làm mới",
    btn_load_more: "Tải thêm",
    msg_loading: "Đang tải...",
    msg_no_data: "Không tìm thấy dữ liệu",
    msg_saved: "Đã lưu",
    msg_error: "Lỗi",
    label_log_level: "Mức",
    label_log_source: "Nguồn",
    btn_export_json: "Xuất JSON",
    btn_export_csv: "Xuất CSV",
    table_device_id: "ID Thiết bị",
    table_user: "Người dùng",
    table_model: "Model",
    table_os: "HĐH",
    table_last_ip: "IP cuối",
    table_isp: "ISP",
    table_country: "Quốc gia",
    table_last_seen: "Lần cuối",
    confirm_reset_pin_lockout: "Đặt lại khoá PIN cho người dùng này?",
    confirm_unsuspend_user:
      "Bỏ đình chỉ người dùng này? Tài khoản sẽ được khôi phục hoàn toàn.",
    confirm_reset_gcs:
      "Đặt lại GCS của người dùng này về 100 và xoá tất cả cảnh báo?",
    confirm_schedule_deletion: "Bạn có chắc muốn lên lịch xoá tài khoản này?",
    alert_deletion_scheduled: "Đã lên lịch xoá tài khoản.",
    confirm_cancel_deletion: "Huỷ lịch xoá tài khoản?",
    confirm_remove_all_device_bindings:
      "Xoá tất cả ràng buộc thiết bị cho người dùng này?",
    confirm_remove_device_ban: "Xoá lệnh cấm thiết bị này?",
    confirm_remove_network_ban: "Xoá lệnh cấm mạng này?",
    confirm_unban_device: "Bỏ cấm thiết bị này?",
    confirm_ban_all_devices: "Cấm tất cả thiết bị của người dùng này?",
    confirm_remove_all_bans: "Xoá tất cả lệnh cấm cho người dùng này?",
    confirm_unsuspend_identity_graph:
      "Bỏ đình chỉ đồ thị danh tính cho người dùng này?",
    alert_deletion_cancelled: "Đã huỷ xoá tài khoản.",
    confirm_clear_temp_id: "Xoá ID tạm thời?",
    confirm_revoke_warning:
      "Thu hồi cảnh báo này? +{deduction} GCS sẽ được khôi phục.",
    confirm_revoke_biometric: "Thu hồi khoá sinh trắc cho thiết bị {deviceId}?",
    confirm_issue_warning:
      'Phát hành cảnh báo cho "{reason}" (mức độ {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: "Không thể lên lịch xoá: {error}",
    alert_cancel_deletion_failed: "Không thể huỷ xoá: {error}",
    confirm_ban_ip: "Cấm IP {ip}?",
    confirm_suspend_identity_graph:
      "Đình chỉ đồ thị danh tính cho người dùng này ({duration}, {scope})?",
    btn_searching: "Đang tìm kiếm...",
    btn_email_show: "Hiện",
    btn_email_hide: "Ẩn",
    btn_email_saving: "Đang lưu…",
    btn_undo: "Hoàn tác",
    msg_no_warnings: "Không có cảnh báo",
    btn_revoke: "Thu hồi",
    toast_display_name_empty: "Tên hiển thị không được để trống",
    toast_undo_successful: "Hoàn tác thành công",
    toast_already_in_list: "Đã có trong danh sách",
    toast_autosave_failed: "Tự động lưu thất bại: {error}",
    toast_undo_failed: "Hoàn tác thất bại: {error}",
    status_suspended_badge: "Đình chỉ từ {since} đến {until}. Lý do: {reason}",
    status_not_suspended: "Không bị đình chỉ",
    status_deletion_scheduled: "Đã lên lịch xoá — còn {days} ngày ({date})",
    status_severity_gcs: "Mức độ {severity} (-{deduction} GCS)",
    msg_permanent: "vĩnh viễn",
    msg_no_reason_provided: "Không có lý do",
    msg_suspended_since_until_format: "Đình chỉ từ {since} đến {until}",
    inline_revoked: "Đã thu hồi",
    inline_warning_note: "Ghi chú: {note}",
    inline_warning_meta: "Bởi: {issuedBy} | GCS: {gcsBefore} → {gcsAfter}",
    toast_warning_revoked_gcs:
      "Đã thu hồi cảnh báo, đã khôi phục +{deduction} GCS",
    toast_pin_lockout_reset: "Đã đặt lại khóa PIN",
    toast_biometric_revoked: "Đã thu hồi khóa sinh trắc",
    toast_gcs_reset_100: "Đã đặt lại GCS về 100",
    toast_action_failed: "Thất bại: {error}",
    btn_issuing: "Đang phát hành...",
    btn_issue_warning: "Phát hành cảnh báo",
    btn_resetting: "Đang đặt lại...",
    toast_reason_required: "Cần lý do",
    toast_select_reason: "Chọn một lý do",
    toast_no_user_loaded: "Chưa tải người dùng",
    toast_device_bindings_removed: "Đã xóa {count} liên kết thiết bị",
    btn_reset_device_binding: "Đặt lại liên kết thiết bị",
    toast_auto_escalate_5_warnings:
      "Người dùng này có hơn 5 cảnh báo. Hãy cân nhắc tạm khóa.",
    toast_no_ip_found: "Không tìm thấy địa chỉ IP",
    toast_banned_n_devices: "Đã chặn {count} thiết bị",
    toast_removed_n_bans: "Đã xóa {count} lệnh cấm",
    toast_partial_retry: "Một phần: {summary}. Vui lòng thử lại bước thất bại.",
    toast_user_suspended: "Đã tạm khóa người dùng",
    toast_user_unsuspended: "Đã bỏ tạm khóa người dùng",
    toast_warning_issued_successfully: "Đã phát hành cảnh báo",
    toast_ip_banned: "Đã chặn IP",
    toast_identity_graph_suspended: "Đã tạm khóa đồ thị danh tính",
    toast_identity_graph_unsuspended: "Đã bỏ tạm khóa đồ thị danh tính",
    prompt_deletion_reason: "Nhập lý do xóa tài khoản (tùy chọn):",
    prompt_ban_reason: "Lý do (tùy chọn):",
    bio_device_label: "Thiết bị:",
    bio_registered_label: "Đã đăng ký:",
    segment_ban_call_failed:
      "{count}/{total} lệnh cấm thất bại (đầu tiên: {error})",
    segment_pm_failed: "{count}/{total} PM thất bại",
    toast_no_devices_to_ban: "Không có thiết bị để chặn",
    toast_enter_positive_amount: "Nhập số dương",
    toast_coins_added: "Đã thêm {amount} xu (hiện tại {balance})",
    toast_coins_deducted: "Đã trừ {amount} xu (hiện tại {balance})",
    toast_beans_added: "Đã thêm {amount} bean (hiện tại {balance})",
    toast_beans_deducted: "Đã trừ {amount} bean (hiện tại {balance})",
    toast_select_gift_qty: "Chọn quà và nhập số lượng",
    toast_gift_added: "Đã thêm {qty} (tổng hiện tại {total})",
    toast_backpack_empty_already: "Ba lô đã trống",
    msg_loading_backpack: "Đang tải ba lô...",
    msg_backpack_empty: "Ba lô trống",
    msg_no_matching_gifts: "Không có quà phù hợp",
    btn_confirm_clear_all: "Xác nhận xóa tất cả",
    btn_confirming: "Xác nhận ({countdown})",
    btn_clearing: "Đang xóa...",
    toast_backpack_cleared: "Đã xóa ba lô ({count} mục đã bị xóa)",
    toast_cleared_with_errors: "Đã xóa {cleared}, thất bại {errors}",
    toast_failed_to_save: "Lưu thất bại: {error}",
    // google-translated 2026-06-02
    tab_suggestions: "Đề xuất",
    // google-translated 2026-06-02
    tab_audit_log: "Nhật ký kiểm tra",
    // google-translated 2026-06-02
    tab_age_segregation: "Phân chia độ tuổi",
    // google-translated 2026-06-02
    age_seg_title: "Phân chia độ tuổi",
    // google-translated 2026-06-02
    age_seg_subtitle:
      "Kiểm soát phân phối và ghi đè theo nhóm để tuân thủ OSA của Vương quốc Anh.",
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
    age_seg_override_note:
      "Ghi đè bỏ qua nhóm thuần tập có nguồn gốc từ DOB. Chỉ được phép trên tài khoản nhân viên hoặc quản trị viên. Mọi thay đổi đều được ghi lại kiểm tra kèm theo lý do được cung cấp.",
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
    age_seg_confirm_body:
      "Thay đổi này được ghi lại kiểm tra và có thể buộc người dùng mục tiêu phải làm mới mã thông báo. Xem lại chi tiết trước khi xác nhận.",
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
    age_verif_panel_subtitle:
      "Xem lại ID chính phủ đã gửi của người dùng và quyết định. Phê duyệt xác nhận người dùng là 18+. Từ chối giữ họ dưới 18 tuổi và thông báo cho họ. Nếu ID hiển thị DOB khác, hãy sử dụng Modify-DOB để sửa bản ghi.",
    // google-translated 2026-06-02
    age_verif_no_pending_for_user:
      "Không có gửi xác minh đang chờ xử lý cho người dùng này.",
    // google-translated 2026-06-02
    age_verif_other_pending_label:
      "Các bài nộp đang chờ xử lý khác trên toàn hệ thống:",
    // google-translated 2026-06-02
    age_verif_jump_next: "Chuyển tới phần tiếp theo đang chờ xử lý",
    // google-translated 2026-06-02
    age_verif_image_disclaimer:
      "Hình ảnh bị phá hủy khi quyết định được ghi lại.",
    // google-translated 2026-06-02
    age_verif_field_method: "Phương thức nhận dạng:",
    // google-translated 2026-06-02
    age_verif_field_recorded_dob: "DOB đã ghi:",
    // google-translated 2026-06-02
    age_verif_field_submitted_at: "Đã gửi tại:",
    // google-translated 2026-06-02
    age_verif_field_submission_id: "ID gửi:",
    // google-translated 2026-06-02
    age_verif_match_question:
      "ID có xác nhận ngày sinh được ghi lại của người dùng không?",
    // google-translated 2026-06-02
    age_verif_match_yes: "Có - DOB trên ID khớp với giá trị được ghi",
    // google-translated 2026-06-02
    age_verif_match_no: "Không - ID hiển thị DOB khác",
    // google-translated 2026-06-02
    age_verif_approve_help:
      "Phê duyệt: xác nhận người dùng đã được xác minh trên 18 tuổi. Từ chối: giữ họ dưới 18 tuổi và gửi PM hệ thống kèm theo lý do.",
    // google-translated 2026-06-02
    age_verif_approve_button: "Phê duyệt (đánh dấu đã xác minh)",
    // google-translated 2026-06-02
    age_verif_reject_summary: "Thay vào đó hãy từ chối…",
    // google-translated 2026-06-02
    age_verif_reject_button: "Từ chối gửi",
    // google-translated 2026-06-02
    age_verif_modify_help:
      "Cập nhật DOB của người dùng để khớp với giá trị hiển thị trên ID. Người dùng được mở khóa hoặc giữ khóa tự động theo độ tuổi mới.",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "Ngày sinh trên giấy tờ tùy thân:",
    // google-translated 2026-06-02
    age_verif_modify_button: "Cập nhật DOB và quyết định",
    // google-translated 2026-06-03
    toast_user_already_unsuspended: "Người dùng đã được hủy tạm ngưng",
  },
  zh: {
    tab_users: "\u7528\u6237",
    tab_appeals: "\u7533\u8BC9",
    tab_support: "\u652F\u6301",
    tab_reports: "\u4E3E\u62A5",
    tab_gifts: "\u793C\u7269",
    tab_economy: "\u7ECF\u6D4E",
    tab_maintenance: "\u7EF4\u62A4",
    tab_monitor: "\u8F6C\u76D8\u76D1\u63A7",
    tab_banners: "\u6A2A\u5E45",
    tab_backups: "\u5907\u4EFD",
    tab_logs: "\u65E5\u5FD7",
    tab_devices: "\u8BBE\u5907",
    tab_starting_screens: "\u542F\u52A8\u5C4F\u5E55",
    btn_sign_in: "\u767B\u5F55",
    btn_sign_out: "\u9000\u51FA",
    btn_search: "\u641C\u7D22",
    placeholder_search_uid: "\u8F93\u5165\u7528\u6237ID",
    subtab_profile: "\u4E2A\u4EBA\u8D44\u6599",
    subtab_moderation: "\u7BA1\u7406",
    subtab_security: "\u5B89\u5168",
    subtab_economy: "\u7ECF\u6D4E",
    label_uid: "UID",
    label_display_name: "\u663E\u793A\u540D",
    label_user_type: "\u7C7B\u578B",
    label_nationality: "\u56FD\u7C4D",
    label_description: "\u63CF\u8FF0",
    label_email: "\u90AE\u7BB1",
    label_date_of_birth: "\u51FA\u751F\u65E5\u671F",
    label_unique_id: "\u552F\u4E00ID",
    btn_suspend_user: "\u6682\u505C",
    btn_unsuspend_user: "\u6062\u590D",
    btn_warn: "\u8B66\u544A",
    btn_reset_device: "\u91CD\u7F6E\u8BBE\u5907",
    btn_reset_gcs: "\u91CD\u7F6EGCS",
    label_shy_coins: "Shy\u5E01",
    label_shy_beans: "Shy\u8C46",
    label_super_shy: "\u8D85\u7EA7Shy",
    label_login_streak: "\u767B\u5F55\u8FDE\u7EED",
    status_banned: "\u5C01\u7981",
    status_active: "\u6D3B\u8DC3",
    status_suspended: "\u6682\u505C",
    status_pending: "\u5F85\u5904\u7406",
    filter_pending: "\u5F85\u5904\u7406",
    filter_approved: "\u5DF2\u6279\u51C6",
    filter_denied: "\u5DF2\u62D2\u7EDD",
    filter_resolved: "\u5DF2\u89E3\u51B3",
    filter_archived: "\u5DF2\u5F52\u6863",
    btn_approve: "\u6279\u51C6",
    btn_deny: "\u62D2\u7EDD",
    btn_resolve: "\u89E3\u51B3",
    btn_save: "\u4FDD\u5B58",
    btn_cancel: "\u53D6\u6D88",
    btn_delete: "\u5220\u9664",
    btn_apply: "\u5E94\u7528",
    btn_refresh: "\u5237\u65B0",
    btn_load_more: "\u52A0\u8F7D\u66F4\u591A",
    msg_loading: "\u52A0\u8F7D\u4E2D...",
    msg_no_data: "\u672A\u627E\u5230\u6570\u636E",
    msg_saved: "\u5DF2\u4FDD\u5B58",
    msg_error: "\u9519\u8BEF",
    label_log_level: "\u7EA7\u522B",
    label_log_source: "\u6765\u6E90",
    btn_export_json: "\u5BFC\u51FAJSON",
    btn_export_csv: "\u5BFC\u51FACSV",
    table_device_id: "\u8BBE\u5907ID",
    table_user: "\u7528\u6237",
    table_model: "\u578B\u53F7",
    table_os: "\u7CFB\u7EDF",
    table_last_ip: "\u6700\u540EIP",
    table_isp: "\u8FD0\u8425\u5546",
    table_country: "\u56FD\u5BB6",
    table_last_seen: "\u6700\u540E\u767B\u5F55",
    confirm_reset_pin_lockout: "重置此用户的 PIN 锁定?",
    confirm_unsuspend_user: "解除此用户的封禁? 账户将完全恢复。",
    confirm_reset_gcs: "将此用户的 GCS 重置为 100 并清除所有警告?",
    confirm_schedule_deletion: "您确定要安排删除此账户吗?",
    alert_deletion_scheduled: "已安排账户删除。",
    confirm_cancel_deletion: "取消已安排的账户删除?",
    confirm_remove_all_device_bindings: "移除此用户的所有设备绑定?",
    confirm_remove_device_ban: "移除此设备封禁?",
    confirm_remove_network_ban: "移除此网络封禁?",
    confirm_unban_device: "解封此设备?",
    confirm_ban_all_devices: "封禁此用户的所有设备?",
    confirm_remove_all_bans: "移除此用户的所有封禁?",
    confirm_unsuspend_identity_graph: "解除此用户的身份图谱封禁?",
    alert_deletion_cancelled: "账户删除已取消。",
    confirm_clear_temp_id: "清除临时 ID?",
    confirm_revoke_warning: "撤销此警告? 将恢复 +{deduction} GCS。",
    confirm_revoke_biometric: "撤销设备 {deviceId} 的生物识别密钥?",
    confirm_issue_warning:
      '为 "{reason}" 发出警告 (严重程度 {severity}, -{deduction} GCS)?',
    alert_schedule_deletion_failed: "无法安排删除: {error}",
    alert_cancel_deletion_failed: "无法取消删除: {error}",
    confirm_ban_ip: "封禁 IP {ip}?",
    confirm_suspend_identity_graph:
      "暂停此用户的身份图谱 ({duration}, {scope})?",
    btn_searching: "搜索中...",
    btn_email_show: "显示",
    btn_email_hide: "隐藏",
    btn_email_saving: "保存中…",
    btn_undo: "撤销",
    msg_no_warnings: "没有警告",
    btn_revoke: "撤销",
    toast_display_name_empty: "显示名称不能为空",
    toast_undo_successful: "撤销成功",
    toast_already_in_list: "已在列表中",
    toast_autosave_failed: "自动保存失败: {error}",
    toast_undo_failed: "撤销失败: {error}",
    status_suspended_badge: "自 {since} 起暂停, 直到 {until}. 原因: {reason}",
    status_not_suspended: "未暂停",
    status_deletion_scheduled: "已安排删除 — 剩余 {days} 天 ({date})",
    status_severity_gcs: "严重程度 {severity} (-{deduction} GCS)",
    msg_permanent: "永久",
    msg_no_reason_provided: "未提供原因",
    msg_suspended_since_until_format: "自 {since} 起暂停, 直到 {until}",
    inline_revoked: "已撤销",
    inline_warning_note: "备注：{note}",
    inline_warning_meta: "由：{issuedBy} | GCS：{gcsBefore} → {gcsAfter}",
    toast_warning_revoked_gcs: "警告已撤销，已恢复 +{deduction} GCS",
    toast_pin_lockout_reset: "PIN 锁定已重置",
    toast_biometric_revoked: "已撤销生物识别密钥",
    toast_gcs_reset_100: "GCS 已重置为 100",
    toast_action_failed: "失败：{error}",
    btn_issuing: "正在签发...",
    btn_issue_warning: "签发警告",
    btn_resetting: "正在重置...",
    toast_reason_required: "必须填写原因",
    toast_select_reason: "选择一个原因",
    toast_no_user_loaded: "未加载任何用户",
    toast_device_bindings_removed: "已移除 {count} 个设备绑定",
    btn_reset_device_binding: "重置设备绑定",
    toast_auto_escalate_5_warnings: "该用户有 5+ 条警告。考虑暂停。",
    toast_no_ip_found: "未找到 IP 地址",
    toast_banned_n_devices: "已封禁 {count} 台设备",
    toast_removed_n_bans: "已移除 {count} 个封禁",
    toast_partial_retry: "部分完成：{summary}。请重试失败的步骤。",
    toast_user_suspended: "用户已暂停",
    toast_user_unsuspended: "已解除用户暂停",
    toast_warning_issued_successfully: "已成功签发警告",
    toast_ip_banned: "IP 已封禁",
    toast_identity_graph_suspended: "已暂停身份图",
    toast_identity_graph_unsuspended: "已解除身份图暂停",
    prompt_deletion_reason: "输入账户删除原因（可选）：",
    prompt_ban_reason: "原因（可选）：",
    bio_device_label: "设备：",
    bio_registered_label: "已注册：",
    segment_ban_call_failed: "{count}/{total} 个封禁调用失败（首个：{error}）",
    segment_pm_failed: "{count}/{total} 个私信失败",
    toast_no_devices_to_ban: "没有要封禁的设备",
    toast_enter_positive_amount: "请输入正数",
    toast_coins_added: "已添加 {amount} 金币（当前 {balance}）",
    toast_coins_deducted: "已扣除 {amount} 金币（当前 {balance}）",
    toast_beans_added: "已添加 {amount} 豆（当前 {balance}）",
    toast_beans_deducted: "已扣除 {amount} 豆（当前 {balance}）",
    toast_select_gift_qty: "选择礼物并输入数量",
    toast_gift_added: "已添加 {qty}（现在共 {total}）",
    toast_backpack_empty_already: "背包已为空",
    msg_loading_backpack: "正在加载背包...",
    msg_backpack_empty: "背包为空",
    msg_no_matching_gifts: "没有匹配的礼物",
    btn_confirm_clear_all: "确认全部清空",
    btn_confirming: "确认 ({countdown})",
    btn_clearing: "正在清空...",
    toast_backpack_cleared: "背包已清空（已移除 {count} 个项目）",
    toast_cleared_with_errors: "已清空 {cleared}，失败 {errors}",
    toast_failed_to_save: "保存失败：{error}",
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
    age_seg_override_note:
      "覆盖绕过 DOB 派生的群组。仅允许在员工或管理员帐户上使用。每项更改都经过审核并附有提供的原因。",
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
    age_seg_confirm_body:
      "此更改会进行审核记录，并可能会强制目标用户刷新令牌。确认前请检查详细信息。",
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
    age_verif_panel_subtitle:
      "审核用户提交的政府 ID 并做出决定。批准确认用户已年满 18 岁。拒绝让他们低于 18 岁并通知他们。如果 ID 显示不同的 DOB，请使用修改 DOB 更正记录。",
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
    age_verif_approve_help:
      "批准：确认用户已年满 18 岁。拒绝：保留 sub-18 并发送系统 PM 并说明原因。",
    // google-translated 2026-06-02
    age_verif_approve_button: "批准（标记已验证）",
    // google-translated 2026-06-02
    age_verif_reject_summary: "而是拒绝...",
    // google-translated 2026-06-02
    age_verif_reject_button: "拒绝提交",
    // google-translated 2026-06-02
    age_verif_modify_help:
      "更新用户的出生日期以匹配 ID 上显示的值。根据新年龄自动解锁或保持锁定用户。",
    // google-translated 2026-06-02
    age_verif_new_dob_label: "身份证上的出生日期：",
    // google-translated 2026-06-02
    age_verif_modify_button: "更新 DOB 并决定",
    // google-translated 2026-06-03
    toast_user_already_unsuspended: "用户已被解除暂停",
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
  document.querySelectorAll("[data-i18n]").forEach(function (el) {
    var key = el.getAttribute("data-i18n");
    if (!t[key]) return;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
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
window.applyLanguage = function (lang) {
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
  var lang =
    window.ShyTalkLanguage && typeof window.ShyTalkLanguage.get === "function"
      ? window.ShyTalkLanguage.get()
      : (function () {
          try {
            return localStorage.getItem("shytalk_language") || "en";
          } catch (_e) {
            return "en";
          }
        })();
  var dict = ADMIN_TRANSLATIONS[lang] || ADMIN_TRANSLATIONS.en || {};
  if (dict[key] !== undefined) return dict[key];
  if (ADMIN_TRANSLATIONS.en && ADMIN_TRANSLATIONS.en[key] !== undefined)
    return ADMIN_TRANSLATIONS.en[key];
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
  return template.replace(/\{(\w+)\}/g, function (match, name) {
    return vars && vars[name] !== undefined && vars[name] !== null
      ? String(vars[name])
      : match;
  });
}
window.tAdminFmt = tAdminFmt;
