---
name: terraform-test
description: Author and run Terraform native tests for Google Cloud Terraform. Use when creating or reviewing `.tftest.hcl` files, testing module inputs/outputs, writing plan-mode assertions, using Terraform mock providers or data, separating unit and integration tests, or troubleshooting `terraform test` behavior. Pair with the `terraform` skill for repository layout, GCP provider, module, state, and validation conventions.
---

# Terraform Test

Use this skill as a narrow adjunct to `terraform`. Keep Google Cloud conventions, module boundaries, provider auth, state, labels, and baseline validation in `terraform`; use this skill only for Terraform native test authoring and execution.

## Workflow

1. Load `../terraform/references/testing.md` for the repo's validation and wrapper flow.
2. Identify the target root or module and match nearby `tests/*.tftest.hcl` patterns.
3. Prefer plan-mode tests for variables, locals, resource counts, labels, names, and outputs.
4. Use apply-mode integration tests only when real Google Cloud behavior must be verified and credentials/project isolation are available.
5. Use mock providers only for Terraform expression behavior, never as proof of Google Cloud API behavior.
6. Run `terraform fmt`, `terraform validate`, then `terraform test` from the target root, or use the repo wrapper if the root is a foundation stage.

## References

- `references/MOCK_PROVIDERS.md` — Terraform mock provider syntax for Google provider tests.
- `references/EXAMPLES.md` — Compact Google Cloud native test examples.
- `references/CI_CD.md` — CI patterns for splitting plan-mode and apply-mode tests.

## Test Layout

```text
modules/cloud-storage/
├── main.tf
├── variables.tf
├── outputs.tf
└── tests/
    ├── defaults_unit_test.tftest.hcl
    └── integration_test.tftest.hcl
```

Use `*_unit_test.tftest.hcl` for plan-mode tests and `*_integration_test.tftest.hcl` for apply-mode tests so CI can filter them.

## Native Test Skeleton

```hcl
run "defaults_unit_test" {
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
    error_message = "Bucket should use the requested default region."
  }

  assert {
    condition     = output.bucket_name != ""
    error_message = "Module must expose the created bucket name."
  }
}
```

## Commands

```bash
terraform test
terraform test tests/defaults_unit_test.tftest.hcl
terraform test -filter=unit_test -verbose
terraform test -no-cleanup
```

## Guardrails

- Keep test variables realistic and aligned with repository environment codes.
- Avoid mock-only tests for security, IAM propagation, networking reachability, provider defaults, or API side effects.
- Keep assertion messages specific enough to fix failures without rerunning in verbose mode.
- Do not add new test frameworks unless the repo already uses them or the user approves the dependency.
