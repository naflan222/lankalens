'use strict';
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, applySchema } = require('./db');
const { catalog } = require('./data/catalog');
const { PROVINCES } = require('./data/locations');
const { PAGES, BLOG } = require('./data/content');
const { demoPhotoSet, generate } = require('./lib/placeholders');
const { now, slugify, normalizeSLPhone } = require('./lib/util');
const path = require('node:path');
const fs = require('node:fs');

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
const DAY = 86400 * 1000;
const t = now();

applySchema();

// ---------- reset ----------
const tables = ['email_outbox','analytics_events','audit_logs','transactions','payments','promotions','promotion_packages','reviews','reports','notifications','messages','offers','conversations','favorites','listing_images','listing_attributes','listings','products','category_brands','brands','categories','business_profiles','seller_profiles','verification_tokens','user_profiles','users','blog_posts','pages','site_settings','locations'];
db.exec('PRAGMA foreign_keys=OFF');
for (const tb of tables) db.exec(`DELETE FROM ${tb}`);
db.exec(`DELETE FROM sqlite_sequence`);
db.exec('PRAGMA foreign_keys=ON');

const hash = (pw) => bcrypt.hashSync(pw, 10);

// ---------- settings ----------
function setSetting(key, value, adminId = null) {
  db.prepare('INSERT INTO site_settings (key, value_json, updated_at, updated_by) VALUES (?,?,?,?)')
    .run(key, JSON.stringify(value), t, adminId);
}
setSetting('site_name', 'Lanka Lens');
setSetting('tagline', "Sri Lanka's Camera Marketplace");
setSetting('currency', 'LKR');
setSetting('listings_require_approval', process.env.LISTINGS_REQUIRE_APPROVAL !== 'false');
setSetting('listing_expiry_days', Number(process.env.LISTING_EXPIRY_DAYS || 60));
setSetting('max_image_mb', Number(process.env.MAX_IMAGE_MB || 5));
setSetting('max_images_per_listing', Number(process.env.MAX_IMAGES_PER_LISTING || 10));
setSetting('featured_price_lkr', 1500);
setSetting('contact_email', 'support@lankalens.lk');
setSetting('social', { facebook: '#', instagram: '#', youtube: '#', whatsapp: '' });

// ---------- promotion packages (architecture only, payments disabled) ----------
const packs = [
  ['featured-7', 'Featured Listing — 7 days', 'Top of category & search with a Featured badge', 'featured', 7, 1500, 1],
  ['featured-14', 'Featured Listing — 14 days', 'Two weeks of premium visibility', 'featured', 14, 2500, 2],
  ['home-spotlight-30', 'Homepage Spotlight — 30 days', 'Appears in the homepage Featured Cameras rail', 'featured', 30, 4500, 3],
  ['boost-3', 'Quick Boost — 3 days', 'Priority sorting for 3 days', 'boost', 3, 800, 4],
];
for (const [key, name, description, kind, days, price, sort] of packs) {
  db.prepare('INSERT INTO promotion_packages (key,name,description,kind,days,price_lkr,active,sort_order) VALUES (?,?,?,?,?,?,1,?)')
    .run(key, name, description, kind, days, price, sort);
}

// ---------- categories ----------
const catById = {};
const catBySlug = {};
let catSort = 0;
function addCat(name, slug, parentId, icon, color, group, filters, sort) {
  const info = db.prepare('INSERT INTO categories (name,slug,parent_id,icon,color,sort_order,filters_json) VALUES (?,?,?,?,?,?,?)')
    .run(name, slug, parentId, icon, color || null, sort, filters ? JSON.stringify(filters) : null);
  const id = Number(info.lastInsertRowid);
  catById[id] = { id, name, slug, parent_id: parentId, group };
  catBySlug[slug] = id;
  return id;
}
for (const top of catalog) {
  const topId = addCat(top.name, top.slug, null, top.icon, top.color, top.group, top.filters, catSort++);
  let subSort = 0;
  for (const [name, slug] of top.subs.map((s) => [s[0], s[1]])) {
    addCat(name, slug, topId, null, top.color, top.group, null, subSort++);
  }
}

// ---------- brands, category_brands, products ----------
const brandId = {};
function getBrand(name, scope) {
  const slug = slugify(name);
  if (brandId[slug]) return brandId[slug];
  const info = db.prepare('INSERT INTO brands (name,slug,scope,sort_order) VALUES (?,?,?,?)').run(name, slug, scope, Object.keys(brandId).length);
  brandId[slug] = Number(info.lastInsertRowid);
  return brandId[slug];
}
const productId = {};
for (const top of catalog) {
  for (const sub of top.subs) {
    const [subName, subSlug, brandNames] = sub;
    const models = sub[3] || {};
    const leafId = catBySlug[subSlug];
    for (const bn of brandNames) {
      const bid = getBrand(bn, top.group);
      db.prepare('INSERT OR IGNORE INTO category_brands (category_id,brand_id) VALUES (?,?)').run(leafId, bid);
      const list = models[bn] || [];
      let pSort = 0;
      for (const model of list) {
        const pslug = slugify(model);
        const info = db.prepare(
          'INSERT OR IGNORE INTO products (category_id,brand_id,name,slug,sort_order) VALUES (?,?,?,?,?)'
        ).run(leafId, bid, model, pslug, pSort++);
        const pid = info.lastInsertRowid
          ? Number(info.lastInsertRowid)
          : Number(db.prepare('SELECT id FROM products WHERE brand_id=? AND slug=?').get(bid, pslug).id);
        productId[`${bid}:${pslug}`] = pid;
      }
    }
  }
}

// ---------- locations ----------
const locId = {};
function addLoc(name, level, parentId, sort) {
  const info = db.prepare('INSERT INTO locations (parent_id,level,name,slug,sort_order) VALUES (?,?,?,?,?)')
    .run(parentId, level, name, slugify(name) + (parentId && level === 'city' ? '' : ''), sort);
  const id = Number(info.lastInsertRowid);
  locId[`${level}:${name}`] = id;
  return id;
}
let pSort = 0;
for (const [province, districts] of PROVINCES) {
  const pid = addLoc(province, 'province', null, pSort++);
  let dSort = 0;
  for (const [district, cities] of districts) {
    const did = addLoc(district, 'district', pid, dSort++);
    let cSort = 0;
    for (const city of cities) addLoc(city, 'city', did, cSort++);
  }
}

