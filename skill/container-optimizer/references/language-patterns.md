# Language-Specific Container Patterns

Use this reference when the repo language and packaging model are known and you need sharper implementation guidance.

---

## Table of Contents

1. [Node.js](#nodejs)
2. [Python](#python)
3. [Go](#go)
4. [Rust](#rust)
5. [Java and JVM apps](#java-and-jvm-apps)

---

## Node.js

### Default pattern

1. Copy package manifest and lockfiles first.
2. Install dependencies with a deterministic command.
3. Copy the rest of the source.
4. Build in a builder stage.
5. Copy only production artifact and required runtime deps into the final stage.

### Notes

- Use `npm ci`, `pnpm install --frozen-lockfile`, or `yarn install --immutable`.
- For workspace repos, copy workspace manifests early and prune unrelated packages if possible.
- If the app bundles to standalone output, prefer copying the standalone artifact instead of the whole project tree.
- Avoid Alpine unless native modules are known to behave correctly on musl.
- `NODE_ENV=production` is usually the right runtime default, but do not break apps that depend on different semantics.
- Ensure the runtime command and framework behavior shut down cleanly on `SIGTERM` under Kubernetes.

### Common smells

- copying the whole monorepo before install
- reinstalling dependencies in the runtime stage
- shipping test files, TypeScript sources, or source maps by accident
- shipping devDependencies when the built artifact no longer needs them

---

## Python

### Default pattern

1. Resolve and build dependencies in a builder stage.
2. Build wheels when native extensions exist.
3. Copy only the virtualenv, wheels, or installed site-packages into the final image.
4. Keep compiler toolchains out of runtime.

### Notes

- `python:<version>-slim` is the normal default.
- Use cache mounts for pip.
- If private indexes are used, mount `pip.conf` or credentials as secrets.
- If the app uses `uv`, reflect that instead of falling back to pip out of habit.
- Runtime defaults like `PYTHONUNBUFFERED=1` and `PYTHONDONTWRITEBYTECODE=1` are often useful, but keep them aligned with application expectations.
- Prefer cache mounts over relying only on `--no-cache-dir` during dependency installation. The goal is fast rebuilds without shipping caches.

### Common smells

- runtime image still has gcc and headers
- unbounded `pip install .` after `COPY . .`
- no split between dependency resolution and app code
- blindly using Alpine with native dependencies

---

## Go

### Default pattern

1. Copy `go.mod` and `go.sum` first.
2. Download modules.
3. Copy the rest of the source.
4. Build the target binary.
5. Copy the binary to `scratch`, distroless, or slim runtime as appropriate.

### Notes

- Cache both module downloads and build cache.
- Prefer static builds when feasible.
- Copy CA certs if the binary makes outbound TLS calls and the runtime image lacks them.

### Common smells

- full Go toolchain in runtime image
- no separation between `go mod download` and source copy
- assuming `scratch` works for dynamically linked binaries

---

## Rust

### Default pattern

1. Separate dependency graph caching from full source copy.
2. Use cargo-chef style planning when the repo is large enough to justify it.
3. Build release binaries in builder stage.
4. Strip or optimize the binary if appropriate.
5. Copy only the binary and required assets into final image.

### Notes

- Cache cargo registry and git directories.
- If dynamically linked runtime libraries are needed, prefer slim or distroless that includes them, or copy the specific required libs.
- Alpine is not the default safe choice for Rust runtime compatibility.

### Common smells

- rebuilding all dependencies on every source change
- runtime contains the Rust toolchain
- final image contains cargo registry junk

---

## Java and JVM apps

### Default pattern

1. Resolve dependencies before copying all source files when the build tool allows it.
2. Build in a dedicated builder stage.
3. Copy only the runtime artifact into the final image.
4. Prefer a JRE-only or custom runtime instead of a full JDK.

### Notes

- Consider `jlink` for custom runtime images.
- Consider layered jars or extracted layers to improve rebuild reuse.
- Be honest about startup and memory behavior when targeting Kubernetes.
- Container-aware JVM memory flags may be necessary when memory limits are tight.
- Prefer fail-fast OOM behavior and graceful shutdown defaults for orchestrated workloads.

### Common smells

- full JDK in production image without need
- build tool caches copied into runtime
- app jar copied alongside the whole repository tree
