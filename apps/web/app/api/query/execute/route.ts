import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { buildSelectSql } from '@rei-db-view/query-engine/sql'
import type { Select, ColumnSelect, ComputedSelect } from '@rei-db-view/types/ast'
import { withSafeSession } from '@/lib/db'
import { env } from '@/lib/env'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getUserConnPool } from '@/lib/user-conn'

const BodySchema = z.object({ select: z.any(), userConnId: z.string().min(1) })

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  }

  // 读取并规整 AST：限制最大行数
  const inputAst = parsed.data.select as Select
  const userConnId = parsed.data.userConnId as string
  const maxRows = env.MAX_ROW_LIMIT
  const limit = Math.min(typeof inputAst.limit === 'number' ? inputAst.limit : maxRows, maxRows)
  const ast: Select = { ...inputAst, limit }

  // 生成 SQL
  const { text, values } = buildSelectSql(ast)

  try {
    if (!process.env.APP_DB_URL) {
      return NextResponse.json({ error: 'app_db_not_configured', preview: { text, values } }, { status: 501 })
    }
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const pool = await getUserConnPool(session.user.id, userConnId)
    const rows = await withSafeSession(pool, env, async (client) => {
      const res = await client.query({ text, values })
      return res.rows as Array<Record<string, unknown>>
    })

    // 列名：优先按 AST 投影推导；若有数据再校正为结果列顺序
    const projected: string[] = (ast.columns || []).map((c: any) => {
      const isCol = (c as ColumnSelect).kind === 'column'
      if (isCol) return (c as ColumnSelect).alias || (c as ColumnSelect).ref.name
      return (c as ComputedSelect).alias
    })
    const resultCols = Object.keys(rows[0] ?? {})
    const columns = resultCols.length > 0 ? resultCols : projected
    return NextResponse.json({ sql: text, columns, rowCount: rows.length, rows })
  } catch (e: any) {
    return NextResponse.json({ error: 'db_query_failed', message: String(e?.message || e), preview: { text, values } }, { status: 500 })
  }
}
