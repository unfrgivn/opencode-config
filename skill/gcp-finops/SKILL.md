---
name: gcp-finops
description: >-
  Google Cloud Platform FinOps and cost optimization expert. Analyzes GCP billing exports in BigQuery,
  finds savings with committed use discounts and right-sizing, manages budgets and alerts, identifies idle
  and orphaned resources, builds cost allocation strategies with labels, and provides actionable
  recommendations using gcloud CLI, Recommender API, and billing SQL queries. Use this skill whenever a
  user mentions GCP costs, cloud spend, billing analysis, cost optimization, committed use discounts, CUDs,
  SUDs, right-sizing, idle resources, billing export, cost allocation, cloud budgets, FinOps, or wants to
  reduce their Google Cloud bill — even if they don't explicitly say "FinOps."
---

# GCP FinOps & Cost Optimization

Expert-level guidance for analyzing, managing, and reducing Google Cloud Platform costs using CLI tools, billing data in BigQuery, and the Recommender API.

## Core principles

1. **Measure before optimizing.** Always understand current spend composition before recommending changes. Query billing exports, not gut feelings.
2. **Automate discovery.** Use the Recommender API and Cloud Asset Inventory to systematically find waste — don't rely on manual console browsing.
3. **Right-size first, commit second.** Stabilize workloads through right-sizing and architecture changes before purchasing committed use discounts.
4. **Label everything.** Cost allocation without labels is guesswork. Enforce labels at the org policy level.
5. **Default to read-only.** Never purchase CUDs, delete resources, or modify budgets without explicit user confirmation. These are financial commitments or destructive actions.

## Decision framework

When a user asks about GCP costs, follow this sequence:

1. **Identify the billing account and project scope** — ask for billing account ID, project IDs, or org ID
2. **Check what billing exports exist** — standard, detailed, or pricing export to BigQuery
3. **Analyze current spend** — query billing export for cost breakdown
4. **Find optimization opportunities** — recommenders, idle resources, CUD coverage gaps
5. **Recommend and prioritize** — order by estimated savings, implementation effort, and risk
6. **Implement with guardrails** — budgets, alerts, and monitoring

## Billing export in BigQuery

GCP billing data lands in BigQuery through three export types. The **detailed usage cost** export is the richest and what you generally want.

### Export types

| Export | Table suffix | Key advantage |
|--------|-------------|---------------|
| Standard usage cost | `gcp_billing_export_v1_<BILLING_ACCOUNT_ID>` | Basic cost data, resource-level |
| Detailed usage cost | `gcp_billing_export_resource_v1_<BILLING_ACCOUNT_ID>` | Includes resource names, labels on line items |
| Pricing | `cloud_pricing_export` | SKU-level list and negotiated prices |

### Verify exports exist

```bash
# List datasets in the billing project
bq --project_id="${BILLING_PROJECT}" ls

# Check for billing export tables
bq --project_id="${BILLING_PROJECT}" ls "${BILLING_PROJECT}:${BILLING_DATASET}"
```

### Key schema fields

The detailed export table has these critical columns:

- `billing_account_id` — the billing account
- `project.id`, `project.name` — project attribution
- `service.description` — GCP service name (Compute Engine, BigQuery, etc.)
- `sku.description` — specific SKU
- `usage_start_time`, `usage_end_time` — time range
- `cost` — the cost in billing currency (before credits)
- `credits` — array of credit structs (CUD, SUD, promotions)
- `cost + SUM(credits.amount)` — **net cost** (what you actually pay)
- `labels` — array of key-value label pairs
- `resource.name`, `resource.global_name` — the actual resource
- `price.effective_price` — the price actually charged
- `cost_type` — regular, tax, rounding_error, adjustment

### Essential SQL patterns

See `references/billing-queries.md` for a comprehensive library of billing analysis queries covering cost overviews, service/SKU breakdowns, label attribution, credit analysis, anomaly detection, resource-level analysis, forecasting, egress, storage, and BigQuery costs.

The fundamental pattern for net cost (what you actually pay) is:

```sql
SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net_cost
```

Credits are negative values, so adding them to gross cost yields net cost.

Always dry-run billing queries first — these tables can be massive:

```bash
bq query \
  --project_id="${BILLING_PROJECT}" \
  --use_legacy_sql=false \
  --dry_run \
  'YOUR QUERY HERE'
```

## Committed use discounts (CUDs)

CUDs provide 1-year or 3-year discounted pricing for Compute Engine and other services. There are two types:

### Resource-based CUDs (Compute Engine)

- Commit to a specific number of vCPUs and memory in a region
- 1-year: ~57% discount; 3-year: ~70% discount
- Apply automatically to matching usage across projects in the billing account
- Cannot be cancelled once purchased

### Spend-based CUDs

- Commit to a minimum hourly spend on a service (e.g., Cloud SQL, Cloud Run)
- 1-year: ~25% discount; 3-year: ~52% discount
- Apply to eligible SKUs automatically

### Analyze CUD coverage

Use queries from `references/billing-queries.md` (Credit & Discount Analysis section) to:

