import Database from '@tauri-apps/plugin-sql'
import { env } from '@/lib/env'

const resolveTimeout = () => {
  const base = Math.max(1, env.QUERY_TIMEOUT_DEFAULT_MS)
  const cap = Math.max(base, env.QUERY_TIMEOUT_MAX_MS)
  return Math.max(1, Math.min(base, cap))
}

const applySessionGuards = async (db: any, readOnly: boolean) => {
  await db.execute(readOnly ? 'BEGIN READ ONLY' : 'BEGIN')
  const timeout = resolveTimeout()
  await db.execute(`SET LOCAL statement_timeout = ${timeout}`)
  await db.execute(`SET LOCAL idle_in_transaction_session_timeout = ${timeout}`)
  await db.execute(`SET LOCAL search_path = pg_catalog, "${'$user'}"`)
}

export async function withReadonlySession<T>(dsn: string, fn: (db: any) => Promise<T>): Promise<T> {
  const db = await Database.load(dsn)
  await applySessionGuards(db, true)
  try {
    const res = await fn(db)
    await db.execute('ROLLBACK')
    return res
  } catch (err) {
    try { await db.execute('ROLLBACK') } catch {}
    throw err
  }
}

export async function withWritableSession<T>(dsn: string, fn: (db: any) => Promise<T>): Promise<T> {
  const db = await Database.load(dsn)
  await applySessionGuards(db, false)
  try {
    const res = await fn(db)
    await db.execute('COMMIT')
    return res
  } catch (err) {
    try { await db.execute('ROLLBACK') } catch {}
    throw err
  }
}
