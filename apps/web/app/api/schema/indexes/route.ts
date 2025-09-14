import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { getUserConnPool } from '@/lib/user-conn'
import { withSafeSession } from '@/lib/db'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const userConnId = url.searchParams.get('userConnId') || ''
  const schema = url.searchParams.get('schema') || ''
  const table = url.searchParams.get('table') || ''

  if (!schema || !table) {
    return NextResponse.json({ error: 'invalid_params', message: 'missing schema/table' }, { status: 400 })
  }
  if (!process.env.APP_DB_URL) {
    return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
  }

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  if (!userConnId) return NextResponse.json({ error: 'missing_userConnId' }, { status: 400 })

  try {
    const pool = await getUserConnPool(userId, userConnId)
    const { rows, debugA, debugB } = await withSafeSession(pool, env, async (client) => {
      // A) Base via pg_indexes (covers expression/partial indexes)
      const sqlA = `
        SELECT i.schemaname AS schema, i.tablename AS table, i.indexname AS index, i.indexdef AS definition
        FROM pg_indexes i
        WHERE i.schemaname = $1 AND i.tablename = $2
      `
      const resA = await client.query(sqlA, [schema, table])

      // B) Catalog join via pg_index/pg_class (for flags + method)
      const sqlB = `
        SELECT
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
        WHERE ns.nspname = $1 AND t.relname = $2
      `
      const resB = await client.query(sqlB, [schema, table])

      // Merge: prefer B's rich fields; fill any missing names from A.
      const byName = new Map<string, any>()
      for (const r of resB.rows as any[]) byName.set(String(r.index), r)
      for (const r of resA.rows as any[]) {
        const name = String(r.index)
        if (!byName.has(name)) {
          byName.set(name, {
            schema: String(r.schema),
            table: String(r.table),
            index: name,
            definition: String(r.definition),
            is_unique: null,
            is_primary: null,
            is_valid: null,
            is_partial: null,
            method: null,
            idx_scan: 0,
            idx_tup_read: 0,
            idx_tup_fetch: 0,
            size_bytes: 0,
          })
        }
      }
      const merged = Array.from(byName.values()).sort((a, b) => String(a.index).localeCompare(String(b.index)))
      return { rows: merged, debugA: resA.rows, debugB: resB.rows }
    })
    // add pretty size client-side
    const toPretty = (n: number) => {
      if (n < 1024) return `${n} B`
      const units = ['KB', 'MB', 'GB', 'TB']
      let v = n / 1024
      let i = 0
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
      return `${v.toFixed(1)} ${units[i]}`
    }
    const indexes = rows.map((r: any) => ({
      schema: String(r.schema),
      table: String(r.table),
      name: String(r.index),
      definition: String(r.definition),
      method: r.method ? String(r.method) : (String(r.definition).match(/USING\s+(\w+)/i)?.[1] ?? null),
      isUnique: r.is_unique == null ? /CREATE\s+UNIQUE\s+INDEX/i.test(String(r.definition)) : !!r.is_unique,
      isPrimary: !!r.is_primary,
      isValid: r.is_valid == null ? true : !!r.is_valid,
      isPartial: r.is_partial == null ? /\sWHERE\s/i.test(String(r.definition)) : !!r.is_partial,
      idxScan: Number(r.idx_scan || 0),
      idxTupRead: Number(r.idx_tup_read || 0),
      idxTupFetch: Number(r.idx_tup_fetch || 0),
      sizeBytes: Number(r.size_bytes || 0),
      sizePretty: toPretty(Number(r.size_bytes || 0)),
    }))
    const debug = url.searchParams.get('debug') === '1' ? { fromPgIndexes: debugA, fromCatalog: debugB } : undefined
    return NextResponse.json(debug ? { indexes, debug } : { indexes })
  } catch (e: any) {
    return NextResponse.json({ error: 'db_query_failed', message: String(e?.message || e) }, { status: 500 })
  }
}
