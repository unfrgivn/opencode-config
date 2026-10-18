# Helm and Kustomize

Use this reference for app layout, Helm chart consumption, overlays, generated config, and patches.

## Preferred Shape

```text
apps/<app>/
├── base/
│   ├── kustomization.yaml
│   ├── service-account.yaml
│   ├── http-route.yaml
│   └── gcp-backend-policy.yaml
└── overlays/<env>/
    ├── kustomization.yaml
    ├── values.yaml
    ├── set-hostname.yaml
    └── secret-sync.yaml
```

Use the nearby repo shape as source of truth. Some apps are pure manifests, some use `helmCharts`, and some combine both.

## Kustomize Rules

- Keep reusable resources in `base`.
- Keep hostname, namespace, replica count, chart values, secret names, and environment differences in overlays.
- Use targeted patches with `target.kind` and `target.name` instead of broad text substitution.
- Use `configMapGenerator` with `generatorOptions.disableNameSuffixHash: true` only when stable names are required by workloads.
- Preserve common labels/components already used by nearby apps.

## Helm Rules

- Pin `version` for every chart.
- Use `valuesFile` for environment-specific configuration.
- Preserve `includeCRDs` when the chart owns required CRDs.
- Preserve `skipTests` when existing overlays use it, Argo CD does not run Helm tests during normal reconciliation.
- Prefer OCI or repo URLs already used nearby. Do not add a new chart source without checking maintenance and provenance.

## Local Render

```bash
kustomize build --enable-helm apps/<app>/overlays/<env>
```

If the repo provides `just`, `make`, or a wrapper script for rendering or validation, use that instead.
