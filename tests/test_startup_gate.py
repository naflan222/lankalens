"""The production startup gate: `docker-entrypoint.sh` + `manage_db wait-for-db`.

These tests execute the *real* script exactly as the Dockerfile CMD and
railway.json's startCommand invoke it (`/bin/sh <repo>/docker-entrypoint.sh`),
against disposable PostgreSQL and real Gunicorn processes. They assert the
required ordering, the fail-closed refusals, that a prepared database survives
restarts untouched, and that a brand-new database is prepared only on explicit
operator opt-in. No production DATABASE_URL, no B2 credentials and no network
storage are involved; B2 is never contacted.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql
import pytest
import requests

from server.manage_db import destination_tables, import_sqlite
from server.schema import TABLES
from conftest import PASSWORD, ROOT, clean_env, cli

ENTRYPOINT = ROOT / "docker-entrypoint.sh"
DOCKERFILE = ROOT / "Dockerfile"
RAILWAY_CONFIG = ROOT / "railway.json"
# A DSN secret that must never reach the logs from any failure path.
SECRET = "STARTUP-GATE-SECRET-MUST-NOT-APPEAR"
WATCHED = list(TABLES) + ["shops"]


def api(base, path, method="GET", token=None, **kw):
    r = requests.request(method, base + path,
                         headers={"Authorization": "Bearer " + token} if token else {},
                         timeout=15, **kw)
    assert r.status_code == 200, (path, r.status_code, r.text[:250])
    assert r.json()["ok"]
    return r.json()["data"]


def counts(url):
    with psycopg.connect(url) as pg:
        return {table: pg.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] for table in WATCHED}


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def port_is_open(port):
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def gate_env(url, port, extra=None):
    """The image's environment: APP_ENV=production and the runtime on PATH."""
    env = clean_env()
    # The script resolves its interpreter with `command -v python3`, exactly as
    # it does inside python:3.12-slim; put this test runner's environment first
    # (unresolved: a venv's bin/python is a symlink to the system interpreter).
    env["PATH"] = os.pathsep.join([os.path.dirname(sys.executable), env.get("PATH", "")])
    env["APP_ENV"] = "production"
    env["PYTHONUNBUFFERED"] = "1"
    env["PORT"] = str(port)
    if url:
        env["DATABASE_URL"] = url
    env.update(extra or {})
    return env


