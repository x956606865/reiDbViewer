import { Pool } from 'pg'
import { env } from './env'

let appPool: Pool | null = null

export function getAppDb(): Pool {
  if (!process.env.APP_DB_URL) throw new Error('APP_DB_URL not configured')
  if (!appPool) {
    const cs = process.env.APP_DB_URL
    const ssl = parseSslFromUrl(cs)
    appPool = new Pool({ connectionString: cs, ssl })
    // Ensure unqualified identifiers resolve to the configured schema
    const schema = env.APP_DB_SCHEMA || 'public'
    appPool.on('connect', (client) => {
      // pg_catalog first, then our application schema
      client.query(`SET search_path = pg_catalog, ${quoteIdent(schema)}`).catch(() => {})
    })
  }
  return appPool
}

function parseSslFromUrl(cs: string | undefined): boolean | { rejectUnauthorized: boolean } | undefined {
  if (!cs) return undefined
  try {
    const u = new URL(cs)
    const mode = (u.searchParams.get('sslmode') || '').toLowerCase()
    if (!mode) return undefined
    if (mode === 'disable') return false
    if (mode === 'require') return true
    if (mode === 'no-verify' || mode === 'allow' || mode === 'prefer') return { rejectUnauthorized: false }
    if (mode === 'verify-ca' || mode === 'verify-full') return { rejectUnauthorized: true }
    return true
  } catch {
    return undefined
  }
}

function quoteIdent(ident: string) {
  return '"' + ident.replace(/"/g, '""') + '"'
}
