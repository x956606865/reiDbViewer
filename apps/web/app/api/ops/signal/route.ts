import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getUserConnPool } from '@/lib/user-conn'
import { withSafeSession } from '@/lib/db'
import { env } from '@/lib/env'

const Body = z.object({
  userConnId: z.string().min(1),
  pid: z.number().int().positive(),
  mode: z.enum(['cancel', 'terminate']),
  confirm: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const parsed = Body.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })

  const { userConnId, pid, mode, confirm } = parsed.data
  if (confirm !== true) return NextResponse.json({ error: 'confirmation_required' }, { status: 400 })

  if (!process.env.APP_DB_URL) {
    return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
  }

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const pool = await getUserConnPool(session.user.id, userConnId)
    const rows = await withSafeSession(pool, env, async (client) => {
      const fn = mode === 'cancel' ? 'pg_cancel_backend' : 'pg_terminate_backend'
      const res = await client.query(`SELECT ${fn}($1) AS ok`, [pid]) as any
      return res.rows as Array<{ ok: boolean }>
    })
    const ok = Boolean(rows?.[0]?.ok)
    return NextResponse.json({ ok })
  } catch (e: any) {
    return NextResponse.json({ error: 'signal_failed', message: String(e?.message || e) }, { status: 500 })
  }
}
