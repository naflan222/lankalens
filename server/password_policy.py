"""Shared LankaLens password policy.

Passwords must be at least eight characters and contain all four character
classes requested by the product: uppercase, lowercase, number and symbol.
"""
import re

PASSWORD_POLICY_MESSAGE = (
    "Password must be at least 8 characters and include an uppercase letter, "
    "a lowercase letter, a number and a symbol"
)


def password_policy_error(password):
    """Return a user-facing error string, or ``None`` when the password is valid."""
    value = password or ""
    if len(value) < 8:
        return PASSWORD_POLICY_MESSAGE
    if not re.search(r"[A-Z]", value):
        return PASSWORD_POLICY_MESSAGE
    if not re.search(r"[a-z]", value):
        return PASSWORD_POLICY_MESSAGE
    if not re.search(r"[0-9]", value):
        return PASSWORD_POLICY_MESSAGE
    # Whitespace does not count as a symbol.
    if not re.search(r"[^A-Za-z0-9\s]", value):
        return PASSWORD_POLICY_MESSAGE
    return None
