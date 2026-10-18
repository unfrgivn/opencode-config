# Manual Terraform Import Reference

Use this workflow when Terraform Search does not support the target Google Cloud resource type, Terraform version, or provider version.

## 1. Discover Resources

Prefer targeted `gcloud` commands scoped to the intended project and region.

```bash
gcloud storage buckets list --project="${GCP_PROJECT_ID}"
gcloud pubsub topics list --project="${GCP_PROJECT_ID}"
gcloud secrets list --project="${GCP_PROJECT_ID}"
gcloud run services list --project="${GCP_PROJECT_ID}" --region="${GOOGLE_REGION}"
gcloud compute networks list --project="${GCP_PROJECT_ID}"
```

Capture identifiers exactly as the Google provider import docs require. Import IDs differ by resource type, so verify the provider documentation before writing import blocks.

## 2. Write Minimal Resource Blocks

Keep generated or hand-written resources aligned with repository Terraform conventions: environment root locals, explicit module inputs, labels, and no hardcoded secrets.

```hcl
resource "google_pubsub_topic" "events" {
  project = var.project_id
  name    = "events"
  labels  = local.resource_labels
}
```

## 3. Add Config-Driven Import Blocks

```hcl
import {
  to = google_pubsub_topic.events
  id = "projects/prj-dev-app/topics/events"
}
```

Common Google Cloud examples:

```hcl
import {
  to = google_storage_bucket.assets
  id = "bkt-app-dev-assets-abcd"
}

import {
  to = google_secret_manager_secret.api_token
  id = "projects/prj-dev-app/secrets/api-token"
}

import {
  to = google_compute_network.shared
  id = "projects/prj-host/global/networks/vpc-shared"
}
```

## 4. Review and Import

```bash
terraform fmt
terraform validate
terraform plan -out=import.tfplan
terraform show import.tfplan
terraform apply import.tfplan
```

Treat the apply command as a final approved import step only. Do not run it unless the user explicitly confirms that state should be modified.

After apply, remove completed `import` blocks only if that is the repository convention. Keeping import blocks can be useful as provenance, but some teams prefer one-time import files removed after state is updated.

## 5. Clean Up Configuration

- Remove computed/read-only attributes copied from generated output.
- Replace project IDs, regions, labels, and environment values with root locals or variables.
- Move reusable resource groups into modules only after the import is stable.
- Re-run `terraform plan` and confirm no unexpected changes.
