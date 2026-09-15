# -*- coding: utf-8 -*-
"""Canonical LankaLens application entrypoint.

The original marketplace backend lives in ``server.core_app`` unchanged.  This
thin module re-exports it and registers the optional business social-profile
routes directly on the same Flask app.  Keeping these routes on ``server.app``
means they are available whether Railway starts ``server.app:app`` directly or
uses the repository startup script.
"""
import os
import sys

# Keep ``python server/app.py`` working as well as ``gunicorn server.app:app``.
if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import core_app as core
from server.social_profiles import normalize_social_profile

# Preserve the historical server.app module API, including private helpers used
# by regression tests and maintenance tooling, without duplicating the 200+ KB
# marketplace implementation.
for _name in dir(core):
    if not _name.startswith("__"):
        globals()[_name] = getattr(core, _name)

app = core.app


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
    """Read/update the signed-in business owner's Facebook/Instagram links.

    POST is accepted as a compatibility fallback for hosts/proxies that may have
    an old method policy cached; PUT remains the normal client method.
    """
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


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
