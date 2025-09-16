import Database from '@tauri-apps/plugin-sql'

export type IndexInfo = {
  schema: string
  table: string
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

function toPretty(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

export async function loadIndexes(dsn: string, schema: string, table: string): Promise<IndexInfo[]> {
  const db = await Database.load(dsn)
  // A) pg_indexes
  // @ts-ignore
  const resA = await db.select<any[]>(
    `SELECT i.schemaname AS schema, i.tablename AS table, i.indexname AS index, i.indexdef AS definition
     FROM pg_indexes i WHERE i.schemaname = $1 AND i.tablename = $2`,
    [schema, table]
  )
  // B) pg_index + stats
  // @ts-ignore
  const resB = await db.select<any[]>(
    `SELECT
        ns.nspname              AS schema,
        t.relname               AS table,
        i.relname               AS index,
        pg_get_indexdef(ix.indexrelid) AS definition,
        ix.indisunique          AS is_unique,
        ix.indisprimary         AS is_primary,
        ix.indisvalid           AS is_valid,
        (ix.indpred IS NOT NULL) AS is_partial,
        am.amname               AS method,
        COALESCE(st.idx_scan, 0)      AS idx_scan,
        COALESCE(st.idx_tup_read, 0)  AS idx_tup_read,
        COALESCE(st.idx_tup_fetch, 0) AS idx_tup_fetch,
        pg_relation_size(i.oid)        AS size_bytes
      FROM pg_index ix
      JOIN pg_class t ON ix.indrelid = t.oid
      JOIN pg_namespace ns ON t.relnamespace = ns.oid
      JOIN pg_class i ON ix.indexrelid = i.oid
      LEFT JOIN pg_am am ON i.relam = am.oid
      LEFT JOIN pg_stat_all_indexes st ON st.indexrelid = i.oid
      WHERE ns.nspname = $1 AND t.relname = $2`,
    [schema, table]
  )

  const byName = new Map<string, any>()
  for (const r of resB || []) byName.set(String(r.index), r)
  for (const r of resA || []) {
    const name = String(r.index)
    if (!byName.has(name)) byName.set(name, r)
  }
  const merged: IndexInfo[] = Array.from(byName.values()).map((r: any) => {
    const definition = String(r.definition)
    const method = r.method ? String(r.method) : (definition.match(/USING\s+(\w+)/i)?.[1] ?? null)
    const isUnique = r.is_unique == null ? /CREATE\s+UNIQUE\s+INDEX/i.test(definition) : !!r.is_unique
    const isPartial = r.is_partial == null ? /\sWHERE\s/i.test(definition) : !!r.is_partial
    const sizeBytes = Number(r.size_bytes || 0)
    return {
      schema: String(r.schema),
      table: String(r.table),
      name: String(r.index),
      definition,
      method,
      isUnique,
      isPrimary: !!r.is_primary,
      isValid: r.is_valid == null ? true : !!r.is_valid,
      isPartial,
      idxScan: Number(r.idx_scan || 0),
      idxTupRead: Number(r.idx_tup_read || 0),
      idxTupFetch: Number(r.idx_tup_fetch || 0),
      sizeBytes,
      sizePretty: toPretty(sizeBytes),
    }
  })
  return merged.sort((a, b) => a.name.localeCompare(b.name))
}

