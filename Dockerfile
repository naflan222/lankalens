# Railway production image: the Flask application serves both the SPA and /api.
# Do not replace this with a static-file server; /api/* must reach Gunicorn.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install runtime dependencies before copying application code for better build caching.
COPY server/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY . /app

# Railway supplies PORT at runtime. The shell form expands it while retaining a
# useful local-container default; railway.json supplies the same command.
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-8000} --workers 1 --threads 4 --access-logfile - --error-logfile - server.app:app"]
