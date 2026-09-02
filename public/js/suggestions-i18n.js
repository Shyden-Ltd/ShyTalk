/**
 * Translations for the suggestions board UI.
 * Loaded before suggestions-board.js.
 * Access via window.SG_LABELS and window.sgT(key).
 */
(function () {
  "use strict";

  var SG_LABELS = {
    en: {
      statsDisclaimer: "Progress may go up or down as new features are added and existing ones are completed.",
      allStatuses: "All statuses", pending: "Pending", accepted: "Accepted", planned: "Planned", completed: "Completed", rejected: "Rejected",
      allTags: "All tags", allLanguages: "All languages", allPhases: "All phases",
      mostVoted: "Most Voted", newest: "Newest", suggest: "+ Suggest", search: "Search suggestions...",
      signInRequired: "Sign in required", signInTo: "Sign in with your ShyTalk account to", cancel: "Cancel",
      signInGoogle: "Sign in with Google", signInApple: "Sign in with Apple",
      noAccountHint: "Don't have an account? Download ShyTalk to create one.",
      subscribe: "Subscribe", save: "Save", loading: "Loading...", noSuggestions: "No suggestions yet.",
      postComment: "Post", commentPlaceholder: "Add a comment...", suggestFeature: "Suggest a feature",
      titlePlaceholder: "Brief title for your suggestion", descPlaceholder: "Describe the feature in detail...",
      submit: "Submit", gdprConsent: "I consent to receiving email notifications about roadmap updates (GDPR)",
      welcomePrompt: "Want to vote, suggest features, or subscribe to updates? Sign in with your ShyTalk account. Don\u2019t have one yet? Download the app to get started \u2014 or feel free to look around!",
      noAccountFound: "We couldn\u2019t find a ShyTalk account linked to that login. Create your free account in the app, then come back to get involved!",
      loggedInAs: "Logged in as:", signOut: "Sign out", signIn: "Sign In",
      gdprEmailConsent: "By enabling email notifications you consent to receive updates. You can unsubscribe at any time using the link in each email or by returning to this page.",
      infoReview: "All suggestions are reviewed before publishing. Duplicates may be merged.",
      googlePlay: "Google Play", appStore: "App Store",
      shipped: "Shipped!", tagVoice: "Voice", tagChat: "Chat", tagModeration: "Moderation", tagUi: "UI/UX",
      tagPrivacy: "Privacy", tagSocial: "Social", tagEconomy: "Economy", tagAccessibility: "Accessibility", tagOther: "Other",
      phaseCompliance: 'Compliance & Legal',
      phasePlatform: 'Platform Foundation',
      phaseRevenue: 'Revenue Engine',
      phaseSocial: 'Core Social',
      phaseQol: 'Quality of Life',
      phaseEntertainment: 'Entertainment',
      phaseSupport: 'Support & Specialised',
      close: 'Close',
      aria_upvote: 'Upvote',
      aria_downvote: 'Downvote',
      aria_watch: 'Watch this suggestion',
      duplicate_match: 'Yes, this is what I meant',
      duplicate_different: 'No, my idea is different',
      subscribe_event_new_suggestion: 'New suggestions posted',
      subscribe_event_status_change: 'Suggestion status changes',
      subscribe_event_comment_reply: 'Replies to your comments',
      subscribe_event_watched_update: 'Updates on watched suggestions',
      subscribe_channel_email: 'Email',
      subscribe_channel_push: 'Push',
      subscribe_channel_inapp: 'In-App',
      subscribe_channel_system: 'System Message',
      subscribe_event_header: 'Event',
      subscribe_btn_saving: 'Saving...',
      subscribe_toast_saved: 'Subscription preferences saved',
      subscribe_toast_save_failed: 'Failed to save',
      subscribe_unknown_error: 'Unknown error',
      toast_vote_failed: 'Vote failed',
      unknown_error: 'Unknown error',
      toast_redirecting_to_existing: 'Redirecting to existing suggestion',
      btn_submitting: 'Submitting...',
      toast_topic_not_allowed: 'This topic is not allowed',
      toast_submit_failed: 'Failed to submit',
      btn_posting: 'Posting...',
      toast_comment_posted: 'Comment posted',
      toast_post_comment_failed: 'Failed to post comment',
      toast_suggestion_submitted: 'Suggestion submitted! It will be reviewed before publishing.',
      standing_banned: "Your account is banned. You can read suggestions, but you cannot post, vote, or comment.",
      standing_suspended: "Your account is suspended. You can read suggestions, but you cannot post, vote, or comment.",
      standing_reason: "Reason:",
      commentFromDeletedUser: '[Comment from deleted user]',
    },
    id: { statsDisclaimer: "Progres dapat naik atau turun seiring penambahan fitur baru dan penyelesaian fitur yang ada.", allStatuses: "Semua status", pending: "Menunggu", accepted: "Diterima", planned: "Direncanakan", completed: "Selesai", rejected: "Ditolak", allTags: "Semua tag", allLanguages: "Semua bahasa", allPhases: "Semua fase", mostVoted: "Terbanyak divoting", newest: "Terbaru", suggest: "+ Saran", search: "Cari...", signInRequired: "Perlu masuk", cancel: "Batal", signInGoogle: "Masuk dengan Google", signInApple: "Masuk dengan Apple", subscribe: "Berlangganan", save: "Simpan", loading: "Memuat...", noSuggestions: "Belum ada saran.", submit: "Kirim", loggedInAs: "Masuk sebagai:", signOut: "Keluar", signIn: "Masuk", gdprEmailConsent: "Dengan mengaktifkan notifikasi email, Anda menyetujui untuk menerima pembaruan. Anda dapat berhenti berlangganan kapan saja melalui tautan di setiap email atau kembali ke halaman ini." , close: 'Tutup', aria_upvote: 'Beri suara naik', aria_downvote: 'Beri suara turun', aria_watch: 'Ikuti saran ini' , duplicate_match: 'Ya, itu yang saya maksud', duplicate_different: 'Tidak, ide saya berbeda' , tagVoice: 'Suara', tagChat: 'Obrolan', tagModeration: 'Moderasi', tagUi: 'UI/UX', tagPrivacy: 'Privasi', tagSocial: 'Sosial', tagEconomy: 'Ekonomi', tagAccessibility: 'Aksesibilitas', tagOther: 'Lainnya' , phaseCompliance: 'Kepatuhan & Legal', phasePlatform: 'Fondasi Platform', phaseRevenue: 'Mesin Pendapatan', phaseSocial: 'Sosial Inti', phaseQol: 'Kualitas Hidup', phaseEntertainment: 'Hiburan', phaseSupport: 'Dukungan & Khusus' , subscribe_event_new_suggestion: 'Saran baru dipublikasikan', subscribe_event_status_change: 'Perubahan status saran', subscribe_event_comment_reply: 'Balasan untuk komentar Anda', subscribe_event_watched_update: 'Pembaruan saran yang diikuti', subscribe_channel_email: 'Email', subscribe_channel_push: 'Push', subscribe_channel_inapp: 'Dalam aplikasi', subscribe_channel_system: 'Pesan sistem', subscribe_event_header: 'Peristiwa', subscribe_btn_saving: 'Menyimpan...', subscribe_toast_saved: 'Preferensi langganan disimpan', subscribe_toast_save_failed: 'Gagal menyimpan', subscribe_unknown_error: 'Kesalahan tidak diketahui' , toast_vote_failed: 'Voting gagal', unknown_error: 'Kesalahan tidak diketahui', toast_redirecting_to_existing: 'Mengalihkan ke saran yang ada', btn_submitting: 'Mengirim...', toast_topic_not_allowed: 'Topik ini tidak diizinkan', toast_submit_failed: 'Gagal mengirim', btn_posting: 'Memposting...', toast_comment_posted: 'Komentar diposting', toast_post_comment_failed: 'Gagal memposting komentar' , toast_suggestion_submitted: 'Saran terkirim! Akan ditinjau sebelum dipublikasikan.'  , standing_banned: 'Akun Anda diblokir. Anda dapat membaca saran, tetapi tidak dapat memposting, memilih, atau berkomentar.', standing_suspended: 'Akun Anda ditangguhkan. Anda dapat membaca saran, tetapi tidak dapat memposting, memilih, atau berkomentar.', standing_reason: 'Alasan:' },
    th: { statsDisclaimer: "ความคืบหน้าอาจเพิ่มขึ้นหรือลดลงเมื่อมีการเพิ่มและทำคุณสมบัติใหม่และที่มีอยู่เสร็จสิ้น", allStatuses: "\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14", pending: "\u0e23\u0e2d\u0e14\u0e33\u0e40\u0e19\u0e34\u0e19\u0e01\u0e32\u0e23", accepted: "\u0e22\u0e2d\u0e21\u0e23\u0e31\u0e1a", planned: "\u0e27\u0e32\u0e07\u0e41\u0e1c\u0e19", completed: "\u0e40\u0e2a\u0e23\u0e47\u0e08\u0e2a\u0e34\u0e49\u0e19", rejected: "\u0e1b\u0e0f\u0e34\u0e40\u0e2a\u0e18", allTags: "\u0e41\u0e17\u0e47\u0e01\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14", allLanguages: "\u0e20\u0e32\u0e29\u0e32\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14", allPhases: "\u0e40\u0e1f\u0e2a\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14", mostVoted: "\u0e42\u0e2b\u0e27\u0e15\u0e21\u0e32\u0e01\u0e17\u0e35\u0e48\u0e2a\u0e38\u0e14", newest: "\u0e25\u0e48\u0e32\u0e2a\u0e38\u0e14", suggest: "+ \u0e41\u0e19\u0e30\u0e19\u0e33", search: "\u0e04\u0e49\u0e19\u0e2b\u0e32...", signInRequired: "\u0e15\u0e49\u0e2d\u0e07\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e39\u0e48\u0e23\u0e30\u0e1a\u0e1a", cancel: "\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01", signInGoogle: "\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e39\u0e48\u0e23\u0e30\u0e1a\u0e1a\u0e14\u0e49\u0e27\u0e22 Google", signInApple: "\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e39\u0e48\u0e23\u0e30\u0e1a\u0e1a\u0e14\u0e49\u0e27\u0e22 Apple", subscribe: "\u0e2a\u0e21\u0e31\u0e04\u0e23\u0e2a\u0e21\u0e32\u0e0a\u0e34\u0e01", save: "\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01", loading: "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e42\u0e2b\u0e25\u0e14...", noSuggestions: "\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e02\u0e49\u0e2d\u0e40\u0e2a\u0e19\u0e2d\u0e41\u0e19\u0e30", submit: "\u0e2a\u0e48\u0e07", loggedInAs: "\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e39\u0e48\u0e23\u0e30\u0e1a\u0e1a\u0e41\u0e25\u0e49\u0e27:", signOut: "\u0e2d\u0e2d\u0e01\u0e08\u0e32\u0e01\u0e23\u0e30\u0e1a\u0e1a", signIn: "เข้าสู่ระบบ", gdprEmailConsent: "การเปิดใช้งานการแจ้งเตือนทางอีเมลถือว่าคุณยินยอมรับข้อมูลอัปเดต คุณสามารถยกเลิกการสมัครได้ตลอดเวลาผ่านลิงก์ในอีเมลแต่ละฉบับ หรือกลับมาที่หน้านี้" , close: 'ปิด', aria_upvote: 'โหวตเห็นด้วย', aria_downvote: 'โหวตไม่เห็นด้วย', aria_watch: 'ติดตามข้อเสนอแนะนี้' , duplicate_match: 'ใช่ นี่คือสิ่งที่ฉันหมายถึง', duplicate_different: 'ไม่ใช่ ความคิดของฉันแตกต่างกัน' , tagVoice: 'เสียง', tagChat: 'แชท', tagModeration: 'การจัดการ', tagUi: 'UI/UX', tagPrivacy: 'ความเป็นส่วนตัว', tagSocial: 'สังคม', tagEconomy: 'เศรษฐกิจ', tagAccessibility: 'การเข้าถึง', tagOther: 'อื่นๆ' , phaseCompliance: 'การปฏิบัติตามและกฎหมาย', phasePlatform: 'พื้นฐานแพลตฟอร์ม', phaseRevenue: 'เครื่องยนต์รายได้', phaseSocial: 'โซเชียลหลัก', phaseQol: 'คุณภาพชีวิต', phaseEntertainment: 'ความบันเทิง', phaseSupport: 'การสนับสนุน & พิเศษ' , subscribe_event_new_suggestion: 'มีข้อเสนอแนะใหม่เผยแพร่', subscribe_event_status_change: 'การเปลี่ยนแปลงสถานะข้อเสนอแนะ', subscribe_event_comment_reply: 'การตอบกลับความคิดเห็นของคุณ', subscribe_event_watched_update: 'อัปเดตเกี่ยวกับข้อเสนอแนะที่ติดตาม', subscribe_channel_email: 'อีเมล', subscribe_channel_push: 'พุช', subscribe_channel_inapp: 'ในแอป', subscribe_channel_system: 'ข้อความระบบ', subscribe_event_header: 'เหตุการณ์', subscribe_btn_saving: 'กำลังบันทึก...', subscribe_toast_saved: 'บันทึกการตั้งค่าการสมัครรับข้อมูลแล้ว', subscribe_toast_save_failed: 'บันทึกไม่สำเร็จ', subscribe_unknown_error: 'ข้อผิดพลาดที่ไม่รู้จัก' , toast_vote_failed: 'การโหวตล้มเหลว', unknown_error: 'ข้อผิดพลาดที่ไม่รู้จัก', toast_redirecting_to_existing: 'กำลังเปลี่ยนเส้นทางไปยังข้อเสนอแนะที่มีอยู่', btn_submitting: 'กำลังส่ง...', toast_topic_not_allowed: 'หัวข้อนี้ไม่ได้รับอนุญาต', toast_submit_failed: 'การส่งล้มเหลว', btn_posting: 'กำลังโพสต์...', toast_comment_posted: 'โพสต์ความคิดเห็นแล้ว', toast_post_comment_failed: 'การโพสต์ความคิดเห็นล้มเหลว' , toast_suggestion_submitted: 'ส่งข้อเสนอแนะแล้ว! จะถูกตรวจสอบก่อนเผยแพร่'  , standing_banned: 'บัญชีของคุณถูกแบน คุณสามารถอ่านข้อเสนอแนะได้ แต่ไม่สามารถโพสต์ โหวต หรือแสดงความคิดเห็นได้', standing_suspended: 'บัญชีของคุณถูกระงับ คุณสามารถอ่านข้อเสนอแนะได้ แต่ไม่สามารถโพสต์ โหวต หรือแสดงความคิดเห็นได้', standing_reason: 'เหตุผล:' },
    vi: { statsDisclaimer: "Tiến độ có thể tăng hoặc giảm khi các tính năng mới được thêm và các tính năng hiện tại được hoàn thành.", allStatuses: "T\u1ea5t c\u1ea3 tr\u1ea1ng th\u00e1i", pending: "Ch\u1edd duy\u1ec7t", accepted: "\u0110\u00e3 ch\u1ea5p nh\u1eadn", planned: "\u0110\u00e3 l\u00ean k\u1ebf ho\u1ea1ch", completed: "Ho\u00e0n th\u00e0nh", rejected: "T\u1eeb ch\u1ed1i", allTags: "T\u1ea5t c\u1ea3 tag", allLanguages: "T\u1ea5t c\u1ea3 ng\u00f4n ng\u1eef", allPhases: "T\u1ea5t c\u1ea3 giai \u0111o\u1ea1n", mostVoted: "Nhi\u1ec1u phi\u1ebfu nh\u1ea5t", newest: "M\u1edbi nh\u1ea5t", suggest: "+ G\u1ee3i \u00fd", search: "T\u00ecm ki\u1ebfm...", signInRequired: "C\u1ea7n \u0111\u0103ng nh\u1eadp", cancel: "H\u1ee7y", signInGoogle: "\u0110\u0103ng nh\u1eadp b\u1eb1ng Google", signInApple: "\u0110\u0103ng nh\u1eadp b\u1eb1ng Apple", subscribe: "\u0110\u0103ng k\u00fd", save: "L\u01b0u", loading: "\u0110ang t\u1ea3i...", noSuggestions: "Ch\u01b0a c\u00f3 g\u1ee3i \u00fd.", submit: "G\u1eedi", loggedInAs: "\u0110\u00e3 \u0111\u0103ng nh\u1eadp:", signOut: "\u0110\u0103ng xu\u1ea5t", signIn: "Đăng nhập", gdprEmailConsent: "Bằng cách bật thông báo email, bạn đồng ý nhận cập nhật. Bạn có thể hủy đăng ký bất cứ lúc nào qua liên kết trong mỗi email hoặc quay lại trang này." , close: 'Đóng', aria_upvote: 'Bình chọn lên', aria_downvote: 'Bình chọn xuống', aria_watch: 'Theo dõi đề xuất này' , duplicate_match: 'Đúng rồi, đó là ý tôi', duplicate_different: 'Không, ý tưởng của tôi khác' , tagVoice: 'Giọng nói', tagChat: 'Trò chuyện', tagModeration: 'Kiểm duyệt', tagUi: 'UI/UX', tagPrivacy: 'Quyền riêng tư', tagSocial: 'Xã hội', tagEconomy: 'Kinh tế', tagAccessibility: 'Khả năng truy cập', tagOther: 'Khác' , phaseCompliance: 'Tuân thủ & Pháp lý', phasePlatform: 'Nền tảng nền tảng', phaseRevenue: 'Động cơ doanh thu', phaseSocial: 'Xã hội cốt lõi', phaseQol: 'Chất lượng cuộc sống', phaseEntertainment: 'Giải trí', phaseSupport: 'Hỗ trợ & Chuyên biệt' , subscribe_event_new_suggestion: 'Đề xuất mới đã đăng', subscribe_event_status_change: 'Thay đổi trạng thái đề xuất', subscribe_event_comment_reply: 'Trả lời bình luận của bạn', subscribe_event_watched_update: 'Cập nhật các đề xuất theo dõi', subscribe_channel_email: 'Email', subscribe_channel_push: 'Push', subscribe_channel_inapp: 'Trong ứng dụng', subscribe_channel_system: 'Tin nhắn hệ thống', subscribe_event_header: 'Sự kiện', subscribe_btn_saving: 'Đang lưu...', subscribe_toast_saved: 'Đã lưu tuỳ chọn đăng ký', subscribe_toast_save_failed: 'Không thể lưu', subscribe_unknown_error: 'Lỗi không xác định' , toast_vote_failed: 'Bình chọn thất bại', unknown_error: 'Lỗi không xác định', toast_redirecting_to_existing: 'Đang chuyển hướng đến đề xuất hiện có', btn_submitting: 'Đang gửi...', toast_topic_not_allowed: 'Chủ đề này không được phép', toast_submit_failed: 'Gửi thất bại', btn_posting: 'Đang đăng...', toast_comment_posted: 'Đã đăng bình luận', toast_post_comment_failed: 'Đăng bình luận thất bại' , toast_suggestion_submitted: 'Đã gửi đề xuất! Sẽ được xem xét trước khi đăng.'  , standing_banned: 'Tài khoản của bạn đã bị cấm. Bạn có thể đọc đề xuất, nhưng không thể đăng, bình chọn hoặc bình luận.', standing_suspended: 'Tài khoản của bạn đã bị đình chỉ. Bạn có thể đọc đề xuất, nhưng không thể đăng, bình chọn hoặc bình luận.', standing_reason: 'Lý do:' },
    zh: { statsDisclaimer: "进度可能随着新功能的添加和现有功能的完成而上升或下降。", allStatuses: "\u6240\u6709\u72b6\u6001", pending: "\u5f85\u5ba1\u6838", accepted: "\u5df2\u63a5\u53d7", planned: "\u5df2\u8ba1\u5212", completed: "\u5df2\u5b8c\u6210", rejected: "\u5df2\u62d2\u7edd", allTags: "\u6240\u6709\u6807\u7b7e", allLanguages: "\u6240\u6709\u8bed\u8a00", allPhases: "\u6240\u6709\u9636\u6bb5", mostVoted: "\u6700\u591a\u6295\u7968", newest: "\u6700\u65b0", suggest: "+ \u5efa\u8bae", search: "\u641c\u7d22\u5efa\u8bae...", signInRequired: "\u9700\u8981\u767b\u5f55", cancel: "\u53d6\u6d88", signInGoogle: "\u4f7f\u7528Google\u767b\u5f55", signInApple: "\u4f7f\u7528Apple\u767b\u5f55", subscribe: "\u8ba2\u9605", save: "\u4fdd\u5b58", loading: "\u52a0\u8f7d\u4e2d...", noSuggestions: "\u8fd8\u6ca1\u6709\u5efa\u8bae\u3002", submit: "\u63d0\u4ea4", loggedInAs: "\u5df2\u767b\u5f55:", signOut: "\u9000\u51fa", signIn: "登录", gdprEmailConsent: "启用电子邮件通知即表示您同意接收更新。您可以随时通过每封电子邮件中的链接或返回此页面取消订阅。" , close: '关闭', aria_upvote: '赞成', aria_downvote: '反对', aria_watch: '关注此建议' , duplicate_match: '是的，这就是我想说的', duplicate_different: '不，我的想法不同' , tagVoice: '语音', tagChat: '聊天', tagModeration: '管理', tagUi: '界面/体验', tagPrivacy: '隐私', tagSocial: '社交', tagEconomy: '经济', tagAccessibility: '无障碍', tagOther: '其他' , phaseCompliance: '合规与法务', phasePlatform: '平台基础', phaseRevenue: '收入引擎', phaseSocial: '核心社交', phaseQol: '生活质量', phaseEntertainment: '娱乐', phaseSupport: '支持 & 专业' , subscribe_event_new_suggestion: '新建议已发布', subscribe_event_status_change: '建议状态变更', subscribe_event_comment_reply: '对您评论的回复', subscribe_event_watched_update: '关注建议的更新', subscribe_channel_email: '邮件', subscribe_channel_push: '推送', subscribe_channel_inapp: '应用内', subscribe_channel_system: '系统消息', subscribe_event_header: '事件', subscribe_btn_saving: '保存中...', subscribe_toast_saved: '订阅偏好已保存', subscribe_toast_save_failed: '保存失败', subscribe_unknown_error: '未知错误' , toast_vote_failed: '投票失败', unknown_error: '未知错误', toast_redirecting_to_existing: '正在重定向到现有建议', btn_submitting: '正在提交...', toast_topic_not_allowed: '不允许此话题', toast_submit_failed: '提交失败', btn_posting: '发布中...', toast_comment_posted: '评论已发布', toast_post_comment_failed: '评论发布失败' , toast_suggestion_submitted: '建议已提交！将在发布前进行审核。'  , standing_banned: '您的帐户已被封禁。您可以阅读建议，但无法发布、投票或评论。', standing_suspended: '您的帐户已被暂停。您可以阅读建议，但无法发布、投票或评论。', standing_reason: '原因：' },
  };

  var sgLang = (window.ShyTalkLanguage && window.ShyTalkLanguage.get()) || (navigator.language || "en").slice(0, 2);

  window.SG_LABELS = SG_LABELS;
  window.sgT = function (key) {
    var l = SG_LABELS[sgLang] || SG_LABELS.en;
    return l[key] || SG_LABELS.en[key] || key;
  };

  // Apply data-i18n attributes from SG_LABELS
  function applySgI18n() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      var translated = window.sgT(key);
      if (translated !== key) el.textContent = translated;
    });
  }

  // Chain into applyLanguage (language-selector.js calls this on language change)
  var _prevApplyLanguage = window.applyLanguage;
  window.applyLanguage = function (lang) {
    sgLang = lang;
    if (typeof _prevApplyLanguage === "function") _prevApplyLanguage(lang);
    applySgI18n();
  };

  // Apply on load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applySgI18n);
  } else {
    applySgI18n();
  }
})();
