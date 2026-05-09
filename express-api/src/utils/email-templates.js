// Env-aware fallback. Without this, dev/local would emit prod CDN URLs
// in email logos when CDN_URL is unset (env-loading glitch, missing
// .env). The prod CDN is publicly readable so this isn't a credential
// leak, but a dev test email pointing at the prod logo asset crosses
// environments — see feedback-environment-isolation memory. Mirrors
// the pattern shipped in PR #565 for suggestion-email-templates.js.
// Single-line ternary kept (prettier-ignore) so the pre-commit URL-
// isolation guard sees the localhost fallback alongside the prod URL.
/* eslint-disable no-nested-ternary, max-len */
// prettier-ignore
const CDN_URL = process.env.CDN_URL || (process.env.NODE_ENV === 'production' ? 'https://images.shytalk.shyden.co.uk' : process.env.NODE_ENV === 'local' ? 'http://localhost:9002/shytalk-media' : 'https://dev-images.shytalk.shyden.co.uk');
/* eslint-enable no-nested-ternary, max-len */

const LOGO_URL = `${CDN_URL}/branding/logo.png`;

// Minimal HTML-escape for user-influenced strings interpolated into email
// templates (e.g., the failedSections list in the partial-export notice).
// Section names are server-controlled today, but a future refactor that
// includes user-supplied identifiers must not be an injection vector.
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapTemplate(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShyTalk</title>
</head>
<body style="margin:0;padding:0;background:#121218;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#121218;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#1a1a2e;border-radius:12px;overflow:hidden;">
          <!-- Header with logo -->
          <tr>
            <td style="padding:28px 24px 20px;text-align:center;border-bottom:1px solid #2a2a4e;">
              <img src="${LOGO_URL}" alt="ShyTalk" width="48" height="48" style="display:inline-block;border-radius:12px;margin-bottom:8px;">
              <div style="color:#8b7fff;font-size:22px;font-weight:700;letter-spacing:0.5px;">ShyTalk</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px 24px;color:#d0d0e0;font-size:15px;line-height:1.7;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 24px;text-align:center;color:#555570;font-size:12px;line-height:1.6;border-top:1px solid #2a2a4e;">
              ShyTalk &mdash; Voice Chat Rooms<br>
              If you didn't request this, you can safely ignore this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function otpCodeBlock(code) {
  return `<div style="text-align:center;margin:24px 0;">
  <span style="font-size:32px;letter-spacing:10px;font-weight:700;color:#fff;background:#2a2a4e;padding:14px 28px;border-radius:10px;display:inline-block;font-family:'Courier New',monospace;">${code}</span>
</div>`;
}

function buildOtpEmail(code) {
  const html = wrapTemplate(`
    <p style="margin:0 0 8px;color:#d0d0e0;">Hi there,</p>
    <p style="margin:0 0 4px;color:#d0d0e0;">Your verification code is:</p>
    ${otpCodeBlock(code)}
    <p style="margin:0;color:#7a7a9e;font-size:13px;">This code expires in 10 minutes. Enter it in the app to continue.</p>
  `);
  return { subject: 'Your ShyTalk verification code', html };
}

function buildLockoutEmail(code) {
  const html = wrapTemplate(`
    <p style="margin:0 0 8px;color:#d0d0e0;">Hi there,</p>
    <p style="margin:0 0 4px;color:#d0d0e0;">Your ShyTalk account was locked due to too many failed PIN attempts. Use this code to unlock it:</p>
    ${otpCodeBlock(code)}
    <p style="margin:0;color:#7a7a9e;font-size:13px;">This code expires in 10 minutes. After unlocking, you'll be asked to set a new PIN.</p>
  `);
  return { subject: 'Unlock your ShyTalk account', html };
}

function buildResetEmail(code) {
  const html = wrapTemplate(`
    <p style="margin:0 0 8px;color:#d0d0e0;">Hi there,</p>
    <p style="margin:0 0 4px;color:#d0d0e0;">You requested to reset your ShyTalk PIN. Use this code to verify your identity:</p>
    ${otpCodeBlock(code)}
    <p style="margin:0;color:#7a7a9e;font-size:13px;">This code expires in 10 minutes. After verifying, you'll be able to set a new PIN.</p>
  `);
  return { subject: 'Reset your ShyTalk PIN', html };
}

