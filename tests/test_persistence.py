from concurrent.futures import ThreadPoolExecutor
import json
import sqlite3
import subprocess
import sys
import uuid
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql
import pytest
import requests

from server.manage_db import (import_sqlite, MigrationError, verify_rows, inspect_source,
                              destination_tables, fingerprint, snapshot)
from server.reference_data import DEFAULT_SETTINGS
from server.schema import TABLES
from conftest import B2_KEY, PASSWORD, ROOT, cli, clean_env, running_app


def api(base, path, method="GET", token=None, **kw):
    r = requests.request(method, base + path, headers={"Authorization": "Bearer " + token} if token else {}, timeout=15, **kw)
    assert r.status_code == 200, (path, r.status_code, r.text[:250])
    assert r.json()["ok"]
    return r.json()["data"]


def test_import_every_table_and_idempotency(pg_url, legacy_sqlite):
    before = fingerprint(legacy_sqlite)
    import_sqlite(legacy_sqlite)
    with sqlite3.connect(legacy_sqlite) as src, psycopg.connect(pg_url) as pg:
        manifest = verify_rows(src, pg, inspect_source(src))
        assert set(TABLES) < set(manifest)
        assert {"shops", "legacy_notes"} <= set(manifest)
        assert pg.execute("SELECT images FROM listings WHERE id=100").fetchone()[0] == src.execute("SELECT images FROM listings WHERE id=100").fetchone()[0]
        assert pg.execute("SELECT COUNT(*) FROM ll_schema_migrations").fetchone()[0] == 1
    import_sqlite(legacy_sqlite)
    assert cli(pg_url, "migrate").returncode == 0
    assert cli(pg_url, "migrate").returncode == 0
    assert fingerprint(legacy_sqlite) == before


def test_user_listing_survive_two_process_replacements(pg_url, legacy_sqlite, tmp_path):
    import_sqlite(legacy_sqlite)
    with running_app(pg_url, tmp_path) as base:
        # Old password hashes, sessions and admin permissions survived import.
        admin = api(base, "/api/auth/login", "POST", json={"email": "user41@example.test", "password": PASSWORD})["token"]
        assert api(base, "/api/me", token="legacy-session")["user"]["id"] == 42
        signup = api(base, "/api/auth/signup", "POST", json={"name": "Persistence Test User", "email": "restart@example.test", "password": PASSWORD})
        token = signup["token"]
        uid = signup["user"]["id"]
        assert uid > 600
        listing = api(base, "/api/listings", "POST", token=token, json={
            "title": "Restart Persistence Camera", "price": 150000, "category_id": 2,
            "condition": "Good", "province": "Western Province", "district": "Gampaha",
            "city": "Negombo", "images": [B2_KEY, "/images/products/canon-5d-1.jpg"],
            "specs": {"shutter_count": "1,000", "megapixels": "24 MP"},
        })
        lid = listing["id"]
        assert lid > 800
        assert any(x["id"] == lid for x in api(base, "/api/listings")["items"])
        assert api(base, "/api/admin/dashboard", token=admin)["counts"]["users"] == 3
        assert requests.get(base + "/images/products/canon-5d-1.jpg", timeout=5).status_code == 200
        # Exact migrated B2 key is still returned through the unchanged resolver.
        assert api(base, f"/api/listings/{lid}")["images"][0] == "/" + B2_KEY
    # Import re-run after new production writes must NOT restore older rows over them.
    import_sqlite(legacy_sqlite)
    # Each iteration boots completely new Gunicorn master/worker processes;
    # the second uses two workers to exercise independent per-process pools.
    for workers in (1, 2):
        with running_app(pg_url, tmp_path, workers=workers) as base:
            assert api(base, "/api/me", token=token)["user"]["id"] == uid
            assert api(base, f"/api/listings/{lid}")["title"] == "Restart Persistence Camera"
            login = api(base, "/api/auth/login", "POST", json={"email": "restart@example.test", "password": PASSWORD})
            assert login["user"]["id"] == uid
            assert any(x["id"] == lid for x in api(base, "/api/listings?q=restart persistence")["items"])
            assert api(base, "/api/admin/dashboard", token=admin)["counts"]["users"] == 3
            assert api(base, "/api/business/legacy-shop")["business"]["name"] == "Legacy Shop"
    with psycopg.connect(pg_url) as pg:
        assert json.loads(pg.execute("SELECT images FROM listings WHERE id=%s", (lid,)).fetchone()[0])[0] == B2_KEY
        assert pg.execute("SELECT COUNT(*) FROM shops").fetchone()[0] == 1
        assert pg.execute("SELECT COUNT(*) FROM sessions WHERE token=%s", (token,)).fetchone()[0] == 1
        assert pg.execute("SELECT COUNT(*) FROM tokens WHERE token='legacy-token'").fetchone()[0] == 1
    print("PASS: signup, listing creation, login, sessions and admin survive TWO real application process replacements; B2 key unchanged (live B2 not exercised).")


