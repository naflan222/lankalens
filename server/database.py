"""Database configuration and bounded per-process PostgreSQL connection pooling.

No schema creation, seed data, retries of writes, or fallback after a PG failure.
All errors crossing this boundary are safe to log (never include DSNs/parameters).
"""
import atexit
from decimal import Decimal
import logging
import os
from pathlib import Path
import re
import sqlite3
import threading

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

from server.schema import ID_TABLES, SCHEMA_VERSION, TABLES, REQUIRED_COLUMNS


class DatabaseFailure(RuntimeError):
    pass


class DatabaseUnavailable(DatabaseFailure):
    pass


class DatabaseConflict(DatabaseFailure):
    pass


def safe_error(exc):
    if isinstance(exc, (psycopg.OperationalError, psycopg.InterfaceError, PoolTimeout,
                        sqlite3.OperationalError)):
        return DatabaseUnavailable("Database connection or operation unavailable")
    if isinstance(exc, (psycopg.IntegrityError, sqlite3.IntegrityError)):
        return DatabaseConflict("Database constraint conflict")
    return DatabaseFailure("Database operation failed")


# Pool retry diagnostics can contain driver errors/connection details. Only the
# application's constant, credential-free diagnostics are allowed in logs.
logging.getLogger("psycopg.pool").disabled = True

SQL_PARTS = re.compile(r"('(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|--[^\n]*|/\*.*?\*/)", re.S)


def postgres_sql(statement):
    """Translate the small, audited SQLite dialect used by app.py, not values.

    Parameters remain bound; quoted strings/identifiers and comments are not
    rewritten. ILIKE retains case-insensitive marketplace search. JSON is still
    stored as TEXT so importing it never reformats image keys or specs.
    """
    parts = SQL_PARTS.split(statement)
    for i in range(0, len(parts), 2):
        text = re.sub(r"\bLIKE\b", "ILIKE", parts[i], flags=re.I)
        text = re.sub(
            r"json_extract\((\w+(?:\.\w+)?),\s*\?\)",
            r"jsonb_extract_path_text(CAST(\1 AS jsonb), VARIADIC string_to_array(substr(?, 3), '.'))",
            text, flags=re.I)
        parts[i] = text
    # Escape literal percent signs for psycopg's parameter binding, then replace
    # only unquoted qmark placeholders (including in inserted JSON expressions).
    statement = "".join(parts).replace("%", "%%")
    parts = SQL_PARTS.split(statement)
    for i in range(0, len(parts), 2):
        parts[i] = parts[i].replace("?", "%s")
    return "".join(parts)


def row_dict(row):
    # PostgreSQL SUM(bigint)/AVG return Decimal. Preserve the existing JSON API's
    # numeric types rather than Flask encoding ratings/revenue as strings.
    return {key: (int(value) if value == value.to_integral_value() else float(value))
            if isinstance(value, Decimal) else value for key, value in dict(row).items()}


class Connection:
    def __init__(self, raw, owner):
        self.raw = raw
        self.owner = owner
        self.closed = False

    def execute(self, sql, args=()):
        try:
            return self.raw.execute(postgres_sql(sql) if self.owner.is_postgres else sql, tuple(args))
        except (psycopg.Error, sqlite3.Error) as exc:
            raise safe_error(exc) from None

    def write(self, sql, args=()):
        match = re.match(r"\s*INSERT\s+INTO\s+(\w+)\b", sql, re.I)
        returning = self.owner.is_postgres and match and match[1].lower() in ID_TABLES
        if returning:
            sql = sql.rstrip().rstrip(";") + " RETURNING id"
        cur = self.execute(sql, args)
        try:
            if returning:
                row = cur.fetchone()
                return row["id"] if row else None
            return None if self.owner.is_postgres else cur.lastrowid
        finally:
            cur.close()

    def commit(self):
        try:
            self.raw.commit()
        except (psycopg.Error, sqlite3.Error) as exc:
            raise safe_error(exc) from None

    def rollback(self):
        try:
            self.raw.rollback()
        except (psycopg.Error, sqlite3.Error) as exc:
            raise safe_error(exc) from None

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            self.raw.rollback()
        except (psycopg.Error, sqlite3.Error):
            self.raw.close()
        finally:
            if self.owner.is_postgres:
                self.owner.pool.putconn(self.raw)
            else:
                self.raw.close()


