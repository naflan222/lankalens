-- =====================================================================
-- LANKA LENS — relational schema (SQLite)
-- Sri Lanka camera marketplace. Sections 52-54, 72-74 of the spec.
-- =====================================================================

-- ---------- USERS ----------
CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL UNIQUE,
  phone            TEXT,
  password_hash    TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT 'user',           -- user | admin
  avatar_url       TEXT,
  email_verified_at INTEGER,
  phone_verified_at INTEGER,
  status           TEXT NOT NULL DEFAULT 'active',         -- active | suspended
  last_login_at    INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  location_id    INTEGER REFERENCES locations(id),
  city           TEXT,
  bio            TEXT,
  public_email   INTEGER DEFAULT 0,
  updated_at     INTEGER
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL,                               -- email | phone | reset
  token_hash  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at  INTEGER NOT NULL
);

-- ---------- SELLERS / BUSINESSES ----------
CREATE TABLE IF NOT EXISTS seller_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  seller_type      TEXT NOT NULL DEFAULT 'individual',     -- individual | business
  display_name     TEXT,
  contact_phone    TEXT,
  whatsapp_number  TEXT,
  calls_enabled    INTEGER DEFAULT 1,
  whatsapp_enabled INTEGER DEFAULT 1,
  chat_enabled     INTEGER DEFAULT 1,
  verified_phone   INTEGER DEFAULT 0,
  verified_email   INTEGER DEFAULT 0,
  verified_business INTEGER DEFAULT 0,
  rating_sum       INTEGER DEFAULT 0,
  rating_count     INTEGER DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS business_profiles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  seller_id     INTEGER REFERENCES seller_profiles(id) ON DELETE SET NULL,
  shop_name     TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  logo_url      TEXT,
  description   TEXT,
  location_id   INTEGER REFERENCES locations(id),
  address       TEXT,
  phone         TEXT,
  whatsapp      TEXT,
  opening_hours TEXT,
  verified_at   INTEGER,
  status        TEXT NOT NULL DEFAULT 'pending',            -- pending | approved | suspended
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ---------- CATALOG ----------
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  parent_id   INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  icon        TEXT,
  color       TEXT,
  sort_order  INTEGER DEFAULT 0,
  filters_json TEXT                                         -- dynamic filter definitions
);

CREATE TABLE IF NOT EXISTS brands (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,
  slug   TEXT NOT NULL UNIQUE,
  scope  TEXT NOT NULL DEFAULT 'camera',                    -- camera | lens | action | drone | accessory
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS category_brands (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  brand_id    INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, brand_id)
);

-- Canonical product/model database (multiple sellers can list the same model)
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  brand_id    INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                                -- e.g. "A7 III"
  slug        TEXT NOT NULL,
  year        INTEGER,
  attrs_json  TEXT,
  sort_order  INTEGER DEFAULT 0,
  UNIQUE (brand_id, slug)
);

-- ---------- LOCATIONS (Province / District / City) ----------
CREATE TABLE IF NOT EXISTS locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER REFERENCES locations(id) ON DELETE CASCADE,
  level      TEXT NOT NULL,                                 -- province | district | city
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);
CREATE INDEX IF NOT EXISTS idx_locations_level ON locations(level);

-- ---------- LISTINGS ----------
CREATE TABLE IF NOT EXISTS listings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  seller_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id           INTEGER REFERENCES business_profiles(id) ON DELETE SET NULL,
  category_id       INTEGER NOT NULL REFERENCES categories(id),
  brand_id          INTEGER REFERENCES brands(id),
  product_id        INTEGER REFERENCES products(id),
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  price             INTEGER NOT NULL,                       -- LKR, whole rupees
  negotiable        INTEGER DEFAULT 1,
  condition         TEXT NOT NULL,                          -- brand_new | like_new | excellent | good | fair | parts
  status            TEXT NOT NULL DEFAULT 'pending',        -- draft | pending | active | sold | expired | rejected | suspended
  rejection_reason  TEXT,
  location_id       INTEGER REFERENCES locations(id),
  city              TEXT,
  views             INTEGER DEFAULT 0,
  favorite_count    INTEGER DEFAULT 0,
  is_featured       INTEGER DEFAULT 0,
  featured_until    INTEGER,
  contact_phone     TEXT,
  whatsapp_number   TEXT,
  calls_enabled     INTEGER DEFAULT 1,
  whatsapp_enabled  INTEGER DEFAULT 1,
  chat_enabled      INTEGER DEFAULT 1,
  warranty          TEXT,
  receipt_available INTEGER DEFAULT 0,
  reason_selling    TEXT,
  expires_at        INTEGER,
  submitted_at      INTEGER,
  approved_at       INTEGER,
  sold_at           INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_status_cat ON listings(status, category_id);
