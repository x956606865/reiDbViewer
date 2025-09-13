import { NextResponse } from 'next/server'
import { getAppDb } from '@/lib/appdb'
import { checkInitStatus } from '@/lib/appdb-init'
import { env } from '@/lib/env'

export async function GET(request: Request) {
  if (!process.env.APP_DB_URL) {
    return NextResponse.json({ configured: false, reason: 'APP_DB_URL_not_set' })
  }
  const url = new URL(request.url)
  const schema = url.searchParams.get('schema') || env.APP_DB_SCHEMA
  const prefix = url.searchParams.get('prefix') || env.APP_DB_TABLE_PREFIX
  try {
    const pool = getAppDb()
    const status = await checkInitStatus(pool, schema, prefix)
    return NextResponse.json(status)
  } catch (e: any) {
    return NextResponse.json({ configured: true, error: 'check_failed', message: String(e?.message || e) }, { status: 500 })
  }
}
