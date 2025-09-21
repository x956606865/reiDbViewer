import Database from '@tauri-apps/plugin-sql'
import { buildOpsQuery, type OpsActionId } from '@rei-db-view/ops'
import { getDsnForConn } from '@/lib/localStore'
import { withReadonlySession, withWritableSession } from '@/lib/db-session'

export type OpsQueryParams = Record<string, unknown>

export type OpsQueryResult = {
  sql: string
  rows: Array<Record<string, unknown>>
  columns: string[]
  rowCount: number
}

export type OpsSignalMode = 'cancel' | 'terminate'

export class OpsError extends Error {
  code: string
  preview?: { text: string; values: any[] }
  constructor(message: string, code: string, preview?: { text: string; values: any[] }) {
    super(message)
    this.code = code
    if (preview) this.preview = preview
  }
}

const loadLocalDb = async () => await Database.load('sqlite:rdv_local.db')

const nowSec = () => Math.floor(Date.now() / 1000)

const genId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`)

const recordAudit = async (entry: {
  connId: string
  action: string
  targetPid?: number
  status: 'success' | 'failed'
  message?: string
}) => {
  try {
    const db = await loadLocalDb()
    const createdAt = nowSec()
    await db.execute(
      `INSERT INTO ops_audit (id, conn_id, action, target_pid, status, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [genId(), entry.connId, entry.action, entry.targetPid ?? null, entry.status, entry.message ?? null, createdAt],
    )
  } catch (err) {
    console.warn('ops_audit_log_failed', err)
  }
}

export async function runOpsQuery(opts: {
  actionId: OpsActionId
  params?: OpsQueryParams
  userConnId: string
}): Promise<OpsQueryResult> {
  const { actionId, params, userConnId } = opts
  const { text, values } = buildOpsQuery(actionId, params)
  const dsn = await getDsnForConn(userConnId)
  try {
    const rows = await withReadonlySession(
      dsn,
      async (db) => {
        const result = await db.select(text, values)
        return Array.isArray(result) ? (result as Array<Record<string, unknown>>) : []
      },
      { cacheKey: userConnId },
    )
    const columns = Object.keys(rows[0] ?? {})
    return { sql: text, rows, columns, rowCount: rows.length }
  } catch (err: any) {
    throw new OpsError(String(err?.message || err), 'db_query_failed', { text, values })
  }
}

export async function sendOpsSignal(opts: {
  mode: OpsSignalMode
  pid: number
  userConnId: string
}): Promise<{ ok: boolean }> {
  const { mode, pid, userConnId } = opts
  const fn = mode === 'cancel' ? 'pg_cancel_backend' : 'pg_terminate_backend'
  const dsn = await getDsnForConn(userConnId)
  let ok = false
  let error: string | undefined
  try {
    ok = await withWritableSession(
      dsn,
      async (db) => {
        const rows = await db.select(`SELECT ${fn}($1) AS ok`, [pid])
        const first = Array.isArray(rows) ? (rows as Array<{ ok?: boolean }>)[0] : undefined
        return Boolean(first?.ok)
      },
      { cacheKey: userConnId },
    )
    return { ok }
  } catch (err: any) {
    error = String(err?.message || err)
    throw new OpsError(error, 'signal_failed')
  } finally {
    await recordAudit({
      connId: userConnId,
      action: mode,
      targetPid: pid,
      status: ok ? 'success' : 'failed',
      message: ok ? undefined : error,
    })
  }
}
