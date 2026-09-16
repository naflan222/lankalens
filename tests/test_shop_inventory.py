from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = (ROOT / "js" / "shop-inventory.js").read_text(encoding="utf-8")
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


def test_inventory_script_is_loaded():
    assert '<script src="js/shop-inventory.js"></script>' in INDEX


def test_inventory_reuses_existing_listing_api_and_statuses():
    assert "'/me/listings'" in JS
    assert "method: 'PATCH'" in JS
    assert "status: 'paused'" in JS
    assert "status: 'sold'" in JS
    assert "'/renew'" in JS


def test_inventory_is_scoped_to_my_shop_and_owner_actions():
    assert "currentPath() !== '/my-shop'" in JS
    assert "#shop-form" in JS
    assert "data-inventory-action" in JS
    assert "#/edit-ad/" in JS


def test_inventory_does_not_embed_credentials_or_payment_logic():
    lowered = JS.lower()
    assert "merchant_secret" not in lowered
    assert "payhere" not in lowered
    assert "password" not in lowered
