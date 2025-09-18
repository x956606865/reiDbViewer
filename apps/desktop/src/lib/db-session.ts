import Database from '@tauri-apps/plugin-sql'
import { env } from '@/lib/env'

type CacheEntry = {
  dsn: string
  dbPromise: Promise<any>
}

type LockEntry = {
  tail: Promise<void>
  next: Promise<void>
}

const dbCache = new Map<string, CacheEntry>()
const sessionLocks = new Map<string, LockEntry>()

const JSON_FALLBACK_ALIAS = '__rdv_row_json__'

function extractMessage(err: unknown): string {
  if (!err) return ''
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message || ''
  if (typeof err === 'object' && err && 'message' in err) {
    const msg = (err as Record<string, unknown>).message
    return typeof msg === 'string' ? msg : ''
  }
  return ''
}

function isUnsupportedDatatypeError(err: unknown): boolean {
  const msg = extractMessage(err).toLowerCase()
  return msg.includes('unsupported datatype') || msg.includes('unsupported data type')
}

function stripTrailingSemicolons(sql: string): string {
  let result = sql
  const trailingCommentPattern = /;?\s*--[^\n]*\s*$/

  while (true) {
    const next = result.replace(trailingCommentPattern, '')
    if (next === result) {
      break
    }
    result = next
  }

  result = result.replace(/;+\s*$/, '')
  return result.replace(/\s+$/, '')
}

function buildJsonFallbackQuery(sql: string): string {
  const cleaned = stripTrailingSemicolons(sql).trim()
  if (!cleaned) return ''
  return `SELECT to_jsonb(${JSON_FALLBACK_ALIAS}) AS ${JSON_FALLBACK_ALIAS} FROM (\n${cleaned}\n) ${JSON_FALLBACK_ALIAS}`
}

function parseJsonFallbackRow(row: Record<string, unknown>): Record<string, unknown> {
  if (!row) return {}
  const payload = (row as any)[JSON_FALLBACK_ALIAS]
  if (payload == null) return {}
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload)
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
      return { value: parsed as unknown }
    } catch (err) {
      throw new Error(`fallback_parse_failed: ${(err as Error)?.message || err}`)
    }
  }
  if (typeof payload === 'object') {
    return payload as Record<string, unknown>
  }
  return { value: payload }
}

function wrapSelectWithFallback(db: any): any {
  if (!db || typeof db.select !== 'function' || (db as any).__rdvSelectWrapped) return db
  const baseSelect = db.select.bind(db)
  Object.defineProperty(db, '__rdvSelectWrapped', { value: true, enumerable: false })
  db.select = async (sql: string, params: unknown[] = []) => {
    try {
      return await baseSelect(sql, params)
    } catch (err) {
      if (!isUnsupportedDatatypeError(err)) throw err
      const fallbackSql = buildJsonFallbackQuery(sql)
      if (!fallbackSql) throw err
      try {
        const rows = await baseSelect(fallbackSql, params)
        return rows.map((row: Record<string, unknown>) => parseJsonFallbackRow(row))
      } catch (fallbackErr) {
        const originalMsg = extractMessage(err)
        const fallbackMsg = extractMessage(fallbackErr)
        if (err instanceof Error) {
          err.message = `${originalMsg}${fallbackMsg ? ` (fallback failed: ${fallbackMsg})` : ''}`
          if (fallbackErr instanceof Error && fallbackErr !== err) {
            ;(err as any).cause = fallbackErr
          }
          throw err
        }
        const composed = `${originalMsg}${fallbackMsg ? ` (fallback failed: ${fallbackMsg})` : ''}` || 'fallback failed'
        throw new Error(composed, {
          cause: fallbackErr instanceof Error ? fallbackErr : undefined,
        })
      }
    }
  }
  return db
}

