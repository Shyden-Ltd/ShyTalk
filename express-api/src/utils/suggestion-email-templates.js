/**
 * Email templates for suggestion notifications.
 * Supports 20 languages with List-Unsubscribe headers (RFC 8058).
 */

const SUBJECTS = {
  accepted: {
    en: 'Your suggestion was accepted!',
    ar: 'تم قبول اقتراحك!',
    de: 'Ihr Vorschlag wurde akzeptiert!',
    es: 'Tu sugerencia fue aceptada!',
    fr: 'Votre suggestion a été acceptée!',
    hi: 'आपका सुझाव स्वीकार कर लिया गया!',
    id: 'Saran Anda diterima!',
    it: 'Il tuo suggerimento è stato accettato!',
    ja: 'あなたの提案が承認されました！',
    ko: '제안이 수락되었습니다!',
    nl: 'Uw suggestie is geaccepteerd!',
    pl: 'Twoja sugestia została zaakceptowana!',
    pt: 'Sua sugestão foi aceita!',
    ru: 'Ваше предложение принято!',
    sv: 'Ditt förslag accepterades!',
    th: 'ข้อเสนอแนะของคุณได้รับการยอมรับ!',
    tr: 'Öneriniz kabul edildi!',
    uk: 'Вашу пропозицію прийнято!',
    vi: 'Đề xuất của bạn đã được chấp nhận!',
    zh: '您的建议已被接受！',
  },
  // SHY-0246: these four were English-only, and getSubject() falls back to
  // `en` SILENTLY — a zh/id/vi recipient got English with nothing failing.
  // Filled for the four supported locales (SHY-0194: en, zh, id, vi); the
  // other 16 keep the existing English fallback, as they already did here.
  rejected: {
    en: 'Your suggestion was declined',
    zh: '您的建议未被采纳',
    id: 'Saran Anda ditolak',
    vi: 'Đề xuất của bạn đã bị từ chối',
  },
  planned: {
    en: 'Your suggestion has been added to the roadmap',
    zh: '您的建议已加入路线图',
    id: 'Saran Anda telah ditambahkan ke peta jalan',
    vi: 'Đề xuất của bạn đã được thêm vào lộ trình',
  },
  completed: {
    en: 'A feature you suggested has shipped!',
    zh: '您建议的功能已上线！',
    id: 'Fitur yang Anda sarankan telah dirilis!',
    vi: 'Tính năng bạn đề xuất đã ra mắt!',
  },
  merged: {
    en: 'Your suggestion was merged with an existing one',
    zh: '您的建议已与现有建议合并',
    id: 'Saran Anda telah digabungkan dengan saran yang sudah ada',
    vi: 'Đề xuất của bạn đã được gộp với một đề xuất hiện có',
  },
  // `comment` had NO entry, and an unknown key falls back to SUBJECTS.accepted
  // — so every comment notification was labelled "Your suggestion was
  // accepted!". Silently wrong words, not merely untranslated.
  comment: {
    en: 'New comment on a suggestion you follow',
    zh: '您关注的建议有新评论',
    id: 'Komentar baru pada saran yang Anda ikuti',
    vi: 'Bình luận mới về đề xuất bạn theo dõi',
  },
};

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}

function buildEmailHtml(title, body, ctaUrl, language) {
  return `<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="utf-8"></head>
<body style="background:#0f1117;color:#e0e0e0;font-family:sans-serif;padding:20px;">
<div style="max-width:600px;margin:0 auto;">
  <h2 style="color:#7c5cfc;">ShyTalk</h2>
  <div style="background:#1a1d27;padding:20px;border-radius:8px;">
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(body)}</p>
    <a href="${ctaUrl}" style="display:inline-block;padding:12px 24px;background:#7c5cfc;color:#fff;border-radius:6px;text-decoration:none;">View Roadmap</a>
  </div>
  <p style="font-size:12px;color:#888;margin-top:20px;">
    &copy; Shyden Ltd. <a href="${ctaUrl}" style="color:#7c5cfc;">Unsubscribe</a> | <a href="${ctaUrl}" style="color:#7c5cfc;">Manage Preferences</a>
  </p>
</div>
</body>
</html>`;
}

