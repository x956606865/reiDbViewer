import { NextResponse } from 'next/server'
import { z } from 'zod'
import { validatePostgresDsn } from '../../../../lib/validate-dsn'
import { encryptToBase64 } from '../../../../lib/crypto'
import { getAppDb } from '../../../../lib/appdb'

const CreateSchema = z.object({ alias: z.string().min(1).max(50), dsn: z.string().min(1) })

export async function GET() {
  if (!process.env.APP_DB_URL) {
    return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
  }
  // TODO: 实现基于用户会话的查询（Better Auth 接入后）
  return NextResponse.json({ items: [] })
}

export async function POST(req: Request) {
  if (!process.env.APP_DB_URL) {
    return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
  }
  const body = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  const { alias, dsn } = parsed.data
  const ck = validatePostgresDsn(dsn)
  if (!ck.ok) return NextResponse.json({ error: 'invalid_dsn', reason: ck.reason }, { status: 400 })
  try {
    const dsnCipher = encryptToBase64(dsn)
    const pool = getAppDb()
    // TODO: 使用 Better Auth 的 session.user.id 作为 user_id
    // 占位写入（不实际执行，等待你确认与迁移）：
    // await pool.query('INSERT INTO user_connections (user_id, alias, dsn_cipher) VALUES ($1,$2,$3)', [userId, alias, dsnCipher])
    return NextResponse.json({ ok: true, preview: { alias, dsnCipher } })
  } catch (e: any) {
    return NextResponse.json({ error: 'store_failed', message: String(e?.message || e) }, { status: 500 })
  }
}

