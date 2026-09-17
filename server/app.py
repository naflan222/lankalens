# -*- coding: utf-8 -*-
"""Canonical LankaLens application entrypoint.

The original marketplace backend lives in ``server.core_app`` unchanged.  This
thin module re-exports it and registers small additive production overrides on
the same Flask app. Keeping them on ``server.app`` means they are available
whether Railway starts ``server.app:app`` directly or uses the repository
startup script.
"""
import os
import sys

# Keep ``python server/app.py`` working as well as ``gunicorn server.app:app``.
if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import core_app as core
from server.password_policy import password_policy_error
from server.pwa import register_pwa_routes
from server.social_profiles import normalize_social_profile

# Preserve the historical server.app module API, including private helpers used
# by regression tests and maintenance tooling, without duplicating the 200+ KB
# marketplace implementation.
for _name in dir(core):
    if not _name.startswith("__"):
        globals()[_name] = getattr(core, _name)

app = core.app
register_pwa_routes(app, core)


def _social_key(business_id, platform):
    return f"business_social:{int(business_id)}:{platform}"


def _get_business_social(business_id):
    rows = core.query(
        "SELECT key, value FROM site_settings WHERE key IN (?, ?)",
        (_social_key(business_id, "facebook"), _social_key(business_id, "instagram")),
    )
    values = {row["key"]: row["value"] or "" for row in rows}
    return {
        "facebook_url": values.get(_social_key(business_id, "facebook"), ""),
        "instagram_url": values.get(_social_key(business_id, "instagram"), ""),
    }


def _save_business_social(business_id, facebook_url, instagram_url):
    for platform, value in (("facebook", facebook_url), ("instagram", instagram_url)):
        core.execute(
            "INSERT INTO site_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (_social_key(business_id, platform), value),
        )


@app.route("/api/me/business/social", methods=["GET", "PUT", "POST"])
def business_social_profiles():
    """Read/update the signed-in business owner's Facebook/Instagram links."""
    user = core.require_auth()
    business = core.query("SELECT id FROM businesses WHERE user_id = ?", (user["id"],), one=True)
    if not business:
        if core.request.method == "GET":
            return core.ok({"facebook_url": "", "instagram_url": ""})
        return core.err("Save your shop details before adding social profiles", 400)

    if core.request.method == "GET":
        return core.ok(_get_business_social(business["id"]))

    body = core.request.get_json(silent=True) or {}
    try:
        facebook = normalize_social_profile(body.get("facebook_url"), "facebook")
        instagram = normalize_social_profile(body.get("instagram_url"), "instagram")
    except ValueError as exc:
        return core.err(str(exc), 400)
    _save_business_social(business["id"], facebook, instagram)
    return core.ok({"facebook_url": facebook, "instagram_url": instagram})


@app.route("/api/business/<slug>/social")
def business_social_public(slug):
    business = core.query(
        "SELECT id, user_id, verified FROM businesses WHERE slug = ?", (slug,), one=True)
    if not business:
        return core.err("Shop not found", 404)
    if not business["verified"]:
        user = core.current_user()
        if not user or user["id"] != business["user_id"]:
            return core.err("Shop not found", 404)
    return core.ok(_get_business_social(business["id"]))


@app.route("/api/seller/<int:uid>/social")
def seller_social_public(uid):
    business = core.query(
        "SELECT id FROM businesses WHERE user_id = ? AND verified = 1", (uid,), one=True)
    if not business:
        return core.ok({"facebook_url": "", "instagram_url": ""})
    return core.ok(_get_business_social(business["id"]))


