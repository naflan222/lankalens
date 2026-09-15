"""Validation and normalization for public business social profile links."""
from urllib.parse import urlsplit, urlunsplit

SOCIAL_HOSTS = {
    "facebook": {"facebook.com", "www.facebook.com", "m.facebook.com"},
    "instagram": {"instagram.com", "www.instagram.com"},
}


def normalize_social_profile(value, platform):
    """Return a canonical HTTPS social profile URL or an empty string.

    Only official Facebook/Instagram hosts are accepted. This keeps user-supplied
    values from becoming arbitrary or javascript: links in public shop pages.
    """
    raw = (value or "").strip()
    if not raw:
        return ""
    if platform not in SOCIAL_HOSTS:
        raise ValueError("Unsupported social platform")
    if "://" not in raw:
        raw = "https://" + raw.lstrip("/")
    try:
        parsed = urlsplit(raw)
        host = (parsed.hostname or "").lower()
    except ValueError:
        raise ValueError("Invalid profile URL") from None
    if parsed.scheme.lower() not in ("http", "https") or host not in SOCIAL_HOSTS[platform]:
        label = "Facebook" if platform == "facebook" else "Instagram"
        raise ValueError(f"Enter a valid {label} profile URL")
    path = parsed.path or "/"
    if path == "/" and not parsed.query:
        label = "Facebook" if platform == "facebook" else "Instagram"
        raise ValueError(f"Enter the link to your {label} profile, not the homepage")
    # Always store HTTPS and discard fragments. Queries are retained because
    # Facebook still uses profile.php?id=... links for some pages/profiles.
    return urlunsplit(("https", host, path, parsed.query, ""))