const resolveTimeout = () => {
  const base = Math.max(1, env.QUERY_TIMEOUT_DEFAULT_MS)
  const cap = Math.max(base, env.QUERY_TIMEOUT_MAX_MS)
  return Math.max(1, Math.min(base, cap))
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

const applySessionGuards = async (db: any, readOnly: boolean) => {
  await db.execute(readOnly ? 'BEGIN READ ONLY' : 'BEGIN')
  const timeout = resolveTimeout()
  await db.execute(`SET LOCAL statement_timeout = ${timeout}`)
  await db.execute(`SET LOCAL idle_in_transaction_session_timeout = ${timeout}`)
  await db.execute(`SET LOCAL search_path = pg_catalog, "${'$user'}"`)
}

type SessionOptions = {
  onConnect?: (ms: number) => void
  cacheKey?: string
}

function shouldInvalidateOnError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object' && err) {
    const code = (err as any).code
    if (typeof code === 'string') {
      const normalized = code.toLowerCase()
      if (
        normalized.includes('timeout') ||
        normalized.includes('connection') ||
        normalized.includes('socket') ||
        normalized.includes('reset') ||
        normalized.includes('closed')
      ) {
        return true
      }
    }
  }
  const message = typeof err === 'string' ? err : err instanceof Error ? err.message : ''
  if (!message) return false
  const normalized = message.toLowerCase()
  const patterns = ['timeout', 'connection', 'socket', 'reset', 'closed', 'broken pipe', 'not open']
  return patterns.some((keyword) => normalized.includes(keyword))
}

async function runWithLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prevEntry = sessionLocks.get(key)
  const tail = prevEntry?.tail ?? Promise.resolve()
  let release!: () => void
  const next = new Promise<void>((resolve) => {
    release = resolve
  })
  const newTail = tail.then(() => next)
  sessionLocks.set(key, { tail: newTail, next })
  await tail
  try {
    return await task()
  } finally {
    release()
    const entry = sessionLocks.get(key)
    if (entry?.next === next) {
      sessionLocks.delete(key)
    }
  }
}

async function getDatabase(key: string, dsn: string): Promise<any> {
  const existing = dbCache.get(key)
  if (existing && existing.dsn === dsn) {
    return existing.dbPromise
  }
  const wrapped = Database.load(dsn).then(
    (db) => wrapSelectWithFallback(db),
    (err) => {
      const current = dbCache.get(key)
      if (current?.dbPromise === wrapped) {
        dbCache.delete(key)
      }
      throw err
    }
  )
  dbCache.set(key, { dsn, dbPromise: wrapped })
  return wrapped
}

export function invalidateSessionCache(key: string) {
  dbCache.delete(key)
  sessionLocks.delete(key)
}

export async function withReadonlySession<T>(
  dsn: string,
  fn: (db: any) => Promise<T>,
  opts?: SessionOptions
): Promise<T> {
  const key = opts?.cacheKey ?? dsn
  return await runWithLock(key, async () => {
    const connectStart = now()
    const db = await getDatabase(key, dsn)
    await applySessionGuards(db, true)
    const connectMs = Math.round(now() - connectStart)
    if (opts?.onConnect) opts.onConnect(connectMs)
    let finished = false
    try {
      const res = await fn(db)
      await db.execute('ROLLBACK')
      finished = true
      return res
    } catch (err) {
      if (shouldInvalidateOnError(err)) {
        invalidateSessionCache(key)
      }
      throw err
    } finally {
      if (!finished) {
        try {
          await db.execute('ROLLBACK')
        } catch (rollbackErr) {
          if (shouldInvalidateOnError(rollbackErr)) {
            invalidateSessionCache(key)
          }
        }
      }
    }
  })
}

export async function withWritableSession<T>(
  dsn: string,
  fn: (db: any) => Promise<T>,
  opts?: SessionOptions
): Promise<T> {
  const key = opts?.cacheKey ?? dsn
  return await runWithLock(key, async () => {
    const connectStart = now()
    const db = await getDatabase(key, dsn)
    await applySessionGuards(db, false)
    const connectMs = Math.round(now() - connectStart)
    if (opts?.onConnect) opts.onConnect(connectMs)
    let committed = false
    try {
      const res = await fn(db)
      await db.execute('COMMIT')
      committed = true
      return res
    } catch (err) {
      if (shouldInvalidateOnError(err)) {
        invalidateSessionCache(key)
      }
      throw err
    } finally {
      if (!committed) {
        try {
          await db.execute('ROLLBACK')
        } catch (rollbackErr) {
          if (shouldInvalidateOnError(rollbackErr)) {
            invalidateSessionCache(key)
          }
        }
      }
    }
  })
}

export const __test__ = {
  extractMessage,
  isUnsupportedDatatypeError,
  stripTrailingSemicolons,
  buildJsonFallbackQuery,
  parseJsonFallbackRow,
  wrapSelectWithFallback,
}
