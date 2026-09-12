'use strict';
// Data-access layer. All SQL is parameterised; route handlers never build SQL.
const { db } = require('../db');

// ---------- categories ----------
function categoryTree() {
  const rows = db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
  const byId = Object.fromEntries(rows.map((r) => [r.id, { ...r, filters: r.filters_json ? JSON.parse(r.filters_json) : null, children: [] }]));
  const roots = [];
  for (const r of rows) {
    const node = byId[r.id];
    if (r.parent_id) byId[r.parent_id].children.push(node);
    else roots.push(node);
  }
  return roots;
}

function categoryBySlug(slug) {
  return db.prepare('SELECT * FROM categories WHERE slug=?').get(slug) || null;
}
function topCategoryFor(catId) {
  let c = db.prepare('SELECT * FROM categories WHERE id=?').get(catId);
  if (!c) return null;
  while (c.parent_id) c = db.prepare('SELECT * FROM categories WHERE id=?').get(c.parent_id);
  return c;
}
function leafIdsOf(catId) {
  const c = db.prepare('SELECT id,parent_id FROM categories WHERE id=?').get(catId);
  if (!c) return [];
  if (!c.parent_id) {
    return db.prepare('SELECT id FROM categories WHERE parent_id=?').all(catId).map((r) => r.id);
  }
  return [catId];
}
function brandsForCategory(catId) {
  const ids = leafIdsOf(catId);
  const place = ids.map(() => '?').join(',');
  return db.prepare(
    `SELECT DISTINCT b.* FROM brands b
     JOIN category_brands cb ON cb.brand_id=b.id
     WHERE cb.category_id IN (${place}) ORDER BY b.sort_order, b.name`
  ).all(...ids);
}
function productsFor(leafId, brandId = null) {
  const q = brandId
    ? db.prepare('SELECT * FROM products WHERE category_id=? AND brand_id=? ORDER BY sort_order,name')
    : db.prepare('SELECT * FROM products WHERE category_id=? ORDER BY sort_order,name');
  return brandId ? q.all(leafId, brandId) : q.all(leafId);
}

// ---------- locations ----------
function locationTree() {
  const rows = db.prepare('SELECT * FROM locations ORDER BY sort_order, name').all();
  const byId = Object.fromEntries(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const r of rows) {
    const node = byId[r.id];
    if (r.parent_id) byId[r.parent_id].children.push(node);
    else roots.push(node);
  }
  return roots;
}
function locationDescendants(id) {
  const out = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    const kids = db.prepare(`SELECT id FROM locations WHERE parent_id IN (${[...out].map(() => '?').join(',')})`)
      .all(...out).map((r) => r.id);
    for (const k of kids) if (!out.has(k)) { out.add(k); changed = true; }
  }
  return [...out];
}

// ---------- listings ----------
function baseSelect() {
  return `
  SELECT l.*, b.name AS brand_name, b.slug AS brand_slug,
         c.name AS category_name, c.slug AS category_slug, c.parent_id AS category_parent,
         p.name AS product_name,
         u.name AS seller_name, u.avatar_url AS seller_avatar,
         sp.seller_type, sp.verified_phone, sp.verified_email, sp.verified_business,
         bp.id AS shop_id, bp.shop_name, bp.slug AS shop_slug, bp.logo_url AS shop_logo, bp.verified_at AS shop_verified
  FROM listings l
  LEFT JOIN brands b ON b.id=l.brand_id
  JOIN categories c ON c.id=l.category_id
  LEFT JOIN products p ON p.id=l.product_id
  JOIN users u ON u.id=l.seller_id
  LEFT JOIN seller_profiles sp ON sp.user_id=u.id
  LEFT JOIN business_profiles bp ON bp.id=l.shop_id`;
}

