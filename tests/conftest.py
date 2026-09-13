"""All tests use disposable local PostgreSQL, never DATABASE_URL from the host."""
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import time
from urllib.parse import urlsplit, urlunsplit
import uuid

import pgserver
import psycopg
from psycopg import sql
import pytest
import requests

from server.schema import SCHEMA, INDEXES, TABLES
from server.manage_db import insert_reference

ROOT = Path(__file__).resolve().parents[1]
B2_KEY = "uploads/legacy-camera-සිංහල-01.jpg"
PASSWORD = "Persistence-test-only-987!"


def clean_env():
    return {k: v for k, v in os.environ.items()
            if not k.startswith(("B2_", "RAILWAY_", "DATABASE_", "APP_ENV", "FLASK_ENV", "SQLITE_PATH"))}


def cli(url, *args, extra=None):
    env = clean_env()
    if url:
        env["DATABASE_URL"] = url
    env.update(extra or {})
    return subprocess.run([sys.executable, "-m", "server.manage_db", *args], cwd=ROOT,
                          env=env, capture_output=True, text=True, timeout=60)


@pytest.fixture(scope="session")
def postgres(tmp_path_factory):
    server = pgserver.get_server(tmp_path_factory.mktemp("postgres") / "data")
    yield server
    server.cleanup()


@pytest.fixture
def pg_url(postgres, monkeypatch):
    name = "ll_test_" + uuid.uuid4().hex[:12]
    with psycopg.connect(postgres.get_uri(), autocommit=True) as c:
        c.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    uri = urlsplit(postgres.get_uri())
    url = urlunsplit((uri.scheme, uri.netloc, "/" + name, uri.query, uri.fragment))
    monkeypatch.setenv("DATABASE_URL", url)
    yield url
    with psycopg.connect(postgres.get_uri(), autocommit=True) as c:
        c.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


