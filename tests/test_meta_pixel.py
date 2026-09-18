"""Regression checks for the LankaLens Meta Pixel integration."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIXEL_ID = "2295151224578176"


def test_meta_pixel_is_loaded_on_every_html_entrypoint():
    for filename in ("index.html", "privacy-policy.html", "refund-policy.html", "terms.html"):
        html = (ROOT / filename).read_text(encoding="utf-8")
        assert 'src="/js/meta-pixel.js"' in html
        assert f"tr?id={PIXEL_ID}&amp;ev=PageView&amp;noscript=1" in html


def test_meta_pixel_tracks_initial_and_spa_page_views():
    pixel = (ROOT / "js" / "meta-pixel.js").read_text(encoding="utf-8")
    assert f"fbq('init', '{PIXEL_ID}')" in pixel
    assert pixel.count("fbq('track', 'PageView')") == 2
    assert "window.addEventListener('hashchange'" in pixel


def test_csp_allows_only_the_required_meta_endpoints():
    server = (ROOT / "server" / "core_app.py").read_text(encoding="utf-8")
    assert "script-src 'self' https://connect.facebook.net" in server
    assert "connect-src 'self' https://www.facebook.com" in server
