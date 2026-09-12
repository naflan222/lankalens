# -*- coding: utf-8 -*-
"""
Lanka Lens — Sri Lankan camera marketplace
Flask + SQLite backend (Part 2: users, listings, search & communication).

Run:  python server/app.py
"""
import os
import re
import json
import time
import sqlite3
import secrets
import hashlib
import uuid
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, request, jsonify, g, abort, send_from_directory
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE_DIR)
DB_PATH = os.path.join(BASE_DIR, "lankalens.db")
UPLOAD_DIR = os.path.join(ROOT, "uploads")

ALLOWED_IMG = {"jpg", "jpeg", "png", "webp", "gif"}
MAX_IMG_BYTES = 8 * 1024 * 1024
PER_PAGE = 24
EXPIRY_DAYS = 30

CONDITIONS = [
    "Brand New",
    "Like New",
    "Excellent",
    "Good",
    "Fair",
    "For Parts / Repair",
]

LISTING_STATUSES = {"active", "pending", "draft", "sold", "expired", "paused"}

REPORT_REASONS = [
    "Scam",
    "Fake product",
    "Wrong information",
    "Duplicate",
    "Wrong category",
    "Prohibited item",
    "Other",
]

# Spec facets shown per top-level category (search filters that adapt by category).
FACET_SPECS = {
    "cameras":       ["shutter_count", "megapixels", "video_resolution", "body_kit"],
    "lenses":        ["mount", "focal_length", "max_aperture", "image_stabilization"],
    "action-cameras": ["resolution"],
    "drones":        ["flight_time", "battery_count"],
    "accessories":   ["compatibility"],
}


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def db():
    """Per-request database connection."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def query(sql, args=(), one=False):
    cur = db().execute(sql, args)
    rows = [dict(r) for r in cur.fetchall()]
    return (rows[0] if rows else None) if one else rows


def execute(sql, args=()):
    cur = db().execute(sql, args)
    db().commit()
    return cur.lastrowid


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
    created_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER,
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

CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    area TEXT DEFAULT '',
    city TEXT DEFAULT '',
    district TEXT DEFAULT '',
    province TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    whatsapp TEXT DEFAULT '',
    description TEXT DEFAULT '',
    specialties TEXT DEFAULT '',
    image TEXT DEFAULT '',
    verified INTEGER DEFAULT 0,
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
"""


def migrate(conn):
    """Add columns introduced after the initial Part 1 schema (idempotent)."""
    def cols(table):
        return {r["name"] for r in [dict(x) for x in conn.execute(f"PRAGMA table_info({table})")]}

    uc = cols("users")
    if "email_verified" not in uc:
        conn.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0")
    if "phone_verified" not in uc:
        conn.execute("ALTER TABLE users ADD COLUMN phone_verified INTEGER DEFAULT 0")
    if "seller_type" not in uc:
        conn.execute("ALTER TABLE users ADD COLUMN seller_type TEXT DEFAULT 'individual'")

    lc = cols("listings")
    if "expiry_at" not in lc:
        conn.execute("ALTER TABLE listings ADD COLUMN expiry_at INTEGER")
    if "contact_prefs" not in lc:
        conn.execute("ALTER TABLE listings ADD COLUMN contact_prefs TEXT DEFAULT '{}'")

    oc = cols("offers")
    if "counter_amount" not in oc:
        conn.execute("ALTER TABLE offers ADD COLUMN counter_amount INTEGER")
    conn.commit()


# ---------------------------------------------------------------------------
# Category & location seed data
# ---------------------------------------------------------------------------
def _f(name, label, ftype="text", options=None, required=False):
    d = {"name": name, "label": label, "type": ftype, "required": required}
    if options:
        d["options"] = options
    return d


CAMERA_FIELDS = [
    _f("brand", "Brand", "select", ["Sony", "Canon", "Nikon", "Fujifilm", "Panasonic", "Olympus", "Leica", "Other"], True),
    _f("model", "Model", "text", required=True),
    _f("year", "Year", "text"),
    _f("shutter_count", "Shutter Count", "number"),
    _f("megapixels", "Megapixels", "text"),
    _f("video_resolution", "Video Resolution", "text"),
    _f("body_kit", "Body / Kit", "select", ["Body Only", "Body + Kit Lens"]),
    _f("lens_included", "Lens Included", "text"),
    _f("battery", "Battery", "text"),
    _f("charger", "Charger", "select", ["Yes", "No"]),
    _f("original_box", "Original Box", "select", ["Yes", "No"]),
    _f("warranty", "Warranty", "text"),
    _f("receipt", "Receipt Available", "select", ["Yes", "No"]),
    _f("reason_for_selling", "Reason for Selling", "textarea"),
]

LENS_FIELDS = [
    _f("brand", "Brand", "select", ["Canon", "Nikon", "Sony", "Fujifilm", "Sigma", "Tamron", "Other"], True),
    _f("model", "Model", "text", required=True),
    _f("mount", "Mount", "select", ["Canon EF", "Canon RF", "Nikon F", "Nikon Z", "Sony E", "Fujifilm X", "Micro Four Thirds", "Other"], True),
    _f("focal_length", "Focal Length", "text"),
    _f("max_aperture", "Maximum Aperture", "text"),
    _f("image_stabilization", "Image Stabilization", "select", ["Yes", "No"]),
    _f("autofocus", "Autofocus", "select", ["Yes", "No"]),
    _f("warranty", "Warranty", "text"),
    _f("receipt", "Receipt Available", "select", ["Yes", "No"]),
]

ACTION_FIELDS = [
    _f("brand", "Brand", "select", ["GoPro", "DJI", "Insta360", "Other"], True),
    _f("model", "Model", "text", required=True),
    _f("resolution", "Resolution", "text"),
    _f("batteries", "Batteries", "text"),
    _f("accessories", "Accessories", "text"),
    _f("box", "Original Box", "select", ["Yes", "No"]),
    _f("warranty", "Warranty", "text"),
]

DRONE_FIELDS = [
    _f("brand", "Brand", "select", ["DJI", "Autel", "Other"], True),
    _f("model", "Model", "text", required=True),
    _f("flight_time", "Flight Time", "text"),
    _f("battery_count", "Battery Count", "text"),
    _f("controller", "Controller", "text"),
    _f("accessories", "Accessories", "text"),
    _f("box", "Original Box", "select", ["Yes", "No"]),
    _f("warranty", "Warranty", "text"),
]

ACCESSORY_FIELDS = [
    _f("brand", "Brand", "select", ["Manfrotto", "Zhiyun", "Godox", "SanDisk", "Rode", "Peak Design", "Lowepro", "DJI", "Other"], True),
    _f("model", "Model", "text", required=True),
    _f("compatibility", "Compatibility", "text"),
    _f("warranty", "Warranty", "text"),
    _f("receipt", "Receipt Available", "select", ["Yes", "No"]),
]

CATEGORIES = [
    # (slug, name, icon, parent, sort, fields)
    ("cameras", "Cameras", "camera-outline", None, 1, "[]"),
    ("dslr", "DSLR", "camera-outline", "cameras", 1, json.dumps(CAMERA_FIELDS)),
    ("mirrorless", "Mirrorless", "camera-outline", "cameras", 2, json.dumps(CAMERA_FIELDS)),
    ("compact", "Compact", "camera-outline", "cameras", 3, json.dumps(CAMERA_FIELDS)),
    ("cinema-cameras", "Cinema Cameras", "videocam-outline", "cameras", 4, json.dumps(CAMERA_FIELDS)),
    ("other-cameras", "Other Cameras", "camera-outline", "cameras", 5, json.dumps(CAMERA_FIELDS)),

    ("lenses", "Lenses", "aperture-outline", None, 2, json.dumps(LENS_FIELDS)),
    ("lens-canon", "Canon", "aperture-outline", "lenses", 1, "[]"),
    ("lens-nikon", "Nikon", "aperture-outline", "lenses", 2, "[]"),
    ("lens-sony", "Sony", "aperture-outline", "lenses", 3, "[]"),
    ("lens-fujifilm", "Fujifilm", "aperture-outline", "lenses", 4, "[]"),
    ("lens-sigma", "Sigma", "aperture-outline", "lenses", 5, "[]"),
    ("lens-tamron", "Tamron", "aperture-outline", "lenses", 6, "[]"),
    ("lens-other", "Other", "aperture-outline", "lenses", 7, "[]"),

    ("action-cameras", "Action Cameras", "videocam-outline", None, 3, json.dumps(ACTION_FIELDS)),
    ("gopro", "GoPro", "videocam-outline", "action-cameras", 1, "[]"),
    ("dji-action", "DJI Action", "videocam-outline", "action-cameras", 2, "[]"),
    ("insta360", "Insta360", "videocam-outline", "action-cameras", 3, "[]"),
    ("action-other", "Other", "videocam-outline", "action-cameras", 4, "[]"),

    ("drones", "Drones", "navigate-outline", None, 4, json.dumps(DRONE_FIELDS)),
    ("drone-dji", "DJI", "navigate-outline", "drones", 1, "[]"),
    ("drone-autel", "Autel", "navigate-outline", "drones", 2, "[]"),
    ("drone-other", "Other", "navigate-outline", "drones", 3, "[]"),

    ("accessories", "Accessories", "layers-outline", None, 5, json.dumps(ACCESSORY_FIELDS)),
    ("tripods", "Tripods", "layers-outline", "accessories", 1, "[]"),
    ("gimbals", "Gimbals", "layers-outline", "accessories", 2, "[]"),
    ("camera-bags", "Camera Bags", "bag-handle-outline", "accessories", 3, "[]"),
    ("batteries", "Batteries", "battery-full-outline", "accessories", 4, "[]"),
    ("chargers", "Chargers", "battery-charging-outline", "accessories", 5, "[]"),
    ("memory-cards", "Memory Cards", "albums-outline", "accessories", 6, "[]"),
    ("filters", "Filters", "aperture-outline", "accessories", 7, "[]"),
    ("flashes", "Flashes", "flash-outline", "accessories", 8, "[]"),
    ("microphones", "Microphones", "mic-outline", "accessories", 9, "[]"),
    ("lights", "Lights", "bulb-outline", "accessories", 10, "[]"),
    ("gopro-accessories", "GoPro Accessories", "videocam-outline", "accessories", 11, "[]"),
    ("dji-accessories", "DJI Accessories", "navigate-outline", "accessories", 12, "[]"),
    ("accessories-other", "Other", "layers-outline", "accessories", 13, "[]"),
]

PROVINCES = {
    "Western Province": {
        "Colombo": ["Colombo", "Dehiwala-Mount Lavinia", "Moratuwa", "Negombo", "Nugegoda", "Maharagama", "Battaramulla"],
        "Gampaha": ["Gampaha", "Negombo", "Ja-Ela", "Kandana", "Minuwangoda"],
        "Kalutara": ["Kalutara", "Panadura", "Beruwala", "Horana"],
    },
    "Central Province": {
        "Kandy": ["Kandy", "Peradeniya", "Gampola", "Katugastota"],
        "Matale": ["Matale", "Dambulla"],
        "Nuwara Eliya": ["Nuwara Eliya", "Hatton"],
    },
    "Southern Province": {
        "Galle": ["Galle", "Hikkaduwa", "Ambalangoda"],
        "Matara": ["Matara", "Weligama", "Mirissa"],
        "Hambantota": ["Hambantota", "Tangalle", "Tissamaharama"],
    },
    "Northern Province": {
        "Jaffna": ["Jaffna", "Chavakachcheri", "Point Pedro"],
        "Kilinochchi": ["Kilinochchi"],
        "Mannar": ["Mannar"],
        "Vavuniya": ["Vavuniya"],
        "Mullaitivu": ["Mullaitivu"],
    },
    "Eastern Province": {
        "Trincomalee": ["Trincomalee", "Kinniya"],
        "Batticaloa": ["Batticaloa", "Kalmunai"],
        "Ampara": ["Ampara", "Akkaraipattu"],
    },
    "North Western Province": {
        "Kurunegala": ["Kurunegala", "Kuliyapitiya"],
        "Puttalam": ["Puttalam", "Chilaw"],
    },
    "North Central Province": {
        "Anuradhapura": ["Anuradhapura", "Kekirawa"],
        "Polonnaruwa": ["Polonnaruwa"],
    },
    "Uva Province": {
        "Badulla": ["Badulla", "Bandarawela", "Haputale"],
        "Monaragala": ["Monaragala", "Wellawaya"],
    },
    "Sabaragamuwa Province": {
        "Ratnapura": ["Ratnapura", "Embilipitiya"],
        "Kegalle": ["Kegalle", "Mawanella"],
    },
}

