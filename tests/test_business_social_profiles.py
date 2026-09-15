from pathlib import Path

import pytest

from server.social_profiles import normalize_social_profile


ROOT = Path(__file__).resolve().parents[1]


def test_normalizes_official_social_profile_urls_to_https():
    assert normalize_social_profile("facebook.com/pixelhouse.lk", "facebook") == "https://facebook.com/pixelhouse.lk"
    assert normalize_social_profile("http://www.instagram.com/pixelhouse.lk/", "instagram") == "https://www.instagram.com/pixelhouse.lk/"


def test_shared_social_links_can_be_pasted_without_scheme():
    assert normalize_social_profile(
        "www.facebook.com/share/1RssajCqSc/", "facebook"
    ) == "https://www.facebook.com/share/1RssajCqSc/"
    assert normalize_social_profile(
        "www.instagram.com/pixelhouse.store?stkn=example", "instagram"
    ) == "https://www.instagram.com/pixelhouse.store?stkn=example"


def test_facebook_profile_php_query_is_preserved():
    value = "https://www.facebook.com/profile.php?id=12345#about"
    assert normalize_social_profile(value, "facebook") == "https://www.facebook.com/profile.php?id=12345"


@pytest.mark.parametrize(
    "value,platform",
    [
        ("javascript:alert(1)", "facebook"),
        ("https://facebook.com.evil.example/shop", "facebook"),
        ("https://evil.example/instagram.com/shop", "instagram"),
        ("https://instagram.com", "instagram"),
    ],
)
def test_rejects_non_profile_or_non_official_urls(value, platform):
    with pytest.raises(ValueError):
        normalize_social_profile(value, platform)


def test_frontend_loads_social_ui_and_public_icons():
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    script = (ROOT / "js" / "business-social.js").read_text(encoding="utf-8")
    assert 'src="js/business-social.js"' in index
    assert "/me/business/social" in script
    assert "method: 'POST'" in script
    assert "/social" in script
    assert "logo-facebook" in script
    assert "logo-instagram" in script
    assert "noopener noreferrer" in script


def test_main_app_registers_social_routes_directly():
    app_entry = (ROOT / "server" / "app.py").read_text(encoding="utf-8")
    assert '@app.route("/api/me/business/social", methods=["GET", "PUT", "POST"])' in app_entry
    assert '@app.route("/api/business/<slug>/social")' in app_entry
    assert '@app.route("/api/seller/<int:uid>/social")' in app_entry


def test_production_entrypoint_loads_social_compatible_app():
    entrypoint = (ROOT / "docker-entrypoint.sh").read_text(encoding="utf-8")
    social_app = (ROOT / "server" / "social_app.py").read_text(encoding="utf-8")
    assert "server.social_app:app" in entrypoint
    assert "from server.app import app" in social_app
