import Database from '@tauri-apps/plugin-sql'
import { decodeSqliteText } from '@/lib/sqlite-text'

export type SchemaCacheRecord = {
  id: string
  conn_id: string
  content: string
  updated_at: number
}

export type IndexCacheEntry = {
  name: string
  definition: string
  method: string | null
  isUnique: boolean
  isPrimary: boolean
  isValid: boolean
  isPartial: boolean
  idxScan: number
  idxTupRead: number
  idxTupFetch: number
  sizeBytes: number
  sizePretty: string
}

export type SchemaCachePayload = {
  databases: string[]
  schemas: string[]
  tables: Array<{ schema: string; name: string; columns: Array<{ name: string; dataType: string; nullable?: boolean; isPrimaryKey?: boolean; isForeignKey?: true; references?: { schema: string; table: string; column: string } }> }>
  ddls?: { schema: string; name: string; ddl: string }[]
  indexes?: Array<{ schema: string; name: string; indexes: IndexCacheEntry[] }>
}

async function openLocal() {
  return await Database.load('sqlite:rdv_local.db')
}

const nowSec = () => Math.floor(Date.now() / 1000)

export async function readSchemaCache(connId: string): Promise<{ payload: SchemaCachePayload; updatedAt: number } | null> {
  const db = await openLocal()
  // @ts-ignore provided by plugin
  const rows = await db.select<SchemaCacheRecord[]>(
    'SELECT id, conn_id, content, updated_at FROM schema_cache WHERE conn_id = $1 LIMIT 1',
    [connId]
  )
  if (!Array.isArray(rows) || rows.length === 0) return null
  const row = rows[0]
  if (!row) return null
  try {
    const text = decodeSqliteText(row.content)
    if (!text) return null
    const payload = JSON.parse(text) as SchemaCachePayload
    const updatedAt = Number(row.updated_at ?? 0)
    return { payload, updatedAt }
  } catch {
    return null
  }
}

export async function writeSchemaCache(connId: string, payload: SchemaCachePayload) {
  const db = await openLocal()
  const id = connId
  const t = nowSec()
  const content = JSON.stringify(payload)
  // @ts-ignore provided by plugin
  await db.execute(
    `INSERT INTO schema_cache (id, conn_id, content, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(id) DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at`,
    [id, connId, content, t]
  )
}
