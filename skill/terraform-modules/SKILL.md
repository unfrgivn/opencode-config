---
name: terraform-modules
description: Refactor Terraform into focused reusable modules while preserving Google Cloud Terraform conventions. Use when extracting monolithic Terraform into `modules/*`, designing module interfaces, composing modules from environment roots, planning `moved` blocks or state migration, or reviewing module boundaries. Pair with the `terraform` skill as the canonical source for GCP layout, labels, providers, state, validation, and security.
---

# Terraform Modules

Use this skill as a refactoring checklist. Do not redefine Terraform style or repository-specific GCP standards here; load `../terraform/SKILL.md` and `../terraform/references/module-patterns.md` first.

## Refactor Workflow

1. Identify the root type: foundation stage or application `envs/<env>` root.
2. Group resources by shared lifecycle and ownership, not by provider type alone.
3. Keep environment/application values in root `locals`; pass project IDs, regions, env codes, labels, and secrets into modules explicitly.
4. Design a small typed interface with variable validation and documented outputs.
5. Preserve state with `moved` blocks whenever Terraform version and refactor shape allow it.
6. Validate that the post-refactor plan is a no-op except intentional changes.
7. Add or update native Terraform tests with `terraform-test` when behavior is not already covered.

## Boundary Heuristics

Put resources in the same module when they:

- implement one capability, such as Cloud Run service, storage bucket, Pub/Sub topic set, BigQuery dataset, or service account bindings
- share lifecycle and ownership
- need a compact, stable interface for multiple roots

Keep resources at the environment root when they:

- select projects, regions, environments, or upstream remote state
- compose multiple modules together
- represent one-off wiring that would make a module overly generic

## State-Preserving Refactor

Prefer declarative `moved` blocks for address-only refactors:

```hcl
moved {
  from = google_storage_bucket.assets
  to   = module.assets.google_storage_bucket.bucket
}
```

Use imperative state commands only when `moved` blocks cannot model the change, and only after backing up and reviewing state:

```bash
terraform state pull > terraform.tfstate.backup
terraform state mv google_storage_bucket.assets module.assets.google_storage_bucket.bucket
terraform plan -out=migration.tfplan
terraform show migration.tfplan
```

## Success Criteria

- The module has one clear responsibility.
- Variables and outputs are typed, described, and intentionally minimal.
- Project, region, environment code, labels, and secrets are explicit inputs.
- No hardcoded project IDs, secrets, backend settings, or provider credentials moved into the module.
- Refactor plan is no-op except intentional changes.
- Tests or validation commands cover the changed interface.
