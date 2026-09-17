from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
LOGO = ROOT / "images" / "Logo.png"


def test_brand_logo_exists_for_mobile_shortcuts():
    assert LOGO.exists()
    assert LOGO.stat().st_size > 0


def test_index_uses_lankalens_logo_for_icons():
    assert '<meta name="application-name" content="LankaLens">' in INDEX
    assert '<meta name="apple-mobile-web-app-title" content="LankaLens">' in INDEX
    assert '<link rel="icon" type="image/png" href="/images/Logo.png?v=2">' in INDEX
    assert '<link rel="shortcut icon" type="image/png" href="/images/Logo.png?v=2">' in INDEX
    assert '<link rel="apple-touch-icon" href="/images/Logo.png?v=2">' in INDEX
    assert 'href="/favicon.svg"' not in INDEX
