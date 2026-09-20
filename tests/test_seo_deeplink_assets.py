"""Regression checks for SEO deep-link static asset loading."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")


def test_css_and_javascript_assets_are_root_relative():
    refs = re.findall(r'(?:href|src)="([^"]+)"', INDEX)
    local_assets = [
        ref for ref in refs
        if ref.startswith(("css/", "js/"))
        or ref.startswith(("/css/", "/js/"))
    ]
    assert local_assets
    assert all(ref.startswith(("/css/", "/js/")) for ref in local_assets)


def test_listing_deep_links_do_not_resolve_assets_under_listing_path():
    assert 'href="css/' not in INDEX
    assert 'src="js/' not in INDEX
