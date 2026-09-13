# -*- coding: utf-8 -*-
"""
Lanka Lens — Sri Lankan camera marketplace
Flask backend with PostgreSQL in production and optional local SQLite.

Run:  python server/app.py
"""
import os
import re
import json
import time
import logging
import sqlite3
import sys
import secrets
import hashlib
import uuid
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, request, jsonify, g, abort, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

# Support both `python server/app.py` and `gunicorn server.app:app`.
if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server.database import database, row_dict, DatabaseUnavailable, DatabaseConflict, DatabaseFailure
from server.schema import SCHEMA, INDEXES
from server.reference_data import CATEGORIES, BRANDS, DEFAULT_SETTINGS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE_DIR)
DB_PATH = database.sqlite_path
UPLOAD_DIR = os.path.join(ROOT, "uploads")

ALLOWED_IMG = {"jpg", "jpeg", "png", "webp", "gif"}
MAX_IMG_BYTES = 1 * 1024 * 1024
PER_PAGE = 24
# Backblaze B2 (S3-compatible) — credentials from Railway env only, never hardcoded
B2_BUCKET = os.environ.get("B2_BUCKET", "").strip()
B2_ENDPOINT = os.environ.get("B2_ENDPOINT", "").strip()
B2_REGION = os.environ.get("B2_REGION", "").strip()
B2_KEY_ID = os.environ.get("B2_KEY_ID", "").strip()
B2_APPLICATION_KEY = os.environ.get("B2_APPLICATION_KEY", "").strip()
_b2_client = None
_b2_client_error_logged = False
_b2_client_init_logged = False


def _b2_redact(text):
    """Scrub B2 credential *values* out of anything about to be logged.

    Key names, bucket, endpoint host and region are not secrets and stay
    readable for diagnostics; only the values of B2_KEY_ID and
    B2_APPLICATION_KEY are replaced so a log line can never leak a credential.
    """
    if not text:
        return text
    if B2_KEY_ID:
        text = text.replace(B2_KEY_ID, "[REDACTED]")
    if B2_APPLICATION_KEY:
        text = text.replace(B2_APPLICATION_KEY, "[REDACTED]")
    return text


def b2_missing_env():
    """Names (never values) of the required B2 env vars that are empty/missing."""
    values = {
        "B2_BUCKET": B2_BUCKET,
        "B2_ENDPOINT": B2_ENDPOINT,
        "B2_REGION": B2_REGION,
        "B2_KEY_ID": B2_KEY_ID,
        "B2_APPLICATION_KEY": B2_APPLICATION_KEY,
    }
    return [name for name, val in values.items() if not val]


# ---------------------------------------------------------------------------
# B2 endpoint / region normalization
# ---------------------------------------------------------------------------
# Backblaze's S3-compatible endpoint is https://s3.<region>.backblazeb2.com and
# the SigV4 credential scope must use that same <region>. These env vars are
# pasted by hand into Railway, so normalize them once at import time: strip
# quotes/whitespace/trailing slashes, force the https scheme, drop a bucket
# prefix that was pasted into the host, and recover the region from the host.
B2_S3_HOST_RE = re.compile(r"^s3\.(?P<region>[a-z0-9-]+)\.backblazeb2\.com$")
B2_FRIENDLY_HOST_RE = re.compile(r"^f\d{2,3}\.(?P<region>[a-z0-9-]+)\.backblazeb2\.com$")
B2_NATIVE_API_HOST_RE = re.compile(r"^api\d*\.backblazeb2\.com$")


def _normalize_b2_endpoint(raw, bucket=""):
    """Return ``(url, host, region, notes)`` for a B2_ENDPOINT value.

    ``region`` is the region encoded in the endpoint host (``''`` when the host is
    not a recognizable B2 S3 host). Nothing returned here is secret, so all of it
    is safe to log.
    """
    notes = []
    val = (raw or "").strip().strip('"').strip("'").strip()
    if not val:
        return "", "", "", notes
    # Drop a pasted query/fragment and trailing slashes: a trailing "/" makes
    # botocore build "<endpoint>/<bucket>//<key>", which B2 answers with 404.
    val = val.split("#", 1)[0].split("?", 1)[0].rstrip("/")
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://", val):
        notes.append("no scheme given; using https://")
        val = "https://" + val
    if val.lower().startswith("http://"):
        notes.append("http:// given; B2 only serves the S3 API over TLS, using https://")
        val = "https://" + val[len("http://"):]
    from urllib.parse import urlparse
    parsed = urlparse(val)
    host = (parsed.hostname or "").lower()
    port = parsed.port
    region = ""
    if bucket and host.startswith(bucket.lower() + "."):
        # Virtual-hosted endpoint (bucket.s3.<region>.backblazeb2.com). The S3 API
        # client adds the bucket itself, so keep only the service host.
        notes.append("bucket name was part of the endpoint host; stripped it (the S3 "
                     "client puts the bucket in the request path)")
        host = host[len(bucket) + 1:]
    m = B2_S3_HOST_RE.match(host)
    if m:
        region = m.group("region")
    else:
        mf = B2_FRIENDLY_HOST_RE.match(host)
        mn = B2_NATIVE_API_HOST_RE.match(host)
        if mf:
            notes.append("this is a B2 *friendly URL* host (file downloads), not the "
                         "S3-compatible endpoint; expected s3.%s.backblazeb2.com" % mf.group("region"))
        elif mn:
            notes.append("this is the B2 *native API* host; it rejects S3 requests. "
                         "Expected s3.<region>.backblazeb2.com")
        else:
            notes.append("endpoint host is not a recognized s3.<region>.backblazeb2.com host")
    if parsed.path and parsed.path not in ("/", ""):
        notes.append("endpoint had a path (%s); using the host only" % parsed.path)
    url = "https://" + host + ((":%d" % port) if port else "")
    return url, host, region, notes


# Computed once at import so every request signs against the same endpoint/region.
B2_ENDPOINT_URL, B2_ENDPOINT_HOST, B2_ENDPOINT_REGION, B2_ENDPOINT_NOTES = _normalize_b2_endpoint(
    B2_ENDPOINT, B2_BUCKET)
# B2 validates the SigV4 credential scope against the region that serves the
# endpoint, so the host is authoritative; B2_REGION is the fallback when the
# endpoint is not a recognizable B2 host.
B2_SIGNING_REGION = B2_ENDPOINT_REGION or B2_REGION
B2_REGION_MISMATCH = bool(B2_ENDPOINT_REGION and B2_REGION and B2_ENDPOINT_REGION != B2_REGION)


def b2_proxy_env():
    """Names of proxy env vars that are set (botocore honors them by default).

    Only names are reported: a proxy URL can embed a password.
    """
    names = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
    return [n for n in names if os.environ.get(n)]


EXPIRY_DAYS = 30
# Auth tokens used to live forever: the sessions table had no expiry column, so
# a leaked token stayed valid until someone logged out or an admin banned the
# account. Sessions now expire after SESSION_TTL_DAYS of inactivity, sliding
# forward while the account is actually being used.
SESSION_TTL_DAYS = 30
SESSION_RENEW_WINDOW = 7 * 86400

CONDITIONS = [
    "Brand New",
    "Like New",
    "Excellent",
    "Good",
    "Fair",
    "For Parts / Repair",
]

LISTING_STATUSES = {"active", "pending", "draft", "sold", "expired", "paused", "rejected"}

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

PAYMENT_STATUSES = ["pending", "processing", "successful", "failed", "cancelled", "refunded"]

# Promotion package types (configurable via admin — prices/durations live in the DB).
PROMOTION_TYPES = [
    ("featured", "Featured Listing", "Show your ad in the featured section", 499, 7),
    ("boost", "Boost", "Bump your ad to the top of search results", 299, 3),
    ("homepage", "Homepage Featured", "Prime placement on the homepage carousel", 999, 14),
    ("urgent", "Urgent Badge", "A prominent URGENT badge on your ad", 199, 7),
]

USER_STATUSES = {"active", "suspended", "banned"}


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def db():
    """Per-request database connection."""
    if "db" not in g:
        g.db = database.connect()
    return g.db


def query(sql, args=(), one=False):
    cur = db().execute(sql, args)
    try:
        rows = [row_dict(r) for r in cur.fetchall()]
        return (rows[0] if rows else None) if one else rows
    finally:
        cur.close()


def execute(sql, args=()):
    return db().write(sql, args)


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


# ---------------------------------------------------------------------------
# Backblaze B2 (S3-compatible) helpers
# ---------------------------------------------------------------------------
def b2_enabled():
    return all([B2_BUCKET, B2_ENDPOINT, B2_REGION, B2_KEY_ID, B2_APPLICATION_KEY])


def b2_client_config(connect_timeout=15, read_timeout=60):
    """botocore Config that matches what Backblaze B2's S3-compatible API accepts.

    Three of these settings are load-bearing for B2:

    * ``addressing_style="path"`` — B2 serves the S3 API from
      ``s3.<region>.backblazeb2.com`` with the bucket in the request path. Our
      bucket name contains an upper-case letter, so it is not DNS-compatible and
      virtual-hosted addressing can never work for it.
    * ``request_checksum_calculation="when_required"`` — since boto3 1.36 the S3
      client calculates a CRC32 checksum for every PutObject and, because the
      request goes over HTTPS, sends it as a *trailer*. That switches the upload
      to ``Content-Encoding: aws-chunked`` + ``Transfer-Encoding: chunked`` with
      ``x-amz-content-sha256: STREAMING-UNSIGNED-PAYLOAD-TRAILER`` and drops
      ``Content-Length``. B2 does not accept that framing (its S3 API documents
      the ``x-amz-checksum-*`` / ``x-amz-sdk-checksum-algorithm`` headers as
      unsupported) and tears the connection down instead of returning an HTTP
      error, which botocore surfaces as ConnectionClosedError.
    * ``response_checksum_validation="when_required"`` — the matching read-side
      setting, so GetObject/HeadBucket are not decorated either.

    Older botocore (< 1.36) has neither checksum knob and never sent those
    headers, so it falls back to the remaining settings.
    """
    from botocore.config import Config
    common = {
        "signature_version": "s3v4",
        "s3": {"addressing_style": "path"},
        "connect_timeout": connect_timeout,
        "read_timeout": read_timeout,
        "retries": {"max_attempts": 4, "mode": "standard"},
        "max_pool_connections": 10,
    }
    with_checksums = dict(common,
                          request_checksum_calculation="when_required",
                          response_checksum_validation="when_required")
    try:
        return Config(**with_checksums)
    except TypeError:
        # botocore older than 1.36: no checksum options (and no checksum headers).
        return Config(**common)


def get_b2_client():
    """Lazily create (and cache) the boto3 S3 client for Backblaze B2.

    Logs once per process: on success the endpoint host, bucket and region
    (all non-secret); on failure the exception type and message with any
    credential values redacted. B2_KEY_ID / B2_APPLICATION_KEY are never
    written to the log.
    """
    global _b2_client, _b2_client_error_logged, _b2_client_init_logged
    if _b2_client is not None:
        return _b2_client
    if not b2_enabled():
        return None
    try:
        import boto3
        endpoint = B2_ENDPOINT_URL or (
            B2_ENDPOINT if B2_ENDPOINT.startswith("http") else "https://" + B2_ENDPOINT)
        _b2_client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=B2_SIGNING_REGION or B2_REGION,
            aws_access_key_id=B2_KEY_ID,
            aws_secret_access_key=B2_APPLICATION_KEY,
            config=b2_client_config(),
        )
        if not _b2_client_init_logged:
            host = endpoint.split("://", 1)[-1].split("/", 1)[0]
            app.logger.info("B2 client initialized (bucket=%s, endpoint=%s, region=%s, "
                            "addressing=path, checksums=when_required)",
                            B2_BUCKET, host, B2_SIGNING_REGION or B2_REGION)
            _b2_client_init_logged = True
        return _b2_client
    except Exception as e:
        if not _b2_client_error_logged:
            app.logger.error("B2 client init failed: %s: %s",
                             e.__class__.__name__, _b2_redact(str(e)))
            _b2_client_error_logged = True
        return None

def b2_presigned_url(key, expires_in=3600):
    if not key or not b2_enabled():
        return None
    client = get_b2_client()
    if not client:
        return None
    try:
        k = key.lstrip("/")
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": B2_BUCKET, "Key": k},
            ExpiresIn=expires_in,
        )
    except Exception as e:
        app.logger.warning("B2 presign failed for %s: %s: %s",
                           key[:40], e.__class__.__name__, _b2_redact(str(e)))
        return None

def _b2_failure_hint(e):
    """Plain-language hint for the B2 failures that actually reach production.

    Returned text is logged next to the exception so the Railway logs say what to
    do, not just what broke. Never includes credential values.
    """
    name = e.__class__.__name__
    text = str(e)
    code = ""
    response = getattr(e, "response", None)
    if isinstance(response, dict):
        code = str((response.get("Error") or {}).get("Code") or "")
        status = (response.get("ResponseMetadata") or {}).get("HTTPStatusCode")
        if code or status:
            code = "%s %s" % (status or "", code)
    if name == "ConnectionClosedError":
        return ("the endpoint closed the connection before answering. With boto3>=1.36 this is "
                "usually the automatic CRC32 trailer upload (Transfer-Encoding: chunked + "
                "Content-Encoding: aws-chunked), which B2 does not accept — it is disabled by "
                "b2_client_config(). If it still happens, the region/endpoint pair is wrong or "
                "outbound traffic to s3.<region>.backblazeb2.com:443 is blocked.")
    if name == "EndpointConnectionError":
        return ("DNS/TCP to the B2 endpoint failed — check B2_ENDPOINT is a real "
                "s3.<region>.backblazeb2.com host and that the container can reach port 443.")
    if name == "SSLError":
        return ("the TLS handshake to the B2 endpoint failed — usually B2_ENDPOINT pointing at a "
                "non-S3 host, a proxy intercepting TLS, or whitespace in the env var.")
    if name == "ConnectTimeoutError" or name == "ReadTimeoutError":
        return "the B2 endpoint did not answer in time (network path or firewall)."
    if code.startswith("403"):
        return ("B2 rejected the credentials/permissions — confirm B2_KEY_ID/B2_APPLICATION_KEY are an "
                "application key with writeFiles on this bucket, and that the signing region "
                "(%s) matches the endpoint region." % (B2_SIGNING_REGION or "?"))
    if code.startswith("400") and "checksum" in text.lower():
        return "B2 rejected a checksum header — ensure b2_client_config() is used for the client."
    if code.startswith("301") or "PermanentRedirect" in text:
        return ("B2 says the bucket lives in another region; the response header "
                "x-amz-bucket-region has the correct one — set B2_REGION and B2_ENDPOINT to match.")
    if code.startswith("404") and "NoSuchBucket" in text:
        return "B2 does not have a bucket named %r visible to this key." % B2_BUCKET
    return ""


def b2_upload_bytes(key, data, content_type="image/jpeg"):
    if not b2_enabled():
        return False, "B2 not configured"
    client = get_b2_client()
    if not client:
        # get_b2_client() has already logged why the client is unavailable.
        app.logger.warning("B2 upload not attempted for key=%s: B2 client unavailable", key)
        return False, "Could not upload image. Please try again."
    k = key.lstrip("/")
    started = time.time()
    app.logger.info("B2 upload started (key=%s, %d bytes)", k, len(data))
    try:
        client.put_object(Bucket=B2_BUCKET, Key=k, Body=data, ContentType=content_type)
        app.logger.info("B2 upload succeeded (key=%s, %d bytes, %.2fs)",
                        k, len(data), time.time() - started)
        return True, None
    except Exception as e:
        # Never swallow: log the exception type, message and traceback so the
        # failure is diagnosable from the Railway logs. The message is scrubbed
        # of any credential values; the client only ever sees a generic error.
        hint = _b2_failure_hint(e)
        app.logger.error("B2 upload failed (key=%s, %d bytes, endpoint=%s, region=%s): %s: %s%s",
                         k, len(data), B2_ENDPOINT_HOST or "?", B2_SIGNING_REGION or "?",
                         e.__class__.__name__, _b2_redact(str(e)),
                         (" | Hint: " + hint) if hint else "",
                         exc_info=True)
        return False, "Could not upload image. Please try again."

def b2_delete_key(key):
    if not key or not b2_enabled():
        return False
    client = get_b2_client()
    if not client:
        return False
    try:
        client.delete_object(Bucket=B2_BUCKET, Key=key.lstrip("/"))
        return True
    except Exception as e:
        app.logger.warning("B2 delete failed for %s: %s: %s",
                           key[:40], e.__class__.__name__, _b2_redact(str(e)))
        return False

def _is_b2_key(val):
    if not isinstance(val, str) or not val:
        return False
    if val.startswith("/images/"):
        return False
    if val.startswith("http://") or val.startswith("https://") or val.startswith("data:"):
        return False
    # Legacy /uploads/ and new uploads/... / avatars/... are B2 keys when B2 enabled
    if val.startswith("/uploads/") or val.startswith("uploads/") or val.startswith("avatars/") or val.startswith("/avatars/"):
        return True
    # Generic key with slash (e.g. listings/..., images/...)
    if "/" in val and not val.startswith("/"):
        return True
    if val.startswith("/"):
        # Possibly B2 key with leading slash not in above, treat as B2 if B2 enabled
        return b2_enabled() and val.count("/") >= 1
    return False

def _normalize_b2_key(val):
    if not isinstance(val, str) or not val:
        return None
    return val.lstrip("/")

