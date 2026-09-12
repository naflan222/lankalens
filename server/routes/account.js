'use strict';
const express = require('express');
const path = require('node:path');
const multer = require('multer');
const { db } = require('../db');
const repo = require('../lib/repo');
const { now, normalizeSLPhone, slugify, timeAgo } = require('../lib/util');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, ApiError, str, notify } = require('../middleware/util');
const { saveImage, saveDataUrl } = require('../services/image');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ---------- current account ----------
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const t = now();
  const name = b.name ? str(b.name, 80) : null;
  let avatarUrl;
  if (b.avatar && String(b.avatar).startsWith('data:')) {
    avatarUrl = saveDataUrl(b.avatar, { root: UPLOAD_ROOT, kind: 'avatars' });
  }
  if (b.phone !== undefined) {
    if (b.phone) {
      const p = normalizeSLPhone(b.phone);
      if (!p) throw new ApiError(400, 'Enter a valid Sri Lankan phone number.');
      db.prepare('UPDATE users SET phone=? WHERE id=?').run(p.e164, req.user.id);
      db.prepare('UPDATE seller_profiles SET contact_phone=?, whatsapp_number=COALESCE(NULLIF(whatsapp_number,\'\'),?), updated_at=? WHERE user_id=?')
        .run(p.e164, p.whatsapp, t, req.user.id);
    }
  }
  if (b.whatsapp !== undefined) {
    let wa = null;
    if (b.whatsapp) {
      const p = normalizeSLPhone(b.whatsapp);
      if (!p) throw new ApiError(400, 'Enter a valid WhatsApp number.');
      wa = p.whatsapp;
    }
    db.prepare('UPDATE seller_profiles SET whatsapp_number=?, updated_at=? WHERE user_id=?').run(wa || '', t, req.user.id);
  }
  db.prepare('UPDATE users SET name=COALESCE(?,name), avatar_url=COALESCE(?,avatar_url), updated_at=? WHERE id=?')
    .run(name, avatarUrl || null, t, req.user.id);
  if (name) db.prepare('UPDATE seller_profiles SET display_name=?, updated_at=? WHERE user_id=?').run(name, t, req.user.id);
  if (b.location_id) db.prepare('UPDATE user_profiles SET location_id=? WHERE user_id=?').run(Number(b.location_id), req.user.id);
  if (b.city !== undefined) db.prepare('UPDATE user_profiles SET city=? WHERE user_id=?').run(str(b.city, 60), req.user.id);
  if (b.bio !== undefined) db.prepare('UPDATE user_profiles SET bio=?, updated_at=? WHERE user_id=?').run(str(b.bio, 1000), t, req.user.id);
  const sp = db.prepare('SELECT calls_enabled,whatsapp_enabled,chat_enabled FROM seller_profiles WHERE user_id=?').get(req.user.id);
  if (sp) {
    db.prepare('UPDATE seller_profiles SET calls_enabled=?, whatsapp_enabled=?, chat_enabled=?, updated_at=? WHERE user_id=?')
      .run(b.calls_enabled === false ? 0 : sp.calls_enabled,
        b.whatsapp_enabled === false ? 0 : (b.whatsapp_enabled === true ? 1 : sp.whatsapp_enabled),
        b.chat_enabled === false ? 0 : (b.chat_enabled === true ? 1 : sp.chat_enabled), t, req.user.id);
  }
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const { publicUser } = require('./auth');
  res.json({ user: publicUser(user) });
}));

// ---------- seller dashboard stats ----------
router.get('/me/stats', requireAuth, (req, res) => {
  const uid = req.user.id;
  const counts = {};
  for (const s of ['active', 'pending', 'sold', 'expired', 'draft', 'rejected', 'suspended']) {
    counts[s] = db.prepare('SELECT COUNT(*) n FROM listings WHERE seller_id=? AND status=?').get(uid, s).n;
  }
  const totals = db.prepare(`SELECT
      COALESCE(SUM(views),0) views, COALESCE(SUM(favorite_count),0) favorites,
      COALESCE(SUM(CASE WHEN status='active' THEN 1 ELSE 0 END),0) active
    FROM listings WHERE seller_id=?`).get(uid);
  const messages = db.prepare(`SELECT COUNT(*) n FROM messages m
      JOIN conversations c ON c.id=m.conversation_id WHERE c.seller_id=? AND m.sender_id<>?`).get(uid, uid).n;
  const offers = db.prepare('SELECT COUNT(*) n FROM offers WHERE seller_id=?').get(uid).n;
  const calls = db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE user_id=? AND type='call' AND listing_id IN (SELECT id FROM listings WHERE seller_id=?)").get(uid, uid).n;
  const wa = db.prepare("SELECT COUNT(*) n FROM analytics_events WHERE user_id=? AND type='whatsapp' AND listing_id IN (SELECT id FROM listings WHERE seller_id=?)").get(uid, uid).n;
  // simple last-14-days views series
  const since = Math.floor((Date.now() - 14 * 86400000) / 1000);
  const series = db.prepare("SELECT date(created_at/1000,'unixepoch') d, COUNT(*) n FROM analytics_events WHERE type='listing_view' AND listing_id IN (SELECT id FROM listings WHERE seller_id=?) AND created_at/1000>=? GROUP BY d ORDER BY d").all(uid, since);
  // business totals
  const shop = db.prepare('SELECT * FROM business_profiles WHERE user_id=?').get(uid);
  let leads = null;
  if (shop) {
    leads = db.prepare(`SELECT COUNT(DISTINCT m.conversation_id) n FROM messages m
      JOIN conversations c ON c.id=m.conversation_id JOIN listings l ON l.id=c.listing_id WHERE l.shop_id=?`).get(shop.id).n;
  }
  res.json({
    counts, totals: { ...totals, messages, offers, calls, whatsapp_clicks: wa }, series,
    shop: shop ? { id: shop.id, slug: shop.slug, name: shop.shop_name, verified: !!shop.verified_at, status: shop.status } : null,
  });
});

