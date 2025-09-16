import Database from '@tauri-apps/plugin-sql'
import { env } from '@/lib/env'
import { getDsnForConn } from '@/lib/localStore'
import {
  compileSql,
  extractVarNames,
  isReadOnlySelect,
  renderSqlPreview,
  __test__ as sqlTestHelpers,
} from '@/lib/sql-template'
import type {
  SavedQueryVariableDef,
  DynamicColumnDef,
  CalcItemDef,
} from '@rei-db-view/types/appdb'
import {
  getSavedSql,
  listSavedSql,
  type SavedSqlRecord,
  type SavedSqlSummary,
} from '@/services/savedSql'

type QueryErrorDetail = { code: string; missing?: string[]; previewInline?: string }

export class QueryError extends Error {
  code: string
  missing?: string[]
  previewInline?: string
  constructor(message: string, detail: QueryErrorDetail) {
    super(message)
    this.code = detail.code
    if (detail.missing) this.missing = detail.missing
    if (detail.previewInline) this.previewInline = detail.previewInline
  }
}

type PaginationInput = {
  enabled: boolean
  page: number
  pageSize: number
  withCount?: boolean
  countOnly?: boolean
}

type ExecuteOptions = {
  savedId: string
  values: Record<string, unknown>
  userConnId: string
  pagination?: PaginationInput
  allowWrite?: boolean
}

type ExecuteResult = {
  sql: string
  params: any[]
  rows: Array<Record<string, unknown>>
  columns: string[]
  rowCount: number
  page?: number
  pageSize?: number
  totalRows?: number
  totalPages?: number
  countSkipped?: boolean
  countReason?: string
  command?: string
  message?: string
}

type PreviewResult = { previewText: string; previewInline: string }

type ExplainOptions = {
  savedId: string
  values: Record<string, unknown>
  userConnId: string
  format: 'text' | 'json'
  analyze?: boolean
}

type ExplainResult = {
  previewInline: string
  text?: string
  rows?: Array<Record<string, unknown>>
}

type EnumOptionsResult = { options: string[]; count: number }

type CalcOptions = {
  savedId: string
  values: Record<string, unknown>
  userConnId: string
  calcSql: string
}

type CalcResult = {
  sql: string
  params: any[]
  rows: Array<Record<string, unknown>>
  columns: string[]
  rowCount: number
}

const strip = (sql: string) => sqlTestHelpers.stripStringsAndComments(sql)

const hasLimitOrOffset = (sql: string) => {
  const cleaned = strip(sql).toLowerCase()
  return /\blimit\b/.test(cleaned) || /\boffset\b/.test(cleaned)
}

const capPageSize = (size: number | undefined) => {
  const raw = Number.isFinite(size) ? Number(size) : 50
  return Math.max(1, Math.min(raw, env.MAX_ROW_LIMIT))
}

const ensureVarsDefined = (sql: string, vars: SavedQueryVariableDef[]) => {
  try {
    const inSql = new Set(extractVarNames(sql))
    const defined = new Set(vars.map((v) => v.name))
    const missing = Array.from(inSql).filter((n) => !defined.has(n))
    if (missing.length > 0) throw new QueryError('变量缺失', { code: 'vars_missing', missing })
  } catch (e) {
    if (e instanceof QueryError) throw e
  }
}

const beginReadonly = async (db: any) => {
  await db.execute('BEGIN READ ONLY')
  const timeout = Math.max(1, Math.min(env.QUERY_TIMEOUT_DEFAULT_MS, env.QUERY_TIMEOUT_MAX_MS))
  await db.execute(`SET LOCAL statement_timeout = ${timeout}`)
  await db.execute(`SET LOCAL idle_in_transaction_session_timeout = ${timeout}`)
  await db.execute(`SET LOCAL search_path = pg_catalog, "${'$user'}"`)
}

const runReadonly = async <T>(dsn: string, fn: (db: any) => Promise<T>): Promise<T> => {
  const db = await Database.load(dsn)
  await beginReadonly(db)
  try {
    const res = await fn(db)
    await db.execute('ROLLBACK')
    return res
  } catch (e) {
    try { await db.execute('ROLLBACK') } catch {}
    throw e
  }
}

const runWritable = async <T>(dsn: string, fn: (db: any) => Promise<T>): Promise<T> => {
  const db = await Database.load(dsn)
  await db.execute('BEGIN')
  const timeout = Math.max(1, Math.min(env.QUERY_TIMEOUT_DEFAULT_MS, env.QUERY_TIMEOUT_MAX_MS))
  await db.execute(`SET LOCAL statement_timeout = ${timeout}`)
  await db.execute(`SET LOCAL idle_in_transaction_session_timeout = ${timeout}`)
  await db.execute(`SET LOCAL search_path = pg_catalog, "${'$user'}"`)
  try {
    const res = await fn(db)
    await db.execute('COMMIT')
    return res
  } catch (e) {
    try { await db.execute('ROLLBACK') } catch {}
    throw e
  }
}

