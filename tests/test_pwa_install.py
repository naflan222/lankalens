import json
from io import BytesIO
from pathlib import Path

from PIL import Image

from server.pwa import build_icon_bytes

ROOT = Path(__file__).resolve().parents[1]
INDEX = (ROOT / "index.html").read_text(encoding="utf-8")
MANIFEST_PATH = ROOT / "manifest.webmanifest"
SW_PATH = ROOT / "service-worker.js"
PWA_JS_PATH = ROOT / "js" / "pwa-install.js"
PWA_SERVER_PATH = ROOT / "server" / "pwa.py"
APP_PATH = ROOT / "server" / "app.py"
LOGO_PATH = ROOT / "images" / "Logo.png"


def test_pwa_files_exist_and_are_wired():
    assert MANIFEST_PATH.exists()
    assert SW_PATH.exists()
    assert PWA_JS_PATH.exists()
    assert PWA_SERVER_PATH.exists()
    assert LOGO_PATH.exists()
    assert 'rel="manifest" href="/manifest.webmanifest?v=3"' in INDEX
    assert 'href="/css/lankalens.css?v=20260918-3"' in INDEX
    assert '<meta name="theme-color" content="#074236">' in INDEX
    assert '<script src="/js/pwa-install.js"></script>' in INDEX
    assert "register_pwa_routes(app, core)" in APP_PATH.read_text(encoding="utf-8")


def test_manifest_has_installable_identity_and_raster_icons():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert manifest["name"] == "LankaLens"
    assert manifest["short_name"] == "LankaLens"
    assert manifest["start_url"] == "/"
    assert manifest["scope"] == "/"
    assert manifest["display"] == "standalone"
    assert manifest["theme_color"] == "#074236"
    assert manifest["prefer_related_applications"] is False

    icons = manifest["icons"]
    assert any(icon["src"].startswith("/icons/lankalens-192.png") and
               icon["sizes"] == "192x192" and icon["type"] == "image/png"
               for icon in icons)
    assert any(icon["src"].startswith("/icons/lankalens-512.png") and
               icon["sizes"] == "512x512" and icon["type"] == "image/png"
               for icon in icons)
    assert any(icon["src"].startswith("/icons/lankalens-maskable-512.png") and
               icon["sizes"] == "512x512" and icon["type"] == "image/png" and
               icon.get("purpose") == "maskable" for icon in icons)
    assert all(icon["type"] == "image/png" for icon in icons)


def test_generated_install_icons_are_real_square_pngs():
    for size, maskable in ((192, False), (512, False), (512, True)):
        payload = build_icon_bytes(str(ROOT), size, maskable)
        assert payload.startswith(b"\x89PNG\r\n\x1a\n")
        with Image.open(BytesIO(payload)) as image:
            assert image.format == "PNG"
            assert image.size == (size, size)
            assert image.mode == "RGB"


def test_production_routes_set_pwa_content_types_and_scope():
    source = PWA_SERVER_PATH.read_text(encoding="utf-8")
    assert '@app.get("/manifest.webmanifest"' in source
    assert 'mimetype="application/manifest+json"' in source
    assert '@app.get("/service-worker.js"' in source
    assert 'mimetype="application/javascript"' in source
    assert 'response.headers["Service-Worker-Allowed"] = "/"' in source
    assert '@app.get("/icons/lankalens-192.png"' in source
    assert '@app.get("/icons/lankalens-512.png"' in source
    assert '@app.get("/icons/lankalens-maskable-512.png"' in source


def test_service_worker_is_network_only_but_bypasses_external_resources():
    sw = SW_PATH.read_text(encoding="utf-8")
    pwa = PWA_JS_PATH.read_text(encoding="utf-8")
    assert "caches.open" not in sw
    assert "cache.put" not in sw
    assert "respondWith(fetch(event.request))" in sw
    assert "requestUrl.origin !== self.location.origin" in sw
    assert "return;" in sw
    assert "Backblaze B2" in sw
    assert "register('/service-worker.js?v=3'" in pwa
    assert "updateViaCache: 'none'" in pwa
    assert "registration.update()" in pwa
