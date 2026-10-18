# GCP Recommender & Insight Type IDs

Complete reference of recommender IDs and insight types for cost optimization. Use with `gcloud recommender recommendations list` and `gcloud recommender insights list`.

## Command syntax

```bash
# List recommendations
gcloud recommender recommendations list \
  --project="${PROJECT_ID}" \
  --location="${LOCATION}" \
  --recommender="${RECOMMENDER_ID}" \
  --format="json"

# List insights
gcloud recommender insights list \
  --project="${PROJECT_ID}" \
  --location="${LOCATION}" \
  --insight-type="${INSIGHT_TYPE_ID}" \
  --format="json"
```

**Location note:** Use `zone` (e.g., `us-central1-a`) for instance-level recommenders and `region` (e.g., `us-central1`) for regional resources like addresses and commitments. Some recommenders use `global`.

---

## Compute Engine

### Recommenders

| Recommender ID | Description | Location type |
|---------------|-------------|---------------|
| `google.compute.instance.MachineTypeRecommender` | Right-size VM instances based on utilization | zone |
| `google.compute.instance.IdleResourceRecommender` | Identify idle/underutilized VMs | zone |
| `google.compute.disk.IdleResourceRecommender` | Unattached or idle persistent disks | zone |
| `google.compute.address.IdleResourceRecommender` | Unused static external IP addresses | region |
| `google.compute.image.IdleResourceRecommender` | Old or unused custom images | global |
| `google.compute.commitment.UsageCommitmentRecommender` | CUD purchase recommendations | region |

### Insight Types

| Insight Type ID | Description | Location type |
|----------------|-------------|---------------|
| `google.compute.instance.MachineTypeInsight` | VM utilization data supporting right-sizing | zone |
| `google.compute.instance.IdleResourceInsight` | Evidence of VM idleness | zone |
| `google.compute.disk.IdleResourceInsight` | Evidence of disk non-use | zone |
| `google.compute.address.IdleResourceInsight` | Evidence of IP non-use | region |
| `google.compute.image.IdleResourceInsight` | Evidence of image staleness | global |

---

## Cloud SQL

| Recommender ID | Description | Location type |
|---------------|-------------|---------------|
| `google.cloudsql.instance.IdleRecommender` | Idle Cloud SQL instances | region |
| `google.cloudsql.instance.OverprovisionedRecommender` | Oversized Cloud SQL instances | region |
| `google.cloudsql.instance.OutOfDiskRecommender` | Instances at risk of running out of disk | region |

| Insight Type ID | Description | Location type |
|----------------|-------------|---------------|
| `google.cloudsql.instance.IdleInsight` | Evidence of Cloud SQL idleness | region |
| `google.cloudsql.instance.OverprovisionedInsight` | Utilization data for over-provisioning | region |

---

## BigQuery

| Recommender ID | Description | Location type |
|---------------|-------------|---------------|
| `google.bigquery.capacityCommitments.Recommender` | Slot commitment recommendations | region |
| `google.bigquery.table.PartitionClusterRecommender` | Partition and cluster table recommendations | region |

---

## GKE / Kubernetes

| Recommender ID | Description | Location type |
|---------------|-------------|---------------|
| `google.container.DiagnosisRecommender` | GKE cluster diagnostics | zone |
| `google.gke.nodepool.AutoscalingRecommender` | Node pool autoscaling adjustments | zone |

---

## Cloud Run

| Recommender ID | Description | Location type |
|---------------|-------------|---------------|
| `google.run.service.CostRecommender` | Cloud Run service cost optimization | region |
| `google.run.service.SecurityRecommender` | Cloud Run security improvements | region |

---

## Logging & Monitoring

| Recommender ID | Description | Location type |
|---------------|-------------|---------------|
| `google.logging.productSuggestion.ContainerRecommender` | Optimize GKE logging costs | global |

---

## IAM (cost-adjacent — avoid over-provisioned access)

| Recommender ID | Description | Location type |
|---------------|-------------|---------------|
| `google.iam.policy.Recommender` | Remove unused IAM role bindings | global |

| Insight Type ID | Description | Location type |
|----------------|-------------|---------------|
| `google.iam.policy.Insight` | Unused IAM permissions evidence | global |

---

## Scanning multiple zones/regions

Recommendations are location-scoped, so a full-project scan requires iterating:

