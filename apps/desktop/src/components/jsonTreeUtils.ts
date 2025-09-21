export type NodePath = Array<string | number>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function isJsonLike(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || isPlainObject(value)
}

export function getChildEntries(value: unknown): Array<[string | number, unknown]> {
  if (Array.isArray(value)) {
    return value.map((child, index) => [index, child] as [number, unknown])
  }
  if (isPlainObject(value)) {
    return Object.entries(value)
  }
  return []
}

export function hasChildNodes(value: unknown): boolean {
  return getChildEntries(value).length > 0
}

export function pathToKey(path: NodePath): string {
  return JSON.stringify(path)
}

export function collectExpandableKeys(value: unknown, path: NodePath): string[] {
  const result: string[] = []
  if (!isJsonLike(value)) return result

  const stack: Array<{ path: NodePath; value: unknown }> = [{ path, value }]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (!isJsonLike(current.value)) continue
    const entries = getChildEntries(current.value)
    if (entries.length === 0) continue
    result.push(pathToKey(current.path))
    for (const [childKey, childValue] of entries) {
      stack.push({ path: [...current.path, childKey], value: childValue })
    }
  }
  return result
}

export function pruneDescendants(keys: Iterable<string>, path: NodePath): Set<string> {
  const targetLength = path.length
  const result = new Set<string>()

  outer: for (const key of keys) {
    const segments: NodePath = JSON.parse(key)
    if (segments.length < targetLength) {
      result.add(key)
      continue outer
    }
    for (let i = 0; i < targetLength; i += 1) {
      if (segments[i] !== path[i]) {
        result.add(key)
        continue outer
      }
    }
    // key matches the prefix; skip to prune target path and its descendants
  }

  return result
}
