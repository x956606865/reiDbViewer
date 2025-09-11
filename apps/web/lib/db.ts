import { Pool, PoolClient } from 'pg'
import { env } from './env'

type Env = {
  DATABASE_URL_RO?: string
  QUERY_TIMEOUT_DEFAULT_MS: number
  QUERY_TIMEOUT_MAX_MS: number
}

const pools = new Map<string, Pool>()

function makePool(url?: string): Pool {
  return new Pool({ connectionString: url })
}

export function listConnectionIds(): string[] {
  const ids = new Set<string>()
  if (env.DATABASE_URL_RO) ids.add('default')
  for (const id of env.RDV_CONN_IDS) ids.add(id)
  return Array.from(ids)
}

export function getDb(connId?: string): Pool {
  const id = connId && listConnectionIds().includes(connId) ? connId : 'default'
  if (pools.has(id)) return pools.get(id) as Pool
  let url: string | undefined
  if (id === 'default') url = env.DATABASE_URL_RO
  else url = process.env[`DATABASE_URL_RO__${id}`]
  const pool = makePool(url)
  pools.set(id, pool)
  return pool
}

export async function withSafeSession<T>(
  pool: Pool,
  env: Env,
  run: (client: PoolClient) => Promise<T>,
  opts?: { requestTimeoutMs?: number }
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const timeout = Math.min(Math.max(opts?.requestTimeoutMs ?? env.QUERY_TIMEOUT_DEFAULT_MS, 1), env.QUERY_TIMEOUT_MAX_MS)
    await client.query(`SET LOCAL statement_timeout = ${timeout}`)
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${timeout}`)
    // 最小化 search_path，避免意外函数/表解析
    await client.query(`SET LOCAL search_path = pg_catalog, "$user"`)
    const res = await run(client)
    return res
  } finally {
    try { await client.query('ROLLBACK') } catch {}
    client.release()
  }
}
