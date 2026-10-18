---
name: bigquery
description: Safely inspect and query BigQuery with the bq CLI. Default to read-only, cost-aware, bounded commands. Never mutate datasets or tables unless the user explicitly asks.
---

# BigQuery via `bq` CLI

Use this skill when you need to inspect BigQuery datasets, tables, schemas, jobs, or run SQL from the command line.

## Core rules

1. Default to read-only.
   - Allowed by default: `bq ls`, `bq show`, `bq head`, `bq query --dry_run`, and read-only `bq query`.
   - Do not use mutating commands such as `bq rm`, `bq mk`, `bq load`, `bq update`, `bq cp`, `bq extract`, `bq insert`, or DDL/DML SQL unless the user explicitly asks for creation, deletion, loading, exporting, or data changes.

2. Always scope commands explicitly.
   - Prefer `--project_id=...`
   - Prefer `--location=...` when known
   - Never rely on whatever happens to be configured in the shell

3. Always inspect before querying.
   - First discover datasets and tables
   - Then inspect schema and metadata
   - Then dry run
   - Then execute a bounded query only if needed

4. Always dry run SQL first.
   - Use `bq query --use_legacy_sql=false --dry_run '...'`
   - Do not run the real query until the dry run succeeds and the bytes processed look reasonable

5. Always bound cost and output.
   - Add `LIMIT` unless the user clearly needs a full result set
   - Use `--maximum_bytes_billed=...` on real queries
   - Use `--max_rows=...` for CLI output
   - Prefer focused projections over `SELECT *`

6. Use GoogleSQL, not legacy SQL.
   - Pass `--use_legacy_sql=false` or `--nouse_legacy_sql`
   - In SQL, reference tables as ``project.dataset.table``
   - In `bq` command arguments, use `project:dataset.table`

7. Prefer machine-readable output for agent work.
   - Use `--format=prettyjson` for metadata
   - Use `--format=json` for result parsing when appropriate

8. Surface uncertainty and stop on permission or location mismatches.
   - If access is denied, report the missing permission or likely role issue
   - If the query location is wrong, stop and correct location before retrying

## Safe workflow

### 1. Verify tool help if needed

```bash
bq version
bq help
bq help query
```

### 2. List datasets in a project

```bash
bq --project_id="${PROJECT_ID}" --format=prettyjson ls
```

### 3. List tables in a dataset

```bash
bq --project_id="${PROJECT_ID}" --format=prettyjson ls "${PROJECT_ID}:${DATASET}"
```

### 4. Inspect dataset metadata

```bash
bq --project_id="${PROJECT_ID}" --format=prettyjson show "${PROJECT_ID}:${DATASET}"
```

### 5. Inspect table schema and metadata

```bash
bq --project_id="${PROJECT_ID}" --format=prettyjson show "${PROJECT_ID}:${DATASET}.${TABLE}"
```

### 6. Preview a few rows without scanning a full query

```bash
bq --project_id="${PROJECT_ID}" head -n 20 "${PROJECT_ID}:${DATASET}.${TABLE}"
```

### 7. Dry run a query before executing it

```bash
bq query \
  --project_id="${PROJECT_ID}" \
  --location="${LOCATION}" \
  --use_legacy_sql=false \
  --dry_run \
  '
  SELECT col1, col2
  FROM `'"${PROJECT_ID}"'.'"${DATASET}"'.'"${TABLE}"'`
  WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  LIMIT 100
  '
```

### 8. Run the real query with cost and row limits

```bash
bq query \
  --project_id="${PROJECT_ID}" \
  --location="${LOCATION}" \
  --use_legacy_sql=false \
  --maximum_bytes_billed=1000000000 \
  --max_rows=100 \
  --format=json \
  '
  SELECT col1, col2
  FROM `'"${PROJECT_ID}"'.'"${DATASET}"'.'"${TABLE}"'`
  WHERE event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  LIMIT 100
  '
```

## Command patterns

### List datasets

```bash
bq --project_id="${PROJECT_ID}" ls
```

### List tables

```bash
bq --project_id="${PROJECT_ID}" ls "${PROJECT_ID}:${DATASET}"
```

