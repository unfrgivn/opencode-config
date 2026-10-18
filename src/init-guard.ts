/**
 * Decides which copy of the plugin owns a location directory.
 *
 * The newest setup takes the claim, except that an npm-cached copy yields to a
 * local development build that already holds it. OpenCode can run the setup for
 * a reloaded location before the cleanup of the instance it replaces:
 *
 *   old instance:  setup ── claim A ───────────────── cleanup (A is gone: no-op)
 *   new instance:              setup ── claim B (replaces A) ──────────────▶
 *
 * so a cleanup may release only the exact claim object its own setup created.
 */

export interface InitClaim {
  readonly packageRoot: string
}

/** Claims keyed by directory. Values stay `unknown` because other plugin versions write to the same store. */
export type InitClaimStore = Map<string, unknown>

export type ClaimOutcome =
  | { readonly status: "claimed"; readonly claim: InitClaim; readonly replaced: InitClaim | null }
  | { readonly status: "yielded"; readonly holder: InitClaim }

export function isLocalDevRoot(packageRoot: string): boolean {
  return !packageRoot.includes("/node_modules/")
}

function isInitClaim(value: unknown): value is InitClaim {
  return typeof value === "object" && value !== null && "packageRoot" in value &&
    typeof value.packageRoot === "string"
}

export function claimLocation(store: InitClaimStore, directory: string, packageRoot: string): ClaimOutcome {
  const existing = store.get(directory)
  const holder = isInitClaim(existing) ? existing : null
  if (holder && isLocalDevRoot(holder.packageRoot) && !isLocalDevRoot(packageRoot)) {
    return { status: "yielded", holder }
  }

  const claim: InitClaim = { packageRoot }
  store.set(directory, claim)
  return { status: "claimed", claim, replaced: holder }
}

export function releaseLocation(store: InitClaimStore, directory: string, claim: InitClaim): void {
  if (store.get(directory) === claim) store.delete(directory)
}