def test_postgres_search_upserts_admin_and_concurrency(pg_url, legacy_sqlite, tmp_path):
    import_sqlite(legacy_sqlite)
    with running_app(pg_url, tmp_path) as base:
        admin = api(base, "/api/auth/login", "POST", json={"email": "user41@example.test", "password": PASSWORD})["token"]
        for path in ["/api/meta", "/api/listings?q=canon", "/api/listings?q=%25", "/api/listings?model=cAnOn",
                     "/api/listings?spec_shutter_count_min=1000", "/api/listings?spec_shutter_count_max=1000",
                     "/api/listings?spec_megapixels_min=24", "/api/listings?spec_megapixels_max=24",
                     "/api/listings?spec_megapixels=24%20MP", "/api/facets?category=cameras"]:
            data = api(base, path)
            if "spec_" in path:
                assert data["total"] == 1
        for path in ["/api/admin/dashboard", "/api/admin/users?q=existing", "/api/admin/users/42", "/api/admin/listings?q=canon",
                     "/api/admin/reports", "/api/admin/businesses", "/api/admin/brands", "/api/admin/settings", "/api/admin/audit",
                     "/api/chat/conversations", "/api/chat/42", "/api/me/analytics", "/api/me/offers"]:
            api(base, path, token=admin)
        dashboard = api(base, "/api/admin/dashboard", token=admin)
        assert isinstance(dashboard["counts"]["revenue"], (int, float))
        assert isinstance(api(base, "/api/business/legacy-shop")["rating"]["avg"], (int, float))
        for _ in range(2):
            api(base, "/api/favorites/100", "POST", token=admin)
            api(base, "/api/seller/42/rate", "POST", token=admin, json={"stars": 4, "comment": "Updated review"})
            api(base, "/api/chat/42/block", "POST", token=admin)
        api(base, "/api/admin/settings", "PUT", token=admin, json={"site_name": "Persistence Test Marketplace"})
        assert api(base, "/api/admin/settings", token=admin)["settings"]["site_name"] == "Persistence Test Marketplace"
        api(base, "/api/admin/listings/100/moderate", "POST", token=admin, json={"action": "suspend"})
        with ThreadPoolExecutor(max_workers=8) as workers:
            assert all(workers.map(lambda _: requests.get(base + "/api/health", timeout=10).status_code == 200, range(32)))
    with running_app(pg_url, tmp_path) as base:
        assert api(base, "/api/admin/settings", token=admin)["settings"]["site_name"] == "Persistence Test Marketplace"
    with psycopg.connect(pg_url) as pg:
        assert pg.execute("SELECT status FROM listings WHERE id=100").fetchone()[0] == "paused"
        assert pg.execute("SELECT COUNT(*) FROM favorites").fetchone()[0] == 1
        assert pg.execute("SELECT COUNT(*) FROM ratings").fetchone()[0] == 1


def test_nonempty_destination_is_never_overwritten(pg_url, legacy_sqlite):
    with psycopg.connect(pg_url) as pg:
        pg.execute("CREATE TABLE important (value TEXT)")
        pg.execute("INSERT INTO important VALUES ('preserve')")
    with pytest.raises(MigrationError, match="not empty"):
        import_sqlite(legacy_sqlite)
    with psycopg.connect(pg_url) as pg:
        assert pg.execute("SELECT value FROM important").fetchone()[0] == "preserve"
        assert destination_tables(pg) == {"important"}


def test_bad_row_rolls_back_entire_import(pg_url, legacy_sqlite):
    # SQLite permits NUL in TEXT; PostgreSQL rejects it. Never silently strip it.
    with sqlite3.connect(legacy_sqlite) as src:
        src.execute("UPDATE users SET bio=? WHERE id=42", ("keep\x00all",))
    result = cli(pg_url, "import-sqlite", "--source", str(legacy_sqlite))
    assert result.returncode == 1
    assert "keep" not in result.stderr
    with psycopg.connect(pg_url) as pg:
        assert not destination_tables(pg)
    with sqlite3.connect(legacy_sqlite) as src:
        assert src.execute("SELECT bio FROM users WHERE id=42").fetchone()[0] == "keep\x00all"