# ---------------------------------------------------------------------------
# Password policy route overrides
# ---------------------------------------------------------------------------
# The legacy handlers in core_app enforce only a 12-character minimum. Keep the
# rest of their battle-tested authentication/session behavior unchanged while
# replacing just the password acceptance rule requested by the product.
def _signup_with_password_policy():
    body, bad = core.json_body()
    if bad:
        return bad
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    missing = core.missing_fields_error(
        {"name": name, "email": email, "password": password}, "name", "email", "password")
    if missing:
        return missing
    if len(name) < 2:
        return core.err("Please enter your name")
    if not core.EMAIL_RE.match(email):
        return core.err("Please enter a valid email")
    policy_error = password_policy_error(password)
    if policy_error:
        return core.err(policy_error)
    if core.query("SELECT id FROM users WHERE email = ?", (email,), one=True):
        return core.err("An account with this email already exists", 409)
    if core.query("SELECT id FROM banned_emails WHERE email = ?", (email,), one=True):
        return core.err("This email is not allowed to register", 403)
    seller_type = body.get("seller_type") or "individual"
    if seller_type not in ("individual", "business"):
        seller_type = "individual"
    uid = core.execute(
        "INSERT INTO users (name, email, password_hash, phone, whatsapp, seller_type, email_verified, created_at) "
        "VALUES (?,?,?,?,?,?,0,?)",
        (name, email, core.hash_password(password), (body.get("phone") or "").strip(),
         (body.get("whatsapp") or "").strip(), seller_type, core.now()))
    token = core.secrets.token_urlsafe(32)
    core.execute("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
                 (core.token_digest(token), uid, core.now(), core.now() + core.SESSION_TTL_DAYS * 86400))
    user = core.query("SELECT * FROM users WHERE id = ?", (uid,), one=True)
    sent, otp = core.issue_email_otp(user)
    response = {"token": token, "user": core.user_payload(user), "verification_sent": sent}
    if sent and not core.database.production and os.environ.get("LL_ALLOW_DEV_TOKENS") == "1":
        response["dev"] = {"email_code": otp}
    return core.ok(response)


_signup_with_password_policy.__name__ = "signup"
app.view_functions["signup"] = core.rate_limit(10, 60)(_signup_with_password_policy)


def _reset_password_with_policy():
    body, bad = core.json_body()
    if bad:
        return bad
    token = (body.get("token") or "").strip()
    missing = core.missing_fields_error(
        {"token": token, "password": body.get("password")}, "token", "password")
    if missing:
        return missing
    row = core.consume_token(token, "reset")
    if not row:
        return core.err("This reset link is invalid or has expired", 400)
    new = (body.get("password") or "").strip()
    policy_error = password_policy_error(new)
    if policy_error:
        return core.err(policy_error)
    core.execute("UPDATE users SET password_hash = ? WHERE id = ?", (core.hash_password(new), row["user_id"]))
    core.execute("DELETE FROM tokens WHERE token = ? OR token = ?", (core.token_digest(token), token))
    core.execute("DELETE FROM sessions WHERE user_id = ?", (row["user_id"],))
    return core.ok({"reset": True})


_reset_password_with_policy.__name__ = "reset_password"
app.view_functions["reset_password"] = core.rate_limit(10, 300)(_reset_password_with_policy)


def _change_password_with_policy():
    user = core.require_auth()
    body = core.request.get_json(silent=True) or {}
    if not core.verify_password(body.get("old") or "", user["password_hash"]):
        return core.err("Current password is incorrect", 401)
    new = (body.get("new") or "").strip()
    policy_error = password_policy_error(new)
    if policy_error:
        return core.err(policy_error)
    core.execute("UPDATE users SET password_hash = ? WHERE id = ?", (core.hash_password(new), user["id"]))
    current = core.request_token()
    if current:
        digest = core.token_digest(current)
        core.execute("DELETE FROM sessions WHERE user_id = ? AND token NOT IN (?, ?)",
                     (user["id"], digest, current))
        core.execute("UPDATE sessions SET token = ? WHERE user_id = ? AND token = ?",
                     (digest, user["id"], current))
    else:
        core.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
    return core.ok({"changed": True})


_change_password_with_policy.__name__ = "change_password"
app.view_functions["change_password"] = _change_password_with_policy


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