- See credit breakdown by type (CUD, SUD, promotions)
- Calculate CUD coverage ratio for Compute Engine
- Identify uncovered spend eligible for CUD commitment

**Do not purchase CUDs programmatically.** CUD purchases are irreversible financial commitments. Always present findings and let the user decide through the Cloud Console.

## Recommender API

The Recommender API surfaces machine-generated optimization suggestions. Use `gcloud recommender` to query them.

### Key recommender IDs

| Recommender ID | What it finds |
|---------------|---------------|
| `google.compute.instance.MachineTypeRecommender` | Right-size VMs |
| `google.compute.instance.IdleResourceRecommender` | Idle VMs |
| `google.compute.disk.IdleResourceRecommender` | Unattached persistent disks |
| `google.compute.address.IdleResourceRecommender` | Unused static IPs |
| `google.compute.image.IdleResourceRecommender` | Old/unused custom images |
| `google.compute.commitment.UsageCommitmentRecommender` | CUD purchase recommendations |
| `google.cloudsql.instance.IdleRecommender` | Idle Cloud SQL instances |
| `google.cloudsql.instance.OverprovisionedRecommender` | Oversized Cloud SQL |
| `google.bigquery.capacityCommitments.Recommender` | BigQuery slot commitments |
| `google.run.service.CostRecommender` | Cloud Run cost optimization |
| `google.logging.productSuggestion.ContainerRecommender` | GKE logging cost |

### List recommendations

```bash
# Right-sizing recommendations for Compute Engine in a zone
gcloud recommender recommendations list \
  --project="${PROJECT_ID}" \
  --location="${ZONE}" \
  --recommender=google.compute.instance.MachineTypeRecommender \
  --format="table(name, description, primaryImpact.costProjection.cost.units, stateInfo.state)"

# Idle VMs
gcloud recommender recommendations list \
  --project="${PROJECT_ID}" \
  --location="${ZONE}" \
  --recommender=google.compute.instance.IdleResourceRecommender \
  --format="json"

# Idle persistent disks
gcloud recommender recommendations list \
  --project="${PROJECT_ID}" \
  --location="${ZONE}" \
  --recommender=google.compute.disk.IdleResourceRecommender \
  --format="json"

# Unused static IP addresses
gcloud recommender recommendations list \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --recommender=google.compute.address.IdleResourceRecommender \
  --format="json"

# CUD purchase recommendations
gcloud recommender recommendations list \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --recommender=google.compute.commitment.UsageCommitmentRecommender \
  --format="json"
```

### List insights (supporting data for recommendations)

```bash
gcloud recommender insights list \
  --project="${PROJECT_ID}" \
  --location="${ZONE}" \
  --insight-type=google.compute.instance.MachineTypeInsight \
  --format="json"
```

### Scan all zones in a project

```bash
# Iterate over all zones to find idle VMs
for ZONE in $(gcloud compute zones list --format="value(name)"); do
  echo "=== ${ZONE} ==="
  gcloud recommender recommendations list \
    --project="${PROJECT_ID}" \
    --location="${ZONE}" \
    --recommender=google.compute.instance.IdleResourceRecommender \
    --format="table(name, description, primaryImpact.costProjection.cost.units)" \
    2>/dev/null
done
```

### Acknowledging recommendations

Do not mark recommendations as claimed/dismissed without user approval — these state changes affect what appears in the console.

```bash
# Mark a recommendation as claimed (only with user approval)
gcloud recommender recommendations mark-claimed "${RECOMMENDATION_ID}" \
  --project="${PROJECT_ID}" \
  --location="${ZONE}" \
  --recommender=google.compute.instance.MachineTypeRecommender \
  --etag="${ETAG}" \
  --state-metadata=action=applied
```

## Budgets and alerts

### List billing accounts

```bash
gcloud billing accounts list --format="table(name, displayName, open)"
```

### List existing budgets

```bash
gcloud billing budgets list \
  --billing-account="${BILLING_ACCOUNT_ID}" \
  --format="table(name, displayName, amount.specifiedAmount.units, budgetFilter.projects)"
```

### Create a budget

```bash
# Monthly budget for a specific project with alert thresholds
gcloud billing budgets create \
  --billing-account="${BILLING_ACCOUNT_ID}" \
  --display-name="Monthly budget - ${PROJECT_ID}" \
  --budget-amount=1000.00USD \
  --filter-projects="projects/${PROJECT_ID}" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.8 \
  --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.2,basis=forecasted-spend
```

The `--threshold-rule` flag with `basis=forecasted-spend` triggers alerts when the *forecasted* month-end spend crosses the threshold, which gives earlier warning than actual-spend-based alerts.

### Update a budget

```bash
gcloud billing budgets update "${BUDGET_ID}" \
  --billing-account="${BILLING_ACCOUNT_ID}" \
  --budget-amount=1500.00USD
```

### Connect alerts to Pub/Sub or Monitoring

For programmatic alerting (Slack, PagerDuty, email), configure a Pub/Sub topic:

```bash
gcloud billing budgets update "${BUDGET_ID}" \
  --billing-account="${BILLING_ACCOUNT_ID}" \
  --notifications-rule-pubsub-topic="projects/${PROJECT_ID}/topics/${TOPIC_NAME}"
```

