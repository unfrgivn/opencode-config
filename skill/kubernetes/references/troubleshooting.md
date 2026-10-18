# Troubleshooting

Use this reference for safe live investigation. Prefer read-only commands and durable GitOps fixes.

## First Checks

```bash
kubectl config current-context
kubectl get ns
kubectl get applications.argoproj.io -A
```

Stop if the context is unexpected.

## Argo CD

```bash
argocd app get <app-name>
argocd app diff <app-name>
kubectl describe application -n <argocd-namespace> <app-name>
```

Look for sync status, health status, compared revision, managed resources, and conditions.

## Workloads

```bash
kubectl rollout status deployment/<name> -n <namespace>
kubectl get pods -n <namespace> -o wide
kubectl describe pod -n <namespace> <pod>
kubectl logs -n <namespace> <pod> --all-containers --since=30m
kubectl logs -n <namespace> <pod> --previous --all-containers
kubectl get events -n <namespace> --sort-by=.lastTimestamp
```

Check image pulls, probes, env/secret references, resource pressure, node placement, and restart reasons.

## Services and Routes

```bash
kubectl get svc,endpointslices -n <namespace>
kubectl describe httproute -n <namespace> <route>
kubectl get gcpbackendpolicy,healthcheckpolicy -n <namespace>
kubectl describe gcpbackendpolicy -n <namespace> <policy>
kubectl describe healthcheckpolicy -n <namespace> <policy>
```

If the route is accepted but traffic fails, verify the backend service port, pod readiness, health-check path, IAP setting, and load balancer backend health in Google Cloud.

## Secrets and Identity

```bash
kubectl get secretproviderclass,secretsync -n <namespace>
kubectl describe secretsync -n <namespace> <name>
kubectl get serviceaccount -n <namespace> <name> -o yaml
```

For secret failures, confirm the runtime secret exists, the workload references the right name/key, and the sync controller reports success.

## Resource Tuning

```bash
kubectl top pods -n <namespace>
kubectl top nodes
kubectl describe hpa -n <namespace> <name>
```

Tune requests, limits, HPA, and chart values in Git. Avoid live edits that Argo CD will overwrite.
