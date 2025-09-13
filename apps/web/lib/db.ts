import type { Pool, PoolClient } from 'pg'

type Env = {
  QUERY_TIMEOUT_DEFAULT_MS: number
  QUERY_TIMEOUT_MAX_MS: number
}

export async function withSafeSession<T>(
  pool: Pool,
  env: Env,
  run: (client: PoolClient) => Promise<T>,
  opts?: { requestTimeoutMs?: number }
): Promise<T> {
  const client = await (pool as any).connect()
  try {
    await client.query('BEGIN')
    const timeout = Math.min(Math.max(opts?.requestTimeoutMs ?? env.QUERY_TIMEOUT_DEFAULT_MS, 1), env.QUERY_TIMEOUT_MAX_MS)
    await client.query(`SET LOCAL statement_timeout = ${timeout}`)
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${timeout}`)
    await client.query(`SET LOCAL search_path = pg_catalog, "$user"`)
    const res = await run(client)
    return res
  } finally {
    try { await client.query('ROLLBACK') } catch {}
    client.release()
  }
}