## Cloud Asset Inventory

Find orphaned and unused resources across the org.

### Search for resources

```bash
# Find all Compute Engine instances in an org
gcloud asset search-all-resources \
  --scope="organizations/${ORG_ID}" \
  --asset-types="compute.googleapis.com/Instance" \
  --format="table(name, location, state, createTime)"

# Find all unattached persistent disks (pipe to jq/python to filter)
gcloud asset search-all-resources \
  --scope="projects/${PROJECT_ID}" \
  --asset-types="compute.googleapis.com/Disk" \
  --format="json"

# Find unused static IPs
gcloud asset search-all-resources \
  --scope="projects/${PROJECT_ID}" \
  --asset-types="compute.googleapis.com/Address" \
  --format="table(name, location, additionalAttributes.status)"
```

### Export inventory for analysis

```bash
gcloud asset export \
  --project="${PROJECT_ID}" \
  --output-path="gs://${BUCKET}/asset-inventory.json" \
  --content-type=resource \
  --asset-types="compute.googleapis.com/Instance,compute.googleapis.com/Disk"
```

## Labeling strategy

Labels are the foundation of cost allocation. Without them, you can see *what* costs money but not *who* or *why*.

### Recommended label taxonomy

| Label key | Purpose | Example values |
|-----------|---------|----------------|
| `team` | Team ownership | `platform`, `data`, `ml` |
| `environment` | Lifecycle stage | `prod`, `staging`, `dev`, `sandbox` |
| `service` | Application/service | `api-gateway`, `user-service` |
| `cost-center` | Finance mapping | `eng-123`, `marketing-456` |
| `managed-by` | Provisioning tool | `terraform`, `pulumi`, `manual` |

### Enforce labels with org policies

Use Cloud Asset Inventory to audit label compliance:

```bash
gcloud asset search-all-resources \
  --scope="projects/${PROJECT_ID}" \
  --asset-types="compute.googleapis.com/Instance" \
  --format="json"
```

Then check for missing required labels (`team`, `environment`, `cost-center`) in the JSON output.

### Find unlabeled spend

Use the "Unlabeled spend by service" and "Label coverage report" queries from `references/billing-queries.md`.

## Optimization playbook

When conducting a cost review, work through these categories in priority order:

### 1. Quick wins (implement immediately)

- **Delete idle resources**: Unattached disks, unused static IPs, stopped VMs with persistent disks
- **Downsize over-provisioned resources**: Follow right-sizing recommender suggestions
- **Clean up old snapshots and images**: Remove snapshots older than retention policy
- **Review egress charges**: Identify unexpected cross-region or internet egress

### 2. Medium-term optimizations (1-2 weeks)

- **Purchase CUDs**: After confirming stable baseline, commit to 1-year or 3-year
- **Switch to preemptible/spot VMs**: For fault-tolerant batch workloads
- **Enable autoscaling**: For variable workloads, use managed instance groups or GKE autoscaler
- **Optimize storage tiers**: Move cold data to Nearline/Coldline/Archive
- **Right-size BigQuery**: Switch from on-demand to flat-rate if >$10K/month in BQ

### 3. Architectural changes (1+ months)

- **Consolidate projects**: Reduce management overhead and improve CUD utilization
- **Refactor to serverless**: Cloud Run / Cloud Functions for bursty workloads
- **Implement data lifecycle policies**: Auto-delete or archive aging data
- **Adopt Hierarchical Firewall policies**: Reduce redundant rules and associated costs

## Common investigation workflows

### "Why did our bill spike?"

1. Query billing export for day-over-day cost by service (use anomaly detection query above)
2. Drill into the spiking service by SKU
3. Check for new resources or traffic spikes
4. Look for pricing changes via the pricing export

### "How much could we save with CUDs?"

1. Query Compute Engine spend with CUD/SUD credit breakdown
2. Identify stable baseline usage (consistent for 3+ months)
3. Get CUD recommender suggestions
4. Calculate break-even: CUD savings vs. commitment risk

### "Which team is spending the most?"

1. Query billing export grouped by team label
2. Find unlabeled spend and attribute by project ownership
3. Build a cost allocation report with labeled + unlabeled attribution

### "Are we wasting money on idle resources?"

1. Run recommender scans across all zones
2. Cross-reference with Cloud Asset Inventory
3. Check billing export for resources with cost but no meaningful utilization metrics

## Safety rules

1. **Never purchase CUDs** without explicit user confirmation — these are binding financial commitments
2. **Never delete resources** based solely on recommender output — always verify with the user
3. **Never modify budgets** without confirmation — budget changes affect alerting
4. **Always dry-run billing queries** before executing — billing tables can be very large
5. **Always use `--maximum_bytes_billed`** on billing queries to prevent runaway costs
6. **Mark recommendations as claimed/dismissed** only with user approval

## Reference files

For deeper dives, read the reference files in this skill's directory:

- `references/billing-queries.md` — Comprehensive library of billing analysis SQL queries
- `references/recommender-ids.md` — Complete list of recommender and insight type IDs with descriptions
