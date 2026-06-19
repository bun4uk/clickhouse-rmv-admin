# RMV Admin — ClickHouse Refreshable Materialized Views

A small, self-hosted web UI to **visualize, monitor and control** [Refreshable Materialized Views](https://clickhouse.com/docs/materialized-view/refreshable-materialized-view) (RMV) in ClickHouse.

![MIT License](https://img.shields.io/badge/license-MIT-blue) ![ClickHouse 24.10+](https://img.shields.io/badge/ClickHouse-24.10%2B-yellow) ![Single image](https://img.shields.io/badge/deploy-single%20docker%20image-2496ED)

- 📊 **Dependency graph** of all RMVs (`DEPENDS ON` edges) with automatic layout
- 🟢 **Live status** for every refresh state — `Scheduled`, `Running`, `RunningOnAnotherReplica`, `WaitingForDependencies`, `MissingDependencies`, `Disabled` — plus a red **error** state derived from the last refresh's exception
- 🏷️ **REPLACE / APPEND** mode badge per view (with a warning before manually refreshing an APPEND view)
- 🎛️ **Actions**: Refresh (optionally waiting for completion), Stop, Start, Cancel, and a tool-side **cascade** refresh in dependency order
- 🧾 **Refresh history** reconstructed from `system.query_log`
- 📈 **Dashboard** with search and filters

Ships as **one Docker image** — pull, run, open. Validated live against ClickHouse **26.2** and **26.5**.

![RMV Admin — dependency graph, dashboard and the per-view details panel](docs/screenshot.png)

---

## Requirements

- **Docker** (with the Compose plugin) — that's all you need to run it.
- A **ClickHouse 24.10+** instance that has Refreshable Materialized Views (RMV became GA in 24.10). Self-hosted, a cluster, or ClickHouse Cloud all work. *(Not needed for the demo below — it bundles its own ClickHouse.)*

---

## Quick start

### Option A — Try the demo (no ClickHouse of your own needed)

This spins up ClickHouse **plus** the app, pre-loaded with example views so the graph isn't empty:

```bash
git clone https://github.com/bun4uk/clickhouse-rmv-admin.git
cd clickhouse-rmv-admin
docker compose up -d
```

Open **http://localhost:8088** — you'll see a dependency chain, an APPEND view, and one deliberately failing view. Click a node to open its details and try Refresh / Stop / Start / Cancel.

```bash
docker compose down -v     # stop and remove everything
```

### Option B — Run against your own ClickHouse

Pull the prebuilt single image and point it at your ClickHouse with env vars:

```bash
docker run -d --name rmv-admin -p 8088:8000 \
  -e CLICKHOUSE_HOST=your-clickhouse-host \
  -e CLICKHOUSE_PORT=8123 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD=your-password \
  ghcr.io/bun4uk/clickhouse-rmv-admin:latest
```

Then open **http://localhost:8088**.

The image is multi-arch (`linux/amd64`, `linux/arm64`) and available from either registry — use whichever you prefer:

```
ghcr.io/bun4uk/clickhouse-rmv-admin:latest      # GitHub Container Registry
docker.io/bun4uk/clickhouse-rmv-admin:latest    # Docker Hub  (short: bun4uk/clickhouse-rmv-admin)
```

Prefer Compose? Copy [`docker-compose.example.yml`](docker-compose.example.yml), fill in the `CLICKHOUSE_*` values, and `docker compose -f docker-compose.example.yml up -d`.

> **Tip:** before connecting to a production cluster, create a least-privilege service user — see [Service-user grants](#service-user-grants).

---

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `CLICKHOUSE_HOST` | `localhost` | ClickHouse host |
| `CLICKHOUSE_PORT` | `8123` | HTTP port (use `8443` for ClickHouse Cloud) |
| `CLICKHOUSE_USER` | `default` | Service user |
| `CLICKHOUSE_PASSWORD` | _(empty)_ | Service user password |
| `CLICKHOUSE_DATABASE` | `default` | Default database for the connection |
| `CLICKHOUSE_SECURE` | `false` | `true` for HTTPS (ClickHouse Cloud) |
| `DEFAULT_DATABASES` | _(all)_ | Comma-separated allowlist of databases to show, e.g. `analytics,reports` |
| `POLL_INTERVAL_SECONDS` | `15` | How often the UI re-polls status |
| `QUERY_LOG_CLUSTER` | _(none)_ | Cluster name for `clusterAllReplicas()` when reading history on a cluster/Cloud |
| `DISPLAY_TIMEZONE` | `UTC` | IANA timezone for rendering timestamps, e.g. `Europe/Kyiv` |

The app listens on container port **8000**; map it to any host port you like (`-p 8088:8000` above).

### ClickHouse Cloud

```bash
docker run -d -p 8088:8000 \
  -e CLICKHOUSE_HOST=<service>.clickhouse.cloud \
  -e CLICKHOUSE_PORT=8443 \
  -e CLICKHOUSE_SECURE=true \
  -e CLICKHOUSE_USER=rmv_ui_svc \
  -e CLICKHOUSE_PASSWORD=... \
  -e QUERY_LOG_CLUSTER=default \
  ghcr.io/bun4uk/clickhouse-rmv-admin:latest
```

`QUERY_LOG_CLUSTER=default` matters on Cloud: it's multi-node, so refresh history must be read across replicas (`clusterAllReplicas`).

### Service-user grants

The app only needs to read a few `system` tables and to run the `SYSTEM VIEWS` commands:

```sql
CREATE USER rmv_ui_svc IDENTIFIED BY '…';
GRANT SELECT ON system.tables         TO rmv_ui_svc;
GRANT SELECT ON system.view_refreshes TO rmv_ui_svc;
GRANT SELECT ON system.query_log      TO rmv_ui_svc;   -- for refresh history
GRANT SYSTEM VIEWS ON <db>.*           TO rmv_ui_svc;   -- refresh / stop / start / cancel / wait
```

---

## How it works

```
Browser ──HTTP──> RMV Admin (FastAPI serves the SPA + /api) ──> ClickHouse
```

One process (uvicorn) serves both the built React UI and the `/api`. The browser never talks to ClickHouse directly — every query and command goes through the backend and the service user above.

**Stack:** FastAPI + `clickhouse-connect` · React 19 + Vite + React Flow (`@xyflow/react`) + `@dagrejs/dagre` + TanStack Query + Zustand + Tailwind CSS.

<details>
<summary>API endpoints</summary>

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/views` | All RMVs with current state |
| `GET` | `/api/views/{db}/{name}` | View details (schedule, sources, consumers, DDL) |
| `GET` | `/api/views/{db}/{name}/history?limit=N` | Refresh history from `query_log` |
| `GET` | `/api/graph` | Nodes + `DEPENDS ON` edges |
| `GET` | `/api/status` | Dashboard aggregates |
| `POST` | `/api/views/{db}/{name}/refresh` | body `{cascade, wait}` |
| `POST` | `/api/views/{db}/{name}/stop` · `/start` · `/cancel` | Schedule control |

Interactive docs are served at `/docs` (e.g. http://localhost:8088/docs).
</details>

---

## Good to know (ClickHouse RMV specifics)

- `system.view_refreshes` holds **one row per view** (current state). History is reconstructed from `system.query_log` (tagged `log_comment = 'refresh of <db>.<view>'`, available since ClickHouse 25.4).
- A **failed** refresh shows `status = 'Scheduled'` with a non-empty `exception` — there is no `Failed` status, so the UI marks errors from `exception`.
- **APPEND** views add rows on every refresh; a manual refresh can duplicate data, so the UI warns first.
- ClickHouse does **not** cascade `SYSTEM REFRESH` to dependents — the cascade action does this client-side, in dependency order.

A deeper, source-verified analysis is in [`SPEC_v2_REVIEW.md`](SPEC_v2_REVIEW.md).

---

## Troubleshooting

```bash
curl http://localhost:8088/api/health     # app + ClickHouse status
docker compose logs -f app                # logs (or: docker logs -f rmv-admin)
```

- **Can't connect to ClickHouse** — double-check the `CLICKHOUSE_*` vars and that the host is reachable (`curl http(s)://HOST:PORT/ping`); confirm the service-user grants above.
- **Graph is empty** — make sure RMVs exist. Detection is by the **REFRESH clause** (an RMV's engine is `MaterializedView`, not something like `Refreshable…`):

  ```sql
  SELECT database, name FROM system.tables
  WHERE engine = 'MaterializedView'
    AND match(create_table_query, '(?i)REFRESH\s+(EVERY|AFTER)');
  ```
- **History says "unavailable"** — `query_log` is disabled / has a short TTL, or on a cluster/Cloud you need `QUERY_LOG_CLUSTER` set.

---

## Development

Run the two parts with hot reload (needs Python 3.12+ and Node 22+):

```bash
# Backend  →  http://localhost:8000
cd backend && pip install -r requirements.txt && uvicorn main:app --reload

# Frontend →  http://localhost:3000  (proxies /api to :8000)
cd frontend && npm ci && npm run dev
```

Dependencies are pinned for reproducible, supply-chain-safe builds: `backend/requirements.txt` is fully frozen, and the frontend uses a committed `package-lock.json` with `ignore-scripts` enabled (`.npmrc`).

---

## License

[MIT](LICENSE) © 2026 Volodymyr Bunchuk
