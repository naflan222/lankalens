# Railway production image: the Flask application serves both the SPA and /api.
# Do not replace this with a static-file server; /api/* must reach Gunicorn.
FROM python:3.12-slim

ENV APP_ENV=production \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install runtime dependencies before copying application code for better build caching.
COPY server/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY . /app

# The image owns the startup gate: verify DATABASE_URL, wait for PostgreSQL,
# run the read-only schema gate, then `exec` Gunicorn as PID 1 (so Railway's
# SIGTERM drains gracefully). Keeping it in CMD means the ordering survives both
# plain container restarts and Railway's 2026-12-01 config-as-code cutoff;
# railway.json invokes this same script. Do not start gunicorn directly here —
# server.app refuses to boot against an unprepared database, and nothing would
# have prepared it. The script expands ${PORT:-8000} itself, which matters
# because a Railway start command runs in exec form and does not expand $PORT.
RUN chmod 0755 /app/docker-entrypoint.sh
CMD ["/bin/sh", "/app/docker-entrypoint.sh"]
