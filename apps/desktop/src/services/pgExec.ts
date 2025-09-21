import { env } from '@/lib/env'
import { getDsnForConn } from '@/lib/localStore'
import {
  compileSql,
  extractVarNames,
  isReadOnlySelect,
  renderSqlPreview,
  __test__ as sqlTestHelpers,
} from '@/lib/sql-template'
import { withReadonlySession, withWritableSession } from '@/lib/db-session'
import { recordRecentQuery } from '@/lib/assistant/recent-queries-store'
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

type ExecuteTempOptions = {
  sql: string
  userConnId: string
  pagination?: PaginationInput
  allowWrite?: boolean
}

type TimingInfo = {
  connectMs?: number
  queryMs?: number
  countMs?: number
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
  timing?: TimingInfo
}

type PreviewResult = { previewText: string; previewInline: string }

type ExplainOptions = {
  savedId: string
  values: Record<string, unknown>
  userConnId: string
  format: 'text' | 'json'
  analyze?: boolean
}

type ExplainTempOptions = {
  sql: string
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
  timing?: TimingInfo
}

type RecentRecord = {
  sql: string
  preview: string
  title?: string | null
  referenceId?: string | null
  source: 'saved-sql' | 'ad-hoc'
}

type SqlCoreInput = {
  baseSql: string
  originalSqlForCheck: string
  values: any[]
  userConnId: string
  pagination?: PaginationInput
  allowWrite?: boolean
  previewInline: string
  recent?: RecentRecord
  displaySql?: string
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

const strip = (sql: string) => sqlTestHelpers.stripStringsAndComments(sql)

const hasLimitOrOffset = (sql: string) => {
  const cleaned = strip(sql).toLowerCase()
  return /\blimit\b/.test(cleaned) || /\boffset\b/.test(cleaned)
}

const stripTrailingSemicolons = (sql: string) => {
  let current = sql ?? ''
  // Repeatedly trim trailing whitespace and semicolons
  while (true) {
    const trimmed = current.trimEnd()
    if (trimmed.endsWith(';')) {
      current = trimmed.slice(0, -1)
      continue
    }
    return trimmed
  }
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

function recordRecent(record?: RecentRecord) {
  if (!record) return
  const title = record.title?.trim() || (record.source === 'saved-sql' ? 'Saved SQL' : 'Ad-hoc query')
  void recordRecentQuery({
    sql: record.sql,
    preview: record.preview,
    executedAt: Date.now(),
    title,
    source: record.source,
    referenceId: record.referenceId ?? null,
  }).catch((err) => {
    console.warn('failed to record recent query', err)
  })
}

async function executeSqlCore(ctx: SqlCoreInput): Promise<ExecuteResult> {
  const baseSql = stripTrailingSemicolons(ctx.baseSql)
  const originalForCheck = stripTrailingSemicolons(ctx.originalSqlForCheck)
  if (!baseSql) {
    throw new QueryError('SQL 不能为空', { code: 'sql_empty' })
  }
  const pagination =
    ctx.pagination ?? { enabled: false, page: 1, pageSize: 50, withCount: false, countOnly: false }
  const pageSize = capPageSize(pagination.pageSize)
  const page = Math.max(1, pagination.page ?? 1)
  const isSelect = isReadOnlySelect(originalForCheck || baseSql)

  if (!isSelect) {
    if (!ctx.allowWrite) {
      throw new QueryError('该 SQL 可能修改数据，请确认后执行。', {
        code: 'write_requires_confirmation',
        previewInline: ctx.previewInline,
      })
    }
  }

  const execText = (() => {
    if (isSelect && pagination.enabled) {
      const limitIdx = ctx.values.length + 1
      const offsetIdx = ctx.values.length + 2
      return {
        text: `select * from ( ${baseSql} ) as _rdv_sub limit $${limitIdx} offset $${offsetIdx}`,
        values: [...ctx.values, pageSize, (page - 1) * pageSize],
      }
    }
    return {
      text: baseSql,
      values: [...ctx.values],
    }
  })()

  const displaySql = ctx.displaySql ?? baseSql

  const needCount = isSelect && pagination.enabled && !!pagination.withCount
  const countPossible = needCount && !hasLimitOrOffset(baseSql)

  const dsn = await getDsnForConn(ctx.userConnId)
  const captureRecent = () => recordRecent(ctx.recent)

  if (!isSelect) {
    let connectMs: number | undefined
    const execResult = await withWritableSession<ExecuteResult>(
      dsn,
      async (db) => {
        const queryStart = now()
        const rawRows = await db.select(execText.text, execText.values)
        const queryMs = Math.round(now() - queryStart)
        const rows = Array.isArray(rawRows)
          ? (rawRows as Array<Record<string, unknown>>)
          : []
        const first = rows[0] ?? {}
        return {
          sql: displaySql,
          params: execText.values,
          rows,
          columns: Object.keys(first ?? {}),
          rowCount: rows.length,
          command: 'EXECUTE',
          message: `${rows.length} row(s)`,
          timing: { queryMs },
        }
      },
      {
        onConnect: (ms) => {
          connectMs = ms
        },
        cacheKey: ctx.userConnId,
      },
    )
    if (connectMs != null) {
      execResult.timing = { ...(execResult.timing ?? {}), connectMs }
    }
    captureRecent()
    return execResult
  }

  if (needCount && pagination.countOnly) {
    if (!countPossible) {
      const result: ExecuteResult = {
        sql: displaySql,
        params: ctx.values,
        rows: [],
        columns: [],
        rowCount: 0,
        page,
        pageSize,
        totalRows: undefined,
        totalPages: undefined,
        countSkipped: true,
        countReason: 'user_sql_contains_limit_or_offset',
      }
      captureRecent()
      return result
    }
    let connectMs: number | undefined
    const countResult = await withReadonlySession<ExecuteResult>(
      dsn,
      async (db) => {
        const countStart = now()
        const rawRows = await db.select(
          `select count(*)::bigint as total from ( ${baseSql} ) as _rdv_sub`,
          ctx.values,
        )
        const countRows = Array.isArray(rawRows)
          ? (rawRows as Array<{ total?: number | string }>)
          : []
        const total = countRows[0]?.total
        const num = typeof total === 'string' ? Number(total) : Number(total)
        const totalRows = Number.isFinite(num) ? num : undefined
        return {
          sql: displaySql,
          params: ctx.values,
          rows: [],
          columns: [],
          rowCount: 0,
          page,
          pageSize,
          totalRows,
          totalPages: totalRows ? Math.max(1, Math.ceil(totalRows / pageSize)) : undefined,
          timing: { countMs: Math.round(now() - countStart) },
        }
      },
      {
        onConnect: (ms) => {
          connectMs = ms
        },
        cacheKey: ctx.userConnId,
      },
    )
    if (connectMs != null) {
      countResult.timing = { ...(countResult.timing ?? {}), connectMs }
    }
    captureRecent()
    return countResult
  }

  let connectMs: number | undefined
  const result = await withReadonlySession<ExecuteResult>(
    dsn,
    async (db) => {
      let totalRowsValue: number | undefined
      let countMs: number | undefined
      if (countPossible) {
        const countStart = now()
        const rawRows = await db.select(
          `select count(*)::bigint as total from ( ${baseSql} ) as _rdv_sub`,
          ctx.values,
        )
        const countRows = Array.isArray(rawRows)
          ? (rawRows as Array<{ total?: number | string }>)
          : []
        const total = countRows[0]?.total
        const num = typeof total === 'string' ? Number(total) : Number(total)
        if (Number.isFinite(num)) totalRowsValue = num
        countMs = Math.round(now() - countStart)
      }
      const queryStart = now()
      const rawRows = await db.select(execText.text, execText.values)
      const dataRows = Array.isArray(rawRows)
        ? (rawRows as Array<Record<string, unknown>>)
        : []
      const queryMs = Math.round(now() - queryStart)
      const columns = Object.keys(dataRows[0] ?? {})
      const execResult: ExecuteResult = {
        sql: displaySql,
        params: execText.values,
        rows: dataRows,
        columns,
        rowCount: dataRows.length,
        timing: { queryMs, countMs },
      }
      if (pagination.enabled) {
        execResult.page = page
        execResult.pageSize = pageSize
        if (Number.isFinite(totalRowsValue)) {
          execResult.totalRows = totalRowsValue
          execResult.totalPages = Math.max(1, Math.ceil((totalRowsValue ?? 0) / pageSize))
        } else if (needCount && !countPossible) {
          execResult.countSkipped = true
          execResult.countReason = 'user_sql_contains_limit_or_offset'
        }
      }
      return execResult
    },
    {
      onConnect: (ms) => {
        connectMs = ms
      },
      cacheKey: ctx.userConnId,
    },
  )
  if (connectMs != null) {
    result.timing = { ...(result.timing ?? {}), connectMs }
  }
  captureRecent()
  return result
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
  return executeSqlCore({
    baseSql: compiled.text,
    originalSqlForCheck: saved.sql,
    values: compiled.values,
    userConnId: opts.userConnId,
    pagination: opts.pagination,
    allowWrite: opts.allowWrite,
    previewInline,
    recent: {
      sql: saved.sql,
      preview: previewInline,
      title: saved.name,
      referenceId: saved.id,
      source: 'saved-sql',
    },
    displaySql: previewInline,
  })
}

export async function previewTempSql(sql: string): Promise<PreviewResult> {
  const normalized = (sql ?? '').trim()
  const cleaned = stripTrailingSemicolons(normalized)
  if (!cleaned) {
    throw new QueryError('SQL 不能为空', { code: 'sql_empty' })
  }
  return {
    previewText: cleaned,
    previewInline: cleaned,
  }
}

export async function executeTempSql(opts: ExecuteTempOptions): Promise<ExecuteResult> {
  const normalized = (opts.sql ?? '').trim()
  const cleaned = stripTrailingSemicolons(normalized)
  if (!cleaned) {
    throw new QueryError('SQL 不能为空', { code: 'sql_empty' })
  }
  return executeSqlCore({
    baseSql: cleaned,
    originalSqlForCheck: cleaned,
    values: [],
    userConnId: opts.userConnId,
    pagination: opts.pagination,
    allowWrite: opts.allowWrite,
    previewInline: cleaned,
    displaySql: cleaned,
    recent: {
      sql: cleaned,
      preview: cleaned,
      title: '临时查询',
      source: 'ad-hoc',
    },
  })
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
  const explainTarget = stripTrailingSemicolons(compiled.text)
  if (!explainTarget) {
    throw new QueryError('SQL 不能为空', { code: 'sql_empty' })
  }
  const explainSql = buildExplainSQL(explainTarget, {
    format,
    analyze: opts.analyze && isReadOnlySelect(saved.sql),
  })
  const rows = await withReadonlySession<Array<Record<string, unknown>>>(
    dsn,
    async (db) => {
      const rows = await db.select(explainSql, compiled.values)
      return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []
    },
    { cacheKey: opts.userConnId },
  )
  if (format === 'json') {
    return { previewInline, rows }
  }
  return { previewInline, text: rowsToPlanText(rows) }
}

export async function explainTempSql(opts: ExplainTempOptions): Promise<ExplainResult> {
  const normalized = (opts.sql ?? '').trim()
  const cleaned = stripTrailingSemicolons(normalized)
  if (!cleaned) {
    throw new QueryError('SQL 不能为空', { code: 'sql_empty' })
  }
  if (opts.analyze && !isReadOnlySelect(cleaned)) {
    throw new QueryError('ANALYZE 仅允许只读 SQL', {
      code: 'analyze_requires_readonly',
    })
  }
  const previewInline = cleaned
  const dsn = await getDsnForConn(opts.userConnId)
  const format = opts.format === 'json' ? 'json' : 'text'
  const explainSql = buildExplainSQL(cleaned, {
    format,
    analyze: opts.analyze && isReadOnlySelect(cleaned),
  })
  const rows = await withReadonlySession<Array<Record<string, unknown>>>(
    dsn,
    async (db) => {
      const res = await db.select(explainSql, [])
      return Array.isArray(res) ? (res as Array<Record<string, unknown>>) : []
    },
    { cacheKey: opts.userConnId },
  )
  if (format === 'json') {
    return { previewInline, rows }
  }
  return { previewInline, text: rowsToPlanText(rows) }
}

export async function fetchEnumOptions(opts: {
  userConnId: string
  sql: string
  variables?: SavedQueryVariableDef[]
  values?: Record<string, unknown>
}): Promise<EnumOptionsResult> {
  if (!isReadOnlySelect(opts.sql)) {
    throw new QueryError('仅支持只读 SQL', { code: 'read_only_required' })
  }
  let compiled
  try {
    compiled = compileSql(opts.sql, opts.variables ?? [], opts.values ?? {})
  } catch (e: any) {
    throw new QueryError(String(e?.message || e), { code: 'compile_failed' })
  }
  const dsn = await getDsnForConn(opts.userConnId)
  const rows = await withReadonlySession<Array<Record<string, unknown>>>(
    dsn,
    async (db) => {
      const rows = await db.select(stripTrailingSemicolons(compiled.text), compiled.values)
      return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []
    },
    { cacheKey: opts.userConnId },
  )
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
  const baseForEmbed = stripTrailingSemicolons(baseCompiled.text)
  if (!baseForEmbed) {
    throw new QueryError('基础 SQL 不能为空', { code: 'base_sql_empty' })
  }
  const finalSqlRaw = `with rdv_base as ( ${shiftParamPlaceholders(baseForEmbed, calcCompiled.values.length)} ) ${calcCompiled.text}`
  const finalSql = stripTrailingSemicolons(finalSqlRaw)
  const finalParams = [...calcCompiled.values, ...baseCompiled.values]
  const dsn = await getDsnForConn(opts.userConnId)
  let connectMs: number | undefined
  const { rows, queryMs } = await withReadonlySession<{
    rows: Array<Record<string, unknown>>
    queryMs: number
  }>(
    dsn,
    async (db) => {
      const queryStart = now()
      const rawRows = await db.select(finalSql, finalParams)
      const dataRows = Array.isArray(rawRows)
        ? (rawRows as Array<Record<string, unknown>>)
        : []
      return {
        rows: dataRows,
        queryMs: Math.round(now() - queryStart),
      }
    },
    {
      onConnect: (ms) => {
        connectMs = ms
      },
      cacheKey: opts.userConnId,
    },
  )
  return {
    sql: finalSql,
    params: finalParams,
    rows,
    columns: Object.keys(rows[0] ?? {}),
    rowCount: rows.length,
    timing: { queryMs, connectMs },
  }
}

export async function listSavedSqlSummaries(): Promise<SavedSqlSummary[]> {
  return listSavedSql()
}
