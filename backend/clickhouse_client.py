"""ClickHouse client for the RMV admin tool, written against ClickHouse 26.5+.

Key facts this module relies on (validated live on 26.5.1 — see SPEC_v2_REVIEW.md):
  * system.view_refreshes holds ONE row per RMV (current state, not history).
  * status enum: Disabled, Scheduling, Scheduled, WaitingForDependencies,
    MissingDependencies, Running, RunningOnAnotherReplica. There is no
    "Succeeded"/"Failed" — a failed last refresh is shown as Scheduled with
    exception != ''.
  * retry is a non-Nullable UInt64; the six progress/IO counters are Nullable
    and become NULL under RunningOnAnotherReplica.
  * DEPENDS ON is NOT exposed by system.tables.dependencies_* — it must be
    parsed from create_table_query.
  * Refresh history lives in system.query_log, tagged (>=25.4) with
    log_comment = 'refresh of <db>.<view>'.
  * SYSTEM REFRESH VIEW is async; pair it with SYSTEM WAIT VIEW for a result.
"""

import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import clickhouse_connect

from config import settings

# --- status derivation -------------------------------------------------------

# Maps the raw system.view_refreshes.status to a compact UI status code.
# Order of checks matters (see derive_ui_status).
UI_OK = "ok"
UI_ERROR = "error"
UI_RUNNING = "running"
UI_RUNNING_OTHER = "running_other"
UI_WAITING = "waiting"
UI_MISSING = "missing"
UI_DISABLED = "disabled"
UI_SCHEDULING = "scheduling"
UI_UNKNOWN = "unknown"


def derive_ui_status(status: str, exception: str) -> str:
    """Collapse raw status + exception into a single UI bucket.

    Active states win over a stale exception (a Running view is re-running);
    otherwise a non-empty exception means the last attempt failed."""
    if status == "Running":
        return UI_RUNNING
    if status == "RunningOnAnotherReplica":
        return UI_RUNNING_OTHER
    if exception:
        return UI_ERROR
    if status == "WaitingForDependencies":
        return UI_WAITING
    if status == "MissingDependencies":
        return UI_MISSING
    if status == "Disabled":
        return UI_DISABLED
    if status == "Scheduling":
        return UI_SCHEDULING
    if status == "Scheduled":
        return UI_OK
    return UI_UNKNOWN


# --- DDL parsing -------------------------------------------------------------

_IDENT = r"`[^`]+`|[A-Za-z_][A-Za-z0-9_]*"


def _strip_ticks(name: str) -> str:
    name = name.strip()
    if name.startswith("`") and name.endswith("`"):
        return name[1:-1]
    return name


def _refresh_clause(ddl: str) -> str:
    """Return the part of the DDL between REFRESH and the AS SELECT body."""
    if not ddl:
        return ""
    m = re.search(r"\bREFRESH\b", ddl, re.IGNORECASE)
    if not m:
        return ""
    tail = ddl[m.start():]
    # Cut at the SELECT body so we never parse column names / SELECT text.
    cut = re.search(r"\bAS\s+SELECT\b|\bAS\s+WITH\b", tail, re.IGNORECASE)
    return tail[: cut.start()] if cut else tail


def parse_mode(ddl: str) -> str:
    """REPLACE (default) vs APPEND — APPEND keyword lives in the refresh clause."""
    clause = _refresh_clause(ddl)
    return "APPEND" if re.search(r"\bAPPEND\b", clause, re.IGNORECASE) else "REPLACE"


