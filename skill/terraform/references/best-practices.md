# Terraform Best Practices for Google Cloud

## Repository Conventions First

- Put environment-specific values in root `locals`, then pass them into modules.
- Use environment naming consistently: workload environment codes are `sbx`, `npd`, and `prd`; application environment names are `local`, `sandbox`, `development`, `test`, `staging`, and `production`; application environment codes are `loc`, `sbx`, `dev`, `tst`, `stg`, and `prd`.
- Prefer `default_region = "us-west1"` unless nearby code or the workload requires another region.
- Thread `resource_labels` through modules. Common labels are `deployed_by = "terraform"`, `environment`, `owner`, `cost_center`, and `application_code` where relevant.
- Keep remote lookups in `remote.tf`, providers in `versions.tf` or provider files, and backend config in `backend.tf`.
- Split large modules by resource domain (`sa.tf`, `secrets.tf`, `bigquery.tf`, `pubsub.tf`, `cloudrun.tf`, `buckets.tf`) instead of creating giant files.

## DRY Principles

**Use Modules for Reusability**
```hcl
# Bad - repeated code
resource "google_compute_network" "app1" {
  name                    = "app1-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_network" "app2" {
  name                    = "app2-vpc"
  auto_create_subnetworks = false
}

# Good - use a module
module "network_app1" {
  source = "./modules/network"

  name        = "app1"
  environment = "prod"
}

module "network_app2" {
  source = "./modules/network"

  name        = "app2"
  environment = "prod"
}
```

**Use Locals for Repeated Values**
```hcl
locals {
  application_env_map = {
    development = "dev"
    test        = "tst"
    staging     = "stg"
    production  = "prd"
  }

  application_env_code = local.application_env_map[var.application_env]
  name_prefix          = "${var.application_code}-${local.application_env_code}"

  resource_labels = {
    deployed_by      = "terraform"
    environment      = var.workload_env
    application_code = var.application_code
    owner            = var.owner
    cost_center      = var.cost_center
  }
}

resource "google_compute_network" "main" {
  name                    = "vpc-${local.name_prefix}"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "app" {
  name          = "subnet-${local.name_prefix}-app"
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = local.subnet_cidr
}
```

**Use Data Sources Instead of Hardcoding**
```hcl
# Bad - hardcoded project number
resource "google_project_iam_member" "viewer" {
  project = "123456789012"
  role    = "roles/viewer"
  member  = "group:readers@example.com"
}

# Good - discover projects in remote.tf or receive explicit project IDs from upstream state
data "google_projects" "backend" {
  filter = "name:prj-prd-app-backend* lifecycleState:ACTIVE"
}

resource "google_project_iam_member" "viewer" {
  project = data.google_projects.backend.projects[0].project_id
  role    = "roles/viewer"
  member  = "group:readers@example.com"
}
```

**Use for_each for Multiple Similar Resources**
```hcl
variable "private_subnets" {
  type = map(object({
    cidr_block = string
    region     = string
  }))
  default = {
    app = { cidr_block = "10.0.1.0/24", region = "us-central1" }
    db  = { cidr_block = "10.0.2.0/24", region = "us-central1" }
  }
}

resource "google_compute_subnetwork" "private" {
  for_each = var.private_subnets

  name                     = "${var.name}-${each.key}"
  region                   = each.value.region
  network                  = google_compute_network.main.id
  ip_cidr_range            = each.value.cidr_block
  private_ip_google_access = true
}
```

## Naming Conventions

**Resource Naming**
```hcl
# Pattern: {resource_type}_{descriptive_name}
resource "google_compute_network" "main" {}
resource "google_compute_subnetwork" "private" {}
resource "google_compute_firewall" "web" {}
resource "google_compute_instance" "app" {}

# Avoid generic names
resource "google_compute_network" "network" {} # Bad
resource "google_compute_subnetwork" "subnet" {} # Bad
resource "google_compute_network" "this" {} # Use in modules only
```

**Google Cloud Resource Names and Labels**
```hcl
locals {
  name_prefix = "${var.application_code}-${var.application_env_code}"

  resource_labels = {
    deployed_by      = "terraform"
    environment      = var.workload_env
    application_code = var.application_code
    owner            = var.owner
    cost_center      = var.cost_center
  }
}

resource "google_storage_bucket" "logs" {
  name     = "${local.name_prefix}-logs"
  location = var.location

  uniform_bucket_level_access = true
  labels                      = local.resource_labels
}

resource "google_compute_instance" "app" {
  name         = "${local.name_prefix}-app"
  machine_type = var.machine_type
  zone         = var.zone
  labels       = local.resource_labels

  boot_disk {
    initialize_params {
      image = var.image
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.private.id
  }
}
```

## Security Best Practices

**Secret Management**
```hcl
# Bad - secrets in plain text
variable "db_password" {
  default = "SuperSecret123!"
}

# Good - sensitive variable with no default
variable "db_password" {
  description = "Database password"
  type        = string
  sensitive   = true
}

# Better - Secret Manager
data "google_secret_manager_secret_version" "db_password" {
  secret  = "prod-db-password"
  version = "latest"
}

resource "google_sql_user" "app" {
  name     = "app"
  instance = google_sql_database_instance.main.name
  password = data.google_secret_manager_secret_version.db_password.secret_data
}
```

