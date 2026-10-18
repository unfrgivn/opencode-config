# Secrets and Identity

Use this reference for Secret Manager sync, runtime secrets, Workload Identity, and service accounts.

## Principles

- Store secret material in Google Secret Manager, not Git.
- Commit only references, placeholder `Secret` objects needed by controllers, or sync resources that populate secrets at runtime.
- Use Kubernetes service accounts with Workload Identity when pods access Google Cloud APIs.
- Keep Google IAM grants in the owning infrastructure layer unless the app repo already manages them.

## Secret Provider and Sync

Common app overlays use a provider object plus one or more sync resources. Match the CRD schema already used in nearby apps before adding fields.

Checklist:

- Provider references the correct project and secret names for the environment.
- Sync resource writes the Kubernetes `Secret` name expected by Helm values or workload env refs.
- Argo CD sync wave applies provider/sync before workloads depending on the secret.
- Placeholder `Secret` data is not committed unless it is intentionally empty and runtime-populated.

## Workload Identity

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app
  annotations:
    iam.gke.io/gcp-service-account: app-gsa@example-project.iam.gserviceaccount.com
```

Set `serviceAccountName` on workloads and avoid the default service account.

## Verification

```bash
kubectl get secretproviderclass -n <namespace>
kubectl get secretsync -n <namespace>
kubectl describe secretsync -n <namespace> <name>
kubectl get serviceaccount -n <namespace> <name> -o yaml
kubectl describe pod -n <namespace> <pod>
```

If a pod cannot read Google APIs, check service-account annotation, IAM binding, projected token audience, and workload logs.
