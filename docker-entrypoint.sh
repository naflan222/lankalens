#!/bin/sh
# LankaLens production startup gate.
#
#   container start -> DATABASE_URL verified -> PostgreSQL reachable
#                   -> (explicit opt-in only) init-empty -> migrate
#                   -> exec gunicorn -> Flask -> /api/health
#
# This script is the single authoritative startup path. The Dockerfile CMD and
# railway.json's startCommand both invoke it, so the ordering holds on deploys
# AND on plain container restarts, and it keeps working after Railway stops
# reading config-as-code (railway.json) on 2026-12-01.
#
# Invariants that must never be weakened here:
#   * No SQLite fallback: a missing or non-PostgreSQL DATABASE_URL exits non-zero.
#   * Nothing is dropped, truncated, deleted, reset or recreated. The commands
#     run are manage_db's read-only wait/gate plus, only when an operator
#     explicitly opts in, the non-destructive init-empty (which itself refuses
#     any non-empty public schema).
#   * Gunicorn is exec'd only after every database step succeeded, so it becomes
#     PID 1 and receives Railway's SIGTERM for a graceful redeploy drain.
#   * DATABASE_URL and B2 credentials are never printed. No step here touches
#     B2: object storage configuration and keys are left exactly as they are.
#
# Invoked as `/bin/sh /app/docker-entrypoint.sh`: no shell operators or
# environment expansion are needed at the platform level (Railway runs a start
# command in exec form, which does not expand $PORT), because PORT is expanded
# here instead.
set -eu

log() { printf '[startup] %s\n' "$*"; }
die() { printf '[startup] FAILED: %s\n' "$*" >&2; exit 1; }

# Run from the directory holding this script (WORKDIR /app in the image, the
# repository root in tests) so `python -m server.manage_db` always resolves.
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$APP_DIR"

PYTHON=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)
[ -n "$PYTHON" ] || die "No python3 interpreter in the image; cannot run the database gate."

# Report a broken image/PATH precisely instead of blaming the database for it.
"$PYTHON" -c 'import psycopg, gunicorn' >/dev/null 2>&1 ||
    die "$PYTHON cannot import psycopg/gunicorn: the image or PATH is wrong. The database was never contacted."

# 1. DATABASE_URL must be a PostgreSQL DSN. Fail closed; never fall back to SQLite.
case "${DATABASE_URL:-}" in
    postgresql://* | postgres://*) ;;
    "")
        die "DATABASE_URL is not set. Production requires the Railway PostgreSQL service; there is no SQLite fallback."
        ;;
    *)
        die "DATABASE_URL is not a postgresql:// URL. Refusing to start; there is no SQLite fallback."
        ;;
esac
log "DATABASE_URL is set and points at PostgreSQL (its value is never logged)."

# 2. Bounded, read-only wait for PostgreSQL to accept connections (SELECT 1).
#    Covers a database service that restarts or reattaches its volume slower
#    than this container starts. Writes nothing; DB_WAIT_SECONDS sets the window.
log "Waiting for PostgreSQL to accept connections (window: ${DB_WAIT_SECONDS:-60}s)."
"$PYTHON" -m server.manage_db wait-for-db ||
    die "PostgreSQL is not reachable. Gunicorn was NOT started; no records were changed."

# 3. Brand-new installations only, and only on explicit operator opt-in.
#    The default path stays fail-closed so that a DATABASE_URL accidentally
#    pointing at an empty database (wrong service, fresh volume, restored-but-
#    empty instance) cannot silently become a working-but-empty marketplace —
#    the exact failure mode this project's persistence rules exist to prevent.
#    init-empty never drops, truncates or overwrites: it refuses any non-empty
#    public schema and is a no-op on an already prepared database.
case "${DB_ALLOW_INIT_EMPTY:-0}" in
    1 | true | TRUE | yes | YES | on | ON)
        log "DB_ALLOW_INIT_EMPTY is set: preparing a brand-new database (refused if any table already exists)."
        "$PYTHON" -m server.manage_db init-empty ||
            die "init-empty did not complete. Gunicorn was NOT started; nothing was dropped or overwritten."
        log "Database prepared. Remove DB_ALLOW_INIT_EMPTY so later starts use the prepared-database path."
        ;;
    *)
        log "DB_ALLOW_INIT_EMPTY is not set: expecting an already prepared database."
        ;;
esac

# 4. Read-only schema version gate (and the home of future reviewed migrations).
"$PYTHON" -m server.manage_db migrate ||
    die "The database schema gate failed. Gunicorn was NOT started; no records were changed."

# 5. Hand over to Gunicorn as PID 1. Railway supplies PORT at runtime; the
#    worker/thread counts match the verified-working production configuration.
#    server.wsgi imports the marketplace app and installs provider integrations.
PORT="${PORT:-8000}"
log "Database ready; starting gunicorn on 0.0.0.0:${PORT} (1 worker, 4 threads)."
exec "$PYTHON" -m gunicorn \
    --bind "0.0.0.0:${PORT}" \
    --workers 1 \
    --threads 4 \
    --access-logfile - \
    --error-logfile - \
    server.wsgi:app
