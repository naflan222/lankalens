'use strict';
const express = require('express');
const path = require('node:path');
const { db } = require('../db');
const repo = require('../lib/repo');
const { now, slugify, CONDITIONS, normalizeSLPhone, whatsappLink, timeAgo } = require('../lib/util');
const { ATTRS } = require('../data/catalog');
const { requireAuth, attachUser } = require('../middleware/auth');
const { asyncHandler, ApiError, rateLimit, requireFields, str, int, notify, logEvent, audit } = require('../middleware/util');
const { saveDataUrl } = require('../services/image');

const router = express.Router();
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const DAY = 86400000;
const GROUP_BY_TOP = { cameras: 'camera', lenses: 'lens', 'action-cameras': 'action', drones: 'drone', accessories: 'accessory' };
const REPORT_REASONS = ['scam', 'fake_product', 'wrong_information', 'duplicate', 'wrong_category', 'prohibited', 'offensive', 'other'];

function settings() { return repo.publicSettings(); }

// ---------- search / list ----------
router.get('/', attachUser, (req, res) => {
  const q = req.query;
  const conditions = q.condition
    ? String(q.condition).split(',').filter((c) => CONDITIONS.includes(c))
    : undefined;
  const result = repo.listListings({
    q: q.q, cat: q.cat, leaf: q.leaf, brand: q.brand, model: q.model,
    conditions, price_min: int(q.price_min), price_max: int(q.price_max),
    location: int(q.location), seller_type: q.seller_type,
    shutter_max: int(q.shutter_max), megapixels_min: q.megapixels_min,
    flight_min: q.flight_min, batteries_min: q.batteries_min,
    resolution: q.resolution || undefined, mount: q.mount || undefined,
    focal: q.focal || undefined, aperture: q.aperture || undefined,
    sort: q.sort, page: int(q.page, 1), limit: int(q.limit, 1, 48),
    featured: q.featured === '1', userId: req.user?.id,
  });
  if (q.q) logEvent(req.user?.id, 'search', null, { q: q.q });
  res.json(result);
});

// ---------- my listings ----------
router.get('/mine', requireAuth, (req, res) => {
  const status = req.query.status || 'active';
  const allowed = ['active', 'pending', 'sold', 'expired', 'draft', 'rejected', 'suspended'];
  const list = status === 'all' ? allowed : [status];
  const result = repo.listListings({ status: list, seller: req.user.id, includeAll: true, sort: 'newest', limit: 100, userId: req.user.id });
  const counts = {};
  for (const s of allowed) {
    counts[s] = db.prepare('SELECT COUNT(*) n FROM listings WHERE seller_id=? AND status=?').get(req.user.id, s).n;
  }
  res.json({ items: result.items, counts });
});

// ---------- create ----------
function persistImages(listingId, images, maxImages) {
  const valid = (images || []).filter((im) => im && (im.full || im.url)).slice(0, maxImages);
  if (!valid.length) throw new ApiError(400, 'Add at least one photo.');
  const ins = db.prepare('INSERT INTO listing_images (listing_id,url,thumb_url,sort_order,created_at) VALUES (?,?,?,?,?)');
  valid.forEach((im, i) => {
    const url = saveDataUrl(im.full || im.url, { root: UPLOAD_ROOT, kind: 'listings' });
    const thumb = im.thumb ? saveDataUrl(im.thumb, { root: UPLOAD_ROOT, kind: 'listings' }) : url;
    ins.run(listingId, url, thumb, i, now());
  });
}