def extract_b2_key_from_url(url):
    if not isinstance(url, str) or not url:
        return None
    url = url.strip()
    if url.startswith("/images/"):
        return None
    if url.startswith("http://") or url.startswith("https://"):
        try:
            from urllib.parse import urlparse, unquote
            parsed = urlparse(url)
            host = (parsed.hostname or "").lower()
            path = parsed.path.lstrip("/")
            # Virtual-hosted style: bucket as subdomain (mybucket.s3... or mybucket.f005...)
            # Path is the key directly
            if B2_BUCKET and host and (host == B2_BUCKET.lower() or host.startswith(B2_BUCKET.lower() + ".") or host.startswith(B2_BUCKET.lower() + "-")):
                if path:
                    return unquote(path.split("?")[0].split("#")[0])
            # Path-style with bucket in URL: https://f005.../file/mybucket/uploads/...
            if B2_BUCKET and B2_BUCKET.lower() in url.lower():
                # Try to extract after bucket occurrence in path
                low_url = url.lower()
                low_bucket = B2_BUCKET.lower()
                idx = low_url.index(low_bucket)
                after = url[idx + len(B2_BUCKET):].lstrip("/")
                after = after.split("?")[0].split("#")[0]
                # after may start with "/" or be file/... remove leading file/ if present
                if after.lower().startswith("file/"):
                    after = after[5:].lstrip("/")
                    # after now may be mybucket/uploads... need to strip bucket again?
                    # but we already stripped one bucket; if after still contains bucket prefix, strip it
                    if after.lower().startswith(low_bucket + "/"):
                        after = after[len(B2_BUCKET)+1:]
                if after and (after.startswith("uploads/") or after.startswith("avatars/") or "/" in after):
                    return unquote(after)
            # Generic B2 detection for file/ style without bucket check
            # Normalized at import: already lower-case, scheme-free and
            # free of any pasted path/query.
            endpoint_host = B2_ENDPOINT_HOST
            if not endpoint_host:
                try:
                    if B2_ENDPOINT:
                        endpoint_host = B2_ENDPOINT.strip().lower().replace("https://", "").replace("http://", "").split("/")[0].split("?")[0]
                except Exception:
                    endpoint_host = ""
            is_b2_host = False
            if host and endpoint_host and (host == endpoint_host or host.endswith(endpoint_host.lstrip("f0").lstrip("."))):
                is_b2_host = True
            if host and "backblazeb2.com" in host:
                is_b2_host = True
            if not is_b2_host:
                # Also allow if path looks like uploads/ avatars/ and host is B2-like
                # Already handled virtual-hosted above; otherwise not B2
                return None
            if path.startswith("file/"):
                parts = path.split("/", 2)
                if len(parts) == 3:
                    return unquote(parts[2].split("?")[0].split("#")[0])
                elif len(parts) == 2:
                    return unquote(parts[1].split("?")[0].split("#")[0])
            if path and (path.startswith("uploads/") or path.startswith("avatars/")):
                return unquote(path.split("?")[0].split("#")[0])
        except Exception:
            pass
        return None
    # Already a key
    if "/" in url:
        if url.startswith("/"):
            return url.lstrip("/")
        return url
    return None

def resolve_image_url(val):
    if not val or not isinstance(val, str):
        return ""
    if val.startswith("/images/"):
        return val
    if val.startswith("http://") or val.startswith("https://") or val.startswith("data:"):
        return val
    if _is_b2_key(val):
        key = _normalize_b2_key(val)
        if b2_enabled():
            url = b2_presigned_url(key)
            if url:
                return url
        # Fallback: serve as local path if B2 not available or failed
        return "/" + key if not val.startswith("/") else val
    return val

def resolve_images_list(images):
    if not isinstance(images, list):
        return []
    return [resolve_image_url(x) for x in images if isinstance(x, str) and x]

def b2_object_key_for_upload(filename):
    # filename already sanitized, e.g. uuid.jpg
    return f"uploads/{filename}"

def b2_object_key_for_avatar(filename):
    return f"avatars/{filename}"

def normalize_images_input(raw):
    out = []
    if not isinstance(raw, list):
        return out
    for i in raw:
        if not isinstance(i, str) or not i.strip():
            continue
        s = i.strip()
        if s.startswith("/images/"):
            out.append(s)
        elif s.startswith("/uploads/") or s.startswith("uploads/"):
            out.append(s.lstrip("/") if b2_enabled() else s)
        elif s.startswith("/avatars/") or s.startswith("avatars/"):
            out.append(s.lstrip("/") if b2_enabled() else s)
        elif s.startswith("http://") or s.startswith("https://"):
            key = extract_b2_key_from_url(s)
            if key:
                out.append(key)
            elif s.startswith("/images/"):
                out.append(s)
        elif "/" in s:
            # Assume B2 key
            out.append(s.lstrip("/"))
        # else ignore bare strings without slash
    return out

def delete_b2_objects_for_images(images):
    # Delete B2 objects for a list of stored image values (keys or paths)
    if not b2_enabled():
        return
    for img in images or []:
        if not isinstance(img, str):
            continue
        if _is_b2_key(img):
            key = _normalize_b2_key(img)
            b2_delete_key(key)

def public_user(row):
    if not row:
        return None
    avatar_val = row["avatar"] or ""
    # Resolve B2 avatar to presigned URL when needed
    if avatar_val and _is_b2_key(avatar_val):
        avatar_val = resolve_image_url(avatar_val)
    return {
        "id": row["id"], "name": row["name"], "phone": row["phone"],
        "whatsapp": row["whatsapp"], "province": row["province"],
        "district": row["district"], "city": row["city"], "bio": row["bio"],
        "avatar": avatar_val, "verified": bool(row["verified"]),
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


SELLER_COLS = ("id, name, phone, whatsapp, province, district, city, bio, avatar, "
               "verified, seller_type, created_at")


def listing_ctx(rows, include_seller=True):
    """Pre-load everything serialize_listing() would otherwise query per row.

    A page of 24 listings used to run 77 SQL statements (one urgent-promotion
    probe, one seller lookup and one business lookup per card). This collapses
    those into three queries for the whole page.
    """
    ids = [r["id"] for r in rows if r.get("id") is not None]
    uids = sorted({r["user_id"] for r in rows if r.get("user_id") is not None})
    ctx = {"urgent": set(), "sellers": {}, "businesses": {}}
    if not ids:
        return ctx
    ph = ",".join("?" * len(ids))
    ctx["urgent"] = {r["listing_id"] for r in query(
        f"SELECT DISTINCT listing_id FROM promotions WHERE listing_id IN ({ph}) "
        "AND ptype = 'urgent' AND (ends_at IS NULL OR ends_at >= ?)",
        tuple(ids) + (now(),))}
    if include_seller and uids:
        uph = ",".join("?" * len(uids))
        ctx["sellers"] = {r["id"]: r for r in query(
            f"SELECT {SELLER_COLS} FROM users WHERE id IN ({uph})", tuple(uids))}
        ctx["businesses"] = {r["user_id"]: r for r in query(
            f"SELECT id, name, slug, logo, user_id FROM businesses WHERE user_id IN ({uph})", tuple(uids))}
    return ctx


def serialize_listing(l, include_seller=True, ctx=None):
    raw_images = json.loads(l.get("images") or "[]")
    # Resolve B2 keys to presigned URLs for display; keep legacy /images as-is
    images = resolve_images_list(raw_images) if raw_images else []
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
        "rejection_reason": l.get("rejection_reason") or "",
        "urgent": (l["id"] in ctx["urgent"]) if ctx else has_urgent_badge(l["id"]),
    }
    if l.get("category_name"):
        out["category_name"] = l["category_name"]
    if l.get("category_slug"):
        out["category_slug"] = l["category_slug"]
    if include_seller:
        if ctx:
            seller = ctx["sellers"].get(l["user_id"])
        else:
            seller = query(f"SELECT {SELLER_COLS} FROM users WHERE id = ?", (l["user_id"],), one=True)
        if seller:
            out["seller"] = public_user(seller)
            biz = (ctx["businesses"].get(seller["id"]) if ctx
                   else query("SELECT id, name, slug, logo FROM businesses WHERE user_id = ?", (seller["id"],), one=True))
            if biz:
                biz_logo = biz["logo"]
                if biz_logo and _is_b2_key(biz_logo):
                    biz_logo = resolve_image_url(biz_logo)
                out["seller"]["business"] = {"id": biz["id"], "name": biz["name"], "slug": biz["slug"], "logo": biz_logo}
    return out


def serialize_listings(rows, include_seller=True):
    """Serialize a page of listings with batched lookups (see listing_ctx)."""
    rows = list(rows)
    ctx = listing_ctx(rows, include_seller=include_seller)
    return [serialize_listing(r, include_seller=include_seller, ctx=ctx) for r in rows]


def listing_query_base():
    return (
        "SELECT l.*, c.name AS category_name, c.slug AS category_slug "
        "FROM listings l JOIN categories c ON c.id = l.category_id "
    )


def expire_overdue():
    """Mark past-due active listings as expired (cheap, run on read)."""
    ts = now()
    execute("UPDATE listings SET status = 'expired' WHERE status = 'active' AND expiry_at IS NOT NULL AND expiry_at < ?", (ts,))
    # Drop dead sessions so the table cannot grow without bound.
    execute("DELETE FROM sessions WHERE expires_at IS NOT NULL AND expires_at < ?", (ts,))
    expire_promotions()


def create_indexes(conn):
    for sql in INDEXES:
        conn.execute(sql)
    conn.commit()


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
# Settings, audit, listing limits & promotion helpers (Part 3)
# ---------------------------------------------------------------------------
def get_settings():
    rows = query("SELECT key, value FROM site_settings")
    settings = dict(DEFAULT_SETTINGS)
    for r in rows:
        settings[r["key"]] = r["value"]
    return settings


def get_setting(key, default=None):
    row = query("SELECT value FROM site_settings WHERE key = ?", (key,), one=True)
    if row is None:
        return DEFAULT_SETTINGS.get(key, default)
    return row["value"]


