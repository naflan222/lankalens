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


def test_placeholder_brands_are_not_used_as_search_terms_or_product_brands():
    assert "SEO_PLACEHOLDER_BRANDS" in SERVER
    assert '"other", "others", "unbranded", "no brand", "no-brand"' in SERVER
    assert "def listing_seo_brand(l):" in SERVER
    assert "seo_brand = listing_seo_brand(l)" in SERVER
    assert "if seo_brand:" in SERVER
    assert "SEO_PLACEHOLDER_BRANDS" in CLIENT
    assert "function listingSeoBrand(l)" in CLIENT
    assert "var brand = listingSeoBrand(l);" in CLIENT


def test_listing_pages_link_verified_shops_and_related_gear():
    assert "seller_business = query(" in SERVER
    assert "WHERE user_id = ? AND verified = 1 LIMIT 1" in SERVER
    assert 'Sold by <a href="{base}/shop/' in SERVER
    assert "Related camera gear" in SERVER
    assert "AND l.category_id = ? AND l.id <> ?" in SERVER
    assert "listing_product_entity(l, canonical, cat_name, seller_business)" in SERVER
    assert 'product["offers"]["seller"]' in SERVER


def test_product_schema_uses_stable_and_real_identifiers_only():
    assert '"sku": f"LL-{l[\'id\']}"' in SERVER
    assert 'specs.get("gtin") or specs.get("barcode")' in SERVER
    assert "GTIN_LENGTHS = {8, 12, 13, 14}" in SERVER
    assert "if valid_gtin(gtin):" in SERVER
    assert 'specs.get("mpn")' in SERVER
    assert 'Never invent a GTIN/MPN just to silence a Search Console warning.' in SERVER



def test_listing_form_collects_optional_product_identifiers_without_new_layout_css():
    assert 'GTIN / Barcode <span class="muted">(optional)</span>' in CLIENT
    assert 'data-spec="gtin"' in CLIENT
    assert 'Manufacturer part number (MPN)' in CLIENT
    assert 'data-spec="mpn"' in CLIENT
    assert 'delete wz.specs.barcode;' in CLIENT
    assert 'GTIN / Barcode</span>' in CLIENT


def test_gtin_is_normalized_checksum_validated_and_only_then_published():
    assert "GTIN_LENGTHS = {8, 12, 13, 14}" in SERVER
    assert "def normalize_gtin(value):" in SERVER
    assert "def valid_gtin(value):" in SERVER
    assert 'return None, "GTIN / barcode must be a valid 8, 12, 13 or 14 digit barcode"' in SERVER
    assert 'if valid_gtin(gtin):' in SERVER
    assert 'product[f"gtin{len(gtin)}"] = gtin' in SERVER
    assert '("GTIN / Barcode", visible_gtin)' in SERVER
    assert '("MPN", _seo_clean(identifier_specs.get("mpn")))' in SERVER



def test_merchant_listing_shipping_and_returns_are_optional_truthful_and_visible():
    assert "def listing_shipping_details(specs):" in SERVER
    assert "def listing_return_policy(specs):" in SERVER
    assert '"addressCountry": "LK"' in SERVER
    assert '"currency": "LKR"' in SERVER
    assert 'product["offers"]["shippingDetails"] = shipping_details' in SERVER
    assert 'product["offers"]["hasMerchantReturnPolicy"] = return_policy' in SERVER
    assert "MerchantReturnFiniteReturnWindow" in SERVER
    assert "MerchantReturnNotPermitted" in SERVER
    assert "MerchantReturnUnlimitedWindow" in SERVER
    assert "Complete all delivery fields or leave all delivery fields blank" in SERVER
    assert "listing_policy_text(visible_policy)" in SERVER
    assert "Delivery &amp; Returns <span class=\"muted\">(optional)</span>" in CLIENT
    assert 'data-spec="shipping_rate_lkr"' in CLIENT
    assert 'data-spec="handling_min_days"' in CLIENT
    assert 'data-spec="handling_max_days"' in CLIENT
    assert 'data-spec="transit_min_days"' in CLIENT
    assert 'data-spec="transit_max_days"' in CLIENT
    assert 'data-spec="return_policy"' in CLIENT
    assert 'data-spec="return_days"' in CLIENT
    assert "Delivery &amp; Returns</h2>" in CLIENT



def test_shop_account_exposes_merchant_defaults_and_listings_inherit_them():
    assert "def merchant_policy_from_hours(value):" in SERVER
    assert '"merchant_policy": merchant_policy' in SERVER
    assert '"_merchant_policy"' in SERVER
    assert '"SELECT name, slug, opening_hours FROM businesses "' in SERVER
    assert "listing_shipping_details(business_policy)" in SERVER
    assert "listing_return_policy(business_policy)" in SERVER
    assert '"merchant_policy": merchant_policy_from_hours(biz.get("opening_hours"))' in SERVER
    assert "Merchant listing settings" in CLIENT
    assert 'name="merchant_shipping_rate_lkr"' in CLIENT
    assert 'name="merchant_handling_min_days"' in CLIENT
    assert 'name="merchant_handling_max_days"' in CLIENT
    assert 'name="merchant_transit_min_days"' in CLIENT
    assert 'name="merchant_transit_max_days"' in CLIENT
    assert 'name="merchant_return_policy"' in CLIENT
    assert 'name="merchant_return_days"' in CLIENT
    assert "merchant_policy: {" in CLIENT
    assert "Object.assign({}, (l.seller && l.seller.business && l.seller.business.merchant_policy) || {}, l.specs || {})" in CLIENT
