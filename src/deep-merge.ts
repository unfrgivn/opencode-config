function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Deep-merge two JSON-like values.
 *
 * Rules:
 * - object + object: recursive merge
 * - arrays: replace
 * - primitive/null: replace
 * - undefined override: keep base
 */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) {
    return structuredClone(base)
  }

  if (Array.isArray(override)) {
    return structuredClone(override)
  }

  if (!isPlainObject(override)) {
    return override
  }

  if (!isPlainObject(base)) {
    return structuredClone(override)
  }

  const merged: Record<string, unknown> = structuredClone(base) as Record<string, unknown>
  for (const [key, overrideValue] of Object.entries(override)) {
    if (overrideValue === undefined) {
      continue
    }

    const baseValue = merged[key]
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      merged[key] = deepMerge(baseValue, overrideValue)
      continue
    }

    merged[key] = structuredClone(overrideValue)
  }

  return merged
}
