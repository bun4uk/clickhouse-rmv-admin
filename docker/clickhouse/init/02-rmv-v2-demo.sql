-- v2 demo: a DEPENDS ON chain, an APPEND view, and a deliberately failing view,
-- so the UI shows real DEPENDS ON edges, the REPLACE/APPEND badge and an error state.
CREATE DATABASE IF NOT EXISTS rmv_v2;

CREATE TABLE IF NOT EXISTS rmv_v2.raw (id UInt64, amount UInt64)
ENGINE = MergeTree ORDER BY id;
INSERT INTO rmv_v2.raw SELECT number, number % 100 FROM numbers(10000);

-- stage_a (REPLACE, implicit inner table) reads the raw table.
CREATE MATERIALIZED VIEW IF NOT EXISTS rmv_v2.stage_a
REFRESH EVERY 1 HOUR
ENGINE = MergeTree ORDER BY id
AS SELECT id, amount FROM rmv_v2.raw;

-- stage_b DEPENDS ON stage_a  -> edge stage_a -> stage_b
CREATE MATERIALIZED VIEW IF NOT EXISTS rmv_v2.stage_b
REFRESH EVERY 1 HOUR DEPENDS ON rmv_v2.stage_a
ENGINE = MergeTree ORDER BY id
AS SELECT id, amount * 2 AS amount FROM rmv_v2.stage_a;

-- stage_c DEPENDS ON stage_b  -> edge stage_b -> stage_c
CREATE MATERIALIZED VIEW IF NOT EXISTS rmv_v2.stage_c
REFRESH EVERY 1 HOUR DEPENDS ON rmv_v2.stage_b
ENGINE = MergeTree ORDER BY cnt
AS SELECT count() AS cnt, sum(amount) AS total FROM rmv_v2.stage_b;

-- APPEND-mode snapshot view (UI must show the APPEND badge + warn before manual refresh)
CREATE MATERIALIZED VIEW IF NOT EXISTS rmv_v2.snapshots
REFRESH EVERY 1 HOUR APPEND
ENGINE = MergeTree ORDER BY ts
AS SELECT now() AS ts, count() AS rows_now FROM rmv_v2.raw;

-- deliberately failing view (throws at refresh -> status Scheduled + exception != '')
CREATE MATERIALIZED VIEW IF NOT EXISTS rmv_v2.broken
REFRESH EVERY 1 HOUR
ENGINE = MergeTree ORDER BY id
AS SELECT id, throwIf(id >= 0, 'demo failure') AS amount FROM rmv_v2.raw;
