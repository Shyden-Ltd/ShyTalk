/**
 * Shared utility functions — pure helpers with no external dependencies.
 */

const crypto = require('crypto');

function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(20);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function now() {
  return Date.now();
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function yesterdayStr() {
  return new Date(Date.now() - 86400000).toISOString().split('T')[0];
}

function getExtension(contentType) {
  if (contentType.startsWith('video/')) {
    const sub = contentType.slice(6);
    return sub === 'quicktime' ? 'mov' : sub;
  }
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  return map[contentType] ?? 'jpg';
}

module.exports = { generateId, now, todayStr, yesterdayStr, getExtension };
