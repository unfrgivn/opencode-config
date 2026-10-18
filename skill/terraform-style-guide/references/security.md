# Terraform Security Style

Apply this guidance only as a style overlay. Prefer `../terraform/references/best-practices.md` for Google Cloud examples and policy.

## Defaults

- Enable encryption at rest when the resource supports it.
- Prefer private networking and deny-by-default ingress.
- Apply least privilege IAM; avoid project-wide broad roles when resource-level IAM works.
- Enable audit, access, or application logging when the service supports it.
- Never hardcode credentials, tokens, private keys, or passwords.
- Mark sensitive variables and outputs with `sensitive = true`.
- Keep sensitive values out of generated plans, state, and committed `.tfvars` wherever possible.

## Google Cloud Examples

### Secret Manager instead of plaintext defaults

```hcl
variable "api_token" {
  description = "API token stored in Secret Manager."
  type        = string
  sensitive   = true
}

resource "google_secret_manager_secret" "api_token" {
  project   = var.project_id
  secret_id = "api-token"
  labels    = var.resource_labels

  replication {
    auto {}
  }
}
```

### Customer-managed encryption when required

```hcl
resource "google_kms_crypto_key" "data" {
  name            = "data"
  key_ring        = google_kms_key_ring.app.id
  rotation_period = "7776000s"
}

resource "google_storage_bucket" "data" {
  project                     = var.project_id
  name                        = var.bucket_name
  location                    = var.default_region
  uniform_bucket_level_access = true
  labels                      = var.resource_labels

  encryption {
    default_kms_key_name = google_kms_crypto_key.data.id
  }
}
```

### Least privilege IAM

```hcl
resource "google_storage_bucket_iam_member" "object_viewer" {
  bucket = google_storage_bucket.data.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.app.email}"
}
```

## Terraform Version Features

Terraform ephemeral resources can reduce state exposure for supported providers and resources. Before using them, verify the repository Terraform version is `>= 1.11.0` and the provider supports the needed ephemeral resource or write-only attribute.