def test_legacy_missing_columns_and_unknown_records_preserved(pg_url, legacy_sqlite):
    with sqlite3.connect(legacy_sqlite) as src:
        src.execute("DROP INDEX idx_sessions_user")
        src.execute("ALTER TABLE sessions DROP COLUMN expires_at")
        for col in ("verification_status", "submitted_at", "reviewed_at"):
            src.execute(f"ALTER TABLE businesses DROP COLUMN {col}")
    import_sqlite(legacy_sqlite)
    with psycopg.connect(pg_url) as pg:
        assert pg.execute("SELECT verification_status FROM businesses").fetchone()[0] == "approved"
        created, expires = pg.execute("SELECT created_at,expires_at FROM sessions").fetchone()
        assert expires == created + 30 * 86400
        assert pg.execute("SELECT name FROM shops").fetchone()[0] == "Do not drop this legacy shop"
        assert pg.execute("SELECT contents FROM legacy_notes").fetchone()[0] == b"\x00\xfflegacy"


def test_unsupported_schema_aborts_before_writes(pg_url, legacy_sqlite):
    with sqlite3.connect(legacy_sqlite) as src:
        src.execute("CREATE VIEW legacy_view AS SELECT * FROM users")
    with pytest.raises(MigrationError, match="triggers/views"):
        import_sqlite(legacy_sqlite)
    with psycopg.connect(pg_url) as pg:
        assert not destination_tables(pg)


def test_wal_backup_is_consistent_and_non_overwriting(tmp_path):
    source = tmp_path / "wal.sqlite3"
    backup = tmp_path / "backup.sqlite3"
    with sqlite3.connect(source) as src:
        src.execute("PRAGMA journal_mode=WAL")
        src.execute("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT)")
        src.execute("INSERT INTO records VALUES (1,'committed in WAL')")
        src.commit()
        snapshot(source, backup)
        with sqlite3.connect(backup) as copied:
            assert copied.execute("SELECT value FROM records").fetchone()[0] == "committed in WAL"
        with pytest.raises(FileExistsError):
            snapshot(source, backup)
    assert backup.stat().st_mode & 0o777 == 0o600


def test_production_refuses_sqlite_and_missing_schema(pg_url, tmp_path):
    missing = tmp_path / "must-not-be-created.sqlite3"
    env = clean_env() | {"APP_ENV": "production", "SQLITE_PATH": str(missing)}
    r = subprocess.run([sys.executable, "-c", "import server.app"], env=env, cwd=ROOT, capture_output=True, text=True)
    assert r.returncode != 0 and "requires a PostgreSQL" in r.stderr
    assert not missing.exists()
    env.pop("APP_ENV")
    env["RAILWAY_SERVICE_ID"] = "isolated-test"
    r = subprocess.run([sys.executable, "-c", "import server.app"], env=env, cwd=ROOT, capture_output=True, text=True)
    assert r.returncode != 0 and not missing.exists()
    env = clean_env() | {"DATABASE_URL": pg_url}
    r = subprocess.run([sys.executable, "-c", "import server.app"], env=env, cwd=ROOT, capture_output=True, text=True)
    assert r.returncode != 0 and "not prepared" in r.stderr
    with psycopg.connect(pg_url) as pg:
        assert not destination_tables(pg)


def test_connection_failure_does_not_expose_credentials_or_fallback(tmp_path):
    secret = "DB-SECRET-MUST-NOT-APPEAR"
    env = clean_env() | {"APP_ENV": "production", "DATABASE_URL": f"postgresql://secret-user:{secret}@127.0.0.1:1/missing",
                         "SQLITE_PATH": str(tmp_path / "missing.db")}
    r = subprocess.run([sys.executable, "-c", "import server.app"], env=env, cwd=ROOT, capture_output=True, text=True, timeout=15)
    assert r.returncode != 0
    assert secret not in r.stdout + r.stderr
    assert "secret-user" not in r.stdout + r.stderr
    assert not (tmp_path / "missing.db").exists()


