'use strict';
const express = require('express');
const { db } = require('../db');
const repo = require('../lib/repo');
const { now, timeAgo } = require('../lib/util');
const { asyncHandler, rateLimit, str } = require('../middleware/util');
const { sendMail, layout } = require('../services/mailer');

const router = express.Router();

// ---------- blog ----------
router.get('/blog', (req, res) => {
  let rows = db.prepare('SELECT * FROM blog_posts WHERE published=1 ORDER BY created_at DESC').all();
  if (req.query.category) rows = rows.filter((r) => r.category === req.query.category);
  const categories = [...new Set(rows.map((r) => r.category))];
  res.json({
    posts: rows.map((p) => ({
      slug: p.slug, title: p.title, excerpt: p.excerpt, cover_url: p.cover_url,
      author: p.author, category: p.category, created_at: p.created_at,
      time_ago: timeAgo(Math.floor(p.created_at / 1000)),
    })),
    categories,
  });
});

router.get('/blog/:slug', (req, res) => {
  const p = db.prepare('SELECT * FROM blog_posts WHERE slug=? AND published=1').get(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Article not found.' });
  const related = db.prepare('SELECT slug,title,excerpt,cover_url,category,created_at FROM blog_posts WHERE published=1 AND id<>? ORDER BY created_at DESC LIMIT 3').all(p.id);
  res.json({ post: p, related });
});

// ---------- CMS info pages ----------
router.get('/pages/:slug', (req, res) => {
  const p = db.prepare('SELECT * FROM pages WHERE slug=?').get(req.params.slug);
  if (!p) return res.status(404).json({ error: 'Page not found.' });
  res.json({ page: p });
});

// ---------- camera shops ----------
router.get('/shops', (req, res) => {
  const rows = db.prepare(`SELECT bp.*, l.name AS city_name,
      (SELECT COUNT(*) FROM listings li WHERE li.shop_id=bp.id AND li.status='active') listings_count
      FROM business_profiles bp LEFT JOIN locations l ON l.id=bp.location_id
      WHERE bp.status='approved' ORDER BY bp.verified_at IS NOT NULL DESC, listings_count DESC`).all();
  res.json({
    shops: rows.map((s) => ({
      id: s.id, name: s.shop_name, slug: s.slug, logo: s.logo_url,
      description: s.description, city: s.city_name, opening_hours: s.opening_hours,
      verified: !!s.verified_at, listings_count: s.listings_count,
    })),
  });
});

router.get('/shops/:slug', (req, res) => {
  const s = db.prepare(`SELECT bp.*, l.name AS city_name, lp.name AS district_name, pr.name AS province_name
      FROM business_profiles bp
      LEFT JOIN locations l ON l.id=bp.location_id
      LEFT JOIN locations lp ON lp.id=l.parent_id
      LEFT JOIN locations pr ON pr.id=lp.parent_id
      WHERE bp.slug=? AND bp.status='approved'`).get(req.params.slug);
  if (!s) return res.status(404).json({ error: 'Shop not found.' });
  const result = repo.listListings({ status: ['active'], includeAll: true, sort: 'newest', limit: 100 });
  const items = result.items.filter((i) => i.shop && i.shop.slug === s.slug);
  const user = db.prepare('SELECT id,name,avatar_url FROM users WHERE id=?').get(s.user_id);
  res.json({
    shop: {
      id: s.id, user_id: s.user_id, name: s.shop_name, slug: s.slug, logo: s.logo_url,
      description: s.description, address: s.address, city: s.city_name, district: s.district_name, province: s.province_name,
      phone: s.phone, whatsapp: s.whatsapp ? '+' + s.whatsapp : null,
      whatsapp_url: s.whatsapp ? `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(`Hi ${s.shop_name}, I found you on Lanka Lens.`)}` : null,
      opening_hours: s.opening_hours, verified: !!s.verified_at, owner: user,
    },
    listings: items,
  });
});

// ---------- contact form ----------
router.post('/contact', rateLimit('contact-form', 5), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80); const email = str(b.email, 120); const message = str(b.message, 2000);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 5) {
    return res.status(400).json({ error: 'Please provide your name, a valid email and a message.' });
  }
  const s = repo.publicSettings();
  db.prepare('INSERT INTO email_outbox (to_email,subject,html,sent_at,created_at) VALUES (?,?,?,NULL,?)')
    .run(s.contact_email || 'support@lankalens.lk', `Contact form: ${name}`,
      `<p>From: ${name} &lt;${email}&gt;</p><p>${message.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`, now());
  sendMail(email, 'Thanks for contacting Lanka Lens',
    layout('We received your message', '<p>Our team will reply within one business day. Stay safe while buying and selling.</p>'));
  res.json({ ok: true, message: 'Thanks — we will get back to you soon.' });
}));

// ---------- public analytics ping ----------
router.post('/events', (req, res) => {
  const { type, listing_id } = req.body || {};
  if (['search', 'call', 'whatsapp'].includes(type)) {
    const { logEvent } = require('../middleware/util');
    logEvent(req.user?.id, type, Number(listing_id) || null, {}, req.body?.session || null);
  }
  res.json({ ok: true });
});

module.exports = router;