### Show table

```bash
bq --project_id="${PROJECT_ID}" --format=prettyjson show "${PROJECT_ID}:${DATASET}.${TABLE}"
```

### Preview rows

```bash
bq --project_id="${PROJECT_ID}" head -n 10 "${PROJECT_ID}:${DATASET}.${TABLE}"
```

### Show jobs

```bash
bq --project_id="${PROJECT_ID}" --location="${LOCATION}" ls -j
```

### Cancel a job

Only if the user explicitly asks.

```bash
bq --project_id="${PROJECT_ID}" --location="${LOCATION}" cancel "${JOB_ID}"
```

## SQL guardrails

Prefer this pattern:

```sql
SELECT column_a, column_b
FROM `project.dataset.table`
WHERE ...
ORDER BY ...
LIMIT 100
```

Avoid by default:

```sql
SELECT *
FROM `project.dataset.table`
```

Never run without explicit user approval:
- `CREATE`, `ALTER`, `DROP`, `TRUNCATE`
- `INSERT`, `UPDATE`, `DELETE`, `MERGE`
- CTAS or queries that write to destination tables
- Anything that exports data to GCS
- Anything that copies or deletes tables or datasets

## Output discipline

- Use `--format=prettyjson` for metadata inspection
- Use `--format=json` for result consumption by the agent
- Keep row counts small unless the user asks otherwise
- Summarize findings before offering the next command
- When a query would be expensive, say so plainly and ask whether to proceed only if the next step is destructive or materially costly

## Error handling

### Access denied

Report:
- which command failed
- which project, dataset, or table was targeted
- whether it likely needs `bigquery.jobs.create` on the billing and query project or data read access on referenced tables

### Location mismatch

Report:
- detected or assumed location
- recommend retry with explicit `--location=...`

### Dry run failed

Do not execute the real query.

Return:
- SQL error message
- likely fix
- corrected query if obvious

## Defaults to prefer

Use these defaults unless the user says otherwise:
- `--use_legacy_sql=false`
- `--format=prettyjson` for metadata
- `--format=json` for query output parsing
- `--max_rows=100`
- `--maximum_bytes_billed=1000000000`
- `LIMIT 100`
- explicit `--project_id`
- explicit `--location`

## Optional `.bigqueryrc` guidance

If the environment is persistent and the user wants defaults, suggest a `.bigqueryrc` like:

```ini
--format=prettyjson
--location=US

[query]
--use_legacy_sql=false
--max_rows=100
--maximum_bytes_billed=1000000000
```

Do not assume this file exists. Prefer explicit flags in commands.

## Decision policy

When asked to "look at BigQuery" or "check a table":
1. Identify project, dataset, table, and location
2. Run `ls` and `show`
3. Use `head` for a small preview
4. Dry run any SQL
5. Run bounded query only if needed
6. Refuse to mutate unless the user explicitly asked

## Example responses

### Safe inspection

User: "Inspect table foo in dataset analytics"

Agent actions:
1. `bq ls project:analytics`
2. `bq show project:analytics.foo`
3. `bq head -n 10 project:analytics.foo`

### Safe query

User: "How many rows were added in the last 7 days?"

Agent actions:
1. `bq show ...` to inspect schema
2. `bq query --dry_run ...`
3. `bq query --maximum_bytes_billed=... --max_rows=100 ...`

### Mutation request

User: "Delete dataset tmp_scratch"

Agent behavior:
- Confirm this is destructive
- Show the exact `bq rm` command
- Only execute if the user explicitly wants deletion performed

## Notes the agent should know

- `bq` command format is `bq COMMAND [FLAGS] [ARGUMENTS]`
- The CLI accepts boolean flags in forms like `--flag=true`, `--flag`, `--noflag`
- BigQuery table identifiers differ by context: `project:dataset.table` in `bq` arguments versus `project.dataset.table` in GoogleSQL
- GoogleSQL from the CLI requires `--use_legacy_sql=false` unless defaults are configured otherwise
- Dry runs validate the query and estimate bytes processed without charging for the dry run itself

