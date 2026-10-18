import { describe, expect, it } from "bun:test"
import { claimLocation, isLocalDevRoot, releaseLocation, type InitClaim, type InitClaimStore } from "./init-guard"

const LOCAL_ROOT = "/workspace/opencode-config"
const NPM_ROOT = "/cache/node_modules/opencode-config"

function claimOrFail(store: InitClaimStore, directory: string, packageRoot: string): InitClaim {
  const outcome = claimLocation(store, directory, packageRoot)
  if (outcome.status !== "claimed") throw new Error(`expected ${packageRoot} to claim ${directory}`)
  return outcome.claim
}

describe("initialization guard", () => {
  it("recognizes npm cache roots separately from local development roots", () => {
    expect(isLocalDevRoot(LOCAL_ROOT)).toBe(true)
    expect(isLocalDevRoot(NPM_ROOT)).toBe(false)
  })

  it("claims an unclaimed location", () => {
    const store: InitClaimStore = new Map()

    const outcome = claimLocation(store, "/repo", LOCAL_ROOT)

    expect(outcome).toEqual({ status: "claimed", claim: { packageRoot: LOCAL_ROOT }, replaced: null })
    if (outcome.status === "claimed") expect(store.get("/repo")).toBe(outcome.claim)
  })

  it("lets a reload replacement win without letting the old cleanup remove it", () => {
    const store: InitClaimStore = new Map()
    const oldClaim = claimOrFail(store, "/repo", NPM_ROOT)

    const outcome = claimLocation(store, "/repo", NPM_ROOT)
    if (outcome.status !== "claimed") throw new Error("reload replacement must claim the location")
    expect(outcome.replaced).toBe(oldClaim)

    releaseLocation(store, "/repo", oldClaim)
    expect(store.get("/repo")).toBe(outcome.claim)
    releaseLocation(store, "/repo", outcome.claim)
    expect(store.has("/repo")).toBe(false)
  })

  it("allows a new setup after the old cleanup", () => {
    const store: InitClaimStore = new Map()
    releaseLocation(store, "/repo", claimOrFail(store, "/repo", NPM_ROOT))

    expect(claimLocation(store, "/repo", NPM_ROOT)).toEqual({ status: "claimed", claim: { packageRoot: NPM_ROOT }, replaced: null })
  })

  it("replaces an npm claim with a newer npm copy", () => {
    const store: InitClaimStore = new Map()
    claimOrFail(store, "/repo", "/cache-a/node_modules/opencode-config")

    const replacement = claimOrFail(store, "/repo", "/cache-b/node_modules/opencode-config")

    expect(store.get("/repo")).toBe(replacement)
  })

  it("replaces an npm claim with a local development build", () => {
    const store: InitClaimStore = new Map()
    claimOrFail(store, "/repo", NPM_ROOT)

    const replacement = claimOrFail(store, "/repo", LOCAL_ROOT)

    expect(store.get("/repo")).toBe(replacement)
  })

  it("keeps a local development claim when an npm copy arrives", () => {
    const store: InitClaimStore = new Map()
    const localClaim = claimOrFail(store, "/repo", LOCAL_ROOT)

    expect(claimLocation(store, "/repo", NPM_ROOT)).toEqual({ status: "yielded", holder: localClaim })
    expect(store.get("/repo")).toBe(localClaim)
  })

  it("replaces a local development claim with another local build", () => {
    const store: InitClaimStore = new Map()
    claimOrFail(store, "/repo", "/workspace/old-opencode-config")

    const replacement = claimOrFail(store, "/repo", "/workspace/new-opencode-config")

    expect(store.get("/repo")).toBe(replacement)
  })

  it("keeps locations independent", () => {
    const store: InitClaimStore = new Map()
    const first = claimOrFail(store, "/repo-a", "/workspace/a")
    const second = claimOrFail(store, "/repo-b", "/workspace/b")

    expect(store.get("/repo-a")).toBe(first)
    expect(store.get("/repo-b")).toBe(second)
  })

  it("treats a claim written by an older version as the holder", () => {
    const olderLocalClaim = { packageRoot: LOCAL_ROOT, owner: Symbol("older") }
    const store: InitClaimStore = new Map([["/repo", olderLocalClaim]])

    const outcome = claimLocation(store, "/repo", NPM_ROOT)

    expect(outcome.status).toBe("yielded")
    if (outcome.status === "yielded") expect(outcome.holder).toBe(olderLocalClaim)
  })

  it("does not release a claim written by an older version", () => {
    const olderClaim = { packageRoot: NPM_ROOT, owner: Symbol("older") }
    const store: InitClaimStore = new Map([["/repo", olderClaim]])

    releaseLocation(store, "/repo", { packageRoot: NPM_ROOT })

    expect(store.get("/repo")).toBe(olderClaim)
  })

  it("overwrites values that are not claims", () => {
    const store: InitClaimStore = new Map([["/repo", "stale"]])

    const outcome = claimLocation(store, "/repo", LOCAL_ROOT)

    expect(outcome).toEqual({ status: "claimed", claim: { packageRoot: LOCAL_ROOT }, replaced: null })
    if (outcome.status === "claimed") expect(store.get("/repo")).toBe(outcome.claim)
  })
})
