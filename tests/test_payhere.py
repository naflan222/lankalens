from server.payhere_integration import (
    _amount_text,
    _checkout_hash,
    _notification_hash,
    _status_from_code,
)


def test_amount_format_is_payhere_compatible():
    assert _amount_text(499) == "499.00"
    assert _amount_text(1000) == "1000.00"


def test_checkout_hash_is_stable_and_uppercase():
    value = _checkout_hash("1211149", "LL-ABC123", 499, "LKR", "merchant-secret")
    assert len(value) == 32
    assert value == value.upper()
    assert value == _checkout_hash("1211149", "LL-ABC123", 499, "LKR", "merchant-secret")


def test_notification_hash_changes_with_status():
    success = _notification_hash("1211149", "LL-ABC123", "499.00", "LKR", "2", "merchant-secret")
    failed = _notification_hash("1211149", "LL-ABC123", "499.00", "LKR", "-2", "merchant-secret")
    assert success != failed


def test_payhere_status_mapping():
    assert _status_from_code("2") == "successful"
    assert _status_from_code("0") == "processing"
    assert _status_from_code("-1") == "cancelled"
    assert _status_from_code("-2") == "failed"
    assert _status_from_code("-3") == "refunded"
