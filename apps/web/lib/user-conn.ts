import { Pool } from 'pg'
import { getAppDb } from './appdb'
import { env } from './env'
import { decryptFromBase64 } from './crypto'

const pools = new Map<string, any>()

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

function tableName() {
  // Prefer live env for testability; fall back to compiled defaults.
  const prefix = process.env.APP_DB_TABLE_PREFIX || env.APP_DB_TABLE_PREFIX || 'rdv_'
  return `${prefix}user_connections`
}

async function fetchDsnCipher(userId: string, id: string): Promise<string | null> {
  const pool = getAppDb()
  const sql = `SELECT dsn_cipher FROM ${tableName()} WHERE id = $1 AND user_id = $2`
  const r = await pool.query(sql, [id, userId])
  if (r.rowCount === 0) return null
  return String(r.rows[0].dsn_cipher)
}

export async function getUserConnPool(userId: string, id: string): Promise<any> {
  if (pools.has(id)) return pools.get(id) as any
  const cipher = await fetchDsnCipher(userId, id)
  if (!cipher) throw new Error('connection_not_found')
  const dsn = decryptFromBase64(cipher)
  const pool = new Pool({ connectionString: dsn, ssl: parseSslFromUrl(dsn) })
  pools.set(id, pool)
  return pool
}

export const __test__ = { parseSslFromUrl, tableName }