class Database:
    def __init__(self):
        self.production = (
            os.getenv("APP_ENV", "").lower() == "production"
            or os.getenv("FLASK_ENV", "").lower() == "production"
            or any(os.getenv(k) for k in ("RAILWAY_ENVIRONMENT_ID", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_SERVICE_ID", "RAILWAY_PROJECT_ID"))
        )
        self.url = os.getenv("DATABASE_URL", "").strip()
        self.is_postgres = self.url.startswith(("postgresql://", "postgres://"))
        if self.url and not self.is_postgres:
            raise DatabaseUnavailable("DATABASE_URL must be a PostgreSQL URL")
        if self.production and not self.is_postgres:
            raise DatabaseUnavailable("Production requires a PostgreSQL DATABASE_URL; SQLite fallback is disabled")
        self.backend = "postgresql" if self.is_postgres else "sqlite (local development only)"
        self.sqlite_path = str(Path(os.getenv("SQLITE_PATH", str(Path(__file__).with_name("lankalens.db")))).resolve())
        self.pool = None
        self.pid = None
        self.lock = threading.Lock()

    def _pool(self):
        with self.lock:
            if self.pool is None or self.pid != os.getpid():
                try:
                    maximum = int(os.getenv("DB_POOL_MAX", "10"))
                    if not 1 <= maximum <= 100:
                        raise ValueError()
                    self.pool = ConnectionPool(
                        self.url, min_size=1, max_size=maximum, timeout=5,
                        max_waiting=32, max_lifetime=1800, max_idle=300,
                        reconnect_timeout=15, check=ConnectionPool.check_connection,
                        kwargs={"row_factory": dict_row, "connect_timeout": 5,
                                "prepare_threshold": None,
                                "options": "-c search_path=public -c statement_timeout=15000 -c idle_in_transaction_session_timeout=30000"},
                        open=True,
                    )
                    self.pid = os.getpid()
                    atexit.register(self.pool.close)
                except Exception:
                    raise DatabaseUnavailable("Unable to configure PostgreSQL connection pool") from None
        return self.pool

    def connect(self):
        conn = None
        try:
            if self.is_postgres:
                raw = self._pool().getconn(timeout=5)
            else:
                # rw, NOT rwc: a missing SQLite file must never be recreated.
                raw = sqlite3.connect(Path(self.sqlite_path).as_uri() + "?mode=rw", uri=True, timeout=5)
                raw.row_factory = sqlite3.Row
                raw.execute("PRAGMA foreign_keys = ON")
            conn = Connection(raw, self)
            with_cursor = conn.execute("SELECT version FROM ll_schema_migrations WHERE version = ?", (SCHEMA_VERSION,))
            row = with_cursor.fetchone()
            with_cursor.close()
            if row is None:
                raise DatabaseUnavailable("Database is not prepared; run the documented migration command")
            return conn
        except (psycopg.Error, sqlite3.Error, PoolTimeout, DatabaseFailure):
            if conn:
                conn.close()
            raise DatabaseUnavailable("Database unavailable or not prepared; follow the database migration runbook") from None

    def check_ready(self):
        conn = self.connect()
        try:
            cur = conn.execute("SELECT MAX(version) AS version FROM ll_schema_migrations")
            version = cur.fetchone()["version"]
            cur.close()
            if version != SCHEMA_VERSION:
                raise DatabaseUnavailable("Unsupported schema version; use the matching application release")
            for table in TABLES:
                columns = ",".join(f'"{c}"' for c in REQUIRED_COLUMNS[table])
                cur = conn.execute(f'SELECT {columns} FROM "{table}" LIMIT 0')
                cur.close()
        finally:
            conn.close()

    def numeric_spec_sql(self):
        if not self.is_postgres:
            return "CAST(REPLACE(json_extract(l.specs, ?), ',', '') AS INTEGER)"
        # Match SQLite's leading integer conversion for values like '24 MP',
        # '1,000', or 'unknown', without PG invalid-input exceptions. NULL stays NULL.
        return ("CAST(SUBSTRING(REPLACE(json_extract(l.specs, ?), ',', '') "
                "FROM '^\\s*[+-]?[0-9]*') || '0' AS NUMERIC) / 10")


database = Database()
