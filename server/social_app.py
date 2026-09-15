"""Compatibility WSGI entrypoint for older Railway start commands.

Business social-profile routes now live directly in ``server.app`` so both
``server.app:app`` and ``server.social_app:app`` expose the same Flask app.
"""
from server.app import app

__all__ = ["app"]