// ---------- users ----------
function addUser({ name, email, phone, password, role = 'user', emailVerified = true, phoneVerified = false, avatar }) {
  const info = db.prepare(
    `INSERT INTO users (name,email,phone,password_hash,role,avatar_url,email_verified_at,phone_verified_at,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?, 'active', ?, ?)`
  ).run(name, email.toLowerCase(), normalizeSLPhone(phone)?.e164 || phone, hash(password), role, avatar || null, emailVerified ? t : null, phoneVerified ? t : null, t - 200 * DAY, t);
  const id = Number(info.lastInsertRowid);
  db.prepare('INSERT INTO user_profiles (user_id,updated_at) VALUES (?,?)').run(id, t);
  return id;
}
function avatarSvg(initials, bg, file) {
  const p = path.join(UPLOAD_ROOT, 'seed', file);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${bg}"/><text x="100" y="118" font-family="Arial" font-size="80" font-weight="bold" fill="#fff" text-anchor="middle">${initials}</text></svg>`);
  }
  return `/uploads/seed/${file}`;
}
const adminId = addUser({ name: 'Lanka Lens Admin', email: 'admin@lankalens.lk', phone: '0770000001', password: 'admin12345', role: 'admin', phoneVerified: true, avatar: avatarSvg('LL', '#11202f', 'avatar-admin.svg') });

function addSeller(userId, sellerType, { displayName, phone, whatsapp, phoneV = true, businessV = false }) {
  const p = normalizeSLPhone(phone);
  const w = normalizeSLPhone(whatsapp || phone);
  db.prepare(
    `INSERT INTO seller_profiles (user_id,seller_type,display_name,contact_phone,whatsapp_number,calls_enabled,whatsapp_enabled,chat_enabled,verified_phone,verified_email,verified_business,created_at,updated_at)
     VALUES (?,?,?,?,?,1,1,1,?,?,?, ?, ?)`
  ).run(userId, sellerType, displayName, p?.e164 || phone, w?.whatsapp || '', phoneV ? 1 : 0, 1, businessV ? 1 : 0, t, t);
  return Number(db.prepare('SELECT id FROM seller_profiles WHERE user_id=?').get(userId).id);
}

const shopLogo = (initials, file, bg = '#16324a') => avatarSvg(initials, bg, file);

const shopUserId = addUser({ name: 'Aperture Cameras', email: 'shop@lankalens.lk', phone: '0771234567', password: 'shop12345', phoneVerified: true, avatar: shopLogo('AC', 'shop-aperture.svg', '#16324a') });
addSeller(shopUserId, 'business', { displayName: 'Aperture Cameras', phone: '0771234567', whatsapp: '0771234567', businessV: true });
const shop2UserId = addUser({ name: 'Shutter Shop Kandy', email: 'shop2@lankalens.lk', phone: '0712345678', password: 'shop12345', phoneVerified: true, avatar: shopLogo('SS', 'shop-shutter.svg', '#3a2a17') });
addSeller(shop2UserId, 'business', { displayName: 'Shutter Shop Kandy', phone: '0712345678', whatsapp: '0712345678', businessV: false });

function addShop(userId, name, slug, { description, city, address, phone, whatsapp, hours, verified }) {
  db.prepare(
    `INSERT INTO business_profiles (user_id,shop_name,slug,logo_url,description,location_id,address,phone,whatsapp,opening_hours,verified_at,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'approved', ?, ?)`
  ).run(userId, name, slug,
    db.prepare('SELECT avatar_url FROM users WHERE id=?').get(userId).avatar_url,
    description, locId[`city:${city}`], address,
    normalizeSLPhone(phone)?.e164, normalizeSLPhone(whatsapp)?.whatsapp,
    hours, verified ? t : null, t, t);
  return Number(db.prepare('SELECT id FROM business_profiles WHERE slug=?').get(slug).id);
}
const apertureId = addShop(shopUserId, 'Aperture Cameras', 'aperture-cameras', {
  description: 'Established camera dealer in Colombo 04 stocking new and used DSLR, mirrorless, lenses, GoPro, DJI action cameras and drones. Trade-ins welcome. All used gear tested and graded in-store with shop warranty on selected items.',
  city: 'Colombo', address: 'No. 42, R.A. De Mel Mawatha, Colombo 04', phone: '0771234567', whatsapp: '0771234567',
  hours: 'Mon–Sat 9:00–18:30 · Sun 10:00–15:00', verified: true,
});
const shutterKandyId = addShop(shop2UserId, 'Shutter Shop Kandy', 'shutter-shop-kandy', {
  description: 'Independent camera shop in Kandy buying and selling used mirrorless bodies, lenses and drones. Sensor cleaning and basic servicing available.',
  city: 'Kandy', address: 'No. 17, Peradeniya Road, Kandy', phone: '0712345678', whatsapp: '0712345678',
  hours: 'Mon–Sat 9:30–18:00', verified: false,
});

const sellerIds = {};
function individual(name, email, phone, initials, city, file, bg) {
  const id = addUser({ name, email, phone, password: 'seller12345', phoneVerified: true, avatar: avatarSvg(initials, bg, file) });
  addSeller(id, 'individual', { displayName: name, phone, whatsapp: phone });
  db.prepare('UPDATE user_profiles SET location_id=?, city=? WHERE user_id=?').run(locId[`city:${city}`], city, id);
  sellerIds[email] = id;
  return id;
}
const nimal = individual('Nimal Perera', 'seller@lankalens.lk', '0777654321', 'NP', 'Colombo', 'avatar-nimal.svg', '#15302a');
const samanthi = individual('Samanthi Silva', 'samanthi@example.lk', '0718887766', 'SS', 'Negombo', 'avatar-samanthi.svg', '#2a2440');
const kasun = individual('Kasun Jayawardena', 'kasun@example.lk', '0765554433', 'KJ', 'Kandy', 'avatar-kasun.svg', '#16324a');
const dilani = individual('Dilani Fernando', 'dilani@example.lk', '0703332211', 'DF', 'Galle', 'avatar-dilani.svg', '#33251c');

const buyerId = addUser({ name: 'Buyer Demo', email: 'buyer@lankalens.lk', phone: '0721112233', password: 'buyer12345', phoneVerified: true, avatar: avatarSvg('BD', '#444', 'avatar-buyer.svg') });

// ---------- listings ----------
const topGroupByLeaf = {};
for (const top of catalog) for (const sub of top.subs) topGroupByLeaf[sub[1]] = { group: top.group, topSlug: top.slug, topName: top.name };
const leafGroupIcon = {};
for (const top of catalog) for (const sub of top.subs) leafGroupIcon[sub[1]] = { group: top.group };