@pytest.fixture
def legacy_sqlite(tmp_path):
    """Nonempty examples in ALL 28 tables plus shops and an unknown legacy table."""
    path = tmp_path / "legacy.sqlite3"
    ts = int(time.time())
    salt = "local-test-salt"
    password_hash = salt + "$" + hashlib.pbkdf2_hmac("sha256", PASSWORD.encode(), salt.encode(), 120000).hex()
    with sqlite3.connect(path) as c:
        c.executescript(SCHEMA)
        c.execute("PRAGMA foreign_keys=ON")
        insert_reference(c, False)
        for ident, name, admin in [(41, "Existing Admin", 1), (42, "Existing Seller", 0)]:
            c.execute("INSERT INTO users (id,name,email,password_hash,is_admin,phone,created_at) VALUES (?,?,?,?,?,?,?)",
                      (ident, name, f"user{ident}@example.test", password_hash, admin, "+94771234567", ts))
        c.execute("INSERT INTO listings (id,user_id,category_id,title,price,images,specs,created_at,updated_at,expiry_at) VALUES (100,42,2,?,?,?,?,?,?,?)",
                  ("Legacy Canon Camera", 125000, json.dumps([B2_KEY, "/images/products/canon-5d-1.jpg"], ensure_ascii=False), '{"shutter_count":"1,000", "megapixels":"24 MP"}', ts, ts, ts + 864000))
        c.execute("INSERT INTO sessions VALUES ('legacy-session',42,?,?)", (ts, ts + 864000))
        c.execute("INSERT INTO tokens VALUES ('legacy-token',42,'email','preserve',?,?)", (ts, ts + 864000))
        c.execute("INSERT INTO favorites VALUES (41,100,?)", (ts,))
        c.execute("INSERT INTO offers (id,listing_id,buyer_id,seller_id,amount,created_at) VALUES (1,100,41,42,1000,?)", (ts,))
        c.execute("INSERT INTO messages (id,listing_id,sender_id,receiver_id,body,created_at) VALUES (1,100,41,42,'Preserve this message',?)", (ts,))
        c.execute("INSERT INTO notifications (user_id,title,created_at) VALUES (42,'Persist',?)", (ts,))
        c.execute("INSERT INTO reports (listing_id,reporter_id,reason) VALUES (100,41,'test')")
        c.execute("INSERT INTO user_reports (reporter_id,reported_id,reason) VALUES (41,42,'test')")
        c.execute("INSERT INTO contact_events (listing_id,seller_id,buyer_id,kind) VALUES (100,42,41,'call')")
        c.execute("INSERT INTO ratings (seller_id,buyer_id,listing_id,stars,comment) VALUES (42,41,100,5,'Preserve review')")
        c.execute("INSERT INTO blocks VALUES (42,41,?)", (ts,))
        c.execute("INSERT INTO businesses (user_id,name,slug,logo,document,verified,verification_status,created_at) VALUES (42,'Legacy Shop','legacy-shop','uploads/logo.jpg','uploads/document.jpg',1,'approved',?)", (ts,))
        c.execute("INSERT INTO contact_messages (name,message) VALUES ('Old customer','Preserve')")
        c.execute("INSERT INTO posts (slug,title,body) VALUES ('legacy-post','Old post','Preserve')")
        c.execute("INSERT INTO models (brand_id,name) VALUES (1,'Old model')")
        c.execute("INSERT INTO payments (id,transaction_id,user_id,amount,listing_id,status) VALUES (1,'old-transaction',42,499,100,'successful')")
        c.execute("INSERT INTO promotions (listing_id,user_id,ptype,payment_id,ends_at) VALUES (100,42,'featured',1,?)", (ts+864000,))
        c.execute("INSERT INTO audit_logs (admin_id,action,detail) VALUES (41,'preserve','Existing admin log')")
        c.execute("INSERT INTO banned_emails (email) VALUES ('banned@example.test')")
        c.execute("INSERT INTO blocked_ips (ip) VALUES ('192.0.2.1')")
        c.execute("CREATE TABLE shops (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)")
        c.execute("INSERT INTO shops VALUES (77,'Do not drop this legacy shop')")
        c.execute("CREATE TABLE legacy_notes (id INTEGER PRIMARY KEY, contents BLOB)")
        c.execute("INSERT INTO legacy_notes VALUES (1,?)", (b"\x00\xfflegacy",))
        c.execute("ALTER TABLE users ADD COLUMN legacy_flag TEXT DEFAULT 'untouched'")
        c.execute("CREATE INDEX extra_users_legacy ON users(legacy_flag)")
        for ddl in INDEXES:
            c.execute(ddl)
        # Deleted historical IDs must not be reused after migration.
        c.execute("UPDATE sqlite_sequence SET seq=800 WHERE name='listings'")
        c.execute("UPDATE sqlite_sequence SET seq=600 WHERE name='users'")
        assert all(c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] > 0 for t in TABLES)
    return path


@contextmanager
def running_app(url, tmp_path, sqlite_path=None, workers=1):
    env = clean_env()
    if url:
        env.update(DATABASE_URL=url, APP_ENV="production")
    if sqlite_path:
        env["SQLITE_PATH"] = str(sqlite_path)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    log_path = tmp_path / ("app-" + uuid.uuid4().hex[:8] + ".log")
    with log_path.open("w+") as log:
        proc = subprocess.Popen([sys.executable, "-m", "gunicorn", "--bind", f"0.0.0.0:{port}",
                                 "--workers", str(workers), "--threads", "4", "server.app:app"],
                                env=env, cwd=ROOT, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    log.seek(0)
                    pytest.fail("Application failed to start: " + log.read())
                try:
                    if requests.get(base + "/api/health", timeout=1).status_code == 200:
                        break
                except requests.RequestException:
                    pass
                time.sleep(0.1)
            else:
                pytest.fail("Application health did not become ready")
            yield base
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
