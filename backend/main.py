import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from clickhouse_client import ClickHouseError, clickhouse_client
from config import settings

app = FastAPI(title="RMV Admin API", version="0.1.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RefreshBody(BaseModel):
    cascade: bool = False
    wait: bool = False


def _handle(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ClickHouseError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/config")
async def get_config():
    """Frontend config: timezone for rendering, poll interval, scope."""
    return {
        "display_timezone": settings.display_timezone,
        "poll_interval_seconds": settings.poll_interval_seconds,
        "default_databases": settings.databases,
        "query_log_cluster": settings.query_log_cluster or None,
    }


@app.get("/api/views")
async def get_views():
    return {"views": _handle(clickhouse_client.list_views)}


@app.get("/api/views/{database}/{name}")
async def get_view(database: str, name: str):
    view = _handle(clickhouse_client.get_view, database, name)
    if view is None:
        raise HTTPException(status_code=404, detail="View not found")
    return view


@app.get("/api/views/{database}/{name}/history")
async def get_history(database: str, name: str, limit: int = 20):
    return _handle(clickhouse_client.get_history, database, name, limit)


@app.get("/api/graph")
async def get_graph():
    return _handle(clickhouse_client.get_graph)


@app.get("/api/status")
async def get_status():
    """Dashboard aggregates."""
    return _handle(clickhouse_client.get_dashboard)


@app.post("/api/views/{database}/{name}/refresh")
async def refresh(database: str, name: str, body: RefreshBody):
    if body.cascade:
        return _handle(clickhouse_client.refresh_cascade, database, name)
    result = _handle(clickhouse_client.refresh, database, name, body.wait)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "refresh failed"))
    return result


@app.post("/api/views/{database}/{name}/stop")
async def stop(database: str, name: str):
    return _handle(clickhouse_client.stop, database, name)


@app.post("/api/views/{database}/{name}/start")
async def start(database: str, name: str):
    return _handle(clickhouse_client.start, database, name)


@app.post("/api/views/{database}/{name}/cancel")
async def cancel(database: str, name: str):
    return _handle(clickhouse_client.cancel, database, name)


@app.get("/api/health")
async def health():
    try:
        clickhouse_client._ensure()
        clickhouse_client.client.query("SELECT 1")
        cols = clickhouse_client.describe_view_refreshes()
        return {
            "status": "healthy",
            "clickhouse": "connected",
            "view_refreshes_columns": len(cols),
        }
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}


# Serve the built frontend (single-image deployment): FastAPI serves the SPA
# and /api on the same origin/port. Mounted last so /api/* routes win. In local
# dev the SPA runs separately via Vite, so this only activates if the bundle exists.
_static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="spa")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
