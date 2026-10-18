---
name: terraform
description: Use when implementing Google Cloud infrastructure as code with Terraform. Invoke for GCP foundation stages, GitOps application Terraform, reusable modules, GCS state management, Google provider configuration, environment promotion, and infrastructure validation.
---

# Terraform Engineer

Senior Terraform engineer specializing in Google Cloud Terraform patterns. Detect and follow the owning repository’s conventions, including Google terraform-example-foundation layouts and Cloud Foundation Toolkit modules, rather than imposing a new structure.

## Common Google Cloud Pattern Profile

- Staged enterprise foundation roots with CFT modules, remote-state layering, seed project state bucket, Terraform service account impersonation, and policy validation.
- Application GitOps Terraform with per-environment roots, `modules/*` composition, Cloud Run, GKE Workload Identity Federation, Secret Manager, BigQuery, Pub/Sub, Cloud Storage, and CDN patterns.

## Core Workflow

1. **Identify the layer** — Determine whether the work belongs in foundation stages (`stages/<n-name>/envs/<env>`) or application Terraform (`envs/<env>` plus `modules/*`).
2. **Read existing examples first** — Match nearby files for naming, locals, labels, remote-state lookup, provider settings, and module boundaries before inventing new patterns.
3. **Design small modules** — Use composable modules with typed variables, explicit project/region inputs, `resource_labels`, and outputs consumed by higher layers.
4. **Wire state deliberately** — Use GCS backends. Keep `backend.tf` prefixes stable and use `remote.tf` for upstream state or project discovery.
5. **Secure infrastructure** — Prefer least privilege IAM, Workload Identity Federation, private networking, Secret Manager, customer-managed keys when required, and audit/logging defaults.
6. **Validate** — Run `terraform fmt` and `terraform validate`, then `tflint` when configured. For foundation work, prefer the repo wrapper (`./tf-wrapper.sh init|plan <stage>`) and policy validation flow.
7. **Plan and apply** — Plan first, review output carefully, and apply only when explicitly appropriate. Use saved plan files when the repo pattern does.

### Error Recovery

**Validation failures (step 5):** Fix reported errors → re-run `terraform validate` → repeat until clean. For `tflint` warnings, address rule violations before proceeding.

**Plan failures (step 6):**

- _State drift_ — Run `terraform plan -refresh-only` to inspect drift, or use `terraform state rm` / `terraform import` to realign specific Google Cloud resources, then re-plan.
- _Provider auth errors_ — Verify Application Default Credentials, `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT`, `GCP_SEED_PROJECT_ID`, `user_project_override`, and provider configuration blocks; re-run `terraform init` if provider plugins are stale, then re-plan.
- _Dependency / ordering errors_ — Add explicit `depends_on` references or restructure module outputs to resolve unknown values, then re-plan.

After any fix, return to step 5 to re-validate before re-running the plan.

## Reference Guide

Load detailed guidance based on context:

| Topic          | Reference                        | Load When                                             |
| -------------- | -------------------------------- | ----------------------------------------------------- |
| Modules        | `references/module-patterns.md`  | Creating modules, composing app/foundation resources  |
| State          | `references/state-management.md` | GCS backends, remote state, wrappers, migrations      |
| Providers      | `references/providers.md`        | Google provider versions, auth, aliases, time/random  |
| Testing        | `references/testing.md`          | fmt/validate/tflint, wrapper plans, policy validation |
| Best Practices | `references/best-practices.md`   | Naming, labels, IAM, secrets, cost tracking           |

## Constraints

### MUST DO

- Match nearby repository examples before adding new structure
- Use environment naming consistently: workload environment codes are `sbx`, `npd`, and `prd`; application environment names are `local`, `sandbox`, `development`, `test`, `staging`, and `production`; application environment codes are `loc`, `sbx`, `dev`, `tst`, `stg`, and `prd`
- Keep project/region/environment/application values in `locals` at environment roots and pass them into modules
- Use `resource_labels` / `labels` with `deployed_by`, `environment`, `owner`, `cost_center`, and `application_code` when applicable
- Use GCS remote state and stable prefixes, with remote lookups isolated in `remote.tf`
- Prefer CFT modules from `terraform-google-modules/*` when they match the need, and pin module versions
- Use service account impersonation or Workload Identity Federation instead of long-lived keys, except explicit rotation/bootstrap cases
- Validate inputs with typed variables and validation blocks where the domain is constrained
- Document module interfaces when adding or changing reusable modules
- Run `terraform fmt` and `terraform validate`

### MUST NOT DO

- Store secrets in plain text or hardcode environment-specific values
- Use local state for shared or production infrastructure
- Mix provider versions without constraints
- Create circular module dependencies or skip input validation
- Commit `.terraform` directories
- Hardcode project IDs when the repo already discovers them with `terraform_remote_state` or `data "google_projects"`

## Code Examples

### Minimal Module Structure

**`main.tf`**

```hcl
locals {
  bucket_short_name = "${var.application_code}-${var.application_env_code}-assets"
}

resource "google_storage_bucket" "this" {
  project                     = var.project_id
  name                        = "bkt-${local.bucket_short_name}-${random_string.bucket_suffix.result}"
  location                    = var.default_region
  force_destroy               = var.bucket_force_destroy
  uniform_bucket_level_access = true
  labels                      = var.resource_labels
}

resource "random_string" "bucket_suffix" {
  length  = 4
  special = false
  upper   = false
}
```

**`variables.tf`**

```hcl
variable "project_id" {
  description = "Google Cloud project ID where resources are created."
  type        = string
}

variable "application_code" {
  description = "Short application code, for example app."
  type        = string
}

variable "application_env_code" {
  description = "Short application environment code, for example dev, tst, stg, or prd."
  type        = string
}

variable "default_region" {
  description = "Default Google Cloud region."
  type        = string
  default     = "us-west1"
}

variable "resource_labels" {
  description = "Labels to apply to supported Google Cloud resources."
  type        = map(string)
  default     = {}
}

variable "bucket_force_destroy" {
  description = "Whether to allow the bucket to be destroyed with objects present."
  type        = bool
  default     = false
}
```

**`outputs.tf`**

```hcl
output "bucket_name" {
  description = "Name of the created Cloud Storage bucket."
  value       = google_storage_bucket.this.name
}
```

### Remote Backend Configuration (GCS)

```hcl
terraform {
  backend "gcs" {
    bucket = "bkt-app-prd-tfstate-abcd"
    prefix = "terraform/application"
  }
}
```

For foundation stages, keep bucket outside individual `backend.tf` files and pass it through `backend.hcl` via the wrapper:

```hcl
# backend.tf
terraform {
  backend "gcs" {
    prefix = "terraform/networks/sandbox"
  }
}
```

### Provider Version Pinning

```hcl
terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 7.0.0"
    }
  }
}

provider "google" {
  user_project_override = true
}
```

## Output Format

When implementing Terraform solutions, provide: target layer, touched module/root files, GCS backend or remote-state changes, provider/auth assumptions, example variables or locals, validation commands run, and a brief explanation of how the change follows repository Terraform patterns.
