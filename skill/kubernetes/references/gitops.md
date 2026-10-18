# GitOps Workflow

Use this reference for Argo CD ownership, sync drift, app onboarding, and promotion.

## Principles

- Treat Argo CD as the deployment controller. Prefer PRs and syncs over direct cluster mutations.
- Locate the owning `Application`, `ApplicationSet`, or root app before changing manifests.
- Keep app manifests in app-owned directories and platform-wide primitives in platform-owned directories.
- Match existing sync waves when resources depend on generated secrets, CRDs, databases, or controllers.
- Prefer environment overlays over branching logic inside a shared base.

## Investigation Commands

```bash
kubectl config current-context
kubectl get applications.argoproj.io -A
kubectl describe application -n <argocd-namespace> <app-name>
argocd app get <app-name>
argocd app diff <app-name>
```

Use `argocd app sync` only when it is an expected deployment action. Do not use force/prune casually on shared resources.

## Change Pattern

1. Find the app path from Argo CD source metadata.
2. Render the target overlay locally.
3. Change manifests, Helm values, or Kustomize patches in Git.
4. Confirm the rendered YAML includes the intended resources once and only once.
5. After merge/sync, verify `Application` sync status, health, and Kubernetes rollout.

## Argo CD Annotations

Use sync-wave annotations when resources must apply in order:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "2"
```

Typical ordering:

1. Namespaces, CRDs, service accounts, RBAC
2. Secret providers, secret syncs, config maps
3. Databases, backing services, workloads
4. Services, routes, backend policies, monitors
