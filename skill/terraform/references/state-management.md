# Terraform State Management for Google Cloud

Use the repository’s staged-foundation and application GitOps patterns before using generic Terraform layouts.

## Preferred Layouts

### Foundation stages

Foundation Terraform is layered by stage and environment. Each leaf is a Terraform root applied independently and in sequence.

```text
stages/
├── 0-bootstrap/common
├── 1-org/common
├── 2-environments/envs/{sandbox,nonprod,prod}
├── 3-network/envs/{sandbox,nonprod,prod}
├── 4-kubernetes/envs/{sandbox,nonprod,prod}
├── 5-services/envs/{sandbox,nonprod,prod}
└── 6-applications/envs/{sandbox,nonprod,prod,common}
```

### Application GitOps Terraform

Application Terraform uses one root per application environment plus reusable modules.

```text
terraform/
├── envs/
│   ├── development
│   ├── test
│   ├── sandbox
│   └── production
└── modules/
    ├── application-core
    ├── data-pipeline
    ├── cloud-storage
    └── ...
```

## Backend Patterns

### Foundation backend

Foundation roots keep the state prefix in `backend.tf` and pass the bucket through repository-level `backend.hcl` during wrapper initialization.

```hcl
# stages/3-network/envs/sandbox/backend.tf
terraform {
  backend "gcs" {
    prefix = "terraform/networks/sandbox"
  }
}
```

```hcl
# backend.hcl
bucket = "bkt-prj-b-seed-tfstate-2714"
```

Initialize through the wrapper when working in staged foundation Terraform:

```bash
export GCP_SEED_PROJECT_ID="<seed-project-id>"
export GOOGLE_IMPERSONATE_SERVICE_ACCOUNT="sa-terraform-<stage>@<seed-project-id>.iam.gserviceaccount.com"
./tf-wrapper.sh init network
./tf-wrapper.sh plan network
```

The wrapper uses `terraform init -upgrade -force-copy -reconfigure -backend-config=backend.hcl` and writes plans under `.tmp_plan/`.

### Application backend

Application roots can declare both bucket and prefix directly.

```hcl
# envs/production/backend.tf
terraform {
  backend "gcs" {
    bucket = "bkt-app-prd-tfstate-abcd"
    prefix = "terraform/application"
  }
}
```

## Remote State and Project Discovery

Put upstream dependencies in `remote.tf`, then expose simple locals to the rest of the root or module. Do not scatter `terraform_remote_state` and project search data sources throughout unrelated files.

### Foundation remote state

```hcl
locals {
  org_id              = data.terraform_remote_state.bootstrap.outputs.common_config.org_id
  base_vpc_project_id = data.terraform_remote_state.environments.outputs.env_base_shared_vpc_host_project_id
  default_region1     = data.terraform_remote_state.bootstrap.outputs.common_config.default_region
}

data "terraform_remote_state" "bootstrap" {
  backend = "gcs"

  config = {
    bucket = var.remote_state_bucket
    prefix = "terraform/bootstrap/state"
  }
}

data "terraform_remote_state" "environments" {
  backend = "gcs"

  config = {
    bucket = var.remote_state_bucket
    prefix = "terraform/environments/sandbox"
  }
}
```

### Application project discovery

```hcl
locals {
  project_id_backend  = data.google_projects.env_app_project_search_backend.projects[0].project_id
  project_id_registry = data.google_projects.project_search_registry.projects[0].project_id
}

data "google_projects" "project_search_registry" {
  filter = "name:prj-c-registry lifecycleState:ACTIVE"
}

data "google_projects" "env_app_project_search_backend" {
  filter = "name:prj-prd-app-backend* lifecycleState:ACTIVE"
}
```

## State Operations

```bash
terraform state list
terraform state show google_compute_network.main
terraform import google_compute_network.main projects/my-project/global/networks/vpc-sbx-shared-base
terraform state mv google_compute_instance.old google_compute_instance.new
terraform state rm google_compute_instance.example
terraform state pull > terraform.tfstate.backup
```

Use `terraform plan -refresh-only` to inspect drift before deciding whether to import, remove, or update resources.

## Best Practices

- Keep one state prefix per environment/layer or app root.
- Prefer `remote.tf` for state and project lookups.
- Preserve existing backend prefixes unless intentionally migrating state.
- Do not use local state for shared foundation or application environments.
- In foundation, use the wrapper unless the user explicitly asks for direct Terraform commands.
- In application Terraform, run commands from the target `envs/<env>` root.
- Never commit state files, `.terraform/`, or generated plan files.
- Use service account impersonation for local foundation work.