function shape(row, { images, attrs, favorited } = {}) {
  if (!row) return null;
  const top = row.category_parent ? db.prepare('SELECT slug,name FROM categories WHERE id=?').get(row.category_parent) : { slug: row.category_slug, name: row.category_name };
  const cover = images && images.length ? images[0].url : null;
  return {
    id: row.id, slug: row.slug, title: row.title,
    price: row.price, price_formatted: 'Rs. ' + Number(row.price).toLocaleString('en-US'),
    negotiable: !!row.negotiable, condition: row.condition, status: row.status,
    rejection_reason: row.rejection_reason,
    category: { id: row.category_id, name: row.category_name, slug: row.category_slug, top: top.slug, top_name: top.name, parent_id: row.category_parent },
    brand: row.brand_id ? { id: row.brand_id, name: row.brand_name, slug: row.brand_slug } : null,
    product: row.product_id ? { id: row.product_id, name: row.product_name } : null,
    location: { id: row.location_id, city: row.city },
    seller: {
      id: row.seller_id, name: row.seller_name, avatar: row.seller_avatar,
      seller_type: row.seller_type || 'individual',
      verified_phone: !!row.verified_phone, verified_email: !!row.verified_email,
      verified_business: !!row.verified_business,
    },
    shop: row.shop_id ? {
      id: row.shop_id, name: row.shop_name, slug: row.shop_slug,
      logo: row.shop_logo, verified: !!row.shop_verified,
    } : null,
    cover, images: images || undefined,
    attributes: attrs || undefined,
    views: row.views, favorite_count: row.favorite_count, is_featured: !!row.is_featured,
    warranty: row.warranty, receipt_available: !!row.receipt_available, reason_selling: row.reason_selling,
    description: row.description,
    contact: {
      phone: row.contact_phone, whatsapp: row.whatsapp_number ? '+' + row.whatsapp_number : null,
      calls_enabled: !!row.calls_enabled, whatsapp_enabled: !!row.whatsapp_enabled, chat_enabled: !!row.chat_enabled,
    },
    created_at: row.created_at, updated_at: row.updated_at,
    submitted_at: row.submitted_at, approved_at: row.approved_at, expires_at: row.expires_at, sold_at: row.sold_at,
    is_favorite: !!favorited,
  };
}

function imagesFor(id) {
  return db.prepare('SELECT id,url,thumb_url,sort_order FROM listing_images WHERE listing_id=? ORDER BY sort_order,id').all(id);
}
function attrsFor(id) {
  const out = {};
  for (const r of db.prepare('SELECT k,v FROM listing_attributes WHERE listing_id=?').all(id)) out[r.k] = r.v;
  return out;
}

/**
 * Search/filter/sort engine (sections 26-28). f:
 * q, cat (slug), brand (slug), model (product slug), status[], seller,
 * conditions[], price_min/max, location (id), seller_type,
 * shutter_max, megapixels_min, flight_min, batteries_min, resolution,
 * mount, focal (prime|zoom), aperture, sort, page, limit, includeUnapproved
 */