def set_setting(key, value):
    execute(
        "INSERT INTO site_settings (key, value) VALUES (?,?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)))


def expiry_days():
    try:
        return max(1, int(get_setting("listing_expiry_days", "30")))
    except (TypeError, ValueError):
        return 30


def listing_limit():
    try:
        return max(1, int(get_setting("max_listings_per_user", "50")))
    except (TypeError, ValueError):
        return 50


def image_limit():
    # Task requirement: max 3 photos per listing, enforce 3 even if DB has stale 15
    try:
        v = int(get_setting("max_images_per_listing", "3"))
        return max(1, min(3, v))
    except (TypeError, ValueError):
        return 3


def require_approval():
    return get_setting("require_approval", "0") in ("1", "true", "True")


def audit(admin_id, action, entity="", entity_id=None, detail=""):
    execute("INSERT INTO audit_logs (admin_id, action, entity, entity_id, detail, created_at) VALUES (?,?,?,?,?,?)",
            (admin_id, action, entity, entity_id, detail, now()))


def promotion_prices():
    """Promotion packages with prices from settings (configurable by admin)."""
    out = []
    for ptype, name, desc, default_price, default_days in PROMOTION_TYPES:
        price = default_price
        days = default_days
        try:
            price = int(get_setting(f"promo_{ptype}_price", str(default_price)))
        except (TypeError, ValueError):
            pass
        try:
            days = int(get_setting(f"promo_{ptype}_days", str(default_days)))
        except (TypeError, ValueError):
            pass
        out.append({"type": ptype, "name": name, "description": desc,
                    "price": price, "duration_days": days})
    return out


def apply_promotion(listing_id, ptype, duration_days):
    """Apply a promotion package to a listing (featured flag / urgent badge)."""
    if ptype in ("featured", "boost", "homepage"):
        execute("UPDATE listings SET featured = 1, updated_at = ? WHERE id = ?", (now(), listing_id))
    # urgent badge is derived from an active urgent promotion row


def expire_promotions():
    """Clear featured flags whose promotion window has ended."""
    rows = query(
        "SELECT listing_id FROM promotions WHERE ptype IN ('featured','boost','homepage') "
        "AND ends_at IS NOT NULL AND ends_at < ?",
        (now(),))
    for r in rows:
        # Only clear featured if no other active promotion keeps it featured.
        still = query(
            "SELECT id FROM promotions WHERE listing_id = ? AND ptype IN ('featured','boost','homepage') "
            "AND (ends_at IS NULL OR ends_at >= ?)",
            (r["listing_id"], now()), one=True)
        if not still:
            execute("UPDATE listings SET featured = 0 WHERE id = ?", (r["listing_id"],))


def has_urgent_badge(listing_id):
    return bool(query(
        "SELECT id FROM promotions WHERE listing_id = ? AND ptype = 'urgent' "
        "AND (ends_at IS NULL OR ends_at >= ?)",
        (listing_id, now()), one=True))


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def current_user():
    token = request.headers.get("Authorization", "")
    if token.startswith("Bearer "):
        token = token[7:]
    if not token:
        return None
    ts = now()
    row = query(
        "SELECT u.*, s.expires_at AS session_expires_at FROM sessions s "
        "JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at IS NOT NULL AND s.expires_at > ?",
        (token, ts), one=True)
    if not row:
        return None
    # Sliding window: an active user is never logged out mid-session, but a
    # token that stops being used expires.
    if row["session_expires_at"] - ts < SESSION_RENEW_WINDOW:
        execute("UPDATE sessions SET expires_at = ? WHERE token = ?", (ts + SESSION_TTL_DAYS * 86400, token))
    return row


def require_auth():
    u = current_user()
    if not u:
        abort(401, description="Authentication required")
    if u.get("status") == "banned":
        abort(403, description="This account has been banned")
    if u.get("status") == "suspended":
        abort(403, description="This account has been suspended")
    return u


def require_admin():
    u = require_auth()
    if not u["is_admin"]:
        abort(403, description="Admin only")
    return u


def admin_only(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        require_admin()
        return fn(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------------------------
# Rate limiting (in-memory, per client IP)
# ---------------------------------------------------------------------------
_RATE = {}  # ip -> list of timestamps


def rate_limit(limit, window=60):
    """Allow `limit` requests per `window` seconds per client IP, per endpoint.

    Buckets are keyed by endpoint *and* IP: previously every limited endpoint
    shared one bucket per IP, so a handful of sign-ups / password resets from
    the same device could exhaust the sign-in budget and return a spurious 429.
    """
    def deco(fn):
        bucket_name = fn.__name__

        @wraps(fn)
        def wrapper(*args, **kwargs):
            ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
            key = f"{bucket_name}:{ip}"
            t = now()
            bucket = [x for x in _RATE.get(key, []) if x > t - window]
            if len(bucket) >= limit:
                abort(429, description="Too many attempts — please wait a minute and try again")
            bucket.append(t)
            _RATE[key] = bucket
            return fn(*args, **kwargs)
        return wrapper
    return deco


def json_body():
    """Parse a JSON request body.

    Returns ``(data, error_response)``. ``error_response`` is ``None`` when the
    body parsed (an absent body is treated as ``{}``); otherwise it is a ready
    to return 422 response so the client gets an accurate, non-misleading error
    instead of a silent ``{}`` that used to surface as "Invalid email or password".
    """
    data = request.get_json(silent=True)
    if data is None:
        raw = (request.get_data(as_text=True) or "").strip()
        if raw:
            return None, err("Request body is not valid JSON", 422)
        return {}, None
    if not isinstance(data, dict):
        return None, err("Request body must be a JSON object", 422)
    return data, None


def missing_fields_error(body, *fields):
    """400 response listing the required fields that are empty/absent."""
    missing = [f for f in fields if not str(body.get(f) or "").strip()]
    if not missing:
        return None
    labels = {
        "email": "email", "password": "password", "name": "name",
        "token": "reset link", "code": "verification code", "message": "message",
    }
    names = [labels.get(f, f.replace("_", " ")) for f in missing]
    if len(names) == 1:
        return err(f"Please enter your {names[0]}")
    return err("Please enter your " + " and ".join(names))


def user_payload(u):
    avatar = u["avatar"] or ""
    if avatar and _is_b2_key(avatar):
        avatar = resolve_image_url(avatar)
    return {
        "id": u["id"], "name": u["name"], "email": u["email"],
        "phone": u["phone"], "whatsapp": u["whatsapp"],
        "province": u["province"], "district": u["district"], "city": u["city"],
        "bio": u["bio"], "avatar": avatar, "verified": bool(u["verified"]),
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


def _log_b2_startup_status():
    """Log once per process where photo uploads are going: B2 or local disk.

    This is the line to look for in the Railway logs when an upload
    "succeeds" but no object appears in the bucket. Only non-secret values
    are written (bucket, endpoint host, region, boto3 version); the values
    of B2_KEY_ID and B2_APPLICATION_KEY are never logged.
    """
    logger = app.logger
    logger.setLevel(logging.INFO)
    # Flask's default app logger only ships WARNING+ to stderr via the
    # last-resort handler; attach an explicit INFO handler so the B2
    # diagnostics below are visible in the Railway logs.
    logger.handlers = [h for h in logger.handlers if not isinstance(h, logging.StreamHandler)]
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"))
    logger.addHandler(handler)

    logger.info("Lanka Lens started — local upload dir: %s", UPLOAD_DIR)
    if not b2_enabled():
        logger.warning(
            "B2 storage DISABLED — missing/empty env vars: %s. Photo uploads will be "
            "saved to the local filesystem (uploads/) instead of the Backblaze B2 "
            "bucket. Set B2_BUCKET, B2_ENDPOINT, B2_REGION, B2_KEY_ID and "
            "B2_APPLICATION_KEY on the Railway service to enable B2.",
            ", ".join(b2_missing_env()) or "(none — check env var names)")
        return
    try:
        import boto3
    except ImportError:
        logger.error("B2 storage is configured but boto3 is NOT installed in this "
                     "environment — B2 uploads will fail. boto3 is listed in "
                     "server/requirements.txt; rebuild the Railway image.")
        return
    try:
        import botocore
        botocore_version = getattr(botocore, "__version__", "unknown")
    except Exception:
        botocore_version = "unknown"

    # --- endpoint / region diagnostic (no credentials are printed) ---
    logger.info("B2 storage enabled (bucket=%s, endpoint=%s, signing region=%s, boto3=%s, botocore=%s)",
                B2_BUCKET, B2_ENDPOINT_URL or B2_ENDPOINT, B2_SIGNING_REGION or B2_REGION,
                getattr(boto3, "__version__", "unknown"), botocore_version)
    for note in B2_ENDPOINT_NOTES:
        logger.warning("B2_ENDPOINT: %s", note)
    if B2_ENDPOINT and B2_ENDPOINT.strip() != B2_ENDPOINT:
        logger.warning("B2_ENDPOINT had leading/trailing whitespace — that alone breaks the TLS "
                       "handshake; the trimmed value is being used.")
    if B2_REGION_MISMATCH:
        logger.warning(
            "B2_REGION=%s does not match the region in B2_ENDPOINT (%s). B2 validates the SigV4 "
            "credential scope against the endpoint region, so requests are being signed for %s. "
            "Set B2_REGION=%s to silence this.",
            B2_REGION, B2_ENDPOINT_REGION, B2_SIGNING_REGION, B2_ENDPOINT_REGION)
    if not B2_SIGNING_REGION:
        logger.warning("No region could be determined — set B2_REGION to the bucket's region "
                       "(the middle part of s3.<region>.backblazeb2.com).")
    if B2_BUCKET != B2_BUCKET.lower():
        logger.info("Bucket %r is not all lower-case, so it is not DNS-compatible; using "
                    "path-style addressing (bucket in the URL path), which is what B2 expects.",
                    B2_BUCKET)
    proxies = b2_proxy_env()
    if proxies:
        logger.warning("Proxy environment detected (%s) — botocore sends B2 traffic through it. "
                       "If uploads die with ConnectionClosedError, check that proxy.",
                       ", ".join(proxies))


def b2_startup_check():
    """One authenticated round-trip to B2 at boot, result logged, never fatal.

    Uses head_bucket: it is read-only, costs one request, and proves DNS, TLS,
    the SigV4 signature, the bucket name and the key's permissions in a single
    step. When B2 answers with a redirect it includes x-amz-bucket-region, which
    is printed so a wrong B2_REGION can be corrected from the logs alone.

    Set B2_STARTUP_CHECK=0 to skip it.
    """
    logger = app.logger
    if os.environ.get("B2_STARTUP_CHECK", "1").strip().lower() in ("0", "false", "no", "off"):
        logger.info("B2 startup connectivity check skipped (B2_STARTUP_CHECK=%s)",
                    os.environ.get("B2_STARTUP_CHECK"))
        return
    if not b2_enabled():
        return
    try:
        import boto3
    except ImportError:
        return
    started = time.time()
    try:
        # Short timeouts: a broken endpoint must not stall the healthcheck.
        client = boto3.client(
            "s3",
            endpoint_url=B2_ENDPOINT_URL,
            region_name=B2_SIGNING_REGION or B2_REGION,
            aws_access_key_id=B2_KEY_ID,
            aws_secret_access_key=B2_APPLICATION_KEY,
            config=b2_client_config(connect_timeout=8, read_timeout=15),
        )
        client.head_bucket(Bucket=B2_BUCKET)
        logger.info("B2 connectivity OK — head_bucket succeeded (bucket=%s, endpoint=%s, "
                    "region=%s, %.2fs)",
                    B2_BUCKET, B2_ENDPOINT_HOST, B2_SIGNING_REGION, time.time() - started)
    except Exception as e:
        detail = ""
        response = getattr(e, "response", None)
        if isinstance(response, dict):
            meta = response.get("ResponseMetadata") or {}
            headers = meta.get("HTTPHeaders") or {}
            real_region = headers.get("x-amz-bucket-region")
            if real_region:
                detail = (" | B2 reports the bucket's real region as %s — set B2_REGION=%s and "
                          "B2_ENDPOINT=https://s3.%s.backblazeb2.com"
                          % (real_region, real_region, real_region))
        logger.error("B2 connectivity check FAILED (%s: %s)%s",
                     e.__class__.__name__, _b2_redact(str(e)), detail)
        hint = _b2_failure_hint(e)
        if hint:
            logger.error("B2 connectivity check hint: %s", hint)


_log_b2_startup_status()
b2_startup_check()


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
@app.errorhandler(405)
@app.errorhandler(409)
@app.errorhandler(413)
@app.errorhandler(415)
@app.errorhandler(422)
@app.errorhandler(429)
@app.errorhandler(500)
def handle_http_error(e):
    return jsonify({"ok": False, "error": getattr(e, "description", None) or e.name}), e.code


@app.errorhandler(DatabaseUnavailable)
def handle_database_unavailable(e):
    app.logger.error("Database unavailable; request not completed")
    return err("Database temporarily unavailable. Please try again.", 503)


@app.errorhandler(DatabaseConflict)
def handle_database_conflict(e):
    return err("The change conflicts with an existing record.", 409)


@app.errorhandler(DatabaseFailure)
def handle_database_failure(e):
    app.logger.error("Database operation failed; request not completed")
    return err("Database operation failed.", 500)


@app.after_request
def finish_database_transaction(response):
    conn = g.get("db")
    if conn is not None:
        try:
            if response.status_code < 400:
                conn.commit()
            else:
                conn.rollback()
        except DatabaseFailure:
            # No success response for a failed/ambiguous commit. Never retry writes.
            # Preserve CORS/security headers already attached by other hooks.
            app.logger.error("Database transaction did not complete successfully")
            response.set_data(json.dumps({"ok": False, "error": "Database temporarily unavailable. Please try again."}))
            response.mimetype = "application/json"
            response.status_code = 503
    return response


@app.errorhandler(Exception)
def handle_unexpected_error(e):
    """Every API failure must come back as JSON with an honest status code.

    Without this an unhandled exception on an /api route returned Werkzeug's
    HTML 500 page, which the SPA could not parse — the user only ever saw a
    generic "Something went wrong".
    """
    if isinstance(e, HTTPException):
        return handle_http_error(e)
    if request.path.startswith("/api/"):
        app.logger.exception(e)
        return jsonify({"ok": False, "error": "Internal server error"}), 500
    raise e


# Comma separated list of allowed browser origins, or "*" (default). The API is
# token based (Authorization: Bearer …) and never uses cookies, so a permissive
# Allow-Origin does not expose session credentials. Set LL_CORS_ORIGINS to
# restrict it, e.g. LL_CORS_ORIGINS=https://lankalens.lk
CORS_ORIGINS = [o.strip() for o in os.environ.get("LL_CORS_ORIGINS", "*").split(",") if o.strip()]


@app.after_request
def add_cors_headers(resp):
    """Allow the SPA to talk to the API when it is served from another origin.

    The frontend is normally served by Flask itself (same origin), but it is
    also commonly opened from a static dev server / preview host — without
    these headers every request failed in the browser as an opaque CORS error
    and sign-in simply showed "Something went wrong".
    """
    if not request.path.startswith("/api/"):
        return resp
    origin = request.headers.get("Origin")
    if "*" in CORS_ORIGINS:
        resp.headers.setdefault("Access-Control-Allow-Origin", origin or "*")
    elif origin and origin in CORS_ORIGINS:
        resp.headers.setdefault("Access-Control-Allow-Origin", origin)
    else:
        return resp
    resp.headers.setdefault("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With")
    resp.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
    resp.headers.setdefault("Access-Control-Max-Age", "86400")
    resp.headers.setdefault("Vary", "Origin")
    return resp


@app.after_request
def add_security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    if request.path.startswith("/uploads/"):
        resp.headers.setdefault("Content-Disposition", "inline")
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    # Cache immutable static assets (hashed/versioned uploads, icons, css, js).
    if request.path.startswith(("/images/", "/css/", "/js/", "/icons/", "/fonts/", "/uploads/")):
        resp.headers.setdefault("Cache-Control", "public, max-age=86400")
    return resp


# ---------------------------------------------------------------------------
# Static serving (whitelisted)
# ---------------------------------------------------------------------------
SAFE_DIRS = {"css", "js", "images", "icons", "fonts", "uploads"}


@app.route("/")
def index():
    return render_index()


@app.route("/favicon.svg")
def favicon_svg():
    return send_from_directory(ROOT, "favicon.svg")


# ---------------------------------------------------------------------------
# SEO — server-rendered <head> for the SPA shell
# ---------------------------------------------------------------------------
def render_index(meta=None):
    """Serve the SPA shell with SEO meta tags injected (title/description/OG/canonical/JSON-LD)."""
    meta = meta or {}
    settings = get_settings()
    site = settings.get("site_name") or "Lanka Lens"
    tagline = settings.get("tagline") or "Buy & Sell Cameras in Sri Lanka"

    title = meta.get("title") or f"{site} — {tagline}"
    desc = meta.get("description") or (
        "Lanka Lens is Sri Lanka's camera marketplace — buy and sell cameras, lenses, drones, "
        "action cameras and accessories. Prices in LKR.")
    canonical = meta.get("canonical") or request.base_url.split("?")[0]
    og_type = meta.get("og_type") or "website"
    image = meta.get("image") or ""
    jsonld = meta.get("jsonld") or ""

    try:
        with open(os.path.join(ROOT, "index.html"), "r", encoding="utf-8") as fh:
            html = fh.read()
    except Exception:
        return jsonify({"ok": True})

    # Replace the existing <title> and <meta name="description"> with dynamic values.
    html = re.sub(r"<title>.*?</title>", f"<title>{esc_html(title)}</title>", html, flags=re.S)
    html = re.sub(r'<meta name="description" content=".*?"\s*/?>',
                  f'<meta name="description" content="{esc_html(desc)}">', html)

    extra = []
    extra.append(f'<link rel="canonical" href="{esc_html(canonical)}">')
    extra.append(f'<meta property="og:site_name" content="{esc_html(site)}">')
    extra.append(f'<meta property="og:title" content="{esc_html(title)}">')
    extra.append(f'<meta property="og:description" content="{esc_html(desc)}">')
    extra.append(f'<meta property="og:type" content="{esc_html(og_type)}">')
    if image:
        extra.append(f'<meta property="og:image" content="{esc_html(image)}">')
    extra.append(f'<meta property="og:url" content="{esc_html(canonical)}">')
    extra.append(f'<meta name="twitter:card" content="summary_large_image">')
    extra.append(f'<meta name="twitter:title" content="{esc_html(title)}">')
    extra.append(f'<meta name="twitter:description" content="{esc_html(desc)}">')
    if jsonld:
        extra.append(f'<script type="application/ld+json">{jsonld}</script>')

    html = html.replace("</head>", "\n".join(extra) + "\n</head>")
    return html


def esc_html(s):
    return (str(s or "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&#39;"))


def listing_jsonld(l):
    base = request.url_root.rstrip("/")
    return json.dumps({
        "@context": "https://schema.org",
        "@type": "Product",
        "name": l["title"],
        "image": l["images"][:5],
        "description": (l.get("description") or "")[:500],
        "offers": {
            "@type": "Offer",
            "priceCurrency": "LKR",
            "price": str(l["price"]),
            "availability": "https://schema.org/InStock",
            "url": f"{base}/listing/{l['slug']}-{l['id']}",
        },
    })


@app.route("/listing/<path:slug>")
def seo_listing(slug):
    m = re.search(r"-(\d+)$", slug)
    if not m:
        abort(404)
    lid = int(m.group(1))
    row = query(listing_query_base() + " WHERE l.id = ? AND l.status = 'active'", (lid,), one=True)
    if not row:
        abort(404)
    l = serialize_listing(row, include_seller=False)
    cat = query("SELECT name FROM categories WHERE id = ?", (row["category_id"],), one=True)
    base = request.url_root.rstrip("/")
    meta = {
        "title": f"{l['title']} — Lanka Lens",
        "description": (l.get("description") or f"{l['title']} — {l['price']:,.0f} LKR. "
                        f"Buy and sell camera gear in Sri Lanka on Lanka Lens.")[:300],
        "canonical": f"{base}/listing/{slug}",
        "og_type": "product",
        "image": (l["images"][0] if l["images"] else "") ,
        "jsonld": listing_jsonld(l),
    }
    resp = app.make_response(render_index(meta))
    resp.headers["X-Robots-Tag"] = "index, follow"
    return resp


@app.route("/guide/<slug>")
def seo_guide(slug):
    row = query("SELECT * FROM posts WHERE slug = ?", (slug,), one=True)
    if not row:
        abort(404)
    base = request.url_root.rstrip("/")
    meta = {
        "title": f"{row['title']} — Lanka Lens Buying Guide",
        "description": (row["excerpt"] or row["title"])[:300],
        "canonical": f"{base}/guide/{slug}",
        "image": row["image"] or "",
    }
    return render_index(meta)


@app.route("/shop/<slug>")
def seo_shop(slug):
    b = query("SELECT * FROM businesses WHERE slug = ?", (slug,), one=True)
    if not b:
        abort(404)
    base = request.url_root.rstrip("/")
    meta = {
        "title": f"{b['name']} — Camera Shop on Lanka Lens",
        "description": (b["description"] or f"{b['name']} — a camera shop on Lanka Lens.")[:300],
        "canonical": f"{base}/shop/{slug}",
        "image": b["logo"] or "",
    }
    return render_index(meta)


@app.route("/robots.txt")
def robots_txt():
    base = request.url_root.rstrip("/")
    return (
        "User-agent: *\n"
        "Allow: /\n"
        f"Sitemap: {base}/sitemap.xml\n"
    ), 200, {"Content-Type": "text/plain"}


@app.route("/sitemap.xml")
def sitemap_xml():
    base = request.url_root.rstrip("/")
    urls = []
    urls.append((base + "/", now(), "1.0"))
    for cat in query("SELECT slug FROM categories ORDER BY id"):
        urls.append((f"{base}/category/{cat['slug']}", now(), "0.7"))
    for r in query("SELECT slug FROM posts ORDER BY id"):
        urls.append((f"{base}/guide/{r['slug']}", now(), "0.6"))
    for b in query("SELECT slug FROM businesses ORDER BY id"):
        urls.append((f"{base}/shop/{b['slug']}", now(), "0.6"))
    for l in query("SELECT id, slug, updated_at FROM listings WHERE status = 'active' ORDER BY id"):
        urls.append((f"{base}/listing/{l['slug']}-{l['id']}", l["updated_at"] or now(), "0.8"))

    def fmt(ts):
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).strftime("%Y-%m-%d")

    body = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, ts, prio in urls:
        body.append(
            f"<url><loc>{esc_html(loc)}</loc><lastmod>{fmt(ts)}</lastmod>"
            f"<priority>{prio}</priority></url>")
    body.append("</urlset>")
    return "\n".join(body), 200, {"Content-Type": "application/xml"}


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
    # `storage` is a non-secret summary of where uploads land, so the storage
    # backend can be confirmed from the outside without reading Railway logs.
    if b2_enabled():
        storage = "Backblaze B2 (endpoint=%s, region=%s, bucket=%s)" % (
            B2_ENDPOINT_URL or "unparsed", B2_SIGNING_REGION or "?", B2_BUCKET)
    else:
        storage = "local disk (uploads/) — B2 disabled, missing: %s" % (
            ", ".join(b2_missing_env()) or "none")
    query("SELECT 1 AS ready", one=True)
    return ok({"status": "up", "time": now(), "storage": storage,
               "database": database.backend})


@app.route("/api/meta")
def meta():
    settings = get_settings()
    return ok({
        "categories": category_tree(),
        "conditions": CONDITIONS,
        "brands": [r["name"] for r in query("SELECT name FROM brands ORDER BY name")],
        "report_reasons": REPORT_REASONS,
        "promotions": promotion_prices(),
        "settings": {
            "site_name": settings.get("site_name") or "Lanka Lens",
            "tagline": settings.get("tagline") or "Buy & Sell Cameras in Sri Lanka",
            "logo": settings.get("logo") or "",
            "contact_email": settings.get("contact_email") or "",
            "contact_phone": settings.get("contact_phone") or "",
            "contact_address": settings.get("contact_address") or "",
            "footer_text": settings.get("footer_text") or "",
            "social_facebook": settings.get("social_facebook") or "",
            "social_instagram": settings.get("social_instagram") or "",
            "social_youtube": settings.get("social_youtube") or "",
            "max_images_per_listing": image_limit(),
            "listing_expiry_days": expiry_days(),
            "require_approval": require_approval(),
        },
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
# Fields a free-text search token may match. Every token must match at least one
# of these (tokens are ANDed, fields are ORed) so that "Canon 5D" or
# "sony a7 iii body" find listings even when the words are not adjacent in any
# single column. Always parameterized - user input never reaches the SQL text.
SEARCH_TOKEN_SQL = (
    "l.title LIKE ? ESCAPE '\\' OR l.brand LIKE ? ESCAPE '\\' OR l.model LIKE ? ESCAPE '\\' "
    "OR l.description LIKE ? ESCAPE '\\' OR l.specs LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' "
    "OR EXISTS (SELECT 1 FROM users su WHERE su.id = l.user_id AND su.name LIKE ? ESCAPE '\\') "
    "OR EXISTS (SELECT 1 FROM businesses sb WHERE sb.user_id = l.user_id AND sb.name LIKE ? ESCAPE '\\')"
)
SEARCH_TOKEN_PARAMS = 8
MAX_SEARCH_TOKENS = 8


def like_escape(value):
    """Escape LIKE wildcards so '%'/'_' typed by a user are matched literally."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_tokens(q):
    """Split a search string into bounded, wildcard-escaped LIKE patterns."""
    out = []
    for tok in re.split(r"[\s,;/|]+", (q or "").strip()):
        if not tok:
            continue
        out.append("%" + like_escape(tok) + "%")
        if len(out) >= MAX_SEARCH_TOKENS:
            break
    return out


def build_listing_where(args):
    conds, params = [], []
    q = (args.get("q") or "").strip()
    for pattern in search_tokens(q):
        conds.append("(" + SEARCH_TOKEN_SQL + ")")
        params += [pattern] * SEARCH_TOKEN_PARAMS

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
        like = f"%{like_escape(model)}%"
        conds.append("(l.model LIKE ? ESCAPE '\\' OR l.title LIKE ? ESCAPE '\\')")
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
                    conds.append(database.numeric_spec_sql() + " >= ?")
                    params += [f"$.{f}", int(val)]
                except ValueError:
                    pass
            elif field.endswith("_max"):
                f = field[:-4]
                try:
                    conds.append(database.numeric_spec_sql() + " <= ?")
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
    data = serialize_listings(rows)
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
    data["related"] = serialize_listings(related)
    return ok(data)


# Field limits enforced on the server. The wizard already caps these in the UI,
# but the API is public: without server-side limits a client could store a
# 5 000-character title, a 200 KB description or a listing with no price and no
# location at all.
TITLE_MAX = 120
DESC_MAX = 4000
SPEC_VALUE_MAX = 200
SPEC_KEYS_MAX = 40
LOCATION_MAX = 80
PRICE_MAX = 1_000_000_000


def validate_listing_fields(body, require_complete=True):
    """Validate the writable fields of a listing payload.

    Returns (cleaned_values, error_message). `require_complete` is False for
    drafts, where only the fields that *are* present need to be well formed.
    """
    out = {}

    if "title" in body or require_complete:
        title = str(body.get("title") or "").strip()
        if not title:
            return None, "Title is required"
        if len(title) > TITLE_MAX:
            return None, f"Title must be {TITLE_MAX} characters or fewer"
        out["title"] = title

    if "description" in body:
        desc = str(body.get("description") or "")
        if len(desc) > DESC_MAX:
            return None, f"Description must be {DESC_MAX} characters or fewer"
        out["description"] = desc.strip()

    if "price" in body or require_complete:
        raw = body.get("price")
        try:
            price = int(raw) if raw not in (None, "") else 0
        except (TypeError, ValueError):
            return None, "Price must be a number"
        if price < 0:
            return None, "Price cannot be negative"
        if price > PRICE_MAX:
            return None, "Price is too large"
        if require_complete and price <= 0:
            return None, "Please enter a price greater than zero"
        out["price"] = price

    if "condition" in body:
        cond = str(body.get("condition") or "").strip()
        if cond and cond not in CONDITIONS:
            return None, "Invalid condition"
        out["condition"] = cond or "Good"

    for field in ("province", "district", "city"):
        if field in body or (require_complete and field != "city"):
            val = str(body.get(field) or "").strip()
            if len(val) > LOCATION_MAX:
                return None, f"{field.capitalize()} is too long"
            if require_complete and field != "city" and not val:
                return None, "Please choose a location (province and district)"
            out[field] = val

    # The location pickers are fed from /api/locations, so a real client always
    # sends names that exist. Anything else is a hand-built request.
    if out.get("province"):
        if not query("SELECT id FROM provinces WHERE name = ?", (out["province"],), one=True):
            return None, "Unknown province"
    if out.get("district"):
        if not query("SELECT id FROM districts WHERE name = ?", (out["district"],), one=True):
            return None, "Unknown district"

    if "specs" in body:
        specs = body.get("specs")
        if not isinstance(specs, dict):
            return None, "Specifications must be an object"
        if len(specs) > SPEC_KEYS_MAX:
            return None, f"Too many specification fields (max {SPEC_KEYS_MAX})"
        clean = {}
        for key, val in specs.items():
            # Scalars only: nested objects/arrays would be stored verbatim in the
            # JSON blob and echoed back into other users' pages.
            if isinstance(val, bool) or val is None or isinstance(val, (int, float)):
                clean[str(key)[:60]] = val
            elif isinstance(val, str):
                if len(val) > SPEC_VALUE_MAX:
                    return None, f"{key} is too long (max {SPEC_VALUE_MAX} characters)"
                clean[str(key)[:60]] = val.strip()
            else:
                return None, f"{key} must be a simple value"
        out["specs"] = clean

    if "category_id" in body or require_complete:
        cat_id = body.get("category_id")
        try:
            cat_id = int(cat_id)
        except (TypeError, ValueError):
            return None, "Please choose a valid category"
        if not query("SELECT id FROM categories WHERE id = ?", (cat_id,), one=True):
            return None, "Please choose a valid category"
        out["category_id"] = cat_id

    return out, None


@app.route("/api/listings", methods=["POST"])
def create_listing():
    u = require_auth()
    body = request.get_json(silent=True) or {}

    status = body.get("status") or "active"
    if status not in ("active", "draft", "pending"):
        status = "active"

    # Server-side validation. Drafts only need the fields that are present to be
    # well formed; anything published needs a title, a real price and a location.
    clean, verr = validate_listing_fields(body, require_complete=(status != "draft"))
    if verr:
        return err(verr)
    cat_id = clean["category_id"]
    cat = query("SELECT * FROM categories WHERE id = ?", (cat_id,), one=True)
    if not cat:
        return err("Please choose a valid category")
    title = clean["title"]
    price = clean.get("price", 0)

    raw_images = body.get("images") or []
    if isinstance(raw_images, str):
        raw_images = [raw_images]
    # Normalize presigned URLs / legacy /uploads/ / B2 keys into canonical keys
    images = normalize_images_input(raw_images) if isinstance(raw_images, list) else []
    if len(images) > image_limit():
        return err(f"Too many images — maximum is {image_limit()} photos per listing")
    # Also reject raw count before normalization (e.g. attacker sending 20)
    if isinstance(raw_images, list) and len([x for x in raw_images if isinstance(x, str) and x.strip()]) > image_limit():
        # Check if normalized already truncated would hide excess; enforce strict
        if len(images) > image_limit() or len([x for x in raw_images if isinstance(x, str) and x.strip()]) > image_limit():
            return err(f"Too many images — maximum is {image_limit()} photos per listing")

    specs = clean.get("specs", {})

    prefs = body.get("contact_prefs") or {}
    if not isinstance(prefs, dict):
        prefs = {}

    # Listing limits (configurable by admin).
    if status != "draft":
        existing = query("SELECT COUNT(*) n FROM listings WHERE user_id = ? AND status IN ('active','pending','paused')",
                         (u["id"],), one=True)["n"]
        if existing >= listing_limit():
            return err(f"You've reached the limit of {listing_limit()} active listings")

    # Moderation workflow: when approval is required, published listings start as pending.
    if status == "active" and require_approval():
        status = "pending"

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
         clean.get("condition") or "Good", clean.get("description") or "", brand, model, year,
         clean.get("province") or "", clean.get("district") or "", clean.get("city") or "",
         json.dumps(images), status, json.dumps(specs), json.dumps(prefs), ts, ts,
         ts + expiry_days() * 86400))
    if status == "draft":
        notify(u["id"], "listing", "Draft saved", f"Your draft “{title}” was saved.", f"#/my-ads")
    elif status == "pending":
        notify(u["id"], "listing", "Listing submitted for review",
               f"“{title}” is pending approval by our team.", f"#/my-ads")
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

    # Partial update: only the fields present in the body are touched, but every
    # field that *is* present must pass the same server-side rules as a create.
    clean, verr = validate_listing_fields(body, require_complete=False)
    if verr:
        return err(verr)

    if "title" in clean:
        setf("title", clean["title"])
        setf("slug", slugify(clean["title"]))
    if "price" in clean:
        setf("price", clean["price"])
    if "negotiable" in body:
        setf("negotiable", 1 if body["negotiable"] else 0)
    if "condition" in clean:
        setf("condition", clean["condition"])
    if "description" in clean:
        setf("description", clean["description"])
    for field in ("province", "district", "city"):
        if field in clean:
            setf(field, clean[field])
    if "category_id" in clean:
        setf("category_id", clean["category_id"])
    if "images" in body:
        raw = body["images"] if isinstance(body["images"], list) else []
        imgs = normalize_images_input(raw)
        if len(imgs) > image_limit():
            return err(f"Too many images — maximum is {image_limit()} photos per listing")
        # Also reject if raw sent > limit but normalization would hide via filtering
        raw_count = len([x for x in raw if isinstance(x, str) and x.strip()])
        if raw_count > image_limit():
            return err(f"Too many images — maximum is {image_limit()} photos per listing")
        # Delete B2 objects that were removed in this update
        try:
            old_imgs = json.loads(row["images"] or "[]")
            removed = [x for x in old_imgs if x not in imgs]
            delete_b2_objects_for_images(removed)
            # Also clean local thumb files for removed local images if B2 not enabled? best effort
            if not b2_enabled():
                for r in removed:
                    if isinstance(r, str) and r.startswith("/uploads/"):
                        try:
                            p = os.path.join(UPLOAD_DIR, os.path.basename(r))
                            if os.path.exists(p):
                                os.remove(p)
                            # try thumb
                            base, ext = os.path.splitext(os.path.basename(r))
                            tp = os.path.join(UPLOAD_DIR, f"{base}_thumb.jpg")
                            if os.path.exists(tp):
                                os.remove(tp)
                        except Exception:
                            pass
        except Exception:
            pass
        setf("images", json.dumps(imgs))
    if "specs" in clean:
        specs = clean["specs"]
        setf("specs", json.dumps(specs))
        if isinstance(specs.get("brand"), str) and specs["brand"]:
            setf("brand", specs["brand"][:80])
        if isinstance(specs.get("model"), str) and specs["model"]:
            setf("model", specs["model"][:80])
        if specs.get("year"):
            setf("year", str(specs["year"])[:10])
    if "contact_prefs" in body and isinstance(body["contact_prefs"], dict):
        setf("contact_prefs", json.dumps(body["contact_prefs"]))
    if "rejection_reason" in body:
        setf("rejection_reason", (body["rejection_reason"] or "")[:500])
    if "status" in body:
        st = body["status"]
        if st not in LISTING_STATUSES:
            return err("Invalid status")
        setf("status", st)
        if st == "active" and not row["expiry_at"]:
            setf("expiry_at", now() + expiry_days() * 86400)

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
    # Delete B2 objects for this listing before DB delete
    try:
        imgs = json.loads(row["images"] or "[]")
        delete_b2_objects_for_images(imgs)
        if not b2_enabled():
            for im in imgs:
                if isinstance(im, str) and im.startswith("/uploads/"):
                    try:
                        p = os.path.join(UPLOAD_DIR, os.path.basename(im))
                        if os.path.exists(p):
                            os.remove(p)
                        base, ext = os.path.splitext(os.path.basename(im))
                        tp = os.path.join(UPLOAD_DIR, f"{base}_thumb.jpg")
                        if os.path.exists(tp):
                            os.remove(tp)
                    except Exception:
                        pass
    except Exception:
        pass
    execute("DELETE FROM listings WHERE id = ?", (lid,))
    # notifications.link is a hash route string, not a foreign key, so the rows
    # that announced this listing ("Listing published", "Listing renewed",
    # "Listing promoted") survive the cascade and would keep pointing the seller
    # at an ad that no longer exists. Remove them with the listing.
    execute("DELETE FROM notifications WHERE link = ?", (f"#/ads/{lid}",))
    return ok({"deleted": lid})


@app.route("/api/listings/<int:lid>/renew", methods=["POST"])
def renew_listing(lid):
    u = require_auth()
    row = query("SELECT * FROM listings WHERE id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    if row["user_id"] != u["id"] and not u["is_admin"]:
        return err("Not allowed", 403)
    new_expiry = now() + expiry_days() * 86400
    execute("UPDATE listings SET status = 'active', expiry_at = ?, updated_at = ? WHERE id = ?", (new_expiry, now(), lid))
    notify(u["id"], "listing", "Listing renewed", f"“{row['title']}” is active for another {expiry_days()} days.", f"#/ads/{lid}")
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
    return ok(serialize_listings(rows))


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
    execute("INSERT INTO favorites (user_id, listing_id, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING",
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
    raw_imgs = json.loads((listing["images"] if listing else "") or "[]")
    imgs = resolve_images_list(raw_imgs) if raw_imgs else []
    return {
        "id": o["id"], "listing_id": o["listing_id"],
        "buyer_id": o["buyer_id"], "seller_id": o["seller_id"],
        "amount": o["amount"], "counter_amount": o.get("counter_amount"),
        "message": o.get("message") or "", "status": o["status"],
        "created_at": o["created_at"],
        "listing_title": listing["title"] if listing else "",
        "listing_images": imgs,
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
            raw = json.loads(lrow["images"] or "[]")
            img0 = (raw or [None])[0]
            if img0 and _is_b2_key(img0):
                img0 = resolve_image_url(img0)
            listing = {"id": lrow["id"], "title": lrow["title"], "price": lrow["price"],
                       "image": img0}
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
    execute("INSERT INTO blocks (user_id, blocked_id, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING", (u["id"], other_id, now()))
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
        return err("Image too large (max 1MB)")
    # Delete old avatar from B2 if it was a B2 key (avoid orphan)
    old_avatar = u.get("avatar") or query("SELECT avatar FROM users WHERE id = ?", (u["id"],), one=True)["avatar"] if u.get("avatar") is None else u.get("avatar")
    # Need explicit query for old because u may not have fresh avatar? Use query anyway
    try:
        old_row = query("SELECT avatar FROM users WHERE id = ?", (u["id"],), one=True)
        old_avatar = (old_row["avatar"] if old_row else "") or ""
    except Exception:
        old_avatar = u.get("avatar") or ""
    src = decode_image(data)
    if src is None:
        return err("That file is not a readable image. Upload a JPG, PNG, WEBP or GIF.")
    try:
        from PIL import Image, ImageOps
        import io as _io
        img = ImageOps.exif_transpose(src).convert("RGB")
        img = ImageOps.fit(img, (256, 256), Image.Resampling.LANCZOS)
        if b2_enabled():
            out = _io.BytesIO()
            img.save(out, "JPEG", quality=85)
            out.seek(0)
            key = b2_object_key_for_avatar(f"avatar_{uuid.uuid4().hex}.jpg")
            ok1, err1 = b2_upload_bytes(key, out.getvalue(), content_type="image/jpeg")
            if not ok1:
                return err(err1 or "Could not upload image. Please try again.")
            # Clean up old B2 avatar after successful upload
            if old_avatar and _is_b2_key(old_avatar):
                b2_delete_key(_normalize_b2_key(old_avatar))
            elif old_avatar and old_avatar.startswith("/uploads/avatar_"):
                try:
                    p = os.path.join(UPLOAD_DIR, os.path.basename(old_avatar))
                    if os.path.exists(p):
                        os.remove(p)
                except Exception:
                    pass
            execute("UPDATE users SET avatar = ? WHERE id = ?", (key, u["id"]))
            url = resolve_image_url(key) or ("/" + key)
            return ok({"url": url, "key": key})
        else:
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            name = f"avatar_{uuid.uuid4().hex}.jpg"
            path = os.path.join(UPLOAD_DIR, name)
            img.save(path, "JPEG", quality=85)
            # Clean old local avatar
            if old_avatar and old_avatar.startswith("/uploads/avatar_"):
                try:
                    p = os.path.join(UPLOAD_DIR, os.path.basename(old_avatar))
                    if os.path.exists(p):
                        os.remove(p)
                except Exception:
                    pass
            execute("UPDATE users SET avatar = ? WHERE id = ?", (f"/uploads/{name}", u["id"]))
            app.logger.info("Avatar saved to local disk uploads/%s — B2 storage is disabled", name)
            return ok({"url": f"/uploads/{name}"})
    except Exception as e:
        # If the exception came from our own err return, it's already handled above; this is unexpected
        if isinstance(e, Exception) and "Could not upload" in str(e):
            raise
        app.logger.warning("Avatar processing failed: %s: %s",
                           e.__class__.__name__, _b2_redact(str(e)))
        return err("Could not process that image. Try a different photo.")


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
    # Only an admin-approved shop is public; a pending/unverified business
    # profile must not leak through the seller page.
    if biz and not biz["verified"]:
        biz = None
    ratings = query(
        "SELECT r.*, u.name AS buyer_name FROM ratings r JOIN users u ON u.id = r.buyer_id WHERE r.seller_id = ? ORDER BY r.created_at DESC LIMIT 20",
        (uid,))
    return ok({
        "seller": public_user(row),
        "rating": seller_rating(uid),
        "ratings": ratings,
        "business": dict(biz) if biz else None,
        "listings": serialize_listings(listings),
    })


@app.route("/api/me/listings")
def my_listings():
    u = require_auth()
    expire_overdue()
    rows = query(listing_query_base() + " WHERE l.user_id = ? ORDER BY l.created_at DESC", (u["id"],))
    return ok(serialize_listings(rows))


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
        first_img = img[0] if img else None
        if first_img and _is_b2_key(first_img):
            first_img = resolve_image_url(first_img)
        per.append({
            "id": l["id"], "title": l["title"], "status": l["status"],
            "image": first_img,
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
    if not isinstance(hours, dict):
        hours = {}
    logo = b.get("logo") or ""
    if logo and _is_b2_key(logo):
        logo = resolve_image_url(logo)
    # Defensive .get() reads: a database created before a column was added must
    # not turn the whole shop list into a 500.
    doc = b.get("document") or ""
    if doc and _is_b2_key(doc):
        doc = resolve_image_url(doc)
    return {
        "id": b.get("id"), "name": b.get("name") or "Unnamed shop", "slug": b.get("slug") or "",
        "logo": logo,
        "description": b.get("description") or "", "province": b.get("province") or "",
        "district": b.get("district") or "",
        "city": b.get("city") or "", "area": b.get("area") or "", "phone": b.get("phone") or "",
        "whatsapp": b.get("whatsapp") or "",
        "opening_hours": hours, "verified": bool(b.get("verified")),
        "user_id": b.get("user_id"),
        "business_category": b.get("business_category") or "",
        "owner_name": b.get("owner_name") or "",
        "registration_number": b.get("registration_number") or "",
        "document": doc,
        "verification_status": b.get("verification_status") or "not_submitted",
        "rejection_reason": b.get("rejection_reason") or "",
        "submitted_at": b.get("submitted_at"),
        "reviewed_at": b.get("reviewed_at"),
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

    def _upload_field(value):
        """Normalise an uploaded image (logo / supporting document) to its
        canonical key: accepts a presigned http URL, /uploads/, /images/ or a
        raw B2 key. Returns None when no value was provided."""
        if not isinstance(value, str) or not value.strip():
            return None
        s = value.strip()
        if s.startswith("/images/"):
            return s
        norm = normalize_images_input([s])
        return norm[0] if norm else s

    logo_val = _upload_field(body.get("logo"))
    doc_val = _upload_field(body.get("document"))
    business_category = (body.get("business_category") or "").strip()[:60]
    owner_name = (body.get("owner_name") or "").strip()[:60]
    registration_number = (body.get("registration_number") or "").strip()[:40]
    existing = query("SELECT * FROM businesses WHERE user_id = ?", (u["id"],), one=True)
    if existing:
        slug = existing["slug"]
        if body.get("slug"):
            slug = slugify(body["slug"])
        # If logo_val is None (not provided), keep existing; else use new
        final_logo = logo_val if logo_val is not None else existing["logo"]
        final_doc = doc_val if doc_val is not None else (existing["document"] or "")
        # Delete old B2 logo if replaced
        if logo_val is not None and existing["logo"] and existing["logo"] != final_logo and _is_b2_key(existing["logo"]):
            b2_delete_key(_normalize_b2_key(existing["logo"]))
        execute(
            """UPDATE businesses SET name=?, slug=?, logo=?, description=?, province=?, district=?, city=?, area=?,
               phone=?, whatsapp=?, opening_hours=?, business_category=?, owner_name=?, registration_number=?, document=?
               WHERE user_id=?""",
            (name, slug, final_logo, body.get("description") or existing["description"] or "",
             body.get("province") or existing["province"] or "", body.get("district") or existing["district"] or "",
             body.get("city") or existing["city"] or "", body.get("area") or existing["area"] or "",
             body.get("phone") or existing["phone"] or "", body.get("whatsapp") or existing["whatsapp"] or "",
             json.dumps(body.get("opening_hours") or {}), business_category, owner_name, registration_number,
             final_doc, u["id"]))
    else:
        slug = slugify(body.get("slug") or name)
        base = slug
        i = 2
        while query("SELECT id FROM businesses WHERE slug = ?", (slug,), one=True):
            slug = f"{base}-{i}"
            i += 1
        execute(
            """INSERT INTO businesses (user_id, name, slug, logo, description, province, district, city, area,
               phone, whatsapp, opening_hours, verified, business_category, owner_name,
               registration_number, document, verification_status, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?, 'not_submitted', ?)""",
            (u["id"], name, slug, logo_val or "", body.get("description") or "",
             body.get("province") or "", body.get("district") or "", body.get("city") or "",
             body.get("area") or "", body.get("phone") or "", body.get("whatsapp") or "",
             json.dumps(body.get("opening_hours") or {}), business_category, owner_name,
             registration_number, doc_val or "", now()))
        execute("UPDATE users SET seller_type = 'business' WHERE id = ?", (u["id"],))
    b = query("SELECT * FROM businesses WHERE user_id = ?", (u["id"],), one=True)
    return ok(business_payload(b))


# Business categories offered to shop owners (free text also accepted).
BUSINESS_CATEGORIES = [
    "Camera & Lens Sales", "Repair & Service", "Rentals", "Photo Studio / Printing",
    "Online Store", "Accessories & Bags", "Other",
]


@app.route("/api/me/business/submit", methods=["POST"])
def submit_business_verification():
    """Owner submits their shop for admin verification (not_submitted/rejected
    -> pending). The badge is granted only by an admin approval — submitting
    never verifies a shop on its own."""
    u = require_auth()
    b = query("SELECT * FROM businesses WHERE user_id = ?", (u["id"],), one=True)
    if not b:
        return err("Create your shop details first", 400)
    status = b["verification_status"] or "not_submitted"
    if status == "pending":
        return err("Your shop is already under review", 400)
    if status == "approved":
        return err("Your shop is already verified", 400)
    missing = []
    if not (b["name"] or "").strip():
        missing.append("business name")
    if not (b["owner_name"] or "").strip():
        missing.append("owner name")
    if not (b["phone"] or "").strip():
        missing.append("business phone")
    if not (b["area"] or "").strip():
        missing.append("business address")
    if not ((b["province"] or "").strip() and (b["district"] or "").strip() and (b["city"] or "").strip()):
        missing.append("province, district and city")
    if not (b["business_category"] or "").strip():
        missing.append("business category")
    if not (b["document"] or "").strip():
        missing.append("a supporting business document")
    if missing:
        return err("To submit for verification you still need: " + ", ".join(missing), 400)
    execute(
        "UPDATE businesses SET verification_status='pending', submitted_at=?, reviewed_at=NULL, "
        "rejection_reason='', verified=0 WHERE user_id=?", (now(), u["id"]))
    notify(u["id"], "listing", "Shop verification submitted",
           "Your shop is now under review. We'll notify you once it has been checked.",
           "#/my-shop")
    b = query("SELECT * FROM businesses WHERE user_id = ?", (u["id"],), one=True)
    return ok(business_payload(b))


@app.route("/api/businesses")
def businesses_list():
    """Verified (admin-approved) camera shops with listing counts & ratings.

    Only approved businesses appear in the public directory — a shop that has
    merely registered (pending / not submitted / rejected) is not listed here.
    """
    rows = query("SELECT * FROM businesses WHERE verified = 1 ORDER BY name")
    out = []
    for b in rows:
        item = business_payload(b)
        uid = b.get("user_id")
        item["listing_count"] = query(
            "SELECT COUNT(*) n FROM listings WHERE user_id = ? AND status = 'active'", (uid,), one=True)["n"] if uid else 0
        item["rating"] = seller_rating(uid) if uid else {"count": 0, "avg": 0}
        out.append(item)
    return ok(out)


@app.route("/api/business/<slug>")
def business_page(slug):
    b = query("SELECT * FROM businesses WHERE slug = ?", (slug,), one=True)
    if not b:
        return err("Shop not found", 404)
    # Unapproved shops are not public. Their owner can still preview their own
    # shop page from "My Shop" while the verification is pending/rejected.
    preview = False
    if not b["verified"]:
        u = current_user()
        if not u or u["id"] != b["user_id"]:
            return err("Shop not found", 404)
        preview = True
    owner = query("SELECT id, name, phone, whatsapp, province, district, city, bio, avatar, verified, seller_type, created_at FROM users WHERE id = ?", (b["user_id"],), one=True)
    listings = query(listing_query_base() + " WHERE l.user_id = ? AND l.status = 'active' ORDER BY l.created_at DESC", (b["user_id"],))
    return ok({
        "business": business_payload(b),
        "owner": public_user(owner) if owner else None,
        "rating": seller_rating(b["user_id"]),
        "listings": serialize_listings(listings),
        "preview": preview,
    })


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Used to keep the response time of a failed sign-in the same whether or not the
# email exists (avoids leaking which addresses have accounts).
_DUMMY_HASH = hash_password("lankalens-not-a-real-password")


@app.route("/api/auth/signup", methods=["POST"])
@rate_limit(10, 60)
def signup():
    body, bad = json_body()
    if bad:
        return bad
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    missing = missing_fields_error({"name": name, "email": email, "password": password},
                                   "name", "email", "password")
    if missing:
        return missing
    if len(name) < 2:
        return err("Please enter your name")
    if not EMAIL_RE.match(email):
        return err("Please enter a valid email")
    if len(password) < 6:
        return err("Password must be at least 6 characters")
    if query("SELECT id FROM users WHERE email = ?", (email,), one=True):
        return err("An account with this email already exists", 409)
    if query("SELECT id FROM banned_emails WHERE email = ?", (email,), one=True):
        return err("This email is not allowed to register", 403)
    seller_type = body.get("seller_type") or "individual"
    if seller_type not in ("individual", "business"):
        seller_type = "individual"
    uid = execute(
        "INSERT INTO users (name, email, password_hash, phone, whatsapp, seller_type, email_verified, created_at) VALUES (?,?,?,?,?,?,0,?)",
        (name, email, hash_password(password), (body.get("phone") or "").strip(),
         (body.get("whatsapp") or "").strip(), seller_type, now()))
    token = secrets.token_hex(32)
    execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
            (token, uid, now(), now() + SESSION_TTL_DAYS * 86400))
    u = query("SELECT * FROM users WHERE id = ?", (uid,), one=True)

    # Email verification: token emailed in production; exposed in `dev` for local testing.
    vtoken = make_token(uid, "email", ttl=86400)
    return ok({
        "token": token, "user": user_payload(u),
        "dev": {"verify_email_token": vtoken, "verify_email_link": f"#/verify-email?token={vtoken}"},
    })


@app.route("/api/auth/login", methods=["POST"])
@rate_limit(20, 60)
def login():
    body, bad = json_body()
    if bad:
        return bad
    email = (body.get("email") or body.get("username") or "").strip().lower()
    password = body.get("password") or ""
    missing = missing_fields_error({"email": email, "password": password}, "email", "password")
    if missing:
        return missing

    u = query("SELECT * FROM users WHERE email = ?", (email,), one=True)
    if not u:
        verify_password(password, _DUMMY_HASH)  # constant-time: no account enumeration
        return err("Invalid email or password", 401)
    if not verify_password(password, u["password_hash"]):
        return err("Invalid email or password", 401)
    if u.get("status") == "banned":
        return err("This account has been banned", 403)
    if u.get("status") == "suspended":
        return err("This account has been suspended. Contact support.", 403)

    token = secrets.token_hex(32)
    execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
            (token, u["id"], now(), now() + SESSION_TTL_DAYS * 86400))
    return ok({"token": token, "user": user_payload(u)})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    token = request.headers.get("Authorization", "")
    if token.startswith("Bearer "):
        execute("DELETE FROM sessions WHERE token = ?", (token[7:],))
    return ok({"logged_out": True})


@app.route("/api/auth/forgot", methods=["POST"])
@rate_limit(10, 300)
def forgot_password():
    body, bad = json_body()
    if bad:
        return bad
    email = (body.get("email") or "").strip().lower()
    missing = missing_fields_error({"email": email}, "email")
    if missing:
        return missing
    u = query("SELECT * FROM users WHERE email = ?", (email,), one=True)
    if not u:
        # Do not reveal whether the email exists.
        return ok({"sent": True, "dev": None})
    token = make_token(u["id"], "reset", ttl=3600)
    return ok({"sent": True, "dev": {"reset_token": token, "reset_link": f"#/reset-password?token={token}"}})


@app.route("/api/auth/reset", methods=["POST"])
def reset_password():
    body, bad = json_body()
    if bad:
        return bad
    token = (body.get("token") or "").strip()
    missing = missing_fields_error({"token": token, "password": body.get("password")}, "token", "password")
    if missing:
        return missing
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
    body, bad = json_body()
    if bad:
        return bad
    token = (body.get("token") or "").strip()
    missing = missing_fields_error({"token": token}, "token")
    if missing:
        return missing
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
# Posts, contact
# ---------------------------------------------------------------------------
# NOTE: the old /api/shops endpoints were removed. The camera-shop directory the
# app actually renders (#/shops, #/shop/<slug>) is served by /api/businesses,
# backed by the `businesses` table, whose rows are owned by real seller accounts.
# The orphaned `shops` table duplicated three of those names and added three
# phantom shops that nothing in the frontend, admin panel or API ever read.
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
def decode_image(data):
    """Return a verified PIL image, or None when the bytes are not a real image.

    The extension check alone is not enough: renaming anything to .jpg used to be
    stored verbatim (the old code wrote the raw bytes when PIL failed), which put
    arbitrary, unrenderable content in /uploads and a broken image in the UI.
    """
    try:
        import io
        from PIL import Image
        img = Image.open(io.BytesIO(data))
        img.verify()                       # rejects truncated / forged files
        img = Image.open(io.BytesIO(data))  # verify() leaves the object unusable
        img.load()
        if img.width < 1 or img.height < 1:
            return None
        return img
    except Exception:
        return None


def process_image(data, ext, max_dim=1600, thumb_dim=420):
    """Return (main_key_or_filename, thumb_key_or_filename) or (None, error_message).

    When B2 is configured, uploads directly to the private bucket and returns
    B2 object keys (uploads/xxx.jpg) without touching local disk. Otherwise
    saves to UPLOAD_DIR and returns local filenames.
    """
    img = decode_image(data)
    if img is None:
        return None, "That file is not a readable image. Upload a JPG, PNG, WEBP or GIF."
    name = uuid.uuid4().hex
    main_name = f"{name}.jpg"
    thumb_name = f"{name}_thumb.jpg"
    try:
        from PIL import Image, ImageOps
        import io as _io
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGBA")
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            img = bg
        else:
            img = img.convert("RGB")
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        if b2_enabled():
            # Upload to Backblaze B2 private bucket
            main_io = _io.BytesIO()
            img.save(main_io, "JPEG", quality=82, optimize=True)
            main_io.seek(0)
            thumb = img.copy()
            thumb.thumbnail((thumb_dim, thumb_dim), Image.Resampling.LANCZOS)
            thumb_io = _io.BytesIO()
            thumb.save(thumb_io, "JPEG", quality=78, optimize=True)
            thumb_io.seek(0)
            main_key = b2_object_key_for_upload(main_name)
            thumb_key = b2_object_key_for_upload(thumb_name)
            ok1, err1 = b2_upload_bytes(main_key, main_io.getvalue(), content_type="image/jpeg")
            if not ok1:
                return None, err1 or "Could not upload image. Please try again."
            ok2, err2 = b2_upload_bytes(thumb_key, thumb_io.getvalue(), content_type="image/jpeg")
            if not ok2:
                # thumb failure is non-fatal; keep main image
                try:
                    app.logger.warning("B2 thumb upload failed for %s: %s", thumb_key, err2)
                except Exception:
                    pass
                return main_key, None
            return main_key, thumb_key
        else:
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            img.save(os.path.join(UPLOAD_DIR, main_name), "JPEG", quality=82, optimize=True)
            thumb = img.copy()
            thumb.thumbnail((thumb_dim, thumb_dim), Image.Resampling.LANCZOS)
            thumb.save(os.path.join(UPLOAD_DIR, thumb_name), "JPEG", quality=78, optimize=True)
            app.logger.info("Image saved to local disk uploads/%s (+ thumbnail) — B2 storage is disabled",
                            main_name)
            return main_name, thumb_name
    except Exception as exc:
        app.logger.warning("Image re-encoding failed, storing original bytes instead: %s: %s",
                           exc.__class__.__name__, _b2_redact(str(exc)))
        # The bytes decoded as an image but could not be re-encoded (e.g. an
        # exotic mode). Store the original under a safe name rather than
        # silently discarding the user's upload.
        safe_ext = ext if ext in ALLOWED_IMG else "jpg"
        fallback_name = f"{name}.{safe_ext}"
        if b2_enabled():
            fallback_key = b2_object_key_for_upload(fallback_name)
            ok1, err1 = b2_upload_bytes(fallback_key, data, content_type=f"image/{safe_ext}" if safe_ext != "jpg" else "image/jpeg")
            if ok1:
                return fallback_key, None
            return None, err1 or f"Could not save that image ({exc.__class__.__name__})."
        else:
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            try:
                with open(os.path.join(UPLOAD_DIR, fallback_name), "wb") as fh:
                    fh.write(data)
                return fallback_name, None
            except OSError:
                return None, f"Could not save that image ({exc.__class__.__name__})."


@app.route("/api/upload", methods=["POST"])
def upload():
    require_auth()
    files = request.files.getlist("files") or ([request.files["file"]] if "file" in request.files else [])
    if not files:
        return err("No file uploaded")
    # Which backend will actually receive the bytes — this line is the first
    # thing to check in the logs when photos appear to "disappear" from B2.
    backend = "Backblaze B2" if b2_enabled() else "LOCAL DISK (uploads/)"
    app.logger.info("Upload route reached: %d file(s) (storage=%s)", len(files), backend)
    items = []
    for f in files:
        ext = (f.filename or "").rsplit(".", 1)[-1].lower() if "." in (f.filename or "") else ""
        if ext not in ALLOWED_IMG:
            return err(f"Unsupported image type: {ext or 'unknown'}")
        data = f.read()
        if len(data) > MAX_IMG_BYTES:
            app.logger.warning("Upload rejected: %s is %d bytes (max 1MB per photo)",
                               (f.filename or "")[:80], len(data))
            return err("Image too large (max 1MB)")
        main_key, thumb_key = process_image(data, ext)
        if not main_key:
            app.logger.warning("Upload failed for %s: %s",
                               (f.filename or "")[:80], thumb_key or "could not process image")
            return err(thumb_key or "Could not process that image")
        # When B2 is enabled, process_image returns B2 keys (uploads/xxx.jpg).
        # Return a presigned URL for immediate preview while the canonical key
        # is also returned; normalize_images_input on listing save extracts the key.
        if b2_enabled() and _is_b2_key(main_key):
            url = resolve_image_url(main_key) or ("/" + main_key.lstrip("/"))
            item = {"url": url, "key": main_key}
            if thumb_key and _is_b2_key(thumb_key):
                t_url = resolve_image_url(thumb_key) or ("/" + thumb_key.lstrip("/"))
                item["thumb"] = t_url
                item["thumb_key"] = thumb_key
            elif thumb_key:
                item["thumb"] = f"/uploads/{thumb_key}"
        else:
            # Local fallback
            item = {"url": f"/uploads/{main_key}"}
            if thumb_key:
                item["thumb"] = f"/uploads/{thumb_key}"
        items.append(item)
    app.logger.info("Upload complete: %d image(s) stored in %s", len(items), backend)
    return ok({"items": items})


# ---------------------------------------------------------------------------
# Admin (categories — Part 3 will build the UI on top of these)
# ---------------------------------------------------------------------------
@app.route("/api/admin/categories", methods=["POST"])
def admin_add_category():
    admin = require_admin()
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return err("Name required")
    slug = slugify(body.get("slug") or name)
    base = slug
    i = 2
    while query("SELECT id FROM categories WHERE slug = ?", (slug,), one=True):
        slug = f"{base}-{i}"
        i += 1
    parent_id = body.get("parent_id") or None
    if parent_id:
        parent_id = int(parent_id)
    icon = body.get("icon") or "layers-outline"
    cid = execute("INSERT INTO categories (slug, name, icon, parent_id, sort, fields) VALUES (?,?,?,?,?,?)",
                  (slug, name, icon, parent_id, int(body.get("sort") or 0), json.dumps(body.get("fields") or [])))
    audit(admin["id"], "create_category", "category", cid, name)
    return ok({"id": cid})


@app.route("/api/admin/categories/<int:cid>", methods=["PATCH", "DELETE"])
def admin_edit_category(cid):
    admin = require_admin()
    if request.method == "DELETE":
        execute("DELETE FROM categories WHERE id = ?", (cid,))
        audit(admin["id"], "delete_category", "category", cid)
        return ok({"deleted": cid})
    body = request.get_json(silent=True) or {}
    if body.get("name"):
        execute("UPDATE categories SET name = ? WHERE id = ?", (body["name"].strip(), cid))
    if body.get("slug"):
        slug = slugify(body["slug"])
        base = slug
        i = 2
        while query("SELECT id FROM categories WHERE slug = ? AND id != ?", (slug, cid), one=True):
            slug = f"{base}-{i}"
            i += 1
        execute("UPDATE categories SET slug = ? WHERE id = ?", (slug, cid))
    if body.get("icon"):
        execute("UPDATE categories SET icon = ? WHERE id = ?", (body["icon"], cid))
    if body.get("parent_id") is not None:
        execute("UPDATE categories SET parent_id = ? WHERE id = ?", (body["parent_id"] or None, cid))
    if "fields" in body:
        execute("UPDATE categories SET fields = ? WHERE id = ?", (json.dumps(body["fields"]), cid))
    if "sort" in body:
        execute("UPDATE categories SET sort = ? WHERE id = ?", (int(body["sort"]), cid))
    return ok({"id": cid})


# ---------------------------------------------------------------------------
# Promotions & payments (Part 3)
# ---------------------------------------------------------------------------
@app.route("/api/promotions")
def promotions_list():
    return ok(promotion_prices())


@app.route("/api/me/promotions")
def my_promotions():
    u = require_auth()
    rows = query(
        "SELECT p.*, l.title AS listing_title, l.images AS listing_images "
        "FROM promotions p JOIN listings l ON l.id = p.listing_id "
        "WHERE p.user_id = ? ORDER BY p.created_at DESC", (u["id"],))
    out = []
    for r in rows:
        r = dict(r)
        raw = json.loads(r.get("listing_images") or "[]")
        r["listing_images"] = resolve_images_list(raw) if raw else []
        out.append(r)
    return ok(out)


@app.route("/api/promotions/purchase", methods=["POST"])
def purchase_promotion():
    u = require_auth()
    body = request.get_json(silent=True) or {}
    lid = body.get("listing_id")
    row = query("SELECT * FROM listings WHERE id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    if row["user_id"] != u["id"] and not u["is_admin"]:
        return err("Not allowed", 403)
    ptype = (body.get("type") or "").strip()
    packages = {p["type"]: p for p in promotion_prices()}
    if ptype not in packages:
        return err("Invalid promotion type")
    pkg = packages[ptype]
    txn = f"LL-{secrets.token_hex(6).upper()}"
    pid = execute(
        "INSERT INTO payments (transaction_id, user_id, amount, currency, package, package_name, listing_id, status, provider, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?, 'pending', 'manual', ?, ?)",
        (txn, u["id"], pkg["price"], "LKR", ptype, pkg["name"], lid, now(), now()))
    return ok({"payment_id": pid, "transaction_id": txn, "package": pkg})


def _apply_promotion_from_payment(payment, pkg=None):
    """Activate a promotion package once its payment is successful."""
    if payment["listing_id"]:
        pkg = pkg or next((p for p in promotion_prices() if p["type"] == payment["package"]), None)
        if pkg:
            starts = now()
            ends = starts + pkg["duration_days"] * 86400
            execute(
                "INSERT INTO promotions (listing_id, user_id, ptype, package_name, price, duration_days, payment_id, starts_at, ends_at, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (payment["listing_id"], payment["user_id"], payment["package"], pkg["name"],
                 payment["amount"], pkg["duration_days"], payment["id"], starts, ends, starts))
            apply_promotion(payment["listing_id"], payment["package"], pkg["duration_days"])
            row = query("SELECT title FROM listings WHERE id = ?", (payment["listing_id"],), one=True)
            notify(payment["user_id"], "promotion", "Promotion active",
                   f"Your “{row['title']}” is now boosted ({pkg['name']}).", f"#/ads/{payment['listing_id']}")


@app.route("/api/payments/<int:pid>/simulate", methods=["POST"])
def simulate_payment(pid):
    """Dev-only helper: mark a manual payment successful and apply its promotion."""
    u = require_auth()
    pay = query("SELECT * FROM payments WHERE id = ?", (pid,), one=True)
    if not pay:
        return err("Payment not found", 404)
    if pay["user_id"] != u["id"] and not u["is_admin"]:
        return err("Not allowed", 403)
    if pay["status"] == "successful":
        return ok({"id": pid, "status": "successful"})
    execute("UPDATE payments SET status = 'successful', updated_at = ? WHERE id = ?", (now(), pid))
    _apply_promotion_from_payment(pay)
    return ok({"id": pid, "status": "successful"})


@app.route("/api/payments/webhook", methods=["POST"])
def payment_webhook():
    """Generic payment-provider webhook. Verifies a shared secret from settings, then
    updates the payment by transaction_id and applies the promotion on success.

    A Sri Lankan provider (PayHere, etc.) can be wired in by configuring
    `payment_webhook_secret` and posting {transaction_id, status} here.
    """
    secret = get_setting("payment_webhook_secret", "")
    if not secret:
        return err("Payment provider not configured", 503)
    provided = request.headers.get("X-Payment-Signature", "") or request.headers.get("X-Webhook-Secret", "")
    if not hmac_compare(provided, secret):
        return err("Invalid signature", 401)
    body = request.get_json(silent=True) or {}
    txn = (body.get("transaction_id") or body.get("order_id") or "").strip()
    status = (body.get("status") or body.get("state") or "").strip().lower()
    if not txn:
        return err("Missing transaction_id", 400)
    pay = query("SELECT * FROM payments WHERE transaction_id = ?", (txn,), one=True)
    if not pay:
        return err("Unknown transaction", 404)
    if status in PAYMENT_STATUSES:
        execute("UPDATE payments SET status = ?, updated_at = ? WHERE id = ?", (status, now(), pay["id"]))
    if status == "successful" and pay["status"] != "successful":
        _apply_promotion_from_payment(pay)
    return ok({"acknowledged": True})


@app.route("/api/me/payments")
def my_payments():
    u = require_auth()
    rows = query("SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC", (u["id"],))
    return ok(rows)


# ---------------------------------------------------------------------------
# Admin API (Part 3)
# ---------------------------------------------------------------------------
def admin_user_payload(u):
    p = user_payload(u)
    p["status"] = u.get("status") or "active"
    return p


@app.route("/api/admin/dashboard")
def admin_dashboard():
    require_admin()
    expire_overdue()
    counts = {}
    for name, sql in [
        ("users", "SELECT COUNT(*) n FROM users"),
        ("active_listings", "SELECT COUNT(*) n FROM listings WHERE status = 'active'"),
        ("pending_listings", "SELECT COUNT(*) n FROM listings WHERE status = 'pending'"),
        ("sold_listings", "SELECT COUNT(*) n FROM listings WHERE status = 'sold'"),
        ("shops", "SELECT COUNT(*) n FROM businesses"),
        ("reports_open", "SELECT COUNT(*) n FROM reports WHERE status = 'open'"),
        ("messages", "SELECT COUNT(*) n FROM messages"),
        ("promotions", "SELECT COUNT(*) n FROM promotions"),
        ("shops_verified", "SELECT COUNT(*) n FROM businesses WHERE verified = 1"),
        ("shops_pending", "SELECT COUNT(*) n FROM businesses WHERE verification_status = 'pending'"),
    ]:
        counts[name] = query(sql, one=True)["n"]
    revenue = query(
        "SELECT COALESCE(SUM(amount), 0) s FROM payments WHERE status IN ('successful','processing')", one=True)["s"]
    counts["revenue"] = revenue
    counts["payments"] = query("SELECT COUNT(*) n FROM payments", one=True)["n"]
    recent_users = query("SELECT * FROM users ORDER BY created_at DESC LIMIT 5")
    recent_reports = query(
        "SELECT r.*, l.title AS listing_title FROM reports r LEFT JOIN listings l ON l.id = r.listing_id "
        "ORDER BY r.created_at DESC LIMIT 5")
    recent_payments = query("SELECT * FROM payments ORDER BY created_at DESC LIMIT 5")
    pending = query(listing_query_base() + " WHERE l.status = 'pending' ORDER BY l.created_at DESC LIMIT 8")
    pending_biz = query(
        "SELECT b.*, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone "
        "FROM businesses b JOIN users u ON u.id = b.user_id "
        "WHERE b.verification_status = 'pending' ORDER BY b.submitted_at DESC LIMIT 8")
    pending_biz_out = []
    for b in pending_biz:
        item = business_payload(b)
        item["owner"] = {"id": b["user_id"], "name": b["owner_name"] or "",
                         "email": b["owner_email"] or "", "phone": b["owner_phone"] or ""}
        pending_biz_out.append(item)
    return ok({
        "counts": counts,
        "recent_users": [admin_user_payload(u) for u in recent_users],
        "recent_reports": recent_reports,
        "recent_payments": recent_payments,
        "pending": [serialize_listing(r, include_seller=False) for r in pending],
        "pending_businesses": pending_biz_out,
    })


@app.route("/api/admin/users")
def admin_users():
    require_admin()
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip()
    sql = "SELECT * FROM users"
    conds, params = [], []
    if q:
        like = f"%{q}%"
        conds.append("(name LIKE ? OR email LIKE ? OR phone LIKE ?)")
        params += [like, like, like]
    if status and status != "all":
        conds.append("status = ?")
        params.append(status)
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY created_at DESC LIMIT 200"
    rows = query(sql, params)
    out = []
    for u in rows:
        p = admin_user_payload(u)
        p["listing_count"] = query("SELECT COUNT(*) n FROM listings WHERE user_id = ?", (u["id"],), one=True)["n"]
        out.append(p)
    return ok(out)


@app.route("/api/admin/users/<int:uid>")
def admin_user_detail(uid):
    require_admin()
    u = query("SELECT * FROM users WHERE id = ?", (uid,), one=True)
    if not u:
        return err("User not found", 404)
    listings = query(listing_query_base() + " WHERE l.user_id = ? ORDER BY l.created_at DESC", (uid,))
    biz = query("SELECT * FROM businesses WHERE user_id = ?", (uid,), one=True)
    activity = {
        "listings": len(listings),
        "favorites": query("SELECT COUNT(*) n FROM favorites WHERE user_id = ?", (uid,), one=True)["n"],
        "offers_made": query("SELECT COUNT(*) n FROM offers WHERE buyer_id = ?", (uid,), one=True)["n"],
        "offers_received": query("SELECT COUNT(*) n FROM offers WHERE seller_id = ?", (uid,), one=True)["n"],
        "messages_sent": query("SELECT COUNT(*) n FROM messages WHERE sender_id = ?", (uid,), one=True)["n"],
        "messages_received": query("SELECT COUNT(*) n FROM messages WHERE receiver_id = ?", (uid,), one=True)["n"],
        "reports_against": query("SELECT COUNT(*) n FROM reports r JOIN listings l ON l.id = r.listing_id WHERE l.user_id = ?", (uid,), one=True)["n"],
        "payments": query("SELECT COUNT(*) n FROM payments WHERE user_id = ?", (uid,), one=True)["n"],
    }
    return ok({
        "user": admin_user_payload(u),
        "business": dict(biz) if biz else None,
        "listings": serialize_listings(listings),
        "activity": activity,
    })


@app.route("/api/admin/users/<int:uid>", methods=["PATCH"])
def admin_update_user(uid):
    admin = require_admin()
    u = query("SELECT * FROM users WHERE id = ?", (uid,), one=True)
    if not u:
        return err("User not found", 404)
    if u["is_admin"] and u["id"] != admin["id"]:
        return err("You cannot modify another admin", 403)
    body = request.get_json(silent=True) or {}
    action = (body.get("action") or "").strip()
    if action == "verify":
        execute("UPDATE users SET verified = 1 WHERE id = ?", (uid,))
        notify(uid, "listing", "Account verified", "Your Lanka Lens account is now verified.", "#/settings")
        audit(admin["id"], "verify", "user", uid, "verified seller")
    elif action == "unverify":
        execute("UPDATE users SET verified = 0 WHERE id = ?", (uid,))
        audit(admin["id"], "unverify", "user", uid)
    elif action == "suspend":
        execute("UPDATE users SET status = 'suspended' WHERE id = ?", (uid,))
        execute("UPDATE listings SET status = 'paused' WHERE user_id = ? AND status = 'active'", (uid,))
        execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        audit(admin["id"], "suspend", "user", uid)
    elif action == "ban":
        execute("UPDATE users SET status = 'banned' WHERE id = ?", (uid,))
        execute("UPDATE listings SET status = 'paused' WHERE user_id = ? AND status = 'active'", (uid,))
        execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        if u.get("email"):
            execute("INSERT INTO banned_emails (email, created_at) VALUES (?,?) ON CONFLICT DO NOTHING", (u["email"], now()))
        audit(admin["id"], "ban", "user", uid)
    elif action == "activate":
        execute("UPDATE users SET status = 'active' WHERE id = ?", (uid,))
        if u.get("email"):
            execute("DELETE FROM banned_emails WHERE email = ?", (u["email"],))
        audit(admin["id"], "activate", "user", uid)
    else:
        return err("Unknown action")
    return ok({"user": admin_user_payload(query("SELECT * FROM users WHERE id = ?", (uid,), one=True))})


@app.route("/api/admin/users/<int:uid>", methods=["DELETE"])
def admin_delete_user(uid):
    admin = require_admin()
    u = query("SELECT * FROM users WHERE id = ?", (uid,), one=True)
    if not u:
        return err("User not found", 404)
    if u["is_admin"]:
        return err("You cannot delete an admin", 403)
    audit(admin["id"], "delete", "user", uid, u["email"])
    execute("DELETE FROM users WHERE id = ?", (uid,))
    return ok({"deleted": uid})


# ---------------------------------------------------------------------------
# Admin — business / shop verification
# ---------------------------------------------------------------------------
@app.route("/api/admin/businesses")
def admin_businesses():
    admin = require_admin()
    status = (request.args.get("status") or "").strip()
    sql = ("SELECT b.*, u.name AS owner_name_db, u.email AS owner_email, u.phone AS owner_phone "
           "FROM businesses b JOIN users u ON u.id = b.user_id")
    args = ()
    # "all" (and no value) means no filter — bind it literally and the query
    # would match zero rows, leaving the admin Businesses list empty.
    if status and status != "all":
        sql += " WHERE b.verification_status = ?"
        args = (status,)
    sql += " ORDER BY CASE b.verification_status WHEN 'pending' THEN 0 " \
           "WHEN 'rejected' THEN 1 WHEN 'not_submitted' THEN 2 ELSE 3 END, b.name"
    rows = query(sql, args)
    out = []
    for b in rows:
        item = business_payload(b)
        item["owner"] = {
            "id": b["user_id"], "name": b["owner_name_db"] or "",
            "email": b["owner_email"] or "", "phone": b["owner_phone"] or "",
        }
        item["listing_count"] = query(
            "SELECT COUNT(*) n FROM listings WHERE user_id = ? AND status = 'active'",
            (b["user_id"],), one=True)["n"]
        out.append(item)
    return ok(out)


@app.route("/api/admin/businesses/<int:bid>/moderate", methods=["POST"])
def admin_moderate_business(bid):
    """Approve / reject / revoke a shop's verification. The only path that can
    grant (or remove) the verified badge."""
    admin = require_admin()
    b = query("SELECT * FROM businesses WHERE id = ?", (bid,), one=True)
    if not b:
        return err("Shop not found", 404)
    body = request.get_json(silent=True) or {}
    action = (body.get("action") or "").strip()
    reason = (body.get("reason") or "").strip()[:500]
    if action == "approve":
        if b["verification_status"] == "approved":
            return err("Shop is already verified", 400)
        if not (b["document"] or "").strip():
            return err("This shop has no supporting document on file", 400)
        execute(
            "UPDATE businesses SET verification_status='approved', verified=1, reviewed_at=?, "
            "rejection_reason='' WHERE id=?", (now(), bid))
        execute("UPDATE users SET verified = 1 WHERE id = ?", (b["user_id"],))
        notify(b["user_id"], "listing", "Shop verified",
               f"Your shop “{b['name']}” has been verified. Your public shop page is now live "
               "with the verified badge.", "#/my-shop")
        audit(admin["id"], "approve", "business", bid, b["name"])
    elif action == "reject":
        if b["verification_status"] == "rejected":
            return err("Shop is already rejected", 400)
        if not reason:
            return err("A rejection reason is required", 400)
        execute(
            "UPDATE businesses SET verification_status='rejected', verified=0, reviewed_at=?, "
            "rejection_reason=? WHERE id=?", (now(), reason, bid))
        notify(b["user_id"], "listing", "Shop verification rejected",
               f"Your shop “{b['name']}” could not be verified: {reason}. "
               "You can fix the details and submit again from My Shop.", "#/my-shop")
        audit(admin["id"], "reject", "business", bid, f"{b['name']} — {reason}")
    elif action == "revoke":
        if b["verification_status"] != "approved":
            return err("Only a verified shop can be revoked", 400)
        if not reason:
            return err("A reason is required", 400)
        execute(
            "UPDATE businesses SET verification_status='not_submitted', verified=0, reviewed_at=NULL, "
            "rejection_reason=? WHERE id=?", (reason, bid))
        execute("UPDATE users SET verified = 0 WHERE id = ?", (b["user_id"],))
        notify(b["user_id"], "listing", "Shop verification revoked",
               f"Your shop “{b['name']}” is no longer verified: {reason}", "#/my-shop")
        audit(admin["id"], "revoke", "business", bid, f"{b['name']} — {reason}")
    else:
        return err("Unknown action")
    b = query("SELECT * FROM businesses WHERE id = ?", (bid,), one=True)
    return ok(business_payload(b))


@app.route("/api/admin/listings")
def admin_listings():
    require_admin()
    q = (request.args.get("q") or "").strip()
    status = (request.args.get("status") or "").strip()
    sql = listing_query_base()
    conds, params = [], []
    if q:
        like = f"%{q}%"
        conds.append("(l.title LIKE ? OR l.brand LIKE ? OR l.model LIKE ?)")
        params += [like, like, like]
    if status and status != "all":
        conds.append("l.status = ?")
        params.append(status)
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY l.created_at DESC LIMIT 300"
    rows = query(sql, params)
    out = []
    for r in rows:
        d = serialize_listing(r, include_seller=False)
        seller = query("SELECT id, name, email FROM users WHERE id = ?", (r["user_id"],), one=True)
        d["seller"] = seller
        out.append(d)
    return ok(out)


@app.route("/api/admin/listings/<int:lid>/moderate", methods=["POST"])
def admin_moderate_listing(lid):
    admin = require_admin()
    row = query("SELECT * FROM listings WHERE id = ?", (lid,), one=True)
    if not row:
        return err("Listing not found", 404)
    body = request.get_json(silent=True) or {}
    action = (body.get("action") or "").strip()
    reason = (body.get("reason") or "").strip()
    if action == "approve":
        expiry = row["expiry_at"] or (now() + expiry_days() * 86400)
        execute("UPDATE listings SET status = 'active', rejection_reason = '', expiry_at = ?, updated_at = ? WHERE id = ?",
                (expiry, now(), lid))
        notify(row["user_id"], "listing", "Listing approved",
               f"“{row['title']}” was approved and is now live.", f"#/ads/{lid}")
        audit(admin["id"], "approve", "listing", lid)
    elif action == "reject":
        execute("UPDATE listings SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?",
                (reason[:500], now(), lid))
        notify(row["user_id"], "listing", "Listing rejected",
               f"“{row['title']}” was rejected. Reason: {reason or 'Does not meet our guidelines'}",
               f"#/edit-ad/{lid}")
        audit(admin["id"], "reject", "listing", lid, reason)
    elif action == "suspend":
        execute("UPDATE listings SET status = 'paused', updated_at = ? WHERE id = ?", (now(), lid))
        notify(row["user_id"], "listing", "Listing suspended",
               f"“{row['title']}” was temporarily suspended by our team.", f"#/my-ads")
        audit(admin["id"], "suspend_listing", "listing", lid, reason)
    elif action == "feature":
        execute("UPDATE listings SET featured = 1, updated_at = ? WHERE id = ?", (now(), lid))
        notify(row["user_id"], "promotion", "Listing featured",
               f"“{row['title']}” is now featured on the homepage.", f"#/ads/{lid}")
        audit(admin["id"], "feature", "listing", lid)
    elif action == "unfeature":
        execute("UPDATE listings SET featured = 0, updated_at = ? WHERE id = ?", (now(), lid))
        audit(admin["id"], "unfeature", "listing", lid)
    elif action == "mark_sold":
        execute("UPDATE listings SET status = 'sold', updated_at = ? WHERE id = ?", (now(), lid))
        audit(admin["id"], "mark_sold", "listing", lid)
    else:
        return err("Unknown action")
    return ok({"id": lid, "action": action})


@app.route("/api/admin/reports")
def admin_reports():
    require_admin()
    status = (request.args.get("status") or "").strip()
    sql = (
        "SELECT r.*, l.title AS listing_title, l.status AS listing_status, l.user_id AS listing_owner, "
        "u.name AS reporter_name FROM reports r "
        "LEFT JOIN listings l ON l.id = r.listing_id "
        "LEFT JOIN users u ON u.id = r.reporter_id ")
    conds, params = [], []
    if status and status != "all":
        conds.append("r.status = ?")
        params.append(status)
    if conds:
        sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 300"
    return ok(query(sql, params))


@app.route("/api/admin/reports/<int:rid>/resolve", methods=["POST"])
def admin_resolve_report(rid):
    admin = require_admin()
    r = query("SELECT * FROM reports WHERE id = ?", (rid,), one=True)
    if not r:
        return err("Report not found", 404)
    body = request.get_json(silent=True) or {}
    resolution = (body.get("resolution") or "Resolved").strip()
    action = (body.get("action") or "none").strip()
    if action == "remove_listing" and r["listing_id"]:
        execute("DELETE FROM listings WHERE id = ?", (r["listing_id"],))
        audit(admin["id"], "remove_listing_from_report", "listing", r["listing_id"], resolution)
    elif action == "suspend_seller" and r["listing_id"]:
        owner = query("SELECT user_id FROM listings WHERE id = ?", (r["listing_id"],), one=True)
        if owner:
            execute("UPDATE users SET status = 'suspended' WHERE id = ?", (owner["user_id"],))
            execute("UPDATE listings SET status = 'paused' WHERE user_id = ? AND status = 'active'", (owner["user_id"],))
            audit(admin["id"], "suspend_from_report", "user", owner["user_id"], resolution)
    execute("UPDATE reports SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?",
            (resolution[:500], admin["id"], now(), rid))
    audit(admin["id"], "resolve_report", "report", rid, resolution)
    return ok({"id": rid, "status": "resolved"})


@app.route("/api/admin/audit")
def admin_audit():
    require_admin()
    rows = query(
        "SELECT a.*, u.name AS admin_name FROM audit_logs a LEFT JOIN users u ON u.id = a.admin_id "
        "ORDER BY a.created_at DESC LIMIT 200")
    return ok(rows)


# ---------------------------------------------------------------------------
# Admin — brands & models
# ---------------------------------------------------------------------------
@app.route("/api/admin/brands", methods=["GET", "POST"])
def admin_brands():
    require_admin()
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        name = (body.get("name") or "").strip()
        if not name:
            return err("Name required")
        bid = execute("INSERT INTO brands (name, category) VALUES (?,?)", (name, body.get("category") or ""))
        return ok({"id": bid})
    rows = query("SELECT * FROM brands ORDER BY name")
    out = []
    for b in rows:
        b = dict(b)
        b["models"] = query("SELECT * FROM models WHERE brand_id = ? ORDER BY name", (b["id"],))
        out.append(b)
    return ok(out)


@app.route("/api/admin/brands/<int:bid>", methods=["PATCH", "DELETE"])
def admin_brand(bid):
    admin = require_admin()
    if request.method == "DELETE":
        execute("DELETE FROM brands WHERE id = ?", (bid,))
        audit(admin["id"], "delete_brand", "brand", bid)
        return ok({"deleted": bid})
    body = request.get_json(silent=True) or {}
    if body.get("name"):
        execute("UPDATE brands SET name = ? WHERE id = ?", (body["name"].strip(), bid))
    if "category" in body:
        execute("UPDATE brands SET category = ? WHERE id = ?", ((body["category"] or "").strip(), bid))
    return ok({"id": bid})


@app.route("/api/admin/models", methods=["POST"])
def admin_add_model():
    require_admin()
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return err("Name required")
    mid = execute("INSERT INTO models (brand_id, name, category) VALUES (?,?,?)",
                  (body.get("brand_id"), name, body.get("category") or ""))
    return ok({"id": mid})


@app.route("/api/admin/models/<int:mid>", methods=["PATCH", "DELETE"])
def admin_model(mid):
    admin = require_admin()
    if request.method == "DELETE":
        execute("DELETE FROM models WHERE id = ?", (mid,))
        audit(admin["id"], "delete_model", "model", mid)
        return ok({"deleted": mid})
    body = request.get_json(silent=True) or {}
    if body.get("name"):
        execute("UPDATE models SET name = ? WHERE id = ?", (body["name"].strip(), mid))
    if "brand_id" in body:
        execute("UPDATE models SET brand_id = ? WHERE id = ?", (body["brand_id"], mid))
    if "category" in body:
        execute("UPDATE models SET category = ? WHERE id = ?", ((body["category"] or "").strip(), mid))
    return ok({"id": mid})


# ---------------------------------------------------------------------------
# Admin — locations (province / district / city)
# ---------------------------------------------------------------------------
@app.route("/api/admin/provinces", methods=["POST"])
def admin_add_province():
    require_admin()
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return err("Name required")
    pid = execute("INSERT INTO provinces (name) VALUES (?)", (name,))
    return ok({"id": pid})


@app.route("/api/admin/provinces/<int:pid>", methods=["PATCH", "DELETE"])
def admin_province(pid):
    require_admin()
    if request.method == "DELETE":
        execute("DELETE FROM provinces WHERE id = ?", (pid,))
        return ok({"deleted": pid})
    body = request.get_json(silent=True) or {}
    if body.get("name"):
        execute("UPDATE provinces SET name = ? WHERE id = ?", (body["name"].strip(), pid))
    return ok({"id": pid})


@app.route("/api/admin/districts", methods=["POST"])
def admin_add_district():
    require_admin()
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name or not body.get("province_id"):
        return err("Name and province required")
    did = execute("INSERT INTO districts (province_id, name) VALUES (?,?)", (body["province_id"], name))
    return ok({"id": did})


@app.route("/api/admin/districts/<int:did>", methods=["PATCH", "DELETE"])
def admin_district(did):
    require_admin()
    if request.method == "DELETE":
        execute("DELETE FROM districts WHERE id = ?", (did,))
        return ok({"deleted": did})
    body = request.get_json(silent=True) or {}
    if body.get("name"):
        execute("UPDATE districts SET name = ? WHERE id = ?", (body["name"].strip(), did))
    if "province_id" in body:
        execute("UPDATE districts SET province_id = ? WHERE id = ?", (body["province_id"], did))
    return ok({"id": did})


@app.route("/api/admin/cities", methods=["POST"])
def admin_add_city():
    require_admin()
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name or not body.get("district_id"):
        return err("Name and district required")
    cid = execute("INSERT INTO cities (district_id, name) VALUES (?,?)", (body["district_id"], name))
    return ok({"id": cid})


@app.route("/api/admin/cities/<int:cid>", methods=["PATCH", "DELETE"])
def admin_city(cid):
    require_admin()
    if request.method == "DELETE":
        execute("DELETE FROM cities WHERE id = ?", (cid,))
        return ok({"deleted": cid})
    body = request.get_json(silent=True) or {}
    if body.get("name"):
        execute("UPDATE cities SET name = ? WHERE id = ?", (body["name"].strip(), cid))
    if "district_id" in body:
        execute("UPDATE cities SET district_id = ? WHERE id = ?", (body["district_id"], cid))
    return ok({"id": cid})


# ---------------------------------------------------------------------------
# Admin — settings
# ---------------------------------------------------------------------------
ADMIN_SETTINGS_KEYS = [
    "site_name", "tagline", "logo", "contact_email", "contact_phone", "contact_address",
    "max_listings_per_user", "max_images_per_listing", "listing_expiry_days",
    "require_approval", "verification_required_to_sell", "homepage_banners",
    "footer_text", "social_facebook", "social_instagram", "social_youtube",
    "payment_webhook_secret",
    "promo_featured_price", "promo_featured_days",
    "promo_boost_price", "promo_boost_days",
    "promo_homepage_price", "promo_homepage_days",
    "promo_urgent_price", "promo_urgent_days",
]


@app.route("/api/admin/settings", methods=["GET", "PUT"])
def admin_settings():
    require_admin()
    if request.method == "GET":
        return ok({"settings": get_settings(), "promotions": promotion_prices()})
    body = request.get_json(silent=True) or {}
    for key in ADMIN_SETTINGS_KEYS:
        if key in body:
            val = body[key]
            # Enforce hard cap of 3 for image limit per listing (task requirement)
            if key == "max_images_per_listing":
                try:
                    iv = int(val)
                    if iv > 3:
                        iv = 3
                    if iv < 1:
                        iv = 1
                    val = str(iv)
                except (TypeError, ValueError):
                    val = "3"
            set_setting(key, val)
    return ok({"settings": get_settings(), "promotions": promotion_prices()})


# ---------------------------------------------------------------------------
# Admin — payments & promotions
# ---------------------------------------------------------------------------
@app.route("/api/admin/payments")
def admin_payments():
    require_admin()
    rows = query(
        "SELECT p.*, u.name AS user_name, u.email AS user_email FROM payments p "
        "LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 300")
    return ok(rows)


@app.route("/api/admin/promotions")
def admin_promotions():
    require_admin()
    rows = query(
        "SELECT p.*, l.title AS listing_title, u.name AS user_name FROM promotions p "
        "LEFT JOIN listings l ON l.id = p.listing_id LEFT JOIN users u ON u.id = p.user_id "
        "ORDER BY p.created_at DESC LIMIT 300")
    return ok(rows)


# ---------------------------------------------------------------------------
# Admin — blog posts (content management)
# ---------------------------------------------------------------------------
@app.route("/api/admin/posts", methods=["POST"])
def admin_add_post():
    admin = require_admin()
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    if not title:
        return err("Title required")
    slug = slugify(body.get("slug") or title)
    base = slug
    i = 2
    while query("SELECT id FROM posts WHERE slug = ?", (slug,), one=True):
        slug = f"{base}-{i}"
        i += 1
    pid = execute(
        "INSERT INTO posts (slug, title, category, excerpt, body, image, author, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (slug, title, body.get("category") or "Guide", body.get("excerpt") or "", body.get("body") or "",
         body.get("image") or "", body.get("author") or "Lanka Lens", now()))
    audit(admin["id"], "create_post", "post", pid, title)
    return ok({"id": pid, "slug": slug})


@app.route("/api/admin/posts/<int:pid>", methods=["PATCH", "DELETE"])
def admin_post(pid):
    admin = require_admin()
    if request.method == "DELETE":
        execute("DELETE FROM posts WHERE id = ?", (pid,))
        audit(admin["id"], "delete_post", "post", pid)
        return ok({"deleted": pid})
    body = request.get_json(silent=True) or {}
    sets, params = [], []
    for col in ("title", "category", "excerpt", "body", "image", "author"):
        if col in body:
            sets.append(f"{col} = ?")
            params.append(body[col])
    if body.get("slug"):
        sets.append("slug = ?")
        params.append(slugify(body["slug"]))
    if sets:
        execute(f"UPDATE posts SET {', '.join(sets)} WHERE id = ?", params + [pid])
    audit(admin["id"], "update_post", "post", pid)
    return ok({"id": pid})


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------
def seed():
    """Explicit local demo data only. Never called at startup or in production."""
    if database.is_postgres or database.production:
        raise RuntimeError("Demo data is available only in local SQLite development")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    create_indexes(conn)

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

    # Locations are inserted by the explicit init-empty command, never at boot.

    if conn.execute("SELECT COUNT(*) FROM brands").fetchone()[0] == 0:
        for name, cat in BRANDS:
            conn.execute("INSERT INTO brands (name, category) VALUES (?,?)", (name, cat))
        conn.commit()

    if conn.execute("SELECT COUNT(*) FROM site_settings").fetchone()[0] == 0:
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute("INSERT INTO site_settings (key, value) VALUES (?,?)", (k, str(v)))
        conn.commit()

    if conn.execute("SELECT COUNT(*) FROM models").fetchone()[0] == 0:
        brand_ids = {r["name"]: r["id"] for r in [dict(x) for x in conn.execute("SELECT id, name FROM brands")]}
        models = [
            ("Sony", "A7 III", "Cameras"), ("Sony", "A7 IV", "Cameras"), ("Sony", "A6400", "Cameras"),
            ("Sony", "A7R V", "Cameras"), ("Sony", "A1", "Cameras"),
            ("Canon", "5D Mark IV", "Cameras"), ("Canon", "EOS R6", "Cameras"), ("Canon", "90D", "Cameras"),
            ("Canon", "Rebel T7", "Cameras"), ("Canon", "G7 X Mark II", "Cameras"),
            ("Nikon", "D850", "Cameras"), ("Nikon", "Z6 II", "Cameras"), ("Nikon", "Z50", "Cameras"),
            ("Fujifilm", "X-T4", "Cameras"), ("Fujifilm", "X-T5", "Cameras"), ("Fujifilm", "X-S10", "Cameras"),
            ("Panasonic", "GH5 II", "Cameras"), ("Panasonic", "S5", "Cameras"),
            ("GoPro", "HERO13 Black", "Action Cameras"), ("GoPro", "HERO12 Black", "Action Cameras"),
            ("GoPro", "HERO7 White", "Action Cameras"),
            ("DJI", "Osmo Action 4", "Action Cameras"), ("DJI", "Mini 3", "Drones"),
            ("DJI", "Air 3", "Drones"), ("DJI", "Mavic Air 2", "Drones"),
            ("Insta360", "X5", "Action Cameras"), ("Autel", "EVO Nano+", "Drones"),
            ("Sigma", "35mm f/1.4 Art", "Lenses"), ("Tamron", "70-200mm f/2.8 G2", "Lenses"),
        ]
        for bname, mname, cat in models:
            bid = brand_ids.get(bname)
            conn.execute("INSERT INTO models (brand_id, name, category) VALUES (?,?,?)", (bid, mname, cat))
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
            ("Ruwan Bandara", "ruwan@lankalens.lk", "password123", "+94 71 888 2244", "Central Province", "Kandy", "Kandy", 1, 0,
             "business", "Owner of Kandy Photo Store. Full-service camera store in the hill country."),
            ("Sakunthala Ramanan", "sakunthala@lankalens.lk", "password123", "+94 77 555 6677", "Northern Province", "Jaffna", "Jaffna", 0, 0,
             "business", "Runs Jaffna Photo Works — everything for photographers up north."),
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
        weekday = {"mon": "9:00 AM – 6:00 PM", "tue": "9:00 AM – 6:00 PM", "wed": "9:00 AM – 6:00 PM",
                   "thu": "9:00 AM – 6:00 PM", "fri": "9:00 AM – 6:00 PM", "sat": "9:00 AM – 4:00 PM",
                   "sun": "Closed"}
        biz = [
            ("ishara@lankalens.lk", "Colombo Camera House", "colombo-camera-house", "/images/shops/shop-1.jpg",
             "Authorised dealer for Sony, Canon and Fujifilm. Trade-ins, repairs and rentals welcome.",
             "Colombo 04", "Colombo", "Colombo", "Western Province",
             "+94 11 250 4400", "94112504400", 1, weekday),
            ("ruwan@lankalens.lk", "Kandy Photo Store", "kandy-photo-store", "/images/shops/shop-2.jpg",
             "Full-service camera store in Kandy. Sales, repairs, rentals and printing.",
             "Peradeniya Road", "Kandy", "Kandy", "Central Province",
             "+94 81 223 5112", "94812235112", 1, weekday),
            ("sakunthala@lankalens.lk", "Jaffna Photo Works", "jaffna-photo-works", "/images/shops/shop-3.jpg",
             "Everything for photographers in the Northern Province — cameras, lenses and printing.",
             "Hospital Road", "Jaffna", "Jaffna", "Northern Province",
             "+94 21 222 3315", "94212223315", 0, weekday),
        ]
        for email, name, slug, logo, desc, area, city, district, province, phone, wa, verified, hours in biz:
            owner = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if owner:
                conn.execute(
                    """INSERT INTO businesses (user_id, name, slug, logo, description, province, district, city, area,
                       phone, whatsapp, opening_hours, verified, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (owner["id"], name, slug, logo, desc, province, district, city, area,
                     phone, wa, json.dumps(hours), verified, now()))
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
            L("ruwan@lankalens.lk", "mirrorless", "Canon EOS R6 Mark II Mirrorless Body", 415000, "Like New",
              ["/images/products/canon-5d-1.jpg"],
              {"brand": "Canon", "model": "R6 Mark II", "year": "2023", "shutter_count": "6,800", "megapixels": "24.2 MP",
               "video_resolution": "4K 60p", "body_kit": "Body Only", "battery": "2 × LP-E6NH", "charger": "Yes",
               "original_box": "Yes", "warranty": "6 months", "receipt": "Yes",
               "reason_for_selling": "Shop trade-in, fully serviced."},
              desc="Shop trade-in Canon EOS R6 Mark II in like-new condition, serviced and checked by our technicians.",
              brand="Canon", model="R6 Mark II", year="2023"),
            L("ruwan@lankalens.lk", "lens-nikon", "Nikon Z 24-70mm f/4 S (Brand New)", 145000, "Brand New",
              ["/images/products/lens-canon-4.jpg"],
              {"brand": "Nikon", "model": "Z 24-70mm f/4 S", "mount": "Nikon Z", "focal_length": "24-70mm",
               "max_aperture": "f/4", "image_stabilization": "No", "autofocus": "Yes", "warranty": "1 year official",
               "receipt": "Yes"},
              desc="Brand new Nikon Z 24-70mm f/4 S with full official warranty and receipt.",
              brand="Nikon", model="Z 24-70mm f/4 S"),
            L("sakunthala@lankalens.lk", "mirrorless", "Nikon Z50 APS-C Mirrorless + 16-50mm Kit", 175000, "Good",
              ["/images/products/canon-rebel-1.jpg"],
              {"brand": "Nikon", "model": "Z50", "year": "2021", "shutter_count": "21,000", "megapixels": "20.9 MP",
               "video_resolution": "4K 30p", "body_kit": "Body + Kit Lens", "lens_included": "16-50mm",
               "battery": "1 × EN-EL25", "charger": "Yes", "original_box": "Yes", "warranty": "None", "receipt": "Yes",
               "reason_for_selling": "Customer upgrade."},
              desc="Nikon Z50 with 16-50mm kit lens in good condition. Great compact crop-sensor camera.",
              brand="Nikon", model="Z50", year="2021"),
            L("sakunthala@lankalens.lk", "tripods", "Manfrotto Befree Advanced Travel Tripod", 38000, "Excellent",
              ["/images/products/tripod-1.jpg"],
              {"brand": "Manfrotto", "model": "Befree Advanced", "compatibility": "Universal", "warranty": "3 months",
               "receipt": "Yes"},
              desc="Lightweight Manfrotto Befree Advanced travel tripod with ball head, in excellent condition.",
              brand="Manfrotto", model="Befree Advanced"),
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

    if conn.execute("SELECT COUNT(*) FROM posts").fetchone()[0] == 0:
        posts = [
            ("how-to-check-a-used-camera", "How to Check a Used DSLR Before You Buy",
             "Buying Guide",
             "A practical checklist for inspecting a second-hand DSLR — sensor, shutter count, body and every port.",
             "<p>Buying a used DSLR is the smartest way into photography on a budget, but a little checking goes a long way.</p>"
             "<h4>1. Inspect the sensor</h4><p>Set the camera to its smallest aperture (f/16–f/22), shoot a plain white wall and review the image. Dust, scratches and oil spots show up as dark marks.</p>"
             "<h4>2. Check the shutter count</h4><p>Most DSLR shutters are rated for 150,000–200,000 actuations. Ask for the count and factor a high number into your offer.</p>"
             "<h4>3. Check the mirror and viewfinder</h4><p>Look through the viewfinder for dust and haze, and check the reflex mirror for scratches. Pop the lens off and inspect the mount contacts.</p>"
             "<h4>4. Test every button and port</h4><p>Bring your own memory card and battery. Test the flash, hotshoe, HDMI, USB and headphone ports, plus every dial.</p>"
             "<h4>5. Ask for the box and receipt</h4><p>Original packaging, a receipt and any remaining warranty are strong signs the camera is genuine and well cared for.</p>",
             "/images/products/canon-5d-1.jpg", "Lanka Lens Team"),
            ("how-to-check-a-used-mirrorless", "How to Check a Used Mirrorless Camera",
             "Buying Guide",
             "Sensor, shutter, electronic viewfinder, IBIS and battery — the full checklist for a used mirrorless body.",
             "<p>Mirrorless cameras are largely electronic, so the checklist is a little different from a DSLR.</p>"
             "<h4>1. Sensor and stabilisation</h4><p>Shoot a white wall at a small aperture to reveal dust or scratches. If the body has IBIS, switch it on and confirm it engages with a short video clip.</p>"
             "<h4>2. Electronic viewfinder and LCD</h4><p>Look for dead pixels, burn-in and flicker. Check the rear LCD touch response and the tilt/flip mechanism.</p>"
             "<h4>3. Shutter and mechanical sound</h4><p>Fire a burst in both mechanical and electronic shutter modes and listen for anything unusual.</p>"
             "<h4>4. Battery and ports</h4><p>Used mirrorless bodies are hard on batteries — check for swelling. Test USB-C, HDMI and the headphone/mic jacks.</p>"
             "<h4>5. Firmware and mounts</h4><p>Confirm the latest firmware is installed and inspect the lens mount for wear or bent contacts.</p>",
             "/images/products/sony-a7iii-1.jpg", "Lanka Lens Team"),
            ("shutter-count-guide", "Shutter Count — What It Means and Why It Matters",
             "Buying Guide",
             "The single most important number when buying a used camera body. Here's how to read it.",
             "<p>Every mechanical shutter has a limited lifespan, so the shutter count is the odometer of a camera.</p>"
             "<h4>What's normal?</h4><p>Entry-level bodies are often rated for ~100,000 actuations, while professional bodies are rated 200,000–500,000. A camera under half its rating is a good buy.</p>"
             "<h4>How to check it</h4><p>Ask the seller for a shutter count reading, or use a free tool that reads the EXIF data of a recent unedited photo taken with the camera.</p>"
             "<h4>How it affects price</h4><p>A high shutter count doesn't mean the camera is about to die — but it should bring the price down. Use it as a negotiating point.</p>"
             "<h4>Cameras without a mechanical shutter</h4><p>Some bodies use electronic shutters that effectively don't wear out — ask which mode was mainly used.</p>",
             "/images/products/sony-a7iii-3.jpg", "Lanka Lens Team"),
            ("used-lens-buying-guide", "How to Inspect a Used Lens (Fungus, Haze & Sharpness)",
             "Buying Guide",
             "A step-by-step guide to checking glass, focus, zoom and mount before you pay for a second-hand lens.",
             "<p>A lens can look perfect from the outside and still hide fungus inside the glass. Inspect carefully.</p>"
             "<h4>1. Check for fungus and haze</h4><p>Shine a light through the lens at an angle. Fungus looks like fine spider webs; haze is a milky film. Both reduce contrast and are hard to remove.</p>"
             "<h4>2. Look for dust and scratches</h4><p>A few dust specks are normal and rarely affect photos, but deep scratches on the front or rear element will.</p>"
             "<h4>3. Run the focus and zoom rings</h4><p>Both should move smoothly with no grinding, looseness or stiff spots. Test autofocus on your body for speed and accuracy.</p>"
             "<h4>4. Check the aperture and contacts</h4><p>Stop the lens down and confirm the blades open and close smoothly without oil. Clean the electronic contacts and test on your own camera.</p>"
             "<h4>5. Test it wide open</h4><p>Shoot a few frames wide open and at a couple of focal lengths to check sharpness and autofocus calibration.</p>",
             "/images/products/lens-canon-1.jpg", "Lanka Lens Team"),
            ("gopro-buying-guide", "Buying a Used GoPro — What to Check",
             "Buying Guide",
             "Lens scratches, battery swelling, seals and mounts — the things that matter when buying a used GoPro.",
             "<p>GoPros lead a hard life, so a used one deserves a careful inspection.</p>"
             "<h4>1. Inspect the lens cover</h4><p>The lens cover is replaceable on most models, but scratches on the sensor lens itself are permanent. Look carefully with a light.</p>"
             "<h4>2. Check the battery</h4><p>GoPro batteries swell with age — if the battery doesn't slide in and out easily, walk away. Ask how long a full charge lasts.</p>"
             "<h4>3. Check the seals</h4><p>If you plan to use it in water, the door seals must be clean and intact. Ask whether it has been used underwater and how it was cleaned afterwards.</p>"
             "<h4>4. Test the screens and ports</h4><p>Power it on, record a short clip, check the touchscreen and both USB-C and the door latch.</p>"
             "<h4>5. Verify the model</h4><p>Older models are often resold as newer ones. Check the model number in the settings or on the box.</p>",
             "/images/products/gopro-1.jpg", "Lanka Lens Team"),
            ("dji-action-camera-guide", "Buying a Used DJI Action Camera (Osmo Action)",
             "Buying Guide",
             "Lens, screens, magnetic mounts and waterproofing — a checklist for used DJI Osmo Action cameras.",
             "<p>DJI's Osmo Action cameras are tough, but a few checks will protect you from a bad buy.</p>"
             "<h4>1. Check both screens</h4><p>The Osmo Action's big selling point is its dual touchscreens — verify both respond and have no dead pixels or cracks.</p>"
             "<h4>2. Lens and housing</h4><p>Look for scratches on the front lens element. Test the magnetic quick-release mount and the protective housing.</p>"
             "<h4>3. Waterproofing</h4><p>Check the battery door and port covers are intact. Ask about any water exposure and how it was rinsed afterwards.</p>"
             "<h4>4. Batteries and charging</h4><p>Confirm the battery charges fully and the charging hub (if included) works with all batteries.</p>"
             "<h4>5. Test stabilisation</h4><p>Record a short walking clip and confirm RockSteady stabilisation is smooth without jitter.</p>",
             "/images/products/osmo-1.jpg", "Lanka Lens Team"),
            ("drone-inspection-guide", "How to Inspect a Used Drone Before You Buy",
             "Buying Guide",
             "Motors, gimbal, batteries, props and flight logs — the full pre-purchase checklist for a used drone.",
             "<p>A used drone can be a brilliant deal or an expensive paperweight. Inspect it like a pilot would.</p>"
             "<h4>1. Check the gimbal</h4><p>Power it on and watch the gimbal self-calibrate smoothly. Any grinding, twitching or error messages are red flags.</p>"
             "<h4>2. Inspect motors and props</h4><p>Spin each motor by hand — it should be smooth with no grinding. Check the arms and body for cracks, and props for chips.</p>"
             "<h4>3. Batteries</h4><p>Ask for the cycle count and check for swelling. Batteries are often the most expensive part of a used drone kit.</p>"
             "<h4>4. Flight logs and history</h4><p>Ask whether it has been crashed. Flight logs in the app can reveal hard landings and error history.</p>"
             "<h4>5. Do a test flight</h4><p>If possible, hover it briefly to confirm stable flight, GPS lock and a clean camera feed. Always follow local drone rules.</p>",
             "/images/products/drone-1.jpg", "Lanka Lens Team"),
            ("used-camera-buying-tips-sri-lanka", "Used Camera Buying Tips for Sri Lanka",
             "Buying Guide",
             "Local advice for buying second-hand gear in Sri Lanka — meet-ups, pricing, warranties and avoiding scams.",
             "<p>Buying used camera gear in Sri Lanka is popular and generally safe — if you follow a few local ground rules.</p>"
             "<h4>1. Meet in a public place</h4><p>Coffee shops, shopping malls or a camera store counter are ideal. Avoid inviting strangers home, and avoid going alone to unfamiliar areas.</p>"
             "<h4>2. Compare prices first</h4><p>Check what similar models sell for on Lanka Lens and in Colombo's camera shops so you know a fair price in rupees.</p>"
             "<h4>3. Ask about import history</h4><p>Many bodies come in as grey imports. Ask for the receipt and any remaining local or international warranty.</p>"
             "<h4>4. Test before you pay</h4><p>Bring a memory card and battery, shoot test frames, and check the shutter count. Pay only after you are satisfied.</p>"
             "<h4>5. Never pay in advance</h4><p>No deposits, no 'shipping fees', no courier stories. And never share your OTP, PIN or online banking passwords with anyone.</p>",
             "/images/products/fuji-xt4-1.jpg", "Lanka Lens Team"),
            ("mirrorless-vs-dslr", "Mirrorless vs DSLR — Which Should You Buy?",
             "Buying Guide",
             "The mirrorless vs DSLR debate is mostly settled, but each still has its place. Here's how to decide.",
             "<p>Mirrorless cameras now dominate new sales, but DSLRs remain brilliant value on the used market.</p>"
             "<h4>Go mirrorless if…</h4><p>You want silent shooting, in-viewfinder previews, better video and the newest lens mounts. Autofocus eye-tracking is superb.</p>"
             "<h4>Go DSLR if…</h4><p>You want maximum battery life, an optical viewfinder and cheap, abundant used lenses.</p>"
             "<h4>The real decision</h4><p>Your budget and lens needs matter more than the body. Invest in good glass — it holds its value far better than bodies.</p>",
             "/images/products/fuji-xt4-2.jpg", "Lanka Lens Team"),
            ("best-lenses-for-sri-lanka-travel", "Best Lenses for Sri Lanka Travel Photography",
             "Guides",
             "From misty tea hills to temple ceremonies and wild leopards — the lenses that cover it all.",
             "<p>Sri Lanka packs beaches, wildlife and culture into a small island. A versatile kit covers all three.</p>"
             "<h4>The all-rounder</h4><p>A 24-70mm f/2.8 (or f/4) zoom handles streets, portraits and landscapes in one lens.</p>"
             "<h4>For wildlife</h4><p>Yala and Wilpattu demand reach: a 70-200mm or 100-400mm is essential for leopards and birds.</p>"
             "<h4>For low light</h4><p>Temple interiors and sunset shoots call for a fast prime — a 35mm or 50mm f/1.8 is affordable and small.</p>",
             "/images/products/lens-canon-2.jpg", "Lanka Lens Team"),
            ("drone-laws-sri-lanka", "Flying a Drone in Sri Lanka — The Rules You Need to Know",
             "Guides",
             "Drone rules in Sri Lanka — a quick, plain-language summary for hobbyists and creators.",
             "<p>Drones under 250g are generally the easiest to fly legally for recreation.</p>"
             "<h4>Registration</h4><p>Recreational drones above 250g may need registration with the Civil Aviation Authority of Sri Lanka (CAASL).</p>"
             "<h4>Where not to fly</h4><p>Stay away from airports, military areas and government buildings. Avoid crowds and respect people's privacy.</p>"
             "<h4>Fly safe</h4><p>Keep the drone within visual line of sight and avoid flying in strong coastal winds. Always check the latest CAASL guidance before you fly.</p>",
             "/images/products/drone-2.jpg", "Lanka Lens Team"),
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
# Read-only readiness check. A missing/unmigrated DB stops deployment; it never
# creates an empty replacement. See docs/database-persistence.md before cutover.
database.check_ready()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