class Gate:
    def __init__(self, proc, base, log_path):
        self.proc = proc
        self.base = base
        self.log_path = log_path
        self.returncode = None

    def log(self):
        return self.log_path.read_text(errors="replace")

    def argv(self):
        """argv of the started process: proves `exec` replaced the shell."""
        try:
            return Path(f"/proc/{self.proc.pid}/cmdline").read_bytes().replace(b"\0", b" ").decode()
        except OSError:
            return ""

    def stop(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
        self.returncode = self.proc.returncode
        return self.returncode


class StartupFailed(AssertionError):
    pass


@contextmanager
def startup_gate(url, tmp_path, extra=None, ready=True, timeout=90):
    """Run the real entrypoint; by default wait until /api/health returns 200."""
    port = free_port()
    log_path = tmp_path / ("gate-" + uuid.uuid4().hex[:8] + ".log")
    handle = log_path.open("w+")
    proc = subprocess.Popen(["/bin/sh", str(ENTRYPOINT)], env=gate_env(url, port, extra),
                            cwd=ROOT, stdout=handle, stderr=handle)
    gate = Gate(proc, f"http://127.0.0.1:{port}", log_path)
    try:
        if ready:
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    raise StartupFailed("Startup gate exited before serving:\n" + gate.log())
                try:
                    if requests.get(gate.base + "/api/health", timeout=1).status_code == 200:
                        break
                except requests.RequestException:
                    pass
                time.sleep(0.1)
            else:
                raise StartupFailed("/api/health never became ready:\n" + gate.log())
        yield gate
    finally:
        gate.stop()
        handle.close()


def run_gate_expect_failure(url, tmp_path, extra=None, timeout=120):
    """The gate must exit non-zero *before* Gunicorn binds the port."""
    port = free_port()
    log_path = tmp_path / ("gate-fail-" + uuid.uuid4().hex[:8] + ".log")
    with log_path.open("w+") as handle:
        done = subprocess.run(["/bin/sh", str(ENTRYPOINT)], env=gate_env(url, port, extra),
                              cwd=ROOT, stdout=handle, stderr=handle, timeout=timeout)
    log = log_path.read_text(errors="replace")
    assert done.returncode != 0, "gate must fail closed:\n" + log
    assert "Listening at" not in log and "Booting worker" not in log, \
        "Gunicorn must not start when the database gate fails:\n" + log
    assert not port_is_open(port), "nothing may listen on PORT when the gate fails"
    return log


@pytest.fixture
def scratch_database(postgres):
    """A separate disposable database, for states the pg_url fixture cannot express."""
    name = "ll_gate_" + uuid.uuid4().hex[:12]
    with psycopg.connect(postgres.get_uri(), autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    uri = urlsplit(postgres.get_uri())
    url = urlunsplit((uri.scheme, uri.netloc, "/" + name, uri.query, uri.fragment))
    try:
        yield url
    finally:
        with psycopg.connect(postgres.get_uri(), autocommit=True) as admin:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


def test_gate_migrates_before_gunicorn_and_preserves_every_row(pg_url, legacy_sqlite, tmp_path):
    """Prepared PostgreSQL -> migrate -> gunicorn -> /api/health, with data intact."""
    import_sqlite(legacy_sqlite)
    before = counts(pg_url)
    with startup_gate(pg_url, tmp_path) as gate:
        health = requests.get(gate.base + "/api/health", timeout=10).json()["data"]
        assert health["status"] == "up"
        assert health["database"] == "postgresql"
        log = gate.log()
        # Ordering evidence: the gate finished before Gunicorn bound the port.
        assert "PostgreSQL accepted connections" in log
        assert "Schema version 1 is current" in log
        assert log.index("Schema version 1 is current") < log.index("Listening at")
        assert log.index("[startup] Database ready") < log.index("Listening at")
        # Default path: init-empty is NOT part of an ordinary production start.
        assert "DB_ALLOW_INIT_EMPTY is not set" in log
        # `exec` replaced the shell, so signals reach Gunicorn (graceful redeploy).
        if sys.platform.startswith("linux"):
            argv = gate.argv()
            assert "gunicorn" in argv and "docker-entrypoint.sh" not in argv
        # The gate and the application boot wrote nothing at all.
        assert counts(pg_url) == before
        # Imported records are served unchanged; pre-migration hashes still log in.
        assert api(gate.base, "/api/listings")["total"] == before["listings"]
        admin = api(gate.base, "/api/auth/login", "POST",
                    json={"email": "user41@example.test", "password": PASSWORD})["token"]
        assert api(gate.base, "/api/admin/dashboard", token=admin)["counts"]["users"] == before["users"]
        assert api(gate.base, "/api/me", token="legacy-session")["user"]["id"] == 42
    # Gunicorn handled SIGTERM directly (it was exec'd, not a child of sh).
    assert gate.returncode == 0
    after = counts(pg_url)
    # Only this test's own login added a session; every stored record survived.
    assert after["sessions"] == before["sessions"] + 1
    assert {key: value for key, value in after.items() if key != "sessions"} == \
        {key: value for key, value in before.items() if key != "sessions"}


def test_gate_restart_preserves_users_listings_and_sessions(pg_url, legacy_sqlite, tmp_path):
    """A redeploy/restart replaces only the container, never the records."""
    import_sqlite(legacy_sqlite)
    with startup_gate(pg_url, tmp_path) as first:
        signup = api(first.base, "/api/auth/signup", "POST", json={
            "name": "Gate Restart User", "email": "gate-restart@example.test", "password": PASSWORD})
        token, uid = signup["token"], signup["user"]["id"]
        lid = api(first.base, "/api/listings", "POST", token=token, json={
            "title": "Gate Restart Camera", "price": 175000, "category_id": 2,
            "condition": "Good", "province": "Western Province", "district": "Gampaha",
            "city": "Negombo", "images": ["/images/products/canon-5d-1.jpg"],
            "specs": {"shutter_count": "1,000"}})["id"]
    # New container, same script, same PostgreSQL service: the Railway restart case.
    with startup_gate(pg_url, tmp_path) as second:
        assert api(second.base, "/api/me", token=token)["user"]["id"] == uid
        assert api(second.base, f"/api/listings/{lid}")["title"] == "Gate Restart Camera"
        assert any(item["id"] == lid for item in api(second.base, "/api/listings")["items"])
        assert api(second.base, "/api/auth/login", "POST",
                   json={"email": "gate-restart@example.test", "password": PASSWORD})["user"]["id"] == uid
    with psycopg.connect(pg_url) as pg:
        assert pg.execute("SELECT COUNT(*) FROM users WHERE id=%s", (uid,)).fetchone()[0] == 1
        assert pg.execute("SELECT COUNT(*) FROM listings WHERE id=%s", (lid,)).fetchone()[0] == 1
        assert pg.execute("SELECT COUNT(*) FROM sessions WHERE token=%s", (token,)).fetchone()[0] == 1


def test_gate_refuses_unprepared_database_and_creates_nothing(pg_url, tmp_path):
    """An empty database must fail closed, not become a silent empty marketplace."""
    with psycopg.connect(pg_url) as pg:
        assert not destination_tables(pg)
    log = run_gate_expect_failure(pg_url, tmp_path)
    assert "Database not prepared" in log
    assert "[startup] FAILED" in log
    with psycopg.connect(pg_url) as pg:
        # Not even the completion ledger was created; the database is untouched.
        assert not destination_tables(pg)


def test_gate_bootstraps_fresh_database_only_with_explicit_opt_in(pg_url, tmp_path):
    """DB_ALLOW_INIT_EMPTY prepares a brand-new database once, then is unnecessary."""
    with startup_gate(pg_url, tmp_path, extra={"DB_ALLOW_INIT_EMPTY": "1"}) as gate:
        assert "DB_ALLOW_INIT_EMPTY is set" in gate.log()
        assert requests.get(gate.base + "/api/health", timeout=10).status_code == 200
        assert api(gate.base, "/api/listings")["total"] == 0
        # No demo data is fabricated; the first real account gets the first ID.
        signup = api(gate.base, "/api/auth/signup", "POST", json={
            "name": "First Owner", "email": "first-owner@example.test", "password": PASSWORD})
        assert signup["user"]["id"] == 1
    with psycopg.connect(pg_url) as pg:
        assert set(TABLES) <= destination_tables(pg)
        assert pg.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert pg.execute("SELECT COUNT(*) FROM listings").fetchone()[0] == 0
        assert pg.execute("SELECT COUNT(*) FROM businesses").fetchone()[0] == 0
        assert pg.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 37
        assert pg.execute("SELECT COUNT(*) FROM ll_schema_migrations").fetchone()[0] == 1
    # Every later start uses the prepared path and must not duplicate anything.
    with startup_gate(pg_url, tmp_path) as gate:
        assert "DB_ALLOW_INIT_EMPTY is not set" in gate.log()
        assert api(gate.base, "/api/listings")["total"] == 0
    with psycopg.connect(pg_url) as pg:
        assert pg.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
        assert pg.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 37
    # Leaving the variable set by mistake is still safe: init-empty is a no-op.
    assert cli(pg_url, "init-empty").returncode == 0
    with psycopg.connect(pg_url) as pg:
        assert pg.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 37
        assert pg.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1


def test_gate_requires_a_postgres_database_url_and_never_creates_sqlite(tmp_path):
    log = run_gate_expect_failure(None, tmp_path)
    assert "DATABASE_URL is not set" in log
    assert "no SQLite fallback" in log
    missing = tmp_path / "must-not-be-created.sqlite3"
    log = run_gate_expect_failure("mysql://user:pass@127.0.0.1:3306/app", tmp_path,
                                  extra={"SQLITE_PATH": str(missing)})
    assert "not a postgresql:// URL" in log
    assert not missing.exists()
    assert not (ROOT / "server" / "lankalens.db").exists()


def test_gate_fails_closed_when_database_unreachable_without_leaking_the_dsn(tmp_path):
    unreachable = f"postgresql://gate-user:{SECRET}@127.0.0.1:1/missing"
    started = time.monotonic()
    log = run_gate_expect_failure(unreachable, tmp_path, extra={"DB_WAIT_SECONDS": "3"})
    elapsed = time.monotonic() - started
    assert elapsed < 60, f"the wait must be bounded, took {elapsed:.1f}s"
    assert "did not accept connections within the startup window" in log
    assert "PostgreSQL is not reachable" in log
    assert SECRET not in log and "gate-user" not in log
    assert not (ROOT / "server" / "lankalens.db").exists()


def test_gate_never_drops_a_used_database_that_lacks_the_ledger(scratch_database, tmp_path):
    """A non-empty schema without the ledger is refused by BOTH startup paths."""
    with psycopg.connect(scratch_database, autocommit=True) as pg:
        pg.execute("CREATE TABLE keep_existing (id BIGINT PRIMARY KEY, note TEXT)")
        pg.execute("INSERT INTO keep_existing VALUES (1, 'must survive a refused startup')")
    default = run_gate_expect_failure(scratch_database, tmp_path)
    assert "Database not prepared" in default
    opted_in = run_gate_expect_failure(scratch_database, tmp_path, extra={"DB_ALLOW_INIT_EMPTY": "1"})
    assert "not empty" in opted_in
    with psycopg.connect(scratch_database) as pg:
        assert pg.execute("SELECT note FROM keep_existing WHERE id=1").fetchone()[0] == \
            "must survive a refused startup"
        assert destination_tables(pg) == {"keep_existing"}


def test_wait_for_db_is_read_only_and_bounded(pg_url, legacy_sqlite):
    import_sqlite(legacy_sqlite)
    before = counts(pg_url)
    ready = cli(pg_url, "wait-for-db")
    assert ready.returncode == 0 and "accepted connections" in ready.stdout
    assert counts(pg_url) == before
    # No schema was created by waiting on an empty database, and no DSN is leaked.
    timed_out = cli(f"postgresql://gate-user:{SECRET}@127.0.0.1:1/missing", "wait-for-db",
                    extra={"DB_WAIT_SECONDS": "2"})
    assert timed_out.returncode == 1
    assert SECRET not in timed_out.stdout + timed_out.stderr
    assert "gate-user" not in timed_out.stdout + timed_out.stderr


def test_image_and_railway_config_agree_on_the_same_gate():
    """One startup path, identical in the image and in config-as-code."""
    railway = json.loads(RAILWAY_CONFIG.read_text())
    dockerfile = DOCKERFILE.read_text()
    script = ENTRYPOINT.read_text()
    assert ENTRYPOINT.exists() and os.access(ENTRYPOINT, os.X_OK)
    assert railway["build"] == {"builder": "DOCKERFILE", "dockerfilePath": "Dockerfile"}
    assert railway["deploy"]["startCommand"] == "/bin/sh /app/docker-entrypoint.sh"
    assert railway["deploy"]["healthcheckPath"] == "/api/health"
    assert railway["deploy"]["restartPolicyType"] == "ON_FAILURE"
    # Pre-deploy runs only on deploy, in another container, without retries: the
    # gate belongs to the start command so it also runs on every restart.
    assert "preDeployCommand" not in railway["deploy"]
    assert 'CMD ["/bin/sh", "/app/docker-entrypoint.sh"]' in dockerfile
    # A Railway start command runs in exec form, which expands neither && nor $PORT.
    command = railway["deploy"]["startCommand"]
    assert not any(token in command for token in ("&&", "||", ";", "$"))
    assert script.startswith("#!/bin/sh\n")
    assert "${PORT:-8000}" in script and "exec " in script
    # The gate never touches B2 configuration and contains no destructive SQL.
    assert not re.search(r"B2_(BUCKET|ENDPOINT|REGION|KEY_ID|APPLICATION_KEY)", script)
    assert not re.search(r"\b(DROP|TRUNCATE|DELETE\s+FROM|CREATE\s+DATABASE)\b", script, re.I)
    assert "sqlite3.connect" not in script and "SQLITE_PATH" not in script
