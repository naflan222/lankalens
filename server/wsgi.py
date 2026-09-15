"""Production WSGI entrypoint with optional provider integrations installed."""
import importlib

core = importlib.import_module("server.app")
from server.payhere_integration import install as install_payhere

app = core.app
install_payhere(core)