function writeListingBody(user, b, existing = null) {
  requireFields(b, ['category', 'title', 'description', 'price', 'condition', 'location']);
  const leaf = repo.categoryBySlug(b.category);
  if (!leaf || !leaf.parent_id) throw new ApiError(400, 'Choose a specific subcategory.');
  const top = repo.topCategoryFor(leaf.id);
  const group = GROUP_BY_TOP[top.slug];
  const condition = b.condition;
  if (!CONDITIONS.includes(condition)) throw new ApiError(400, 'Choose a valid condition.');
  const price = int(b.price, 0, 10 ** 9);
  if (price === undefined || (price <= 0 && !b.allow_zero)) throw new ApiError(400, 'Enter a valid price in rupees.');
  const locId = int(b.location);
  const city = str(b.city, 60);

  let brandId = null;
  let productId = null;
  if (b.brand) {
    const brand = db.prepare('SELECT * FROM brands WHERE slug=? OR name=?').get(slugify(b.brand), str(b.brand, 60));
    if (brand) brandId = brand.id;
  }
  if (b.model) {
    const prod = db.prepare('SELECT * FROM products WHERE category_id=? AND (slug=? OR name=?)').get(leaf.id, slugify(b.model), str(b.model, 120));
    if (prod) productId = prod.id;
  }

  // attribute whitelist per group
  const allowedAttrs = new Set((ATTRS[group] || []).map((a) => a.k));
  const attrs = {};
  for (const [k, v] of Object.entries(b.attributes || {})) {
    if (allowedAttrs.has(k) && v !== '' && v !== null && v !== undefined) attrs[k] = str(v, 120);
  }
  // accessory group stores free-text brand/model as attrs too
  if (group === 'accessory') {
    if (b.attrBrand) attrs.brand = str(b.attrBrand, 60);
    if (b.attrModel) attrs.model = str(b.attrModel, 120);
  }

  const sp = db.prepare('SELECT * FROM seller_profiles WHERE user_id=?').get(user.id);
  let phone = b.contact_phone === '' ? null : (b.contact_phone || sp?.contact_phone || user.phone);
  let wa = b.whatsapp_number === '' ? null : (b.whatsapp_number || sp?.whatsapp_number);
  if (phone) {
    const p = normalizeSLPhone(phone);
    if (!p) throw new ApiError(400, 'Invalid contact phone number.');
    phone = p.e164;
  }
  if (wa) {
    const p = normalizeSLPhone(wa);
    if (!p) throw new ApiError(400, 'Invalid WhatsApp number.');
    wa = p.whatsapp;
  }

  const data = {
    leaf, brandId, productId, attrs, group,
    title: str(b.title, 140), description: str(b.description, 8000),
    price, condition, locId, city,
    negotiable: b.negotiable === false ? 0 : 1,
    warranty: str(b.warranty, 80) || 'No warranty',
    receipt: b.receipt_available === true || b.receipt_available === 'Yes' || b.receipt_available === '1' ? 1 : 0,
    reason: str(b.reason_selling, 300),
    phone, wa,
    calls: b.calls_enabled === false ? 0 : 1, whatsappEn: b.whatsapp_enabled === false ? 0 : 1, chatEn: b.chat_enabled === false ? 0 : 1,
  };
  return data;
}

