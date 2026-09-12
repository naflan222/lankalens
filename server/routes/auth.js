'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { now, slugify, randomToken, hashToken, normalizeSLPhone } = require('../lib/util');
const { signToken, setAuthCookie, requireAuth, attachUser } = require('../middleware/auth');
const { asyncHandler, ApiError, rateLimit, requireFields, str, notify } = require('../middleware/util');
const { sendMail, layout } = require('../services/mailer');

const router = express.Router();
const DAY = 86400000;

const siteUrl = () => process.env.LL_SITE_URL || `http://localhost:${process.env.PORT || 3000}`;

function publicUser(u) {
  const sp = db.prepare('SELECT seller_type,verified_phone,verified_email,verified_business,display_name,whatsapp_number,contact_phone,calls_enabled,whatsapp_enabled,chat_enabled FROM seller_profiles WHERE user_id=?').get(u.id) || {};
  const profile = db.prepare('SELECT up.*, l.name AS location_name FROM user_profiles up LEFT JOIN locations l ON l.id=up.location_id WHERE up.user_id=?').get(u.id) || {};
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, avatar: u.avatar_url,
    email_verified: !!u.email_verified_at, phone_verified: !!u.phone_verified_at,
    seller_type: sp.seller_type || 'individual', display_name: sp.display_name || u.name,
    verified_phone: !!sp.verified_phone, verified_email: !!sp.verified_email, verified_business: !!sp.verified_business,
    whatsapp: sp.whatsapp_number || null, contact_phone: sp.contact_phone || null,
    calls_enabled: sp.calls_enabled !== 0, whatsapp_enabled: sp.whatsapp_enabled !== 0, chat_enabled: sp.chat_enabled !== 0,
    location: profile.location_name || profile.city || null, location_id: profile.location_id || null,
    bio: profile.bio || '', member_since: u.created_at,
  };
}

function makeToken(userId, purpose, days = 1) {
  const raw = randomToken(20);
  db.prepare('INSERT INTO verification_tokens (user_id,purpose,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
    .run(userId, purpose, hashToken(raw), now() + days * DAY, now());
  return raw;
}

// ---------- register ----------
router.post('/register', rateLimit('auth', 12), asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['name', 'email', 'password']);
  const name = str(b.name, 80);
  const email = str(b.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Enter a valid email address.');
  if (String(b.password).length < 8) throw new ApiError(400, 'Password must be at least 8 characters.');
  let phone = null;
  if (b.phone) {
    const p = normalizeSLPhone(b.phone);
    if (!p) throw new ApiError(400, 'Enter a valid Sri Lankan phone number (e.g. 077 123 4567).');
    phone = p.e164;
  }
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new ApiError(409, 'An account with this email already exists.');

  const t = now();
  const info = db.prepare(
    `INSERT INTO users (name,email,phone,password_hash,role,avatar_url,email_verified_at,phone_verified_at,status,created_at,updated_at)
     VALUES (?,?,?,?, 'user', NULL, NULL, NULL, 'active', ?, ?)`
  ).run(name, email, phone, bcrypt.hashSync(String(b.password), 10), t, t);
  const uid = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO user_profiles (user_id,city,updated_at) VALUES (?,?,?)').run(uid, str(b.city, 60) || null, t);
  const wa = phone ? phone.replace('+', '') : null;
  db.prepare(
    `INSERT INTO seller_profiles (user_id,seller_type,display_name,contact_phone,whatsapp_number,verified_phone,verified_email,created_at,updated_at)
     VALUES (?, 'individual', ?, ?, ?, 0, 0, ?, ?)`
  ).run(uid, name, phone, wa, t, t);

  const verify = makeToken(uid, 'email', 3);
  sendMail(email, 'Verify your Lanka Lens email',
    layout('Welcome to Lanka Lens', `<p>Hi ${name},</p><p>Confirm your email to start buying and selling camera equipment across Sri Lanka.</p>
      <p><a href="${siteUrl()}/verify-email?token=${verify}" style="display:inline-block;background:#c98a2e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">Verify email</a></p>
      <p style="font-size:12px;color:#7a8794">Or use the verify page with code: ${verify.slice(0, 12)}…</p>`));

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  setAuthCookie(res, signToken(user));
  notify(uid, 'welcome', 'Welcome to Lanka Lens', 'Complete your profile and post your first camera listing.', '/sell');
  res.json({ user: publicUser(user), message: 'Account created. Please verify your email.' });
}));

// ---------- login ----------
router.post('/login', rateLimit('auth', 15), asyncHandler(async (req, res) => {
  const b = req.body || {};
  requireFields(b, ['email', 'password']);
  const email = str(b.email, 120).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(String(b.password), user.password_hash)) {
    throw new ApiError(401, 'Incorrect email or password.');
  }
  if (user.status === 'suspended') throw new ApiError(403, 'This account has been suspended. Contact support.');
  db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), user.id);
  setAuthCookie(res, signToken(user));
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (_req, res) => {
  res.clearCookie('ll_token');
  res.json({ ok: true });
});

router.get('/me', attachUser, (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
});

