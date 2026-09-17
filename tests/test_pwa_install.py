import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
MANIFEST_PATH = ROOT / "manifest.webmanifest"
SW_PATH = ROOT / "service-worker.js"
PWA_JS_PATH = ROOT / "js" / "pwa-install.js"
ICON_PATH = ROOT / "icons" / "lankalens-app-icon.svg"
LOGO_PATH = ROOT / "images" / "Logo.png"


def test_pwa_files_exist_and_are_wired():
    assert MANIFEST_PATH.exists()
    assert SW_PATH.exists()
    assert PWA_JS_PATH.exists()
    assert ICON_PATH.exists()
    assert LOGO_PATH.exists()
    assert 'rel="manifest" href="/manifest.webmanifest?v=1"' in INDEX
    assert '<script src="js/pwa-install.js"></script>' in INDEX


def test_manifest_has_installable_identity_and_icons():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert manifest["name"] == "LankaLens"
    assert manifest["short_name"] == "LankaLens"
    assert manifest["start_url"] == "/"
    assert manifest["scope"] == "/"
    assert manifest["display"] == "standalone"
    sizes = {icon["sizes"] for icon in manifest["icons"]}
    assert "192x192" in sizes
    assert "512x512" in sizes
    assert any(icon.get("purpose") == "maskable" for icon in manifest["icons"])


def test_install_icon_uses_real_lankalens_logo():
    icon = ICON_PATH.read_text(encoding="utf-8")
    assert "/images/Logo.png?v=2" in icon
    assert "512" in icon
    assert "/favicon.svg" not in INDEX


def test_service_worker_is_network_only_and_registered_at_root():
    sw = SW_PATH.read_text(encoding="utf-8")
    pwa = PWA_JS_PATH.read_text(encoding="utf-8")
    assert "caches.open" not in sw
    assert "cache.put" not in sw
    assert "respondWith(fetch(event.request))" in sw
    assert "register('/service-worker.js', { scope: '/' })" in pwa
