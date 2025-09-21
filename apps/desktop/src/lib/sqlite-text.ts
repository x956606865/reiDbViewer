const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : undefined

function decodeBytes(input: Uint8Array | number[] | ArrayLike<number>): string {
  const view = input instanceof Uint8Array ? input : Uint8Array.from(input)
  if (decoder) {
    return decoder.decode(view)
  }
  let result = ''
  for (let i = 0; i < view.length; i += 1) {
    result += String.fromCharCode(view[i] ?? 0)
  }
  return result
}

export function decodeSqliteText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') return raw
  if (raw instanceof Uint8Array) return decodeBytes(raw)
  if (raw instanceof ArrayBuffer) return decodeBytes(new Uint8Array(raw))
  if (Array.isArray(raw) && raw.every((value) => typeof value === 'number')) {
    return decodeBytes(raw as number[])
  }
  return String(raw)
}

export function parseJsonColumn<T>(raw: unknown, fallback: T): T {
  const text = decodeSqliteText(raw)
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch (error) {
    console.warn('Failed to parse JSON column', error)
    return fallback
  }
}
