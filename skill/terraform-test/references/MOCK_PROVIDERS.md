# Mock Providers

Mock providers simulate provider behavior without creating real infrastructure. Use them for fast plan-mode tests of Terraform expressions, defaults, conditionals, and outputs. Do not treat mocks as proof of Google Cloud API behavior.

## Basic Google Mock Provider

```hcl
mock_provider "google" {
  mock_resource "google_storage_bucket" {
    defaults = {
      id       = "bkt-app-dev-assets-abcd"
      name     = "bkt-app-dev-assets-abcd"
      location = "US-WEST1"
      labels = {
        deployed_by = "terraform"
        environment = "nonprod"
      }
    }
  }

  mock_data "google_project" {
    defaults = {
      project_id = "prj-dev-app"
      number     = "123456789012"
    }
  }
}

run "bucket_defaults_unit_test" {
  command = plan

  variables {
    application_code     = "app"
    application_env_code = "dev"
    default_region       = "us-west1"
    project_id           = "prj-dev-app"
    resource_labels = {
      deployed_by = "terraform"
      environment = "nonprod"
    }
  }

  assert {
    condition     = google_storage_bucket.bucket.location == "US-WEST1"
    error_message = "Bucket location should match the module default region."
  }
}
```

## Aliased Provider

```hcl
mock_provider "google" {
  alias = "secondary"

  mock_resource "google_pubsub_topic" {
    defaults = {
      id   = "projects/prj-dev-app/topics/events"
      name = "events"
    }
  }
}

run "secondary_provider_unit_test" {
  command = plan

  providers = {
    google = provider.google.secondary
  }
}
```

## Good Uses

- Validate locals, variable transformations, labels, and resource counts.
- Exercise `for_each`, `count`, and dynamic block decisions.
- Test output shape without Google Cloud credentials.

## Bad Uses

- Validate IAM propagation or provider API defaults.
- Test networking reachability, Cloud Run deployment behavior, or GKE integration.
- Prove security controls exist in real infrastructure.

Mocks work in plan-mode tests; use apply-mode integration tests for provider behavior.
