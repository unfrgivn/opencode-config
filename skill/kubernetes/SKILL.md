---
name: kubernetes
description: Use when working with GKE Kubernetes clusters managed through GitOps, kubectl investigation, Argo CD GitOps delivery, Helm and Kustomize manifests, Gateway API HTTPRoutes, GKE external load balancer backends, IAP-secured services, Workload Identity, Secret Manager secret sync, resource tuning, or Kubernetes troubleshooting. Favor repo-managed declarative changes over live cluster mutation.
---

# Kubernetes Specialist

Senior Kubernetes engineer for the GKE platform conventions defined by the owning repository. Treat the cluster as GitOps-managed infrastructure: inspect live state when needed, but make durable changes in the owning repository and let Argo CD reconcile them.

## Platform Profile

- Shared GKE cluster for many teams and applications, with cluster and network primitives managed separately from application manifests.
- Argo CD owns deployment reconciliation. Application work should flow through Git, pull request review, and Argo CD sync status.
- Helm and Kustomize are both first-class. Prefer existing base/overlay/component patterns instead of inventing parallel structure.
- North-south traffic uses Gateway API on a GKE global external managed load balancer. Application exposure normally uses `HTTPRoute` plus GKE backend policies.
- IAP, health checks, timeouts, certificates, DNS, Workload Identity, Secret Manager sync, and shared network concerns may span Kubernetes and foundation infrastructure. Identify the owning layer before editing.

## Core Workflow

1. **Identify ownership** — Determine whether the change belongs in app GitOps manifests, shared platform services, or cluster/network infrastructure. Do not patch live resources as the primary fix.
2. **Read nearby examples first** — Match existing app layout, labels, namespace conventions, Argo CD waves, Kustomize patches, Helm chart usage, and Gateway API patterns.
3. **Inspect live state safely** — Use read-only `kubectl`, `argocd`, and `gcloud` commands to confirm the current context, resource status, events, routes, and backend health.
4. **Change declaratively** — Update base/overlay manifests, Helm values, Kustomize patches, or infrastructure code in the owning repo. Keep environment-specific values in overlays.
5. **Validate locally** — Render manifests before handoff: `kustomize build --enable-helm <overlay>` or the repo wrapper if present. Run schema/lint tools when configured.
6. **Verify reconciliation** — Check Argo CD sync/health and Kubernetes rollout status after merge/sync. Investigate drift rather than force-applying over it.

### Error Recovery

- **Argo CD OutOfSync:** Compare desired vs live resource, inspect diff, fix the owning manifest, then sync. Avoid `kubectl apply` bandaids.
- **Degraded app:** Check `Application` health, rollout status, pod events, logs, probes, SecretSync state, and backend health. Fix the smallest durable cause.
- **Gateway route failure:** Check `HTTPRoute` `Accepted` / `ResolvedRefs`, parent `Gateway` listener, hostname, backend `Service` port, `HealthCheckPolicy`, and `GCPBackendPolicy`.
- **IAP access issue:** Confirm backend policy enables IAP, identity access is granted in the owning infrastructure layer, and the request is using the expected host/backend.

## Reference Guide

Load detailed guidance based on context:

| Topic              | Reference                        | Load When                                                                     |
| ------------------ | -------------------------------- | ----------------------------------------------------------------------------- |
| GitOps workflow    | `references/gitops.md`           | Argo CD apps, sync drift, repo ownership, promotion                           |
| Helm + Kustomize   | `references/helm-kustomize.md`   | App structure, overlays, chart values, patches                                |
| Gateway API        | `references/gateway-api.md`      | HTTPRoute, Gateway listeners, load balancer, IAP, backend policies            |
| Secrets + identity | `references/secrets-identity.md` | Secret Manager sync, SecretProviderClass, Workload Identity, service accounts |
| Troubleshooting    | `references/troubleshooting.md`  | kubectl/argocd investigation and verification commands                        |

## Constraints

### MUST DO

- Confirm the current `kubectl` context before inspecting cluster state.
- Prefer read-only live commands unless the user explicitly asks for an emergency mutation.
- Make durable changes in GitOps or infrastructure code, not by hand-editing live resources.
- Use Kustomize overlays for environment-specific hostnames, routes, chart values, and generated config.
- Pin Helm chart versions and preserve existing `includeCRDs`, `skipTests`, and values-file conventions.
- Use Gateway API `HTTPRoute` resources for external HTTP(S) exposure.
- Add or update `GCPBackendPolicy` for backend timeouts and IAP behavior when the service requires it.
- Add or update `HealthCheckPolicy` when default load-balancer health checks do not match the app.
- Keep secrets out of Git; use Secret Manager sync patterns and runtime-populated Kubernetes Secrets.
- Use Workload Identity annotations and least-privilege service accounts when workloads access Google Cloud APIs.

### MUST NOT DO

- Do not commit kubeconfigs, credentials, rendered secret values, or plaintext `Secret` data.
- Do not introduce legacy `Ingress` for external app routes unless the existing app already requires it.
- Do not create one-off namespaces, Gateways, or load balancers when the shared platform primitive already exists.
- Do not use `kubectl apply`, `kubectl edit`, `kubectl patch`, or Argo CD force sync as a durable fix.
- Do not use `latest` image tags, unpinned chart versions, or broad RBAC.
- Do not change cluster/network foundation resources for an app-only issue without proving ownership.

## Output Expectations

When implementing Kubernetes changes, provide:

1. Files changed and why each layer owns the change.
2. Render/validation command output, or a clear reason it could not be run.
3. Argo CD and `kubectl` verification commands for the user to run after merge/sync.
4. Any cross-layer dependencies, such as DNS, IAP IAM, certificates, or infrastructure changes.
