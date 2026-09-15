"""LankaLens application entrypoint with business social-profile routes.

This module wraps the existing Flask app without changing the marketplace's
core database schema. Social links are stored as namespaced site_settings keys,
which keeps the change additive and avoids touching existing shop rows.
"""
import os

from server import app as core
from server.social_profiles import normalize_social_profile

app = core.app


def _social_key(business_id, platform):
    return f"business_social:{int(business_id)}:{platform}"


def _get_social(business_id):
    rows = core.query(
        "SELECT key, value FROM site_settings WHERE key IN (?, ?)",
        (_social_key(business_id, "facebook"), _social_key(business_id, "instagram")),
    )
    values = {row["key"]: row["value"] or "" for row in rows}
    return {
        "facebook_url": values.get(_social_key(business_id, "facebook"), ""),
        "instagram_url": values.get(_social_key(business_id, "instagram"), ""),
    }


def _save_social(business_id, facebook_url, instagram_url):
    for platform, value in (("facebook", facebook_url), ("instagram", instagram_url)):
        core.execute(
            "INSERT INTO site_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (_social_key(business_id, platform), value),
        )


@app.route("/api/me/business/social", methods=["GET", "PUT"])
def my_business_social():
    user = core.require_auth()
    business = core.query("SELECT id FROM businesses WHERE user_id = ?", (user["id"],), one=True)
    if not business:
        if core.request.method == "GET":
            return core.ok({"facebook_url": "", "instagram_url": ""})
        return core.err("Save your shop details before adding social profiles", 400)

    if core.request.method == "GET":
        return core.ok(_get_social(business["id"]))

    body = core.request.get_json(silent=True) or {}
    try:
        facebook = normalize_social_profile(body.get("facebook_url"), "facebook")
        instagram = normalize_social_profile(body.get("instagram_url"), "instagram")
    except ValueError as exc:
        return core.err(str(exc), 400)
    _save_social(business["id"], facebook, instagram)
    return core.ok({"facebook_url": facebook, "instagram_url": instagram})


@app.route("/api/business/<slug>/social")
def public_business_social(slug):
    business = core.query(
        "SELECT id, user_id, verified FROM businesses WHERE slug = ?", (slug,), one=True)
    if not business:
        return core.err("Shop not found", 404)
    if not business["verified"]:
        user = core.current_user()
        if not user or user["id"] != business["user_id"]:
            return core.err("Shop not found", 404)
    return core.ok(_get_social(business["id"]))


@app.route("/api/seller/<int:uid>/social")
def public_seller_social(uid):
    business = core.query(
        "SELECT id FROM businesses WHERE user_id = ? AND verified = 1", (uid,), one=True)
    if not business:
        return core.ok({"facebook_url": "", "instagram_url": ""})
    return core.ok(_get_social(business["id"]))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
