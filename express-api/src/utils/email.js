const nodemailer = require('nodemailer');

const FROM_ADDRESS = '"ShyTalk" <noreply@shytalk.shyden.co.uk>';

let _transport = null;
let _transportKey = null;

function getTransport() {
  if (process.env.NODE_ENV === 'local') {
    if (!_transport) {
      _transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'localhost',
        port: Number.parseInt(process.env.SMTP_PORT || '1025', 10),
      });
      _transportKey = 'local';
    }
    return _transport;
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP not configured');
  }

  const key = `${SMTP_HOST}:${SMTP_PORT}:${SMTP_USER}:${SMTP_PASS}`;
  if (_transport && _transportKey === key) return _transport;

  _transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number.parseInt(SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
  _transportKey = key;

  return _transport;
}

async function sendEmail(to, subject, html) {
  const transport = getTransport();

  return transport.sendMail({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
  });
}

// Exported for test cleanup only
function _resetTransport() {
  _transport = null;
  _transportKey = null;
}

module.exports = { sendEmail, _resetTransport };
