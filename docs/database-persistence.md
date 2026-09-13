# Database persistence: audit, migration and Railway cutover

> **Existing production: do not deploy, restart, change application variables, or
> run `init-empty` until the running SQLite database has been backed up OFF the
> application container.** Environment changes may trigger a deployment. This
> code has not been deployed to Railway and no live production data was accessed.

## 1. Audit of the previous implementation

Audited commit: `4ae5f155b93b7a2a20fd5343f7d5ec9e14e35f7f`.

- All database code was in `server/app.py`: stdlib `sqlite3`, raw parameterized
  SQL, a per-request connection with `PRAGMA foreign_keys=ON`, and commits after
  every individual write. No ORM, external database, pooling or `DATABASE_URL`.
- `DB_PATH = os.path.join(BASE_DIR, "lankalens.db")`, where BASE_DIR is the
  directory containing app.py: **`/app/server/lankalens.db` in Docker**.
- Docker's WORKDIR is `/app`. `.dockerignore` excludes `server/*.db`; Git also
  excludes the database. Neither Dockerfile nor railway.json configures a volume
  for that path. An external Railway volume mount was **not available to inspect**.
- Gunicorn imports `server.app`. Import created the SQLite file if missing and
  **called `seed()` every time**, not only when the file was absent. `seed()` ran
  `executescript(SCHEMA)`, `migrate()`, index creation and per-empty-table seeding.
- `migrate()` added legacy columns and updated business verification state and
  timestamps, session expiry (when adding its column), and the logo setting.
  `sync_locations()` inserted missing location rows on every boot and deleted
  the old Negombo-under-Colombo city row. `migrate()` also **dropped `shops`**.
- Demo categories, brands/models, users (including a known-password admin),
  businesses, listings and posts were inserted when their tables were empty.
- No Docker/Railway reset shell script was found. The replacement filesystem plus
  import-time initialization is the data-loss mechanism; there was no blanket
  `DELETE FROM listings` at boot.

### Why a deploy replaced website data

Without an external volume mounted at the exact database path, the SQLite file
belongs to the application container's ephemeral writable layer. A replacement
container starts without the live file; the image intentionally does not contain
it. Startup then creates a fresh database and populates demo data. Excluding a
file from Git/Docker is **not** persistence. The old README/QA persistence claims
were incorrect and must not be used as deployment instructions.

A Railway volume mounted elsewhere would not have helped this hardcoded path.
If an out-of-repository mount at `/app/server` actually exists, inspect it before
cutover; this workspace cannot establish the live mount configuration.

### Full table and dependency inventory

There are 28 current application tables. The schema is now in `server/schema.py`.
`FK` below means a database-enforced foreign key; logical references are retained
as-is, without inventing new constraints that could reject historical records.
All existing FK `ON DELETE` behavior is retained. IDs and epochs use BIGINT in
PostgreSQL; auto IDs use identity sequences. JSON fields remain TEXT, not JSONB,
so stored JSON, object keys, token strings and password hashes are not rewritten.

| Table | Persistent content and dependencies |
|---|---|
| `categories` | Catalog/field definitions; self-FK `parent_id` |
| `provinces` | Top-level locations |
| `districts` | FK `province_id → provinces` |
| `cities` | FK `district_id → districts` |
| `users` | Accounts, password hashes, verification/status, admin flag, avatar |
| `sessions` | Bearer token, timestamps/expiry; FK `user_id → users` |
| `tokens` | Email/phone/reset tokens, values and expiry; FK `user_id → users` |
| `listings` | Ads, status, specs, image JSON/object keys; FKs to users/categories |
| `favorites` | Composite PK user/listing; FKs to both |
| `offers` | Amount/status/counteroffers; FKs listing/buyer/seller |
| `messages` | Message body/read state; FKs sender/receiver; logical listing ID |
| `notifications` | Notification content/read state/links; FK user |
| `reports` | Listing moderation, resolution and admin IDs; FK listing |
| `user_reports` | Logical reporter/reported user IDs and report details |
| `contact_events` | Logical listing/seller/buyer IDs and contact events |
| `ratings` | Reviews/comments/stars; FKs buyer/seller, logical listing ID |
| `blocks` | Composite PK user/blocked IDs (logical references) |
| `businesses` | Shops, owner, verification, logo/document references; FK user |
| `contact_messages` | Contact-form submissions |
| `posts` | Blog/editorial content and image references |
| `brands` | Catalog brands |
| `models` | FK brand |
| `site_settings` | Admin-configured settings and promotion configuration |
| `payments` | Transaction/provider/state/amount, logical listing ID; FK user |
| `promotions` | Promotion state/timing, logical payment ID; FKs listing/user |
| `audit_logs` | Admin history and logical actor/entity IDs |
| `banned_emails` | Registration denylist |
| `blocked_ips` | Stored IP denylist |

