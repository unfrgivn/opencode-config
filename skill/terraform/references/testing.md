# Terraform Testing Strategies for Google Cloud

## Terraform Plan Validation

Use the workflow that matches the Terraform root. Foundation-style stages use the repository wrapper; application roots usually run Terraform directly from `envs/<environment>`.

**Foundation wrapper workflow**
```bash
export GCP_SEED_PROJECT_ID="<seed-project-id>"
export GOOGLE_IMPERSONATE_SERVICE_ACCOUNT="sa-terraform-<stage>@<seed-project-id>.iam.gserviceaccount.com"

./tf-wrapper.sh init <stage>
./tf-wrapper.sh plan <stage>
./tf-wrapper.sh apply <stage>
```

The wrapper discovers stage/environment leaf roots, initializes them with the shared backend config, and writes saved plans under `.tmp_plan/`.

**Application root workflow**
```bash
terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan | jq .
```

**Direct Plan Workflow**
```bash
terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan | jq .
terraform apply tfplan
```

Treat `terraform apply` examples as documentation only. Do not run apply commands unless the user explicitly approves applying real infrastructure changes.

**Plan with Variable Files**
```bash
terraform plan -var-file="production.tfvars"
terraform plan -var="node_count=5"
terraform plan \
  -var-file="common.tfvars" \
  -var-file="production.tfvars"
```

**Plan Analysis**
```bash
terraform plan -target=google_compute_network.main
terraform plan -refresh-only
terraform plan -destroy
terraform plan -out=tfplan 2>&1 | tee plan-output.txt
```

## Terraform Test (1.6+)

**Test File Structure**
```
tests/
├── network_unit_test.tftest.hcl
├── firewall_unit_test.tftest.hcl
└── complete_integration_test.tftest.hcl
```

**Basic Test**
```hcl
# tests/network_test.tftest.hcl
run "validate_network" {
  command = plan

  variables {
    name         = "test-vpc"
    routing_mode = "REGIONAL"
  }

  assert {
    condition     = google_compute_network.main.name == "test-vpc"
    error_message = "Network name did not match expected value."
  }

  assert {
    condition     = google_compute_network.main.auto_create_subnetworks == false
    error_message = "Auto-created subnetworks should be disabled."
  }
}
```

**Integration Test**
```hcl
# tests/complete_integration_test.tftest.hcl
run "create_full_network" {
  command = apply

  variables {
    name = "integration-test"

    private_subnets = {
      app = { cidr_block = "10.0.1.0/24", region = "us-central1" }
    }
  }

  assert {
    condition     = length(google_compute_subnetwork.private) == 1
    error_message = "Should create exactly one private subnet."
  }

  assert {
    condition     = output.network_id != ""
    error_message = "Network ID should not be empty."
  }
}
```

**Run Tests**
```bash
terraform test
terraform test tests/network_test.tftest.hcl
terraform test -verbose
terraform test -no-cleanup
```

## Terratest (Go-based Testing)

Use Terratest only when the repository already uses it or the user explicitly approves adding a Go-based test dependency. Prefer native `terraform test` for new tests by default.

**Test Structure**
```
tests/
├── go.mod
├── go.sum
└── network_test.go
```

**go.mod**
```go
module github.com/example/terraform-google-modules/tests

go 1.21

require (
    github.com/gruntwork-io/terratest v0.45.0
    github.com/stretchr/testify v1.8.4
)
```

**Basic Terratest**
```go
package test

import (
    "testing"

    "github.com/gruntwork-io/terratest/modules/terraform"
    "github.com/stretchr/testify/assert"
)

func TestNetworkCreation(t *testing.T) {
    t.Parallel()

    terraformOptions := terraform.WithDefaultRetryableErrors(t, &terraform.Options{
        TerraformDir: "../examples/complete",
        Vars: map[string]interface{}{
            "name":         "test-vpc",
            "routing_mode": "REGIONAL",
        },
        EnvVars: map[string]string{
            "GOOGLE_PROJECT": "test-project",
            "GOOGLE_REGION":  "us-central1",
        },
    })

    defer terraform.Destroy(t, terraformOptions)
    terraform.InitAndApply(t, terraformOptions)

    networkID := terraform.Output(t, terraformOptions, "network_id")
    assert.NotEmpty(t, networkID)
}
```