function buildDeletionScheduledEmail(date) {
  const html = wrapTemplate(`
    <p style="margin:0 0 8px;color:#d0d0e0;">Hi there,</p>
    <p style="margin:0 0 12px;color:#d0d0e0;">Your ShyTalk account has been scheduled for deletion. All your data will be permanently deleted on <strong style="color:#fff;">${date}</strong>.</p>
    <p style="margin:0 0 12px;color:#d0d0e0;">If you did not request this, sign in to ShyTalk before ${date} to cancel.</p>
    <p style="margin:0;color:#7a7a9e;font-size:13px;">If you have any questions, contact <a href="mailto:shytalk.help@gmail.com" style="color:#8b7fff;">shytalk.help@gmail.com</a></p>
  `);
  return { subject: 'Your ShyTalk account is scheduled for deletion', html };
}

function buildDeletionCompleteEmail() {
  const html = wrapTemplate(`
    <p style="margin:0 0 8px;color:#d0d0e0;">Hi there,</p>
    <p style="margin:0 0 12px;color:#d0d0e0;">Your ShyTalk account and all associated data have been permanently deleted.</p>
    <p style="margin:0;color:#7a7a9e;font-size:13px;">If you believe this was an error, contact <a href="mailto:shytalk.help@gmail.com" style="color:#8b7fff;">shytalk.help@gmail.com</a></p>
  `);
  return { subject: 'Your ShyTalk account has been deleted', html };
}

function buildDataExportReadyEmail(downloadUrl, expiresAt, partial = false, failedSections = []) {
  // Partial-export notice surfaces ABOVE the download CTA so the user
  // sees it before they click. The list of failed sections lets them
  // decide whether to use this export or wait 24h and re-request.
  const partialNotice = partial
    ? `
    <div style="background:#3a2630;border-left:4px solid #ff8b8b;padding:12px 16px;margin:0 0 16px;border-radius:6px;">
      <p style="margin:0 0 8px;color:#ffd0d0;font-weight:700;">⚠ Partial export</p>
      <p style="margin:0 0 8px;color:#d0d0e0;font-size:13px;">We couldn't retrieve every section of your data due to a transient backend failure. The following sections are missing or incomplete:</p>
      <ul style="margin:0;padding-left:20px;color:#d0d0e0;font-size:13px;">
        ${failedSections.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
      </ul>
      <p style="margin:8px 0 0;color:#7a7a9e;font-size:12px;">You can request a fresh export in 24 hours. The ZIP also contains a <code>manifest.json</code> with the full section status.</p>
    </div>
  `
    : '';
  const html = wrapTemplate(`
    <p style="margin:0 0 8px;color:#d0d0e0;">Hi there,</p>
    <p style="margin:0 0 12px;color:#d0d0e0;">Your ShyTalk data export is ready for download.</p>
    ${partialNotice}
    <div style="text-align:center;margin:24px 0;">
      <a href="${downloadUrl}" style="display:inline-block;background:#8b7fff;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;">Download Your Data</a>
    </div>
    <p style="margin:0 0 12px;color:#7a7a9e;font-size:13px;">This link expires on ${expiresAt}. After that, you can request a new export.</p>
    <p style="margin:0;color:#7a7a9e;font-size:13px;">If you have any questions, contact <a href="mailto:shytalk.help@gmail.com" style="color:#8b7fff;">shytalk.help@gmail.com</a></p>
  `);
  const subject = partial
    ? 'Your ShyTalk data export is ready (partial)'
    : 'Your ShyTalk data export is ready';
  return { subject, html };
}

module.exports = {
  buildOtpEmail,
  buildLockoutEmail,
  buildResetEmail,
  buildDeletionScheduledEmail,
  buildDeletionCompleteEmail,
  buildDataExportReadyEmail,
};
