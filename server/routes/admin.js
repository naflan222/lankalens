'use strict';
const express = require('express');
const { db } = require('../db');
const repo = require('../lib/repo');
const { now, slugify } = require('../lib/util');
const { requireAdmin } = require('../middleware/auth');
const { asyncHandler, ApiError, str, audit, notify } = require('../middleware/util');
const { ATTRS } = require('../data/catalog');

const router = express.Router();
router.use(requireAdmin);

// ---------- dashboard ----------
router.get('/stats', (_req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p).n;
  const stats = {
    users: one('SELECT COUNT(*) n FROM users'),
    sellers: one("SELECT COUNT(*) n FROM seller_profiles WHERE seller_type='individual'"),
    businesses: one("SELECT COUNT(*) n FROM business_profiles WHERE status='approved'"),
    shops_pending: one("SELECT COUNT(*) n FROM business_profiles WHERE status='pending'"),
    listings_total: one('SELECT COUNT(*) n FROM listings'),
    listings_active: one("SELECT COUNT(*) n FROM listings WHERE status='active'"),
    listings_pending: one("SELECT COUNT(*) n FROM listings WHERE status='pending'"),
    listings_sold: one("SELECT COUNT(*) n FROM listings WHERE status='sold'"),
    listings_expired: one("SELECT COUNT(*) n FROM listings WHERE status='expired'"),
    listings_rejected: one("SELECT COUNT(*) n FROM listings WHERE status='rejected'"),
    reports_open: one("SELECT COUNT(*) n FROM reports WHERE status='open'"),
    promotions: one('SELECT COUNT(*) n FROM promotions'),
    revenue: one("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status='successful'"),
    views: one('SELECT COALESCE(SUM(views),0) n FROM listings'),
    messages: one('SELECT COUNT(*) n FROM messages'),
  };
  const sevenDaysAgo = now() - 7 * 86400000;
  stats.signups_7d = one('SELECT COUNT(*) n FROM users WHERE created_at>=?', sevenDaysAgo);
  stats.listings_7d = one('SELECT COUNT(*) n FROM listings WHERE created_at>=?', sevenDaysAgo);
  const latestListings = repo.listListings({ includeAll: true, sort: 'newest', limit: 8 }).items;
  res.json({ stats, latest_listings: latestListings });
});