CREATE INDEX IF NOT EXISTS idx_listings_brand ON listings(brand_id);
CREATE INDEX IF NOT EXISTS idx_listings_product ON listings(product_id);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(created_at);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_location ON listings(location_id);
CREATE INDEX IF NOT EXISTS idx_listings_featured ON listings(is_featured, status);

CREATE TABLE IF NOT EXISTS listing_attributes (
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  k          TEXT NOT NULL,
  v          TEXT,
  PRIMARY KEY (listing_id, k)
);

CREATE TABLE IF NOT EXISTS listing_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  thumb_url   TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_listing ON listing_images(listing_id, sort_order);

-- ---------- SOCIAL / TRADING ----------
CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (listing_id, buyer_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT DEFAULT '',
  image_url       TEXT,
  offer_id        INTEGER,
  read_at         INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS offers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  listing_id      INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'LKR',
  status          TEXT NOT NULL DEFAULT 'pending',           -- pending | accepted | rejected | countered
  counter_amount  INTEGER,
  message         TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  href       TEXT,
  data_json  TEXT,
  read_at    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at, id);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL,                               -- listing | user | message
  target_id   INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'open',                 -- open | investigating | resolved | dismissed
  admin_note  TEXT,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  buyer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id  INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  rating      INTEGER NOT NULL,                            -- 1..5
  comment     TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (buyer_id, listing_id)
);

-- ---------- MONETIZATION (dormant abstraction, section 61-62) ----------
CREATE TABLE IF NOT EXISTS promotion_packages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  description TEXT,
  kind       TEXT NOT NULL DEFAULT 'featured',             -- featured | boost
  days       INTEGER NOT NULL DEFAULT 7,
  price_lkr  INTEGER NOT NULL DEFAULT 0,
  active     INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS promotions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  package_id  INTEGER REFERENCES promotion_packages(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'pending',             -- pending | active | expired | cancelled
  starts_at   INTEGER,
  ends_at     INTEGER,
  payment_id  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id    INTEGER REFERENCES promotion_packages(id) ON DELETE SET NULL,
  amount        INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'LKR',
  provider      TEXT NOT NULL DEFAULT 'none',
  status        TEXT NOT NULL DEFAULT 'pending',            -- pending|processing|successful|failed|cancelled|refunded
  provider_ref  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id  INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount      INTEGER NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'LKR',
  kind        TEXT NOT NULL,                               -- charge | refund | promo_credit
  status      TEXT NOT NULL,
  meta_json   TEXT,
  created_at  INTEGER NOT NULL
);

-- ---------- CONTENT ----------
CREATE TABLE IF NOT EXISTS blog_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  excerpt     TEXT,
  body_html   TEXT NOT NULL,
  cover_url   TEXT,
  author      TEXT DEFAULT 'Lanka Lens',
  category    TEXT DEFAULT 'Camera Guides',
  published   INTEGER DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  body_html  TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER REFERENCES users(id)
);

-- ---------- OPS ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  meta_json   TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  session    TEXT,
  type       TEXT NOT NULL,                                -- listing_view|search|favorite|call|whatsapp|message|offer|listing_create|listing_sold
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  meta_json  TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_listing ON analytics_events(listing_id, type);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id, type);

CREATE TABLE IF NOT EXISTS email_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  html       TEXT NOT NULL,
  sent_at    INTEGER,
  created_at INTEGER NOT NULL
);