**Advanced Terratest with Google Cloud SDK**
```go
package test

import (
    "context"
    "strings"
    "testing"

    compute "cloud.google.com/go/compute/apiv1"
    "cloud.google.com/go/compute/apiv1/computepb"
    "github.com/gruntwork-io/terratest/modules/terraform"
    "github.com/stretchr/testify/assert"
    "google.golang.org/api/option"
)

func TestNetworkConfiguration(t *testing.T) {
    t.Parallel()

    projectID := "test-project"

    terraformOptions := &terraform.Options{
        TerraformDir: "../examples/complete",
        Vars: map[string]interface{}{
            "name":         "test-vpc",
            "routing_mode": "REGIONAL",
            "project_id":   projectID,
        },
    }

    defer terraform.Destroy(t, terraformOptions)
    terraform.InitAndApply(t, terraformOptions)

    networkName := terraform.Output(t, terraformOptions, "network_name")

    ctx := context.Background()
    client, err := compute.NewNetworksRESTClient(ctx, option.WithoutAuthentication())
    assert.NoError(t, err)
    defer client.Close()

    network, err := client.Get(ctx, &computepb.GetNetworkRequest{
        Project: projectID,
        Network: networkName,
    })
    assert.NoError(t, err)
    assert.True(t, strings.HasSuffix(network.GetSelfLink(), "/global/networks/"+networkName))
    assert.False(t, network.GetAutoCreateSubnetworks())
}
```

**Run Terratest**
```bash
cd tests
go mod download
go test -v -timeout 30m
```

## Policy as Code - OPA/Sentinel

Foundation-style policy validation should use Google Cloud Terraform policy validation when configured.

```bash
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
gcloud beta terraform vet tfplan.json --policy-library=policy-library
```

OPA or Sentinel can still be useful in application roots where a repo already uses them.

**policy.rego**
```rego
package terraform.analysis

import input as tfplan

deny[msg] {
    r := tfplan.resource_changes[_]
    r.change.actions[_] == "create"
    startswith(r.type, "google_")
    not r.change.after.labels.environment
    msg := sprintf("Resource %s is missing environment label", [r.address])
}

deny[msg] {
    r := tfplan.resource_changes[_]
    r.type == "google_storage_bucket"
    r.change.actions[_] == "create"
    r.change.after.uniform_bucket_level_access != true
    msg := sprintf("Bucket %s must use uniform bucket-level access", [r.address])
}

deny[msg] {
    r := tfplan.resource_changes[_]
    r.type == "google_compute_network"
    r.change.actions[_] == "create"
    r.change.after.auto_create_subnetworks != false
    msg := sprintf("Network %s must disable auto-created subnetworks", [r.address])
}
```

**Run OPA Policy**
```bash
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
opa eval -i tfplan.json -d policy.rego "data.terraform.analysis.deny"
```

## TFLint

**Installation and Configuration**
```bash
brew install tflint
tflint --init
```

**.tflint.hcl**
```hcl
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "google" {
  enabled = true
  version = "0.28.0"
  source  = "github.com/terraform-linters/tflint-ruleset-google"
}

rule "terraform_naming_convention" {
  enabled = true
  format  = "snake_case"
}

rule "terraform_required_version" {
  enabled = true
}

rule "terraform_required_providers" {
  enabled = true
}
```

**Run TFLint**
```bash
tflint
tflint --config=.tflint.hcl
tflint --recursive
tflint --format=json
```

## Pre-commit Hooks

**.pre-commit-config.yaml**
```yaml
repos:
  - repo: https://github.com/antonbabenko/pre-commit-terraform
    rev: v1.83.6
    hooks:
      - id: terraform_fmt
      - id: terraform_validate
      - id: terraform_tflint
        args:
          - --args=--config=__GIT_WORKING_DIR__/.tflint.hcl
      - id: terraform_docs
        args:
          - --hook-config=--path-to-file=README.md
          - --hook-config=--add-to-existing-file=true
      - id: terraform_checkov
        args:
          - --args=--quiet
          - --args=--skip-check CKV_GCP_117
```

**Setup**
```bash
brew install pre-commit
pre-commit install
pre-commit run -a
```

## CI/CD Pipeline Testing

**GitHub Actions Example**
```yaml
name: Terraform Test

on: [pull_request]

jobs:
  terraform-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.6.0

      - name: Terraform Format
        run: terraform fmt -check -recursive

      - name: Terraform Init
        run: terraform init

      - name: Terraform Validate
        run: terraform validate

      - name: TFLint
        uses: terraform-linters/setup-tflint@v4

      - name: Run TFLint
        run: tflint --recursive

      - name: Terraform Test
        run: terraform test

      - name: Checkov
        uses: bridgecrewio/checkov-action@master
        with:
          directory: .
          framework: terraform
```

## Best Practices

- Run `terraform validate` before every commit
- Use `terraform test` for unit and integration tests
- Implement policy as code for security compliance
- Run TFLint in CI/CD pipelines
- Use pre-commit hooks for automated checks
- Test critical Google Cloud infrastructure with Terratest only when it is already present or explicitly approved
- Always review plan output before apply
- Test provider upgrades in isolated environments
- Document test scenarios and expected outcomes
- Automate testing in pull request workflows
