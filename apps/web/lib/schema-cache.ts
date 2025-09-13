import { Pool } from 'pg'
import { getAppDb } from './appdb'
import { env } from './env'

export type SchemaCachePayload = {
  databases?: string[]
  schemas?: string[]
  tables: Array<{ schema: string; name: string; columns: Array<{ name: string; dataType: string; nullable?: boolean; isPrimaryKey?: boolean; isForeignKey?: boolean; references?: { schema: string; table: string; column: string } }> }>
  ddls?: { schema: string; name: string; ddl: string }[]
}

function tableName() {
  const prefix = env.APP_DB_TABLE_PREFIX || 'rdv_'
  return `${prefix}schema_cache`
}

export async function saveSchemaCache(userId: string, userConnId: string, payload: SchemaCachePayload): Promise<{ ok: true } | { ok: false; reason: 'missing_table'; suggestedSQL: string } | { ok: false; reason: 'unknown'; message: string }>{
  try {
    const pool = getAppDb()
    const sql = `INSERT INTO ${tableName()} (user_id, user_conn_id, payload, updated_at) VALUES ($1, $2, $3::jsonb, now())
      ON CONFLICT (user_id, user_conn_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`
    await pool.query(sql, [userId, userConnId, JSON.stringify(payload)])
    return { ok: true }
  } catch (e: any) {
    if (e?.code === '42P01') {
      return { ok: false, reason: 'missing_table', suggestedSQL: renderCreateTableSql(env.APP_DB_SCHEMA || 'public', env.APP_DB_TABLE_PREFIX || 'rdv_') }
    }
    return { ok: false, reason: 'unknown', message: String(e?.message || e) }
  }
}

export async function readSchemaCache(userId: string, userConnId: string): Promise<{ payload: SchemaCachePayload; updatedAt: string } | null> {
  try {
    const pool = getAppDb()
    const sql = `SELECT payload, updated_at FROM ${tableName()} WHERE user_id = $1 AND user_conn_id = $2`
    const r = await pool.query(sql, [userId, userConnId])
    if (r.rowCount === 0) return null
    const row = r.rows[0] as any
    return { payload: row.payload as SchemaCachePayload, updatedAt: new Date(row.updated_at).toISOString() }
  } catch (e: any) {
    if (e?.code === '42P01') return null
    throw e
  }
}

function q(s: string) {
  return '"' + s.replace(/"/g, '""') + '"'
}

export function renderCreateTableSql(schema: string, prefix: string) {
  const s = q(schema)
  const t = (name: string) => `${s}.${q(prefix + name)}`
  return `CREATE TABLE IF NOT EXISTS ${t('schema_cache')} (
  user_id TEXT NOT NULL REFERENCES ${t('users')}(id) ON DELETE CASCADE,
  user_conn_id TEXT NOT NULL REFERENCES ${t('user_connections')}(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, user_conn_id)
);`
}