function listListings(f = {}) {
  const where = [];
  const params = [];

  if (f.status) {
    const list = Array.isArray(f.status) ? f.status : [f.status];
    where.push(`l.status IN (${list.map(() => '?').join(',')})`);
    params.push(...list);
  } else if (!f.includeAll) {
    where.push("l.status='active'");
  }
  if (f.seller) { where.push('l.seller_id=?'); params.push(f.seller); }
  if (f.shop) { where.push('l.shop_id=?'); params.push(f.shop); }
  if (f.seller_type) {
    if (f.seller_type === 'business') where.push('l.shop_id IS NOT NULL');
    else where.push('l.shop_id IS NULL');
  }
  if (f.cat) {
    const cat = categoryBySlug(f.cat);
    if (cat) {
      const ids = leafIdsOf(cat.id);
      where.push(`l.category_id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
  }
  if (f.leaf) { where.push('c.slug=?'); params.push(f.leaf); }
  if (f.brand) {
    const brandSlugs = [...new Set(String(f.brand).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean))];
    if (brandSlugs.length === 1) { where.push('b.slug=?'); params.push(brandSlugs[0]); }
    else if (brandSlugs.length > 1) { where.push(`b.slug IN (${brandSlugs.map(() => '?').join(',')})`); params.push(...brandSlugs); }
  }
  if (f.model) { where.push('p.slug=?'); params.push(String(f.model).toLowerCase()); }
  if (f.conditions && f.conditions.length) {
    where.push(`l.condition IN (${f.conditions.map(() => '?').join(',')})`);
    params.push(...f.conditions);
  }
  if (f.price_min) { where.push('l.price >= ?'); params.push(Number(f.price_min)); }
  if (f.price_max) { where.push('l.price <= ? AND l.price > 0'); params.push(Number(f.price_max)); }
  if (f.location) {
    const ids = locationDescendants(Number(f.location));
    where.push(`l.location_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (f.q) {
    const q = `%${String(f.q).replace(/[%"_]/g, ' ').slice(0, 80)}%`;
    where.push('(l.title LIKE ? OR b.name LIKE ? OR p.name LIKE ? OR c.name LIKE ?)');
    params.push(q, q, q, q);
  }
  // attribute filters via EXISTS
  const attr = (k, op, v) => {
    where.push(`EXISTS (SELECT 1 FROM listing_attributes la WHERE la.listing_id=l.id AND la.k=? AND CAST(la.v AS REAL) ${op} ?)`);
    params.push(k, Number(v));
  };
  const attrEq = (k, v) => {
    where.push('EXISTS (SELECT 1 FROM listing_attributes la WHERE la.listing_id=l.id AND la.k=? AND la.v=?)');
    params.push(k, v);
  };
  if (f.shutter_max) attr('shutter_count', '<=', f.shutter_max);
  if (f.megapixels_min) attr('megapixels', '>=', f.megapixels_min);
  if (f.flight_min) attr('flight_time', '>=', f.flight_min);
  if (f.batteries_min) attr('battery_count', '>=', f.batteries_min);
  if (f.resolution) attrEq('resolution', f.resolution);
  if (f.mount) attrEq('mount', f.mount);
  if (f.aperture) {
    where.push(`EXISTS (SELECT 1 FROM listing_attributes la WHERE la.listing_id=l.id AND la.k='max_aperture' AND REPLACE(REPLACE(la.v,'f/',''),'F','')+0 <= ?)`);
    params.push(Number(f.aperture));
  }
  if (f.focal === 'prime') where.push(`(EXISTS (SELECT 1 FROM listing_attributes la WHERE la.listing_id=l.id AND la.k='focal_length' AND INSTR(la.v,'-')=0))`);
  if (f.focal === 'zoom') where.push(`(EXISTS (SELECT 1 FROM listing_attributes la WHERE la.listing_id=l.id AND la.k='focal_length' AND INSTR(la.v,'-')>0))`);
  if (f.featured) where.push('l.is_featured=1');
  if (f.minPrice) where.push('l.price>0');

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const countSql = `SELECT COUNT(*) n FROM listings l
    LEFT JOIN brands b ON b.id=l.brand_id JOIN categories c ON c.id=l.category_id
    LEFT JOIN products p ON p.id=l.product_id ${whereSql}`;
  const total = db.prepare(countSql).get(...params).n;

  const sorts = {
    newest: 'l.created_at DESC',
    price_asc: 'l.price ASC',
    price_desc: 'l.price DESC',
    most_viewed: 'l.views DESC',
    recommended: 'l.is_featured DESC, l.created_at DESC',
  };
  const order = sorts[f.sort] || sorts.recommended;
  const limit = Math.min(Number(f.limit) || 24, 48);
  const page = Math.max(1, Number(f.page) || 1);
  const offset = (page - 1) * limit;

  const rows = db.prepare(
    `${baseSelect()} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  const favSet = f.userId ? new Set(db.prepare('SELECT listing_id FROM favorites WHERE user_id=?').all(f.userId).map((r) => r.listing_id)) : null;
  const items = rows.map((r) => {
    const img = db.prepare('SELECT url,thumb_url FROM listing_images WHERE listing_id=? ORDER BY sort_order,id LIMIT 1').get(r.id);
    return shape(r, { images: img ? [img] : [], favorited: favSet?.has(r.id) });
  });
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit };
}

function getListing({ id, slug, status } = {}) {
  let row;
  if (id) row = db.prepare(`${baseSelect()} WHERE l.id=?`).get(id);
  else row = db.prepare(`${baseSelect()} WHERE l.slug=?`).get(slug);
  if (!row) return null;
  if (status && row.status !== status) return { notActive: true, row };
  return row;
}

function fullListing(row, { userId } = {}) {
  const images = imagesFor(row.id);
  const attrs = attrsFor(row.id);
  let favorited = false;
  if (userId) {
    favorited = !!db.prepare('SELECT 1 FROM favorites WHERE user_id=? AND listing_id=?').get(userId, row.id);
  }
  return shape(row, { images, attrs, favorited });
}

function relatedListings(row, limit = 6) {
  const rows = db.prepare(
    `${baseSelect()} WHERE l.status='active' AND l.id<>? AND (l.category_id=? OR l.brand_id=?)
     ORDER BY l.is_featured DESC, l.created_at DESC LIMIT ?`
  ).all(row.id, row.category_id, row.brand_id, limit);
  return rows.map((r) => {
    const img = db.prepare('SELECT url,thumb_url FROM listing_images WHERE listing_id=? ORDER BY sort_order,id LIMIT 1').get(r.id);
    return shape(r, { images: img ? [img] : [] });
  });
}

function publicSettings() {
  const rows = db.prepare('SELECT key,value_json FROM site_settings').all();
  const out = {};
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value_json); } catch { /* noop */ } }
  return out;
}

module.exports = {
  categoryTree, categoryBySlug, topCategoryFor, leafIdsOf, brandsForCategory, productsFor,
  locationTree, locationDescendants,
  listListings, getListing, fullListing, relatedListings, shape, imagesFor, attrsFor,
  publicSettings,
};
