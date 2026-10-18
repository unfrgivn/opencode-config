# Gateway API, GKE Load Balancing, and IAP

Use this reference for external HTTP(S) routing, backend policies, health checks, redirects, and IAP-secured services.

## Platform Shape

- A shared `Gateway` exposes HTTP and HTTPS listeners through GKE's global external managed load balancer.
- Applications attach routes with `HTTPRoute.parentRefs` rather than creating their own Gateway.
- Hostnames are usually patched per environment in overlays.
- Backend behavior is controlled with GKE policy resources targeting the Kubernetes `Service`.

## HTTPRoute Pattern

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: app
spec:
  parentRefs:
    - kind: Gateway
      name: external-http
      namespace: gke-gateway
  hostnames:
    - app.example.com
  rules:
    - backendRefs:
        - name: app
          port: 8080
```

## HTTP to HTTPS Redirect Pattern

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: app-http-redirect
spec:
  parentRefs:
    - kind: Gateway
      name: external-http
      namespace: gke-gateway
      sectionName: http
  hostnames:
    - app.example.com
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301
```

Use the listener `sectionName` that matches the target domain family in the existing shared Gateway.

## Backend Policy with IAP

```yaml
apiVersion: networking.gke.io/v1
kind: GCPBackendPolicy
metadata:
  name: app-backend-policy
spec:
  default:
    timeoutSec: 300
    iap:
      enabled: true
  targetRef:
    group: ""
    kind: Service
    name: app
```

Add IAP only when the app should be protected by Google identity. IAM allowlists belong in the owning infrastructure layer, not app manifests, unless nearby patterns clearly say otherwise.

## Health Check Policy

```yaml
apiVersion: networking.gke.io/v1
kind: HealthCheckPolicy
metadata:
  name: app-health-check
spec:
  default:
    checkIntervalSec: 10
    timeoutSec: 5
    healthyThreshold: 2
    unhealthyThreshold: 2
    config:
      type: HTTP
      httpHealthCheck:
        port: 8080
        requestPath: /healthz
  targetRef:
    group: ""
    kind: Service
    name: app
```

Use `HealthCheckPolicy` when default GKE checks hit the wrong port/path or the app redirects the default path.

## Route Verification

```bash
kubectl describe httproute -n <namespace> <route>
kubectl get gateway -n gke-gateway external-http -o yaml
kubectl describe service -n <namespace> <service>
```

Confirm `Accepted=True`, `ResolvedRefs=True`, the hostname is on a listener, and the backend service port matches `backendRefs.port`.
