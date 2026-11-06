"""Registration and posting must work without the optional email provider."""
import sqlite3

from conftest import PASSWORD
from server.manage_db import LEDGER_DDL
from server.schema import SCHEMA_VERSION


def test_registered_users_can_publish_without_email_confirmation(legacy_sqlite, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("SQLITE_PATH", str(legacy_sqlite))
    with sqlite3.connect(legacy_sqlite) as db:
        db.execute(LEDGER_DDL)
        db.execute("INSERT INTO ll_schema_migrations VALUES (?,?,?,?)",
                   (SCHEMA_VERSION, "test-fixture", "{}", 0))
    from server import core_app as core
    from server.app import app
    from server.database import Database
    monkeypatch.setattr(core, "database", Database())
    def fail_if_email_sent(*args, **kwargs):
        raise AssertionError("Signup must not call the email provider")
    monkeypatch.setattr(core, "issue_email_otp", fail_if_email_sent)
    listing = {
        "title": "Camera ready for sale", "price": 150000, "category_id": 2,
        "condition": "Good", "province": "Western Province", "district": "Gampaha",
        "city": "Negombo", "images": ["/images/products/canon-5d-1.jpg"],
    }
    with app.test_client() as client:
        base = ""
        # Both signup paths (short mixed password and longer password) work with
        # no mail credentials, leave the email unverified, and issue no OTP.
        for kind, password in (("individual", "Abcd123!"), ("business", PASSWORD)):
            response = client.post(base + "/api/auth/signup", json={
                "name": "New Seller", "email": kind + "@example.test",
                "password": password, "seller_type": kind,
            })
            assert response.status_code == 200, response.text
            signup = response.get_json()["data"]
            assert signup["verification_sent"] is False
            assert signup["user"]["email_verified"] is False
            headers = {"Authorization": "Bearer " + signup["token"]}
            posted = client.post(base + "/api/listings", json=listing, headers=headers)
            assert posted.status_code == 200, posted.text
            assert posted.get_json()["data"]["status"] == "active"
            invalid = client.post(base + "/api/listings", json={}, headers=headers)
            assert invalid.status_code == 400
            with sqlite3.connect(legacy_sqlite) as db:
                assert db.execute("SELECT COUNT(*) FROM tokens WHERE user_id = ? AND kind = 'email_otp'",
                                  (signup["user"]["id"],)).fetchone()[0] == 0

        # An existing unverified user needs no migration or new account.
        login = client.post(base + "/api/auth/login", json={
            "email": "user42@example.test", "password": PASSWORD,
        }).get_json()["data"]
        assert login["user"]["email_verified"] is False
        headers = {"Authorization": "Bearer " + login["token"]}
        posted = client.post(base + "/api/listings", json=listing, headers=headers)
        assert posted.status_code == 200, posted.text
        assert client.post(base + "/api/listings", json=listing).status_code == 401
        for status in ("suspended", "banned"):
            with sqlite3.connect(legacy_sqlite) as db:
                db.execute("UPDATE users SET status = ? WHERE id = 42", (status,))
            assert client.post(base + "/api/listings", json=listing, headers=headers).status_code == 403