// ---------- email verification ----------
router.post('/verify-email', rateLimit('auth', 20), asyncHandler(async (req, res) => {
  const { token } = req.body || {};
  if (!token) throw new ApiError(400, 'Verification token is required.');
  const row = db.prepare('SELECT * FROM verification_tokens WHERE purpose=\'email\' AND token_hash=? AND consumed_at IS NULL').get(hashToken(token));
  if (!row || row.expires_at < now()) throw new ApiError(400, 'This verification link is invalid or has expired.');
  db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(now(), row.user_id);
  db.prepare('UPDATE seller_profiles SET verified_email=1 WHERE user_id=?').run(row.user_id);
  db.prepare('UPDATE verification_tokens SET consumed_at=? WHERE id=?').run(now(), row.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  setAuthCookie(res, signToken(user));
  res.json({ user: publicUser(user), message: 'Email verified. Thank you!' });
}));

router.post('/resend-verification', requireAuth, rateLimit('auth', 6), asyncHandler(async (req, res) => {
  if (req.user.email_verified_at) return res.json({ message: 'Already verified.' });
  const verify = makeToken(req.user.id, 'email', 3);
  sendMail(req.user.email, 'Verify your Lanka Lens email',
    layout('Confirm your email', `<p><a href="${siteUrl()}/verify-email?token=${verify}" style="display:inline-block;background:#c98a2e;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">Verify email</a></p>`));
  res.json({ message: 'Verification email sent.' });
}));

// ---------- password reset ----------
router.post('/forgot-password', rateLimit('auth', 8), asyncHandler(async (req, res) => {
  const email = str(req.body?.email, 120).toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // Always answer success to avoid account enumeration
  if (user) {
    const raw = makeToken(user.id, 'reset', 1);
    sendMail(email, 'Reset your Lanka Lens password',
      layout('Password reset', `<p>We received a request to reset your password.</p>
        <p><a href="${siteUrl()}/reset-password?token=${raw}" style="display:inline-block;background:#11202f;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none">Choose a new password</a></p>
        <p>If you didn't request this, you can safely ignore this email.</p>`));
  }
  res.json({ message: 'If that email is registered, a reset link has been sent.' });
}));

router.post('/reset-password', rateLimit('auth', 10), asyncHandler(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || String(password).length < 8) throw new ApiError(400, 'Provide a valid token and a password of at least 8 characters.');
  const row = db.prepare('SELECT * FROM verification_tokens WHERE purpose=\'reset\' AND token_hash=? AND consumed_at IS NULL').get(hashToken(token));
  if (!row || row.expires_at < now()) throw new ApiError(400, 'This reset link is invalid or has expired.');
  db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(bcrypt.hashSync(String(password), 10), now(), row.user_id);
  db.prepare('UPDATE verification_tokens SET consumed_at=? WHERE id=?').run(now(), row.id);
  res.json({ message: 'Password updated. You can now sign in.' });
}));

// ---------- phone verification (OTP delivered to dev outbox / future SMS) ----------
router.post('/phone/request-code', requireAuth, rateLimit('auth', 6), asyncHandler(async (req, res) => {
  let phone = req.body?.phone ? normalizeSLPhone(req.body.phone) : null;
  if (req.body?.phone) {
    if (!phone) throw new ApiError(400, 'Enter a valid Sri Lankan phone number.');
    db.prepare('UPDATE users SET phone=?, updated_at=? WHERE id=?').run(phone.e164, now(), req.user.id);
    db.prepare('UPDATE seller_profiles SET contact_phone=?, whatsapp_number=? WHERE user_id=?').run(phone.e164, phone.whatsapp, req.user.id);
  } else {
    phone = req.user.phone ? { e164: req.user.phone } : null;
  }
  if (!phone) throw new ApiError(400, 'Add a phone number first.');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.prepare('INSERT INTO verification_tokens (user_id,purpose,token_hash,expires_at,created_at) VALUES (?, \'phone\', ?, ?, ?)')
    .run(req.user.id, hashToken(code), now() + 15 * 60000, now());
  // SMS is not configured in v1 — log/outbox the OTP like an email (dev-testable)
  sendMail(req.user.email, `Your Lanka Lens verification code is ${code}`,
    layout('Phone verification', `<p>Your one-time code: <strong style="font-size:22px;letter-spacing:3px">${code}</strong></p><p>It expires in 15 minutes.</p>`));
  res.json({ message: 'Verification code sent (shown in the developer outbox until SMS is configured).' });
}));

router.post('/phone/verify', requireAuth, rateLimit('auth', 12), asyncHandler(async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!/^\d{6}$/.test(code)) throw new ApiError(400, 'Enter the 6-digit code.');
  const rows = db.prepare("SELECT * FROM verification_tokens WHERE user_id=? AND purpose='phone' AND consumed_at IS NULL ORDER BY id DESC LIMIT 5").all(req.user.id);
  const match = rows.find((r) => r.token_hash === hashToken(code));
  if (!match || match.expires_at < now()) throw new ApiError(400, 'Incorrect or expired code.');
  db.prepare('UPDATE users SET phone_verified_at=? WHERE id=?').run(now(), req.user.id);
  db.prepare('UPDATE seller_profiles SET verified_phone=1 WHERE user_id=?').run(req.user.id);
  db.prepare('UPDATE verification_tokens SET consumed_at=? WHERE id=?').run(now(), match.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  res.json({ user: publicUser(user), message: 'Phone number verified.' });
}));

module.exports = { router, publicUser };
