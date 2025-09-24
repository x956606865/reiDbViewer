import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../../services/pgExec', () => {
  class MockQueryError extends Error {
    code: string
    missing?: string[]
    previewInline?: string
    constructor(message: string, detail: { code: string; missing?: string[]; previewInline?: string }) {
      super(message)
      this.code = detail.code
      if (detail.missing) this.missing = detail.missing
      if (detail.previewInline) this.previewInline = detail.previewInline
    }
  }
  const createResult = () => ({
    sql: '',
    params: [],
    rows: [],
    columns: [],
    rowCount: 0,
  })
  const asyncResult = async () => createResult()
  return {
    QueryError: MockQueryError,
    previewTempSql: vi.fn(asyncResult),
    previewSavedSql: vi.fn(asyncResult),
    executeTempSql: vi.fn(asyncResult),
    executeSavedSql: vi.fn(asyncResult),
    explainTempSql: vi.fn(asyncResult),
    explainSavedSql: vi.fn(asyncResult),
    DEFAULT_PAGE_SIZE: 10,
  }
})

import type { CalcItemDef } from '@rei-db-view/types/appdb'
import {
  useQueryExecutor,
  handleVarsMissing,
  type QueryTimingState,
  type ExecuteOverride,
  __test__,
} from './useQueryExecutor'
import { QueryError, type ExecuteResult } from '../../services/pgExec'

const { formatUnknownError, buildPaginationInput, updateCountResult, applyExecuteResult } = __test__

