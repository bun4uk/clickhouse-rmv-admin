# CLAUDE.md — context for AI assistants

RMV Admin is a web tool to visualize, monitor and control ClickHouse
**Refreshable Materialized Views** (RMV). Target: ClickHouse 24.10+ (validated on 26.2 and 26.5).

## Layout
- `backend/` — FastAPI + `clickhouse-connect`. `clickhouse_client.py` is the core:
  RMV detection, `system.view_refreshes` reads, DDL parsing, history, actions.
- `frontend/` — React 19 + Vite + `@xyflow/react` + `@dagrejs/dagre` + TanStack Query
  + Zustand + Tailwind v4.
- `docker-compose.yml` — clickhouse + backend + frontend. Demo RMVs in `docker/clickhouse/init/`.
- `SPEC_v2_REVIEW.md` — detailed, source-verified analysis of RMV behaviour. Read it before
  changing ClickHouse-facing logic.

## Working rules
- **Run everything in Docker** (`docker compose …`). No local venv / npm for running.
- **Pin & vet dependencies**: `backend/requirements.txt` is fully frozen; frontend uses a
  committed `package-lock.json` + `.npmrc` `ignore-scripts=true`. Keep `npm audit` clean.

## Key ClickHouse facts the code relies on (see SPEC_v2_REVIEW.md)
- `system.view_refreshes` = current state only (one row/view). History comes from
  `system.query_log` (`log_comment = 'refresh of <db>.<view>'`, since 25.4).
- A failed refresh shows `status = 'Scheduled'` + non-empty `exception` (no `Failed` status).
- `retry` is non-Nullable; `progress`/`read_*`/`written_*`/`total_rows` are NULL under
  `RunningOnAnotherReplica`.
- `DEPENDS ON` is parsed from `create_table_query` (NOT `system.tables.dependencies_*`).
- RMV detection: `engine = 'MaterializedView' AND match(create_table_query, '(?i)REFRESH (EVERY|AFTER)')`.
- `SYSTEM REFRESH VIEW` is async — pair with `SYSTEM WAIT VIEW` for a result. Cascade is
  done tool-side (ClickHouse does not cascade). Privilege: `SYSTEM VIEWS`.
