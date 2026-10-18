# Terraform Module Patterns for Google Cloud

Prefer the established split between environment roots and reusable modules:

- Environment roots own environment/application locals, backend configuration, remote lookups, and top-level module calls.
- Reusable modules own resources for a focused capability and receive project IDs, regions, environment codes, labels, and secrets as explicit inputs.
- Foundation code can use pinned CFT modules where they fit. Application code can compose smaller reusable modules for services, buckets, service accounts, Pub/Sub, BigQuery, Cloud Run, and CDN.

## Module Structure

```
modules/cloud-storage/
├── main.tf
├── bucket.tf
├── variables.tf
├── outputs.tf
└── versions.tf
```

For large modules, split by resource domain (`sa.tf`, `secrets.tf`, `bigquery.tf`, `pubsub.tf`, `cloudrun.tf`, `firewall.tf`) instead of piling everything into `main.tf` like a landfill with syntax highlighting.

## Environment Root Pattern

```hcl
locals {
  workload_env_code = "prd"
  application_env   = "production"
  application_code  = "app"
  application_name  = "application"
  k8s_namespace     = "application"
  default_region    = "us-west1"

  default_docker_registry = "us-west1-docker.pkg.dev/prj-c-registry-abcd/registry-docker"
}

module "application" {
  source = "../../modules/application"

  application_code  = local.application_code
  application_name  = local.application_name
  workload_env_code = local.workload_env_code
  application_env   = local.application_env
  default_region    = local.default_region
  k8s_namespace     = local.k8s_namespace

  docker_images = {
    api    = "${local.default_docker_registry}/api:${var.image_tag_api}"
    worker = "${local.default_docker_registry}/worker:${var.image_tag_worker}"
  }
}
```

## Basic Module Pattern

**main.tf**
```hcl
locals {
  bucket_short_name = "${var.application_code}-${var.application_env_code}-assets"
}

resource "google_storage_bucket" "bucket" {
  project                     = var.project_id
  name                        = "bkt-${local.bucket_short_name}-${random_string.bucket_suffix.result}"
  location                    = var.default_region
  labels                      = var.resource_labels
  force_destroy               = var.bucket_force_destroy
  uniform_bucket_level_access = true
}

resource "random_string" "bucket_suffix" {
  length  = 4
  special = false
  upper   = false
}
```

**variables.tf**
```hcl
variable "application_code" {
  description = "Short application code."
  type        = string
}

variable "application_env_code" {
  description = "Short application environment code."
  type        = string
}

variable "project_id" {
  description = "Google Cloud project ID where resources are created."
  type        = string
}

variable "default_region" {
  description = "Default region for regional resources."
  type        = string
  default     = "us-west1"
}

variable "resource_labels" {
  description = "Labels to apply to supported resources."
  type        = map(string)
  default     = {}
}

variable "bucket_force_destroy" {
  description = "Whether to allow destroying a non-empty bucket."
  type        = bool
  default     = false
}
```

**outputs.tf**
```hcl
output "bucket_name" {
  description = "Created bucket name."
  value       = google_storage_bucket.bucket.name
}
```

**versions.tf**
```hcl
terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 7.0.0"
    }

    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}
```

## Module Composition

```hcl
locals {
  application_env_map = {
    local       = "loc"
    sandbox     = "sbx"
    development = "dev"
    test        = "tst"
    staging     = "stg"
    production  = "prd"
  }

  workload_env_code_map = {
    sbx = "sandbox"
    npd = "nonprod"
    prd = "prod"
  }

  application_env_code = local.application_env_map[var.application_env]
  workload_env         = local.workload_env_code_map[var.workload_env_code]

  resource_labels = {
    deployed_by = "terraform"
    environment = local.workload_env
    owner       = var.owner
    cost_center = var.cost_center
  }
}

module "service" {
  source = "../service"

  application_env_code = local.application_env_code
  workload_env_code    = var.workload_env_code
  default_region       = var.default_region
  resource_labels      = local.resource_labels
}
```