def test_request_rollback_on_failure(pg_url, legacy_sqlite):
    import_sqlite(legacy_sqlite)
    env = clean_env() | {"DATABASE_URL": pg_url}
    script = '''
from server.app import app, execute
@app.route('/api/test-failure', methods=['POST'])
def fail():
    execute("INSERT INTO users (name,email,password_hash) VALUES (?,?,?)", ('Rollback','rollback@example.test','not-a-login'))
    execute("INSERT INTO listings (user_id,category_id,title) VALUES (?,?,?)", (-99,1,'Invalid foreign key'))
    return {'ok':True}
with app.test_client() as c:
    r=c.post('/api/test-failure')
    assert r.status_code in (409,503), r.status_code
'''
    r = subprocess.run([sys.executable, "-c", script], env=env, cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    with psycopg.connect(pg_url) as pg:
        assert pg.execute("SELECT COUNT(*) FROM users WHERE email='rollback@example.test'").fetchone()[0] == 0


def test_local_sqlite_explicit_init_and_restarts(tmp_path):
    path = tmp_path / "local.sqlite3"
    extra = {"SQLITE_PATH": str(path)}
    assert cli(None, "init-empty", extra=extra).returncode == 0
    assert cli(None, "init-empty", extra=extra).returncode == 0
    assert cli(None, "seed-demo", extra=extra).returncode == 0
    for _ in range(2):
        with running_app(None, tmp_path, sqlite_path=path) as base:
            assert api(base, "/api/listings")["total"] > 0
            login = api(base, "/api/auth/login", "POST", json={"email": "admin@lankalens.lk", "password": "admin1234"})
            api(base, "/api/admin/dashboard", token=login["token"])


def test_b2_resolver_receives_exact_imported_key(pg_url, legacy_sqlite):
    import_sqlite(legacy_sqlite)
    # B2 network is mocked, not the resolver or PostgreSQL. Live B2 requires the
    # production credentials and a real known object; this is NOT a live-B2 test.
    env = clean_env() | {"DATABASE_URL": pg_url}
    script = '''
import server.app as mod
from unittest.mock import Mock, patch
client=Mock()
client.generate_presigned_url.return_value='https://b2.invalid/test-signed-image'
with patch.object(mod, 'b2_enabled', return_value=True), patch.object(mod, 'get_b2_client', return_value=client):
    with mod.app.test_client() as c:
        r=c.get('/api/listings/100')
        assert r.status_code==200
        assert r.json['data']['images'][0]=='https://b2.invalid/test-signed-image'
    assert any(call.kwargs['Params']['Key']==KEY for call in client.generate_presigned_url.call_args_list)
'''.replace("KEY", repr(B2_KEY))
    r = subprocess.run([sys.executable, "-c", script], env=env, cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_database_restart_and_outage_recovery(pg_url, legacy_sqlite, tmp_path, postgres):
    """Restart the actual PG server while the application process stays running."""
    import time
    from pgserver.postgres_server import pg_ctl
    import_sqlite(legacy_sqlite)
    with running_app(pg_url, tmp_path) as base:
        assert api(base, "/api/me", token="legacy-session")["user"]["id"] == 42
        pg_ctl(["-m", "fast", "-w", "stop"], pgdata=postgres.pgdata, user=postgres.system_user, timeout=15)
        try:
            response = requests.get(base + "/api/health", timeout=12)
            assert response.status_code == 503
            assert response.json()["error"] == "Database temporarily unavailable. Please try again."
            assert "postgresql://" not in response.text
        finally:
            postgres.ensure_postgres_running()
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if requests.get(base + "/api/health", timeout=10).status_code == 200:
                break
            time.sleep(0.2)
        else:
            pytest.fail("Pool did not recover after PostgreSQL restart")
        assert api(base, "/api/me", token="legacy-session")["user"]["id"] == 42
        assert api(base, "/api/listings/100")["title"] == "Legacy Canon Camera"
        assert api(base, "/api/auth/login", "POST", json={"email": "user42@example.test", "password": PASSWORD})["user"]["id"] == 42
    print("PASS: real PostgreSQL restart preserved imported records; health failed safely during outage and pool recovered without application restart.")


def test_concurrent_imports_are_serialized(pg_url, legacy_sqlite):
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: cli(pg_url, "import-sqlite", "--source", str(legacy_sqlite)), range(2)))
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    with psycopg.connect(pg_url) as pg:
        assert pg.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 2
        assert pg.execute("SELECT COUNT(*) FROM ll_schema_migrations").fetchone()[0] == 1


