"""Static regression checks for production security invariants."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = (ROOT / "server" / "app.py").read_text(encoding="utf-8")
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
