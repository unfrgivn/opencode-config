# Terraform Test CI/CD

Use the repository's existing CI and wrapper commands first. Add new CI only when the repo lacks Terraform test coverage or the user asks for it.

## Recommended Split

- Pull requests: `terraform fmt -check`, `terraform validate`, and plan-mode `terraform test`.
- Protected branches or scheduled jobs: apply-mode integration tests in isolated non-production Google Cloud projects.
- Foundation stages: use the repo wrapper when present instead of raw Terraform commands.

## GitHub Actions Sketch

```yaml
name: Terraform Tests

on:
  pull_request:

jobs:
  terraform-unit-tests:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: terraform fmt -check -recursive
      - run: terraform init
      - run: terraform validate
      - run: terraform test -filter=unit_test -verbose
```

For apply-mode Google Cloud tests, authenticate with Workload Identity Federation and target a disposable non-production project. Never store service account keys as repository secrets unless a legacy repo already requires that path and rotation is explicit.