## Cloud Run Pattern

```hcl
resource "google_cloud_run_v2_service" "default" {
  provider = google-beta

  project  = var.project_id_backend
  name     = "runsvc-${local.service_name}"
  location = var.default_region

  template {
    service_account = google_service_account.service.email
    labels          = var.resource_labels

    containers {
      image = var.docker_image

      dynamic "env" {
        for_each = var.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}
```

## IAM and WIF Bindings

```hcl
locals {
  ksa_api = "sa-api"

  wif_member_api = "principal://iam.googleapis.com/projects/${var.project_number_ek8s}/locations/global/workloadIdentityPools/${var.project_id_ek8s}.svc.id.goog/subject/ns/${var.k8s_namespace}/sa/${local.ksa_api}"

  api_project_roles = {
    (var.project_id_backend) = [
      "roles/bigquery.jobUser",
      "roles/secretmanager.secretAccessor",
      "roles/storage.objectUser",
    ]
  }

  api_iam_bindings = {
    for binding in flatten([
      for project, roles in local.api_project_roles : [
        for role in roles : {
          project_id = project
          role       = role
        }
      ]
    ]) : "${binding.project_id}-${binding.role}" => binding
  }
}

resource "google_project_iam_member" "api_project_roles" {
  for_each = local.api_iam_bindings

  project = each.value.project_id
  role    = each.value.role
  member  = local.wif_member_api
}
```

## Secret Manager Pattern

```hcl
resource "google_secret_manager_secret" "api_token" {
  project   = var.project_id_base
  secret_id = "api-token"
  labels    = var.resource_labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "api_token" {
  secret      = google_secret_manager_secret.api_token.id
  secret_data = var.api_token
}
```

## Dynamic Blocks

```hcl
resource "google_storage_bucket" "bucket" {
  project                     = var.project_id
  name                        = var.bucket_name
  location                    = var.default_region
  uniform_bucket_level_access = true

  dynamic "cors" {
    for_each = var.cors_settings
    content {
      max_age_seconds = cors.value.max_age_seconds
      method          = cors.value.method
      origin          = cors.value.origin
      response_header = cors.value.response_header
    }
  }
}
```

## Conditional Resources

```hcl
module "optional_service" {
  source = "../optional-service"
  count  = var.service_enabled ? 1 : 0

  application_env_code = local.application_env_code
  workload_env_code    = var.workload_env_code
  resource_labels      = local.resource_labels
}

module "named_instances" {
  source = "../named-instance"

  for_each = var.instances

  instance_name = each.key
  config        = each.value
}
```

## Module Versioning

```hcl
module "network" {
  source  = "terraform-google-modules/network/google"
  version = "~> 12.0"

  project_id   = var.project_id
  network_name = "prod-vpc"
}

module "gke" {
  source  = "terraform-google-modules/kubernetes-engine/google"
  version = "~> 30.0"

  project_id = var.project_id
  name       = "prod-gke"
  region     = var.region
}
```

Prefer local `../module-name` sources for app modules in the same Terraform tree unless publishing/shared reuse is intended.

## Module Testing Example

```hcl
module "storage_test" {
  source = "../.."

  application_code     = "app"
  application_env_code = "dev"
  project_id           = var.project_id
  default_region       = "us-west1"
  resource_labels      = { deployed_by = "terraform", environment = "nonprod" }
}

output "bucket_name" {
  value = module.storage_test.bucket_name
}
```

## Best Practices

- Keep modules focused and single-purpose
- Use `for_each` over `count` for repeated named resources; use `count` for simple feature flags that match existing code
- Validate all inputs with validation blocks
- Document all variables and outputs
- Use semantic versioning (MAJOR.MINOR.PATCH)
- Provide complete examples
- Test modules before publishing
- Use consistent naming conventions
- Thread `resource_labels` through modules and apply labels to resources that support them
- Avoid hardcoded project IDs, regions, and secrets
