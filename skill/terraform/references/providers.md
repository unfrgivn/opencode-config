# Terraform Provider Configuration for Google Cloud

## Version Constraints

Match the repo you are changing. Current repository examples use Terraform `>= 1.5`; application Terraform may use Google provider `>= 7.0.0`, while foundation modules often let roots or lock files select compatible provider versions.

```hcl
terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 7.0.0"
    }

    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 7.0.0"
    }

    time = {
      source  = "hashicorp/time"
      version = "0.12.0"
    }
  }
}
```

For reusable foundation modules, keep constraints minimal when the root owns provider selection:

```hcl
terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source = "hashicorp/google"
    }

    google-beta = {
      source = "hashicorp/google-beta"
    }
  }
}
```

## Provider Configuration

### Application roots

Application roots commonly use `user_project_override = true` for both stable and beta providers.

```hcl
provider "google" {
  user_project_override = true
}

provider "google-beta" {
  user_project_override = true
}

provider "time" {}
```

### Foundation roots

Foundation roots may tune provider behavior directly, for example request timeouts for slower control-plane operations.

```hcl
provider "google" {
  request_timeout = "5m"
}

provider "google-beta" {
  request_timeout = "5m"
}
```

## Authentication

### Foundation local work

Use stage-specific Terraform service account impersonation.

```bash
export GCP_SEED_PROJECT_ID="<seed-project-id>"
export GOOGLE_IMPERSONATE_SERVICE_ACCOUNT="sa-terraform-network@<seed-project-id>.iam.gserviceaccount.com"
./tf-wrapper.sh init network
./tf-wrapper.sh plan network
```

### Application roots

Use Application Default Credentials or CI identity that has access to the target projects. Prefer impersonation or Workload Identity Federation over long-lived service account keys.

```hcl
provider "google" {
  user_project_override = true
}
```

## Google Beta Provider

Use `google-beta` only where required by a resource or field. Keep the provider explicit on those resources.

```hcl
resource "google_cloud_run_v2_service" "default" {
  provider = google-beta

  project  = local.project_id_backend
  name     = "runsvc-${local.cloud_function_name}"
  location = local.default_region
}
```

## Kubernetes and Helm with GKE

When Terraform must manage Kubernetes resources, derive credentials from Google data sources rather than static kubeconfigs.

```hcl
data "google_client_config" "default" {}

data "google_container_cluster" "cluster" {
  name     = var.cluster_name
  location = var.region
}

provider "kubernetes" {
  host  = "https://${data.google_container_cluster.cluster.endpoint}"
  token = data.google_client_config.default.access_token

  cluster_ca_certificate = base64decode(
    data.google_container_cluster.cluster.master_auth[0].cluster_ca_certificate
  )
}
```

## CFT Provider Metadata

Foundation modules based on Google Cloud Foundation Toolkit examples may include provider metadata. Preserve it when updating those modules unless there is a specific reason to remove it.

```hcl
terraform {
  provider_meta "google" {
    module_name = "blueprints/terraform/terraform-example-foundation:base_shared_vpc/v4.0.0"
  }

  provider_meta "google-beta" {
    module_name = "blueprints/terraform/terraform-example-foundation:base_shared_vpc/v4.0.0"
  }
}
```

## TFLint

Use the repo config when present. The foundation config enables Terraform and Google rule sets but intentionally disables documentation, typed variable, and naming convention rules.

```hcl
plugin "terraform" {
  enabled = true
  version = "0.7.0"
  source  = "github.com/terraform-linters/tflint-ruleset-terraform"
}

plugin "google" {
  enabled = true
  version = "0.28.0"
  source  = "github.com/terraform-linters/tflint-ruleset-google"
}

rule "terraform_documented_outputs" {
  enabled = false
}

rule "terraform_documented_variables" {
  enabled = false
}

rule "terraform_typed_variables" {
  enabled = false
}

rule "terraform_naming_convention" {
  enabled = false
}
```

## Best Practices

- Match the provider versions and lockfile behavior of the repo you are editing.
- Use `google-beta` only where needed.
- Prefer `user_project_override = true` in application roots that already use it.
- Prefer stage-specific service account impersonation in foundation work.
- Do not introduce credentials files unless the existing repo explicitly uses them for bootstrap or rotation.
- Keep provider blocks at roots, not inside reusable modules, unless an alias is required and passed deliberately.
