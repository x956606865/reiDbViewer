import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { env } from '@/lib/env'
import { getAppDb } from '@/lib/appdb'
import { withSafeSession } from '@/lib/db'
import { getUserConnPool } from '@/lib/user-conn'
import { compileSql, isReadOnlySelect, renderSqlPreview, extractVarNames } from '@/lib/sql-template'

// Local helper: detect LIMIT/OFFSET in raw SQL (ignoring case and simple strings/comments)
function hasLimitOrOffset(sql: string): boolean {
  // very lightweight cleaner: remove single quotes and simple comments to reduce false positives
  const strip = (s: string) => {
    let out = ''
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      const ch2 = s.slice(i, i + 2)
      if (ch2 === '--') { while (i < s.length && s[i] !== '\n') i++; continue }
      if (ch2 === '/*') { const j = s.indexOf('*/', i + 2); i = j === -1 ? s.length : j + 2; continue }
      if (ch === "'") { i++; while (i < s.length) { if (s[i] === "'" && s[i - 1] !== '\\') { i++; break } i++ } continue }
      out += ch
    }
    return out
  }
  const t = strip(sql).toLowerCase()
  return /\blimit\b/.test(t) || /\boffset\b/.test(t)
}

const ExecSchema = z.object({
  savedQueryId: z.string().min(1),
  values: z.record(z.any()).default({}),
  // 预览无需连接：仅执行时才需要非空
  userConnId: z.string().optional(),
  previewOnly: z.boolean().optional(),
  // 明确用户已确认写操作（仅当 SQL 非只读时生效）
  allowWrite: z.boolean().optional(),
  pagination: z
    .object({
      enabled: z.boolean().default(false),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).default(50),
      withCount: z.boolean().default(false),
      countOnly: z.boolean().default(false),
    })
    .optional(),
})