// ---------- favorites ----------
router.get('/favorites', requireAuth, (req, res) => {
  const result = repo.listListings({
    status: ['active'], includeAll: true, sort: 'newest', limit: 200,
    // restrict to favorited via extra id list
  });
  const favs = db.prepare(`SELECT l.id FROM favorites f JOIN listings l ON l.id=f.listing_id
     WHERE f.user_id=? AND l.status='active' ORDER BY f.created_at DESC`).all(req.user.id).map((r) => r.id);
  const items = result.items.filter((i) => favs.includes(i.id)).map((i) => ({ ...i, is_favorite: true }));
  res.json({ items, total: items.length });
});

// ---------- public profile ----------
router.get('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare(`SELECT u.id,u.name,u.avatar_url,u.created_at,u.role,
      sp.display_name,sp.seller_type,sp.verified_phone,sp.verified_email,sp.verified_business,
      up.bio, up.city, l.name AS location_name, bp.slug AS shop_slug, bp.shop_name, bp.verified_at AS shop_verified
      FROM users u LEFT JOIN seller_profiles sp ON sp.user_id=u.id
      LEFT JOIN user_profiles up ON up.user_id=u.id
      LEFT JOIN locations l ON l.id=up.location_id
      LEFT JOIN business_profiles bp ON bp.user_id=u.id
      WHERE u.id=? AND u.status='active'`).get(id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const active = db.prepare("SELECT COUNT(*) n FROM listings WHERE seller_id=? AND status='active'").get(id).n;
  const sold = db.prepare("SELECT COUNT(*) n FROM listings WHERE seller_id=? AND status='sold'").get(id).n;
  const result = repo.listListings({ status: ['active'], includeAll: true, seller: id, sort: 'newest', limit: 48 });
  res.json({
    profile: {
      id: u.id, name: u.display_name || u.name, avatar: u.avatar_url, member_since: u.created_at,
      bio: u.bio || '', location: u.location_name || u.city || 'Sri Lanka',
      seller_type: u.seller_type || 'individual',
      verified_phone: !!u.verified_phone, verified_email: !!u.verified_email, verified_business: !!u.verified_business,
      active_count: active, sold_count: sold,
      shop: u.shop_slug ? { slug: u.shop_slug, name: u.shop_name, verified: !!u.shop_verified } : null,
    },
    listings: result.items,
  });
});

// ---------- image uploads (chat images etc.) ----------
router.post('/uploads', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) throw new ApiError(400, 'No image uploaded.');
  const url = saveImage(req.file.buffer, { root: UPLOAD_ROOT, kind: req.body.kind || 'messages' });
  res.status(201).json({ url });
});

// ---------- shop application ----------
router.post('/shops/apply', requireAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = str(b.shop_name, 100);
  if (name.length < 3) throw new ApiError(400, 'Enter your shop name.');
  const t = now();
  let slug = slugify(name);
  while (db.prepare('SELECT 1 FROM business_profiles WHERE slug=?').get(slug)) slug = `${slug}-${Math.floor(Math.random() * 900 + 100)}`;
  const existing = db.prepare('SELECT id FROM business_profiles WHERE user_id=?').get(req.user.id);
  const city = Number(b.location_id) || null;
  const phone = b.phone ? normalizeSLPhone(b.phone) : null;
  if (b.phone && !phone) throw new ApiError(400, 'Enter a valid shop phone number.');
  if (existing) {
    db.prepare(`UPDATE business_profiles SET shop_name=?,slug=?,description=?,location_id=?,address=?,phone=?,whatsapp=?,opening_hours=?,status='pending',updated_at=? WHERE user_id=?`)
      .run(name, slug, str(b.description, 2000), city, str(b.address, 200), phone?.e164 || null, phone?.whatsapp || null, str(b.opening_hours, 200), t, req.user.id);
  } else {
    db.prepare(`INSERT INTO business_profiles (user_id,shop_name,slug,description,location_id,address,phone,whatsapp,opening_hours,verified_at,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,NULL,'pending',?,?)`).run(req.user.id, name, slug, str(b.description, 2000), city, str(b.address, 200),
        phone?.e164 || null, phone?.whatsapp || null, str(b.opening_hours, 200), t, t);
    db.prepare("UPDATE seller_profiles SET seller_type='business', updated_at=? WHERE user_id=?").run(t, req.user.id);
  }
  db.prepare("SELECT id FROM users WHERE role='admin'").all().forEach((a) => notify(a.id, 'business_verify', 'New business verification request', name, '/admin/'));
  res.json({ ok: true, slug, message: 'Shop application submitted. Verification usually takes 1–2 business days.' });
}));

router.get('/me/shop', requireAuth, (req, res) => {
  const shop = db.prepare('SELECT * FROM business_profiles WHERE user_id=?').get(req.user.id);
  res.json({ shop: shop || null });
});

module.exports = router;