**Legacy tables:** `shops` is no longer read by the application (the shop directory
reads `businesses`), but the importer preserves it. Other source tables and extra
columns are also included, not discarded. SQLite's internal `sqlite_sequence`
becomes PostgreSQL identity sequence high-water marks. The new
`ll_schema_migrations` table records the schema version, import snapshot hash,
per-table verification manifest and completion time.

**Other dependencies:** Flask/Gunicorn serve the API and frontend; Werkzeug is
provided by Flask; boto3/botocore communicate with B2 and Pillow processes images.
`psycopg[binary,pool]` is the new PostgreSQL driver/pool. There is no separate DB
service implemented in this repository, Redis store, or second application DB.
The browser stores its bearer token/preferences in localStorage/sessionStorage;
server sessions remain in the database. Rate-limit buckets are in-memory and
were never durable records. B2 objects live outside the database and application.

**Normal lifecycle operations remain:** user/admin deletes, logout, token
consumption and expired-session cleanup on listing/admin requests still work.
They are not database initialization and were not removed. Application startup
itself does not run them. Expired listings are marked expired, not reset on boot.

## 2. Production architecture

```text
Browser → Railway Flask/Gunicorn service → DATABASE_URL → PostgreSQL service
                                                       └─ persistent PG volume
                                      → existing B2 bucket (unchanged)
```

- PostgreSQL is mandatory when APP_ENV/FLASK_ENV is `production` or Railway
  environment/project/service markers are present. Docker sets APP_ENV=production.
- Any nonempty DATABASE_URL must be `postgresql://` or `postgres://`. Invalid or
  missing production configuration refuses startup; no SQLite fallback occurs.
- No production database file is created anywhere in the application container.
- Startup checks the completion ledger and schema availability, using reads only.
  A blank/unimported database will not start a silently empty marketplace.
- Railway's pre-deploy `python -m server.manage_db migrate` checks the version.
  Version 1 is the import baseline; future reviewed additive migrations belong
  in that command. No auto-import, table deletion or demo seeding is configured.
- psycopg pools are lazy and per-process (safe with Gunicorn workers), min 1/max
  10 connections by default. Optional `DB_POOL_MAX=10` accepts 1–100. Budget total
  connections as workers × pool max, plus admin/migration/other services.
- Pool checkout and connect timeouts are 5 seconds; runtime SQL timeout is 15
  seconds and idle-in-transaction timeout is 30 seconds. Dead connections are
  checked/discarded; the pool can reconnect after an outage. Queues are bounded.
- Each successful request commits one transaction; failed requests roll back.
  A failed/uncertain commit does not return success. Writes are never blindly
  replayed after connection failure. Verify state before retrying an uncertain
  user operation (exactly-once delivery is not implied).
- Database failures return generic JSON errors (`503` for unavailability; `409`
  for immediate constraint conflicts). DSNs, passwords, query parameters and raw
  driver errors are not logged or returned. `/api/health` checks the database.
- Startup/migrations never reset passwords or sessions. Existing sessions remain
  valid until their original normal expiry; newly added legacy expiry columns
  get the same 30-day-from-creation policy as the previous application.

## 3. Safely capture the existing SQLite database FIRST

1. Disable automatic application deploys while preparing the migration. Do not
   restart the current instance, change its environment variables or switch DBs.
