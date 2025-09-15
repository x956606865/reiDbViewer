import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getAppDb } from '@/lib/appdb'
import { env } from '@/lib/env'

const VarDefSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  label: z.string().max(100).optional(),
  type: z.enum(['text', 'number', 'boolean', 'date', 'timestamp', 'json', 'uuid', 'raw']),
  required: z.boolean().optional(),
  default: z.any().optional(),
})

const DynColSchema = z.object({
  name: z.string().min(1).max(64),
  code: z.string().min(1),
  manualTrigger: z.boolean().optional(),
})

const CalcItemSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(['sql', 'js']),
  code: z.string().min(1),
})

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  sql: z.string().min(1).optional(),
  variables: z.array(VarDefSchema).optional(),
  dynamicColumns: z.array(DynColSchema).optional(),
  calcItems: z.array(CalcItemSchema).optional(),
  isArchived: z.boolean().optional(),
})

function tableName() {
  const prefix = env.APP_DB_TABLE_PREFIX || 'rdv_'
  return `${prefix}saved_queries`
}

function renderAlterAddDynCols(schema?: string, prefix?: string) {
  const sch = schema || env.APP_DB_SCHEMA || 'public'
  const pfx = prefix || env.APP_DB_TABLE_PREFIX || 'rdv_'
  const q = (s: string) => '"' + s.replace(/"/g, '""') + '"'
  const t = (n: string) => `${q(sch)}.${q(pfx + n)}`
  return `ALTER TABLE ${t('saved_queries')} ADD COLUMN IF NOT EXISTS dynamic_columns JSONB NOT NULL DEFAULT '[]'::jsonb;`
}

function renderAlterAddCalcItems(schema?: string, prefix?: string) {
  const sch = schema || env.APP_DB_SCHEMA || 'public'
  const pfx = prefix || env.APP_DB_TABLE_PREFIX || 'rdv_'
  const q = (s: string) => '"' + s.replace(/"/g, '""') + '"'
  const t = (n: string) => `${q(sch)}.${q(pfx + n)}`
  return `ALTER TABLE ${t('saved_queries')} ADD COLUMN IF NOT EXISTS calc_items JSONB NOT NULL DEFAULT '[]'::jsonb;`
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!process.env.APP_DB_URL) return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  try {
    const pool = getAppDb()
    let r
    try {
      r = await pool.query(
        `SELECT id, name, description, sql, variables, dynamic_columns, calc_items, is_archived, created_at, updated_at FROM ${tableName()} WHERE id = $1 AND user_id = $2`,
        [id, userId]
      )
    } catch (e: any) {
      const msg = String(e?.message || e)
      if ((/dynamic_columns/i.test(msg) || /calc_items/i.test(msg)) && /does not exist|column/i.test(msg)) {
        r = await pool.query(
          `SELECT id, name, description, sql, variables, is_archived, created_at, updated_at FROM ${tableName()} WHERE id = $1 AND user_id = $2`,
          [id, userId]
        )
      } else throw e
    }
    if (r.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const x = r.rows[0]
    return NextResponse.json({
      id: String(x.id),
      name: String(x.name),
      description: x.description ? String(x.description) : null,
      sql: String(x.sql),
      variables: Array.isArray(x.variables) ? x.variables : [],
      dynamicColumns: Array.isArray((x as any).dynamic_columns) ? (x as any).dynamic_columns : [],
      calcItems: Array.isArray((x as any).calc_items) ? (x as any).calc_items : [],
      isArchived: !!x.is_archived,
      createdAt: x.created_at ? new Date(x.created_at).toISOString() : null,
      updatedAt: x.updated_at ? new Date(x.updated_at).toISOString() : null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'fetch_failed', message: String(e?.message || e) }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!process.env.APP_DB_URL) return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id
  const json = await req.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  try {
    const pool = getAppDb()
    // If renaming, prevent duplicate names across other records
    if (parsed.data.name !== undefined) {
      const dup = await pool.query(
        `SELECT id FROM ${tableName()} WHERE user_id = $1 AND name = $2 AND id <> $3 LIMIT 1`,
        [userId, parsed.data.name, id]
      )
      if (dup.rowCount > 0) return NextResponse.json({ error: 'name_exists', existingId: String(dup.rows[0].id) }, { status: 409 })
    }
    const fields: string[] = []
    const values: any[] = []
    let idx = 1
    const push = (col: string, val: any) => { fields.push(`${col} = $${idx++}`); values.push(val) }
    if (parsed.data.name !== undefined) push('name', parsed.data.name)
    if (parsed.data.description !== undefined) push('description', parsed.data.description)
    if (parsed.data.sql !== undefined) push('sql', parsed.data.sql)
    if (parsed.data.variables !== undefined) push('variables', JSON.stringify(parsed.data.variables))
    if (parsed.data.dynamicColumns !== undefined) push('dynamic_columns', JSON.stringify(parsed.data.dynamicColumns))
    if (parsed.data.calcItems !== undefined) push('calc_items', JSON.stringify(parsed.data.calcItems))
    if (parsed.data.isArchived !== undefined) push('is_archived', parsed.data.isArchived)
    push('updated_at', new Date())
    values.push(id, userId)
    const q = `UPDATE ${tableName()} SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING id`
    let r
    try {
      r = await pool.query(q, values)
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (/dynamic_columns/i.test(msg) && /does not exist|column/i.test(msg)) {
        return NextResponse.json({ error: 'feature_not_initialized', suggestedSQL: renderAlterAddDynCols() }, { status: 501 })
      }
      if (/calc_items/i.test(msg) && /does not exist|column/i.test(msg)) {
        return NextResponse.json({ error: 'feature_not_initialized', suggestedSQL: renderAlterAddCalcItems() }, { status: 501 })
      }
      throw e
    }
    if (r.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: 'update_failed', message: String(e?.message || e) }, { status: 500 })
  }
}