let listingCounter = 0;
const listingsByModel = {};
function listing(o) {
  listingCounter++;
  const leafId = catBySlug[o.sub];
  const { group } = topGroupByLeaf[o.sub];
  const bSlug = slugify(o.brand);
  const bid = brandId[bSlug];
  const pSlug = slugify(o.model);
  const pid = productId[`${bid}:${pSlug}`] || null;
  const idBase = 10000 + listingCounter;
  const slug = `${pSlug || slugify(o.title)}-${idBase}`;
  const created = t - o.daysAgo * DAY;
  const status = o.status || 'active';
  const cityId = locId[`city:${o.city}`] || null;
  const info = db.prepare(
    `INSERT INTO listings
      (slug,seller_id,shop_id,category_id,brand_id,product_id,title,description,price,negotiable,condition,status,rejection_reason,
       location_id,city,views,favorite_count,is_featured,contact_phone,whatsapp_number,calls_enabled,whatsapp_enabled,chat_enabled,
       warranty,receipt_available,reason_selling,expires_at,submitted_at,approved_at,sold_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,1,?,?,NULL,?,?,?,?,?,?,?,1,1,1,?,?,?,?,?,?,?,?,?)`
  ).run(
    slug, o.seller, o.shop || null, leafId, bid, pid, o.title, o.desc, o.price, o.condition, status,
    cityId, o.city, o.views || 0, o.favs || 0, o.featured ? 1 : 0,
    normalizeSLPhone(o.phone)?.e164 || null, normalizeSLPhone(o.whatsapp || o.phone)?.whatsapp || '',
    o.warranty || 'No warranty', o.receipt ? 1 : 0, o.reason || '',
    ['active', 'sold', 'expired'].includes(status) ? created + 60 * DAY : null,
    ['pending', 'active', 'sold', 'expired'].includes(status) ? created : null,
    ['active', 'sold'].includes(status) ? created : null,
    status === 'sold' ? created + 10 * DAY : null,
    created, created
  );
  const id = Number(info.lastInsertRowid);
  for (const [k, v] of Object.entries(o.attrs || {})) {
    if (v !== undefined && v !== null && v !== '') db.prepare('INSERT INTO listing_attributes (listing_id,k,v) VALUES (?,?,?)').run(id, k, String(v));
  }
  const key = `${bSlug}-${pSlug || slugify(o.title)}`;
  const urls = demoPhotoSet(UPLOAD_ROOT, group, key, o.photos || 6);
  urls.forEach((u, i) => db.prepare('INSERT INTO listing_images (listing_id,url,thumb_url,sort_order,created_at) VALUES (?,?,?,?,?)')
    .run(id, u, u, i, created));
  listingsByModel[o.model] = id;
  return id;
}

const commonDesc = (extra) => `${extra}\n\nGenuine reason for sale, camera used as a hobbyist. No drops, no repairs. Test as long as you like before buying — meet in a public place in Colombo. Cash only after inspection, no couriers or advance payments. Message on Lanka Lens chat or WhatsApp.`;

