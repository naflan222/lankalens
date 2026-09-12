'use strict';
const crypto = require('node:crypto');

const now = () => Date.now();

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Format whole-rupee amount: 325000 -> "Rs. 325,000" */
function formatLKR(amount) {
  const n = Math.round(Number(amount || 0));
  return 'Rs. ' + n.toLocaleString('en-US');
}

/**
 * Normalize Sri Lankan phone numbers.
 * Accepts 0771234567, 077 123 4567, +94771234567, 94771234567.
 * Returns { e164, whatsapp, display } or null when invalid.
 */
function normalizeSLPhone(input) {
  if (!input) return null;
  let digits = String(input).replace(/[^\d+]/g, '');
  if (digits.startsWith('+94')) digits = '94' + digits.slice(3);
  else if (digits.startsWith('94') && digits.length === 11) digits = digits;
  else if (digits.startsWith('0')) digits = '94' + digits.slice(1);
  // Sri Lankan mobile: 94 + 7X + 7 digits (11 total); fixed lines 94 + area (also 10-11)
  if (!/^94\d{9}$/.test(digits)) return null;
  const local = '0' + digits.slice(2);
  const display = local.slice(0, 3) + ' ' + local.slice(3, 6) + ' ' + local.slice(6);
  return { e164: '+' + digits, whatsapp: digits, display, local };
}

/** Build a wa.me link with a pre-filled message. Never hard-coded per site. */
function whatsappLink(waDigits, message) {
  if (!waDigits) return null;
  const digits = waDigits.replace(/\D/g, '').replace(/^0/, '94');
  let url = `https://wa.me/${digits}`;
  if (message) url += `?text=${encodeURIComponent(message)}`;
  return url;
}

function timeAgo(tsSeconds) {
  if (!tsSeconds) return '';
  const s = Math.max(1, Math.floor((Date.now() - tsSeconds * 1000) / 1000));
  const units = [
    ['year', 31536000], ['month', 2592000], ['week', 604800],
    ['day', 86400], ['hour', 3600], ['minute', 60],
  ];
  for (const [name, size] of units) {
    const v = Math.floor(s / size);
    if (v >= 1) return `${v} ${name}${v > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

const CONDITIONS = ['brand_new', 'like_new', 'excellent', 'good', 'fair', 'parts'];
const CONDITION_LABELS = {
  brand_new: 'Brand New', like_new: 'Like New', excellent: 'Excellent',
  good: 'Good', fair: 'Fair', parts: 'For Parts / Repair',
};

module.exports = {
  now, slugify, randomToken, hashToken, formatLKR,
  normalizeSLPhone, whatsappLink, timeAgo, CONDITIONS, CONDITION_LABELS,
};