function savedTable() {
  const p = env.APP_DB_TABLE_PREFIX || 'rdv_'
  return `${p}saved_queries`
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const parsed = ExecSchema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })

  const { savedQueryId, values: inputValues, userConnId, previewOnly, allowWrite } = parsed.data
  const pagination = parsed.data.pagination ?? { enabled: false, page: 1, pageSize: 50, withCount: false }
  // Always return compiled SQL (preview) even if not executed

  try {
    if (!process.env.APP_DB_URL) {
      return NextResponse.json({ error: 'app_db_not_configured' }, { status: 501 })
    }
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const userId = session.user.id

    // Load saved query
    const appdb = getAppDb()
    const r = await appdb.query(
      `SELECT sql, variables FROM ${savedTable()} WHERE id = $1 AND user_id = $2 AND is_archived = FALSE`,
      [savedQueryId, userId]
    )
    if (r.rowCount === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const row = r.rows[0]
    const sql: string = String(row.sql)
    const vars: any[] = Array.isArray(row.variables) ? row.variables : []

    // 保留到下方分支进行处理：只读与可写分流

    // Early validation: missing variable definitions compared to placeholders in SQL
    try {
      const inSql = new Set(extractVarNames(sql))
      const defined = new Set((vars || []).map((v: any) => v?.name).filter(Boolean))
      const missing = Array.from(inSql).filter((n) => !defined.has(n))
      if (missing.length > 0) {
        return NextResponse.json({ error: 'vars_missing', missing }, { status: 400 })
      }
    } catch {}

    const compiled = compileSql(sql, vars, inputValues)

    // 如果只读查询：允许分页与计数；若非只读：不做任何分页包裹
    const limitCapped = Math.max(1, Math.min(pagination.pageSize ?? 50, env.MAX_ROW_LIMIT))
    const page = Math.max(1, pagination.page ?? 1)
    const offset = (page - 1) * limitCapped

    const isSelect = isReadOnlySelect(sql)
    const exec = isSelect && pagination.enabled
      ? {
          text: `select * from ( ${compiled.text} ) as _rdv_sub limit $${compiled.values.length + 1} offset $${compiled.values.length + 2}`,
          values: [...compiled.values, limitCapped, offset],
          placeholders: [...compiled.placeholders, '__rdv_limit', '__rdv_offset'],
        }
      : compiled

    const needCount = isSelect && !!pagination.enabled && !!pagination.withCount
    const canCount = needCount && !hasLimitOrOffset(compiled.text)
    const countSql = canCount
      ? { text: `select count(*)::bigint as total from ( ${compiled.text} ) as _rdv_sub`, values: compiled.values, placeholders: compiled.placeholders }
      : null

    if (previewOnly) {
      // 预览仅展示“原始编译后的 SQL”（未包裹分页），避免用户对执行包裹产生困惑
      const previewInline = renderSqlPreview(compiled, vars)
      return NextResponse.json({
        preview: { text: compiled.text, values: compiled.values },
        previewInline,
      })
    }

    // Execute on user's connection with safety guards
    if (!userConnId || userConnId.trim() === '') {
      return NextResponse.json({ error: 'user_conn_required' }, { status: 400 })
    }
    const pool = await getUserConnPool(userId, userConnId)

    // 非只读：需要确认后执行；不包裹分页
    if (!isSelect) {
      if (!allowWrite) {
        const previewInline = renderSqlPreview(compiled, vars)
        return NextResponse.json({ error: 'write_requires_confirmation', previewInline }, { status: 400 })
      }
      // 执行写语句：允许返回 rows（如 RETURNING），或仅返回 command/rowCount
      // 手动管理可提交会话，避免 withSafeSession 的 ROLLBACK
      const client = await (pool as any).connect()
      let data: any
      try {
        await client.query('BEGIN')
        const timeout = Math.min(Math.max(env.QUERY_TIMEOUT_DEFAULT_MS, 1), env.QUERY_TIMEOUT_MAX_MS)
        await client.query(`SET LOCAL statement_timeout = ${timeout}` )
        await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${timeout}`)
        await client.query(`SET LOCAL search_path = pg_catalog, "$user"`)
        data = await client.query({ text: compiled.text, values: compiled.values })
        await client.query('COMMIT')
      } catch (e) {
        try { await client.query('ROLLBACK') } catch {}
        client.release()
        throw e
      }
      client.release()
      const columns = Array.isArray(data.rows) && data.rows[0] ? Object.keys(data.rows[0]) : []
      const message = [data.command || 'OK', typeof data.rowCount === 'number' ? String(data.rowCount) : undefined].filter(Boolean).join(' ')
      return NextResponse.json({
        sql: compiled.text,
        params: compiled.values,
        command: data.command,
        rowCount: data.rowCount,
        message,
        rows: data.rows || [],
        columns,
      })
    }
    let totalRows: number | undefined
    // If only counting is requested and possible, skip data query
    if (needCount && pagination.countOnly) {
      if (countSql) {
        const only = await withSafeSession(pool, env, async (client) => {
          const cres = await client.query({ text: countSql.text, values: countSql.values })
          const v = (cres.rows?.[0] as any)?.total
          const n = typeof v === 'string' ? Number(v) : (typeof v === 'number' ? v : undefined)
          return n
        })
        totalRows = only
        const result: any = { page, pageSize: limitCapped }
        if (typeof totalRows === 'number' && Number.isFinite(totalRows)) {
          result.totalRows = totalRows
          result.totalPages = Math.max(1, Math.ceil(totalRows / limitCapped))
        }
        return NextResponse.json(result)
      } else {
        // counting not possible (e.g., user SQL contains LIMIT/OFFSET)
        return NextResponse.json({ page, pageSize: limitCapped, countSkipped: true, countReason: 'user_sql_contains_limit_or_offset' })
      }
    }

    // Normal path: (optionally) count then fetch page rows
    const rows = await withSafeSession(pool, env, async (client) => {
      if (countSql) {
        const cres = await client.query({ text: countSql.text, values: countSql.values })
        const v = (cres.rows?.[0] as any)?.total
        totalRows = typeof v === 'string' ? Number(v) : (typeof v === 'number' ? v : undefined)
      }
      const res = await client.query({ text: exec.text, values: exec.values })
      return res.rows as Array<Record<string, unknown>>
    })

    const columns = Object.keys(rows[0] ?? {})
    const pageSize = pagination.enabled ? limitCapped : rows.length
    const result: any = {
      sql: exec.text,
      params: exec.values,
      columns,
      rowCount: rows.length,
      rows,
    }
    if (pagination.enabled) {
      result.page = page
      result.pageSize = pageSize
      if (typeof totalRows === 'number' && Number.isFinite(totalRows)) {
        result.totalRows = totalRows
        result.totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
      } else if (needCount && !canCount) {
        result.countSkipped = true
        result.countReason = 'user_sql_contains_limit_or_offset'
      }
    }
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ error: 'execute_failed', message: String(e?.message || e) }, { status: 500 })
  }
}