**Encryption at Rest**
```hcl
resource "google_kms_key_ring" "app" {
  name     = "app"
  location = var.region
}

resource "google_kms_crypto_key" "app" {
  name            = "app"
  key_ring        = google_kms_key_ring.app.id
  rotation_period = "7776000s"
}

resource "google_storage_bucket" "data" {
  name     = var.bucket_name
  location = var.location

  encryption {
    default_kms_key_name = google_kms_crypto_key.app.id
  }
}

resource "google_compute_disk" "data" {
  name = "${var.name}-data"
  type = "pd-ssd"
  zone = var.zone
  size = 100

  disk_encryption_key {
    kms_key_self_link = google_kms_crypto_key.app.id
  }
}
```

**Least Privilege IAM**
```hcl
# Bad - overly broad permissions
resource "google_project_iam_member" "bad" {
  project = var.project_id
  role    = "roles/owner"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# Good - narrowly scoped permissions
resource "google_storage_bucket_iam_member" "object_viewer" {
  bucket = google_storage_bucket.data.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.app.email}"
}
```

**Network Security**
```hcl
resource "google_compute_firewall" "https" {
  name    = "${var.name}-allow-https"
  network = google_compute_network.main.id

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["web"]
}

resource "google_compute_firewall" "deny_all_ingress" {
  name      = "${var.name}-deny-all-ingress"
  network   = google_compute_network.main.id
  direction = "INGRESS"
  priority  = 65534

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
}
```

## Resource Labeling

**Consistent Labeling Strategy**
```hcl
locals {
  required_labels = {
    environment = var.environment
    managed_by  = "terraform"
    project     = var.project_name
    cost_center = var.cost_center
    owner       = var.owner
  }

  optional_labels = {
    repository = "github-com-org-repo"
    terraform  = "true"
  }

  common_labels = merge(local.required_labels, local.optional_labels, var.additional_labels)
}

provider "google" {
  project = var.project_id
  region  = var.region

  default_labels = local.common_labels
}

resource "google_compute_instance" "app" {
  name         = "${var.name}-app"
  machine_type = var.machine_type
  zone         = var.zone
  labels       = merge(local.common_labels, { role = "application" })

  boot_disk {
    initialize_params {
      image = var.image
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.private.id
  }
}
```

## Cost Optimization

**Cost-Aware Resource Sizing**
```hcl
locals {
  machine_type = {
    production  = "n2-standard-4"
    staging     = "e2-standard-2"
    development = "e2-micro"
  }

  sql_tier = {
    production  = "db-custom-4-15360"
    staging     = "db-custom-2-7680"
    development = "db-f1-micro"
  }

  availability_type = var.environment == "production" ? "REGIONAL" : "ZONAL"
}

resource "google_compute_instance" "app" {
  machine_type = local.machine_type[var.environment]
}

resource "google_sql_database_instance" "main" {
  name             = "${var.name}-db"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier              = local.sql_tier[var.environment]
    availability_type = local.availability_type
  }
}
```

**Lifecycle Management**
```hcl
resource "google_compute_instance_template" "app" {
  name_prefix  = "${var.name}-app-"
  machine_type = var.machine_type

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_storage_bucket" "data" {
  name     = var.bucket_name
  location = var.location

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type = "Delete"
    }
  }
}
```

**Resource Scheduling**
```hcl
resource "google_cloud_scheduler_job" "stop_dev_instances" {
  name      = "stop-dev-instances"
  schedule  = "0 20 * * MON-FRI"
  time_zone = "Etc/UTC"

  http_target {
    uri         = google_cloudfunctions2_function.scheduler.service_config[0].uri
    http_method = "POST"
    body        = base64encode(jsonencode({ action = "stop", environment = "development" }))
  }
}
```

## Code Organization

**Directory Structure**
```
terraform/
├── environments/
│   ├── production/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── terraform.tfvars
│   │   └── backend.tf
│   ├── staging/
│   └── development/
├── modules/
│   ├── network/
│   ├── gke/
│   └── cloud-sql/
├── global/
│   ├── iam/
│   └── dns/
└── README.md
```

**Module Best Practices**
```hcl
# modules/network/variables.tf
variable "subnet_cidr" {
  description = "CIDR block for the application subnet"
  type        = string
  validation {
    condition     = can(cidrhost(var.subnet_cidr, 0))
    error_message = "subnet_cidr must be a valid IPv4 CIDR block."
  }
}

# modules/network/outputs.tf
output "network_id" {
  description = "ID of the VPC network"
  value       = google_compute_network.this.id
}

# modules/network/versions.tf
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}
```

## Best Practices Checklist

- [ ] Use GCS remote state with locking
- [ ] Pin Terraform and Google provider versions
- [ ] Validate all input variables
- [ ] Use consistent naming conventions
- [ ] Label supported resources for cost tracking
- [ ] Encrypt sensitive data at rest and in transit
- [ ] Implement least privilege IAM policies
- [ ] Use modules for reusable components
- [ ] Document module interfaces
- [ ] Run terraform fmt before commit
- [ ] Run terraform validate in CI/CD
- [ ] Review plan output before apply
- [ ] Use data sources instead of hardcoding
- [ ] Implement automated testing
- [ ] Use for_each instead of count for repeated resources
- [ ] Avoid hardcoded secrets
- [ ] Enable logging and monitoring
- [ ] Implement cost optimization strategies
- [ ] Use lifecycle rules appropriately
- [ ] Keep modules focused and single-purpose