// ---------- listings queue / all ----------
router.get('/listings', (req, res) => {
  const status = req.query.status || 'pending';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 30;
  const where = [];
  const params = [];
  if (status !== 'all') {
    where.push('l.status=?'); params.push(status);
  }
  if (req.query.q) { where.push('l.title LIKE ?'); params.push(`%${req.query.q}%`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM listings l ${whereSql}`).get(...params).n;
  const rows = db.prepare(`SELECT l.*, u.name seller_name, b.name brand_name, c.name category_name
      FROM listings l JOIN users u ON u.id=l.seller_id
      LEFT JOIN brands b ON b.id=l.brand_id JOIN categories c ON c.id=l.category_id
      ${whereSql} ORDER BY l.updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  res.json({ items: rows.map((r) => ({ ...r, price_formatted: 'Rs. ' + Number(r.price).toLocaleString('en-US') })), total, page, pages: Math.ceil(total / limit) });
});

// ---------- moderation ----------
router.post('/listings/:id/moderate', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM listings WHERE id=?').get(id);
  if (!row) throw new ApiError(404, 'Listing not found.');
  const { decision } = req.body || {};
  const reason = str(req.body?.reason, 600);
  const t = now();
  switch (decision) {
    case 'approve':
      db.prepare("UPDATE listings SET status='active', approved_at=?, expires_at=?, rejection_reason=NULL, updated_at=? WHERE id=?")
        .run(t, t + 60 * 86400000, t, id);
      notify(row.seller_id, 'listing_approved', 'Your listing was approved', row.title, `/listing/${row.slug}`);
      audit(req.user, 'listing_approve', 'listing', id, { title: row.title });
      return res.json({ ok: true, message: 'Listing approved and published.' });
    case 'reject':
    case 'changes': {
      if (!reason) throw new ApiError(400, 'A reason is required when rejecting or requesting changes.');
      db.prepare("UPDATE listings SET status='rejected', rejection_reason=?, updated_at=? WHERE id=?").run(reason, t, id);
      notify(row.seller_id, decision === 'changes' ? 'listing_changes_requested' : 'listing_rejected',
        decision === 'changes' ? 'Changes requested on your listing' : 'Your listing was rejected', reason, `/my-ads/?edit=${id}`);
      audit(req.user, decision === 'changes' ? 'listing_changes' : 'listing_reject', 'listing', id, { reason });
      return res.json({ ok: true, message: decision === 'changes' ? 'Change request sent to seller.' : 'Listing rejected.' });
    }
    case 'suspend':
      db.prepare("UPDATE listings SET status='suspended', updated_at=? WHERE id=?").run(t, id);
      notify(row.seller_id, 'listing_suspended', 'Your listing was suspended', reason || 'It violated a marketplace policy.', `/listing/${row.slug}`);
      audit(req.user, 'listing_suspend', 'listing', id, { reason });
      return res.json({ ok: true, message: 'Listing suspended.' });
    case 'feature':
      db.prepare('UPDATE listings SET is_featured=1, featured_until=? WHERE id=?').run(t + 7 * 86400000, id);
      audit(req.user, 'listing_feature', 'listing', id);
      return res.json({ ok: true, message: 'Listing featured for 7 days.' });
    case 'unfeature':
      db.prepare('UPDATE listings SET is_featured=0, featured_until=NULL WHERE id=?').run(id);
      audit(req.user, 'listing_unfeature', 'listing', id);
      return res.json({ ok: true, message: 'Feature removed.' });
    case 'sold':
      db.prepare("UPDATE listings SET status='sold', sold_at=?, updated_at=? WHERE id=?").run(t, t, id);
      audit(req.user, 'listing_mark_sold', 'listing', id);
      return res.json({ ok: true, message: 'Marked sold.' });
    case 'delete':
      db.prepare('DELETE FROM listings WHERE id=?').run(id);
      audit(req.user, 'listing_delete', 'listing', id, { title: row.title });
      return res.json({ ok: true, message: 'Listing deleted.' });
    default:
      throw new ApiError(400, 'Unknown decision.');
  }
}));

// ---------- reports ----------
router.get('/reports', (req, res) => {
  const status = req.query.status || 'open';
  const rows = db.prepare(`SELECT r.*, u.name reporter_name,
      CASE WHEN r.target_type='listing' THEN (SELECT title FROM listings WHERE id=r.target_id) ELSE (SELECT name FROM users WHERE id=r.target_id) END target_title
      FROM reports r LEFT JOIN users u ON u.id=r.reporter_id
      WHERE (?='all' OR r.status=?) ORDER BY r.created_at DESC`).all(status, status);
  res.json({ reports: rows });
});
router.post('/reports/:id', (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(id);
  if (!r) throw new ApiError(404, 'Report not found.');
  const decision = req.body?.decision === 'dismiss' ? 'dismissed' : 'resolved';
  db.prepare('UPDATE reports SET status=?, admin_note=?, resolved_at=? WHERE id=?')
    .run(decision, str(req.body?.note, 500), now(), id);
  if (r.target_type === 'listing' && req.body?.remove) {
    db.prepare('DELETE FROM listings WHERE id=?').run(r.target_id);
    audit(req.user, 'listing_delete_via_report', 'listing', r.target_id, { report: id });
  }
  audit(req.user, `report_${decision}`, 'report', id);
  res.json({ ok: true, message: `Report ${decision}.` });
});

