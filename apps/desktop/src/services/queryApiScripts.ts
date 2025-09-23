import { invoke } from '@tauri-apps/api/core'
import Database from '@tauri-apps/plugin-sql'
import { z } from 'zod'

export const QUERY_API_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export const QUERY_API_ERROR_POLICIES = ['continue', 'abort'] as const
export const QUERY_API_MAX_BATCH = 1000
export const QUERY_API_MIN_TIMEOUT_MS = 1_000
export const QUERY_API_MAX_TIMEOUT_MS = 600_000
export const QUERY_API_MAX_SLEEP_MS = 600_000

const METHOD_SET = new Set<string>(QUERY_API_METHODS)
const ERROR_POLICY_SET = new Set<string>(QUERY_API_ERROR_POLICIES)

const headerKeyPattern = /^[A-Za-z0-9-]+$/

const headerSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .transform((value) => value?.trim() || undefined),
    key: z
      .string()
      .trim()
      .min(1, 'header_key_required')
      .max(256)
      .refine((value) => headerKeyPattern.test(value), 'header_key_invalid'),
    value: z
      .union([z.string(), z.number()])
      .optional()
      .transform((value) => (value == null ? '' : String(value)))
      .refine((value) => value.length <= 2000, 'header_value_too_long'),
    sensitive: z.boolean().optional().default(false),
  })
  .transform((raw) => {
    const next = { ...raw }
    if (!next.id) {
      next.id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `hdr_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
    }
    return {
      id: next.id,
      key: raw.key.trim(),
      value: (raw.value ?? '').trim(),
      sensitive: !!raw.sensitive,
    }
  })

export const queryApiScriptInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    queryId: z.string().trim().min(1, 'query_id_required'),
    name: z.string().trim().min(1, 'name_required').max(120, 'name_too_long'),
    description: z
      .string()
      .nullable()
      .optional()
      .transform((value) => {
        if (value == null) return null
        const trimmed = value.trim()
        return trimmed.length === 0 ? null : trimmed
      }),
    method: z
      .string()
      .min(1, 'method_required')
      .transform((value) => value.trim().toUpperCase())
      .refine((value) => METHOD_SET.has(value), 'method_invalid'),
    endpoint: z
      .string()
      .min(1, 'endpoint_required')
      .transform((value) => value.trim())
      .refine((value) => /^https?:\/\//i.test(value), 'endpoint_invalid_scheme')
      .refine((value) => value.length <= 2048, 'endpoint_too_long'),
    headers: z
      .array(headerSchema)
      .optional()
      .transform((value) => value ?? []),
    fetchSize: z
      .coerce
      .number()
      .int('fetch_size_integer')
      .min(1, 'fetch_size_min')
      .max(QUERY_API_MAX_BATCH, 'fetch_size_max'),
    sendBatchSize: z
      .coerce
      .number()
      .int('send_batch_size_integer')
      .min(1, 'send_batch_size_min')
      .max(QUERY_API_MAX_BATCH, 'send_batch_size_max'),
    sleepMs: z
      .coerce
      .number()
      .int('sleep_ms_integer')
      .min(0, 'sleep_ms_min')
      .max(QUERY_API_MAX_SLEEP_MS, 'sleep_ms_max')
      .default(0),
    requestTimeoutMs: z
      .coerce
      .number()
      .int('request_timeout_integer')
      .min(QUERY_API_MIN_TIMEOUT_MS, 'request_timeout_min')
      .max(QUERY_API_MAX_TIMEOUT_MS, 'request_timeout_max'),
    errorPolicy: z
      .string()
      .transform((value) => value.trim().toLowerCase())
      .refine((value) => ERROR_POLICY_SET.has(value), 'error_policy_invalid'),
    bodyTemplate: z
      .string()
      .nullable()
      .optional()
      .transform((value) => {
        if (value == null) return null
        const trimmed = value.trim()
        return trimmed.length === 0 ? null : trimmed
      }),
  })
  .superRefine((data, ctx) => {
    if (data.sendBatchSize > data.fetchSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'send_batch_size_gt_fetch_size',
        path: ['sendBatchSize'],
      })
    }
    const seen = new Set<string>()
    for (const header of data.headers) {
      const key = header.key.trim().toLowerCase()
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'header_key_duplicate',
          path: ['headers'],
        })
        break
      }
      seen.add(key)
    }
  })

export type QueryApiHeader = z.infer<typeof headerSchema>
export type QueryApiScriptInput = z.infer<typeof queryApiScriptInputSchema>

const openLocal = () => Database.load('sqlite:rdv_local.db')

const genScriptId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `qas_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

const nowMs = () => Date.now()

const parseJson = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value) as T
    return parsed as T
  } catch {
    return fallback
  }
}

