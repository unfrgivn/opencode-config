# Terraform Native Test Examples

Examples assume an Google Cloud module that creates a storage bucket and exposes `bucket_name`.

## Plan-Mode Unit Test

```hcl
run "bucket_defaults_unit_test" {
  command = plan

  variables {
    application_code     = "app"
    application_env_code = "dev"
    default_region       = "us-west1"
    project_id           = "prj-dev-app"
    bucket_force_destroy = false
    resource_labels = {
      deployed_by      = "terraform"
      environment      = "nonprod"
      application_code = "app"
    }
  }

  assert {
    condition     = google_storage_bucket.bucket.uniform_bucket_level_access == true
    error_message = "Buckets must use uniform bucket-level access."
  }

  assert {
    condition     = google_storage_bucket.bucket.labels["deployed_by"] == "terraform"
    error_message = "Bucket should include the deployed_by label."
  }

  assert {
    condition     = output.bucket_name != ""
    error_message = "bucket_name output should be populated."
  }
}
```

## Negative Validation Test

```hcl
run "invalid_environment_code_unit_test" {
  command = plan

  variables {
    application_code     = "app"
    application_env_code = "production"
    default_region       = "us-west1"
    project_id           = "prj-dev-app"
  }

  expect_failures = [
    var.application_env_code,
  ]
}
```

## Apply-Mode Integration Test

```hcl
run "bucket_integration_test" {
  command = apply

  variables {
    application_code     = "app"
    application_env_code = "dev"
    default_region       = "us-west1"
    project_id           = var.integration_project_id
    resource_labels = {
      deployed_by = "terraform"
      environment = "nonprod"
    }
  }

  assert {
    condition     = output.bucket_name != ""
    error_message = "Integration test should create a bucket and expose its name."
  }
}
```

Apply-mode tests create real resources and Terraform destroys them in reverse run block order after completion. Use `terraform test -no-cleanup` only for debugging and clean up manually afterward.
