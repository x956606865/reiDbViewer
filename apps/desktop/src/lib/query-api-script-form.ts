import {
  queryApiScriptInputSchema,
  type QueryApiHeader,
  type QueryApiScriptInput,
  type QueryApiScriptRecord,
} from '../services/queryApiScripts'

export type QueryApiScriptFormHeader = QueryApiHeader & { masked?: boolean }

export type QueryApiScriptFormState = {
  id?: string
  queryId: string
  name: string
  description: string
  method: string
  endpoint: string
  headers: QueryApiScriptFormHeader[]
  fetchSize: number
  sendBatchSize: number
  sleepMs: number
  requestTimeoutMs: number
  errorPolicy: string
  bodyTemplate: string
}

const DEFAULT_FETCH_SIZE = 500
const DEFAULT_SEND_BATCH_SIZE = 100
const DEFAULT_SLEEP_MS = 0
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_METHOD = 'POST'
const DEFAULT_ERROR_POLICY = 'continue'

const ensureHeaderId = (header: Partial<QueryApiHeader> & { id?: string }): string => {
  if (header.id && header.id.trim().length > 0) return header.id
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID()
    } catch {}
  }
  return `hdr_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

const normalizeHeader = (header: Partial<QueryApiScriptFormHeader>): QueryApiScriptFormHeader => {
  const id = ensureHeaderId(header)
  return {
    id,
    key: header?.key ?? '',
    value: header?.value ?? '',
    sensitive: !!header?.sensitive,
    masked: header?.masked ?? false,
  }
}

const normalizeHeaderList = (
  headers?: Array<Partial<QueryApiScriptFormHeader>>,
): QueryApiScriptFormHeader[] => {
  if (!headers || headers.length === 0) return []
  const seen = new Set<string>()
  const normalized: QueryApiScriptFormHeader[] = []
  for (const header of headers) {
    const next = normalizeHeader(header)
    if (!next.key) {
      normalized.push(next)
      continue
    }
    const key = next.key.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(next)
  }
  return normalized
}

export function createEmptyScriptForm(
  opts: {
    queryId: string
    base?: Partial<QueryApiScriptFormState> & {
      headers?: Array<Partial<QueryApiScriptFormHeader>>
    }
  },
): QueryApiScriptFormState {
  const { queryId, base } = opts
  return {
    id: base?.id,
    queryId,
    name: base?.name ?? '',
    description: base?.description ?? '',
    method: base?.method ?? DEFAULT_METHOD,
    endpoint: base?.endpoint ?? '',
    headers: normalizeHeaderList(base?.headers),
    fetchSize: Number.isFinite(base?.fetchSize)
      ? Number(base?.fetchSize)
      : DEFAULT_FETCH_SIZE,
    sendBatchSize: Number.isFinite(base?.sendBatchSize)
      ? Number(base?.sendBatchSize)
      : DEFAULT_SEND_BATCH_SIZE,
    sleepMs: Number.isFinite(base?.sleepMs) ? Number(base?.sleepMs) : DEFAULT_SLEEP_MS,
    requestTimeoutMs: Number.isFinite(base?.requestTimeoutMs)
      ? Number(base?.requestTimeoutMs)
      : DEFAULT_TIMEOUT_MS,
    errorPolicy: base?.errorPolicy ?? DEFAULT_ERROR_POLICY,
    bodyTemplate: base?.bodyTemplate ?? '',
  }
}

export function createHeaderDraft(
  partial?: Partial<QueryApiScriptFormHeader>,
): QueryApiScriptFormHeader {
  return normalizeHeader(partial ?? {})
}

export function scriptRecordToForm(record: QueryApiScriptRecord): QueryApiScriptFormState {
  return {
    id: record.id,
    queryId: record.queryId,
    name: record.name,
    description: record.description ?? '',
    method: record.method,
    endpoint: record.endpoint,
    headers: normalizeHeaderList(record.headers),
    fetchSize: record.fetchSize,
    sendBatchSize: record.sendBatchSize,
    sleepMs: record.sleepMs,
    requestTimeoutMs: record.requestTimeoutMs,
    errorPolicy: record.errorPolicy,
    bodyTemplate: record.bodyTemplate ?? '',
  }
}

export function scriptFormToInput(form: QueryApiScriptFormState): QueryApiScriptInput {
  const description = form.description ?? ''
  const bodyTemplate = form.bodyTemplate ?? ''
  const payload = {
    id: form.id,
    queryId: form.queryId,
    name: form.name,
    description,
    method: form.method,
    endpoint: form.endpoint,
    headers: form.headers.map((header) => ({
      id: header.id,
      key: header.key,
      value: header.value,
      sensitive: !!header.sensitive,
    })),
    fetchSize: form.fetchSize,
    sendBatchSize: form.sendBatchSize,
    sleepMs: form.sleepMs,
    requestTimeoutMs: form.requestTimeoutMs,
    errorPolicy: form.errorPolicy,
    bodyTemplate,
  }
  return queryApiScriptInputSchema.parse(payload)
}

export function cloneScriptForm(
  form: QueryApiScriptFormState,
  overrides: Partial<Omit<QueryApiScriptFormState, 'queryId' | 'headers'>> & {
    headers?: Array<Partial<QueryApiScriptFormHeader>>
  } = {},
): QueryApiScriptFormState {
  return createEmptyScriptForm({
    queryId: overrides.queryId ?? form.queryId,
    base: {
      ...form,
      ...overrides,
      headers: overrides.headers ?? form.headers.map((h) => ({ ...h, id: ensureHeaderId({}) })),
    },
  })
}

export const __test__ = {
  normalizeHeaderList,
}
