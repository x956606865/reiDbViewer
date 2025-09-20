import Database from '@tauri-apps/plugin-sql'
import type { ColumnMeta, TableMeta } from '@rei-db-view/types/meta'

export type IntrospectResult = {
  databases: string[]
  schemas: string[]
  tables: TableMeta[]
  ddls: { schema: string; name: string; ddl: string }[]
  indexes: Array<{ schema: string; name: string; indexes: IndexMeta[] }>
}

export type IndexMeta = {
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

function q(ident: string) {
  return '"' + ident.replace(/"/g, '""') + '"'
}

function synthesizeDDL(t: TableMeta): string {
  const lines: string[] = []
  lines.push(`CREATE TABLE ${q(t.schema)}.${q(t.name)} (`)
  const colDefs: string[] = t.columns.map((c) => `  ${q(c.name)} ${c.dataType}${c.nullable === false ? ' NOT NULL' : ''}`)
  const pkCols = t.columns.filter((c) => c.isPrimaryKey).map((c) => q(c.name))
  if (pkCols.length > 0) colDefs.push(`  PRIMARY KEY (${pkCols.join(', ')})`)
  const fkCols = t.columns.filter((c: any) => c.isForeignKey)
  for (const c of fkCols) {
    const ref = (c as any).references as { schema: string; table: string; column: string } | undefined
    if (ref) colDefs.push(`  FOREIGN KEY (${q(c.name)}) REFERENCES ${q(ref.schema)}.${q(ref.table)}(${q(ref.column)})`)
  }
  lines.push(colDefs.join(',\n'))
  lines.push(');')
  return lines.join('\n')
}

export async function introspectPostgres(dsn: string): Promise<IntrospectResult> {
  const db = await Database.load(dsn)

  // databases
  // @ts-ignore runtime select
  const dbRes = await db.select<{ datname: string }[]>(
    `SELECT datname FROM pg_catalog.pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname`
  )
  const databases = (dbRes || []).map((r) => r.datname)

  // schemas
  // @ts-ignore runtime select
  const schRes = await db.select<{ nspname: string }[]>(
    `SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname`
  )
  const schemas = (schRes || []).map((r) => r.nspname)

  // columns
  type ColRow = { schema: string; table: string; column: string; data_type: string; nullable: boolean }
  // @ts-ignore
  const colRes = await db.select<ColRow[]>(
    `SELECT
       n.nspname AS schema,
       c.relname AS table,
       a.attname AS column,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable
     FROM pg_catalog.pg_attribute a
     JOIN pg_catalog.pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r','p')
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE a.attnum > 0 AND NOT a.attisdropped
       AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
     ORDER BY n.nspname, c.relname, a.attnum`
  )

  // primary keys
  type PkRow = { schema: string; table: string; column: string }
  // @ts-ignore
  const pkRes = await db.select<PkRow[]>(
    `SELECT ns.nspname AS schema, cls.relname AS table, att.attname AS column
     FROM pg_catalog.pg_index ix
     JOIN pg_catalog.pg_class cls ON cls.oid = ix.indrelid
     JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
     JOIN pg_catalog.pg_attribute att ON att.attrelid = cls.oid AND att.attnum = ANY(ix.indkey)
     WHERE ix.indisprimary AND ns.nspname NOT LIKE 'pg_%' AND ns.nspname <> 'information_schema'`
  )

  // foreign keys
  type FkRow = { schema: string; table: string; column: string; ref_schema: string; ref_table: string; ref_column: string }
  // @ts-ignore
  const fkRes = await db.select<FkRow[]>(
    `SELECT
       n.nspname AS schema,
       c.relname AS table,
       a.attname AS column,
       n2.nspname AS ref_schema,
       c2.relname AS ref_table,
       a2.attname AS ref_column
     FROM pg_catalog.pg_constraint con
     JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_class c2 ON c2.oid = con.confrelid
     JOIN pg_catalog.pg_namespace n2 ON n2.oid = c2.relnamespace
     JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
     JOIN unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
     JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
     JOIN pg_catalog.pg_attribute a2 ON a2.attrelid = c2.oid AND a2.attnum = fk.attnum
     WHERE con.contype = 'f'`
  )

  const key = (s: string, t: string) => `${s}.${t}`
  const pkSet = new Set((pkRes || []).map((r) => `${key(r.schema, r.table)}::${r.column}`))
  const fkMap = new Map<string, Array<{ column: string; ref_schema: string; ref_table: string; ref_column: string }>>()
  for (const r of fkRes || []) {
    const k = key(r.schema, r.table)
    const arr = fkMap.get(k) || []
    arr.push({ column: r.column, ref_schema: r.ref_schema, ref_table: r.ref_table, ref_column: r.ref_column })
    fkMap.set(k, arr)
  }

  const tableCols = new Map<string, ColumnMeta[]>()
  for (const r of colRes || []) {
    const tkey = key(r.schema, r.table)
    const arr = tableCols.get(tkey) || []
    const isPk = pkSet.has(`${tkey}::${r.column}`)
    const fkRefs = (fkMap.get(tkey) || []).filter((f) => f.column === r.column)[0]
    const col: ColumnMeta = {
      name: r.column,
      dataType: r.data_type,
      nullable: r.nullable,
      isPrimaryKey: isPk,
      ...(fkRefs
        ? { isForeignKey: true as const, references: { schema: fkRefs.ref_schema, table: fkRefs.ref_table, column: fkRefs.ref_column } }
        : {}),
    }
    arr.push(col)
    tableCols.set(tkey, arr)
  }

  const tables: TableMeta[] = []
  for (const [tkey, cols] of tableCols) {
    const [schema, name] = tkey.split('.') as [string, string]
    tables.push({ schema, name, columns: cols })
  }
  tables.sort((a, b) => (a.schema === b.schema ? a.name.localeCompare(b.name) : a.schema.localeCompare(b.schema)))

  const tableKeySet = new Set(Array.from(tableCols.keys()))

  const toPretty = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return '0 B'
    if (n < 1024) return `${n} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = n / 1024
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024
      unitIndex += 1
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`
  }

  type IxRowA = { schema: string; table: string; index: string; definition: string }
  // @ts-ignore runtime select
  const ixResA = await db.select<IxRowA[]>(
    `SELECT schemaname AS schema, tablename AS table, indexname AS index, indexdef AS definition
     FROM pg_catalog.pg_indexes
     WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema'`
  )

  type IxRowB = {
    schema: string
    table: string
    index: string
    definition: string
    is_unique: boolean | null
    is_primary: boolean | null
    is_valid: boolean | null
    is_partial: boolean | null
    method: string | null
    idx_scan: number | null
    idx_tup_read: number | null
    idx_tup_fetch: number | null
    size_bytes: number | null
  }
  // @ts-ignore runtime select
  const ixResB = await db.select<IxRowB[]>(
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
     JOIN pg_class t ON ix.indrelid = t.oid AND t.relkind IN ('r','p')
     JOIN pg_namespace ns ON t.relnamespace = ns.oid
     JOIN pg_class i ON ix.indexrelid = i.oid
     LEFT JOIN pg_am am ON i.relam = am.oid
     LEFT JOIN pg_stat_all_indexes st ON st.indexrelid = i.oid
     WHERE ns.nspname NOT LIKE 'pg_%' AND ns.nspname <> 'information_schema'`
  )

  const tableIndexes = new Map<string, Map<string, IndexMeta>>()
  const ensureIndexMap = (tkey: string) => {
    let map = tableIndexes.get(tkey)
    if (!map) {
      map = new Map<string, IndexMeta>()
      tableIndexes.set(tkey, map)
    }
    return map
  }

  for (const r of ixResB || []) {
    const tkey = key(r.schema, r.table)
    if (!tableKeySet.has(tkey)) continue
    const indexes = ensureIndexMap(tkey)
    const definition = String(r.definition || '')
    const method = r.method ? String(r.method) : (definition.match(/USING\s+(\w+)/i)?.[1] ?? null)
    indexes.set(String(r.index), {
      name: String(r.index),
      definition,
      method,
      isUnique: r.is_unique == null ? /CREATE\s+UNIQUE\s+INDEX/i.test(definition) : !!r.is_unique,
      isPrimary: !!r.is_primary,
      isValid: r.is_valid == null ? true : !!r.is_valid,
      isPartial: r.is_partial == null ? /\sWHERE\s/i.test(definition) : !!r.is_partial,
      idxScan: Number(r.idx_scan || 0),
      idxTupRead: Number(r.idx_tup_read || 0),
      idxTupFetch: Number(r.idx_tup_fetch || 0),
      sizeBytes: Number(r.size_bytes || 0),
      sizePretty: toPretty(Number(r.size_bytes || 0)),
    })
  }

  for (const r of ixResA || []) {
    const tkey = key(r.schema, r.table)
    if (!tableKeySet.has(tkey)) continue
    const indexes = ensureIndexMap(tkey)
    if (!indexes.has(r.index)) {
      const definition = String(r.definition || '')
      const method = definition.match(/USING\s+(\w+)/i)?.[1] ?? null
      indexes.set(String(r.index), {
        name: String(r.index),
        definition,
        method,
        isUnique: /CREATE\s+UNIQUE\s+INDEX/i.test(definition),
        isPrimary: false,
        isValid: true,
        isPartial: /\sWHERE\s/i.test(definition),
        idxScan: 0,
        idxTupRead: 0,
        idxTupFetch: 0,
        sizeBytes: 0,
        sizePretty: '0 B',
      })
    }
  }

  const indexes: Array<{ schema: string; name: string; indexes: IndexMeta[] }> = []
  for (const [tkey, ixMap] of tableIndexes) {
    if (!tableKeySet.has(tkey)) continue
    const [schema, name] = tkey.split('.') as [string, string]
    const list = Array.from(ixMap.values()).sort((a, b) => a.name.localeCompare(b.name))
    indexes.push({ schema, name, indexes: list })
  }
  indexes.sort((a, b) => {
    const schemaCmp = a.schema.localeCompare(b.schema)
    return schemaCmp !== 0 ? schemaCmp : a.name.localeCompare(b.name)
  })

  const ddls = tables.map((t) => ({ schema: t.schema, name: t.name, ddl: synthesizeDDL(t) }))

  return { databases, schemas, tables, ddls, indexes }
}

export { synthesizeDDL }
