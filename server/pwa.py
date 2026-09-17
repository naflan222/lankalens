"""Production PWA asset helpers for LankaLens.

The install icons are generated as real square PNG responses from the existing
LankaLens brand logo. This avoids relying on an SVG that references another
image, which some Android/Chromium installability checks do not accept as an
install icon.
"""
from functools import lru_cache
from io import BytesIO
import os

from flask import send_file
from PIL import Image, ImageOps


@lru_cache(maxsize=3)
def build_icon_bytes(root, size, maskable=False):
    """Return a square PNG icon built from the repository's real LankaLens logo."""
    size = int(size)
    if size not in (192, 512):
        raise ValueError("Unsupported PWA icon size")

    logo_path = os.path.join(root, "images", "Logo.png")
    with Image.open(logo_path) as source:
        logo = source.convert("RGBA")

    # Android adaptive/maskable icons need a larger safe zone than normal icons.
    padding_ratio = 0.20 if maskable else 0.10
    padding = int(round(size * padding_ratio))
    target = (size - 2 * padding, size - 2 * padding)
    logo = ImageOps.contain(logo, target, method=Image.Resampling.LANCZOS)

    # A fully opaque square background is safer across Android launchers than
    # transparent edges, while preserving the original LankaLens logo itself.
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    x = (size - logo.width) // 2
    y = (size - logo.height) // 2
    canvas.alpha_composite(logo, (x, y))

    output = BytesIO()
    canvas.convert("RGB").save(output, format="PNG", optimize=True)
    return output.getvalue()


def register_pwa_routes(app, core):
    """Register explicit root-scoped PWA routes on the production Flask app."""

    @app.get("/manifest.webmanifest", endpoint="pwa_manifest")
    def pwa_manifest():
        response = core.send_from_directory(
            core.ROOT,
            "manifest.webmanifest",
            mimetype="application/manifest+json",
            max_age=0,
        )
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response

    @app.get("/service-worker.js", endpoint="pwa_service_worker")
    def pwa_service_worker():
        response = core.send_from_directory(
            core.ROOT,
            "service-worker.js",
            mimetype="application/javascript",
            max_age=0,
        )
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Service-Worker-Allowed"] = "/"
        return response

    def icon_response(size, maskable=False):
        payload = build_icon_bytes(core.ROOT, size, maskable)
        response = send_file(
            BytesIO(payload),
            mimetype="image/png",
            download_name=f"lankalens-{size}.png",
            max_age=604800,
        )
        response.headers["Cache-Control"] = "public, max-age=604800, immutable"
        return response

    @app.get("/icons/lankalens-192.png", endpoint="pwa_icon_192")
    def pwa_icon_192():
        return icon_response(192)

    @app.get("/icons/lankalens-512.png", endpoint="pwa_icon_512")
    def pwa_icon_512():
        return icon_response(512)

    @app.get("/icons/lankalens-maskable-512.png", endpoint="pwa_icon_maskable_512")
    def pwa_icon_maskable_512():
        return icon_response(512, maskable=True)
