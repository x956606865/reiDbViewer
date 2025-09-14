import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { auth } from '@/lib/auth'
import { getAppDb } from '@/lib/appdb'
import { env } from '@/lib/env'

const VarDefSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  label: z.string().max(100).optional(),
  type: z.enum(['text', 'number', 'boolean', 'date', 'timestamp', 'json', 'uuid']),
  required: z.boolean().optional(),
  default: z.any().optional(),
})

const CreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  sql: z.string().min(1),
  variables: z.array(VarDefSchema).default([]),
})

function tableName() {
  const prefix = env.APP_DB_TABLE_PREFIX || 'rdv_'
  return `${prefix}saved_queries`
}

function renderInitSql(schema?: string, prefix?: string) {
  const sch = schema || env.APP_DB_SCHEMA || 'public'
  const pfx = prefix || env.APP_DB_TABLE_PREFIX || 'rdv_'
  const q = (s: string) => '"' + s.replace(/"/g, '""') + '"'
  const t = (n: string) => `${q(sch)}.${q(pfx + n)}`
  return `-- Saved Queries table (per-user)
CREATE TABLE IF NOT EXISTS ${t('saved_queries')} (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES ${t('users')}(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description TEXT,
  sql TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ${q(pfx + 'saved_queries_user')} ON ${t('saved_queries')}(user_id);
`}

async function ensureTableExists() {
  const pool = getAppDb()
  const schema = env.APP_DB_SCHEMA || 'public'
  const name = tableName().replace(/^.*\./, '') // we rely on search_path, tableName is prefix+name
  const r = await pool.query(
    'SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tablename = $2) AS exists',
    [schema, name]
  )
  return Boolean(r.rows[0]?.exists)
}

export async function GET() {
  if (!process.env.APP_DB_URL) return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  try {
    const exists = await ensureTableExists()
    if (!exists) {
      return NextResponse.json(
        { error: 'feature_not_initialized', suggestedSQL: renderInitSql() },
        { status: 501 }
      )
    }
    const pool = getAppDb()
    const sql = `SELECT id, name, description, variables, created_at, updated_at FROM ${tableName()} WHERE user_id = $1 AND is_archived = FALSE ORDER BY updated_at DESC`
    const r = await pool.query(sql, [userId])
    const items = r.rows.map((x) => ({
      id: String(x.id),
      name: String(x.name),
      description: x.description ? String(x.description) : null,
      variables: Array.isArray(x.variables) ? x.variables : [],
      createdAt: x.created_at ? new Date(x.created_at).toISOString() : null,
      updatedAt: x.updated_at ? new Date(x.updated_at).toISOString() : null,
    }))
    return NextResponse.json({ items })
  } catch (e: any) {
    return NextResponse.json({ error: 'list_failed', message: String(e?.message || e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  if (!process.env.APP_DB_URL) return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const json = await req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  try {
    const exists = await ensureTableExists()
    if (!exists) {
      return NextResponse.json(
        { error: 'feature_not_initialized', suggestedSQL: renderInitSql() },
        { status: 501 }
      )
    }
    const pool = getAppDb()
    // Check duplicate name within the same user
    try {
      const dup = await pool.query(`SELECT id FROM ${tableName()} WHERE user_id = $1 AND name = $2 LIMIT 1`, [
        userId,
        parsed.data.name,
      ])
      if (dup.rowCount > 0) {
        return NextResponse.json({ error: 'name_exists', existingId: String(dup.rows[0].id) }, { status: 409 })
      }
    } catch {}
    const id = randomUUID()
    const { name, description, sql, variables } = parsed.data
    const q = `INSERT INTO ${tableName()} (id, user_id, name, description, sql, variables) VALUES ($1, $2, $3, $4, $5, $6)`
    await pool.query(q, [id, userId, name, description ?? null, sql, JSON.stringify(variables)])
    return NextResponse.json({ ok: true, id })
  } catch (e: any) {
    return NextResponse.json({ error: 'create_failed', message: String(e?.message || e) }, { status: 500 })
  }
}