function getSubject(type, language, title) {
  const subjects = SUBJECTS[type] || SUBJECTS.accepted;
  const base = subjects[language] || subjects.en;
  if (title) {
    const truncTitle = truncate(title, 50);
    return `${base} — ${truncTitle}`;
  }
  return base;
}

// Env-aware fallbacks. The previous unconditional `|| 'https://shytalk...'`
// + `|| 'https://api.shytalk...'` would silently emit prod URLs in
// roadmap-suggestion emails sent from dev / local if SITE_BASE_URL /
// API_BASE_URL were unset — so a developer clicking the unsubscribe link
// from a dev test email would unsubscribe their PROD account from
// suggestion notifications. See feedback-environment-isolation memory.
// Kept on one line each (prettier-ignore) so the pre-commit URL-
// isolation guard sees the localhost fallback alongside the prod URL.

// prettier-ignore
const SITE_BASE = process.env.SITE_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://shytalk.shyden.co.uk' : process.env.NODE_ENV === 'local' ? 'http://localhost:8888' : 'https://dev.shytalk.shyden.co.uk');
// prettier-ignore
const API_BASE = process.env.API_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://api.shytalk.shyden.co.uk' : process.env.NODE_ENV === 'local' ? 'http://localhost:3000' : 'https://dev-api.shytalk.shyden.co.uk');

function buildHeaders(uid) {
  const unsubUrl = `${API_BASE}/api/subscriptions/unsubscribe?token=${uid}`;
  return {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function buildAcceptedEmail(suggestionId, title, language = 'en') {
  return {
    subject: getSubject('accepted', language, truncate(title, 60)),
    html: buildEmailHtml(
      title || 'Your suggestion was accepted',
      'The community can now vote on your idea. View it on the roadmap.',
      `${SITE_BASE}/roadmap.html#suggestion-${suggestionId}`,
      language,
    ),
    headers: buildHeaders(suggestionId),
  };
}

function buildRejectedEmail(suggestionId, title, reason, language = 'en') {
  return {
    subject: getSubject('rejected', language, truncate(title, 60)),
    html: buildEmailHtml(
      title || 'Your suggestion was declined',
      reason ? `Reason: ${reason}` : 'Thank you for your suggestion.',
      `${SITE_BASE}/roadmap.html#suggestions`,
      language,
    ),
    headers: buildHeaders(suggestionId),
  };
}

function buildPlannedEmail(suggestionId, title, language = 'en') {
  return {
    subject: getSubject('planned', language, truncate(title, 60)),
    html: buildEmailHtml(
      title || 'Added to the roadmap',
      'Your suggestion has been added to the official roadmap!',
      `${SITE_BASE}/roadmap.html#suggestion-${suggestionId}`,
      language,
    ),
    headers: buildHeaders(suggestionId),
  };
}

function buildCompletedEmail(suggestionId, title, language = 'en') {
  return {
    subject: getSubject('completed', language, truncate(title, 60)),
    html: buildEmailHtml(
      title || 'Feature shipped!',
      'A feature you suggested has been completed and shipped.',
      `${SITE_BASE}/roadmap.html#suggestion-${suggestionId}`,
      language,
    ),
    headers: buildHeaders(suggestionId),
  };
}

function buildMergedEmail(suggestionId, originalId, title, language = 'en') {
  return {
    subject: getSubject('merged', language, truncate(title, 60)),
    html: buildEmailHtml(
      title || 'Suggestion merged',
      `Your suggestion was merged with an existing one. View the original.`,
      `${SITE_BASE}/roadmap.html#suggestion-${originalId}`,
      language,
    ),
    headers: buildHeaders(suggestionId),
  };
}

module.exports = {
  buildAcceptedEmail,
  buildRejectedEmail,
  buildPlannedEmail,
  buildCompletedEmail,
  buildMergedEmail,
  // Exported for SHY-0246 so in-app notifications and system PMs reuse the
  // SAME localised strings as the emails, rather than introducing a parallel
  // set of English-only ones. Pure function, no side effects.
  getSubject,
};