const toIso = (value: number | null | undefined) => {
  if (!Number.isFinite(value)) return null
  const ms = value! >= 1_000_000_000_000 ? value! : value! * 1000
  try {
    return new Date(ms).toISOString()
  } catch {
    return null
  }
}

const normalizeHeadersFromStorage = (value: unknown): QueryApiHeader[] => {
  if (!value) return []
  const list = Array.isArray(value) ? (value as unknown[]) : []
  const normalized: QueryApiHeader[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const parsed = headerSchema.safeParse(item)
    if (!parsed.success) continue
    const header = parsed.data
    const key = header.key.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(header)
  }
  return normalized
}

type QueryApiScriptRow = {
  id: string
  query_id: string
  name: string
  description: string | null
  method: string
  endpoint: string
  headers: string | null
  body_template: string | null
  fetch_size: number
  send_batch_size: number
  sleep_ms: number
  request_timeout_ms: number
  error_policy: string
  created_at: number
  updated_at: number
}

export type QueryApiScriptRecord = {
  id: string
  queryId: string
  name: string
  description: string | null
  method: (typeof QUERY_API_METHODS)[number]
  endpoint: string
  headers: QueryApiHeader[]
  fetchSize: number
  sendBatchSize: number
  sleepMs: number
  requestTimeoutMs: number
  errorPolicy: (typeof QUERY_API_ERROR_POLICIES)[number]
  bodyTemplate: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type QueryApiScriptSummary = {
  id: string
  queryId: string
  name: string
  method: (typeof QUERY_API_METHODS)[number]
  endpoint: string
  updatedAt: string | null
  errorPolicy: (typeof QUERY_API_ERROR_POLICIES)[number]
}

const rowToRecord = (row: QueryApiScriptRow): QueryApiScriptRecord => ({
  id: row.id,
  queryId: row.query_id,
  name: row.name,
  description: row.description,
  method: row.method as (typeof QUERY_API_METHODS)[number],
  endpoint: row.endpoint,
  headers: normalizeHeadersFromStorage(parseJson(row.headers, [] as QueryApiHeader[])),
  fetchSize: row.fetch_size,
  sendBatchSize: row.send_batch_size,
  sleepMs: row.sleep_ms,
  requestTimeoutMs: row.request_timeout_ms,
  errorPolicy: row.error_policy as (typeof QUERY_API_ERROR_POLICIES)[number],
  bodyTemplate: row.body_template,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
})

const rowToSummary = (row: QueryApiScriptRow): QueryApiScriptSummary => ({
  id: row.id,
  queryId: row.query_id,
  name: row.name,
  method: row.method as (typeof QUERY_API_METHODS)[number],
  endpoint: row.endpoint,
  updatedAt: toIso(row.updated_at),
  errorPolicy: row.error_policy as (typeof QUERY_API_ERROR_POLICIES)[number],
})

async function ensureUniqueScriptName(
  db: any,
  queryId: string,
  name: string,
  excludeId?: string,
) {
  const trimmed = name.trim().toLowerCase()
  const sql = excludeId
    ? `SELECT id FROM query_api_scripts WHERE query_id = $1 AND lower(name) = $2 AND id <> $3 LIMIT 1`
    : `SELECT id FROM query_api_scripts WHERE query_id = $1 AND lower(name) = $2 LIMIT 1`
  const params = excludeId ? [queryId, trimmed, excludeId] : [queryId, trimmed]
  const rows = await db.select(sql, params)
  if (Array.isArray(rows) && rows.length > 0) {
    const err = new Error('script_name_exists')
    ;(err as any).code = 'script_name_exists'
    throw err
  }
}

export async function listScriptsForQuery(queryId: string): Promise<QueryApiScriptSummary[]> {
  if (!queryId) return []
  const db = await openLocal()
  const rows = await db.select<QueryApiScriptRow[]>(
    `SELECT id, query_id, name, description, method, endpoint, headers, body_template, fetch_size, send_batch_size, sleep_ms, request_timeout_ms, error_policy, created_at, updated_at
     FROM query_api_scripts
     WHERE query_id = $1
     ORDER BY updated_at DESC, name ASC`,
    [queryId],
  )
  return (rows ?? []).map(rowToSummary)
}

export async function getScriptById(id: string): Promise<QueryApiScriptRecord | null> {
  if (!id) return null
  const db = await openLocal()
  const rows = await db.select<QueryApiScriptRow[]>(
    `SELECT id, query_id, name, description, method, endpoint, headers, body_template, fetch_size, send_batch_size, sleep_ms, request_timeout_ms, error_policy, created_at, updated_at
     FROM query_api_scripts
     WHERE id = $1
     LIMIT 1`,
    [id],
  )
  if (!rows || rows.length === 0) return null
  return rowToRecord(rows[0]!)
}

export async function createScript(input: QueryApiScriptInput): Promise<{ id: string }> {
  const payload = queryApiScriptInputSchema.parse(input)
  const db = await openLocal()
  await ensureUniqueScriptName(db, payload.queryId, payload.name)
  const id = genScriptId()
  const now = nowMs()
  await db.execute(
    `INSERT INTO query_api_scripts (
      id, query_id, name, description, method, endpoint, headers, body_template,
      fetch_size, send_batch_size, sleep_ms, request_timeout_ms, error_policy, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $14
    )`,
    [
      id,
      payload.queryId,
      payload.name,
      payload.description,
      payload.method,
      payload.endpoint,
      JSON.stringify(payload.headers ?? []),
      payload.bodyTemplate,
      payload.fetchSize,
      payload.sendBatchSize,
      payload.sleepMs,
      payload.requestTimeoutMs,
      payload.errorPolicy,
      now,
    ],
  )
  return { id }
}

export async function updateScript(
  id: string,
  patch: Partial<Omit<QueryApiScriptInput, 'queryId'>> & { queryId?: string },
): Promise<void> {
  if (!id) throw new Error('id_required')
  const current = await getScriptById(id)
  if (!current) throw new Error('script_not_found')
  const base: QueryApiScriptInput = {
    id,
    queryId: current.queryId,
    name: current.name,
    description: current.description,
    method: current.method,
    endpoint: current.endpoint,
    headers: current.headers,
    fetchSize: current.fetchSize,
    sendBatchSize: current.sendBatchSize,
    sleepMs: current.sleepMs,
    requestTimeoutMs: current.requestTimeoutMs,
    errorPolicy: current.errorPolicy,
    bodyTemplate: current.bodyTemplate,
  }
  const merged = queryApiScriptInputSchema.parse({
    ...base,
    ...patch,
    id,
    queryId: patch.queryId ?? base.queryId,
  })
  const db = await openLocal()
  await ensureUniqueScriptName(db, merged.queryId, merged.name, id)
  const sets: string[] = []
  const params: any[] = []
  let idx = 1
  const append = (expr: string, value: any) => {
    sets.push(`${expr} $${idx}`)
    params.push(value)
    idx += 1
  }
  append('query_id =', merged.queryId)
  append('name =', merged.name)
  append('description =', merged.description)
  append('method =', merged.method)
  append('endpoint =', merged.endpoint)
  append('headers =', JSON.stringify(merged.headers ?? []))
  append('body_template =', merged.bodyTemplate)
  append('fetch_size =', merged.fetchSize)
  append('send_batch_size =', merged.sendBatchSize)
  append('sleep_ms =', merged.sleepMs)
  append('request_timeout_ms =', merged.requestTimeoutMs)
  append('error_policy =', merged.errorPolicy)
  append('updated_at =', nowMs())
  params.push(id)
  await db.execute(`UPDATE query_api_scripts SET ${sets.join(', ')} WHERE id = $${idx}`, params)
}

export async function deleteScript(id: string): Promise<void> {
  if (!id) return
  const db = await openLocal()
  await db.execute('DELETE FROM query_api_scripts WHERE id = $1', [id])
}

export type QueryApiRunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled'

export const QUERY_API_RUN_STATUSES: QueryApiRunStatus[] = [
  'pending',
  'running',
  'succeeded',
  'completed_with_errors',
  'failed',
  'cancelled',
]

const RUN_STATUS_SET = new Set<string>(QUERY_API_RUN_STATUSES)

const runInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  scriptId: z.string().trim().min(1, 'script_id_required'),
  queryId: z.string().trim().min(1, 'query_id_required'),
  status: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .refine((value) => RUN_STATUS_SET.has(value), 'status_invalid')
    .transform((value) => value as QueryApiRunStatus),
  scriptSnapshot: z.record(z.any()),
  progressSnapshot: z.record(z.any()).optional(),
  errorMessage: z.string().optional(),
  outputDir: z.string().optional(),
  manifestPath: z.string().optional(),
  zipPath: z.string().optional(),
  totalBatches: z.number().int().nullable().optional(),
  processedBatches: z.number().int().nullable().optional(),
  successRows: z.number().int().nullable().optional(),
  errorRows: z.number().int().nullable().optional(),
  startedAt: z.number().int().nullable().optional(),
  finishedAt: z.number().int().nullable().optional(),
})