// ---------- users ----------
router.get('/users', (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.name,u.email,u.phone,u.role,u.status,u.created_at,u.email_verified_at,u.phone_verified_at,
      sp.seller_type, sp.verified_business,
      (SELECT COUNT(*) FROM listings l WHERE l.seller_id=u.id) listings_count
      FROM users u LEFT JOIN seller_profiles sp ON sp.user_id=u.id
      WHERE (?='' OR u.name LIKE ? OR u.email LIKE ?) ORDER BY u.id DESC LIMIT 100`)
    .all(req.query.q || '', `%${req.query.q || ''}%`, `%${req.query.q || ''}%`);
  res.json({ users: rows });
});
router.post('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) throw new ApiError(404, 'User not found.');
  const { action } = req.body || {};
  const t = now();
  if (action === 'suspend') { db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(id); audit(req.user, 'user_suspend', 'user', id); }
  else if (action === 'activate') { db.prepare("UPDATE users SET status='active' WHERE id=?").run(id); audit(req.user, 'user_activate', 'user', id); }
  else if (action === 'make_admin') { db.prepare("UPDATE users SET role='admin' WHERE id=?").run(id); audit(req.user, 'user_make_admin', 'user', id); }
  else if (action === 'verify_business') {
    db.prepare('UPDATE seller_profiles SET verified_business=1 WHERE user_id=?').run(id);
    db.prepare("UPDATE business_profiles SET verified_at=?, status='approved' WHERE user_id=?").run(t, id);
    audit(req.user, 'business_verify', 'user', id);
  } else throw new ApiError(400, 'Unknown action.');
  notify(id, 'account', 'Your account status changed', `An administrator applied: ${action.replace('_', ' ')}`, '/profile');
  res.json({ ok: true });
});

// ---------- catalog management ----------
router.post('/categories', (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) throw new ApiError(400, 'Category name required.');
  let parentId = null; let group = 'accessory'; let icon = 'pricetag-outline';
  if (req.body?.parent_slug) {
    const parent = repo.categoryBySlug(req.body.parent_slug);
    if (!parent) throw new ApiError(404, 'Parent category not found.');
    parentId = parent.parent_id ? parent.id : parent.id;
    const top = repo.topCategoryFor(parentId);
    group = { cameras: 'camera', lenses: 'lens', 'action-cameras': 'action', drones: 'drone' }[top.slug] || 'accessory';
  } else {
    group = req.body?.group || 'accessory';
  }
  let slug = slugify(name);
  while (db.prepare('SELECT 1 FROM categories WHERE slug=?').get(slug)) slug += '-' + Math.floor(Math.random() * 900 + 100);
  const info = db.prepare('INSERT INTO categories (name,slug,parent_id,icon,color,sort_order) VALUES (?,?,?,?,?, (SELECT COALESCE(MAX(sort_order)+1,0) FROM categories))')
    .run(name, slug, parentId, req.body?.icon || icon, req.body?.color || 'blue');
  audit(req.user, 'category_create', 'category', Number(info.lastInsertRowid), { name });
  res.status(201).json({ ok: true, slug });
});
router.delete('/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const inUse = db.prepare('SELECT COUNT(*) n FROM listings WHERE category_id=?').get(id).n;
  if (inUse) throw new ApiError(400, 'Category has listings and cannot be deleted.');
  db.prepare('DELETE FROM categories WHERE id=?').run(id);
  audit(req.user, 'category_delete', 'category', id);
  res.json({ ok: true });
});
router.post('/brands', (req, res) => {
  const name = str(req.body?.name, 60);
  if (!name) throw new ApiError(400, 'Brand name required.');
  const slug = slugify(name);
  if (db.prepare('SELECT 1 FROM brands WHERE slug=?').get(slug)) return res.json({ ok: true, slug });
  const info = db.prepare('INSERT INTO brands (name,slug,scope,sort_order) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order)+1,0) FROM brands))')
    .run(name, slug, req.body?.scope || 'accessory');
  audit(req.user, 'brand_create', 'brand', Number(info.lastInsertRowid), { name });
  res.status(201).json({ ok: true, slug });
});
router.post('/products', (req, res) => {
  const cat = repo.categoryBySlug(req.body?.category);
  const brand = db.prepare('SELECT * FROM brands WHERE slug=? OR name=?').get(slugify(req.body?.brand || ''), str(req.body?.brand, 60));
  const name = str(req.body?.name, 120);
  if (!cat || !cat.parent_id || !brand || !name) throw new ApiError(400, 'Subcategory, brand and model name are required.');
  const pslug = slugify(name);
  const info = db.prepare('INSERT OR IGNORE INTO products (category_id,brand_id,name,slug,sort_order) VALUES (?,?,?,?,(SELECT COALESCE(MAX(sort_order)+1,0) FROM products WHERE category_id=?))')
    .run(cat.id, brand.id, name, pslug, cat.id);
  audit(req.user, 'product_create', 'product', Number(info.lastInsertRowid), { name });
  res.status(201).json({ ok: true });
});
router.post('/locations', (req, res) => {
  const name = str(req.body?.name, 60);
  const level = ['province', 'district', 'city'].includes(req.body?.level) ? req.body.level : null;
  if (!name || !level) throw new ApiError(400, 'Name and valid level required.');
  const parent = req.body?.parent_id ? Number(req.body.parent_id) : null;
  let slug = slugify(name);
  while (db.prepare('SELECT 1 FROM locations WHERE slug=?').get(slug)) slug += '-' + Math.floor(Math.random() * 900 + 100);
  const info = db.prepare('INSERT INTO locations (parent_id,level,name,slug,sort_order) VALUES (?,?,?,?,(SELECT COALESCE(MAX(sort_order)+1,0) FROM locations))')
    .run(parent, level, name, slug);
  audit(req.user, 'location_create', 'location', Number(info.lastInsertRowid), { name });
  res.status(201).json({ ok: true });
});

// ---------- settings & packages ----------
router.get('/settings', (_req, res) => {
  res.json({
    settings: repo.publicSettings(),
    packages: db.prepare('SELECT * FROM promotion_packages ORDER BY sort_order').all(),
  });
});
router.put('/settings', (req, res) => {
  const t = now();
  for (const [key, value] of Object.entries(req.body?.settings || {})) {
    db.prepare(`INSERT INTO site_settings (key,value_json,updated_at,updated_by) VALUES (?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
      .run(key, JSON.stringify(value), t, req.user.id);
  }
  audit(req.user, 'settings_update', 'settings', null, { keys: Object.keys(req.body?.settings || {}) });
  res.json({ ok: true, settings: repo.publicSettings() });
});
router.post('/packages', (req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO promotion_packages (key,name,description,kind,days,price_lkr,active,sort_order) VALUES (?,?,?,?,?,?,1,(SELECT COALESCE(MAX(sort_order)+1,0) FROM promotion_packages))')
    .run(slugify(b.key || b.name), str(b.name, 80), str(b.description, 200), b.kind === 'boost' ? 'boost' : 'featured',
      Number(b.days) || 7, Number(b.price_lkr) || 0);
  audit(req.user, 'package_create', 'promotion_package', Number(info.lastInsertRowid));
  res.status(201).json({ ok: true });
});

// ---------- audit log ----------
router.get('/audit', (_req, res) => {
  const rows = db.prepare(`SELECT a.*, u.name admin_name FROM audit_logs a LEFT JOIN users u ON u.id=a.admin_id
      ORDER BY a.id DESC LIMIT 200`).all();
  res.json({ logs: rows });
});

// ---------- dev email outbox (admin only) ----------
router.get('/outbox', (_req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'Disabled in production.' });
  res.json({ emails: db.prepare('SELECT id,to_email,subject,html,created_at FROM email_outbox ORDER BY id DESC LIMIT 30').all() });
});

module.exports = router;
