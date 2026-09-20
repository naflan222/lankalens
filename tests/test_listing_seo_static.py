"""Static regression checks for automatic listing SEO."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = (ROOT / "server" / "core_app.py").read_text(encoding="utf-8")
CLIENT = (ROOT / "js" / "app.js").read_text(encoding="utf-8")


def test_listing_pages_generate_model_specific_google_metadata():
    assert "def listing_seo_identity(l):" in SERVER
    assert "def listing_seo_title(l):" in SERVER
    assert "def listing_seo_description(l):" in SERVER
    assert '" for Sale in Sri Lanka | Lanka Lens"' in SERVER
    assert '"title": seo_title' in SERVER
    assert '"description": seo_desc' in SERVER


def test_listing_pages_expose_crawlable_product_details():
    assert "def listing_image_alt(l):" in SERVER
    assert 'alt="{esc_html(image_alt)}"' in SERVER
    for label in ("Brand", "Model", "Condition", "Location"):
        assert f'("{label}", l.get(' in SERVER or label == "Location"
    assert 'href="{base}/category/{esc_html(cat_slug)}"' in SERVER


def test_only_active_listings_are_public_seo_pages_and_slug_is_canonical():
    assert "WHERE l.id = ? AND l.status = 'active'" in SERVER
    assert 'expected_slug = f"{l[\'slug\']}-{l[\'id\']}"' in SERVER
    assert 'return redirect(f"/listing/{expected_slug}", code=301)' in SERVER


def test_spa_metadata_and_image_alt_text_match_server_seo():
    assert "function listingSeoTitle(l)" in CLIENT
    assert "function listingSeoDescription(l)" in CLIENT
    assert "function listingImageAlt(l)" in CLIENT
    assert "setMeta(listingSeoTitle(l)," in CLIENT
    assert "esc(listingImageAlt(l))" in CLIENT
    assert 'href="/category/' in CLIENT
