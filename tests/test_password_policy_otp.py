from pathlib import Path

from server.password_policy import password_policy_error


ROOT = Path(__file__).resolve().parents[1]


def test_password_policy_accepts_eight_character_mixed_password():
    assert password_policy_error("Abcd123!") is None


def test_password_policy_requires_every_character_class():
    for password in (
        "Abc12!",       # too short
        "abcd123!",     # no uppercase
        "ABCD123!",     # no lowercase
        "Abcdefg!",     # no number
        "Abcd1234",     # no symbol
        "Abcd123 ",     # whitespace is not a symbol
    ):
        assert password_policy_error(password)


def test_auth_entrypoint_replaces_all_password_creation_routes():
    server = (ROOT / "server" / "app.py").read_text(encoding="utf-8")
    assert 'app.view_functions["signup"]' in server
    assert 'app.view_functions["reset_password"]' in server
    assert 'app.view_functions["change_password"]' in server
    assert "password_policy_error" in server


def test_otp_dialog_cannot_be_dismissed_by_backdrop_touch():
    client = (ROOT / "js" / "auth-policy.js").read_text(encoding="utf-8")
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    assert 'src="/js/auth-policy.js"' in index
    assert "mask.removeAttribute('data-dialog-cancel')" in client
    assert "data-email-otp-verify" in client
    assert "data-auth-otp-close" in client
    assert "Minimum 8 characters: uppercase, lowercase, number and symbol." in client
