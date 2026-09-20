"""Static regression checks for production security invariants."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = "\n".join(
    path.read_text(encoding="utf-8")
    for path in (ROOT / "server" / "app.py", ROOT / "server" / "core_app.py")
)
CSS = (ROOT / "css" / "lankalens.css").read_text(encoding="utf-8")
REFERENCE_DATA = (ROOT / "server" / "reference_data.py").read_text(encoding="utf-8")
CLIENT = (ROOT / "js" / "app.js").read_text(encoding="utf-8")


def test_production_does_not_return_auth_secrets():
    assert '"reset_token": token' not in SERVER
    assert '"verify_email_token":' not in SERVER
    assert '"dev": {"code": otp}' in SERVER
    assert 'database.production or os.environ.get("LL_ALLOW_DEV_TOKENS") != "1"' in SERVER


def test_production_payment_shortcuts_are_closed():
    assert 'return err("Use the promotion purchase flow", 410)' in SERVER
    assert 'database.production or os.environ.get("LL_ALLOW_PAYMENT_SIMULATION") != "1"' in SERVER
    assert "api.post('/payments/' + r.payment_id + '/simulate')" not in CLIENT


def test_tokens_are_hashed_at_rest_and_password_reset_revokes_sessions():
    assert "def token_digest(token):" in SERVER
    assert "(token_digest(token), u[\"id\"]," in SERVER
    assert 'execute("DELETE FROM sessions WHERE user_id = ?", (row["user_id"],))' in SERVER


def test_browser_hardening_is_present():
    assert "Content-Security-Policy" in SERVER
    assert "Strict-Transport-Security" in SERVER
    assert "sanitizeRichHtml(p.body || '')" in CLIENT
    assert "sessSet('ll_token', d.token)" in CLIENT
    assert "storeSet('ll_token', d.token)" not in CLIENT


def test_no_database_or_storage_schema_change_is_required():
    schema = (ROOT / "server" / "schema.py").read_text(encoding="utf-8")
    assert "SCHEMA_VERSION = 1" in schema


def test_brevo_https_email_is_preferred_with_smtp_fallback():
    assert 'BREVO_EMAIL_API_URL = "https://api.brevo.com/v3/smtp/email"' in SERVER
    assert '"api-key": os.environ["BREVO_API_KEY"].strip()' in SERVER
    assert "if brevo_api_configured():" in SERVER
    assert "return brevo_api_configured() or smtp_configured()" in SERVER
    assert "if u and email_configured():" in SERVER


def test_verification_email_has_branded_html_and_plain_text_fallback():
    assert 'payload["htmlContent"] = html_content' in SERVER
    assert 'msg.add_alternative(html_content, subtype="html")' in SERVER
    assert 'def verification_email_html(code):' in SERVER
    assert 'Your LankaLens verification code' in SERVER
    assert 'LankaLens &bull; Sri Lanka&rsquo;s Camera Marketplace' in SERVER
    assert '/images/Logo.png?v=2' in SERVER
    assert 'payload["replyTo"] = {"email": reply_to}' in SERVER
    assert 'msg["Reply-To"] = reply_to' in SERVER


def test_optional_listing_contact_buttons_are_guarded():
    assert "if (whatsappButton) whatsappButton.addEventListener" in CLIENT
    assert "if (callButton) callButton.addEventListener" in CLIENT
    assert "$('#btn-wa').addEventListener" not in CLIENT
    assert "$('#btn-call').addEventListener" not in CLIENT


def test_bottom_sheet_opens_panel_and_overlay():
    assert "panel.classList.add('open')" in CLIENT
    assert "panel.classList.remove('open')" in CLIENT
    assert ".sheet.open" in CSS


def test_buying_guide_has_three_illustrated_practical_sections():
    assert CLIENT.count('class="guide-photo"') >= 3
    for image in (
        "/images/products/sony-a7iii-1.jpg",
        "/images/products/lens-canon-1.jpg",
        "/images/products/gopro-1.jpg",
    ):
        assert image in CLIENT
    assert ".guide-grid" in CSS
    assert ".guide-checklist" in CSS


def test_business_features_are_scoped_and_documents_are_optional():
    assert "state.user.seller_type === 'business'" in CLIENT
    assert "u.seller_type === 'business'" in CLIENT
    assert "Supporting business document" not in CLIENT
    assert 'missing.append("a supporting business document")' not in SERVER
    assert "This shop has no supporting document on file" not in SERVER


def test_business_owner_can_set_all_days_open_24_hours():
    assert "Open 24/7" in CLIENT
    assert "24 Hours Open" in CLIENT
    assert "DAYS.forEach" in CLIENT
    assert "field.value = '24 Hours Open'" in CLIENT


def test_contact_details_are_current():
    assert "support@lankalens.online" in CLIENT
    assert "+94 777 4666 75" in CLIENT
    assert "Tangalle, Sri Lanka" in CLIENT
    assert "hello@lankalens.lk" not in CLIENT


def test_locations_use_complete_application_catalogue():
    assert "PROVINCES" in SERVER
    assert "for province_name, districts in PROVINCES.items()" in SERVER
    for province in (
        "Western Province",
        "Central Province",
        "Southern Province",
        "North Western Province",
        "North Central Province",
        "Eastern Province",
        "Sabaragamuwa Province",
        "Uva Province",
        "Northern Province",
    ):
        assert province in REFERENCE_DATA


def test_email_otp_is_hashed_short_lived_and_required_for_posting():
    assert '"email_otp"' in SERVER
    assert 'value=token_digest(code), ttl=600' in SERVER
    assert 'secrets.compare_digest' in SERVER
    assert 'Verify your email before posting an ad' in SERVER
    assert 'showEmailOtpDialog' in CLIENT
    assert 'verify-home-banner' in CLIENT


def test_admin_can_inspect_contact_pin_and_delete():
    assert 'def admin_business_detail' in SERVER
    assert 'openAdminBusinessDetails' in CLIENT
    assert 'Message owner' in CLIENT
    assert 'pinned_shop_id' in SERVER
    assert 'Pin shop to top' in CLIENT
    assert 'data-mod="delete"' in CLIENT
    assert "api.del('/listings/' + lid)" in CLIENT


def test_admin_chat_is_available_only_to_business_accounts():
    assert 'def support_admin' in SERVER
    assert 'Admin messaging is available to business accounts only' in SERVER
    assert 'Only business accounts can message an administrator' in SERVER
    assert 'Message admin' in CLIENT


def test_home_has_builtin_buying_guides_when_posts_are_empty():
    assert 'builtInBuyingGuides' in CLIENT
    assert "posts = (posts && posts.length) ? posts : builtInBuyingGuides()" in CLIENT
    assert CLIENT.count("href: '#/buying-guide'") >= 3


def test_admin_dashboard_marks_business_users():
    assert "aChip('Business', '#9C4F96')" in CLIENT


def test_product_detail_does_not_render_breadcrumb_directory():
    assert 'aria-label="Breadcrumb"' not in CLIENT
    assert "var crumbs =" not in CLIENT
    assert "var ghtml = '<div class=\"gallery\">' +" in CLIENT


def test_seo_internal_links_use_clean_crawlable_urls():
    assert "def homepage_seo_body():" in SERVER
    assert '"body_html": homepage_seo_body()' in SERVER
    assert "def listing_public_path(listing):" in SERVER
    assert 'href="/category/' in SERVER
    assert 'href="/shop/' in SERVER
    assert 'href="/guide/' in SERVER
    assert "shop_listing_links" in SERVER
    assert "function listingPublicHref(l)" in CLIENT
    assert 'href="/shop/' in CLIENT
    assert 'href="/category/' in CLIENT
    assert "location.origin + listingPublicHref(l)" in CLIENT
