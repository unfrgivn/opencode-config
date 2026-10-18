---
name: terraform-search-import
description: Discover existing Google Cloud resources and import them into Terraform state safely. Use when bringing unmanaged GCP resources under Terraform, auditing drift before import, writing config-driven `import` blocks, using Terraform Search/list resources where provider support exists, or falling back to manual `gcloud` discovery. Pair with the `terraform` skill for repository-specific GCP layout, state, provider auth, labels, modules, and validation.
---

# Terraform Search and Import

Use this skill only for discovery/import workflows. Keep final configuration aligned with `terraform`, especially GCS state, `remote.tf`, provider impersonation, module boundaries, labels, and validation.

## Safety Rules

- Plan first, apply only when explicitly appropriate.
- Import into the correct root and backend prefix. Do not import production resources into scratch local state.
- Back up state before manual state operations: `terraform state pull > terraform.tfstate.backup`.
- Clean generated configuration before review: remove computed attributes, add variables/locals, labels, and repository naming.
- Prefer config-driven `import` blocks over ad hoc CLI import when producing reviewable changes.

## Workflow

1. Identify the target root, resource type, project, region, and backend.
2. Run `terraform init` using the repo's established wrapper or direct root workflow.
3. Check whether the provider exposes Terraform Search list resources with `scripts/list_resources.sh google`.
4. If supported and Terraform version supports the workflow, use `.tfquery.hcl` and `terraform query` to generate candidates.
5. If unsupported, load `references/MANUAL-IMPORT.md` and discover resources with `gcloud` or provider data sources.
6. Convert generated or discovered resources into repository module/root patterns.
7. Run `terraform fmt`, `terraform validate`, and `terraform plan` to verify import behavior.

## Terraform Search Sketch

```hcl
# discovery.tfquery.hcl
provider "google" {
  project = var.project_id
  region  = var.default_region
}

list "google_storage_bucket" "candidate_buckets" {
  provider = google
  limit    = 50
}
```

```bash
terraform query
terraform query -generate-config-out=generated-imports.tf
```

Provider list-resource support varies by Terraform and provider version. Verify support before committing to this path.

## Config-Driven Import Sketch

```hcl
resource "google_storage_bucket" "assets" {
  project                     = var.project_id
  name                        = "bkt-app-prd-assets-abcd"
  location                    = "US-WEST1"
  uniform_bucket_level_access = true
  labels                      = local.resource_labels
}

import {
  to = google_storage_bucket.assets
  id = "bkt-app-prd-assets-abcd"
}
```

## Helper Script

Use `scripts/list_resources.sh` from an initialized Terraform root to list provider-supported Search resources. The script intentionally refuses to run before `terraform init`, because silently initializing or upgrading providers during discovery is how gremlins get tenure.