BRANDS = [
    ("Sony", "Cameras"), ("Canon", "Cameras"), ("Nikon", "Cameras"),
    ("Fujifilm", "Cameras"), ("Panasonic", "Cameras"), ("Olympus", "Cameras"),
    ("Sigma", "Lenses"), ("Tamron", "Lenses"), ("Tokina", "Lenses"),
    ("GoPro", "Action Cameras"), ("DJI", "Drones"), ("Autel", "Drones"),
    ("Insta360", "Action Cameras"), ("Manfrotto", "Accessories"),
    ("Zhiyun", "Accessories"), ("Godox", "Accessories"), ("SanDisk", "Accessories"),
    ("Rode", "Accessories"), ("Peak Design", "Accessories"), ("Lowepro", "Accessories"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def hash_password(pw):
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${h}"


def verify_password(pw, stored):
    try:
        salt, h = stored.split("$", 1)
        return hmac_compare(h, hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 120_000).hex())
    except Exception:
        return False


def hmac_compare(a, b):
    return secrets.compare_digest(a, b)


def now():
    return int(time.time())


def slugify(text):
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return text or "item"


def public_user(row):
    if not row:
        return None
    return {
        "id": row["id"], "name": row["name"], "phone": row["phone"],
        "whatsapp": row["whatsapp"], "province": row["province"],
        "district": row["district"], "city": row["city"], "bio": row["bio"],
        "avatar": row["avatar"], "verified": bool(row["verified"]),
        "seller_type": row.get("seller_type") or "individual",
        "created_at": row["created_at"],
    }


def seller_rating(uid):
    row = query(
        "SELECT COUNT(*) n, COALESCE(AVG(stars), 0) avg FROM ratings WHERE seller_id = ?",
        (uid,), one=True)
    return {"count": row["n"], "avg": round(row["avg"], 1)}


def category_tree():
    cats = query("SELECT * FROM categories ORDER BY sort, id")
    by_id = {c["id"]: dict(c) for c in cats}
    for c in by_id.values():
        c["fields"] = json.loads(c["fields"]) if c["fields"] else []
        c["children"] = []
    roots = []
    for c in cats:
        node = by_id[c["id"]]
        if node["parent_id"] and node["parent_id"] in by_id:
            by_id[node["parent_id"]]["children"].append(node)
        else:
            roots.append(node)
    return roots


def _top_category_for(cat_id):
    """Return the top-level category slug/name for a (possibly nested) category."""
    cat = query("SELECT id, slug, name, parent_id FROM categories WHERE id = ?", (cat_id,), one=True)
    while cat and cat["parent_id"]:
        parent = query("SELECT id, slug, name, parent_id FROM categories WHERE id = ?", (cat["parent_id"],), one=True)
        if not parent:
            break
        cat = parent
    return cat


def serialize_listing(l, include_seller=True):
    images = json.loads(l.get("images") or "[]")
    specs = json.loads(l.get("specs") or "{}")
    prefs = json.loads(l.get("contact_prefs") or "{}")
    if not isinstance(prefs, dict):
        prefs = {}
    status = l.get("status")
    expiry = l.get("expiry_at")
    # Effective status: an active listing past its expiry date reads as expired.
    if status == "active" and expiry and int(expiry) < now():
        status = "expired"
    out = {
        "id": l["id"],
        "title": l["title"],
        "slug": l.get("slug") or slugify(l["title"]),
        "price": l.get("price") or 0,
        "negotiable": bool(l.get("negotiable")),
        "condition": l.get("condition"),
        "brand": l.get("brand") or "",
        "model": l.get("model") or "",
        "year": l.get("year") or "",
        "province": l.get("province") or "",
        "district": l.get("district") or "",
        "city": l.get("city") or "",
        "location": ", ".join([x for x in [l.get("city"), l.get("province")] if x]),
        "images": images,
        "featured": bool(l.get("featured")),
        "status": status,
        "views": l.get("views") or 0,
        "specs": specs,
        "contact_prefs": prefs,
        "description": l.get("description") or "",
        "created_at": l.get("created_at"),
        "updated_at": l.get("updated_at"),
        "expiry_at": expiry,
        "category_id": l.get("category_id"),
    }
    if l.get("category_name"):
        out["category_name"] = l["category_name"]
    if l.get("category_slug"):
        out["category_slug"] = l["category_slug"]
    if include_seller:
        seller = query(
            "SELECT id, name, phone, whatsapp, province, district, city, bio, avatar, verified, seller_type, created_at FROM users WHERE id = ?",
            (l["user_id"],), one=True)
        if seller:
            out["seller"] = public_user(seller)
            biz = query("SELECT id, name, slug, logo FROM businesses WHERE user_id = ?", (seller["id"],), one=True)
            if biz:
                out["seller"]["business"] = {"id": biz["id"], "name": biz["name"], "slug": biz["slug"], "logo": biz["logo"]}
    return out


def listing_query_base():
    return (
        "SELECT l.*, c.name AS category_name, c.slug AS category_slug "
        "FROM listings l JOIN categories c ON c.id = l.category_id "
    )


def expire_overdue():
    """Mark past-due active listings as expired (cheap, run on read)."""
    execute("UPDATE listings SET status = 'expired' WHERE status = 'active' AND expiry_at IS NOT NULL AND expiry_at < ?", (now(),))


def notify(user_id, type_, title, body, link="", dedupe=None):
    if dedupe:
        row = query(
            "SELECT id FROM notifications WHERE user_id = ? AND type = ? AND link = ? LIMIT 1",
            (user_id, type_, dedupe), one=True)
        if row:
            return
    execute(
        "INSERT INTO notifications (user_id, type, title, body, link, read, created_at) VALUES (?,?,?,?,?,0,?)",
        (user_id, type_, title, body, link, now()))


def make_token(user_id, kind, value="", ttl=3600):
    token = secrets.token_hex(32)
    execute("DELETE FROM tokens WHERE user_id = ? AND kind = ?", (user_id, kind))
    execute("INSERT INTO tokens (token, user_id, kind, value, created_at, expires_at) VALUES (?,?,?,?,?,?)",
            (token, user_id, kind, value, now(), now() + ttl))
    return token


def consume_token(token, kind):
    row = query("SELECT * FROM tokens WHERE token = ? AND kind = ?", (token, kind), one=True)
    if not row:
        return None
    if row["expires_at"] and row["expires_at"] < now():
        execute("DELETE FROM tokens WHERE token = ?", (token,))
        return None
    return row


def record_contact(listing_id, seller_id, buyer_id, kind):
    if buyer_id and buyer_id == seller_id:
        return
    execute("INSERT INTO contact_events (listing_id, seller_id, buyer_id, kind, created_at) VALUES (?,?,?,?,?)",
            (listing_id, seller_id, buyer_id, kind, now()))


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def current_user():
    token = request.headers.get("Authorization", "")
    if token.startswith("Bearer "):
        token = token[7:]
    if not token:
        return None
    row = query(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
        (token,), one=True)
    return row


def require_auth():
    u = current_user()
    if not u:
        abort(401, description="Authentication required")
    return u


def user_payload(u):
    return {
        "id": u["id"], "name": u["name"], "email": u["email"],
        "phone": u["phone"], "whatsapp": u["whatsapp"],
        "province": u["province"], "district": u["district"], "city": u["city"],
        "bio": u["bio"], "avatar": u["avatar"], "verified": bool(u["verified"]),
        "email_verified": bool(u.get("email_verified")),
        "phone_verified": bool(u.get("phone_verified")),
        "seller_type": u.get("seller_type") or "individual",
        "is_admin": bool(u["is_admin"]), "created_at": u["created_at"],
    }


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def ok(data=None, **kw):
    return jsonify({"ok": True, "data": data, **kw})


def err(message, code=400):
    return jsonify({"ok": False, "error": message}), code


@app.errorhandler(400)
@app.errorhandler(401)
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(413)
def handle_http_error(e):
    return jsonify({"ok": False, "error": getattr(e, "description", None) or e.name}), e.code


# ---------------------------------------------------------------------------
# Static serving (whitelisted)
# ---------------------------------------------------------------------------
SAFE_DIRS = {"css", "js", "images", "icons", "fonts", "uploads"}


@app.route("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.route("/favicon.svg")
def favicon_svg():
    return send_from_directory(ROOT, "favicon.svg")


@app.route("/<path:filename>")
def static_files(filename):
    if filename.startswith("."):
        abort(404)
    seg = filename.split("/", 1)[0]
    if seg in SAFE_DIRS:
        return send_from_directory(ROOT, filename)
    if "/" not in filename and filename.endswith(".html"):
        return send_from_directory(ROOT, filename)
    abort(404)


# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------
@app.route("/api/health")
def health():
    return ok({"status": "up", "time": now()})


@app.route("/api/meta")
def meta():
    return ok({
        "categories": category_tree(),
        "conditions": CONDITIONS,
        "brands": [r["name"] for r in query("SELECT name FROM brands ORDER BY name")],
        "report_reasons": REPORT_REASONS,
    })


@app.route("/api/categories")
def categories():
    return ok(category_tree())


@app.route("/api/locations")
def locations():
    provs = query("SELECT * FROM provinces ORDER BY id")
    out = []
    for p in provs:
        dists = query("SELECT * FROM districts WHERE province_id = ? ORDER BY id", (p["id"],))
        dd = []
        for d in dists:
            cities = query("SELECT id, name FROM cities WHERE district_id = ? ORDER BY id", (d["id"],))
            dd.append({"id": d["id"], "name": d["name"], "cities": cities})
        out.append({"id": p["id"], "name": p["name"], "districts": dd})
    return ok(out)


@app.route("/api/brands")
def brands():
    rows = query("SELECT name, category FROM brands ORDER BY name")
    return ok(rows)


# ---------------------------------------------------------------------------
# Listings
# ---------------------------------------------------------------------------
def build_listing_where(args):
    conds, params = [], []
    q = (args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        conds.append("(l.title LIKE ? OR l.brand LIKE ? OR l.model LIKE ? OR l.description LIKE ? OR l.specs LIKE ? OR c.name LIKE ?)")
        params += [like, like, like, like, like, like]

    category = (args.get("category") or "").strip()
    subcategory = (args.get("subcategory") or "").strip()
    if subcategory:
        conds.append("c.slug = ?")
        params.append(subcategory)
    elif category:
        conds.append("(c.slug = ? OR c.parent_id = (SELECT id FROM categories WHERE slug = ?))")
        params += [category, category]

    brand = (args.get("brand") or "").strip()
    if brand:
        conds.append("l.brand = ?")
        params.append(brand)

    model = (args.get("model") or "").strip()
    if model:
        like = f"%{model}%"
        conds.append("(l.model LIKE ? OR l.title LIKE ?)")
        params += [like, like]

    condition = (args.get("condition") or "").strip()
    if condition:
        conds.append("l.condition = ?")
        params.append(condition)

    province = (args.get("province") or "").strip()
    district = (args.get("district") or "").strip()
    city = (args.get("city") or "").strip()
    if province:
        conds.append("l.province = ?"); params.append(province)
    if district:
        conds.append("l.district = ?"); params.append(district)
    if city:
        conds.append("l.city = ?"); params.append(city)

    try:
        mn = args.get("min"); mx = args.get("max")
        if mn:
            conds.append("l.price >= ?"); params.append(int(mn))
        if mx:
            conds.append("l.price <= ?"); params.append(int(mx))
    except (TypeError, ValueError):
        pass

    if args.get("featured") == "1":
        conds.append("l.featured = 1")

    # Generic spec filters: spec_<field>=value (exact),
    # spec_<field>_min / spec_<field>_max (numeric range).
    for key in list(args.keys()):
        val = args.get(key)
        if not val:
            continue
        if key.startswith("spec_"):
            field = key[5:]
            if field.endswith("_min"):
                f = field[:-4]
                try:
                    conds.append(f"CAST(REPLACE(json_extract(l.specs, ?), ',', '') AS INTEGER) >= ?")
                    params += [f"$.{f}", int(val)]
                except ValueError:
                    pass
            elif field.endswith("_max"):
                f = field[:-4]
                try:
                    conds.append(f"CAST(REPLACE(json_extract(l.specs, ?), ',', '') AS INTEGER) <= ?")
                    params += [f"$.{f}", int(val)]
                except ValueError:
                    pass
            else:
                conds.append("json_extract(l.specs, ?) = ?")
                params += [f"$.{field}", val]

    if args.get("status"):
        conds.append("l.status = ?"); params.append(args["status"])
    else:
        conds.append("l.status = 'active'")

    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    return where, params


@app.route("/api/listings")
def listings():
    expire_overdue()
    where, params = build_listing_where(request.args)
    sort = request.args.get("sort", "recommended")
    order = {
        "recommended": "l.featured DESC, l.views DESC, l.created_at DESC",
        "newest": "l.created_at DESC",
        "oldest": "l.created_at ASC",
        "price_asc": "l.price ASC",
        "price_desc": "l.price DESC",
        "popular": "l.views DESC",
    }.get(sort, "l.created_at DESC")

    try:
        page = max(1, int(request.args.get("page", 1)))
    except ValueError:
        page = 1
    total = query(f"SELECT COUNT(*) AS n FROM listings l JOIN categories c ON c.id = l.category_id{where}", params, one=True)["n"]

    sql = (listing_query_base() + where + f" ORDER BY {order}, l.id DESC LIMIT ? OFFSET ?")
    rows = query(sql, params + [PER_PAGE, (page - 1) * PER_PAGE])
    data = [serialize_listing(r) for r in rows]
    return ok({"items": data, "total": total, "page": page, "pages": max(1, -(-total // PER_PAGE))})


@app.route("/api/facets")
def facets():
    """Distinct filter values for a top-level category (drives the dynamic filter UI)."""
    top = (request.args.get("category") or "").strip()
    cat = query("SELECT id, slug, name FROM categories WHERE slug = ?", (top,), one=True)
    if not cat:
        return ok({"category": None, "brands": [], "models": [], "specs": {}})
    child_ids = [cat["id"]]
    for c in query("SELECT id FROM categories WHERE parent_id = ?", (cat["id"],)):
        child_ids.append(c["id"])
    ph = ",".join("?" * len(child_ids))
    base_where = f" WHERE l.category_id IN ({ph}) AND l.status = 'active'"
    brands = [r["v"] for r in query(f"SELECT DISTINCT l.brand AS v FROM listings l{base_where} AND l.brand != '' ORDER BY l.brand", child_ids)]
    models = [r["v"] for r in query(f"SELECT DISTINCT l.model AS v FROM listings l{base_where} AND l.model != '' ORDER BY l.model", child_ids)]
    specs = {}
    for field in FACET_SPECS.get(top, []):
        vals = [r["v"] for r in query(
            f"SELECT DISTINCT json_extract(l.specs, ?) AS v FROM listings l{base_where} "
            f"AND json_extract(l.specs, ?) IS NOT NULL AND json_extract(l.specs, ?) != '' ORDER BY v",
            [f"$.{field}"] + child_ids + [f"$.{field}", f"$.{field}"])]
        specs[field] = vals
    return ok({"category": {"id": cat["id"], "slug": cat["slug"], "name": cat["name"]}, "brands": brands, "models": models, "specs": specs})


@app.route("/api/listings/<int:lid>")
def listing_detail(lid):
    expire_overdue()
    row = query(listing_query_base() + " WHERE l.id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    if row["status"] != "active":
        u = current_user()
        if not u or (u["id"] != row["user_id"] and not u["is_admin"]):
            return err("Listing not found", 404)
    else:
        execute("UPDATE listings SET views = views + 1 WHERE id = ?", (lid,))
        row["views"] = (row["views"] or 0) + 1
    data = serialize_listing(row)

    cat = query("SELECT * FROM categories WHERE id = ?", (row["category_id"],), one=True)
    parent = None
    if cat and cat["parent_id"]:
        parent = query("SELECT * FROM categories WHERE id = ?", (cat["parent_id"],), one=True)
    fields = json.loads((cat and cat["fields"]) or "[]")
    if not fields and parent:
        fields = json.loads(parent["fields"] or "[]")
    data["fields"] = fields
    data["category"] = {"id": cat["id"], "name": cat["name"], "slug": cat["slug"]} if cat else None
    if parent:
        data["top_category"] = {"id": parent["id"], "name": parent["name"], "slug": parent["slug"]}

    # counts for analytics shown to the seller
    data["favorites_count"] = query("SELECT COUNT(*) n FROM favorites WHERE listing_id = ?", (lid,), one=True)["n"]
    data["offers_count"] = query("SELECT COUNT(*) n FROM offers WHERE listing_id = ?", (lid,), one=True)["n"]

    # related
    related = query(
        listing_query_base() + " WHERE c.id = ? AND l.id != ? AND l.status = 'active' ORDER BY l.created_at DESC LIMIT 4",
        (row["category_id"], lid))
    data["related"] = [serialize_listing(r) for r in related]
    return ok(data)


@app.route("/api/listings", methods=["POST"])
def create_listing():
    u = require_auth()
    body = request.get_json(silent=True) or {}
    cat_id = body.get("category_id")
    cat = query("SELECT * FROM categories WHERE id = ?", (cat_id,), one=True) if cat_id else None
    if not cat:
        return err("Please choose a valid category")

    title = (body.get("title") or "").strip()
    if not title:
        return err("Title is required")
    price = body.get("price")
    try:
        price = int(price) if price not in (None, "") else 0
    except (TypeError, ValueError):
        return err("Price must be a number")
    if price < 0:
        return err("Price must be a number")

    images = body.get("images") or []
    if isinstance(images, str):
        images = [images]
    images = [i for i in images if isinstance(i, str) and (i.startswith("/uploads/") or i.startswith("/images/"))][:15]

    specs = body.get("specs") or {}
    if not isinstance(specs, dict):
        specs = {}

    prefs = body.get("contact_prefs") or {}
    if not isinstance(prefs, dict):
        prefs = {}

    status = body.get("status") or "active"
    if status not in ("active", "draft", "pending"):
        status = "active"

    brand = specs.get("brand") or body.get("brand") or ""
    model = specs.get("model") or body.get("model") or ""
    year = specs.get("year") or body.get("year") or ""

    ts = now()
    lid = execute(
        """INSERT INTO listings
           (user_id, category_id, title, slug, price, negotiable, condition, description,
            brand, model, year, province, district, city, images, featured, status, specs,
            contact_prefs, created_at, updated_at, expiry_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)""",
        (u["id"], cat_id, title, slugify(title), price, 1 if body.get("negotiable") else 0,
         body.get("condition") or "Good", body.get("description") or "", brand, model, year,
         body.get("province") or "", body.get("district") or "", body.get("city") or "",
         json.dumps(images), status, json.dumps(specs), json.dumps(prefs), ts, ts,
         ts + EXPIRY_DAYS * 86400))
    if status == "draft":
        notify(u["id"], "listing", "Draft saved", f"Your draft “{title}” was saved.", f"#/my-ads")
    else:
        notify(u["id"], "listing", "Listing published", f"Your ad “{title}” is now live.", f"#/ads/{lid}")
    return ok({"id": lid, "status": status})


@app.route("/api/listings/<int:lid>", methods=["PATCH"])
def update_listing(lid):
    u = require_auth()
    row = query("SELECT * FROM listings WHERE id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    if row["user_id"] != u["id"] and not u["is_admin"]:
        return err("Not allowed", 403)
    body = request.get_json(silent=True) or {}
    sets, params = [], []

    def setf(col, val):
        sets.append(f"{col} = ?")
        params.append(val)

    if "title" in body:
        t = (body["title"] or "").strip()
        if not t:
            return err("Title is required")
        setf("title", t)
        setf("slug", slugify(t))
    if "price" in body:
        try:
            p = int(body["price"])
        except (TypeError, ValueError):
            return err("Price must be a number")
        if p < 0:
            return err("Price must be a number")
        setf("price", p)
    if "negotiable" in body:
        setf("negotiable", 1 if body["negotiable"] else 0)
    if "condition" in body:
        setf("condition", body["condition"])
    if "description" in body:
        setf("description", body["description"])
    if "province" in body:
        setf("province", body["province"])
    if "district" in body:
        setf("district", body["district"])
    if "city" in body:
        setf("city", body["city"])
    if "category_id" in body:
        c = query("SELECT id FROM categories WHERE id = ?", (body["category_id"],), one=True)
        if not c:
            return err("Invalid category")
        setf("category_id", body["category_id"])
    if "images" in body:
        imgs = body["images"] if isinstance(body["images"], list) else []
        imgs = [i for i in imgs if isinstance(i, str) and (i.startswith("/uploads/") or i.startswith("/images/"))][:15]
        setf("images", json.dumps(imgs))
    if "specs" in body and isinstance(body["specs"], dict):
        specs = body["specs"]
        setf("specs", json.dumps(specs))
        if specs.get("brand"):
            setf("brand", specs["brand"])
        if specs.get("model"):
            setf("model", specs["model"])
        if specs.get("year"):
            setf("year", specs["year"])
    if "contact_prefs" in body and isinstance(body["contact_prefs"], dict):
        setf("contact_prefs", json.dumps(body["contact_prefs"]))
    if "status" in body:
        st = body["status"]
        if st not in LISTING_STATUSES:
            return err("Invalid status")
        setf("status", st)
        if st == "active" and not row["expiry_at"]:
            setf("expiry_at", now() + EXPIRY_DAYS * 86400)

    if not sets:
        return ok({"id": lid})
    setf("updated_at", now())
    execute(f"UPDATE listings SET {', '.join(sets)} WHERE id = ?", params + [lid])

    if "status" in body:
        st = body["status"]
        labels = {"active": "published", "pending": "submitted for review", "draft": "saved as draft",
                  "sold": "marked as sold", "expired": "expired", "paused": "paused"}
        notify(u["id"], "listing", f"Listing {labels.get(st, st)}",
               f"“{row['title']}” was {labels.get(st, st)}.", f"#/ads/{lid}")
    if body.get("featured") is not None:
        setf("featured", 1 if body["featured"] else 0)
        execute(f"UPDATE listings SET featured = ? WHERE id = ?", (1 if body["featured"] else 0, lid))
        if body["featured"]:
            notify(u["id"], "promotion", "Listing promoted", f"“{row['title']}” is now featured.", f"#/ads/{lid}")
    return ok({"id": lid})


@app.route("/api/listings/<int:lid>", methods=["DELETE"])
def delete_listing(lid):
    u = require_auth()
    row = query("SELECT * FROM listings WHERE id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    if row["user_id"] != u["id"] and not u["is_admin"]:
        return err("Not allowed", 403)
    execute("DELETE FROM listings WHERE id = ?", (lid,))
    return ok({"deleted": lid})


@app.route("/api/listings/<int:lid>/renew", methods=["POST"])
def renew_listing(lid):
    u = require_auth()
    row = query("SELECT * FROM listings WHERE id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    if row["user_id"] != u["id"] and not u["is_admin"]:
        return err("Not allowed", 403)
    new_expiry = now() + EXPIRY_DAYS * 86400
    execute("UPDATE listings SET status = 'active', expiry_at = ?, updated_at = ? WHERE id = ?", (new_expiry, now(), lid))
    notify(u["id"], "listing", "Listing renewed", f"“{row['title']}” is active for another {EXPIRY_DAYS} days.", f"#/ads/{lid}")
    return ok({"id": lid, "expiry_at": new_expiry})


@app.route("/api/listings/<int:lid>/promote", methods=["POST"])
def promote_listing(lid):
    u = require_auth()
    row = query("SELECT * FROM listings WHERE id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    if row["user_id"] != u["id"] and not u["is_admin"]:
        return err("Not allowed", 403)
    execute("UPDATE listings SET featured = 1, updated_at = ? WHERE id = ?", (now(), lid))
    notify(u["id"], "promotion", "Listing promoted", f"“{row['title']}” is now featured on the homepage.", f"#/ads/{lid}")
    return ok({"id": lid, "featured": True})


@app.route("/api/listings/<int:lid>/contact", methods=["POST"])
def contact_listing(lid):
    u = current_user()
    body = request.get_json(silent=True) or {}
    row = query("SELECT id, user_id FROM listings WHERE id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    kind = body.get("kind") or ""
    if kind not in ("call", "whatsapp", "chat"):
        return err("Invalid contact type")
    record_contact(lid, row["user_id"], u["id"] if u else None, kind)
    return ok({"recorded": True})


@app.route("/api/listings/<int:lid>/report", methods=["POST"])
def report_listing(lid):
    u = current_user()
    body = request.get_json(silent=True) or {}
    row = query("SELECT id FROM listings WHERE id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    reason = (body.get("reason") or "Other").strip()
    execute("INSERT INTO reports (listing_id, reporter_id, reason, details, created_at) VALUES (?,?,?,?,?)",
            (lid, u["id"] if u else None, reason, body.get("details") or "", now()))
    return ok({"reported": True})


# ---------------------------------------------------------------------------
# Favorites
# ---------------------------------------------------------------------------
@app.route("/api/favorites")
def list_favorites():
    u = require_auth()
    expire_overdue()
    rows = query(
        "SELECT l.*, c.name AS category_name, c.slug AS category_slug, f.created_at AS fav_at "
        "FROM favorites f JOIN listings l ON l.id = f.listing_id "
        "JOIN categories c ON c.id = l.category_id WHERE f.user_id = ? ORDER BY f.created_at DESC",
        (u["id"],))
    return ok([serialize_listing(r) for r in rows])


@app.route("/api/favorites/ids")
def favorite_ids():
    u = current_user()
    if not u:
        return ok([])
    rows = query("SELECT listing_id FROM favorites WHERE user_id = ?", (u["id"],))
    return ok([r["listing_id"] for r in rows])


@app.route("/api/favorites/<int:lid>", methods=["POST"])
def add_favorite(lid):
    u = require_auth()
    row = query("SELECT * FROM listings WHERE id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    execute("INSERT OR IGNORE INTO favorites (user_id, listing_id, created_at) VALUES (?,?,?)",
            (u["id"], lid, now()))
    if row["user_id"] != u["id"]:
        notify(row["user_id"], "favorite", "Someone saved your listing",
               f"{u['name']} added “{row['title']}” to their favorites.", f"#/ads/{lid}")
    return ok({"favorited": True})


@app.route("/api/favorites/<int:lid>", methods=["DELETE"])
def remove_favorite(lid):
    u = require_auth()
    execute("DELETE FROM favorites WHERE user_id = ? AND listing_id = ?", (u["id"], lid))
    return ok({"favorited": False})


# ---------------------------------------------------------------------------
# Offers
# ---------------------------------------------------------------------------
def offer_payload(o):
    listing = query("SELECT title, images FROM listings WHERE id = ?", (o["listing_id"],), one=True)
    return {
        "id": o["id"], "listing_id": o["listing_id"],
        "buyer_id": o["buyer_id"], "seller_id": o["seller_id"],
        "amount": o["amount"], "counter_amount": o.get("counter_amount"),
        "message": o.get("message") or "", "status": o["status"],
        "created_at": o["created_at"],
        "listing_title": listing["title"] if listing else "",
        "listing_images": json.loads((listing["images"] if listing else "") or "[]"),
    }


@app.route("/api/listings/<int:lid>/offer", methods=["POST"])
def make_offer(lid):
    u = require_auth()
    row = query("SELECT * FROM listings WHERE id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    if row["user_id"] == u["id"]:
        return err("You cannot make an offer on your own listing")
    body = request.get_json(silent=True) or {}
    amount = body.get("amount")
    try:
        amount = int(amount) if amount not in (None, "") else 0
    except (TypeError, ValueError):
        return err("Enter a valid offer amount")
    if amount <= 0:
        return err("Enter a valid offer amount")
    oid = execute(
        "INSERT INTO offers (listing_id, buyer_id, seller_id, amount, message, status, created_at) VALUES (?,?,?,?,?, 'pending', ?)",
        (lid, u["id"], row["user_id"], amount, body.get("message") or "", now()))
    notify(row["user_id"], "offer", "New offer received",
           f"{u['name']} offered Rs. {amount:,} for “{row['title']}”.", f"#/my-offers")
    return ok({"id": oid})


@app.route("/api/me/offers")
def my_offers():
    u = require_auth()
    received = query(
        """SELECT o.* FROM offers o WHERE o.seller_id = ? ORDER BY o.created_at DESC""", (u["id"],))
    sent = query(
        """SELECT o.* FROM offers o WHERE o.buyer_id = ? ORDER BY o.created_at DESC""", (u["id"],))
    def enrich(rows, name_col, other_is_buyer):
        out = []
        for r in rows:
            p = offer_payload(r)
            other_id = r["buyer_id"] if other_is_buyer else r["seller_id"]
            other = query("SELECT id, name, avatar FROM users WHERE id = ?", (other_id,), one=True)
            p[name_col] = other["name"] if other else "User"
            out.append(p)
        return out
    return ok({"received": enrich(received, "buyer_name", True), "sent": enrich(sent, "seller_name", False)})


@app.route("/api/offers/<int:oid>", methods=["POST"])
def respond_offer(oid):
    u = require_auth()
    row = query("SELECT * FROM offers WHERE id = ?", (oid,), one=True)
    if not row:
        return err("Offer not found", 404)
    body = request.get_json(silent=True) or {}
    action = body.get("action") or body.get("status")

    # Seller acting on a pending offer: accept / decline / counter.
    if row["seller_id"] == u["id"] and row["status"] == "pending":
        if action in ("accepted", "accept"):
            execute("UPDATE offers SET status = 'accepted' WHERE id = ?", (oid,))
            notify(row["buyer_id"], "offer", "Offer accepted",
                   f"Your offer of Rs. {row['amount']:,} was accepted.", f"#/ads/{row['listing_id']}")
            return ok({"id": oid, "status": "accepted"})
        if action in ("declined", "decline", "rejected", "reject"):
            execute("UPDATE offers SET status = 'declined' WHERE id = ?", (oid,))
            notify(row["buyer_id"], "offer", "Offer declined",
                   f"Your offer of Rs. {row['amount']:,} was declined.", f"#/ads/{row['listing_id']}")
            return ok({"id": oid, "status": "declined"})
        if action == "counter":
            try:
                amt = int(body.get("amount"))
            except (TypeError, ValueError):
                return err("Enter a valid counter amount")
            if amt <= 0:
                return err("Enter a valid counter amount")
            execute("UPDATE offers SET counter_amount = ?, status = 'countered' WHERE id = ?", (amt, oid))
            notify(row["buyer_id"], "offer", "Seller countered",
                   f"The seller countered with Rs. {amt:,}. Accept or make a new offer.", f"#/my-offers")
            return ok({"id": oid, "status": "countered", "counter_amount": amt})

    # Buyer acting on a counter: accept / decline.
    if row["buyer_id"] == u["id"] and row["status"] == "countered":
        if action in ("accepted", "accept"):
            execute("UPDATE offers SET amount = counter_amount, status = 'accepted' WHERE id = ?", (oid,))
            notify(row["seller_id"], "offer", "Counter accepted",
                   f"The buyer accepted your counter of Rs. {row['counter_amount']:,}.", f"#/my-offers")
            return ok({"id": oid, "status": "accepted"})
        if action in ("declined", "decline", "rejected", "reject"):
            execute("UPDATE offers SET status = 'declined' WHERE id = ?", (oid,))
            notify(row["seller_id"], "offer", "Counter declined",
                   f"The buyer declined your counter of Rs. {row['counter_amount']:,}.", f"#/my-offers")
            return ok({"id": oid, "status": "declined"})

    return err("Not allowed", 403)


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------
@app.route("/api/chat/conversations")
def conversations():
    u = require_auth()
    rows = query(
        """SELECT other.id AS other_id, other.name AS other_name, other.avatar AS other_avatar,
                  m.body AS last_body, m.created_at AS last_at, m.sender_id AS last_sender,
                  l.title AS listing_title, l.id AS listing_id,
                  (SELECT COUNT(*) FROM messages x WHERE x.sender_id = other.id AND x.receiver_id = ? AND x.read = 0) AS unread
           FROM messages m
           JOIN users other ON other.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
           LEFT JOIN listings l ON l.id = m.listing_id
           WHERE m.id IN (
             SELECT MAX(id) FROM messages WHERE sender_id = ? OR receiver_id = ? GROUP BY
               CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END
           )
           ORDER BY m.created_at DESC""",
        (u["id"], u["id"], u["id"], u["id"], u["id"]))
    return ok(rows)


@app.route("/api/chat/<int:other_id>")
def chat_thread(other_id):
    u = require_auth()
    rows = query(
        """SELECT * FROM messages
           WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
           ORDER BY created_at ASC LIMIT 200""",
        (u["id"], other_id, other_id, u["id"]))
    execute("UPDATE messages SET read = 1 WHERE sender_id = ? AND receiver_id = ?",
            (other_id, u["id"]))
    other = query("SELECT id, name, avatar, verified, seller_type FROM users WHERE id = ?", (other_id,), one=True)
    blocked = bool(query("SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?", (u["id"], other_id), one=True))
    blocked_by = bool(query("SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?", (other_id, u["id"]), one=True))
    listing = None
    lid = query("SELECT MAX(listing_id) lid FROM messages WHERE listing_id IS NOT NULL AND (sender_id = ? OR receiver_id = ?) AND (sender_id = ? OR receiver_id = ?)",
                (u["id"], u["id"], other_id, other_id), one=True)
    if lid and lid["lid"]:
        lrow = query("SELECT id, title, images, price FROM listings WHERE id = ?", (lid["lid"],), one=True)
        if lrow:
            listing = {"id": lrow["id"], "title": lrow["title"], "price": lrow["price"],
                       "image": (json.loads(lrow["images"] or "[]") or [None])[0]}
    return ok({"messages": rows, "other": other, "blocked": blocked, "blocked_by": blocked_by, "listing": listing})


@app.route("/api/chat/<int:other_id>", methods=["POST"])
def send_message(other_id):
    u = require_auth()
    other = query("SELECT * FROM users WHERE id = ?", (other_id,), one=True)
    if not other:
        return err("User not found", 404)
    if query("SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?", (other_id, u["id"]), one=True):
        return err("You cannot message this user", 403)
    body = request.get_json(silent=True) or {}
    text = (body.get("body") or "").strip()
    if not text:
        return err("Message is empty")
    mid = execute(
        "INSERT INTO messages (listing_id, sender_id, receiver_id, body, read, created_at) VALUES (?,?,?,?,0,?)",
        (body.get("listing_id"), u["id"], other_id, text, now()))
    notify(other_id, "message", "New message", f"{u['name']}: {text[:80]}", "#/chat")
    return ok({"id": mid})


@app.route("/api/chat/<int:other_id>/block", methods=["POST", "DELETE"])
def block_user(other_id):
    u = require_auth()
    other = query("SELECT id FROM users WHERE id = ?", (other_id,), one=True)
    if not other:
        return err("User not found", 404)
    if request.method == "DELETE":
        execute("DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?", (u["id"], other_id))
        return ok({"blocked": False})
    execute("INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?,?,?)", (u["id"], other_id, now()))
    return ok({"blocked": True})


@app.route("/api/chat/<int:other_id>/report", methods=["POST"])
def report_user(other_id):
    u = require_auth()
    other = query("SELECT id FROM users WHERE id = ?", (other_id,), one=True)
    if not other:
        return err("User not found", 404)
    body = request.get_json(silent=True) or {}
    execute("INSERT INTO user_reports (reporter_id, reported_id, reason, details, created_at) VALUES (?,?,?,?,?)",
            (u["id"], other_id, body.get("reason") or "Other", body.get("details") or "", now()))
    return ok({"reported": True})


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
@app.route("/api/notifications")
def notifications():
    u = require_auth()
    # Surface "expiring soon" for the user's active listings.
    expiring = query(
        "SELECT * FROM listings WHERE user_id = ? AND status = 'active' AND expiry_at IS NOT NULL AND expiry_at < ?",
        (u["id"], now() + 3 * 86400))
    for l in expiring:
        notify(u["id"], "expiring", "Listing expiring soon",
               f"“{l['title']}” expires in under 3 days. Renew it to keep it live.",
               f"#/ads/{l['id']}", dedupe=f"#/ads/{l['id']}")
    rows = query("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60", (u["id"],))
    unread = sum(1 for r in rows if not r["read"])
    return ok({"items": rows, "unread": unread})


@app.route("/api/notifications/read", methods=["POST"])
def read_notifications():
    u = require_auth()
    execute("UPDATE notifications SET read = 1 WHERE user_id = ?", (u["id"],))
    return ok({"read": True})


# ---------------------------------------------------------------------------
# Ratings
# ---------------------------------------------------------------------------
@app.route("/api/seller/<int:uid>/rate", methods=["POST"])
def rate_seller(uid):
    u = require_auth()
    if u["id"] == uid:
        return err("You cannot rate yourself")
    if not query("SELECT id FROM users WHERE id = ?", (uid,), one=True):
        return err("Seller not found", 404)
    body = request.get_json(silent=True) or {}
    try:
        stars = int(body.get("stars") or 0)
    except (TypeError, ValueError):
        stars = 0
    if stars < 1 or stars > 5:
        return err("Rating must be between 1 and 5 stars")
    execute(
        """INSERT INTO ratings (seller_id, buyer_id, listing_id, stars, comment, created_at)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(buyer_id, seller_id) DO UPDATE SET stars = excluded.stars, comment = excluded.comment, created_at = excluded.created_at""",
        (uid, u["id"], body.get("listing_id"), stars, (body.get("comment") or "")[:500], now()))
    notify(uid, "rating", "New rating received",
           f"{u['name']} rated you {stars} star(s).", "#/seller/" + str(uid))
    return ok({"rated": True, "rating": seller_rating(uid)})


# ---------------------------------------------------------------------------
# Me / profile
# ---------------------------------------------------------------------------
@app.route("/api/me")
def me():
    u = require_auth()
    row = query("SELECT * FROM users WHERE id = ?", (u["id"],), one=True)
    counts = {
        "listings": query("SELECT COUNT(*) n FROM listings WHERE user_id = ?", (u["id"],), one=True)["n"],
        "favorites": query("SELECT COUNT(*) n FROM favorites WHERE user_id = ?", (u["id"],), one=True)["n"],
    }
    return ok({"user": user_payload(row), "counts": counts})


@app.route("/api/me", methods=["PATCH"])
def update_me():
    u = require_auth()
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or u["name"]).strip()[:60]
    phone = (body.get("phone") or u["phone"]).strip()[:20]
    whatsapp = (body.get("whatsapp") or u["whatsapp"]).strip()[:20]
    province = (body.get("province") or u["province"]).strip()[:60]
    district = (body.get("district") or u["district"]).strip()[:60]
    city = (body.get("city") or u["city"]).strip()[:60]
    bio = (body.get("bio") or u["bio"]).strip()[:300]
    seller_type = body.get("seller_type") or u.get("seller_type") or "individual"
    if seller_type not in ("individual", "business"):
        seller_type = "individual"
    execute(
        "UPDATE users SET name=?, phone=?, whatsapp=?, province=?, district=?, city=?, bio=?, seller_type=? WHERE id=?",
        (name, phone, whatsapp, province, district, city, bio, seller_type, u["id"]))
    # changing phone invalidates phone verification
    if phone != (u["phone"] or ""):
        execute("UPDATE users SET phone_verified = 0 WHERE id = ?", (u["id"],))
    return ok({"user": user_payload(query("SELECT * FROM users WHERE id = ?", (u["id"],), one=True))})


@app.route("/api/me/avatar", methods=["POST"])
def upload_avatar():
    u = require_auth()
    f = request.files.get("file")
    if not f:
        return err("No file uploaded")
    ext = (f.filename or "").rsplit(".", 1)[-1].lower() if "." in (f.filename or "") else ""
    if ext not in ALLOWED_IMG:
        return err(f"Unsupported image type: {ext or 'unknown'}")
    data = f.read()
    if len(data) > MAX_IMG_BYTES:
        return err("Image too large (max 8MB)")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    name = f"avatar_{uuid.uuid4().hex}.jpg"
    path = os.path.join(UPLOAD_DIR, name)
    try:
        from PIL import Image, ImageOps
        img = Image.open(__import__("io").BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
        img = ImageOps.fit(img, (256, 256), Image.Resampling.LANCZOS)
        img.save(path, "JPEG", quality=85)
    except Exception:
        with open(path, "wb") as fh:
            fh.write(data)
    execute("UPDATE users SET avatar = ? WHERE id = ?", (f"/uploads/{name}", u["id"]))
    return ok({"url": f"/uploads/{name}"})


@app.route("/api/me/password", methods=["POST"])
def change_password():
    u = require_auth()
    body = request.get_json(silent=True) or {}
    if not verify_password(body.get("old") or "", u["password_hash"]):
        return err("Current password is incorrect", 401)
    new = (body.get("new") or "").strip()
    if len(new) < 6:
        return err("New password must be at least 6 characters")
    execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new), u["id"]))
    return ok({"changed": True})


@app.route("/api/seller/<int:uid>")
def seller_profile(uid):
    expire_overdue()
    row = query("SELECT * FROM users WHERE id = ?", (uid,), one=True)
    if not row:
        return err("Seller not found", 404)
    listings = query(listing_query_base() + " WHERE l.user_id = ? AND l.status = 'active' ORDER BY l.created_at DESC", (uid,))
    biz = query("SELECT * FROM businesses WHERE user_id = ?", (uid,), one=True)
    ratings = query(
        "SELECT r.*, u.name AS buyer_name FROM ratings r JOIN users u ON u.id = r.buyer_id WHERE r.seller_id = ? ORDER BY r.created_at DESC LIMIT 20",
        (uid,))
    return ok({
        "seller": public_user(row),
        "rating": seller_rating(uid),
        "ratings": ratings,
        "business": dict(biz) if biz else None,
        "listings": [serialize_listing(r) for r in listings],
    })


@app.route("/api/me/listings")
def my_listings():
    u = require_auth()
    expire_overdue()
    rows = query(listing_query_base() + " WHERE l.user_id = ? ORDER BY l.created_at DESC", (u["id"],))
    return ok([serialize_listing(r) for r in rows])


# ---------------------------------------------------------------------------
# Seller analytics
# ---------------------------------------------------------------------------
@app.route("/api/me/analytics")
def my_analytics():
    u = require_auth()
    listings = query("SELECT * FROM listings WHERE user_id = ? ORDER BY created_at DESC", (u["id"],))
    ids = [l["id"] for l in listings]
    views = sum(l["views"] or 0 for l in listings)
    favorites = 0
    if ids:
        ph = ",".join("?" * len(ids))
        favorites = query(f"SELECT COUNT(*) n FROM favorites WHERE listing_id IN ({ph})", ids, one=True)["n"]
    messages = query("SELECT COUNT(*) n FROM messages WHERE receiver_id = ?", (u["id"],), one=True)["n"]
    calls = query("SELECT COUNT(*) n FROM contact_events WHERE seller_id = ? AND kind = 'call'", (u["id"],), one=True)["n"]
    whatsapp = query("SELECT COUNT(*) n FROM contact_events WHERE seller_id = ? AND kind = 'whatsapp'", (u["id"],), one=True)["n"]
    offers = query("SELECT COUNT(*) n FROM offers WHERE seller_id = ?", (u["id"],), one=True)["n"]

    per = []
    for l in listings:
        fav = query("SELECT COUNT(*) n FROM favorites WHERE listing_id = ?", (l["id"],), one=True)["n"]
        msgs = query("SELECT COUNT(*) n FROM messages WHERE listing_id = ?", (l["id"],), one=True)["n"]
        cl = query("SELECT COUNT(*) n FROM contact_events WHERE listing_id = ? AND kind = 'call'", (l["id"],), one=True)["n"]
        wa = query("SELECT COUNT(*) n FROM contact_events WHERE listing_id = ? AND kind = 'whatsapp'", (l["id"],), one=True)["n"]
        of = query("SELECT COUNT(*) n FROM offers WHERE listing_id = ?", (l["id"],), one=True)["n"]
        img = json.loads(l["images"] or "[]")
        per.append({
            "id": l["id"], "title": l["title"], "status": l["status"],
            "image": img[0] if img else None,
            "views": l["views"] or 0, "favorites": fav, "messages": msgs,
            "calls": cl, "whatsapp": wa, "offers": of,
        })
    return ok({
        "summary": {"views": views, "favorites": favorites, "messages": messages,
                    "calls": calls, "whatsapp": whatsapp, "offers": offers,
                    "listings": len(listings)},
        "listings": per,
    })


# ---------------------------------------------------------------------------
# Business sellers
# ---------------------------------------------------------------------------
def business_payload(b):
    if not b:
        return None
    hours = b.get("opening_hours") or "{}"
    try:
        hours = json.loads(hours)
    except Exception:
        hours = {}
    return {
        "id": b["id"], "name": b["name"], "slug": b["slug"], "logo": b["logo"],
        "description": b["description"], "province": b["province"], "district": b["district"],
        "city": b["city"], "area": b["area"], "phone": b["phone"], "whatsapp": b["whatsapp"],
        "opening_hours": hours, "verified": bool(b["verified"]),
    }


@app.route("/api/me/business", methods=["GET", "PUT"])
def my_business():
    u = require_auth()
    if request.method == "GET":
        b = query("SELECT * FROM businesses WHERE user_id = ?", (u["id"],), one=True)
        return ok(business_payload(b))
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return err("Business name is required")
    existing = query("SELECT * FROM businesses WHERE user_id = ?", (u["id"],), one=True)
    if existing:
        slug = existing["slug"]
        if body.get("slug"):
            slug = slugify(body["slug"])
        execute(
            """UPDATE businesses SET name=?, slug=?, logo=?, description=?, province=?, district=?, city=?, area=?,
               phone=?, whatsapp=?, opening_hours=? WHERE user_id=?""",
            (name, slug, body.get("logo") or existing["logo"], body.get("description") or existing["description"] or "",
             body.get("province") or existing["province"] or "", body.get("district") or existing["district"] or "",
             body.get("city") or existing["city"] or "", body.get("area") or existing["area"] or "",
             body.get("phone") or existing["phone"] or "", body.get("whatsapp") or existing["whatsapp"] or "",
             json.dumps(body.get("opening_hours") or {}), u["id"]))
    else:
        slug = slugify(body.get("slug") or name)
        base = slug
        i = 2
        while query("SELECT id FROM businesses WHERE slug = ?", (slug,), one=True):
            slug = f"{base}-{i}"
            i += 1
        execute(
            """INSERT INTO businesses (user_id, name, slug, logo, description, province, district, city, area,
               phone, whatsapp, opening_hours, verified, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?)""",
            (u["id"], name, slug, body.get("logo") or "", body.get("description") or "",
             body.get("province") or "", body.get("district") or "", body.get("city") or "",
             body.get("area") or "", body.get("phone") or "", body.get("whatsapp") or "",
             json.dumps(body.get("opening_hours") or {}), now()))
        execute("UPDATE users SET seller_type = 'business' WHERE id = ?", (u["id"],))
    b = query("SELECT * FROM businesses WHERE user_id = ?", (u["id"],), one=True)
    return ok(business_payload(b))


@app.route("/api/business/<slug>")
def business_page(slug):
    b = query("SELECT * FROM businesses WHERE slug = ?", (slug,), one=True)
    if not b:
        return err("Shop not found", 404)
    owner = query("SELECT id, name, phone, whatsapp, province, district, city, bio, avatar, verified, seller_type, created_at FROM users WHERE id = ?", (b["user_id"],), one=True)
    listings = query(listing_query_base() + " WHERE l.user_id = ? AND l.status = 'active' ORDER BY l.created_at DESC", (b["user_id"],))
    return ok({
        "business": business_payload(b),
        "owner": public_user(owner) if owner else None,
        "rating": seller_rating(b["user_id"]),
        "listings": [serialize_listing(r) for r in listings],
    })


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@app.route("/api/auth/signup", methods=["POST"])
def signup():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if len(name) < 2:
        return err("Please enter your name")
    if not EMAIL_RE.match(email):
        return err("Please enter a valid email")
    if len(password) < 6:
        return err("Password must be at least 6 characters")
    if query("SELECT id FROM users WHERE email = ?", (email,), one=True):
        return err("An account with this email already exists", 409)
    seller_type = body.get("seller_type") or "individual"
    if seller_type not in ("individual", "business"):
        seller_type = "individual"
    uid = execute(
        "INSERT INTO users (name, email, password_hash, phone, whatsapp, seller_type, email_verified, created_at) VALUES (?,?,?,?,?,?,0,?)",
        (name, email, hash_password(password), (body.get("phone") or "").strip(),
         (body.get("whatsapp") or "").strip(), seller_type, now()))
    token = secrets.token_hex(32)
    execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)", (token, uid, now()))
    u = query("SELECT * FROM users WHERE id = ?", (uid,), one=True)

    # Email verification: token emailed in production; exposed in `dev` for local testing.
    vtoken = make_token(uid, "email", ttl=86400)
    return ok({
        "token": token, "user": user_payload(u),
        "dev": {"verify_email_token": vtoken, "verify_email_link": f"#/verify-email?token={vtoken}"},
    })


@app.route("/api/auth/login", methods=["POST"])
def login():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    u = query("SELECT * FROM users WHERE email = ?", (email,), one=True)
    if not u or not verify_password(password, u["password_hash"]):
        return err("Invalid email or password", 401)
    token = secrets.token_hex(32)
    execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)", (token, u["id"], now()))
    return ok({"token": token, "user": user_payload(u)})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    token = request.headers.get("Authorization", "")
    if token.startswith("Bearer "):
        execute("DELETE FROM sessions WHERE token = ?", (token[7:],))
    return ok({"logged_out": True})


@app.route("/api/auth/forgot", methods=["POST"])
def forgot_password():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    u = query("SELECT * FROM users WHERE email = ?", (email,), one=True)
    if not u:
        # Do not reveal whether the email exists.
        return ok({"sent": True, "dev": None})
    token = make_token(u["id"], "reset", ttl=3600)
    return ok({"sent": True, "dev": {"reset_token": token, "reset_link": f"#/reset-password?token={token}"}})


@app.route("/api/auth/reset", methods=["POST"])
def reset_password():
    body = request.get_json(silent=True) or {}
    token = (body.get("token") or "").strip()
    row = consume_token(token, "reset")
    if not row:
        return err("This reset link is invalid or has expired", 400)
    new = (body.get("password") or "").strip()
    if len(new) < 6:
        return err("Password must be at least 6 characters")
    execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new), row["user_id"]))
    execute("DELETE FROM tokens WHERE token = ?", (token,))
    return ok({"reset": True})


@app.route("/api/auth/verify-email", methods=["POST"])
def verify_email():
    body = request.get_json(silent=True) or {}
    token = (body.get("token") or "").strip()
    row = consume_token(token, "email")
    if not row:
        return err("This verification link is invalid or has expired", 400)
    execute("UPDATE users SET email_verified = 1 WHERE id = ?", (row["user_id"],))
    execute("DELETE FROM tokens WHERE token = ?", (token,))
    return ok({"verified": True})


@app.route("/api/auth/resend-verification", methods=["POST"])
def resend_verification():
    u = require_auth()
    if u.get("email_verified"):
        return ok({"verified": True, "dev": None})
    token = make_token(u["id"], "email", ttl=86400)
    return ok({"sent": True, "dev": {"verify_email_token": token, "verify_email_link": f"#/verify-email?token={token}"}})


@app.route("/api/auth/verify-phone/request", methods=["POST"])
def request_phone_code():
    u = require_auth()
    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()
    if not phone:
        return err("Please enter your phone number")
    otp = f"{secrets.randbelow(1000000):06d}"
    make_token(u["id"], "phone", value=otp, ttl=600)
    execute("UPDATE users SET phone = ?, phone_verified = 0 WHERE id = ?", (phone, u["id"]))
    # Production would send via SMS; expose in dev for local testing.
    return ok({"sent": True, "dev": {"code": otp}})


@app.route("/api/auth/verify-phone", methods=["POST"])
def verify_phone():
    u = require_auth()
    body = request.get_json(silent=True) or {}
    code = (body.get("code") or "").strip()
    row = query("SELECT * FROM tokens WHERE user_id = ? AND kind = 'phone' ORDER BY created_at DESC LIMIT 1", (u["id"],), one=True)
    if not row or row["value"] != code:
        return err("Incorrect code")
    if row["expires_at"] and row["expires_at"] < now():
        return err("This code has expired")
    execute("UPDATE users SET phone_verified = 1 WHERE id = ?", (u["id"],))
    execute("DELETE FROM tokens WHERE user_id = ? AND kind = 'phone'", (u["id"],))
    return ok({"verified": True})


# ---------------------------------------------------------------------------
# Shops, posts, contact
# ---------------------------------------------------------------------------
@app.route("/api/shops")
def shops():
    rows = query("SELECT * FROM shops ORDER BY verified DESC, name")
    return ok(rows)


@app.route("/api/shops/<int:sid>")
def shop_detail(sid):
    row = query("SELECT * FROM shops WHERE id = ?", (sid,), one=True)
    if not row:
        return err("Shop not found", 404)
    return ok(row)


@app.route("/api/posts")
def posts():
    rows = query("SELECT id, slug, title, category, excerpt, image, author, created_at FROM posts ORDER BY created_at DESC")
    return ok(rows)


@app.route("/api/posts/<slug>")
def post_detail(slug):
    row = query("SELECT * FROM posts WHERE slug = ?", (slug,), one=True)
    if not row:
        return err("Post not found", 404)
    return ok(row)


@app.route("/api/contact", methods=["POST"])
def contact():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip()
    subject = (body.get("subject") or "").strip()
    message = (body.get("message") or "").strip()
    if not name or not message:
        return err("Please fill in your name and message")
    execute("INSERT INTO contact_messages (name, email, subject, message, created_at) VALUES (?,?,?,?,?)",
            (name, email, subject, message, now()))
    return ok({"sent": True})


# ---------------------------------------------------------------------------
# Upload (with compression + thumbnails)
# ---------------------------------------------------------------------------
def process_image(data, ext, max_dim=1600, thumb_dim=420):
    """Return (main_filename, thumb_filename). Falls back to raw bytes on error."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    name = uuid.uuid4().hex
    main_name = f"{name}.jpg"
    thumb_name = f"{name}_thumb.jpg"
    try:
        import io
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGBA")
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            img = bg
        else:
            img = img.convert("RGB")
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        img.save(os.path.join(UPLOAD_DIR, main_name), "JPEG", quality=82, optimize=True)
        thumb = img.copy()
        thumb.thumbnail((thumb_dim, thumb_dim), Image.Resampling.LANCZOS)
        thumb.save(os.path.join(UPLOAD_DIR, thumb_name), "JPEG", quality=78, optimize=True)
        return main_name, thumb_name
    except Exception:
        ext = ext if ext in ALLOWED_IMG else "jpg"
        main_name = f"{name}.{ext}"
        with open(os.path.join(UPLOAD_DIR, main_name), "wb") as fh:
            fh.write(data)
        return main_name, None


@app.route("/api/upload", methods=["POST"])
def upload():
    require_auth()
    files = request.files.getlist("files") or ([request.files["file"]] if "file" in request.files else [])
    if not files:
        return err("No file uploaded")
    items = []
    for f in files:
        ext = (f.filename or "").rsplit(".", 1)[-1].lower() if "." in (f.filename or "") else ""
        if ext not in ALLOWED_IMG:
            return err(f"Unsupported image type: {ext or 'unknown'}")
        data = f.read()
        if len(data) > MAX_IMG_BYTES:
            return err("Image too large (max 8MB)")
        main_name, thumb_name = process_image(data, ext)
        item = {"url": f"/uploads/{main_name}"}
        if thumb_name:
            item["thumb"] = f"/uploads/{thumb_name}"
        items.append(item)
    return ok({"items": items})


# ---------------------------------------------------------------------------
# Admin (categories — Part 3 will build the UI on top of these)
# ---------------------------------------------------------------------------
@app.route("/api/admin/categories", methods=["POST"])
def admin_add_category():
    u = require_auth()
    if not u["is_admin"]:
        return err("Admin only", 403)
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return err("Name required")
    slug = slugify(name)
    parent_id = body.get("parent_id")
    icon = body.get("icon") or "layers-outline"
    cid = execute("INSERT INTO categories (slug, name, icon, parent_id, sort, fields) VALUES (?,?,?,?,?,?)",
                  (slug, name, icon, parent_id, int(body.get("sort") or 0), json.dumps(body.get("fields") or [])))
    return ok({"id": cid})


@app.route("/api/admin/categories/<int:cid>", methods=["PATCH", "DELETE"])
def admin_edit_category(cid):
    u = require_auth()
    if not u["is_admin"]:
        return err("Admin only", 403)
    if request.method == "DELETE":
        execute("DELETE FROM categories WHERE id = ?", (cid,))
        return ok({"deleted": cid})
    body = request.get_json(silent=True) or {}
    if body.get("name"):
        execute("UPDATE categories SET name = ? WHERE id = ?", (body["name"], cid))
    if body.get("icon"):
        execute("UPDATE categories SET icon = ? WHERE id = ?", (body["icon"], cid))
    if "fields" in body:
        execute("UPDATE categories SET fields = ? WHERE id = ?", (json.dumps(body["fields"]), cid))
    if "sort" in body:
        execute("UPDATE categories SET sort = ? WHERE id = ?", (int(body["sort"]), cid))
    return ok({"id": cid})


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------
def seed():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    migrate(conn)

    has_cats = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    if has_cats == 0:
        for slug, name, icon, parent, sort, fields in CATEGORIES:
            parent_id = None
            if parent:
                parent_id = conn.execute("SELECT id FROM categories WHERE slug = ?", (parent,)).fetchone()[0]
            conn.execute(
                "INSERT INTO categories (slug, name, icon, parent_id, sort, fields) VALUES (?,?,?,?,?,?)",
                (slug, name, icon, parent_id, sort, fields))
        conn.commit()

    has_prov = conn.execute("SELECT COUNT(*) FROM provinces").fetchone()[0]
    if has_prov == 0:
        for pname, districts in PROVINCES.items():
            pid = conn.execute("INSERT INTO provinces (name) VALUES (?)", (pname,)).lastrowid
            for dname, cities in districts.items():
                did = conn.execute("INSERT INTO districts (province_id, name) VALUES (?,?)", (pid, dname)).lastrowid
                for cname in cities:
                    conn.execute("INSERT INTO cities (district_id, name) VALUES (?,?)", (did, cname))
        conn.commit()

    if conn.execute("SELECT COUNT(*) FROM brands").fetchone()[0] == 0:
        for name, cat in BRANDS:
            conn.execute("INSERT INTO brands (name, category) VALUES (?,?)", (name, cat))
        conn.commit()

    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        users = [
            ("Nimalka Perera", "nimalka@lankalens.lk", "password123", "+94 77 123 4567", "Western Province", "Colombo", "Colombo", 1, 0,
             "individual", "Camera enthusiast and part-time wedding photographer in Colombo."),
            ("Kasun Fernando", "kasun@lankalens.lk", "password123", "+94 71 234 5678", "Central Province", "Kandy", "Kandy", 1, 0,
             "individual", "Wildlife photographer based in Kandy. Buying and selling quality gear."),
            ("Tharindu Silva", "tharindu@lankalens.lk", "password123", "+94 76 345 6789", "Southern Province", "Galle", "Galle", 0, 0,
             "individual", "Travel photographer covering the south coast."),
            ("Ishara Jayasuriya", "ishara@lankalens.lk", "password123", "+94 70 456 7890", "Western Province", "Colombo", "Nugegoda", 1, 0,
             "business", "Owner of Colombo Camera House. Authorised dealer for major brands."),
            ("Demo User", "demo@lankalens.lk", "demo1234", "+94 77 000 1111", "Western Province", "Colombo", "Colombo", 0, 0,
             "individual", "Just browsing for my next camera."),
            ("Admin", "admin@lankalens.lk", "admin1234", "+94 77 999 8888", "Western Province", "Colombo", "Colombo", 1, 1,
             "individual", "Lanka Lens administrator."),
        ]
        user_ids = {}
        for name, email, pw, phone, prov, dist, city, verified, is_admin, seller_type, bio in users:
            uid = conn.execute(
                "INSERT INTO users (name, email, password_hash, phone, whatsapp, province, district, city, bio, verified, email_verified, phone_verified, seller_type, is_admin, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,1,1,?,?,?)",
                (name, email, hash_password(pw), phone, phone.replace(" ", ""), prov, dist, city, bio, verified, seller_type, is_admin, now())).lastrowid
            user_ids[email] = uid
        conn.commit()

    if conn.execute("SELECT COUNT(*) FROM businesses").fetchone()[0] == 0:
        ish = conn.execute("SELECT id FROM users WHERE email = ?", ("ishara@lankalens.lk",)).fetchone()
        if ish:
            conn.execute(
                """INSERT INTO businesses (user_id, name, slug, logo, description, province, district, city, area,
                   phone, whatsapp, opening_hours, verified, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)""",
                (ish["id"], "Colombo Camera House", "colombo-camera-house", "/images/shops/shop-1.jpg",
                 "Authorised dealer for Sony, Canon and Fujifilm. Trade-ins, repairs and rentals welcome.",
                 "Western Province", "Colombo", "Colombo", "Colombo 04",
                 "+94 11 250 4400", "94112504400",
                 json.dumps({"mon": "9:00 AM – 6:00 PM", "tue": "9:00 AM – 6:00 PM", "wed": "9:00 AM – 6:00 PM",
                             "thu": "9:00 AM – 6:00 PM", "fri": "9:00 AM – 6:00 PM", "sat": "9:00 AM – 4:00 PM",
                             "sun": "Closed"}),
                 now()))
            conn.commit()

    if conn.execute("SELECT COUNT(*) FROM listings").fetchone()[0] == 0:
        users_map = {r["email"]: r["id"] for r in [dict(x) for x in conn.execute("SELECT id, email FROM users")]}
        cats = {r["slug"]: r["id"] for r in [dict(x) for x in conn.execute("SELECT id, slug FROM categories")]}

        def L(seller, cat, title, price, condition, images, specs, desc="", province="Western Province",
              district="Colombo", city="Colombo", featured=0, brand="", model="", year="", negotiable=1, views=0):
            return (users_map[seller], cats[cat], title, price, condition, desc, brand, model, year,
                    province, district, city, json.dumps(images), featured, views, json.dumps(specs))

        listings = [
            # Cameras
            L("nimalka@lankalens.lk", "mirrorless", "Sony A7 III — Full-frame Mirrorless Body", 325000, "Excellent",
              ["/images/products/sony-a7iii-1.jpg", "/images/products/sony-a7iii-2.jpg", "/images/products/sony-a7iii-3.jpg"],
              {"brand": "Sony", "model": "A7 III", "year": "2019", "shutter_count": "28,400", "megapixels": "24.2 MP",
               "video_resolution": "4K 30p", "body_kit": "Body Only", "battery": "2 × NP-FZ100", "charger": "Yes",
               "original_box": "Yes", "warranty": "3 months shop warranty", "receipt": "Yes",
               "reason_for_selling": "Upgrading to the A7 IV."},
              desc="Well looked-after Sony A7 III in excellent condition. Low shutter count, always kept in a dry box. Sensor is clean and the LCD has a screen protector since day one. Includes 2 original batteries, charger, strap and box.",
              featured=1, brand="Sony", model="A7 III", year="2019", views=640),
            L("ishara@lankalens.lk", "mirrorless", "Fujifilm X-T4 Mirrorless Camera (Silver)", 340000, "Like New",
              ["/images/products/fuji-xt4-1.jpg", "/images/products/fuji-xt4-2.jpg", "/images/products/fuji-xt4-3.jpg"],
              {"brand": "Fujifilm", "model": "X-T4", "year": "2021", "shutter_count": "9,100", "megapixels": "26.1 MP",
               "video_resolution": "4K 60p", "body_kit": "Body Only", "battery": "2 × NP-W235", "charger": "Yes",
               "original_box": "Yes", "warranty": "6 months", "receipt": "Yes",
               "reason_for_selling": "Moved to full-frame."},
              desc="Fujifilm X-T4 in like-new condition, barely used for a couple of projects. Comes complete with box, manuals and all original accessories.",
              featured=1, brand="Fujifilm", model="X-T4", year="2021", views=512),
            L("kasun@lankalens.lk", "dslr", "Canon EOS 5D Mark IV DSLR + 24-105mm Kit", 285000, "Good",
              ["/images/products/canon-5d-1.jpg"],
              {"brand": "Canon", "model": "5D Mark IV", "year": "2018", "shutter_count": "96,500", "megapixels": "30.4 MP",
               "video_resolution": "4K 30p", "body_kit": "Body + Kit Lens", "lens_included": "24-105mm f/4L",
               "battery": "1 × LP-E6N", "charger": "Yes", "original_box": "Yes", "warranty": "None", "receipt": "Yes",
               "reason_for_selling": "Switching to mirrorless."},
              desc="Workhorse 5D Mark IV with the 24-105mm f/4L kit lens. Reliable and sharp. Minor signs of use on the body but fully functional and sensor is clean.",
              featured=1, brand="Canon", model="5D Mark IV", year="2018", views=780),
            L("tharindu@lankalens.lk", "dslr", "Canon EOS Rebel T7 (2000D) + 18-55mm Kit", 95000, "Like New",
              ["/images/products/canon-rebel-1.jpg", "/images/products/canon-rebel-2.jpg"],
              {"brand": "Canon", "model": "Rebel T7", "year": "2022", "shutter_count": "4,200", "megapixels": "24.1 MP",
               "video_resolution": "1080p", "body_kit": "Body + Kit Lens", "lens_included": "18-55mm IS",
               "battery": "1 × LP-E10", "charger": "Yes", "original_box": "Yes", "warranty": "11 months official",
               "receipt": "Yes", "reason_for_selling": "Not using it enough."},
              desc="Great beginner DSLR, bought new and used only a handful of times. Perfect for anyone starting out in photography.",
              brand="Canon", model="Rebel T7", year="2022"),
            L("nimalka@lankalens.lk", "mirrorless", "Sony A6400 APS-C Mirrorless Body", 245000, "Excellent",
              ["/images/products/sony-a7iii-3.jpg"],
              {"brand": "Sony", "model": "A6400", "year": "2020", "shutter_count": "18,700", "megapixels": "24.2 MP",
               "video_resolution": "4K 30p", "body_kit": "Body Only", "battery": "1 × NP-FW50", "charger": "Yes",
               "original_box": "Yes", "warranty": "None", "receipt": "Yes",
               "reason_for_selling": "Clearing gear I no longer use."},
              desc="Sony A6400 with world-class autofocus. Great for both stills and video. Body in excellent shape.",
              brand="Sony", model="A6400", year="2020"),
            L("ishara@lankalens.lk", "compact", "Canon PowerShot G7 X Mark II", 88000, "Good",
              ["/images/products/lens-other-1.jpg"],
              {"brand": "Canon", "model": "G7 X Mark II", "year": "2019", "megapixels": "20.1 MP",
               "video_resolution": "1080p 60", "battery": "1 × NB-13L", "charger": "Yes", "original_box": "Yes",
               "warranty": "None", "receipt": "No", "reason_for_selling": "Upgraded to a vlogging setup."},
              desc="Pocket-friendly 1-inch sensor compact, ideal for vlogging and street photography.",
              brand="Canon", model="G7 X Mark II", year="2019"),
            L("kasun@lankalens.lk", "cinema-cameras", "Blackmagic Pocket Cinema Camera 4K", 320000, "Excellent",
              ["/images/products/gimbal-1.jpg"],
              {"brand": "Blackmagic", "model": "PCC4K", "year": "2021", "video_resolution": "4K RAW",
               "sensor": "4/3", "mount": "MFT", "battery": "2 × LP-E6", "charger": "Yes", "original_box": "Yes",
               "warranty": "None", "receipt": "Yes", "reason_for_selling": "Moving to a larger cinema rig."},
              desc="Blackmagic Pocket Cinema Camera 4K shooting RAW. Low hours, used for two short films.",
              brand="Blackmagic", model="PCC4K", year="2021"),
            L("tharindu@lankalens.lk", "other-cameras", "Canon EOS 90D DSLR Body", 195000, "Fair",
              ["/images/products/canon-rebel-2.jpg"],
              {"brand": "Canon", "model": "90D", "year": "2020", "shutter_count": "78,000", "megapixels": "32.5 MP",
               "video_resolution": "4K 30p", "body_kit": "Body Only", "battery": "1 × LP-E6N", "charger": "Yes",
               "original_box": "No", "warranty": "None", "receipt": "No",
               "reason_for_selling": "Need funds for lenses."},
              desc="Canon 90D in fair cosmetic condition, fully working. Great crop-sensor body with 32.5MP sensor.",
              brand="Canon", model="90D", year="2020"),

            # Lenses
            L("nimalka@lankalens.lk", "lens-canon", "Canon EF 50mm f/1.8 STM Prime Lens", 28500, "Like New",
              ["/images/products/lens-canon-1.jpg", "/images/products/lens-canon-2.jpg"],
              {"brand": "Canon", "model": "EF 50mm f/1.8 STM", "mount": "Canon EF", "focal_length": "50mm",
               "max_aperture": "f/1.8", "image_stabilization": "No", "autofocus": "Yes", "warranty": "None",
               "receipt": "Yes"},
              desc="The nifty fifty. Razor sharp, clean glass, no dust or fungus. Comes with caps and box.",
              featured=1, brand="Canon", model="EF 50mm f/1.8 STM", views=420),
            L("ishara@lankalens.lk", "lens-canon", "Canon RF 50mm f/1.8 STM (Brand New)", 42000, "Brand New",
              ["/images/products/lens-canon-3.jpg", "/images/products/lens-canon-4.jpg"],
              {"brand": "Canon", "model": "RF 50mm f/1.8 STM", "mount": "Canon RF", "focal_length": "50mm",
               "max_aperture": "f/1.8", "image_stabilization": "No", "autofocus": "Yes", "warranty": "1 year official",
               "receipt": "Yes"},
              desc="Brand new, sealed Canon RF 50mm f/1.8 STM. Full shop warranty and receipt included.",
              brand="Canon", model="RF 50mm f/1.8 STM"),
            L("kasun@lankalens.lk", "lens-sigma", "Sigma 35mm f/1.4 DG HSM Art (Nikon F)", 118000, "Excellent",
              ["/images/products/lens-other-1.jpg"],
              {"brand": "Sigma", "model": "35mm f/1.4 Art", "mount": "Nikon F", "focal_length": "35mm",
               "max_aperture": "f/1.4", "image_stabilization": "No", "autofocus": "Yes", "warranty": "3 months",
               "receipt": "Yes"},
              desc="Legendary Sigma Art 35mm. Tack sharp wide open. Glass is immaculate.",
              brand="Sigma", model="35mm f/1.4 Art"),
            L("tharindu@lankalens.lk", "lens-tamron", "Tamron 70-200mm f/2.8 G2 (Sony E)", 165000, "Good",
              ["/images/products/lens-canon-2.jpg"],
              {"brand": "Tamron", "model": "70-200mm f/2.8 G2", "mount": "Sony E", "focal_length": "70-200mm",
               "max_aperture": "f/2.8", "image_stabilization": "Yes", "autofocus": "Yes", "warranty": "None",
               "receipt": "Yes"},
              desc="Tamron 70-200mm f/2.8 G2 for Sony E mount. Great condition, minor cosmetic wear.",
              brand="Tamron", model="70-200mm f/2.8 G2"),
            L("nimalka@lankalens.lk", "lens-fujifilm", "Fujifilm XF 35mm f/2 R WR", 52000, "Excellent",
              ["/images/products/lens-other-1.jpg"],
              {"brand": "Fujifilm", "model": "XF 35mm f/2 WR", "mount": "Fujifilm X", "focal_length": "35mm",
               "max_aperture": "f/2", "image_stabilization": "No", "autofocus": "Yes", "warranty": "None",
               "receipt": "Yes"},
              desc="Weather-resistant 35mm prime for Fujifilm X. Compact, fast and sharp.",
              brand="Fujifilm", model="XF 35mm f/2 WR"),
            L("kasun@lankalens.lk", "lens-nikon", "Nikon AF-S 85mm f/1.8G Prime", 74000, "Good",
              ["/images/products/lens-canon-4.jpg"],
              {"brand": "Nikon", "model": "AF-S 85mm f/1.8G", "mount": "Nikon F", "focal_length": "85mm",
               "max_aperture": "f/1.8", "image_stabilization": "No", "autofocus": "Yes", "warranty": "None",
               "receipt": "Yes"},
              desc="Beautiful portrait lens for Nikon F mount. Clean glass, smooth focus.",
              brand="Nikon", model="AF-S 85mm f/1.8G"),

            # Action cameras
            L("ishara@lankalens.lk", "gopro", "GoPro HERO13 Black Action Camera", 128000, "Brand New",
              ["/images/products/gopro-1.jpg", "/images/products/gopro-2.jpg", "/images/products/gopro-3.jpg"],
              {"brand": "GoPro", "model": "HERO13 Black", "resolution": "5.3K60", "batteries": "2 × Enduro",
               "accessories": "Mounts, case", "box": "Yes", "warranty": "1 year official"},
              desc="Brand new GoPro HERO13 Black. Sealed box with full official warranty.",
              featured=1, brand="GoPro", model="HERO13 Black", views=530),
            L("tharindu@lankalens.lk", "gopro", "GoPro HERO7 White", 42000, "Good",
              ["/images/products/gopro-3.jpg"],
              {"brand": "GoPro", "model": "HERO7 White", "resolution": "1080p60", "batteries": "1",
               "accessories": "Frame mount", "box": "Yes", "warranty": "None"},
              desc="Affordable entry-level action camera, great for snorkelling and day trips.",
              brand="GoPro", model="HERO7 White"),
            L("nimalka@lankalens.lk", "dji-action", "DJI Osmo Action 4", 96000, "Like New",
              ["/images/products/osmo-1.jpg", "/images/products/osmo-2.jpg", "/images/products/osmo-3.jpg"],
              {"brand": "DJI", "model": "Osmo Action 4", "resolution": "4K120", "batteries": "2",
               "accessories": "Mounts, charging hub", "box": "Yes", "warranty": "6 months"},
              desc="DJI Osmo Action 4 used for one trip only. Dual touchscreens and superb stabilisation.",
              brand="DJI", model="Osmo Action 4"),
            L("kasun@lankalens.lk", "insta360", "Insta360 X5 360° Camera", 118000, "Brand New",
              ["/images/products/insta360-1.jpg", "/images/products/insta360-2.jpg", "/images/products/insta360-3.jpg"],
              {"brand": "Insta360", "model": "X5", "resolution": "8K 360", "batteries": "1",
               "accessories": "Invisible selfie stick", "box": "Yes", "warranty": "1 year official"},
              desc="Insta360 X5 with invisible selfie stick effect. Brand new, full warranty.",
              brand="Insta360", model="X5"),

            # Drones
            L("ishara@lankalens.lk", "drone-dji", "DJI Mini 3 (With RC Controller)", 185000, "Like New",
              ["/images/products/drone-2.jpg"],
              {"brand": "DJI", "model": "Mini 3", "flight_time": "38 min", "battery_count": "2",
               "controller": "RC-N1", "accessories": "Bag, spare props", "box": "Yes", "warranty": "4 months"},
              desc="DJI Mini 3 under 249g — no registration hassle. Flown a handful of times, spotless.",
              featured=1, brand="DJI", model="Mini 3", views=610),
            L("nimalka@lankalens.lk", "drone-dji", "DJI Air 3 Fly More Combo", 340000, "Excellent",
              ["/images/products/drone-3.jpg"],
              {"brand": "DJI", "model": "Air 3", "flight_time": "46 min", "battery_count": "3",
               "controller": "RC 2 (with screen)", "accessories": "ND filters, bag", "box": "Yes", "warranty": "3 months"},
              desc="DJI Air 3 Fly More Combo with dual cameras. Excellent condition, everything included.",
              brand="DJI", model="Air 3"),
            L("kasun@lankalens.lk", "drone-dji", "DJI Mavic Air 2", 230000, "Good",
              ["/images/products/drone-1.jpg"],
              {"brand": "DJI", "model": "Mavic Air 2", "flight_time": "34 min", "battery_count": "2",
               "controller": "RC-N1", "accessories": "Bag", "box": "Yes", "warranty": "None"},
              desc="DJI Mavic Air 2 with 4K60 camera. Reliable work drone, minor wear.",
              brand="DJI", model="Mavic Air 2"),
            L("tharindu@lankalens.lk", "drone-autel", "Autel EVO Nano+ Premium Bundle", 150000, "Excellent",
              ["/images/products/drone-1.jpg"],
              {"brand": "Autel", "model": "EVO Nano+", "flight_time": "28 min", "battery_count": "3",
               "controller": "Standard", "accessories": "Bag, charger", "box": "Yes", "warranty": "6 months"},
              desc="Autel EVO Nano+ with 1/1.28\" sensor. Excellent low-light for a sub-250g drone.",
              brand="Autel", model="EVO Nano+"),

            # Accessories
            L("nimalka@lankalens.lk", "tripods", "Manfrotto MT055XPRO3 Aluminium Tripod", 32000, "Like New",
              ["/images/products/tripod-1.jpg", "/images/products/tripod-2.jpg"],
              {"brand": "Manfrotto", "model": "MT055XPRO3", "compatibility": "Universal", "warranty": "None",
               "receipt": "Yes"},
              desc="Sturdy 3-section aluminium tripod with horizontal column. Barely used.",
              brand="Manfrotto", model="MT055XPRO3"),
            L("ishara@lankalens.lk", "gimbals", "Zhiyun Crane 3S Pro Gimbal", 45000, "Excellent",
              ["/images/products/gimbal-2.jpg", "/images/products/gimbal-3.jpg", "/images/products/gimbal-4.jpg"],
              {"brand": "Zhiyun", "model": "Crane 3S Pro", "compatibility": "DSLR / Mirrorless", "warranty": "2 months",
               "receipt": "Yes"},
              desc="Zhiyun Crane 3S Pro, handles heavy cinema rigs up to 6.5kg. Includes case.",
              featured=1, brand="Zhiyun", model="Crane 3S Pro", views=340),
            L("tharindu@lankalens.lk", "camera-bags", "Manfrotto Pro Light Camera Backpack", 18500, "Brand New",
              ["/images/products/bag-1.jpg", "/images/products/bag-2.jpg", "/images/products/bag-3.jpg"],
              {"brand": "Manfrotto", "model": "Pro Light", "compatibility": "1 body + 3 lenses + 15\" laptop",
               "warranty": "1 year", "receipt": "Yes"},
              desc="Brand new camera backpack with padded dividers and laptop compartment.",
              brand="Manfrotto", model="Pro Light"),
            L("ishara@lankalens.lk", "memory-cards", "SanDisk Extreme PRO 128GB SDXC (170MB/s)", 6500, "Brand New",
              ["/images/products/sd-1.jpg", "/images/products/sd-2.jpg"],
              {"brand": "SanDisk", "model": "Extreme PRO 128GB", "compatibility": "UHS-I U3 V30",
               "warranty": "Lifetime", "receipt": "Yes"},
              desc="Genuine SanDisk Extreme PRO 128GB cards. Ideal for 4K video. Sealed packaging.",
              brand="SanDisk", model="Extreme PRO 128GB"),
            L("kasun@lankalens.lk", "lights", "Godox SL60W Studio Light Kit", 24000, "Good",
              ["/images/products/light-1.jpg", "/images/products/light-2.jpg", "/images/products/light-3.jpg"],
              {"brand": "Godox", "model": "SL60W", "compatibility": "Bowens mount", "warranty": "None",
               "receipt": "Yes"},
              desc="Godox SL60W LED light with softbox and stand. Great for home studio work.",
              brand="Godox", model="SL60W"),
            L("nimalka@lankalens.lk", "microphones", "Rode VideoMic Pro+ Shotgun Mic", 38000, "Like New",
              ["/images/products/mic-1.jpg", "/images/products/mic-2.jpg", "/images/products/mic-3.jpg"],
              {"brand": "Rode", "model": "VideoMic Pro+", "compatibility": "Cameras with 3.5mm input",
               "warranty": "None", "receipt": "Yes"},
              desc="Rode VideoMic Pro+ with Rycote shock mount. Clean, crisp audio for video.",
              brand="Rode", model="VideoMic Pro+"),
            L("tharindu@lankalens.lk", "gopro-accessories", "GoPro Accessory Bundle (50-in-1)", 9500, "Brand New",
              ["/images/products/gopro-2.jpg"],
              {"brand": "GoPro", "model": "50-in-1 kit", "compatibility": "All GoPro mounts",
               "warranty": "None", "receipt": "No"},
              desc="Massive 50-piece GoPro accessory kit: mounts, straps, clips and a case.",
              brand="GoPro", model="50-in-1 kit"),
            L("ishara@lankalens.lk", "dji-accessories", "DJI Mini 3 ND Filter Set + Landing Gear", 7800, "Brand New",
              ["/images/products/drone-2.jpg"],
              {"brand": "DJI", "model": "ND Filter Set", "compatibility": "DJI Mini 3 / Mini 3 Pro",
               "warranty": "None", "receipt": "Yes"},
              desc="ND filter set and landing gear for DJI Mini 3. Brand new in packaging.",
              brand="DJI", model="ND Filter Set"),
            L("kasun@lankalens.lk", "accessories-other", "Peak Design Capture Camera Clip V3", 12000, "Excellent",
              ["/images/products/bag-3.jpg"],
              {"brand": "Peak Design", "model": "Capture Clip V3", "compatibility": "Any strap/belt",
               "warranty": "Lifetime", "receipt": "Yes"},
              desc="Peak Design Capture Clip V3 — carry your camera securely on any strap or belt.",
              brand="Peak Design", model="Capture Clip V3"),
        ]
        for i, l in enumerate(listings):
            ts = now() - (len(listings) - i) * 3600
            conn.execute(
                """INSERT INTO listings
                   (user_id, category_id, title, slug, price, condition, description, brand, model, year,
                    province, district, city, images, featured, status, views, specs, created_at, updated_at, expiry_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,?)""",
                (l[0], l[1], l[2], slugify(l[2]), l[3], l[4], l[5], l[6], l[7], l[8],
                 l[9], l[10], l[11], l[12], l[13], l[14], l[15], ts, ts, ts + EXPIRY_DAYS * 86400))
        conn.commit()

    if conn.execute("SELECT COUNT(*) FROM shops").fetchone()[0] == 0:
        shops = [
            ("Colombo Camera House", "colombo-camera-house", "Colombo 04", "Colombo", "Colombo", "Western Province",
             "+94 11 250 4400", "94112504400", "Authorised dealer for Sony, Canon and Fujifilm. Trade-ins welcome.",
             "Cameras, Lenses, Trade-in", "/images/shops/shop-1.jpg", 1),
            ("Kandy Photo Store", "kandy-photo-store", "Peradeniya Road", "Kandy", "Kandy", "Central Province",
             "+94 81 223 5112", "94812235112", "Full-service camera store in Kandy. Repairs, rentals and sales.",
             "Cameras, Repairs, Rentals", "/images/shops/shop-2.jpg", 1),
            ("Galle Lens Center", "galle-lens-center", "Wakwella Road", "Galle", "Galle", "Southern Province",
             "+94 91 222 7843", "94912227843", "Cameras and lenses for south coast photographers.",
             "Cameras, Lenses", "/images/shops/shop-3.jpg", 0),
            ("Negombo Camera Mart", "negombo-camera-mart", "Main Street", "Negombo", "Gampaha", "Western Province",
             "+94 31 223 0912", "94312230912", "Action cameras and drone specialists near the coast.",
             "Action Cameras, Drones", "/images/shops/shop-1.jpg", 0),
            ("Jaffna Photo Works", "jaffna-photo-works", "Hospital Road", "Jaffna", "Jaffna", "Northern Province",
             "+94 21 222 3315", "94212223315", "Everything for photographers in the Northern Province.",
             "Cameras, Printing", "/images/shops/shop-2.jpg", 0),
            ("Colombo Lens Exchange", "colombo-lens-exchange", "Union Place", "Colombo", "Colombo", "Western Province",
             "+94 77 765 4321", "94777654321", "Second-hand lens specialists — buy, sell and exchange.",
             "Lenses, Trade-in", "/images/shops/shop-3.jpg", 1),
        ]
        for name, slug, area, city, district, province, phone, wa, desc, spec, img, verified in shops:
            conn.execute(
                "INSERT INTO shops (name, slug, area, city, district, province, phone, whatsapp, description, specialties, image, verified, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (name, slug, area, city, district, province, phone, wa, desc, spec, img, verified, now()))
        conn.commit()

    if conn.execute("SELECT COUNT(*) FROM posts").fetchone()[0] == 0:
        posts = [
            ("how-to-check-a-used-camera", "How to Check a Used Camera Before You Buy",
             "Buying Guide",
             "A practical checklist every buyer should run through — sensor, shutter count, lens glass and more — before handing over your money.",
             "<p>Buying used gear is the smartest way to get into photography on a budget, but a little checking goes a long way.</p>"
             "<h4>1. Inspect the sensor</h4><p>Set the camera to its smallest aperture and shoot a plain white wall. Dust, scratches and oil spots will show up as dark marks.</p>"
             "<h4>2. Check the shutter count</h4><p>Most bodies have a rated shutter life (often 150,000–200,000 actuations). Ask for the count and factor it into the price.</p>"
             "<h4>3. Examine the lens glass</h4><p>Hold the lens up to a light and look for fungus, haze and dust. Run the focus and zoom rings — they should be smooth.</p>"
             "<h4>4. Test every button and port</h4><p>Pop the battery, memory card, flash and hotshoe. Test the HDMI and USB ports if you plan to use them.</p>"
             "<h4>5. Ask about the box, receipt and warranty</h4><p>Original packaging and a receipt are good signs the item is genuine and well cared for.</p>",
             "/images/products/sony-a7iii-1.jpg", "Lanka Lens Team"),
            ("mirrorless-vs-dslr", "Mirrorless vs DSLR in 2026 — Which Should You Buy?",
             "Buying Guide",
             "The mirrorless vs DSLR debate is mostly settled, but each still has its place. Here's how to decide.",
             "<p>Mirrorless cameras now dominate new sales, but DSLRs remain brilliant value on the used market.</p>"
             "<h4>Go mirrorless if…</h4><p>You want silent shooting, in-viewfinder previews, better video and the newest lens mounts. Autofocus eye-tracking is superb.</p>"
             "<h4>Go DSLR if…</h4><p>You want maximum battery life, an optical viewfinder and cheap, abundant used lenses.</p>"
             "<h4>The real decision</h4><p>Your budget and lens needs matter more than the body. Invest in good glass — it holds its value far better than bodies.</p>",
             "/images/products/fuji-xt4-1.jpg", "Lanka Lens Team"),
            ("best-lenses-for-sri-lanka-travel", "Best Lenses for Sri Lanka Travel Photography",
             "Guides",
             "From misty tea hills to temple ceremonies and wild leopards — the lenses that cover it all.",
             "<p>Sri Lanka packs beaches, wildlife and culture into a small island. A versatile kit covers all three.</p>"
             "<h4>The all-rounder</h4><p>A 24-70mm f/2.8 (or f/4) zoom handles streets, portraits and landscapes in one lens.</p>"
             "<h4>For wildlife</h4><p>Yala and Wilpattu demand reach: a 70-200mm or 100-400mm is essential for leopards and birds.</p>"
             "<h4>For low light</h4><p>Temple interiors and sunset shoots call for a fast prime — a 35mm or 50mm f/1.8 is affordable and small.</p>",
             "/images/products/lens-canon-1.jpg", "Lanka Lens Team"),
            ("drone-laws-sri-lanka", "Flying a Drone in Sri Lanka — The Rules You Need to Know",
             "Guides",
             "Drone rules changed recently. Here's a quick, plain-language summary for hobbyists and creators.",
             "<p>Drones under 250g are generally the easiest to fly legally for recreation.</p>"
             "<h4>Registration</h4><p>Recreational drones above 250g may need registration with the Civil Aviation Authority of Sri Lanka (CAASL).</p>"
             "<h4>Where not to fly</h4><p>Stay away from airports, military areas and government buildings. Avoid crowds and respect people's privacy.</p>"
             "<h4>Fly safe</h4><p>Keep the drone within visual line of sight and avoid flying in strong coastal winds. Always check the latest CAASL guidance before you fly.</p>",
             "/images/products/drone-1.jpg", "Lanka Lens Team"),
        ]
        for slug, title, cat, excerpt, body, img, author in posts:
            conn.execute(
                "INSERT INTO posts (slug, title, category, excerpt, body, image, author, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (slug, title, cat, excerpt, body, img, author, now()))
        conn.commit()

    conn.close()


# ---------------------------------------------------------------------------
# Boot
# ---------------------------------------------------------------------------
os.makedirs(UPLOAD_DIR, exist_ok=True)
if not os.path.exists(DB_PATH):
    open(DB_PATH, "a").close()
seed()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
