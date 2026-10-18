---
name: postgres
description: PostgreSQL engineering guidance for schema design, query tuning, indexing, migrations, operations, and production troubleshooting. Use when analyzing EXPLAIN plans, optimizing slow queries, designing B-tree/GIN/GiST/BRIN indexes, using JSONB, configuring extensions such as pg_stat_statements, pg_trgm, PostGIS, pgvector, or pgcrypto, tuning VACUUM/autovacuum and statistics, monitoring pg_stat views, investigating locks or bloat, setting up replication, failover, backups, PITR, or reviewing PostgreSQL data-access patterns in application code.
---

# PostgreSQL

Solve PostgreSQL problems from evidence. Prefer small, measurable changes over clever database theater. Production databases are not a vibes-based ecosystem.

## Default workflow

1. Identify the workload, PostgreSQL version, table sizes, cardinality, write/read ratio, latency target, and operational constraints before prescribing changes.
2. Gather evidence with the narrowest safe commands: `EXPLAIN (ANALYZE, BUFFERS)`, `pg_stat_statements`, `pg_stat_activity`, `pg_stat_user_tables`, `pg_stat_user_indexes`, and relevant schema definitions.
3. Form one hypothesis at a time. Change the query, index, statistics, configuration, or operational setting most directly tied to the evidence.
4. Make production-safe changes by default: prefer concurrent indexes, explicit transactions where appropriate, bounded maintenance windows, rollback notes, and lock impact checks.
5. Verify with before/after plans, timings, buffer counts, row estimates, lock behavior, replication lag, or maintenance metrics.
6. Report the risk, expected impact, validation performed, and any follow-up monitoring needed.

## Reference map

- Read `references/performance.md` for EXPLAIN, indexes, statistics, query rewrites, connection pooling, and configuration tuning.
- Read `references/jsonb.md` for JSONB operators, containment queries, path extraction, expression indexes, generated columns, and JSONB migration patterns.
- Read `references/extensions.md` for pg_stat_statements, pg_trgm, PostGIS, pgvector, pgcrypto, foreign data wrappers, pg_repack, and TimescaleDB.
- Read `references/maintenance.md` for VACUUM, autovacuum, ANALYZE, bloat, pg_stat views, locks, wraparound, and maintenance checks.
- Read `references/replication.md` for streaming replication, logical replication, failover, HA, WAL archiving, backups, and PITR.

## House rules

- Use `EXPLAIN (ANALYZE, BUFFERS)` when optimizing a query, unless running it would mutate data or be unsafe on the target environment.
- Compare estimated rows to actual rows. Bad estimates usually mean statistics, correlation, predicates, or join assumptions are lying.
- Design indexes from observed predicates, joins, ordering, and selectivity. Do not add indexes because they look lonely.
- Use `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` for production changes when possible. Call out the transaction restrictions.
- Run `ANALYZE` after bulk changes and consider per-column statistics targets for skewed or high-cardinality data.
- Prefer `jsonb` for queryable JSON. Extract hot, validated, or frequently updated values into typed columns or generated columns.
- Prefer `uuid` over `text` for UUID values and `timestamptz` over ambiguous timestamp storage for application events.
- Keep application SQL injection-safe with parameters or prepared statements. Never concatenate user-controlled values into SQL.
- Treat `VACUUM FULL`, table rewrites, blocking DDL, broad locks, and failover steps as high-risk operations that need explicit user confirmation.
- Never disable autovacuum globally. Tune it per table when high-churn tables need different thresholds.

## Common investigation pattern

```sql
-- 1. Find costly query shapes when pg_stat_statements is available.
SELECT query, calls, mean_exec_time, total_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- 2. Inspect the specific plan with real execution metrics.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, customer_id, status, created_at
FROM orders
WHERE customer_id = $1 AND status = 'pending'
ORDER BY created_at DESC
LIMIT 50;

-- 3. Add the smallest index that matches the access pattern, if evidence supports it.
CREATE INDEX CONCURRENTLY idx_orders_customer_pending_created_at
  ON orders (customer_id, created_at DESC)
  WHERE status = 'pending';

-- 4. Verify planner behavior and runtime after the change.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, customer_id, status, created_at
FROM orders
WHERE customer_id = $1 AND status = 'pending'
ORDER BY created_at DESC
LIMIT 50;
```

## Handoff

Include the evidence used, exact SQL/config changes proposed or applied, lock and migration risk, verification output, and monitoring follow-up. If a change cannot be safely validated locally, say so instead of pretending the database gods whispered approval.
