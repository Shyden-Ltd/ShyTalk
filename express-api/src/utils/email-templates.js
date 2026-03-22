const CDN_URL = process.env.CDN_URL || 'https://images.shytalk.shyden.co.uk';

const LOGO_URL = `${CDN_URL}/branding/logo.png`;

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

module.exports = { buildOtpEmail, buildLockoutEmail, buildResetEmail };