export type QueryApiScriptRunInput = z.infer<typeof runInputSchema>

export type QueryApiScriptRunRecord = {
  id: string
  scriptId: string
  queryId: string
  status: QueryApiRunStatus
  scriptSnapshot: Record<string, unknown>
  progressSnapshot: Record<string, unknown>
  errorMessage: string | null
  outputDir: string | null
  manifestPath: string | null
  zipPath: string | null
  totalBatches: number | null
  processedBatches: number | null
  successRows: number | null
  errorRows: number | null
  startedAt: number | null
  finishedAt: number | null
  createdAt: string | null
  updatedAt: string | null
}

type QueryApiRunRow = {
  id: string
  script_id: string
  query_id: string
  status: string
  script_snapshot: string
  progress_snapshot: string | null
  error_message: string | null
  output_dir: string | null
  manifest_path: string | null
  zip_path: string | null
  total_batches: number | null
  processed_batches: number | null
  success_rows: number | null
  error_rows: number | null
  started_at: number | null
  finished_at: number | null
  created_at: number
  updated_at: number
}

const runRowToRecord = (row: QueryApiRunRow): QueryApiScriptRunRecord => ({
  id: row.id,
  scriptId: row.script_id,
  queryId: row.query_id,
  status: row.status as QueryApiRunStatus,
  scriptSnapshot: parseJson<Record<string, unknown>>(row.script_snapshot, {}),
  progressSnapshot: parseJson<Record<string, unknown>>(row.progress_snapshot, {}),
  errorMessage: row.error_message,
  outputDir: row.output_dir,
  manifestPath: row.manifest_path,
  zipPath: row.zip_path,
  totalBatches: row.total_batches,
  processedBatches: row.processed_batches,
  successRows: row.success_rows,
  errorRows: row.error_rows,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
})