describe('handleVarsMissing', () => {
  it('reports missing variables with names', () => {
    const err = new QueryError('变量缺失', { code: 'vars_missing', missing: ['foo', 'bar'] })
    const spy = vi.fn()
    const handled = handleVarsMissing(err, spy)
    expect(handled).toBe(true)
    expect(spy).toHaveBeenCalledWith('变量缺失：foo, bar')
  })

  it('returns false for unrelated errors', () => {
    const err = new QueryError('SQL 不能为空', { code: 'sql_empty' })
    const spy = vi.fn()
    const handled = handleVarsMissing(err, spy)
    expect(handled).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('formatUnknownError', () => {
  it('prefers QueryError message', () => {
    const err = new QueryError('仅支持只读 SQL', { code: 'read_only_required' })
    expect(formatUnknownError(err)).toBe('仅支持只读 SQL')
  })

  it('includes status code when available', () => {
    const err = { message: 'Feature not initialized', status: 501 }
    expect(formatUnknownError(err)).toBe('Feature not initialized (status 501)')
  })

  it('falls back to string conversion', () => {
    expect(formatUnknownError('boom')).toBe('boom')
  })
})

describe('buildPaginationInput', () => {
  const baseArgs = {
    mode: 'run' as const,
    currentId: 'q1',
    userConnId: 'conn',
    tempSql: 'select 1',
    runValues: {},
    pagination: {
      enabled: true,
      page: 3,
      pageSize: 25,
      countLoaded: false,
      setPage: vi.fn(),
      setPageSize: vi.fn(),
      setTotalRows: vi.fn(),
      setTotalPages: vi.fn(),
      setCountLoaded: vi.fn(),
    },
    result: {} as any,
    status: {} as any,
    refs: { lastRunResultRef: { current: null } },
    runtime: {} as any,
    getNow: () => Date.now(),
    confirmDanger: async () => true,
    explainFormat: 'text' as const,
    explainAnalyze: false,
  }

  it('coerces overrides and derives count flag', () => {
    const input = buildPaginationInput(baseArgs as any, { page: 2, pageSize: 50, forceCount: true })
    expect(input).toEqual({
      enabled: true,
      page: 2,
      pageSize: 50,
      withCount: true,
      countOnly: false,
    })
  })

  it('sets countOnly while preserving defaults', () => {
    const input = buildPaginationInput(baseArgs as any, { countOnly: true })
    expect(input.page).toBe(3)
    expect(input.pageSize).toBe(25)
    expect(input.countOnly).toBe(true)
    expect(input.withCount).toBe(true)
  })
})

describe('updateCountResult', () => {
  it('updates totals and timing', () => {
    const totals: { rows: number | null; pages: number | null } = { rows: null, pages: null }
    let timing: QueryTimingState | null = null
    const args = {
      mode: 'run' as const,
      currentId: 'q',
      userConnId: 'conn',
      tempSql: '',
      runValues: {},
      pagination: {
        enabled: true,
        page: 1,
        pageSize: 10,
        countLoaded: false,
        setPage: () => {},
        setPageSize: () => {},
        setTotalRows: (value: number | null) => {
          totals.rows = value
        },
        setTotalPages: (value: number | null) => {
          totals.pages = value
        },
        setCountLoaded: (value: boolean) => {
          expect(value).toBe(true)
        },
      },
      result: {} as any,
      status: {
        setError: () => {},
        setInfo: () => {},
        setIsExecuting: () => {},
        setQueryTiming: (updater: any) => {
          timing = typeof updater === 'function' ? updater(timing) : updater
        },
        setLastResultAt: () => {},
      },
      refs: { lastRunResultRef: { current: null } },
      runtime: {} as any,
      getNow: () => Date.now(),
      confirmDanger: async () => true,
      explainFormat: 'text' as const,
      explainAnalyze: false,
    }

    const res: ExecuteResult = {
      sql: 'select 1',
      params: [],
      rows: [],
      columns: [],
      rowCount: 0,
      totalRows: 120,
      totalPages: 12,
      timing: { connectMs: 5, countMs: 8 },
    }

    const updated = updateCountResult(args as any, res, 15)

    expect(totals).toEqual({ rows: 120, pages: 12 })
    expect(timing).toEqual({ totalMs: 15, connectMs: 5, queryMs: null, countMs: 8 })
    expect(updated).toBe(true)
  })

  it('resets pagination state when count is skipped', () => {
    let totalRows: number | null = 200
    let totalPages: number | null = 20
    let countLoaded = true
    let timing: QueryTimingState | null = null

    const args = {
      mode: 'run' as const,
      currentId: 'q',
      userConnId: 'conn',
      tempSql: '',
      runValues: {},
      pagination: {
        enabled: true,
        page: 1,
        pageSize: 10,
        countLoaded: true,
        setPage: () => {},
        setPageSize: () => {},
        setTotalRows: (value: number | null) => {
          totalRows = value
        },
        setTotalPages: (value: number | null) => {
          totalPages = value
        },
        setCountLoaded: (value: boolean) => {
          countLoaded = value
        },
      },
      result: {} as any,
      status: {
        setError: () => {},
        setInfo: () => {},
        setIsExecuting: () => {},
        setQueryTiming: (updater: any) => {
          timing = typeof updater === 'function' ? updater(timing) : updater
        },
        setLastResultAt: () => {},
      },
      refs: { lastRunResultRef: { current: null } },
      runtime: {} as any,
      getNow: () => Date.now(),
      confirmDanger: async () => true,
      explainFormat: 'text' as const,
      explainAnalyze: false,
    }

    const res: ExecuteResult = {
      sql: 'select 1',
      params: [],
      rows: [],
      columns: [],
      rowCount: 0,
      countSkipped: true,
      timing: { connectMs: 2, countMs: 4 },
    }

    const updated = updateCountResult(args as any, res, 12)

    expect(totalRows).toBeNull()
    expect(totalPages).toBeNull()
    expect(countLoaded).toBe(false)
    expect(updated).toBe(false)
    expect(timing).toEqual({ totalMs: 12, connectMs: 2, queryMs: null, countMs: 4 })
  })
})

describe('applyExecuteResult', () => {
  let args: any
  let timing: QueryTimingState | null
  let previewSQL: string
  let rows: Array<Record<string, unknown>>
  let gridCols: string[]
  let textResult: string | null
  let totalRows: number | null
  let totalPages: number | null
  let countLoaded: boolean
  const runCalcItem = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    timing = null
    previewSQL = ''
    rows = []
    gridCols = []
    textResult = null
    totalRows = null
    totalPages = null
    countLoaded = false
    runCalcItem.mockClear()

    args = {
      mode: 'run' as const,
      currentId: 'saved-1',
      userConnId: 'conn',
      tempSql: '',
      runValues: { foo: 'bar' },
      pagination: {
        enabled: true,
        page: 1,
        pageSize: 10,
        countLoaded: false,
        setPage: vi.fn((value: number) => {
          args.pagination.page = value
        }),
        setPageSize: vi.fn((value: number) => {
          args.pagination.pageSize = value
        }),
        setTotalRows: vi.fn((value: number | null) => {
          totalRows = value
        }),
        setTotalPages: vi.fn((value: number | null) => {
          totalPages = value
        }),
        setCountLoaded: vi.fn((value: boolean) => {
          countLoaded = value
        }),
      },
      result: {
        setPreviewSQL: vi.fn((value: string) => {
          previewSQL = value
        }),
        setRows: vi.fn((value: Array<Record<string, unknown>>) => {
          rows = value
        }),
        setGridCols: vi.fn((value: string[]) => {
          gridCols = value
        }),
        setTextResult: vi.fn((value: string | null) => {
          textResult = value
        }),
        setIsPreviewing: vi.fn(),
      },
      status: {
        setError: vi.fn(),
        setInfo: vi.fn(),
        setIsExecuting: vi.fn(),
        setQueryTiming: vi.fn((updater: any) => {
          timing = typeof updater === 'function' ? updater(timing) : updater
        }),
        setLastResultAt: vi.fn(),
      },
      refs: {
        lastRunResultRef: { current: null as ExecuteResult | null },
      },
      runtime: {
        calcAutoTriggeredRef: { current: {} as Record<string, boolean> },
        lastExecSignatureRef: { current: null as string | null },
        runtimeCalcItemsRef: {
          current: [
            {
              name: 'autoAlways',
              type: 'sql',
              code: 'select 1',
              runMode: 'always',
              kind: 'single',
            } satisfies CalcItemDef,
            {
              name: 'autoInitial',
              type: 'sql',
              code: 'select 1',
              runMode: 'initial',
              kind: 'single',
            } satisfies CalcItemDef,
          ],
        },
        runCalcItem,
      },
      getNow: () => Date.now(),
      confirmDanger: async () => true,
      explainFormat: 'text' as const,
      explainAnalyze: false,
    }
  })

  it('updates state and triggers auto calc items', async () => {
    const result: ExecuteResult = {
      sql: 'select * from demo',
      params: [],
      rows: [{ id: 1 }],
      columns: ['id'],
      rowCount: 1,
      page: 2,
      pageSize: 20,
      totalRows: 100,
      totalPages: 5,
      timing: { connectMs: 4, queryMs: 12 },
    }

    await applyExecuteResult(args, result, 30, { target: 'saved' })

    expect(previewSQL).toBe('select * from demo')
    expect(rows).toEqual([{ id: 1 }])
    expect(gridCols).toEqual(['id'])
    expect(textResult).toBeNull()
    expect(timing).toEqual({ totalMs: 30, connectMs: 4, queryMs: 12, countMs: null })
    expect(args.pagination.setPage).toHaveBeenCalledWith(2)
    expect(args.pagination.setPageSize).toHaveBeenCalledWith(20)
    expect(totalRows).toBe(100)
    expect(totalPages).toBe(5)
    expect(countLoaded).toBe(true)
    expect(args.refs.lastRunResultRef.current).toEqual(result)
    expect(runCalcItem).toHaveBeenCalledTimes(2)
    expect(args.runtime.calcAutoTriggeredRef.current.autoInitial).toBe(true)
    expect(args.runtime.lastExecSignatureRef.current).toBe(
      JSON.stringify({ id: 'saved-1', values: { foo: 'bar' } }),
    )
  })

  it('skips auto initial when paginating', async () => {
    const result: ExecuteResult = {
      sql: 'select * from demo limit 5',
      params: [],
      rows: [],
      columns: [],
      rowCount: 0,
      timing: {},
    }
    await applyExecuteResult(args, result, 5, { target: 'saved', override: { page: 3 } })
    expect(runCalcItem).toHaveBeenCalledTimes(1)
  })
})

// useQueryExecutor is indirectly exercised via helper tests above. This placeholder ensures the hook symbol is referenced to avoid tree-shaking issues.
void useQueryExecutor
