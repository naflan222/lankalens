"""Versioned application schema. Never applied by application startup."""
import re

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    parent_id INTEGER,
    sort INTEGER DEFAULT 0,
    fields TEXT DEFAULT '[]',
    FOREIGN KEY(parent_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provinces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS districts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    province_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY(province_id) REFERENCES provinces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    district_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY(district_id) REFERENCES districts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    phone TEXT DEFAULT '',
    whatsapp TEXT DEFAULT '',
    province TEXT DEFAULT '',
    district TEXT DEFAULT '',
    city TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    verified INTEGER DEFAULT 0,
    email_verified INTEGER DEFAULT 0,
    phone_verified INTEGER DEFAULT 0,
    seller_type TEXT DEFAULT 'individual',
    is_admin INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER,
    expires_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    value TEXT DEFAULT '',
    created_at INTEGER,
    expires_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    slug TEXT,
    price INTEGER DEFAULT 0,
    negotiable INTEGER DEFAULT 0,
    condition TEXT,
    description TEXT DEFAULT '',
    brand TEXT DEFAULT '',
    model TEXT DEFAULT '',
    year TEXT DEFAULT '',
    province TEXT DEFAULT '',
    district TEXT DEFAULT '',
    city TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    featured INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    views INTEGER DEFAULT 0,
    specs TEXT DEFAULT '{}',
    contact_prefs TEXT DEFAULT '{}',
    rejection_reason TEXT DEFAULT '',
    created_at INTEGER,
    updated_at INTEGER,
    expiry_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL,
    listing_id INTEGER NOT NULL,
    created_at INTEGER,
    PRIMARY KEY(user_id, listing_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    buyer_id INTEGER NOT NULL,
    seller_id INTEGER NOT NULL,
    amount INTEGER,
    counter_amount INTEGER,
    message TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at INTEGER,
    FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE,
    FOREIGN KEY(buyer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(seller_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at INTEGER,
    FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT DEFAULT 'info',
    title TEXT DEFAULT '',
    body TEXT DEFAULT '',
    link TEXT DEFAULT '',
    read INTEGER DEFAULT 0,
    created_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    reporter_id INTEGER,
    reason TEXT DEFAULT '',
    details TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    resolution TEXT DEFAULT '',
    resolved_by INTEGER,
    resolved_at INTEGER,
    created_at INTEGER,
    FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    reported_id INTEGER NOT NULL,
    reason TEXT DEFAULT '',
    details TEXT DEFAULT '',
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS contact_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    seller_id INTEGER NOT NULL,
    buyer_id INTEGER,
    kind TEXT DEFAULT '',
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    buyer_id INTEGER NOT NULL,
    listing_id INTEGER,
    stars INTEGER NOT NULL,
    comment TEXT DEFAULT '',
    created_at INTEGER,
    UNIQUE(buyer_id, seller_id),
    FOREIGN KEY(seller_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(buyer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocks (
    user_id INTEGER NOT NULL,
    blocked_id INTEGER NOT NULL,
    created_at INTEGER,
    PRIMARY KEY(user_id, blocked_id)
);

-- Business/shop verification workflow:
--   verification_status: not_submitted -> pending -> approved | rejected
--   rejected -> pending (resubmission). Only `approved` shops get the verified
--   badge, appear in the public shop directory and are publicly viewable.
--   `verified` (0/1) is kept as the fast "show the badge" flag and is only ever
--   set to 1 by an admin approval — never by the owner submitting a profile.
-- Additional seller verification levels can be added later as more
-- verification_status values / columns without a schema rewrite.
CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    logo TEXT DEFAULT '',
    description TEXT DEFAULT '',
    province TEXT DEFAULT '',
    district TEXT DEFAULT '',
    city TEXT DEFAULT '',
    area TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    whatsapp TEXT DEFAULT '',
    opening_hours TEXT DEFAULT '{}',
    verified INTEGER DEFAULT 0,
    business_category TEXT DEFAULT '',
    owner_name TEXT DEFAULT '',
    registration_number TEXT DEFAULT '',
    document TEXT DEFAULT '',
    verification_status TEXT DEFAULT 'not_submitted',
    rejection_reason TEXT DEFAULT '',
    submitted_at INTEGER,
    reviewed_at INTEGER,
    created_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    message TEXT DEFAULT '',
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'Guide',
    excerpt TEXT DEFAULT '',
    body TEXT DEFAULT '',
    image TEXT DEFAULT '',
    author TEXT DEFAULT 'Lanka Lens',
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS brands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_id INTEGER,
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    FOREIGN KEY(brand_id) REFERENCES brands(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT DEFAULT 'LKR',
    package TEXT DEFAULT '',
    package_name TEXT DEFAULT '',
    listing_id INTEGER,
    status TEXT DEFAULT 'pending',
    provider TEXT DEFAULT '',
    created_at INTEGER,
    updated_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    ptype TEXT NOT NULL,
    package_name TEXT DEFAULT '',
    price INTEGER DEFAULT 0,
    duration_days INTEGER DEFAULT 7,
    payment_id INTEGER,
    starts_at INTEGER,
    ends_at INTEGER,
    created_at INTEGER,
    FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER,
    action TEXT DEFAULT '',
    entity TEXT DEFAULT '',
    entity_id INTEGER,
    detail TEXT DEFAULT '',
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS banned_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS blocked_ips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT UNIQUE NOT NULL,
    created_at INTEGER
);
"""

INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status)",
    "CREATE INDEX IF NOT EXISTS idx_listings_user ON listings(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_listings_cat ON listings(category_id)",
    "CREATE INDEX IF NOT EXISTS idx_listings_brand ON listings(brand)",
    "CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price)",
    "CREATE INDEX IF NOT EXISTS idx_listings_expiry ON listings(expiry_at)",
    "CREATE INDEX IF NOT EXISTS idx_listings_featured ON listings(featured)",
    "CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(sender_id, receiver_id)",
    # The conversation list filters on receiver_id alone (unread counts) and on
    # "sender_id = ? OR receiver_id = ?"; the composite index above cannot serve
    # either, so this one is what keeps the inbox off a full table scan.
    "CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, read)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_favorites_listing ON favorites(listing_id)",
    "CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)",
    "CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_messages_listing ON messages(listing_id)",
    "CREATE INDEX IF NOT EXISTS idx_offers_listing ON offers(listing_id)",
    "CREATE INDEX IF NOT EXISTS idx_offers_buyer ON offers(buyer_id)",
    "CREATE INDEX IF NOT EXISTS idx_offers_seller ON offers(seller_id)",
    "CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read)",
    "CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status)",
    "CREATE INDEX IF NOT EXISTS idx_ratings_seller ON ratings(seller_id)",
    "CREATE INDEX IF NOT EXISTS idx_contact_seller ON contact_events(seller_id, kind)",
    "CREATE INDEX IF NOT EXISTS idx_promotions_listing ON promotions(listing_id, ptype)",
]

TABLES = tuple(re.findall(r"CREATE TABLE IF NOT EXISTS (\w+)", SCHEMA))
ID_TABLES = frozenset(re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \(\s*id INTEGER PRIMARY KEY AUTOINCREMENT", SCHEMA))

# Used by read-only startup/pre-deploy checks: detect incomplete schemas, not just tables.
REQUIRED_COLUMNS = {
    name: tuple(re.findall(r"^    (\w+) (?:INTEGER|TEXT|REAL|BLOB)\b", body, re.M))
    for name, body in re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \(\n(.*?)\n\);", SCHEMA, re.S)
}