def test_fresh_initialization_is_explicit_idempotent_and_boots(pg_url, tmp_path):
    # The bare explicit command prepares a brand-new empty PostgreSQL database.
    first = cli(pg_url, "init-empty")
    assert first.returncode == 0, first.stderr
    # Re-running is a safe no-op: no duplicated reference rows, no error.
    second = cli(pg_url, "init-empty")
    assert second.returncode == 0, second.stderr
    assert "already prepared" in second.stdout
    # Demo seeding stays a local-SQLite-only operation.
    assert cli(pg_url, "seed-demo").returncode == 1
    # The version gate used by Railway pre-deploy passes after initialization.
    assert cli(pg_url, "migrate").returncode == 0
    with psycopg.connect(pg_url) as pg:
        # No marketplace accounts/data are fabricated.
        assert pg.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
        assert pg.execute("SELECT COUNT(*) FROM listings").fetchone()[0] == 0
        assert pg.execute("SELECT COUNT(*) FROM businesses").fetchone()[0] == 0
        # All required reference/default data is present.
        assert pg.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 37
        assert pg.execute("SELECT COUNT(*) FROM brands").fetchone()[0] == 20
        assert pg.execute("SELECT COUNT(*) FROM provinces").fetchone()[0] == 9
        assert pg.execute("SELECT COUNT(*) FROM site_settings").fetchone()[0] == len(DEFAULT_SETTINGS)
        assert pg.execute("SELECT COUNT(*) FROM ll_schema_migrations").fetchone()[0] == 1
        # Every application table exists (constraints/indexes come with the schema DDL).
        found = {r[0] for r in pg.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'")}
        assert set(TABLES) <= found
        index_count = pg.execute("SELECT count(*) FROM pg_indexes WHERE schemaname='public'").fetchone()[0]
        assert index_count >= len(TABLES)
    # The application then boots normally in production mode and passes readiness.
    with running_app(pg_url, tmp_path) as base:
        health = requests.get(base + "/api/health", timeout=10).json()["data"]
        assert health["status"] == "up"
        assert health["database"] == "postgresql"
        meta = api(base, "/api/meta")
        assert meta["categories"] and meta["brands"]
        assert api(base, "/api/listings")["total"] == 0
        # The first real account gets a normal, non-reused ID.
        signup = api(base, "/api/auth/signup", "POST", json={
            "name": "First Owner", "email": "owner@example.test", "password": PASSWORD})
        assert signup["user"]["id"] == 1
        assert api(base, "/api/auth/login", "POST",
                  json={"email": "owner@example.test", "password": PASSWORD})["user"]["id"] == 1
    # A third init after live writes still changes nothing (fix-forward safety).
    third = cli(pg_url, "init-empty")
    assert third.returncode == 0 and "already prepared" in third.stdout


def test_init_refuses_nonempty_database_without_dropping_anything(postgres):
    """init-empty must never become a destructive operation on a used database."""
    name = "ll_test_" + uuid.uuid4().hex[:12]
    with psycopg.connect(postgres.get_uri(), autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    uri = urlsplit(postgres.get_uri())
    url = urlunsplit((uri.scheme, uri.netloc, "/" + name, uri.query, uri.fragment))
    try:
        with psycopg.connect(url, autocommit=True) as pg:
            pg.execute("CREATE TABLE keep_existing (id BIGINT PRIMARY KEY, note TEXT)")
            pg.execute("INSERT INTO keep_existing VALUES (1, 'must survive a refused init')")
        result = cli(url, "init-empty")
        assert result.returncode == 1
        assert "not empty" in result.stderr
        with psycopg.connect(url) as pg:
            # Nothing was dropped, truncated, or created.
            assert pg.execute("SELECT note FROM keep_existing WHERE id=1").fetchone()[0] == \
                "must survive a refused init"
            tables = {r[0] for r in pg.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'")}
            assert tables == {"keep_existing"}
    finally:
        with psycopg.connect(postgres.get_uri(), autocommit=True) as admin:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


def test_application_startup_performs_no_database_writes(pg_url, legacy_sqlite):
    import_sqlite(legacy_sqlite)
    env = clean_env() | {"DATABASE_URL": pg_url}
    script = '''
from server.database import database
from unittest.mock import patch
# A read-only database session allows startup but would reject DDL, seeding,
# business/status updates, session cleanup, or deletion during app import.
original = database.connect
def readonly():
    c = original()
    c.raw.execute('SET TRANSACTION READ ONLY')
    return c
with patch.object(database, 'connect', side_effect=readonly):
    import server.app
'''
    r = subprocess.run([sys.executable, "-c", script], env=env, cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    with sqlite3.connect(legacy_sqlite) as src, psycopg.connect(pg_url) as pg:
        verify_rows(src, pg, inspect_source(src))


def test_empty_sqlite_marketplace_cannot_silently_cut_over(pg_url, tmp_path):
    from server.schema import SCHEMA
    source = tmp_path / "wrong-empty.sqlite3"
    with sqlite3.connect(source) as src:
        src.executescript(SCHEMA)
    with pytest.raises(MigrationError, match="empty marketplace"):
        import_sqlite(source)
    with psycopg.connect(pg_url) as pg:
        assert not destination_tables(pg)
