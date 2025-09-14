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
    const rows = await withSafeSession(pool, env, async (client) => {
      // Use pg_indexes as the base to ensure expression and partial indexes are included reliably across versions.
      const sql = `
        WITH idx AS (
          SELECT 
            i.schemaname,
            i.tablename,
            i.indexname,
            i.indexdef,
            to_regclass(quote_ident(i.schemaname) || '.' || quote_ident(i.indexname)) AS index_oid
          FROM pg_indexes i
          WHERE i.schemaname = $1 AND i.tablename = $2
        )
        SELECT
          idx.schemaname                 AS schema,
          idx.tablename                  AS table,
          idx.indexname                  AS index,
          idx.indexdef                   AS definition,
          ix.indisunique                 AS is_unique,
          ix.indisprimary                AS is_primary,
          ix.indisvalid                  AS is_valid,
          (ix.indpred IS NOT NULL)       AS is_partial,
          am.amname                      AS method,
          COALESCE(st.idx_scan, 0)       AS idx_scan,
          COALESCE(st.idx_tup_read, 0)   AS idx_tup_read,
          COALESCE(st.idx_tup_fetch, 0)  AS idx_tup_fetch,
          COALESCE(pg_relation_size(idx.index_oid), 0) AS size_bytes
        FROM idx
        LEFT JOIN pg_class ic ON ic.oid = idx.index_oid
        LEFT JOIN pg_index ix ON ix.indexrelid = idx.index_oid
        LEFT JOIN pg_am am ON ic.relam = am.oid
        LEFT JOIN pg_stat_all_indexes st ON st.indexrelid = idx.index_oid
        ORDER BY idx.indexname
      `
      const res = await client.query(sql, [schema, table])
      return res.rows as any[]
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
    const indexes = rows.map((r) => ({
      schema: String(r.schema),
      table: String(r.table),
      name: String(r.index),
      definition: String(r.definition),
      method: r.method ? String(r.method) : null,
      isUnique: !!r.is_unique,
      isPrimary: !!r.is_primary,
      isValid: !!r.is_valid,
      isPartial: !!r.is_partial,
      idxScan: Number(r.idx_scan || 0),
      idxTupRead: Number(r.idx_tup_read || 0),
      idxTupFetch: Number(r.idx_tup_fetch || 0),
      sizeBytes: Number(r.size_bytes || 0),
      sizePretty: toPretty(Number(r.size_bytes || 0)),
    }))
    return NextResponse.json({ indexes })
  } catch (e: any) {
    return NextResponse.json({ error: 'db_query_failed', message: String(e?.message || e) }, { status: 500 })
  }
}