2. In the **existing** Railway instance, inspect the file/mount without changing
   it. Confirm `/app/server/lankalens.db` exists. If it does not, STOP and locate
   the actual production file before any deployment.
3. Put the current site into maintenance at the traffic/routing layer **without
   replacing the running container**. Stop incoming writes and drain in-flight
   requests. A consistent snapshot taken while writes continue is suitable as an
   initial safety backup, but cannot be the final cutover snapshot without losing
   later writes. Keep writes frozen through final backup, import and cutover.
4. Use SQLite's backup API, not `cp lankalens.db`: committed data may be in the WAL.

The old deployment does not have the new management command. Run this stdlib-only
script in Railway SSH/Exec on that still-running instance (choose a new output
filename each time):

```python
import hashlib, os, sqlite3
source = "file:/app/server/lankalens.db?mode=ro"
output = "/tmp/lankalens-final.sqlite3"
fd = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
os.close(fd)
src = sqlite3.connect(source, uri=True)
dst = sqlite3.connect(output)
try:
    src.backup(dst)
    assert dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
finally:
    dst.close()
    src.close()
h = hashlib.sha256()
with open(output, "rb") as f:
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        h.update(chunk)
print("Backup SHA256:", h.hexdigest())
```

**Download the backup to secure storage outside the container immediately.** A
backup left in `/tmp` is just as ephemeral as the original. Do not put it in Git,
a public HTTP route, chat, deployment logs or an image bucket. It contains user
records, password hashes and usable session/reset tokens. Use your approved
private file transfer/export method through Railway SSH. If transferring via a
base64 stream, capture that stream to a private file locally (not logs), decode,
and verify the SHA256 and SQLite integrity before proceeding.

After securely retrieving the file, inspect it locally without importing app.py:

```bash
sha256sum /secure/backups/lankalens-final.sqlite3
python - <<'PY'
import sqlite3
c = sqlite3.connect("file:/secure/backups/lankalens-final.sqlite3?mode=ro", uri=True)
assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
for (name,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
    quoted = '"' + name.replace('"', '""') + '"'
    print(name, c.execute("SELECT COUNT(*) FROM " + quoted).fetchone()[0])
assert not c.execute("PRAGMA foreign_key_check").fetchall(), "Reconcile orphans before importing"
c.close()
PY
```

If running the new code in a separate trusted environment, this equivalent command
is available and never imports the Flask application:

```bash
python -m server.manage_db backup-sqlite \
  --source /path/to/existing/lankalens.db \
  --output /secure/backups/lankalens-final.sqlite3
```

The output must not already exist. The source is opened read-only. Neither this
command nor the importer deletes or updates source rows. Keep at least two
independent secure copies. Also retain any legacy `/app/uploads` files: copying
the database cannot preserve old local image binaries. No automatic B2/file move
is included in this database change.

## 4. Provision PostgreSQL and rehearse the import

1. Add a **separate PostgreSQL service** in Railway. Ensure its PGDATA directory
   is backed by a persistent Railway volume, not the Flask service filesystem.
   Confirm its backup/restore plan. An ephemeral PostgreSQL service would not
   solve persistence; the database service must have durable storage.
2. Do not touch the existing Flask service variables until the backup is safe.
3. Rehearse on an isolated staging database using a protected backup copy. Install
   `server/requirements.txt` in a trusted environment that can reach the DB.
4. Supply the destination connection URL as **DATABASE_URL in the environment**,
   using Railway secrets/environment injection; never paste it into code, Git,
   chat, CLI arguments or logs. For the deployed app use the private-network URL.
   From outside Railway, use a secure tunnel or a TLS-enabled endpoint with the
   provider's supported sslmode/certificates. The driver honors URL TLS options;
   it does not silently downgrade or invent TLS credentials.

Run with the destination environment already injected:

```bash
python -m server.manage_db import-sqlite \
  --source /secure/backups/lankalens-final.sqlite3
python -m server.manage_db migrate
```

**Do not run `init-empty` first.** The importer requires an empty PostgreSQL
`public` schema. If it is nonempty, stop and select a genuinely new destination;
do not drop existing tables to get past the check.

