import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { getAppDb } from '@/lib/appdb'
import { withSafeSession } from '@/lib/db'
import { getUserConnPool } from '@/lib/user-conn'
import { compileSql, isReadOnlySelect } from '@/lib/sql-template'

const ExecSchema = z.object({
  savedQueryId: z.string().min(1),
  values: z.record(z.any()).default({}),
  userConnId: z.string().min(1),
  previewOnly: z.boolean().optional(),
})

function savedTable() {
  const p = env.APP_DB_TABLE_PREFIX || 'rdv_'
  return `${p}saved_queries`
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const parsed = ExecSchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })

  const { savedQueryId, values: inputValues, userConnId, previewOnly } = parsed.data
  // Always return compiled SQL (preview) even if not executed

  try {
    if (!process.env.APP_DB_URL) {
      return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
    }
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const userId = session.user.id

    // Load saved query
    const appdb = getAppDb()
    const r = await appdb.query(
      `SELECT sql, variables FROM ${savedTable()} WHERE id = $1 AND user_id = $2 AND is_archived = FALSE`,
      [savedQueryId, userId]
    )
    if (r.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const row = r.rows[0]
    const sql: string = String(row.sql)
    const vars: any[] = Array.isArray(row.variables) ? row.variables : []

    if (!isReadOnlySelect(sql)) {
      return NextResponse.json({ error: 'only_select_allowed' }, { status: 400 })
    }

    const compiled = compileSql(sql, vars, inputValues)

    if (previewOnly) return NextResponse.json({ preview: compiled })

    // Execute on user's connection with safety guards
    const pool = await getUserConnPool(userId, userConnId)
    const rows = await withSafeSession(pool, env, async (client) => {
      const res = await client.query({ text: compiled.text, values: compiled.values })
      return res.rows as Array<Record<string, unknown>>
    })

    const columns = Object.keys(rows[0] ?? {})
    return NextResponse.json({ sql: compiled.text, params: compiled.values, columns, rowCount: rows.length, rows })
  } catch (e: any) {
    return NextResponse.json({ error: 'execute_failed', message: String(e?.message || e) }, { status: 500 })
  }
}

