import { NextResponse } from 'next/server'
import { z } from 'zod'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { getAppDb } from '@/lib/appdb'
import { withSafeSession } from '@/lib/db'
import { getUserConnPool } from '@/lib/user-conn'
import { compileSql, extractVarNames, isReadOnlySelect } from '@/lib/sql-template'

const ComputeSchema = z.object({
  savedQueryId: z.string().min(1),
  values: z.record(z.any()).default({}),
  userConnId: z.string().min(1),
  calcSql: z.string().min(1),
})

function savedTable() {
  const p = env.APP_DB_TABLE_PREFIX || 'rdv_'
  return `${p}saved_queries`
}

function shiftParamPlaceholders(sql: string, offset: number): string {
  if (!offset) return sql
  return sql.replace(/\$(\d+)/g, (_m, g1) => '$' + (Number(g1) + offset))
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null)
  const parsed = ComputeSchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  const { savedQueryId, values: inputValues, userConnId, calcSql } = parsed.data

  try {
    if (!process.env.APP_DB_URL) return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const userId = session.user.id

    // Load saved query: sql + vars
    const appdb = getAppDb()
    const r = await appdb.query(`SELECT sql, variables FROM ${savedTable()} WHERE id = $1 AND user_id = $2 AND is_archived = FALSE`, [savedQueryId, userId])
    if (r.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const baseSql: string = String(r.rows[0].sql)
    const varDefs: any[] = Array.isArray(r.rows[0].variables) ? r.rows[0].variables : []

    // Enforce read-only for both base and calc SQL
    if (!isReadOnlySelect(baseSql)) return NextResponse.json({ error: 'base_sql_must_be_readonly' }, { status: 400 })
    if (!isReadOnlySelect(calcSql)) return NextResponse.json({ error: 'calc_sql_must_be_readonly' }, { status: 400 })

    // Compile base SQL using provided values (no pagination wrapper)
    const compiledBase = compileSql(baseSql, varDefs, inputValues)

    // Replace {{_sql}} with a CTE relation reference; we will prepend a WITH rdv_base AS (...)
    const calcSqlReplaced = calcSql.replace(/\{\{\s*_sql\s*\}\}/g, 'select * from rdv_base')

    // Early check: ensure all placeholders in calcSql exist in varDefs
    try {
      const inCalc = new Set(extractVarNames(calcSqlReplaced))
      const defined = new Set((varDefs || []).map((v: any) => v?.name).filter(Boolean))
      const missing = Array.from(inCalc).filter((n) => !defined.has(n))
      if (missing.length > 0) return NextResponse.json({ error: 'vars_missing', missing }, { status: 400 })
    } catch {}

    const compiledCalc = compileSql(calcSqlReplaced, varDefs, inputValues)

    // Merge: shift base placeholders and prepend CTE
    const shiftedBase = shiftParamPlaceholders(compiledBase.text, compiledCalc.values.length)
    const finalSql = `with rdv_base as ( ${shiftedBase} ) ${compiledCalc.text}`
    const finalParams = [...compiledCalc.values, ...compiledBase.values]

    const pool = await getUserConnPool(userId, userConnId)
    const rows = await withSafeSession(pool, env, async (client) => {
      const res = await client.query({ text: finalSql, values: finalParams })
      return res.rows as Array<Record<string, unknown>>
    })
    const columns = Object.keys(rows[0] ?? {})
    return NextResponse.json({ sql: finalSql, params: finalParams, columns, rows, rowCount: rows.length })
  } catch (e: any) {
    return NextResponse.json({ error: 'compute_failed', message: String(e?.message || e) }, { status: 500 })
  }
}