### Import guarantees and deliberate refusal cases

- Re-snapshots the source with SQLite backup into a private temporary directory.
- Checks integrity and existing foreign keys; inventories every application and
  legacy table and column, including `shops`, extra columns and explicit indexes.
- Schema creation, COPY, verification, additive missing columns, indexes and the
  completion ledger all run in **one PostgreSQL transaction**. Import failure
  rolls back destination DDL/data. The original SQLite file stays unchanged.
- A transaction-scoped PostgreSQL advisory lock serializes import/migration runs.
- Preserves IDs, original nulls, values, password hashes, sessions/tokens, all image
  JSON and B2 keys. New baseline columns are only added where absent. Original
  source cells are not normalized or overwritten. No demo/catalog seeding occurs
  during import, even when a source table is empty.
- Verifies every original column using row counts and order-independent,
  duplicate-sensitive SHA256 multiset checks. Uses bounded-memory iteration/COPY.
- Identity sequences advance beyond both the largest existing ID and SQLite's
  historical AUTOINCREMENT high-water mark, so later inserts do not reuse IDs.
- Prints table counts and success **only after commit**; source values/credentials
  are not printed. The manifest is stored in `ll_schema_migrations`.
- Repeating the same completed snapshot is a no-op, even after new application
  writes. A different snapshot or nonempty unrecognized destination is refused.
  It never replays a backup over newer records.
- Unsupported triggers/views, virtual/generated/collation-specific schemas,
  cyclic/missing table dependencies, missing core tables/no source accounts,
  FK orphans, unrepresentable PostgreSQL values
  (e.g. NUL in TEXT), or incompatible legacy definitions stop the migration.
  **Do not fix this by deleting rows or disabling verification.** Retain the
  backup and write/review an explicit preserving schema/data translation first.
- A killed/failed client around COMMIT can have an uncertain outcome. Re-run the
  *same* snapshot: the ledger either confirms completion or an empty destination
  can be retried. Never infer success solely from a lost connection.

## 5. Production cutover (manual Railway configuration REQUIRED)

With writes still frozen and the final snapshot safely exported:

1. Import that snapshot into the new production PostgreSQL database. Confirm
   successful counts/manifest and `migrate`. Never merge two independently active
   databases or silently discard writes made after the snapshot.
