# Runtime Image Selection and Hardening

Use this reference when choosing the final runtime image and hardening the container for production and Kubernetes.

---

## Table of Contents

1. [Selection order](#selection-order)
2. [Base image tradeoffs](#base-image-tradeoffs)
3. [Hardening defaults](#hardening-defaults)
4. [Kubernetes compatibility](#kubernetes-compatibility)
5. [Debuggability policy](#debuggability-policy)
6. [Smells](#smells)

---

## Selection order

Choose in this order:

1. smallest image that still runs the app correctly
2. fastest image to rebuild reliably
3. least privileged runtime that still operates cleanly

Do not choose the tiniest image if it breaks native modules, TLS, timezones, or operability.

---

## Base image tradeoffs

### `scratch`

Use for truly static binaries.

Pros:

- smallest possible runtime image
- near-zero dead weight

Cons:

- no shell
- no package manager
- no CA certs or timezone data unless explicitly copied
- unusable for dynamically linked binaries

### distroless

Use when the application does not need shell access and the ecosystem supports it cleanly.

Pros:

- very small
- strong default security posture
- fewer moving parts than general-purpose distros

Cons:

- debugging is less convenient
- missing shell and common utilities by design
- requires deliberate handling of certs, writable paths, and startup behavior

### Debian or Ubuntu `-slim`

Use as the default compatibility choice for many production apps.

Pros:

- strong ecosystem compatibility
- easier native dependency support
- still reasonably lean

Cons:

- larger than distroless or scratch

### Alpine

Use only when the stack is known to behave correctly on musl.

Pros:

- very small

Cons:

- musl compatibility footguns
- native extension pain in some Node, Python, and Rust workloads
- can waste more engineering time than the size savings are worth

Default rule: prefer slim over Alpine unless there is a demonstrated reason to prefer Alpine.

---

## Hardening defaults

Prefer these defaults when the app allows them:

- non-root user
- minimal installed OS packages
- exec-form `ENTRYPOINT` and `CMD`
- explicit `WORKDIR`
- only the files needed at runtime copied into final stage
- no package manager cache left behind
- pinned image versions or digests when practical

If using distroless or scratch-like runtimes, also verify:

- CA certificates are present if the app makes TLS calls
- required directories exist before switching to non-root
- numeric `USER` or ownership strategy is compatible with the target platform

When adding a user, avoid needlessly complex UID setup unless the deployment platform requires a specific UID/GID.

---

## Kubernetes compatibility

Aim for images that behave cleanly with:

- `runAsNonRoot: true`
- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true`
- `seccompProfile.type: RuntimeDefault`
- `capabilities.drop: ["ALL"]`

Image design implications:

- write temporary data only to known writable paths
- avoid runtime installs and self-modifying startup scripts
- ensure PID 1 handles signals correctly
- do not rely on an init system unless you intentionally add one
- be explicit about exposed port and startup command
- think through volume ownership and `fsGroup` interactions when mounted paths must be writable

Prefer Kubernetes probes for readiness and liveness behavior. Do not rely on Dockerfile `HEALTHCHECK` as the primary orchestration signal unless the deployment model specifically needs it.

If the app needs a writable cache, socket, or temp directory, say so plainly and point to the expected mount path.

---

## Debuggability policy

Do not bloat the production image just to make debugging easier.

Prefer one of these approaches instead:

1. publish a separate debug image
2. use a debug stage for local troubleshooting
3. use Kubernetes ephemeral debug containers or sidecars

Do not quietly stuff `curl`, `bash`, `git`, or package managers into a distroless-grade runtime image.

---

## Smells

- root user in runtime without a clear reason
- shell-form entrypoint
- package manager left in final image for no operational reason
- runtime image includes compilers or headers
- image needs write access everywhere because the layout is sloppy
- image choice justified only by size, not by compatibility or speed
