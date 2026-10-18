#!/usr/bin/env bash

# Extract list resources supported by initialized Terraform providers.
# Usage: ./list_resources.sh [provider_name]
# Requires: terraform, jq
# Run from an initialized Terraform directory. This script intentionally does
# not run terraform init or upgrade providers.

set -euo pipefail

provider="${1:-}"

if [ ! -d ".terraform" ]; then
    printf '%s\n' "Terraform is not initialized. Run terraform init with the repo's normal workflow, then retry." >&2
    exit 1
fi

schema_json="$(terraform providers schema -json)"

if [ -n "$provider" ]; then
    provider_key="$(printf '%s' "$schema_json" | jq -r --arg provider "$provider" '[.provider_schemas | keys[] | select(endswith("/" + $provider))][0] // ""')"

    if [ -n "$provider_key" ]; then
        printf '%s' "$schema_json" | jq -r --arg provider "$provider" --arg provider_key "$provider_key" \
            '{($provider): (.provider_schemas[$provider_key].list_resource_schemas // {} | keys | sort)}'
    else
        jq -n --arg provider "$provider" '{($provider): []}'
    fi
else
    printf '%s' "$schema_json" | jq -r '
        .provider_schemas
        | to_entries
        | map({key: (.key | split("/")[-1]), value: (.value.list_resource_schemas // {} | keys | sort)})
        | from_entries
    '
fi
