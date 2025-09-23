import type {
  QueryApiRunStatus,
  QueryApiScriptRunRecord,
} from '../services/queryApiScripts'
import { QUERY_API_RUN_STATUSES } from '../services/queryApiScripts'

export type ApiScriptRunProgressPayload = {
  totalBatches?: number | null
  processedBatches?: number | null
  requestCount?: number | null
  successRows?: number | null
  errorRows?: number | null
  processedRows?: number | null
  totalRows?: number | null
  currentBatch?: number | null
}

export type ApiScriptRunEventPayload = {
  run_id: string
  status: string
  message?: string | null
  progress?: ApiScriptRunProgressPayload | null
}

export type DerivedRunProgress = {
  totalBatches: number | null
  processedBatches: number | null
  requestCount: number | null
  successRows: number | null
  errorRows: number | null
  processedRows: number | null
  totalRows: number | null
  currentBatch: number | null
}

export type ScriptSnapshotInfo = {
  name: string | null
  method: string | null
  endpoint: string | null
}

const TERMINAL_STATUSES: QueryApiRunStatus[] = [
  'succeeded',
  'completed_with_errors',
  'failed',
  'cancelled',
]

const STATUS_LOOKUP = new Set<string>(QUERY_API_RUN_STATUSES)

const toIsoString = (ms: number): string => new Date(ms).toISOString()

const chooseNumber = (incoming: number | null | undefined, current: number | null): number | null => {
  if (incoming === undefined) return current ?? null
  return incoming
}

const mergeProgressSnapshot = (
  current: Record<string, unknown>,
  patch?: ApiScriptRunProgressPayload | null,
): Record<string, unknown> => {
  if (!patch) return { ...current }
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      next[key] = value
    }
  }
  return next
}

export const normalizeRunStatus = (
  status: string,
  fallback: QueryApiRunStatus,
): QueryApiRunStatus => {
  const lowered = status.toLowerCase()
  return STATUS_LOOKUP.has(lowered) ? (lowered as QueryApiRunStatus) : fallback
}

export const mergeRunEvent = (
  record: QueryApiScriptRunRecord,
  event: ApiScriptRunEventPayload,
  nowMs: number = Date.now(),
): QueryApiScriptRunRecord => {
  const status = normalizeRunStatus(event.status, record.status)
  const progressSnapshot = mergeProgressSnapshot(record.progressSnapshot, event.progress)
  const totalBatches = chooseNumber(event.progress?.totalBatches, record.totalBatches)
  const processedBatches = chooseNumber(event.progress?.processedBatches, record.processedBatches)
  const successRows = chooseNumber(event.progress?.successRows, record.successRows)
  const errorRows = chooseNumber(event.progress?.errorRows, record.errorRows)

  const next: QueryApiScriptRunRecord = {
    ...record,
    status,
    progressSnapshot,
    totalBatches,
    processedBatches,
    successRows,
    errorRows,
    updatedAt: toIsoString(nowMs),
  }

  if (event.message !== undefined) {
    next.errorMessage = event.message ?? null
  }

  if (status === 'running' && (next.startedAt == null || next.startedAt <= 0)) {
    next.startedAt = nowMs
  }

  if (TERMINAL_STATUSES.includes(status) && (next.finishedAt == null || next.finishedAt <= 0)) {
    next.finishedAt = nowMs
  }

  return next
}

export const applyPendingEventsToRuns = (
  runs: QueryApiScriptRunRecord[],
  pending: Record<string, ApiScriptRunEventPayload>,
  nowMs: number = Date.now(),
): { runs: QueryApiScriptRunRecord[]; resolved: string[] } => {
  const resolved: string[] = []
  const updated = runs.map((run) => {
    const event = pending[run.id]
    if (!event) return run
    resolved.push(run.id)
    return mergeRunEvent(run, event, nowMs)
  })
  return { runs: updated, resolved }
}

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export const extractRunProgress = (
  record: QueryApiScriptRunRecord,
): DerivedRunProgress => {
  const snapshot = record.progressSnapshot ?? {}
  const read = (key: string): number | null => coerceNumber((snapshot as any)[key])

  return {
    totalBatches: record.totalBatches ?? read('totalBatches'),
    processedBatches: record.processedBatches ?? read('processedBatches'),
    requestCount: read('requestCount'),
    successRows: record.successRows ?? read('successRows'),
    errorRows: record.errorRows ?? read('errorRows'),
    processedRows: read('processedRows'),
    totalRows: read('totalRows'),
    currentBatch: read('currentBatch'),
  }
}

export const extractRunScriptInfo = (
  record: QueryApiScriptRunRecord,
): ScriptSnapshotInfo => {
  const snapshot = record.scriptSnapshot as Record<string, unknown> | null | undefined
  const script = snapshot && typeof snapshot === 'object' ? (snapshot as any).script : null
  const pickString = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value : null
  return {
    name: pickString(script?.name),
    method: pickString(script?.method),
    endpoint: pickString(script?.endpoint),
  }
}