const loadSaved = async (id: string): Promise<SavedSqlRecord> => {
  const saved = await getSavedSql(id)
  if (!saved) throw new QueryError('未找到指定的 Saved SQL', { code: 'not_found' })
  return saved
}

export async function previewSavedSql(opts: {
  savedId: string
  values: Record<string, unknown>
}): Promise<PreviewResult> {
  const saved = await loadSaved(opts.savedId)
  ensureVarsDefined(saved.sql, saved.variables)
  const compiled = compileSql(saved.sql, saved.variables, opts.values)
  return {
    previewText: compiled.text,
    previewInline: renderSqlPreview(compiled, saved.variables),
  }
}

export async function executeSavedSql(opts: ExecuteOptions): Promise<ExecuteResult> {
  const saved = await loadSaved(opts.savedId)
  ensureVarsDefined(saved.sql, saved.variables)
  const compiled = compileSql(saved.sql, saved.variables, opts.values)
  const previewInline = renderSqlPreview(compiled, saved.variables)
  const pagination = opts.pagination ?? { enabled: false, page: 1, pageSize: 50, withCount: false, countOnly: false }
  const pageSize = capPageSize(pagination.pageSize)
  const page = Math.max(1, pagination.page ?? 1)
  const isSelect = isReadOnlySelect(saved.sql)

  const execText = (() => {
    if (isSelect && pagination.enabled) {
      const limitIdx = compiled.values.length + 1
      const offsetIdx = compiled.values.length + 2
      return {
        text: `select * from ( ${compiled.text} ) as _rdv_sub limit $${limitIdx} offset $${offsetIdx}`,
        values: [...compiled.values, pageSize, (page - 1) * pageSize],
        placeholders: [...compiled.placeholders, '__rdv_limit', '__rdv_offset'],
      }
    }
    return compiled
  })()

  const needCount = isSelect && pagination.enabled && !!pagination.withCount
  const countPossible = needCount && !hasLimitOrOffset(compiled.text)

  if (!isSelect) {
    if (!opts.allowWrite) {
      throw new QueryError('该 SQL 可能修改数据，请确认后执行。', {
        code: 'write_requires_confirmation',
        previewInline,
      })
    }
  }

  const dsn = await getDsnForConn(opts.userConnId)

  if (!isSelect) {
    return runWritable<ExecuteResult>(dsn, async (db) => {
      const res = await db.select<any[]>(execText.text, execText.values)
      const first = res[0] ?? {}
      return {
        sql: execText.text,
        params: execText.values,
        rows: res,
        columns: Object.keys(first ?? {}),
        rowCount: res.length,
        command: 'EXECUTE',
        message: `${res.length} row(s)`
      }
    })
  }

  if (needCount && pagination.countOnly) {
    if (!countPossible) {
      return {
        sql: compiled.text,
        params: compiled.values,
        rows: [],
        columns: [],
        rowCount: 0,
        page,
        pageSize,
        countSkipped: true,
        countReason: 'user_sql_contains_limit_or_offset',
      }
    }
    return runReadonly<ExecuteResult>(dsn, async (db) => {
      const countRows = await db.select<Array<{ total: number | string }>>(
        `select count(*)::bigint as total from ( ${compiled.text} ) as _rdv_sub`,
        compiled.values,
      )
      const totalRow = countRows[0]?.total
      const total = typeof totalRow === 'string' ? Number(totalRow) : Number(totalRow)
      const totalRows = Number.isFinite(total) ? total : undefined
      return {
        sql: compiled.text,
        params: compiled.values,
        rows: [],
        columns: [],
        rowCount: 0,
        page,
        pageSize,
        totalRows: totalRows ?? undefined,
        totalPages: totalRows ? Math.max(1, Math.ceil(totalRows / pageSize)) : undefined,
      }
    })
  }

  let totalRows: number | undefined
  const rows = await runReadonly<Array<Record<string, unknown>>>(dsn, async (db) => {
    if (countPossible) {
      const countRows = await db.select<Array<{ total: number | string }>>(
        `select count(*)::bigint as total from ( ${compiled.text} ) as _rdv_sub`,
        compiled.values,
      )
      const total = countRows[0]?.total
      const num = typeof total === 'string' ? Number(total) : Number(total)
      if (Number.isFinite(num)) totalRows = num
    }
    return await db.select<Array<Record<string, unknown>>>(execText.text, execText.values)
  })

  const columns = Object.keys(rows[0] ?? {})
  const result: ExecuteResult = {
    sql: execText.text,
    params: execText.values,
    rows,
    columns,
    rowCount: rows.length,
  }
  if (pagination.enabled) {
    result.page = page
    result.pageSize = pageSize
    if (Number.isFinite(totalRows)) {
      result.totalRows = totalRows
      result.totalPages = Math.max(1, Math.ceil((totalRows ?? 0) / pageSize))
    } else if (needCount && !countPossible) {
      result.countSkipped = true
      result.countReason = 'user_sql_contains_limit_or_offset'
    }
  }
  return result
}

