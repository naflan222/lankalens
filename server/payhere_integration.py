"""PayHere checkout integration for LankaLens promotion purchases.

This module is installed after ``server.app`` has finished defining its routes.
Keeping it separate lets the payment provider integration stay small and audited
without changing the large marketplace application module.
"""
import hashlib
import os
import secrets

from flask import request


def _md5_upper(value):
    return hashlib.md5(value.encode("utf-8")).hexdigest().upper()


def _amount_text(amount):
    return f"{int(amount):.2f}"


def _checkout_hash(merchant_id, order_id, amount, currency, merchant_secret):
    hashed_secret = _md5_upper(merchant_secret)
    return _md5_upper(
        f"{merchant_id}{order_id}{_amount_text(amount)}{currency}{hashed_secret}"
    )


def _notification_hash(merchant_id, order_id, amount_text, currency, status_code, merchant_secret):
    hashed_secret = _md5_upper(merchant_secret)
    return _md5_upper(
        f"{merchant_id}{order_id}{amount_text}{currency}{status_code}{hashed_secret}"
    )


def _truthy(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _payhere_config():
    merchant_id = os.environ.get("PAYHERE_MERCHANT_ID", "").strip()
    merchant_secret = os.environ.get("PAYHERE_MERCHANT_SECRET", "").strip()
    public_url = os.environ.get("LL_PUBLIC_URL", "").strip().rstrip("/")
    sandbox = _truthy(os.environ.get("PAYHERE_SANDBOX", "0"))
    checkout_url = (
        "https://sandbox.payhere.lk/pay/checkout"
        if sandbox else "https://www.payhere.lk/pay/checkout"
    )
    return merchant_id, merchant_secret, public_url, checkout_url, sandbox


def _split_name(name):
    parts = (name or "").strip().split(None, 1)
    first = parts[0] if parts else "Customer"
    last = parts[1] if len(parts) > 1 else "LankaLens"
    return first, last


def _status_from_code(code):
    return {
        "2": "successful",
        "0": "processing",
        "-1": "cancelled",
        "-2": "failed",
        "-3": "refunded",  # PayHere calls -3 a chargeback.
    }.get(str(code), "failed")


def install(core):
    """Install PayHere checkout and callback handling onto ``server.app``."""
    app = core.app
    if app.config.get("PAYHERE_INTEGRATION_INSTALLED"):
        return app
    app.config["PAYHERE_INTEGRATION_INSTALLED"] = True

    def checkout_payload(payment, user, package):
        merchant_id, merchant_secret, public_url, checkout_url, sandbox = _payhere_config()
        if not merchant_id or not merchant_secret or not public_url:
            return None

        first_name, last_name = _split_name(user.get("name"))
        phone = (user.get("phone") or user.get("whatsapp") or "").strip()
        city = (user.get("city") or user.get("district") or user.get("province") or "Colombo").strip()
        address = ", ".join(
            x for x in [user.get("city"), user.get("district"), user.get("province")] if x
        ) or "Sri Lanka"
        amount = _amount_text(payment["amount"])
        currency = payment.get("currency") or "LKR"
        order_id = payment["transaction_id"]
        fields = {
            "merchant_id": merchant_id,
            "return_url": f"{public_url}/#/my-ads?payment=returned&order={order_id}",
            "cancel_url": f"{public_url}/#/my-ads?payment=cancelled&order={order_id}",
            "notify_url": f"{public_url}/api/payments/payhere/notify",
            "first_name": first_name,
            "last_name": last_name,
            "email": (user.get("email") or "").strip(),
            "phone": phone,
            "address": address,
            "city": city,
            "country": "Sri Lanka",
            "order_id": order_id,
            "items": f"LankaLens {package['name']}",
            "currency": currency,
            "amount": amount,
            "custom_1": str(payment["id"]),
            "custom_2": payment.get("package") or "",
            "hash": _checkout_hash(merchant_id, order_id, payment["amount"], currency, merchant_secret),
        }
        return {"url": checkout_url, "fields": fields, "sandbox": sandbox}

    def purchase_promotion_payhere():
        user = core.require_auth()
        body = request.get_json(silent=True) or {}
        try:
            listing_id = int(body.get("listing_id"))
        except (TypeError, ValueError):
            return core.err("Invalid listing", 400)

        listing = core.query("SELECT * FROM listings WHERE id = ?", (listing_id,), one=True)
        if not listing:
            return core.err("Listing not found", 404)
        if listing["user_id"] != user["id"] and not user["is_admin"]:
            return core.err("Not allowed", 403)
        if listing.get("status") not in {"active", "pending"}:
            return core.err("Only active listings can be promoted", 409)

        ptype = (body.get("type") or "").strip()
        packages = {p["type"]: p for p in core.promotion_prices()}
        if ptype not in packages:
            return core.err("Invalid promotion type", 400)
        package = packages[ptype]

        merchant_id, merchant_secret, public_url, _, _ = _payhere_config()
        if not merchant_id or not merchant_secret or not public_url:
            return core.err("Online promotion payments are not configured yet", 503)

        if not (user.get("email") or "").strip():
            return core.err("Add an email address to your account before paying", 422)
        if not ((user.get("phone") or user.get("whatsapp") or "").strip()):
            return core.err("Add a phone number to your account before paying", 422)

        active = core.query(
            "SELECT id FROM promotions WHERE listing_id = ? AND ptype = ? "
            "AND (ends_at IS NULL OR ends_at >= ?) ORDER BY created_at DESC LIMIT 1",
            (listing_id, ptype, core.now()), one=True)
        if active:
            return core.err("This promotion is already active for this listing", 409)

        # Reuse a recent unfinished order rather than generating duplicate payment
        # requests when a seller double-taps Promote or refreshes the sheet.
        payment = core.query(
            "SELECT * FROM payments WHERE user_id = ? AND listing_id = ? AND package = ? "
            "AND status IN ('pending','processing') AND created_at >= ? "
            "ORDER BY created_at DESC LIMIT 1",
            (user["id"], listing_id, ptype, core.now() - 3600), one=True)
        if not payment:
            txn = f"LL-{secrets.token_hex(6).upper()}"
            payment_id = core.execute(
                "INSERT INTO payments (transaction_id, user_id, amount, currency, package, package_name, listing_id, status, provider, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?, 'pending', 'payhere', ?, ?)",
                (txn, user["id"], package["price"], "LKR", ptype, package["name"], listing_id, core.now(), core.now()))
            payment = core.query("SELECT * FROM payments WHERE id = ?", (payment_id,), one=True)

        checkout = checkout_payload(payment, user, package)
        return core.ok({
            "payment_id": payment["id"],
            "transaction_id": payment["transaction_id"],
            "package": package,
            "checkout": checkout,
        })

    # Replace the existing placeholder purchase handler while keeping the same URL.
    app.view_functions["purchase_promotion"] = purchase_promotion_payhere

    @app.route("/api/payments/payhere/notify", methods=["POST"])
    def payhere_notify():
        merchant_id, merchant_secret, _, _, _ = _payhere_config()
        if not merchant_id or not merchant_secret:
            return core.err("Payment provider not configured", 503)

        form = request.form
        callback_merchant = (form.get("merchant_id") or "").strip()
        order_id = (form.get("order_id") or "").strip()
        amount_text = (form.get("payhere_amount") or "").strip()
        currency = (form.get("payhere_currency") or "").strip().upper()
        status_code = (form.get("status_code") or "").strip()
        supplied_sig = (form.get("md5sig") or "").strip().upper()

        if not all([callback_merchant, order_id, amount_text, currency, status_code, supplied_sig]):
            return core.err("Invalid payment notification", 400)
        if callback_merchant != merchant_id:
            return core.err("Invalid merchant", 401)

        expected_sig = _notification_hash(
            callback_merchant, order_id, amount_text, currency, status_code, merchant_secret)
        if not secrets.compare_digest(expected_sig, supplied_sig):
            return core.err("Invalid payment signature", 401)

        payment = core.query("SELECT * FROM payments WHERE transaction_id = ?", (order_id,), one=True)
        if not payment or payment.get("provider") != "payhere":
            return core.err("Unknown transaction", 404)

        # Signature authenticity is not enough: also bind the callback to the exact
        # amount and currency that LankaLens created for this order.
        if currency != (payment.get("currency") or "LKR").upper():
            return core.err("Payment currency mismatch", 400)
        if amount_text != _amount_text(payment["amount"]):
            return core.err("Payment amount mismatch", 400)

        new_status = _status_from_code(status_code)
        was_successful = payment.get("status") == "successful"
        core.execute(
            "UPDATE payments SET status = ?, provider = 'payhere', updated_at = ? WHERE id = ?",
            (new_status, core.now(), payment["id"]))

        if new_status == "successful" and not was_successful:
            already = core.query(
                "SELECT id FROM promotions WHERE payment_id = ? LIMIT 1",
                (payment["id"],), one=True)
            if not already:
                core._apply_promotion_from_payment(payment)

        # PayHere only needs a normal 2xx response; do not echo callback details.
        return core.ok({"acknowledged": True})

    return app