### Scan all zones (for instance-level recommenders)

```bash
for ZONE in $(gcloud compute zones list --format="value(name)" --project="${PROJECT_ID}"); do
  RESULT=$(gcloud recommender recommendations list \
    --project="${PROJECT_ID}" \
    --location="${ZONE}" \
    --recommender=google.compute.instance.IdleResourceRecommender \
    --format="value(name)" 2>/dev/null)
  if [ -n "${RESULT}" ]; then
    echo "=== ${ZONE} ==="
    gcloud recommender recommendations list \
      --project="${PROJECT_ID}" \
      --location="${ZONE}" \
      --recommender=google.compute.instance.IdleResourceRecommender \
      --format="table(name.segment(7):label=INSTANCE, description, primaryImpact.costProjection.cost.units:label=SAVINGS_USD, stateInfo.state)"
  fi
done
```

### Scan all regions (for regional recommenders)

```bash
for REGION in $(gcloud compute regions list --format="value(name)" --project="${PROJECT_ID}"); do
  RESULT=$(gcloud recommender recommendations list \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --recommender=google.compute.address.IdleResourceRecommender \
    --format="value(name)" 2>/dev/null)
  if [ -n "${RESULT}" ]; then
    echo "=== ${REGION} ==="
    gcloud recommender recommendations list \
      --project="${PROJECT_ID}" \
      --location="${REGION}" \
      --recommender=google.compute.address.IdleResourceRecommender \
      --format="table(name.segment(7):label=ADDRESS, description, primaryImpact.costProjection.cost.units:label=SAVINGS_USD)"
  fi
done
```

### Comprehensive cost optimization scan

Run all cost-relevant recommenders for a project:

```bash
RECOMMENDERS=(
  "google.compute.instance.MachineTypeRecommender"
  "google.compute.instance.IdleResourceRecommender"
  "google.compute.disk.IdleResourceRecommender"
)
REGIONAL_RECOMMENDERS=(
  "google.compute.address.IdleResourceRecommender"
  "google.compute.commitment.UsageCommitmentRecommender"
)

echo "=== Zone-scoped recommenders ==="
for REC in "${RECOMMENDERS[@]}"; do
  echo ""
  echo "--- ${REC} ---"
  for ZONE in $(gcloud compute zones list --format="value(name)" --project="${PROJECT_ID}"); do
    gcloud recommender recommendations list \
      --project="${PROJECT_ID}" \
      --location="${ZONE}" \
      --recommender="${REC}" \
      --format="table(name.segment(7), description, primaryImpact.costProjection.cost.units)" \
      2>/dev/null | grep -v "^$"
  done
done

echo ""
echo "=== Region-scoped recommenders ==="
for REC in "${REGIONAL_RECOMMENDERS[@]}"; do
  echo ""
  echo "--- ${REC} ---"
  for REGION in $(gcloud compute regions list --format="value(name)" --project="${PROJECT_ID}"); do
    gcloud recommender recommendations list \
      --project="${PROJECT_ID}" \
      --location="${REGION}" \
      --recommender="${REC}" \
      --format="table(name.segment(7), description, primaryImpact.costProjection.cost.units)" \
      2>/dev/null | grep -v "^$"
  done
done
```

---

## Recommendation states

Recommendations go through these states:

| State | Meaning |
|-------|---------|
| `ACTIVE` | Available for action |
| `CLAIMED` | Marked as being acted on |
| `SUCCEEDED` | Applied successfully |
| `FAILED` | Application failed |
| `DISMISSED` | User chose to ignore |

### State transitions (require `--etag`)

```bash
# Mark as claimed
gcloud recommender recommendations mark-claimed "${REC_ID}" \
  --project="${PROJECT_ID}" --location="${LOCATION}" \
  --recommender="${RECOMMENDER_ID}" --etag="${ETAG}"

# Mark as succeeded
gcloud recommender recommendations mark-succeeded "${REC_ID}" \
  --project="${PROJECT_ID}" --location="${LOCATION}" \
  --recommender="${RECOMMENDER_ID}" --etag="${ETAG}"

# Dismiss
gcloud recommender recommendations mark-dismissed "${REC_ID}" \
  --project="${PROJECT_ID}" --location="${LOCATION}" \
  --recommender="${RECOMMENDER_ID}" --etag="${ETAG}"
```

Never change recommendation state without explicit user approval.
