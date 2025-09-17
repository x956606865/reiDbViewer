import Database from '@tauri-apps/plugin-sql'
import { env } from '@/lib/env'

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
}

export async function withReadonlySession<T>(
  dsn: string,
  fn: (db: any) => Promise<T>,
  opts?: SessionOptions
): Promise<T> {
  const connectStart = now()
  const db = await Database.load(dsn)
  await applySessionGuards(db, true)
  const connectMs = Math.round(now() - connectStart)
  if (opts?.onConnect) opts.onConnect(connectMs)
  try {
    const res = await fn(db)
    await db.execute('ROLLBACK')
    return res
  } catch (err) {
    try { await db.execute('ROLLBACK') } catch {}
    throw err
  }
}

export async function withWritableSession<T>(
  dsn: string,
  fn: (db: any) => Promise<T>,
  opts?: SessionOptions
): Promise<T> {
  const connectStart = now()
  const db = await Database.load(dsn)
  await applySessionGuards(db, false)
  const connectMs = Math.round(now() - connectStart)
  if (opts?.onConnect) opts.onConnect(connectMs)
  try {
    const res = await fn(db)
    await db.execute('COMMIT')
    return res
  } catch (err) {
    try { await db.execute('ROLLBACK') } catch {}
    throw err
  }
}
