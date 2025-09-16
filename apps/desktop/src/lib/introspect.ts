import Database from '@tauri-apps/plugin-sql'
import type { ColumnMeta, TableMeta } from '@rei-db-view/types/meta'

export type IntrospectResult = {
  databases: string[]
  schemas: string[]
  tables: TableMeta[]
  ddls: { schema: string; name: string; ddl: string }[]
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

  const ddls = tables.map((t) => ({ schema: t.schema, name: t.name, ddl: synthesizeDDL(t) }))

  return { databases, schemas, tables, ddls }
}

export { synthesizeDDL }