def parse_depends_on(ddl: str, default_db: str) -> List[Dict[str, str]]:
    """Parse `DEPENDS ON db.view, view2, ...` into [{database, table}]."""
    clause = _refresh_clause(ddl)
    m = re.search(
        r"\bDEPENDS\s+ON\s+(.+?)(?:\bSETTINGS\b|\bAPPEND\b|\bTO\b|\bEMPTY\b|\(|$)",
        clause,
        re.IGNORECASE | re.DOTALL,
    )
    if not m:
        return []
    deps: List[Dict[str, str]] = []
    seen = set()
    for token in m.group(1).split(","):
        token = token.strip().rstrip("()").strip()
        if not token:
            continue
        parts = re.findall(_IDENT, token)
        if not parts:
            continue
        if len(parts) >= 2:
            db, name = _strip_ticks(parts[0]), _strip_ticks(parts[1])
        else:
            db, name = default_db, _strip_ticks(parts[0])
        key = f"{db}.{name}"
        if key not in seen:
            seen.add(key)
            deps.append({"database": db, "table": name})
    return deps


def parse_schedule(ddl: str) -> Dict[str, Any]:
    """Extract EVERY/AFTER + OFFSET + RANDOMIZE FOR + DEPENDS ON list (raw)."""
    clause = _refresh_clause(ddl)
    schedule: Dict[str, Any] = {
        "kind": None,
        "interval": None,
        "offset": None,
        "randomize_for": None,
        "depends_on": [],
    }
    m = re.search(r"\b(EVERY|AFTER)\s+(\d+\s+[A-Za-z]+)", clause, re.IGNORECASE)
    if m:
        schedule["kind"] = m.group(1).upper()
        schedule["interval"] = re.sub(r"\s+", " ", m.group(2)).strip()
    m = re.search(r"\bOFFSET\s+(\d+\s+[A-Za-z]+(?:\s+\d+\s+[A-Za-z]+)*)", clause, re.IGNORECASE)
    if m:
        schedule["offset"] = re.sub(r"\s+", " ", m.group(1)).strip()
    m = re.search(r"\bRANDOMIZE\s+FOR\s+(\d+\s+[A-Za-z]+)", clause, re.IGNORECASE)
    if m:
        schedule["randomize_for"] = re.sub(r"\s+", " ", m.group(1)).strip()
    deps = re.search(
        r"\bDEPENDS\s+ON\s+(.+?)(?:\bSETTINGS\b|\bAPPEND\b|\bTO\b|\bEMPTY\b|\(|$)",
        clause,
        re.IGNORECASE | re.DOTALL,
    )
    if deps:
        schedule["depends_on"] = [
            re.sub(r"\s+", " ", _strip_ticks(t)).strip()
            for t in deps.group(1).split(",")
            if t.strip()
        ]
    return schedule


# --- helpers -----------------------------------------------------------------

