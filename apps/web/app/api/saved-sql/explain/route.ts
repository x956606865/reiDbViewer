import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { getAppDb } from '@/lib/appdb'
import { withSafeSession } from '@/lib/db'
import { getUserConnPool } from '@/lib/user-conn'
import { compileSql, isReadOnlySelect, renderSqlPreview, extractVarNames } from '@/lib/sql-template'
import { buildExplainSQL, rowsToPlanText } from '@/lib/pg-explain'

const ExplainSchema = z.object({
  savedQueryId: z.string().min(1),
  values: z.record(z.any()).default({}),
  userConnId: z.string(),
  format: z.enum(['text', 'json']).default('text'),
  analyze: z.boolean().default(false),
})

function savedTable() {
  const p = env.APP_DB_TABLE_PREFIX || 'rdv_'
  return `${p}saved_queries`
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const parsed = ExplainSchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })

  const { savedQueryId, values: inputValues, userConnId, format, analyze } = parsed.data

  try {
    if (!process.env.APP_DB_URL) {
      return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
    }
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const userId = session.user.id

    // Load saved query text + vars
    const appdb = getAppDb()
    const r = await appdb.query(
      `SELECT sql, variables FROM ${savedTable()} WHERE id = $1 AND user_id = $2 AND is_archived = FALSE`,
      [savedQueryId, userId]
    )
    if (r.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const row = r.rows[0]
    const sql: string = String(row.sql)
    const vars: any[] = Array.isArray(row.variables) ? row.variables : []

    // For safety, only allow EXPLAIN on read-only SELECT/WITH statements
    if (analyze && !isReadOnlySelect(sql)) {
      // 为安全起见，暂不支持对写语句做 ANALYZE（会真实执行）。
      return NextResponse.json({ error: 'analyze_requires_readonly' }, { status: 400 })
    }

    // Early variable presence check
    try {
      const inSql = new Set(extractVarNames(sql))
      const defined = new Set((vars || []).map((v: any) => v?.name).filter(Boolean))
      const missing = Array.from(inSql).filter((n) => !defined.has(n))
      if (missing.length > 0) {
        return NextResponse.json({ error: 'vars_missing', missing }, { status: 400 })
      }
    } catch {}

    const compiled = compileSql(sql, vars, inputValues)
    const explainSql = buildExplainSQL(compiled.text, { format, analyze })

    const pool = await getUserConnPool(userId, userConnId)
    const result = await withSafeSession(pool, env, async (client) => {
      const res = await client.query({ text: explainSql, values: compiled.values })
      return res.rows as Array<Record<string, unknown>>
    })

    const previewInline = renderSqlPreview(compiled, vars)
    if (format === 'json') {
      return NextResponse.json({ previewInline, format: 'json', rows: result })
    } else {
      const text = rowsToPlanText(result)
      return NextResponse.json({ previewInline, format: 'text', text })
    }
  } catch (e: any) {
    return NextResponse.json({ error: 'explain_failed', message: String(e?.message || e) }, { status: 500 })
  }
}