function buildExplainSQL(
  sql: string,
  { format, analyze }: { format: 'text' | 'json'; analyze?: boolean },
): string {
  const clauses: string[] = []
  if (analyze) clauses.push('ANALYZE TRUE')
  if (format === 'json') clauses.push('FORMAT JSON')
  else clauses.push('FORMAT TEXT', 'VERBOSE FALSE', 'COSTS TRUE', 'SETTINGS FALSE')
  return `EXPLAIN (${clauses.join(', ')}) ${sql}`
}

function rowsToPlanText(rows: Array<Record<string, unknown>>): string {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const out: string[] = []
  for (const r of rows) {
    const val = (r as any)['QUERY PLAN'] ?? Object.values(r)[0]
    if (val !== undefined && val !== null) out.push(String(val))
  }
  return out.join('\n')
}

export async function explainSavedSql(opts: ExplainOptions): Promise<ExplainResult> {
  const saved = await loadSaved(opts.savedId)
  ensureVarsDefined(saved.sql, saved.variables)
  const compiled = compileSql(saved.sql, saved.variables, opts.values)
  if (opts.analyze && !isReadOnlySelect(saved.sql)) {
    throw new QueryError('ANALYZE 仅允许只读 SQL', {
      code: 'analyze_requires_readonly',
    })
  }
  const previewInline = renderSqlPreview(compiled, saved.variables)
  const dsn = await getDsnForConn(opts.userConnId)
  const format = opts.format === 'json' ? 'json' : 'text'
  const explainSql = buildExplainSQL(compiled.text, { format, analyze: opts.analyze && isReadOnlySelect(saved.sql) })
  const rows = await runReadonly<Array<Record<string, unknown>>>(dsn, async (db) => {
    return await db.select<Array<Record<string, unknown>>>(explainSql, compiled.values)
  })
  if (format === 'json') {
    return { previewInline, rows }
  }
  return { previewInline, text: rowsToPlanText(rows) }
}

export async function fetchEnumOptions(opts: {
  userConnId: string
  sql: string
}): Promise<EnumOptionsResult> {
  if (!isReadOnlySelect(opts.sql)) {
    throw new QueryError('仅支持只读 SQL', { code: 'read_only_required' })
  }
  const dsn = await getDsnForConn(opts.userConnId)
  const rows = await runReadonly<Array<Record<string, unknown>>>(dsn, async (db) => {
    return await db.select<Array<Record<string, unknown>>>(opts.sql, [])
  })
  const seen = new Set<string>()
  const options: string[] = []
  for (const r of rows) {
    const key = Object.keys(r)[0]
    if (!key) continue
    const val = r[key]
    if (val === null || val === undefined) continue
    const text = String(val)
    if (!seen.has(text)) {
      seen.add(text)
      options.push(text)
    }
  }
  return { options, count: options.length }
}

const shiftParamPlaceholders = (sql: string, offset: number) =>
  offset === 0 ? sql : sql.replace(/\$(\d+)/g, (_m, g1) => '$' + (Number(g1) + offset))

export async function computeCalcSql(opts: CalcOptions): Promise<CalcResult> {
  const saved = await loadSaved(opts.savedId)
  if (!isReadOnlySelect(saved.sql)) {
    throw new QueryError('基础 SQL 必须为只读', { code: 'base_sql_must_be_readonly' })
  }
  if (!isReadOnlySelect(opts.calcSql)) {
    throw new QueryError('计算 SQL 必须为只读', { code: 'calc_sql_must_be_readonly' })
  }
  ensureVarsDefined(saved.sql, saved.variables)
  const baseCompiled = compileSql(saved.sql, saved.variables, opts.values)
  const calcSqlPrepared = opts.calcSql.replace(/\{\{\s*_sql\s*\}\}/g, 'select * from rdv_base')
  ensureVarsDefined(calcSqlPrepared, saved.variables)
  const calcCompiled = compileSql(calcSqlPrepared, saved.variables, opts.values)
  const finalSql = `with rdv_base as ( ${shiftParamPlaceholders(baseCompiled.text, calcCompiled.values.length)} ) ${calcCompiled.text}`
  const finalParams = [...calcCompiled.values, ...baseCompiled.values]
  const dsn = await getDsnForConn(opts.userConnId)
  const rows = await runReadonly<Array<Record<string, unknown>>>(dsn, async (db) => {
    return await db.select<Array<Record<string, unknown>>>(finalSql, finalParams)
  })
  return {
    sql: finalSql,
    params: finalParams,
    rows,
    columns: Object.keys(rows[0] ?? {}),
    rowCount: rows.length,
  }
}

export async function listSavedSqlSummaries(): Promise<SavedSqlSummary[]> {
  return listSavedSql()
}
