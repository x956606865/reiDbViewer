import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getAppDb } from '@/lib/appdb'
import { decryptFromBase64 } from '@/lib/crypto'
import type { ColumnMeta, SchemaSummary, TableMeta } from '@rei-db-view/types/meta'
import { Pool } from 'pg'
import { env } from '@/lib/env'
import { saveSchemaCache } from '@/lib/schema-cache'

const BodySchema = z.object({ userConnId: z.string().min(1) })

export async function POST(req: NextRequest) {
  if (!process.env.APP_DB_URL) {
    return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
  }

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  const { userConnId } = parsed.data

  try {
    // 1) Read + decrypt DSN for this user connection
    const app = getAppDb()
    const table = tableName()
    const res = await app.query(`SELECT dsn_cipher FROM ${table} WHERE id = $1 AND user_id = $2`, [userConnId, userId])
    if (res.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const dsnCipher = String(res.rows[0].dsn_cipher)
    const dsn = decryptFromBase64(dsnCipher)

    // 2) Introspect with a safe, read-only transaction
    const { databases, schemas, tables, ddls } = await introspectPostgres(dsn)

    // Write to schema cache (best-effort)
    const saved = await saveSchemaCache(userId, userConnId, { databases, schemas, tables, ddls })
    const cacheStatus = saved.ok ? 'cached' : saved.reason === 'missing_table' ? 'cache_table_missing' : 'cache_failed'
    const extra = saved.ok ? {} : saved.reason === 'missing_table' ? { suggestedSQL: saved.suggestedSQL } : { message: (saved as any).message }
    return NextResponse.json({ databases, schemas, tables, ddls, cacheStatus, ...extra })
  } catch (e: any) {
    return NextResponse.json({
      error: 'introspect_failed',
      message: String(e?.message || e),
      code: e?.code,
      severity: e?.severity,
      detail: e?.detail,
      hint: e?.hint,
    }, { status: 500 })
  }
}

function tableName() {
  const prefix = process.env.APP_DB_TABLE_PREFIX || 'rdv_'
  // search_path 已在 getAppDb 中设置，无需 schema 限定
  return `${prefix}user_connections`
}

async function introspectPostgres(connectionString: string): Promise<{
  databases: string[]
  schemas: string[]
  tables: TableMeta[]
  ddls: { schema: string; name: string; ddl: string }[]
}> {
  const ssl = parseSslFromUrl(connectionString)
  const pool = new Pool({ connectionString, ssl })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // 安全守护：全程只读 + 超时（元数据适当放宽） + 收窄 search_path
    const timeout = Math.max(1, env.SCHEMA_REFRESH_TIMEOUT_MS)
    await client.query(`SET LOCAL statement_timeout = ${timeout}`)
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${timeout}`)
    await client.query(`SET LOCAL search_path = pg_catalog, "$user"`)
    await client.query(`SET TRANSACTION READ ONLY`)

    // databases
    const dbRes = (await client.query(
      `SELECT datname FROM pg_catalog.pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname`
    )) as any
    const databases = (dbRes.rows as Array<{ datname: string }>).map((r) => r.datname)

    // schemas (user visible)
    const schRes = (await client.query(
      `SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname`
    )) as any
    const schemas = (schRes.rows as Array<{ nspname: string }>).map((r) => r.nspname)

    // columns
    type ColRow = { schema: string; table: string; column: string; data_type: string; nullable: boolean }
    const colRes = (await client.query(
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
    )) as any

    // primary keys
    type PkRow = { schema: string; table: string; column: string }
    const pkRes = (await client.query(
      `SELECT n.nspname AS schema, c.relname AS table, a.attname AS column
       FROM pg_catalog.pg_constraint con
       JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
       JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
       WHERE con.contype = 'p'`
    )) as any

    // foreign keys (one-to-one mapping by ordinal position)
    type FkRow = { schema: string; table: string; column: string; ref_schema: string; ref_table: string; ref_column: string }
    const fkRes = (await client.query(
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
    )) as any

    // Build table map
    const key = (s: string, t: string) => `${s}.${t}`
    const pkRows = pkRes.rows as Array<PkRow>
    const pkSet = new Set(pkRows.map((r) => `${key(r.schema, r.table)}::${r.column}`))
    const fkMap = new Map<string, { column: string; ref_schema: string; ref_table: string; ref_column: string }[]>()
    for (const r of (fkRes.rows as Array<FkRow>)) {
      const k = key(r.schema, r.table)
      const arr = fkMap.get(k) || []
      arr.push({ column: r.column, ref_schema: r.ref_schema, ref_table: r.ref_table, ref_column: r.ref_column })
      fkMap.set(k, arr)
    }

    const tableCols = new Map<string, ColumnMeta[]>()
    for (const r of (colRes.rows as Array<ColRow>)) {
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

    // Synthesize simple DDLs (columns + PK + FKs)
    const ddls = tables.map((t) => ({ schema: t.schema, name: t.name, ddl: synthesizeDDL(t) }))

    return { databases, schemas, tables, ddls }
  } finally {
    try { await client.query('ROLLBACK') } catch {}
    client.release()
    // pool will close eventually; avoid keeping long-lived pools here
    // await pool.end() is omitted to allow reuse in hot-reload; Node will GC idle clients
  }
}

function q(ident: string) {
  return '"' + ident.replace(/"/g, '""') + '"'
}

function synthesizeDDL(t: TableMeta): string {
  const lines: string[] = []
  lines.push(`CREATE TABLE ${q(t.schema)}.${q(t.name)} (`)
  const colDefs: string[] = t.columns.map((c) => `  ${q(c.name)} ${c.dataType}${c.nullable ? '' : ' NOT NULL'}`)
  const pkCols = t.columns.filter((c) => c.isPrimaryKey).map((c) => q(c.name))
  if (pkCols.length > 0) colDefs.push(`  PRIMARY KEY (${pkCols.join(', ')})`)
  const fkCols = t.columns.filter((c) => (c as any).isForeignKey)
  for (const c of fkCols) {
    const ref = (c as any).references as { schema: string; table: string; column: string } | undefined
    if (ref) colDefs.push(`  FOREIGN KEY (${q(c.name)}) REFERENCES ${q(ref.schema)}.${q(ref.table)}(${q(ref.column)})`)
  }
  lines.push(colDefs.join(',\n'))
  lines.push(');')
  return lines.join('\n')
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
