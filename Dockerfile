# Single all-in-one image: one process (uvicorn) serves both the built SPA and
# the /api. Pull, run with CLICKHOUSE_* env, open the mapped port — done.
#
#   docker run -p 8088:8000 -e CLICKHOUSE_HOST=... ghcr.io/bun4uk/clickhouse-rmv-admin

# ---- frontend build ----
FROM node:22-alpine AS frontend
WORKDIR /fe
# .npmrc enforces ignore-scripts; install from the integrity-pinned lockfile.
COPY frontend/.npmrc frontend/package.json frontend/package-lock.json ./
RUN npm ci
# esbuild ships its binary via optionalDependencies but also has an install
# script we skip — rebuild only that explicitly-named, trusted package.
RUN npm rebuild esbuild 2>/dev/null || true
COPY frontend/ ./
RUN npm run build   # -> /fe/dist

# ---- runtime (FastAPI serves API + static SPA) ----
# Base image pinned by digest (tag can be re-pointed, digest can't).
FROM python:3.12-slim@sha256:d764629ce0ddd8c71fd371e9901efb324a95789d2315a47db7e4d27e78f1b0e9

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
# Built SPA — FastAPI mounts ./static at "/" when present.
COPY --from=frontend /fe/dist ./static

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/health').status==200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
