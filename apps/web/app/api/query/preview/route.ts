import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { buildSelectSql } from '@rei-db-view/query-engine/sql'
import type { Select } from '@rei-db-view/types/ast'

const BodySchema = z.object({
  select: z.any()
})

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  }

  const ast = parsed.data.select as Select
  // 仅做 SQL 预览，不执行
  const { text, values } = buildSelectSql(ast)
  return NextResponse.json({ sql: text, params: values })
}

