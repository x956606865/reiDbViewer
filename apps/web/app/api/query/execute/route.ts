import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { buildSelectSql } from '@rei-db-view/query-engine/sql'
import type { Select } from '@rei-db-view/types/ast'
import { getDb, withSafeSession } from '../../../lib/db'
import { env } from '../../../lib/env'

const BodySchema = z.object({ select: z.any(), connId: z.string().optional() })

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  }

  // 读取并规整 AST：限制最大行数
  const inputAst = parsed.data.select as Select
  const connId = parsed.data.connId as string | undefined
  const maxRows = env.MAX_ROW_LIMIT
  const limit = Math.min(typeof inputAst.limit === 'number' ? inputAst.limit : maxRows, maxRows)
  const ast: Select = { ...inputAst, limit }

  // 生成 SQL
  const { text, values } = buildSelectSql(ast)

  // 若未配置数据库，返回 501 + 预览（避免抛出机密路径）
  if (!env.DATABASE_URL_RO && !process.env[`DATABASE_URL_RO__${connId || ''}`]) {
    return NextResponse.json({ error: 'db_not_configured', preview: { text, values } }, { status: 501 })
  }

  try {
    const pool = getDb(connId)
    const rows = await withSafeSession(pool, env, async (client) => {
      const res = await client.query({ text, values })
      return res.rows as Array<Record<string, unknown>>
    })

    const columns = Object.keys(rows[0] ?? {})
    return NextResponse.json({ sql: text, columns, rowCount: rows.length, rows })
  } catch (e: any) {
    return NextResponse.json({ error: 'db_query_failed', message: String(e?.message || e), preview: { text, values } }, { status: 500 })
  }
}
