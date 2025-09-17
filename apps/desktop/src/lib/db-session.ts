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
    (db) => db,
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
