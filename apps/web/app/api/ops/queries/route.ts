import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { withSafeSession } from '@/lib/db'
import { env } from '@/lib/env'
import { OpsActionId, buildOpsQuery, LongRunningParams } from '@/lib/ops/queries'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getUserConnPool } from '@/lib/user-conn'

const LimitOnly = z.object({ limit: z.number().int().min(1).max(1000).default(200) })

const BodySchema = z.object({
  actionId: OpsActionId,
  params: z.union([LongRunningParams, LimitOnly, z.any()]).optional(),
  userConnId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  }

  const { actionId, params, userConnId } = parsed.data
  const { text, values } = buildOpsQuery(actionId, params)

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
    const columns = Object.keys(rows[0] ?? {})
    return NextResponse.json({ sql: text, columns, rowCount: rows.length, rows })
  } catch (e: any) {
    // 常见情况：权限不足无法读取其他会话的 query 文本
    return NextResponse.json({ error: 'db_query_failed', message: String(e?.message || e), preview: { text, values } }, { status: 500 })
  }
}