2. Configure the **Flask service** variable:
   `DATABASE_URL=${{Postgres.DATABASE_URL}}` (replace `Postgres` with the actual
   database service name; use Railway's variable-reference UI).
3. Keep `APP_ENV=production` (set by the Dockerfile) and all existing `B2_*`
   variables **unchanged**. Optionally set `DB_POOL_MAX` to suit your DB limit.
   No database credentials belong in source control.
4. Deploy this branch/version only after the import. The pre-deploy version gate
   and app readiness check fail closed if DATABASE_URL or the import is missing.
5. Verify `/api/health` returns HTTP 200 and `data.database = "postgresql"`; confirm
   B2 remains enabled in the storage summary. Compare live counts to the manifest.
6. Complete the checklist below before reopening writes. Keep the SQLite backup
   and old deployment reference for rollback/reconciliation. Do not delete either
   as part of cutover.

An app deployment now replaces only application code/processes. PostgreSQL data
stays in the independent database service's persistent volume; B2 objects remain
in the existing bucket. Database service restarts also require that volume to
remain attached. Deleting the PostgreSQL service/volume is **not** a safe deploy.
Configure scheduled database backups and periodically test restores. Prefer
separate migration-owner and least-privilege runtime roles: runtime needs DML on
application tables, sequence usage and SELECT on the ledger, not DROP/CREATE.

### Only for an intentionally NEW installation

```bash
# DATABASE_URL already injected; knowingly starts a NEW marketplace.
python -m server.manage_db init-empty --allow-empty
```

This inserts reference categories/locations/brands/settings, not users, demo
shops/listings or an admin. Existing Lanka Lens installations must import instead.
To bootstrap an admin for a new installation, create the real account through
signup, then have the DBA promote only that verified account with a parameterized
`UPDATE users SET is_admin=1 WHERE id=...` in the trusted DB console. No default
production password is created. Imported existing admin flags remain unchanged.

## 6. Verification checklist and actual evidence

### Automated verification performed in the coding workspace

Run these tests only with disposable test resources:

```bash
python -m venv .venv
.venv/bin/pip install -r tests/requirements.txt
.venv/bin/python -m pytest -q tests
```

The tests start a **real PostgreSQL server** (test-only pgserver package), create
random isolated databases and run actual Gunicorn processes. They do not use or
modify a production DATABASE_URL. Test database cleanup is confined to those
randomly created test databases. No test binaries or database files are committed.

Latest run (2026-09-13): **18 tests passed in 30.95 seconds**, Python 3.11,
PostgreSQL 16.2. Compile checks and `git diff --check` also passed. An AST
comparison confirmed 24 B2/image functions were unchanged; no frontend files
were modified.

Verified scenarios:

- Nonempty examples in **all 28 tables + legacy `shops` + an extra legacy table**,
  including a BLOB column and an extra user column, imported and checked.
- Created a new user and listing over HTTP against PostgreSQL; listing appeared.
- Stopped and replaced Gunicorn twice, including a two-worker replacement. The
  user, listing, bearer session, login and admin dashboard survived both starts.
- Restarted the real PostgreSQL server while Gunicorn stayed alive. Health returned
  503 during the outage, then the pool recovered; listing, session and login survived.
- Preserved image JSON/B2 keys byte-for-byte, and exercised the unchanged resolver
  with a mocked B2 presigner receiving the exact original key. Static image HTTP
  loading passed. **This is not evidence of a live B2 object download.**
- Exercised search, JSON spec filters/facets, upserts, favorites, reviews, chat
  queries, shop display, admin settings/moderation, concurrent health requests.
- Checked safe refusal for missing/invalid DB configuration, empty/unprepared DB,
  nonempty destination, unsupported schema and bad data; tested full rollback,
  WAL-inclusive backup, duplicate import, concurrent imports, sequence high-water
  marks, explicit local SQLite initialization and read-only application startup.

### Required live Railway acceptance test — NOT performed here

The coding workspace has no production Railway connection or B2 credentials.
Do not mark the production incident resolved until an operator records:

- [ ] Original SQLite final backup safely stored off-container; counts/hash recorded.
- [ ] Verified import and production PostgreSQL volume/backup configuration.
- [ ] Existing user and admin logins work; a pre-migration unexpired session works.
- [ ] Existing shops, reviews, messages, reports, settings and payment records match.
- [ ] Create an identifiable **test user** and **test listing**; record IDs privately.
- [ ] Upload an image through the existing B2 path (do not change its configuration).
- [ ] Listing appears; open a fresh returned image URL and confirm real image bytes
      load from B2, not just that a URL exists. Do not log presigned URLs.
- [ ] Restart the Flask service; verify the same IDs, login, session and image.
- [ ] Deploy/redeploy once more; verify those same records and admin read/write.
- [ ] Obtain a newly generated B2 URL after each restart (old signed URLs can expire).
- [ ] Check `/api/health` and record deployment IDs/times and acceptance outcomes.
- [ ] Resume normal traffic only after verification. Do not delete test/production
      records as an automatic part of this migration.

### Rollback / failure policy

Before reopening writes, a failed cutover can return traffic to the still-retained
old instance with its original SQLite database. If the old container has already
been replaced, redeploying old code alone will **not** restore its SQLite data.
Use the secured backup and an explicit recovery plan.

After PostgreSQL has accepted new writes, do **not** point the app back at the old
SQLite snapshot: that would lose those writes. Freeze traffic, retain both data
sources, take a PostgreSQL backup and fix forward or reconcile explicitly. Keep
B2 keys unchanged. Neither migrations nor a rollback script here delete data.

Records already lost from earlier ephemeral instances (or a previously dropped
legacy `shops` table) cannot be recovered from this checkout; recovery requires
an existing backup, surviving instance/volume, or another authoritative copy.
