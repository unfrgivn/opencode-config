# Billing Analysis SQL Queries

Comprehensive library of SQL queries for analyzing GCP billing exports in BigQuery. All queries target the **detailed usage cost** export table (`gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>`).

Replace these placeholders in all queries:
- `PROJECT` — the BigQuery project containing billing data
- `DATASET` — the dataset name
- `BILLING_ACCOUNT_ID` — your billing account ID (hyphens replaced with underscores)

Always dry-run queries first and use `--maximum_bytes_billed` when executing.

---

## Table of Contents

1. [Cost Overview](#cost-overview)
2. [Service & SKU Analysis](#service--sku-analysis)
3. [Project & Label Attribution](#project--label-attribution)
4. [Credit & Discount Analysis](#credit--discount-analysis)
5. [Anomaly Detection](#anomaly-detection)
6. [Resource-Level Analysis](#resource-level-analysis)
7. [Forecasting & Trends](#forecasting--trends)
8. [Egress & Networking](#egress--networking)
9. [Storage Cost Analysis](#storage-cost-analysis)
10. [BigQuery Cost Analysis](#bigquery-cost-analysis)

---

## Cost Overview

### Total monthly spend (gross vs net)

```sql
SELECT
  invoice.month AS invoice_month,
  ROUND(SUM(cost), 2) AS gross_cost,
  ROUND(SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS total_credits,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month >= FORMAT_DATE('%Y%m', DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH))
GROUP BY 1
ORDER BY 1 DESC;
```

### Daily spend for the current month

```sql
SELECT
  DATE(usage_start_time) AS usage_date,
  ROUND(SUM(cost), 2) AS gross_cost,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
GROUP BY 1
ORDER BY 1;
```

### Month-over-month growth rate

```sql
WITH monthly AS (
  SELECT
    invoice.month AS invoice_month,
    ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost
  FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
  WHERE invoice.month >= FORMAT_DATE('%Y%m', DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH))
  GROUP BY 1
)
SELECT
  invoice_month,
  net_cost,
  LAG(net_cost) OVER (ORDER BY invoice_month) AS prev_month_cost,
  ROUND(SAFE_DIVIDE(net_cost - LAG(net_cost) OVER (ORDER BY invoice_month),
    ABS(LAG(net_cost) OVER (ORDER BY invoice_month))) * 100, 1) AS pct_change
FROM monthly
ORDER BY invoice_month DESC;
```

---

## Service & SKU Analysis

### Cost by service (current month)

```sql
SELECT
  service.description AS service,
  ROUND(SUM(cost), 2) AS gross_cost,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2)
    / SUM(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0))) OVER () * 100
    AS pct_of_total
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
GROUP BY 1
ORDER BY net_cost DESC;
```

### Top SKUs by cost

```sql
SELECT
  service.description AS service,
  sku.description AS sku,
  ROUND(SUM(cost), 2) AS gross_cost,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
GROUP BY 1, 2
HAVING net_cost > 1
ORDER BY net_cost DESC
LIMIT 50;
```

### Service cost trend (month-over-month)

```sql
SELECT
  invoice.month,
  service.description AS service,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month >= FORMAT_DATE('%Y%m', DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH))
GROUP BY 1, 2
HAVING net_cost > 10
ORDER BY service, invoice.month;
```

---

## Project & Label Attribution

### Cost by project

```sql
SELECT
  project.id AS project_id,
  project.name AS project_name,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
GROUP BY 1, 2
ORDER BY net_cost DESC;
```

### Cost by label (team, environment, cost-center)

```sql
SELECT
  (SELECT value FROM UNNEST(labels) WHERE key = 'team') AS team,
  (SELECT value FROM UNNEST(labels) WHERE key = 'environment') AS environment,
  (SELECT value FROM UNNEST(labels) WHERE key = 'cost-center') AS cost_center,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
GROUP BY 1, 2, 3
ORDER BY net_cost DESC;
```

### Unlabeled spend by service

```sql
SELECT
  service.description AS service,
  ROUND(SUM(cost), 2) AS total_cost,
  ROUND(SUM(CASE WHEN ARRAY_LENGTH(labels) = 0 THEN cost ELSE 0 END), 2) AS unlabeled_cost,
  ROUND(SAFE_DIVIDE(
    SUM(CASE WHEN ARRAY_LENGTH(labels) = 0 THEN cost ELSE 0 END),
    SUM(cost)) * 100, 1) AS pct_unlabeled
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
GROUP BY 1
HAVING total_cost > 10
ORDER BY unlabeled_cost DESC;
```

### Label coverage report

```sql
SELECT
  project.id AS project_id,
  COUNT(*) AS total_line_items,
  COUNTIF((SELECT value FROM UNNEST(labels) WHERE key = 'team') IS NOT NULL) AS has_team,
  COUNTIF((SELECT value FROM UNNEST(labels) WHERE key = 'environment') IS NOT NULL) AS has_env,
  COUNTIF((SELECT value FROM UNNEST(labels) WHERE key = 'cost-center') IS NOT NULL) AS has_cost_center,
  ROUND(COUNTIF((SELECT value FROM UNNEST(labels) WHERE key = 'team') IS NOT NULL) / COUNT(*) * 100, 1) AS team_coverage_pct
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
GROUP BY 1
ORDER BY total_line_items DESC;
```

---

## Credit & Discount Analysis

### Credit breakdown by type

```sql
SELECT
  invoice.month,
  c.type AS credit_type,
  c.name AS credit_name,
  ROUND(SUM(c.amount), 2) AS credit_amount
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`,
  UNNEST(credits) AS c
WHERE invoice.month >= FORMAT_DATE('%Y%m', DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH))
GROUP BY 1, 2, 3
ORDER BY 1 DESC, credit_amount;
```

### CUD savings summary

```sql
SELECT
  invoice.month,
  ROUND(SUM(CASE WHEN c.type = 'COMMITTED_USAGE_DISCOUNT' THEN c.amount ELSE 0 END), 2) AS resource_cud_savings,
  ROUND(SUM(CASE WHEN c.type = 'COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE' THEN c.amount ELSE 0 END), 2) AS spend_cud_savings,
  ROUND(SUM(CASE WHEN c.type = 'SUSTAINED_USAGE_DISCOUNT' THEN c.amount ELSE 0 END), 2) AS sud_savings,
  ROUND(SUM(c.amount), 2) AS total_savings
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`,
  UNNEST(credits) AS c
WHERE invoice.month >= FORMAT_DATE('%Y%m', DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH))
  AND c.type IN ('COMMITTED_USAGE_DISCOUNT', 'COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE', 'SUSTAINED_USAGE_DISCOUNT')
GROUP BY 1
ORDER BY 1 DESC;
```

### CUD coverage ratio for Compute Engine

```sql
WITH compute_costs AS (
  SELECT
    invoice.month,
    ROUND(SUM(cost), 2) AS gross_cost,
    ROUND(SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c
      WHERE c.type IN ('COMMITTED_USAGE_DISCOUNT', 'SUSTAINED_USAGE_DISCOUNT')), 0)), 2) AS cud_sud_savings
  FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
  WHERE service.description = 'Compute Engine'
    AND invoice.month >= FORMAT_DATE('%Y%m', DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH))
  GROUP BY 1
)
SELECT
  invoice_month,
  gross_cost,
  cud_sud_savings,
  ROUND(gross_cost + cud_sud_savings, 2) AS net_cost,
  ROUND(SAFE_DIVIDE(ABS(cud_sud_savings), gross_cost) * 100, 1) AS coverage_pct
FROM compute_costs
ORDER BY 1 DESC;
```

---

## Anomaly Detection

### Day-over-day anomalies (z-score > 2)

```sql
WITH daily AS (
  SELECT
    DATE(usage_start_time) AS usage_date,
    service.description AS service,
    ROUND(SUM(cost), 2) AS daily_cost
  FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
  WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  GROUP BY 1, 2
),
stats AS (
  SELECT
    service,
    AVG(daily_cost) AS avg_cost,
    STDDEV(daily_cost) AS stddev_cost
  FROM daily
  GROUP BY 1
)
SELECT
  d.usage_date,
  d.service,
  d.daily_cost,
  ROUND(s.avg_cost, 2) AS avg_cost,
  ROUND((d.daily_cost - s.avg_cost) / NULLIF(s.stddev_cost, 0), 2) AS z_score
FROM daily d
JOIN stats s ON d.service = s.service
WHERE ABS((d.daily_cost - s.avg_cost) / NULLIF(s.stddev_cost, 0)) > 2
ORDER BY d.usage_date DESC, ABS(z_score) DESC;
```

### New SKUs appearing (cost surprise detection)

```sql
WITH current_month AS (
  SELECT DISTINCT sku.id AS sku_id, sku.description, service.description AS service
  FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
  WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
),
prev_month AS (
  SELECT DISTINCT sku.id AS sku_id
  FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
  WHERE invoice.month = FORMAT_DATE('%Y%m', DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))
)
SELECT cm.service, cm.description AS new_sku
FROM current_month cm
LEFT JOIN prev_month pm ON cm.sku_id = pm.sku_id
WHERE pm.sku_id IS NULL
ORDER BY cm.service;
```

### Week-over-week project cost change

```sql
WITH weekly AS (
  SELECT
    project.id AS project_id,
    DATE_TRUNC(DATE(usage_start_time), WEEK) AS week_start,
    ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost
  FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
  WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 28 DAY)
  GROUP BY 1, 2
)
SELECT
  project_id,
  week_start,
  net_cost,
  LAG(net_cost) OVER (PARTITION BY project_id ORDER BY week_start) AS prev_week,
  ROUND(SAFE_DIVIDE(
    net_cost - LAG(net_cost) OVER (PARTITION BY project_id ORDER BY week_start),
    ABS(LAG(net_cost) OVER (PARTITION BY project_id ORDER BY week_start))
  ) * 100, 1) AS pct_change
FROM weekly
ORDER BY project_id, week_start DESC;
```

---

## Resource-Level Analysis

### Top resources by cost

```sql
SELECT
  project.id AS project_id,
  service.description AS service,
  resource.name AS resource_name,
  resource.global_name AS resource_global_name,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
  AND resource.name IS NOT NULL
GROUP BY 1, 2, 3, 4
ORDER BY net_cost DESC
LIMIT 50;
```

### Compute Engine instance costs

```sql
SELECT
  project.id AS project_id,
  resource.name AS instance_name,
  sku.description AS sku,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 2) AS net_cost
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE service.description = 'Compute Engine'
  AND invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
  AND resource.name IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY net_cost DESC
LIMIT 50;
```

---

## Forecasting & Trends

### Simple linear forecast for current month

```sql
WITH daily AS (
  SELECT
    DATE(usage_start_time) AS usage_date,
    SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net_cost
  FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
  WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
  GROUP BY 1
),
running AS (
  SELECT
    MAX(usage_date) AS last_date,
    SUM(net_cost) AS mtd_cost,
    COUNT(*) AS days_elapsed
  FROM daily
)
SELECT
  ROUND(mtd_cost, 2) AS month_to_date_cost,
  days_elapsed,
  EXTRACT(DAY FROM LAST_DAY(CURRENT_DATE())) AS days_in_month,
  ROUND(mtd_cost / days_elapsed * EXTRACT(DAY FROM LAST_DAY(CURRENT_DATE())), 2) AS projected_month_end
FROM running;
```

---

## Egress & Networking

### Network egress costs by SKU

```sql
SELECT
  service.description AS service,
  sku.description AS sku,
  ROUND(SUM(cost), 2) AS cost,
  ROUND(SUM(usage.amount), 2) AS usage_amount,
  usage.unit
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
  AND (LOWER(sku.description) LIKE '%egress%'
    OR LOWER(sku.description) LIKE '%network%'
    OR LOWER(sku.description) LIKE '%data transfer%')
  AND cost > 0
GROUP BY 1, 2, 5
ORDER BY cost DESC;
```

---

## Storage Cost Analysis

### Storage costs by type and class

```sql
SELECT
  service.description AS service,
  sku.description AS sku,
  ROUND(SUM(cost), 2) AS cost,
  ROUND(SUM(usage.amount), 2) AS usage_gb,
  usage.unit
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
  AND (service.description = 'Cloud Storage'
    OR LOWER(sku.description) LIKE '%storage%')
  AND cost > 0
GROUP BY 1, 2, 5
ORDER BY cost DESC;
```

---

## BigQuery Cost Analysis

### BigQuery cost breakdown

```sql
SELECT
  project.id AS project_id,
  sku.description AS sku,
  ROUND(SUM(cost), 2) AS cost,
  ROUND(SUM(usage.amount), 2) AS usage_amount,
  usage.unit
FROM `PROJECT.DATASET.gcp_billing_export_resource_v1_BILLING_ACCOUNT_ID`
WHERE service.description = 'BigQuery'
  AND invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())
  AND cost > 0
GROUP BY 1, 2, 5
ORDER BY cost DESC;
```

### BigQuery analysis bytes scanned (from INFORMATION_SCHEMA)

This query runs against a project's INFORMATION_SCHEMA, not the billing export:

```sql
SELECT
  user_email,
  COUNT(*) AS query_count,
  ROUND(SUM(total_bytes_processed) / POW(1024, 4), 3) AS total_tb_processed,
  ROUND(SUM(total_bytes_processed) / POW(1024, 4) * 6.25, 2) AS estimated_cost_usd
FROM `PROJECT.region-REGION.INFORMATION_SCHEMA.JOBS`
WHERE creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND job_type = 'QUERY'
  AND state = 'DONE'
  AND statement_type != 'SCRIPT'
GROUP BY 1
ORDER BY total_tb_processed DESC;
```