const genRunId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `qsr_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

export async function createScriptRun(input: QueryApiScriptRunInput): Promise<{ id: string }> {
  const parsed = runInputSchema.parse(input)
  const db = await openLocal()
  const id = parsed.id ?? genRunId()
  const now = nowMs()
  await db.execute(
    `INSERT INTO query_api_script_runs (
      id, script_id, query_id, status, script_snapshot, progress_snapshot, error_message,
      output_dir, manifest_path, zip_path, total_batches, processed_batches,
      success_rows, error_rows, started_at, finished_at, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12,
      $13, $14, $15, $16, $17, $17
    )`,
    [
      id,
      parsed.scriptId,
      parsed.queryId,
      parsed.status,
      JSON.stringify(parsed.scriptSnapshot ?? {}),
      JSON.stringify(parsed.progressSnapshot ?? {}),
      parsed.errorMessage ?? null,
      parsed.outputDir ?? null,
      parsed.manifestPath ?? null,
      parsed.zipPath ?? null,
      parsed.totalBatches ?? null,
      parsed.processedBatches ?? null,
      parsed.successRows ?? null,
      parsed.errorRows ?? null,
      parsed.startedAt ?? null,
      parsed.finishedAt ?? null,
      now,
    ],
  )
  return { id }
}

export async function updateScriptRun(
  id: string,
  patch: Partial<QueryApiScriptRunInput>,
): Promise<void> {
  if (!id) throw new Error('run_id_required')
  const db = await openLocal()
  const rows = await db.select<QueryApiRunRow[]>(
    `SELECT id, script_id, query_id, status, script_snapshot, progress_snapshot, error_message,
            output_dir, manifest_path, zip_path, total_batches, processed_batches,
            success_rows, error_rows, started_at, finished_at, created_at, updated_at
     FROM query_api_script_runs WHERE id = $1 LIMIT 1`,
    [id],
  )
  if (!rows || rows.length === 0) throw new Error('run_not_found')
  const current = runRowToRecord(rows[0]!)
  const base: QueryApiScriptRunInput = {
    id,
    scriptId: current.scriptId,
    queryId: current.queryId,
    status: current.status,
    scriptSnapshot: current.scriptSnapshot,
    progressSnapshot: current.progressSnapshot,
    errorMessage: current.errorMessage ?? undefined,
    outputDir: current.outputDir ?? undefined,
    manifestPath: current.manifestPath ?? undefined,
    zipPath: current.zipPath ?? undefined,
    totalBatches: current.totalBatches ?? undefined,
    processedBatches: current.processedBatches ?? undefined,
    successRows: current.successRows ?? undefined,
    errorRows: current.errorRows ?? undefined,
    startedAt: current.startedAt ?? undefined,
    finishedAt: current.finishedAt ?? undefined,
  }
  const merged = runInputSchema.parse({
    ...base,
    ...patch,
    id,
    scriptId: patch?.scriptId ?? base.scriptId,
    queryId: patch?.queryId ?? base.queryId,
    scriptSnapshot: patch?.scriptSnapshot ?? base.scriptSnapshot,
    progressSnapshot: patch?.progressSnapshot ?? base.progressSnapshot,
  })
  const sets: string[] = []
  const params: any[] = []
  let idx = 1
  const append = (expr: string, value: any) => {
    sets.push(`${expr} $${idx}`)
    params.push(value)
    idx += 1
  }
  append('script_id =', merged.scriptId)
  append('query_id =', merged.queryId)
  append('status =', merged.status)
  append('script_snapshot =', JSON.stringify(merged.scriptSnapshot ?? {}))
  append('progress_snapshot =', JSON.stringify(merged.progressSnapshot ?? {}))
  append('error_message =', merged.errorMessage ?? null)
  append('output_dir =', merged.outputDir ?? null)
  append('manifest_path =', merged.manifestPath ?? null)
  append('zip_path =', merged.zipPath ?? null)
  append('total_batches =', merged.totalBatches ?? null)
  append('processed_batches =', merged.processedBatches ?? null)
  append('success_rows =', merged.successRows ?? null)
  append('error_rows =', merged.errorRows ?? null)
  append('started_at =', merged.startedAt ?? null)
  append('finished_at =', merged.finishedAt ?? null)
  append('updated_at =', nowMs())
  params.push(id)
  await db.execute(`UPDATE query_api_script_runs SET ${sets.join(', ')} WHERE id = $${idx}`, params)
}

export async function listRecentScriptRuns(
  opts?: { limit?: number; scriptId?: string; queryId?: string },
): Promise<QueryApiScriptRunRecord[]> {
  const limit = Math.max(1, Math.min(100, opts?.limit ?? 20))
  if (process.env.NODE_ENV !== 'production') {
    console.debug(
      'listRecentScriptRuns args',
      JSON.stringify(
        {
          limit,
          scriptId: opts?.scriptId ?? null,
          queryId: opts?.queryId ?? null,
        },
        null,
        2,
      ),
    )
  }
  const rows = await invoke<QueryApiRunRow[]>('list_api_script_runs', {
    args: {
      limit,
      scriptId: opts?.scriptId ?? null,
      queryId: opts?.queryId ?? null,
    },
  })
  return (rows ?? []).map(runRowToRecord)
}
