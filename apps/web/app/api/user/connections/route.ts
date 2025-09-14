import { NextResponse } from 'next/server'
import { z } from 'zod'
import { validatePostgresDsn } from '@/lib/validate-dsn'
import { encryptToBase64, decryptFromBase64 } from '@/lib/crypto'
import { getAppDb } from '@/lib/appdb'
import { env } from '@/lib/env'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { randomUUID } from 'crypto'

const CreateSchema = z.object({ alias: z.string().min(1).max(50), dsn: z.string().min(1) })

function tableName() {
  // rely on search_path set by getAppDb() to point to env.APP_DB_SCHEMA
  const prefix = env.APP_DB_TABLE_PREFIX || 'rdv_'
  return `${prefix}user_connections`
}

export async function GET() {
  if (!process.env.APP_DB_URL) {
    return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
  }
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  try {
    const pool = getAppDb()
    const sql = `SELECT id, alias, dsn_cipher, created_at, last_used_at FROM ${tableName()} WHERE user_id = $1 ORDER BY created_at ASC`
    const res = await pool.query(sql, [userId])
    const rows = res.rows as Array<{ id: unknown; alias: unknown; dsn_cipher?: unknown; created_at?: unknown; last_used_at?: unknown }>
    const items = rows.map((r) => ({
      id: String(r.id),
      alias: String(r.alias),
      host: safeParseHost(String(r.dsn_cipher || '')),
      createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : null,
      lastUsedAt: r.last_used_at ? new Date(String(r.last_used_at)).toISOString() : null,
    }))
    return NextResponse.json({ items })
  } catch (e: any) {
    return NextResponse.json({ error: 'list_failed', message: String(e?.message || e) }, { status: 500 })
  }
}

function safeParseHost(cipher: string): string | null {
  try {
    if (!cipher) return null
    const dsn = decryptFromBase64(cipher)
    const u = new URL(dsn)
    return u.hostname || null
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  if (!process.env.APP_DB_URL) {
    return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
  }
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  const { alias, dsn } = parsed.data
  const ck = validatePostgresDsn(dsn)
  if (!ck.ok) return NextResponse.json({ error: 'invalid_dsn', reason: ck.reason }, { status: 400 })
  try {
    const dsnCipher = encryptToBase64(dsn)
    const pool = getAppDb()
    const id = randomUUID()
    const sql = `INSERT INTO ${tableName()} (id, user_id, alias, dsn_cipher) VALUES ($1, $2, $3, $4)`
    await pool.query(sql, [id, userId, alias, dsnCipher])
    return NextResponse.json({ ok: true, item: { id, alias } })
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (/unique/i.test(msg) || /duplicate key value/i.test(msg)) {
      return NextResponse.json({ error: 'alias_exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'store_failed', message: msg }, { status: 500 })
  }
}