// ---- Cameras: DSLR ----
listing({ sub: 'dslr', brand: 'Canon', model: 'EOS 90D', title: 'Canon EOS 90D DSLR Body (Excellent)', price: 285000, condition: 'excellent',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 1, views: 412, favs: 18, featured: true, receipt: true,
  warranty: 'Shop warranty', phone: '0771234567',
  attrs: { year: 2021, shutter_count: 24000, sensor: 'APS-C', megapixels: 32.5, video_resolution: '4K', iso_range: '100–25,600', kit: 'Body only', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('Canon EOS 90D, 32.5MP APS-C, unmarked body, shutter only 24k. Comes with original battery, charger, strap, box and purchase receipt. Fully tested in store; 3-month shop warranty.') });
listing({ sub: 'dslr', brand: 'Nikon', model: 'D750', title: 'Nikon D750 Full Frame Body (Good)', price: 245000, condition: 'good',
  seller: nimal, city: 'Colombo', daysAgo: 3, views: 266, favs: 9, phone: '0777654321', receipt: true, reason: 'Upgraded to mirrorless',
  attrs: { year: 2016, shutter_count: 78000, sensor: 'Full Frame', megapixels: 24.3, video_resolution: 'Full HD 1080p', iso_range: '100–12,800', kit: 'Body only', battery_included: 'Yes', charger_included: 'Yes', original_box: 'No', receipt_available: 'Yes' },
  desc: commonDesc('Nikon D750 full-frame workhorse. Shutter 78k (rated 150k+), slight brassing on the bottom but everything works perfectly — great sensor and low-light AF. Battery and charger included.') });
listing({ sub: 'dslr', brand: 'Canon', model: 'EOS 5D Mark IV', title: 'Canon EOS 5D Mark IV — Like New', price: 520000, condition: 'like_new',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 2, views: 503, favs: 22, featured: true, receipt: true, warranty: 'Shop warranty', phone: '0771234567',
  attrs: { year: 2020, shutter_count: 18500, sensor: 'Full Frame', megapixels: 30.4, video_resolution: '4K', iso_range: '100–32,000', kit: 'Body only', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('Pro-grade 5D IV, low shutter count, boxed with receipt. Traded in by a wedding photographer upgrading to R5. Checked and approved by our technician; shop warranty included.') });
listing({ sub: 'dslr', brand: 'Nikon', model: 'D5600', title: 'Nikon D5600 + 18-55 VR Kit (Excellent)', price: 135000, condition: 'excellent',
  seller: kasun, city: 'Kandy', daysAgo: 5, views: 178, favs: 6, phone: '0765554433',
  attrs: { year: 2019, shutter_count: 31000, sensor: 'APS-C', megapixels: 24.2, video_resolution: 'Full HD 1080p', iso_range: '100–25,600', kit: 'With kit lens', lens_included: 'Yes', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'No' },
  desc: commonDesc('Nikon D5600 with AF-P 18-55 VR, two batteries, 32GB card, bag and box. Flip touchscreen ideal for video. Meet in Kandy.') });
listing({ sub: 'dslr', brand: 'Canon', model: 'EOS 250D', title: 'Canon EOS 250D + 18-55 IS STM (Like New)', price: 115000, condition: 'like_new',
  seller: samanthi, city: 'Negombo', daysAgo: 6, views: 142, favs: 5, phone: '0718887766',
  attrs: { year: 2021, shutter_count: 9800, sensor: 'APS-C', megapixels: 24.1, video_resolution: '4K', iso_range: '100–25,600', kit: 'With kit lens', lens_included: 'Yes', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('Lightweight 250D, barely used (under 10k shutter) — bought for a course that ended. Kit lens, box, charger, receipt all included.') });
listing({ sub: 'dslr', brand: 'Nikon', model: 'D850', title: 'Nikon D850 Body, Boxed (Excellent)', price: 690000, condition: 'excellent',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 4, views: 355, favs: 12, receipt: true, warranty: 'Shop warranty', phone: '0771234567',
  attrs: { year: 2019, shutter_count: 52000, sensor: 'Full Frame', megapixels: 45.7, video_resolution: '4K', iso_range: '64–25,600', kit: 'Body only', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('45.7MP D850 in excellent condition with box and receipt. XQD card and extra battery available separately. Test in-store.') });

// ---- Mirrorless ----
listing({ sub: 'mirrorless', brand: 'Sony', model: 'A7 III', title: 'Sony A7 III Body — Excellent, Boxed', price: 325000, condition: 'excellent',
  seller: nimal, city: 'Colombo', daysAgo: 2, views: 891, favs: 41, featured: true, phone: '0777654321', receipt: true, reason: 'Switching to Fujifilm',
  attrs: { year: 2019, shutter_count: 42000, sensor: 'Full Frame', megapixels: 24.2, video_resolution: '4K', iso_range: '100–51,200', kit: 'Body only', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('Sony A7 III (ILCE-7M3), 24MP full frame, 4K video. Body is in excellent shape with a screen protector since day one; sensor clean, IBIS works perfectly. Two batteries, dual charger, strap, box and receipt. Serious buyers welcome to test with their own lens and SD card.') });
listing({ sub: 'mirrorless', brand: 'Sony', model: 'A6400', title: 'Sony A6400 Body + SmallRig Cage (Like New)', price: 210000, condition: 'like_new',
  seller: samanthi, city: 'Negombo', daysAgo: 4, views: 312, favs: 14, phone: '0718887766', receipt: true,
  attrs: { year: 2022, shutter_count: 12000, sensor: 'APS-C', megapixels: 24.2, video_resolution: '4K', iso_range: '100–32,000', kit: 'Body only', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('A6400 with class-leading eye AF, perfect for vlogging with the flip screen. Includes SmallRig cage, two batteries, box and receipt.') });
listing({ sub: 'mirrorless', brand: 'Sony', model: 'A6000', title: 'Sony A6000 + 16-50 Kit (Good)', price: 125000, condition: 'good',
  seller: dilani, city: 'Galle', daysAgo: 9, views: 201, favs: 7, phone: '0703332211',
  attrs: { year: 2015, shutter_count: 64000, sensor: 'APS-C', megapixels: 24.3, video_resolution: 'Full HD 1080p', iso_range: '100–25,600', kit: 'With kit lens', lens_included: 'Yes', battery_included: 'Yes', charger_included: 'Yes', original_box: 'No', receipt_available: 'No' },
  desc: commonDesc('Reliable beginner mirrorless, well used but fully working. Kit lens has some dust that does not affect images. Battery and charger included. Great budget starter.') });
listing({ sub: 'mirrorless', brand: 'Canon', model: 'EOS R6', title: 'Canon EOS R6 Body, Low Shutter (Like New)', price: 495000, condition: 'like_new',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 3, views: 487, favs: 19, featured: true, receipt: true, warranty: 'Shop warranty', phone: '0771234567',
  attrs: { year: 2021, shutter_count: 15000, sensor: 'Full Frame', megapixels: 20.1, video_resolution: '4K', iso_range: '100–102,400', kit: 'Body only', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('R6 with superb IBIS and autofocus, shutter only 15k. Ex-rental? No — single owner, shop-checked with warranty. Battery, charger and box included.') });
listing({ sub: 'mirrorless', brand: 'Nikon', model: 'Z6 II', title: 'Nikon Z6 II + Z 24-70 f/4 S Kit', price: 410000, condition: 'excellent',
  seller: kasun, city: 'Kandy', daysAgo: 7, views: 264, favs: 11, phone: '0765554433', receipt: true,
  attrs: { year: 2021, shutter_count: 26000, sensor: 'Full Frame', megapixels: 24.5, video_resolution: '4K', iso_range: '100–51,200', kit: 'With kit lens', lens_included: 'Yes — NIKKOR Z 24-70mm f/4 S', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('Z6 II kit with the sharp Z 24-70 f/4 S lens, extra battery, 128GB XQD card and box. Weather sealed, IBIS, dual card slots. Price slightly negotiable.') });
listing({ sub: 'mirrorless', brand: 'Fujifilm', model: 'X-T4', title: 'Fujifilm X-T4 Body (Good)', price: 340000, condition: 'good',
  seller: dilani, city: 'Galle', daysAgo: 11, views: 298, favs: 13, phone: '0703332211',
  attrs: { year: 2020, shutter_count: 58000, sensor: 'APS-C', megapixels: 26.1, video_resolution: '4K', iso_range: '160–12,800', kit: 'Body only', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('X-T4 with the classic film simulations and great IBIS. Some paint wear on the base, everything works. Box, receipt, battery, charger.') });
listing({ sub: 'mirrorless', brand: 'Fujifilm', model: 'X-T30 II', title: 'Fujifilm X-T30 II, Black (Excellent)', price: 230000, condition: 'excellent',
  seller: nimal, city: 'Colombo', daysAgo: 8, views: 176, favs: 8, phone: '0777654321', receipt: true,
  attrs: { year: 2022, shutter_count: 14000, sensor: 'APS-C', megapixels: 26.1, video_resolution: '4K', iso_range: '160–12,800', kit: 'Body only', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('Compact X-Trans 4 powerhouse, barely used. Great film looks straight out of camera. Boxed with all accessories.') });
listing({ sub: 'mirrorless', brand: 'Canon', model: 'EOS M50 Mark II', title: 'Canon EOS M50 Mark II + 15-45 Kit', price: 165000, condition: 'like_new',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 6, views: 188, favs: 6, receipt: true, phone: '0771234567',
  attrs: { year: 2022, shutter_count: 8000, sensor: 'APS-C', megapixels: 24.1, video_resolution: '4K', iso_range: '100–25,600', kit: 'With kit lens', lens_included: 'Yes', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('Beginner-friendly mirrorless with flip-vlog screen, EF-M 15-45 kit lens and box. Shop checked.') });
listing({ sub: 'mirrorless', brand: 'Sony', model: 'ZV-E10', title: 'Sony ZV-E10 Vlog Camera + 16-50 PZ', price: 195000, condition: 'like_new',
  seller: samanthi, city: 'Negombo', daysAgo: 5, views: 224, favs: 10, phone: '0718887766', receipt: true,
  attrs: { year: 2022, shutter_count: 7000, sensor: 'APS-C', megapixels: 24.2, video_resolution: '4K', iso_range: '100–32,000', kit: 'With kit lens', lens_included: 'Yes', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('Content-creator camera with background defocus button and 3-capsule mic. Kit lens, windscreen, box, receipt included.') });
listing({ sub: 'mirrorless', brand: 'Nikon', model: 'Z50', title: 'Nikon Z50 + 16-50 DX Kit', price: 240000, condition: 'excellent',
  seller: shop2UserId, shop: shutterKandyId, city: 'Kandy', daysAgo: 10, views: 154, favs: 4, phone: '0712345678',
  attrs: { year: 2021, shutter_count: 19000, sensor: 'APS-C', megapixels: 20.9, video_resolution: '4K', iso_range: '100–51,200', kit: 'With kit lens', lens_included: 'Yes', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('Z50 DX kit, light and sturdy, ideal travel body. Checked in our Kandy shop; battery, charger, strap, box.') });

// ---- Compact ----
listing({ sub: 'compact', brand: 'Sony', model: 'Cyber-shot RX100 VII', title: 'Sony RX100 VII Premium Compact (Good)', price: 165000, condition: 'good',
  seller: nimal, city: 'Colombo', daysAgo: 13, views: 143, favs: 5, phone: '0777654321',
  attrs: { year: 2020, megapixels: 20.1, video_resolution: '4K', original_box: 'Yes', battery_included: 'Yes', charger_included: 'Yes', receipt_available: 'No' },
  desc: commonDesc('Pocket rocket with 24-200mm equiv zoom. Small mark on the body edge; lens and sensor perfect. Charger and two batteries.') });
listing({ sub: 'compact', brand: 'Canon', model: 'PowerShot G7 X Mark III', title: 'Canon G7 X Mark III Vlogger Kit (Like New)', price: 140000, condition: 'like_new',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 7, views: 121, favs: 3, receipt: true, phone: '0771234567',
  attrs: { year: 2022, megapixels: 20.1, video_resolution: '4K', original_box: 'Yes', battery_included: 'Yes', charger_included: 'Yes', receipt_available: 'Yes' },
  desc: commonDesc('The YouTuber compact. Includes tripod grip and 64GB card. Box and receipt; shop tested.') });

// ---- Lenses ----
listing({ sub: 'sony-e', brand: 'Sigma', model: '24-70mm f/2.8 DG DN Art', title: 'Sigma 24-70mm f/2.8 DG DN Art — Sony E', price: 210000, condition: 'excellent',
  seller: nimal, city: 'Colombo', daysAgo: 3, views: 356, favs: 16, featured: true, phone: '0777654321', receipt: true,
  attrs: { mount: 'Sony E', focal_length: '24-70mm', max_aperture: 'f/2.8', image_stabilization: 'No', autofocus: 'Autofocus', original_box: 'Yes', warranty: 'No warranty', receipt_available: 'Yes' },
  desc: commonDesc('Sigma Art 24-70 DN for Sony E-mount. Glass perfect — no fungus, haze or dust issues; AF fast and silent; hood, caps, box and receipt included. Bring your camera to test.') });
listing({ sub: 'sony-e', brand: 'Tamron', model: '28-75mm f/2.8 Di III VXD G2', title: 'Tamron 28-75mm f/2.8 G2 (Sony E)', price: 115000, condition: 'like_new',
  seller: samanthi, city: 'Negombo', daysAgo: 6, views: 198, favs: 9, phone: '0718887766', receipt: true,
  attrs: { mount: 'Sony E', focal_length: '28-75mm', max_aperture: 'f/2.8', image_stabilization: 'No', autofocus: 'Autofocus', original_box: 'Yes', warranty: 'No warranty', receipt_available: 'Yes' },
  desc: commonDesc('The G2 update with improved AF and USB-C dock compatibility. Pristine glass, caps, hood, box, receipt.') });
listing({ sub: 'canon-ef', brand: 'Canon', model: 'EF 50mm f/1.8 STM', title: 'Canon EF 50mm f/1.8 STM (Good)', price: 22000, condition: 'good',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 14, views: 132, favs: 3, phone: '0771234567',
  attrs: { mount: 'Canon EF', focal_length: '50mm', max_aperture: 'f/1.8', image_stabilization: 'No', autofocus: 'Autofocus', original_box: 'No', warranty: 'No warranty', receipt_available: 'No' },
  desc: commonDesc('The nifty fifty. AF works perfectly, some cosmetic marks. Both caps.') });
listing({ sub: 'sony-e', brand: 'Sony', model: 'FE 50mm f/1.8', title: 'Sony FE 50mm f/1.8 (Excellent)', price: 55000, condition: 'excellent',
  seller: dilani, city: 'Galle', daysAgo: 12, views: 167, favs: 6, phone: '0703332211',
  attrs: { mount: 'Sony E', focal_length: '50mm', max_aperture: 'f/1.8', image_stabilization: 'No', autofocus: 'Autofocus', original_box: 'Yes', warranty: 'No warranty', receipt_available: 'Yes' },
  desc: commonDesc('Light, sharp full-frame prime. Boxed with caps and receipt. No fungus, smooth focus.') });
listing({ sub: 'canon-rf', brand: 'Canon', model: 'RF 24-105mm f/4L IS USM', title: 'Canon RF 24-105mm f/4L IS USM (Like New)', price: 165000, condition: 'like_new',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 5, views: 209, favs: 7, receipt: true, warranty: 'Shop warranty', phone: '0771234567',
  attrs: { mount: 'Canon RF', focal_length: '24-105mm', max_aperture: 'f/4', image_stabilization: 'Yes', autofocus: 'Autofocus', original_box: 'Yes', warranty: 'Shop warranty', receipt_available: 'Yes' },
  desc: commonDesc('L-series red-ring zoom with effective IS, boxed and under shop warranty. Hood, pouch, caps included.') });
listing({ sub: 'fujifilm-x', brand: 'Fujifilm', model: 'XF 35mm f/1.4 R', title: 'Fujifilm XF 35mm f/1.4 R (Good)', price: 75000, condition: 'good',
  seller: kasun, city: 'Kandy', daysAgo: 16, views: 128, favs: 5, phone: '0765554433',
  attrs: { mount: 'Fujifilm X', focal_length: '35mm', max_aperture: 'f/1.4', image_stabilization: 'No', autofocus: 'Autofocus', original_box: 'Yes', warranty: 'No warranty', receipt_available: 'No' },
  desc: commonDesc('Character-filled fast normal for Fuji X. Glass clean; AF a little audible as typical for this model. Hood and box.') });
listing({ sub: 'sony-e', brand: 'Tamron', model: '70-180mm f/2.8 Di III VXD', title: 'Tamron 70-180mm f/2.8 (Sony E)', price: 145000, condition: 'excellent',
  seller: nimal, city: 'Colombo', daysAgo: 8, views: 174, favs: 8, phone: '0777654321', receipt: true,
  attrs: { mount: 'Sony E', focal_length: '70-180mm', max_aperture: 'f/2.8', image_stabilization: 'No', autofocus: 'Autofocus', original_box: 'Yes', warranty: 'No warranty', receipt_available: 'Yes' },
  desc: commonDesc('Lightweight f/2.8 tele zoom, sharp wide open. Tripod collar, caps, hood, box and receipt.') });

// ---- Action cameras ----
listing({ sub: 'gopro', brand: 'GoPro', model: 'HERO 12 Black', title: 'GoPro HERO 12 Black + Accessories (Excellent)', price: 78000, condition: 'excellent',
  seller: samanthi, city: 'Negombo', daysAgo: 4, views: 245, favs: 12, phone: '0718887766', receipt: true,
  attrs: { resolution: '5.3K', accessories_included: '2 Enduro batteries, chest mount, curved mounts, 64GB card', battery_count: 2, original_box: 'Yes', warranty: 'Shop warranty', receipt_available: 'Yes' },
  desc: commonDesc('HERO 12 Black used on two trips. Two Enduro batteries (both healthy), mounts, card, box and receipt. Waterproof seals inspected.') });
listing({ sub: 'gopro', brand: 'GoPro', model: 'HERO 13 Black', title: 'GoPro HERO 13 Black, Sealed (Brand New)', price: 92000, condition: 'brand_new',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 2, views: 231, favs: 9, featured: true, receipt: true, warranty: 'Manufacturer warranty', phone: '0771234567',
  attrs: { resolution: '5.3K', accessories_included: 'Standard retail kit', battery_count: 1, original_box: 'Yes', warranty: 'Manufacturer warranty', receipt_available: 'Yes' },
  desc: commonDesc('Brand new sealed HERO 13 Black with HB-series lens support. Local stock with receipt and manufacturer warranty.') });
listing({ sub: 'dji-action', brand: 'DJI', model: 'Osmo Action 4', title: 'DJI Osmo Action 4 Adventure Combo (Good)', price: 62000, condition: 'good',
  seller: kasun, city: 'Kandy', daysAgo: 9, views: 187, favs: 6, phone: '0765554433',
  attrs: { resolution: '4K', accessories_included: 'Adventure Combo: 3 batteries, charging case, mounts', battery_count: 3, original_box: 'Yes', warranty: 'No warranty', receipt_available: 'Yes' },
  desc: commonDesc('Action 4 with 1/1.3" sensor, adventure combo with three batteries. One tiny mark on the frame; screens and seals perfect. Box and receipt.') });
listing({ sub: 'dji-action', brand: 'DJI', model: 'Osmo Action 5 Pro', title: 'DJI Osmo Action 5 Pro Standard (Like New)', price: 84000, condition: 'like_new',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 3, views: 156, favs: 5, receipt: true, warranty: 'Manufacturer warranty', phone: '0771234567',
  attrs: { resolution: '4K', accessories_included: 'Standard kit, magnetic mount', battery_count: 1, original_box: 'Yes', warranty: 'Manufacturer warranty', receipt_available: 'Yes' },
  desc: commonDesc('Latest Action 5 Pro with huge battery life. Opened, tested once, essentially new. Receipt and warranty.') });
listing({ sub: 'insta360', brand: 'Insta360', model: 'X4', title: 'Insta360 X4 8K 360 Camera (Like New)', price: 98000, condition: 'like_new',
  seller: dilani, city: 'Galle', daysAgo: 7, views: 142, favs: 7, phone: '0703332211', receipt: true,
  attrs: { resolution: '5.3K', accessories_included: 'Invisible stick, lens guards, extra battery', battery_count: 2, original_box: 'Yes', warranty: 'No warranty', receipt_available: 'Yes' },
  desc: commonDesc('8K 360 camera with stitch-any-reframe workflow. Lens guards fitted since day one. Two batteries, invisible stick, box, receipt.') });
listing({ sub: 'gopro', brand: 'GoPro', model: 'HERO 10 Black', title: 'GoPro HERO 10 Black — Fair, Working', price: 48000, condition: 'fair',
  seller: nimal, city: 'Colombo', daysAgo: 20, views: 98, favs: 2, phone: '0777654321',
  attrs: { resolution: '5.3K', accessories_included: '1 battery, mount', battery_count: 1, original_box: 'No', warranty: 'No warranty', receipt_available: 'No' },
  desc: commonDesc('HERO 10 used hard for two years — scratches on the body but records 5.3K fine. Battery lasts about 70 minutes. Budget action cam, priced accordingly.') });

// ---- Drones ----
listing({ sub: 'dji', brand: 'DJI', model: 'Mini 3', title: 'DJI Mini 3 (DJI RC) + Fly More Kit (Good)', price: 135000, condition: 'good',
  seller: kasun, city: 'Kandy', daysAgo: 5, views: 276, favs: 11, phone: '0765554433', receipt: true,
  attrs: { flight_time: 38, camera_resolution: '4K/30fps, 48MP', battery_count: 3, controller_included: 'DJI RC', accessories: 'Fly More case, extra props, ND set', registration_info: 'Under 250g — no registration required', original_box: 'Yes', warranty: 'No warranty', receipt_available: 'Yes' },
  desc: commonDesc('Mini 3 with the screen-equipped DJI RC and Fly More combo — three batteries (cycles 18, 16, 19), charging hub, ND filters, case, box and receipt. Will fly-test in Kandy.') });
listing({ sub: 'dji', brand: 'DJI', model: 'Mini 4 Pro', title: 'DJI Mini 4 Pro Fly More Combo (Like New)', price: 235000, condition: 'like_new',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 2, views: 342, favs: 15, featured: true, receipt: true, warranty: 'DJI Care Refresh', phone: '0771234567',
  attrs: { flight_time: 34, camera_resolution: '4K/100fps HDR, 48MP', battery_count: 3, controller_included: 'DJI RC 2', accessories: 'Fly More combo, ND filters, case', registration_info: 'Under 249g', original_box: 'Yes', warranty: 'DJI Care Refresh', receipt_available: 'Yes' },
  desc: commonDesc('Mini 4 Pro with omnidirectional obstacle sensing, RC 2 controller, 3 batteries with low cycles, Care Refresh valid for 4 more months. Full activation unlink in-store; box and receipt.') });
listing({ sub: 'dji', brand: 'DJI', model: 'Air 3', title: 'DJI Air 3 (RC-N3) Dual Camera (Excellent)', price: 320000, condition: 'excellent',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 6, views: 203, favs: 8, receipt: true, warranty: 'Manufacturer warranty', phone: '0771234567',
  attrs: { flight_time: 46, camera_resolution: '4K/100, dual 24mm + 70mm', battery_count: 2, controller_included: 'RC-N3', accessories: 'Case, extra props', registration_info: 'Buyer handles CAA registration', original_box: 'Yes', warranty: 'Manufacturer warranty', receipt_available: 'Yes' },
  desc: commonDesc('Air 3 with dual 1/1.3" cameras, two batteries (low cycles), boxed with receipt. Over 249g — registration guidance provided.') });
listing({ sub: 'dji', brand: 'DJI', model: 'Neo', title: 'DJI Neo Drone (Like New)', price: 68000, condition: 'like_new',
  seller: samanthi, city: 'Negombo', daysAgo: 8, views: 131, favs: 6, phone: '0718887766', receipt: true,
  attrs: { flight_time: 18, camera_resolution: '4K/30fps', battery_count: 2, controller_included: 'No', accessories: 'Two batteries, prop guards', registration_info: '135g, no registration required', original_box: 'Yes', warranty: 'No warranty', receipt_available: 'Yes' },
  desc: commonDesc('Palm-sized selfie drone controlled by phone or gestures (controller not included — flies with DJI Fly app). Two batteries, guards, box, receipt.') });

// ---- Accessories ----
listing({ sub: 'tripods', brand: 'Manfrotto', model: '190X Aluminium Tripod', title: 'Manfrotto 190X Tripod + MVH400 Head (Excellent)', price: 28000, condition: 'excellent',
  seller: nimal, city: 'Colombo', daysAgo: 12, views: 87, favs: 2, phone: '0777654321',
  attrs: { brand: 'Manfrotto', model: '190X + MVH400', compatibility: 'Universal Arca/Manfrotto plate', original_box: 'No', warranty: 'No warranty', receipt_available: 'No' },
  desc: commonDesc('Sturdy aluminium legs with fluid video head. Leg locks and pan all smooth.') });
listing({ sub: 'flashes', brand: 'Godox', model: 'TT600 Speedlite', title: 'Godox TT600 Speedlite + Trigger (Good)', price: 18000, condition: 'good',
  seller: dilani, city: 'Galle', daysAgo: 17, views: 64, favs: 1, phone: '0703332211',
  attrs: { brand: 'Godox', model: 'TT600 + X2T trigger', compatibility: 'Universal manual / brand trigger', original_box: 'Yes', warranty: 'No warranty', receipt_available: 'No' },
  desc: commonDesc('Manual speedlite with X2T Sony trigger, stands, brollies and bag. Everything fires; some scuffs.') });
listing({ sub: 'gimbals', brand: 'DJI', model: 'RS 3 Mini', title: 'DJI RS 3 Mini Gimbal (Like New)', price: 35000, condition: 'like_new',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 9, views: 99, favs: 3, receipt: true, phone: '0771234567',
  attrs: { brand: 'DJI', model: 'RS 3 Mini', compatibility: 'Mirrorless up to 2kg', original_box: 'Yes', warranty: 'No warranty', receipt_available: 'Yes' },
  desc: commonDesc('Compact mirrorless gimbal, used twice, with case, tripod grip and box. Balanced for Sony A7 + small zoom.') });
listing({ sub: 'memory-cards', brand: 'SanDisk', model: 'Extreme PRO 128GB SDXC', title: 'SanDisk Extreme PRO 128GB V30 (Brand New)', price: 6500, condition: 'brand_new',
  seller: shopUserId, shop: apertureId, city: 'Colombo', daysAgo: 1, views: 51, favs: 0, receipt: true, phone: '0771234567',
  attrs: { brand: 'SanDisk', model: 'Extreme PRO 128GB V30', compatibility: 'SDXC cameras', original_box: 'Yes', warranty: 'Manufacturer warranty', receipt_available: 'Yes' },
  desc: commonDesc('Genuine sealed SanDisk Extreme PRO 128GB U3 V30 — 200MB/s read. Beware of fakes; this is local stock with receipt.') });
listing({ sub: 'cages', brand: 'SmallRig', model: 'A7 IV Cage', title: 'SmallRig Cage for Sony A7 IV / A7R V', price: 14000, condition: 'good',
  seller: nimal, city: 'Colombo', daysAgo: 15, views: 58, favs: 1, phone: '0777654321',
  attrs: { brand: 'SmallRig', model: '3667 cage', compatibility: 'Sony A7 IV / A7R V / A7S III', original_box: 'No', warranty: 'No warranty', receipt_available: 'No' },
  desc: commonDesc('SmallRig cage with cold shoe and ARRI mounts; a few torx marks, structurally perfect.') });

// ---- Demo seller lifecycle listings (tabs demo) ----
listing({ sub: 'mirrorless', brand: 'Canon', model: 'EOS 200D II', title: 'Canon EOS 200D II (Sold — demo)', price: 95000, condition: 'good',
  seller: nimal, city: 'Colombo', daysAgo: 40, views: 401, favs: 10, status: 'sold', phone: '0777654321',
  attrs: { year: 2019, shutter_count: 44000, sensor: 'APS-C', megapixels: 24.1, video_resolution: '4K', kit: 'With kit lens', lens_included: 'Yes', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: 'Sold listing retained for the My Listings demo.' });
listing({ sub: 'dslr', brand: 'Nikon', model: 'D3500', title: 'Nikon D3500 Kit (Expired — demo)', price: 85000, condition: 'good',
  seller: nimal, city: 'Colombo', daysAgo: 70, views: 210, favs: 4, status: 'expired', phone: '0777654321',
  attrs: { year: 2018, shutter_count: 51000, sensor: 'APS-C', megapixels: 24.2, video_resolution: 'Full HD 1080p', kit: 'With kit lens', lens_included: 'Yes', battery_included: 'Yes', charger_included: 'Yes', original_box: 'No', receipt_available: 'No' },
  desc: 'Expired listing retained for the My Listings demo — renewable.' });
listing({ sub: 'mirrorless', brand: 'Canon', model: 'EOS R50', title: 'Canon EOS R50 + RF-S 18-45 (Draft — demo)', price: 0, condition: 'like_new',
  seller: nimal, city: 'Colombo', daysAgo: 2, views: 0, favs: 0, status: 'draft', phone: '0777654321',
  attrs: {}, desc: '' });

// ---- Pending moderation queue ----
listing({ sub: 'mirrorless', brand: 'Sony', model: 'A7 II', title: 'Sony A7 II Body — Pending Review (demo)', price: 280000, condition: 'good',
  seller: kasun, city: 'Kandy', daysAgo: 0, views: 0, status: 'pending', phone: '0765554433',
  attrs: { year: 2016, shutter_count: 71000, sensor: 'Full Frame', megapixels: 24.3, video_resolution: 'Full HD 1080p', kit: 'Body only', battery_included: 'Yes', charger_included: 'Yes', original_box: 'Yes', receipt_available: 'Yes' },
  desc: 'Pending review listing used by the moderation demo.' });
listing({ sub: 'gopro', brand: 'GoPro', model: 'HERO 11 Black', title: 'GoPro HERO 11 Black — Pending Review (demo)', price: 65000, condition: 'excellent',
  seller: dilani, city: 'Galle', daysAgo: 0, views: 0, status: 'pending', phone: '0703332211',
  attrs: { resolution: '5.3K', battery_count: 2, accessories_included: '2 batteries, mounts', original_box: 'Yes', warranty: 'No warranty', receipt_available: 'Yes' },
  desc: 'Pending review listing used by the moderation demo.' });
// one rejected listing with reason
{
  const l = listing({ sub: 'other-cameras', brand: 'Other', model: 'Other camera', title: 'Webcam (rejected demo)', price: 3000, condition: 'good',
    seller: kasun, city: 'Kandy', daysAgo: 1, views: 0, status: 'rejected', phone: '0765554433', attrs: {}, desc: 'A USB webcam — not camera equipment for this marketplace.' });
  db.prepare('UPDATE listings SET rejection_reason=? WHERE id=?').run('This is a computer webcam rather than photographic equipment. Please list under an appropriate marketplace or correct the category.', l);
}

// ---------- favorites for buyer ----------
const favTargets = ['A7 III', '24-70mm f/2.8 DG DN Art', 'Mini 4 Pro', 'HERO 12 Black'];
for (const m of favTargets) {
  const id = listingsByModel[m];
  db.prepare('INSERT INTO favorites (user_id,listing_id,created_at) VALUES (?,?,?)').run(buyerId, id, t - 2 * DAY);
  db.prepare('UPDATE listings SET favorite_count = favorite_count + 1 WHERE id=?').run(id);
}

// ---------- conversation + messages + offer ----------
function notif(userId, type, title, body, href, data = {}) {
  db.prepare('INSERT INTO notifications (user_id,type,title,body,href,data_json,read_at,created_at) VALUES (?,?,?,?,?,?,NULL,?)')
    .run(userId, type, title, body, href, JSON.stringify(data), t - Math.floor(Math.random() * 3600_000));
}
const a7id = listingsByModel['A7 III'];
const convInfo = db.prepare('INSERT INTO conversations (listing_id,buyer_id,seller_id,created_at,updated_at) VALUES (?,?,?,?,?)')
  .run(a7id, buyerId, nimal, t - 2 * DAY, t - 3600_000);
const convId = Number(convInfo.lastInsertRowid);
function msg(sender, body, created, offerId = null) {
  db.prepare('INSERT INTO messages (conversation_id,sender_id,body,offer_id,read_at,created_at) VALUES (?,?,?,?,?,?)')
    .run(convId, sender, body, offerId, sender === buyerId ? t - 1800_000 : null, created);
}
msg(buyerId, 'Hi, is the A7 III still available? Has the sensor ever been cleaned?', t - 2 * DAY);
msg(nimal, 'Yes it is. Sensor was professionally cleaned once at Aperture Cameras, no issues.', t - 2 * DAY + 1200_000, t - 2 * DAY + 1500_000);
const offerInfo = db.prepare(
  'INSERT INTO offers (conversation_id,listing_id,buyer_id,seller_id,amount,currency,status,counter_amount,message,created_at,updated_at) VALUES (?,?,?,?,?, \'LKR\', \'countered\', ?, ?, ?, ?)'
).run(convId, a7id, buyerId, nimal, 300000, 315000, 'Would you accept Rs. 300,000? I can collect this weekend in Colombo.', t - 3600_000, t - 1800_000);
const offerId = Number(offerInfo.lastInsertRowid);
msg(buyerId, 'Would you accept Rs. 300,000? I can collect this weekend in Colombo.', t - 3600_000);
msg(nimal, 'I can do Rs. 315,000 with the extra battery included.', t - 1800_000, offerId);
notif(nimal, 'offer', 'New offer: Rs. 300,000', 'Buyer Demo offered Rs. 300,000 for Sony A7 III', `/chat/?c=${convId}`, { listingId: a7id, offerId });
notif(nimal, 'message', 'New message from Buyer Demo', 'I can do Rs. 315,000 with the extra battery included.', `/chat/?c=${convId}`);
notif(nimal, 'listing_approved', 'Listing approved', 'Your listing "Sony A7 III Body — Excellent, Boxed" is now live.', `/listing/sony-a7-iii-${a7id}`);
notif(buyerId, 'favorite_price', 'Price update on a saved listing', 'A listing you saved has had a price change.', `/listing/sony-a7-iii-${a7id}`);
notif(shopUserId, 'promotion', 'Promotion activated', 'Featured promotion for Canon EOS 90D is now active.', `/my-ads/`);

// ---------- report ----------
db.prepare('INSERT INTO reports (reporter_id,target_type,target_id,reason,details,status,created_at) VALUES (?,?,?,?,?, \'open\', ?)')
  .run(buyerId, 'listing', listingsByModel['HERO 10 Black'], 'possible_scam', 'The seller keeps asking for an advance deposit and refuses an in-person test.', t - DAY);

// ---------- blog posts ----------
for (let i = 0; i < BLOG.length; i++) {
  const p = BLOG[i];
  const cover = `/uploads/seed/blog-${slugify(p.slug)}.svg`;
  const f = path.join(UPLOAD_ROOT, 'seed', `blog-${slugify(p.slug)}.svg`);
  if (!fs.existsSync(f)) generate({ group: i % 2 ? 'lens' : 'camera', title: p.title, angle: 'LANKA LENS GUIDE', file: f });
  db.prepare('INSERT INTO blog_posts (slug,title,excerpt,body_html,cover_url,author,category,published,created_at,updated_at) VALUES (?,?,?,?,?, \'Lanka Lens\', ?,1,?,?)')
    .run(p.slug, p.title, p.excerpt, p.html, cover, p.category, t - i * 5 * DAY, t - i * 5 * DAY);
}

// ---------- content pages ----------
for (const [slug, p] of Object.entries(PAGES)) {
  db.prepare('INSERT INTO pages (slug,title,body_html,updated_at) VALUES (?,?,?,?)').run(slug, p.title, p.html, t);
}

// ---------- audit ----------
db.prepare('INSERT INTO audit_logs (admin_id,action,target_type,target_id,meta_json,created_at) VALUES (?,?,?,?,?,?)')
  .run(adminId, 'seed', 'system', null, '{}', t);

console.log('Seed complete.');
console.log('Users:', db.prepare('SELECT COUNT(*) c FROM users').get().c,
  '| Listings:', db.prepare('SELECT COUNT(*) c FROM listings').get().c,
  '| Categories:', db.prepare('SELECT COUNT(*) c FROM categories').get().c,
  '| Products:', db.prepare('SELECT COUNT(*) c FROM products').get().c,
  '| Locations:', db.prepare('SELECT COUNT(*) c FROM locations').get().c);
console.log('Demo logins -> admin@lankalens.lk/admin12345 · shop@lankalens.lk/shop12345 · seller@lankalens.lk/seller12345 · buyer@lankalens.lk/buyer12345');
