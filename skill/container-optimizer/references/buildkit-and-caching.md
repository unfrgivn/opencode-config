# BuildKit, Caching, and Fast Rebuilds

Use this reference when writing or reviewing Dockerfiles that should build extremely fast in local development and CI.

---

## Table of Contents

1. [Core goals](#core-goals)
2. [Golden rules](#golden-rules)
3. [Layer ordering pattern](#layer-ordering-pattern)
4. [Cache mounts](#cache-mounts)
5. [Secrets and SSH mounts](#secrets-and-ssh-mounts)
6. [Remote cache in CI](#remote-cache-in-ci)
7. [Context control](#context-control)
8. [Anti-patterns](#anti-patterns)

---

## Core goals

Optimize for:

- warm-cache rebuild speed
- small build context
- deterministic dependency installation
- zero secret leakage into layers
- builder stages that can be reused across targets

Use modern Dockerfile syntax when cache mounts or secret mounts help:

```dockerfile
# syntax=docker/dockerfile:1
```

If the environment is known to support newer frontend features cleanly, use the newer syntax required for those features instead of pretending they are universally available.

---

## Golden rules

1. Copy the smallest stable dependency inputs first.
2. Install dependencies before copying fast-changing source files.
3. Use cache mounts so package-manager caches are not baked into layers.
4. Use secret mounts for private registry auth, never `ARG` or `ENV` secrets.
5. Keep `.dockerignore` aggressive so the context transfer stays tiny.
6. Name build stages so `COPY --from=` stays stable after edits.
7. Prefer `COPY --chown` and, when supported, `COPY --link` over fixup layers that waste time and bytes.

---

## Layer ordering pattern

The default pattern should look like this:

```dockerfile
FROM builder-base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM runtime-base AS runtime
WORKDIR /app
COPY --from=build /app/dist ./dist
CMD ["node", "dist/server.js"]
```

Why this works:

- dependency layers survive source-code-only edits
- builder tools stay out of runtime
- the final image copies only the artifact it needs

When ownership matters, prefer:

```dockerfile
COPY --chown=10001:10001 --from=build /app/dist ./dist
```

When supported and appropriate, consider:

```dockerfile
COPY --link . .
```

Use `COPY --link` deliberately, not reflexively. It helps reduce some layer invalidation and copy overhead, but do not assume every builder environment or existing workflow expects it.

If the repo is a monorepo, avoid copying unrelated packages before dependency pruning.

---

## Cache mounts

Use cache mounts when the package manager supports local caches.

### `apt`

Use a single install step and locked cache sharing:

```dockerfile
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
```

### npm

```dockerfile
RUN --mount=type=cache,target=/root/.npm npm ci
```

### pnpm

```dockerfile
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile
```

### pip

```dockerfile
RUN --mount=type=cache,target=/root/.cache/pip pip install --no-compile -r requirements.txt
```

### cargo

```dockerfile
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo build --release
```

### go

```dockerfile
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -o /out/app ./cmd/app
```

Do not copy package-manager cache directories into the final image.

If the builder runs as a non-root user, ensure cache targets and ownership are compatible with that user instead of falling back to expensive recursive permission rewrites.

---

## Secrets and SSH mounts

For private registries or private Git dependencies, prefer BuildKit mounts:

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
```

```dockerfile
RUN --mount=type=ssh git clone git@github.com:org/private-repo.git
```

Rules:

- never place secrets in `ARG`
- never bake secrets into files that survive the layer
- never copy local credential files from the build context unless the user explicitly asks for that risk

---

## Remote cache in CI

When the user mentions CI speed or repeated remote builds, recommend explicit cache import/export.

Typical `buildx` pattern:

```bash
docker buildx build \
  --cache-from type=registry,ref=org/app:buildcache \
  --cache-to type=registry,ref=org/app:buildcache,mode=max \
  --tag org/app:sha-${GIT_SHA} \
  .
```

Use this when:

- runners are ephemeral
- dependency installation is expensive
- native builds are slow
- multi-arch builds are involved

Be careful not to write conflicting caches to the same destination from parallel jobs.

For multi-arch builds, keep cache behavior platform-aware so one architecture does not degrade reuse for another.

---

## Multi-arch and cross-build notes

Use explicit platform args when the target architecture matters:

```dockerfile
ARG BUILDPLATFORM
ARG TARGETPLATFORM
ARG TARGETOS
ARG TARGETARCH
```

Use them when build tooling, downloaded binaries, or compiled artifacts differ by target.

Rules:

- do not claim multi-arch support unless dependencies and runtime artifacts support it
- prefer native builders for slow compiled workloads when possible
- be wary of emulation overhead in CI
- separate per-arch caches if cache thrash becomes a problem

---

## Context control

Treat `.dockerignore` as part of performance work.

Common entries:

```text
.git
.github
node_modules
dist
build
coverage
.venv
__pycache__
.pytest_cache
target
.DS_Store
.env
.env.*
```

If the app needs generated assets copied into the build, ignore broad directories carefully instead of blindly excluding everything.

---

## Anti-patterns

- `COPY . .` before dependency install
- separate `apt-get update` and `apt-get install` layers
- package-manager caches committed into image layers
- secrets injected with `ARG` or `ENV`
- huge monorepo build contexts for a single service
- using BuildKit features in prose but forgetting the syntax directive or runtime support