router.post('/', requireAuth, rateLimit('post', 20, 600000), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.status === 'draft' && b.category) {
    if (!b.location) {
      const fallback = db.prepare("SELECT id FROM locations WHERE level='city' ORDER BY id LIMIT 1").get();
      if (fallback) b.location = fallback.id;
    }
    b.condition = b.condition || 'good';
    b.price = b.price || 0;
    b.allow_zero = true;
    b.description = b.description || 'Draft listing — complete the details before publishing.';
  }
  const d = writeListingBody(req.user, b);
  const maxImages = settings().max_images_per_listing || 10;
  if (!(b.images || []).length && b.status !== 'draft') throw new ApiError(400, 'Add at least one photo.');

  const t = now();
  const requireApproval = settings().listings_require_approval;
  const status = b.status === 'draft' ? 'draft' : (requireApproval ? 'pending' : 'active');
  let slugBase = slugify(d.productId ? (db.prepare('SELECT p.name pn, br.name bn FROM products p JOIN brands br ON br.id=p.brand_id WHERE p.id=?').get(d.productId)?.bn + ' ' + db.prepare('SELECT name FROM products WHERE id=?').get(d.productId)?.name) : d.title);
  if (!slugBase) slugBase = 'listing';
  let slug = `${slugBase}-${10000 + Math.floor(Math.random() * 89999)}`;
  while (db.prepare('SELECT 1 FROM listings WHERE slug=?').get(slug)) slug = `${slugBase}-${10000 + Math.floor(Math.random() * 89999)}`;

  const info = db.prepare(
    `INSERT INTO listings (slug,seller_id,shop_id,category_id,brand_id,product_id,title,description,price,negotiable,condition,status,
       location_id,city,contact_phone,whatsapp_number,calls_enabled,whatsapp_enabled,chat_enabled,warranty,receipt_available,reason_selling,
       expires_at,submitted_at,approved_at,created_at,updated_at)
     VALUES (?,?,(SELECT id FROM business_profiles WHERE user_id=? AND verified_at IS NOT NULL AND status='approved'),
       ?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    slug, req.user.id, req.user.id,
    d.leaf.id, d.brandId, d.productId, d.title, d.description, d.price,
    d.condition, status,
    d.locId, d.city, d.phone, d.wa, d.calls, d.whatsappEn, d.chatEn,
    d.warranty, d.receipt, d.reason,
    status === 'active' ? t + 60 * DAY : null,
    status === 'draft' ? null : t,
    status === 'active' ? t : null,
    t, t
  );
  const id = Number(info.lastInsertRowid);
  // attach shop if seller has one
  const shop = db.prepare("SELECT id FROM business_profiles WHERE user_id=? AND status='approved'").get(req.user.id);
  if (shop) db.prepare('UPDATE listings SET shop_id=? WHERE id=?').run(shop.id, id);
  for (const [k, v] of Object.entries(d.attrs)) db.prepare('INSERT OR REPLACE INTO listing_attributes (listing_id,k,v) VALUES (?,?,?)').run(id, k, v);
  if (b.images && b.images.length) persistImages(id, b.images, maxImages);

  logEvent(req.user.id, 'listing_create', id, { status });
  if (status === 'pending') {
    const admins = db.prepare("SELECT id FROM users WHERE role='admin'").all();
    admins.forEach((a) => notify(a.id, 'moderation', 'New listing awaiting review', d.title, `/admin/`, { listingId: id }));
  } else if (status === 'active') {
    notify(req.user.id, 'listing_approved', 'Your listing is live', d.title, `/listing/${slug}`);
  }
  const row = repo.getListing({ id });
  res.status(201).json({ listing: repo.fullListing(row, { userId: req.user.id }), status,
    message: status === 'draft' ? 'Draft saved.' : (requireApproval ? 'Listing submitted. Our team will review it shortly.' : 'Listing published.') });
}));

// ---------- detail ----------
router.get('/:ref', attachUser, (req, res) => {
  const ref = req.params.ref;
  const row = /^\d+$/.test(ref) ? repo.getListing({ id: Number(ref) }) : repo.getListing({ slug: ref });
  if (!row) return res.status(404).json({ error: 'Listing not found.' });
  const ownerOrAdmin = req.user && (req.user.id === row.seller_id || req.user.role === 'admin');
  if (row.status !== 'active' && !ownerOrAdmin) return res.status(404).json({ error: 'Listing not found.' });
  if (row.status === 'active' && (!req.user || req.user.id !== row.seller_id)) {
    db.prepare('UPDATE listings SET views=views+1 WHERE id=?').run(row.id);
    row.views += 1;
    logEvent(req.user?.id, 'listing_view', row.id, {}, req.get('x-session') || null);
  }
  const full = repo.fullListing(row, { userId: req.user?.id });
  full.time_ago = timeAgo(Math.floor(row.created_at / 1000));
  full.related = repo.relatedListings(row, req.query.related === '0' ? 0 : 6);
  full.seller.listings_count = db.prepare("SELECT COUNT(*) n FROM listings WHERE seller_id=? AND status='active'").get(row.seller_id).n;
  full.seller.member_since = db.prepare('SELECT created_at FROM users WHERE id=?').get(row.seller_id).created_at;
  // WhatsApp link with a prefilled message (per-seller number, never hard-coded)
  if (full.contact.whatsapp) {
    full.contact.whatsapp_url = whatsappLink(full.contact.whatsapp.replace('+', ''),
      `Hi, is your "${full.title}" (${full.price_formatted}) listed on Lanka Lens still available?`);
  }
  full.contact.tel_url = full.contact.phone ? `tel:${full.contact.phone}` : null;
  // hide raw numbers when seller disabled channel
  if (!full.contact.calls_enabled) { full.contact.phone = null; full.contact.tel_url = null; }
  if (!full.contact.whatsapp_enabled) { full.contact.whatsapp = null; full.contact.whatsapp_url = null; }
  res.json({ listing: full });
});

// ---------- update ----------
router.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM listings WHERE id=?').get(id);
  if (!row) throw new ApiError(404, 'Listing not found.');
  if (row.seller_id !== req.user.id && req.user.role !== 'admin') throw new ApiError(403, 'Not your listing.');
  const b = req.body || {};
  const t = now();

  if (b.images && Array.isArray(b.images)) {
    // Replace image set: keep existing URLs that are referenced, then add new data URLs
    db.prepare('DELETE FROM listing_images WHERE listing_id=?').run(id);
    const maxImages = settings().max_images_per_listing || 10;
    const list = b.images.slice(0, maxImages);
    const ins = db.prepare('INSERT INTO listing_images (listing_id,url,thumb_url,sort_order,created_at) VALUES (?,?,?,?,?)');
    list.forEach((im, i) => {
      if (typeof im === 'string' && im.startsWith('/uploads/')) ins.run(id, im, im, i, t);
      else if (im.full && String(im.full).startsWith('/uploads/')) ins.run(id, im.full, im.thumb || im.full, i, t);
      else if (im.full) {
        const url = saveDataUrl(im.full, { root: UPLOAD_ROOT, kind: 'listings' });
        const thumb = im.thumb ? saveDataUrl(im.thumb, { root: UPLOAD_ROOT, kind: 'listings' }) : url;
        ins.run(id, url, thumb, i, t);
      }
    });
    if (!db.prepare('SELECT COUNT(*) n FROM listing_images WHERE listing_id=?').get(id).n) throw new ApiError(400, 'Add at least one photo.');
  }

  if (b.title || b.price !== undefined || b.category || b.attributes || b.condition) {
    const curCat = db.prepare('SELECT slug FROM categories WHERE id=?').get(row.category_id)?.slug;
    const curBrand = db.prepare('SELECT slug FROM brands WHERE id=?').get(row.brand_id)?.slug;
    const curModel = db.prepare('SELECT slug FROM products WHERE id=?').get(row.product_id)?.slug;
    const d = writeListingBody(req.user, {
      category: b.category || curCat,
      title: b.title || row.title, description: b.description ?? row.description, price: b.price ?? row.price,
      condition: b.condition || row.condition, location: b.location || row.location_id, city: b.city ?? row.city,
      brand: b.brand ?? curBrand, model: b.model ?? curModel,
      attributes: b.attributes, warranty: b.warranty ?? row.warranty, receipt_available: b.receipt_available ?? row.receipt_available,
      reason_selling: b.reason_selling ?? row.reason_selling, negotiable: b.negotiable ?? row.negotiable,
    });
    const reApproval = row.status === 'active' && (b.price !== undefined || b.title);
    const newStatus = b.status || (reApproval && settings().listings_require_approval ? 'pending' : row.status);
    db.prepare(`UPDATE listings SET category_id=?,brand_id=?,product_id=?,title=?,description=?,price=?,condition=?,status=?,
        location_id=?,city=?,warranty=?,receipt_available=?,reason_selling=?,negotiable=?,updated_at=?,
        submitted_at=COALESCE(submitted_at,?), rejection_reason=NULL WHERE id=?`)
      .run(d.leaf.id, d.brandId, d.productId, d.title, d.description, d.price, d.condition, newStatus,
        d.locId, d.city, d.warranty, d.receipt, d.reason, d.negotiable ? 1 : 0, t, t, id);
    db.prepare('DELETE FROM listing_attributes WHERE listing_id=?').run(id);
    for (const [k, v] of Object.entries(d.attrs)) db.prepare('INSERT OR REPLACE INTO listing_attributes (listing_id,k,v) VALUES (?,?,?)').run(id, k, v);
    if (newStatus === 'pending') {
      db.prepare("SELECT id FROM users WHERE role='admin'").all().forEach((a) => notify(a.id, 'moderation', 'Updated listing re-submitted', d.title, '/admin/', { listingId: id }));
    }
  }
  const fresh = repo.getListing({ id });
  res.json({ listing: repo.fullListing(fresh, { userId: req.user.id }) });
}));

// ---------- lifecycle actions ----------
router.post('/:id/actions', requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM listings WHERE id=?').get(id);
  if (!row) throw new ApiError(404, 'Listing not found.');
  if (row.seller_id !== req.user.id && req.user.role !== 'admin') throw new ApiError(403, 'Not your listing.');
  const { action } = req.body || {};
  const t = now();
  let message = 'Done.';
  switch (action) {
    case 'submit': {
      if (!['draft', 'rejected', 'expired'].includes(row.status)) throw new ApiError(400, 'Cannot submit this listing.');
      const imgCount = db.prepare('SELECT COUNT(*) n FROM listing_images WHERE listing_id=?').get(id).n;
      if (!imgCount) throw new ApiError(400, 'Add at least one photo before submitting.');
      break;
    }
      db.prepare("UPDATE listings SET status='pending', submitted_at=?, rejection_reason=NULL, expires_at=NULL, updated_at=? WHERE id=?").run(t, t, id);
      db.prepare("SELECT id FROM users WHERE role='admin'").all().forEach((a) => notify(a.id, 'moderation', 'Listing submitted for review', row.title, '/admin/', { listingId: id }));
      message = 'Submitted for review.'; break;
    case 'pause':
    case 'suspend-owner':
      db.prepare("UPDATE listings SET status='suspended', updated_at=? WHERE id=?").run(t, id); message = 'Listing paused.'; break;
    case 'activate':
      db.prepare("UPDATE listings SET status='active', approved_at=COALESCE(approved_at,?), expires_at=?, updated_at=? WHERE id=?").run(t, t + 60 * DAY, t, id);
      message = 'Listing reactivated.'; break;
    case 'sold':
      db.prepare("UPDATE listings SET status='sold', sold_at=?, updated_at=? WHERE id=?").run(t, t, id);
      db.prepare('INSERT OR IGNORE INTO favorites (user_id,listing_id,created_at) SELECT 0, id, ? FROM listings WHERE 0').run(t);
      logEvent(req.user.id, 'listing_sold', id);
      // notify users who favourited
      db.prepare('SELECT user_id FROM favorites WHERE listing_id=?').all(id).forEach((f) =>
        notify(f.user_id, 'listing_sold', 'A saved listing was sold', row.title, `/listing/${row.slug}`));
      message = 'Marked as sold. Congratulations!'; break;
    case 'renew':
      if (!['expired', 'active'].includes(row.status)) throw new ApiError(400, 'Only active or expired listings can be renewed.');
      db.prepare("UPDATE listings SET status='active', expires_at=?, updated_at=? WHERE id=?").run(t + 60 * DAY, t, id);
      message = 'Listing renewed for 60 days.'; break;
    case 'republish':
      if (row.status !== 'sold') throw new ApiError(400, 'Only sold listings can be republished.');
      db.prepare("UPDATE listings SET status='pending', sold_at=NULL, submitted_at=?, updated_at=? WHERE id=?").run(t, t, id);
      message = 'Resubmitted for review.'; break;
    default:
      throw new ApiError(400, 'Unknown action.');
  }
  audit(req.user.role === 'admin' ? req.user : { id: req.user.id }, `listing_${action}`, 'listing', id, {});
  res.json({ ok: true, status: db.prepare('SELECT status FROM listings WHERE id=?').get(id).status, message });
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM listings WHERE id=?').get(id);
  if (!row) throw new ApiError(404, 'Listing not found.');
  if (row.seller_id !== req.user.id && req.user.role !== 'admin') throw new ApiError(403, 'Not your listing.');
  db.prepare('DELETE FROM listings WHERE id=?').run(id);
  res.json({ ok: true, message: 'Listing deleted.' });
}));

// ---------- favorite ----------
router.post('/:id/favorite', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM listings WHERE id=?').get(id);
  if (!row) throw new ApiError(404, 'Listing not found.');
  const existing = db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND listing_id=?').get(req.user.id, id);
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE user_id=? AND listing_id=?').run(req.user.id, id);
    db.prepare('UPDATE listings SET favorite_count=MAX(0,favorite_count-1) WHERE id=?').run(id);
    logEvent(req.user.id, 'favorite_remove', id);
    return res.json({ favorited: false });
  }
  db.prepare('INSERT INTO favorites (user_id,listing_id,created_at) VALUES (?,?,?)').run(req.user.id, id, now());
  db.prepare('UPDATE listings SET favorite_count=favorite_count+1 WHERE id=?').run(id);
  logEvent(req.user.id, 'favorite', id);
  res.json({ favorited: true });
});

// ---------- report ----------
router.post('/:id/report', attachUser, rateLimit('report', 8), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id,title,seller_id FROM listings WHERE id=?').get(id);
  if (!row) throw new ApiError(404, 'Listing not found.');
  const reason = req.body?.reason;
  if (!REPORT_REASONS.includes(reason)) throw new ApiError(400, 'Choose a reason.');
  if (row.seller_id === req.user?.id) throw new ApiError(400, 'You cannot report your own listing.');
  db.prepare('INSERT INTO reports (reporter_id,target_type,target_id,reason,details,status,created_at) VALUES (?, \'listing\', ?, ?, ?, \'open\', ?)')
    .run(req.user?.id || null, id, reason, str(req.body?.details, 1000), now());
  db.prepare("SELECT id FROM users WHERE role='admin'").all().forEach((a) =>
    notify(a.id, 'report', 'New report on a listing', `${reason}: ${row.title}`, '/admin/reports'));
  res.json({ ok: true, message: 'Thanks — our moderation team will review this report.' });
});

// ---------- offer ----------
router.post('/:id/offer', requireAuth, rateLimit('offer', 20), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM listings WHERE id=? AND status=?').get(id, 'active');
  if (!row) throw new ApiError(404, 'Listing not found.');
  if (row.seller_id === req.user.id) throw new ApiError(400, 'You cannot make an offer on your own listing.');
  const amount = int(req.body?.amount, 100, row.price * 2);
  if (!amount) throw new ApiError(400, 'Enter a valid offer amount.');
  const t = now();
  const conv = findOrCreateConversation(row, req.user.id, t);
  const info = db.prepare(
    `INSERT INTO offers (conversation_id,listing_id,buyer_id,seller_id,amount,currency,status,message,created_at,updated_at)
     VALUES (?,?,?,?,?, 'LKR', 'pending', ?, ?, ?)`
  ).run(conv.id, id, req.user.id, row.seller_id, amount, str(req.body?.message, 500), t, t);
  const offerId = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO messages (conversation_id,sender_id,body,offer_id,created_at) VALUES (?,?,?, ?,?)')
    .run(conv.id, req.user.id, `Made an offer of Rs. ${amount.toLocaleString('en-US')}`, offerId, t);
  db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(t, conv.id);
  notify(row.seller_id, 'offer', `New offer: Rs. ${amount.toLocaleString('en-US')}`, `For ${row.title}`, `/chat/?c=${conv.id}`, { listingId: id, offerId });
  res.status(201).json({ ok: true, conversation_id: conv.id, offer_id: offerId });
});

function findOrCreateConversation(listing, buyerId, t) {
  const existing = db.prepare('SELECT * FROM conversations WHERE listing_id=? AND buyer_id=?').get(listing.id, buyerId);
  if (existing) return existing;
  const info = db.prepare('INSERT INTO conversations (listing_id,buyer_id,seller_id,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(listing.id, buyerId, listing.seller_id, t, t);
  return db.prepare('SELECT * FROM conversations WHERE id=?').get(Number(info.lastInsertRowid));
}

// ---------- contact tracking ----------
router.post('/:id/contact', attachUser, rateLimit('contact', 40), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id,title,contact_phone,whatsapp_number,calls_enabled,whatsapp_enabled,seller_id FROM listings WHERE id=?').get(id);
  if (!row) throw new ApiError(404, 'Listing not found.');
  const type = ['call', 'whatsapp', 'chat'].includes(req.body?.type) ? req.body.type : null;
  if (!type) throw new ApiError(400, 'Bad contact type.');
  logEvent(req.user?.id, type, id);
  if (type === 'chat') {
    const t = now();
    const conv = findOrCreateConversation(row, req.user?.id || 0, t);
    return res.json({ ok: true, conversation_id: conv.id });
  }
  if (type === 'whatsapp' && row.whatsapp_enabled && row.whatsapp_number) {
    return res.json({ ok: true, url: whatsappLink(row.whatsapp_number,
      `Hi, is your "${row.title}" listed on Lanka Lens still available?`) });
  }
  if (type === 'call' && row.calls_enabled && row.contact_phone) {
    return res.json({ ok: true, url: `tel:${row.contact_phone}` });
  }
  throw new ApiError(400, 'This contact method is not enabled for the listing.');
});

module.exports = { router, findOrCreateConversation };