def _iso(dt: Optional[datetime]) -> Optional[str]:
    """ISO string. ClickHouse system DateTimes are UTC; mark naive ones as UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.isoformat()


def _qualified(database: str, name: str) -> str:
    """Backtick-quote a db.table identifier for use in SYSTEM commands."""
    db = database.replace("`", "``")
    nm = name.replace("`", "``")
    return f"`{db}`.`{nm}`"


_SAFE_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class ClickHouseError(Exception):
    pass


class ClickHouseClient:
    def __init__(self):
        self.client = None
        self._connect()

    def _connect(self):
        try:
            self.client = clickhouse_connect.get_client(
                host=settings.clickhouse_host,
                port=settings.clickhouse_port,
                username=settings.clickhouse_user,
                password=settings.clickhouse_password,
                database=settings.clickhouse_database,
                secure=settings.clickhouse_secure,
            )
            print(
                f"✓ Connected to ClickHouse at "
                f"{settings.clickhouse_host}:{settings.clickhouse_port}"
            )
        except Exception as e:  # lazy: backend still starts if CH is down
            print(f"⚠ Warning: could not connect to ClickHouse: {e}")
            self.client = None

    def _ensure(self):
        if self.client is None:
            self._connect()
        if self.client is None:
            raise ClickHouseError(
                f"ClickHouse not connected ({settings.clickhouse_host}:"
                f"{settings.clickhouse_port})"
            )

    # --- introspection -------------------------------------------------------

    def describe_view_refreshes(self) -> List[str]:
        """Return the live column list of system.view_refreshes (sanity check)."""
        self._ensure()
        res = self.client.query("DESCRIBE system.view_refreshes")
        return [row[0] for row in res.result_rows]

    def _db_filter(self) -> Tuple[str, Dict[str, Any]]:
        if settings.databases:
            return (
                " WHERE vr.database IN {dbs:Array(String)} ",
                {"dbs": settings.databases},
            )
        return ("", {})

    def _row_to_state(self, row: Dict[str, Any]) -> Dict[str, Any]:
        ddl = row.get("create_table_query") or ""
        database = row["database"]
        exception = row.get("exception") or ""
        status = row.get("status") or ""
        return {
            "database": database,
            "name": row["view"],
            "uuid": str(row.get("uuid")) if row.get("uuid") else None,
            "status": status,
            "ui_status": derive_ui_status(status, exception),
            "mode": parse_mode(ddl),
            "last_success_time": _iso(row.get("last_success_time")),
            "last_success_duration_ms": row.get("last_success_duration_ms"),
            "last_refresh_time": _iso(row.get("last_refresh_time")),
            "last_refresh_replica": row.get("last_refresh_replica") or None,
            "next_refresh_time": _iso(row.get("next_refresh_time")),
            "exception": exception,
            "retry": row.get("retry"),
            "progress": row.get("progress"),
            "read_rows": row.get("read_rows"),
            "read_bytes": row.get("read_bytes"),
            "total_rows": row.get("total_rows"),
            "written_rows": row.get("written_rows"),
            "written_bytes": row.get("written_bytes"),
        }

    def _query_states(self) -> List[Dict[str, Any]]:
        """All RMVs joined with current refresh state + DDL."""
        self._ensure()
        where, params = self._db_filter()
        query = f"""
        SELECT
            vr.database AS database, vr.view AS view, vr.uuid AS uuid,
            vr.status AS status,
            vr.last_success_time AS last_success_time,
            vr.last_success_duration_ms AS last_success_duration_ms,
            vr.last_refresh_time AS last_refresh_time,
            vr.last_refresh_replica AS last_refresh_replica,
            vr.next_refresh_time AS next_refresh_time,
            vr.exception AS exception, vr.retry AS retry, vr.progress AS progress,
            vr.read_rows AS read_rows, vr.read_bytes AS read_bytes,
            vr.total_rows AS total_rows, vr.written_rows AS written_rows,
            vr.written_bytes AS written_bytes,
            t.create_table_query AS create_table_query,
            t.total_rows AS table_total_rows, t.total_bytes AS table_total_bytes
        FROM system.view_refreshes AS vr
        LEFT JOIN system.tables AS t
            ON t.database = vr.database AND t.name = vr.view
        {where}
        ORDER BY vr.database, vr.view
        """
        res = self.client.query(query, parameters=params)
        cols = res.column_names
        rows = [dict(zip(cols, r)) for r in res.result_rows]
        return rows

    # --- public read API -----------------------------------------------------

    def list_views(self) -> List[Dict[str, Any]]:
        return [self._row_to_state(r) for r in self._query_states()]

    def get_view(self, database: str, name: str) -> Optional[Dict[str, Any]]:
        self._ensure()
        states = self._query_states()
        row = next(
            (r for r in states if r["database"] == database and r["view"] == name),
            None,
        )
        if row is None:
            return None
        ddl = row.get("create_table_query") or ""
        state = self._row_to_state(row)
        sources = parse_depends_on(ddl, database)
        # consumers: who DEPENDS ON this view
        target = f"{database}.{name}"
        consumers: List[Dict[str, str]] = []
        for other in states:
            if other["database"] == database and other["view"] == name:
                continue
            for dep in parse_depends_on(other.get("create_table_query") or "", other["database"]):
                if f"{dep['database']}.{dep['table']}" == target:
                    consumers.append({"database": other["database"], "name": other["view"]})
                    break
        return {
            **state,
            "create_query": ddl,
            "schedule": parse_schedule(ddl),
            "sources": sources,
            "consumers": consumers,
            "table_total_rows": row.get("table_total_rows"),
            "table_total_bytes": row.get("table_total_bytes"),
        }

    def get_history(self, database: str, name: str, limit: int = 20) -> Dict[str, Any]:
        """Refresh history from query_log via the log_comment marker (>=25.4).

        Degrades gracefully if query_log is unavailable/disabled."""
        self._ensure()
        marker = f"refresh of {database}.{name}"
        cluster = settings.query_log_cluster.strip()
        if cluster:
            if not _SAFE_IDENT_RE.match(cluster):
                raise ClickHouseError(f"Invalid query_log_cluster name: {cluster!r}")
            source = f"clusterAllReplicas({cluster}, merge(system, '^query_log'))"
        else:
            source = "system.query_log"
        query = f"""
        SELECT
            event_time, query_duration_ms, type,
            read_rows, written_rows, memory_usage, exception
        FROM {source}
        WHERE log_comment = {{marker:String}}
          AND type IN ('QueryFinish', 'ExceptionWhileProcessing', 'ExceptionBeforeStart')
        ORDER BY event_time DESC
        LIMIT {{limit:UInt32}}
        SETTINGS skip_unavailable_shards = 1
        """
        try:
            res = self.client.query(
                query, parameters={"marker": marker, "limit": int(limit)}
            )
        except Exception as e:
            msg = str(e)
            if "query_log" in msg or "UNKNOWN_TABLE" in msg or "Unknown table" in msg:
                return {"available": False, "items": [], "reason": "query_log unavailable"}
            raise
        items = []
        for row in res.result_rows:
            items.append(
                {
                    "event_time": _iso(row[0]),
                    "duration_ms": row[1],
                    "type": row[2],
                    "read_rows": row[3],
                    "written_rows": row[4],
                    "memory_usage": row[5],
                    "exception": row[6] or "",
                }
            )
        return {"available": True, "items": items}

    def get_graph(self) -> Dict[str, Any]:
        """Nodes = RMVs (with state), edges = DEPENDS ON (source -> dependent)."""
        states = self._query_states()
        present = {f"{r['database']}.{r['view']}" for r in states}
        nodes = []
        edges = []
        seen_edges = set()
        for r in states:
            state = self._row_to_state(r)
            nodes.append(
                {
                    "id": f"{r['database']}.{r['view']}",
                    "label": r["view"],
                    "database": r["database"],
                    "mode": state["mode"],
                    "status": state["status"],
                    "ui_status": state["ui_status"],
                    "last_success_time": state["last_success_time"],
                    "next_refresh_time": state["next_refresh_time"],
                    "exception": state["exception"],
                }
            )
            dependent = f"{r['database']}.{r['view']}"
            for dep in parse_depends_on(r.get("create_table_query") or "", r["database"]):
                source = f"{dep['database']}.{dep['table']}"
                ek = (source, dependent)
                if ek in seen_edges:
                    continue
                seen_edges.add(ek)
                edges.append(
                    {
                        "source": source,
                        "target": dependent,
                        "type": "depends_on",
                        "missing": source not in present,
                    }
                )
        return {"nodes": nodes, "edges": edges}

    def get_dashboard(self) -> Dict[str, Any]:
        states = [self._row_to_state(r) for r in self._query_states()]
        last_success = None
        for s in states:
            if s["last_success_time"] and (last_success is None or s["last_success_time"] > last_success):
                last_success = s["last_success_time"]
        return {
            "total": len(states),
            "errors": sum(1 for s in states if s["ui_status"] == UI_ERROR),
            "running": sum(1 for s in states if s["ui_status"] == UI_RUNNING),
            "running_other": sum(1 for s in states if s["ui_status"] == UI_RUNNING_OTHER),
            "waiting": sum(
                1 for s in states if s["ui_status"] in (UI_WAITING, UI_MISSING)
            ),
            "disabled": sum(1 for s in states if s["ui_status"] == UI_DISABLED),
            "last_success_time": last_success,
        }

    # --- actions -------------------------------------------------------------

    def _command(self, sql: str):
        self._ensure()
        self.client.command(sql)

    def refresh(self, database: str, name: str, wait: bool = False) -> Dict[str, Any]:
        ident = _qualified(database, name)
        self._command(f"SYSTEM REFRESH VIEW {ident}")
        if wait:
            # WAIT VIEW blocks until the refresh finishes and rethrows REFRESH_FAILED.
            try:
                self._command(f"SYSTEM WAIT VIEW {ident}")
            except Exception as e:
                return {"success": False, "error": str(e)}
        return {"success": True}

    def stop(self, database: str, name: str) -> Dict[str, Any]:
        self._command(f"SYSTEM STOP VIEW {_qualified(database, name)}")
        return {"success": True}

    def start(self, database: str, name: str) -> Dict[str, Any]:
        self._command(f"SYSTEM START VIEW {_qualified(database, name)}")
        return {"success": True}

    def cancel(self, database: str, name: str) -> Dict[str, Any]:
        self._command(f"SYSTEM CANCEL VIEW {_qualified(database, name)}")
        return {"success": True}

    def _downstream_topo(self, database: str, name: str) -> List[Tuple[str, str]]:
        """Topologically ordered [target, ...consumers] over DEPENDS ON edges.

        ClickHouse does NOT cascade refresh; we order it ourselves: a view is
        refreshed only after every view it depends on (within the subgraph)."""
        states = self._query_states()
        # adjacency: source -> [dependents]
        edges: Dict[str, List[str]] = {}
        indeg: Dict[str, int] = {}
        nodes_in_graph = set()
        node_db: Dict[str, Tuple[str, str]] = {}
        for r in states:
            nid = f"{r['database']}.{r['view']}"
            node_db[nid] = (r["database"], r["view"])
            for dep in parse_depends_on(r.get("create_table_query") or "", r["database"]):
                src = f"{dep['database']}.{dep['table']}"
                edges.setdefault(src, []).append(nid)

        # reachable downstream set (including the target itself)
        start = f"{database}.{name}"
        reachable = set()
        stack = [start]
        while stack:
            cur = stack.pop()
            if cur in reachable:
                continue
            reachable.add(cur)
            for nxt in edges.get(cur, []):
                stack.append(nxt)

        # Kahn topo-sort restricted to the reachable subgraph
        for nid in reachable:
            indeg.setdefault(nid, 0)
            nodes_in_graph.add(nid)
        for src, dsts in edges.items():
            if src not in reachable:
                continue
            for d in dsts:
                if d in reachable:
                    indeg[d] = indeg.get(d, 0) + 1
        queue = [n for n in reachable if indeg.get(n, 0) == 0]
        # ensure the start view is first if it has no in-subgraph predecessor
        order: List[str] = []
        while queue:
            queue.sort()
            cur = queue.pop(0)
            order.append(cur)
            for nxt in edges.get(cur, []):
                if nxt in reachable:
                    indeg[nxt] -= 1
                    if indeg[nxt] == 0:
                        queue.append(nxt)
        # any cycle leftovers appended deterministically
        for nid in sorted(reachable):
            if nid not in order:
                order.append(nid)
        result = []
        for nid in order:
            if nid in node_db:
                result.append(node_db[nid])
            else:
                db, _, vw = nid.partition(".")
                result.append((db, vw))
        return result

    def refresh_cascade(self, database: str, name: str) -> Dict[str, Any]:
        """Tool-side cascade: refresh target + downstream in topological order,
        waiting for each before the next (so dependents see fresh data)."""
        order = self._downstream_topo(database, name)
        refreshed: List[str] = []
        errors: List[str] = []
        for db, vw in order:
            ident = f"{db}.{vw}"
            try:
                r = self.refresh(db, vw, wait=True)
                if r.get("success"):
                    refreshed.append(ident)
                else:
                    errors.append(f"{ident}: {r.get('error')}")
            except Exception as e:
                errors.append(f"{ident}: {e}")
        return {"refreshed": refreshed, "errors": errors, "total": len(refreshed)}


clickhouse_client = ClickHouseClient()
