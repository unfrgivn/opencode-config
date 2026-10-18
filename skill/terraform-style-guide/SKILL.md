---
name: terraform-style-guide
description: Review or generate Terraform HCL style without overriding Google Cloud conventions. Use when checking formatting, file organization, variable/output descriptions, naming, `for_each` versus `count`, sensitive values, or code review hygiene. Pair with the `terraform` skill, which remains the source of truth for repository-specific GCP architecture, labels, providers, state, modules, and validation.
---

# Terraform Style Guide

Use this as a small style overlay. Prefer `terraform` and `../terraform/references/best-practices.md` for Google Cloud choices.

## Style Checklist

- Run `terraform fmt` or `terraform fmt -recursive` before handoff.
- Use two-space indentation and normal `terraform fmt` alignment.
- Keep provider/version constraints in `versions.tf` or the repo's existing equivalent.
- Keep provider configuration in provider files and backend configuration in `backend.tf`.
- Put environment-specific values in root `locals`, then pass them into modules.
- Give every variable a `description` and `type`; add validation for constrained domains.
- Give every output a `description`; mark sensitive outputs with `sensitive = true`.
- Prefer `for_each` for named repeated resources; use `count` for simple feature flags only when it matches nearby code.
- Use snake_case Terraform identifiers and descriptive resource names. `main` or `this` is acceptable inside a small module when there is only one obvious instance.
- Never commit `.terraform/`, state files, generated plans, or secret `.tfvars`.

## Security Reference

Load `references/security.md` when generating or reviewing sensitive values, encryption, IAM, networking, or state exposure.

## Review Output

Return style findings as:

1. blockers that can create unsafe or broken infrastructure
2. consistency fixes that should happen before review
3. optional readability improvements
