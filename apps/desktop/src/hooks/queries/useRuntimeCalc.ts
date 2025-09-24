import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CalcItemDef } from '@rei-db-view/types/appdb'
import { normalizeCalcItem } from '@/lib/calc-item-utils'
import type { CalcResultState } from '@/components/queries/types'
import { computeCalcSql, QueryError } from '../../services/pgExec'

export type TotalsController = {
  setTotalRows: (value: number | null) => void
  setTotalPages: (value: number | null) => void
  setCountLoaded: (value: boolean) => void
}

export type UseRuntimeCalcArgs = {
  mode: 'run' | 'edit' | 'temp'
  calcItems: CalcItemDef[]
  pgEnabled: boolean
  rows: Array<Record<string, unknown>>
  pgSize: number
  runValues: Record<string, any>
  currentId: string | null
  userConnId: string | null
  getNow: () => number
  pagination: TotalsController
  computeCalc?: typeof computeCalcSql
}

export type RunCalcOptions = {
  source?: 'auto' | 'manual'
  rowsOverride?: Array<Record<string, unknown>>
  pageSizeOverride?: number
}

type CalcExecutionOutcome = {
  nextState: CalcResultState
  totalsUpdate?: {
    totalRows: number | null
    totalPages: number | null
    countLoaded: boolean
  }
}

const TOTAL_COUNT_ITEM_NAME = '__total_count__'

const TOTAL_COUNT_TEMPLATE = normalizeCalcItem({
  name: TOTAL_COUNT_ITEM_NAME,
  type: 'sql',
  code: 'select count(*)::bigint as total from ({{_sql}}) t',
  runMode: 'manual',
  kind: 'single',
})

export const updateTotals = (
  controller: TotalsController,
  totals: {
    totalRows: number | null
    totalPages: number | null
    countLoaded?: boolean
  },
) => {
  controller.setTotalRows(totals.totalRows)
  controller.setTotalPages(totals.totalPages)
  const nextCountLoaded =
    totals.countLoaded != null ? totals.countLoaded : totals.totalRows != null
  controller.setCountLoaded(nextCountLoaded)
}

const createRuntimeCalcItems = (
  mode: 'run' | 'edit' | 'temp',
  pgEnabled: boolean,
  calcItems: CalcItemDef[],
): CalcItemDef[] => {
  if (mode !== 'run') return []
  const normalized = calcItems.map((item) => normalizeCalcItem(item))
  if (!pgEnabled) return normalized
  return [{ ...TOTAL_COUNT_TEMPLATE }, ...normalized]
}

type ExecuteRuntimeCalcArgs = {
  item: CalcItemDef
  currentId: string | null
  userConnId: string | null
  runValues: Record<string, any>
  rows: Array<Record<string, unknown>>
  pageSize: number
  getNow: () => number
  previousState?: CalcResultState
  computeCalc: typeof computeCalcSql
}

const executeRuntimeCalc = async (
  args: ExecuteRuntimeCalcArgs,
): Promise<CalcExecutionOutcome> => {
  const {
    item,
    currentId,
    userConnId,
    runValues,
    rows,
    pageSize,
    getNow,
    previousState,
    computeCalc,
  } = args
  const start = getNow()
  let connectMs: number | undefined
  let queryMs: number | undefined

  try {
    if (item.type === 'sql') {
      if (!currentId) {
        throw new Error('请先保存/选择查询')
      }
      if (!userConnId) {
        throw new Error('未设置当前连接')
      }
      const res = await computeCalc({
        savedId: currentId,
        values: runValues,
        userConnId,
        calcSql: item.code,
      })
      const rowsRes = Array.isArray(res.rows) ? res.rows : []
      connectMs = res.timing?.connectMs ?? undefined
      queryMs = res.timing?.queryMs ?? undefined
      const totalMs = Math.round(getNow() - start)
      const variant = (item.kind ?? 'single') as 'single' | 'group'
      if (item.name === TOTAL_COUNT_ITEM_NAME) {
        const firstRow = rowsRes[0]
        let value: number | null = null
        if (firstRow) {
          const bestGuess =
            (firstRow as any).total ??
            (firstRow as any).count ??
            Object.values(firstRow)[0]
          const asNumber =
            typeof bestGuess === 'string'
              ? Number(bestGuess)
              : typeof bestGuess === 'number'
              ? bestGuess
              : null
          value = Number.isFinite(asNumber as number) ? (asNumber as number) : null
        }
        if (value == null) {
          throw new Error('返回格式不符合预期，应包含 total/count')
        }
        const normalizedPageSize = Math.max(1, Number.isFinite(pageSize) ? pageSize : 1)
        const totalPages = value != null ? Math.max(1, Math.ceil(value / normalizedPageSize)) : null
        return {
          nextState: {
            value,
            loading: false,
            timing: {
              totalMs,
              connectMs,
              queryMs,
            },
          },
          totalsUpdate: {
            totalRows: value,
            totalPages,
            countLoaded: true,
          },
        }
      }
      if (variant === 'group') {
        const columns = res.columns?.length ? res.columns : Object.keys(rowsRes[0] || {})
        if (columns.length < 2) {
          throw new Error('计算数据组 SQL 需要至少两列（name, value）')
        }
        const [nameCol, valueCol] = columns
        const groupRows = rowsRes.map((row) => {
          const rawName = (row as any)[nameCol as any]
          if (rawName === undefined || rawName === null) {
            throw new Error('name 列不能为空')
          }
          return {
            name: String(rawName),
            value: (row as any)[valueCol as any],
          }
        })
        return {
          nextState: {
            value: groupRows,
            groupRows,
            loading: false,
            timing: {
              totalMs,
              connectMs,
              queryMs,
            },
          },
        }
      }
      let value: any = null
      if (rowsRes.length === 0) {
        value = null
      } else if (rowsRes.length === 1) {
        const columns = res.columns?.length ? res.columns : Object.keys(rowsRes[0] || {})
        value = columns.length === 1 ? (rowsRes[0] as any)[columns[0] as any] : rowsRes[0]
      } else {
        value = rowsRes
      }
      return {
        nextState: {
          value,
          loading: false,
          groupRows: undefined,
          timing: {
            totalMs,
            connectMs,
            queryMs,
          },
        },
      }
    }

    if (item.type === 'js') {
      const helpers = {
        fmtDate: (v: any) => (v ? new Date(v).toISOString() : ''),
        json: (v: any) => JSON.stringify(v),
        sumBy: (arr: any[], sel: (r: any) => number) =>
          arr.reduce((sum, row) => sum + (Number(sel(row)) || 0), 0),
        avgBy: (arr: any[], sel: (r: any) => number) => {
          const values = arr
            .map(sel)
            .map(Number)
            .filter((n) => Number.isFinite(n))
          return values.length
            ? values.reduce((sum, n) => sum + n, 0) / values.length
            : 0
        },
      }
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        'vars',
        'rows',
        'helpers',
        `"use strict"; return ( ${item.code} )(vars, rows, helpers)`,
      ) as any
      const value = fn(runValues, rows, helpers)
      const totalMs = Math.round(getNow() - start)
      return {
        nextState: {
          value,
          loading: false,
          groupRows: undefined,
          timing: {
            totalMs,
          },
        },
      }
    }

    throw new Error(`不支持的计算类型：${item.type}`)
  } catch (err: any) {
    const totalMs = Math.round(getNow() - start)
    const message = err instanceof QueryError ? err.message : String(err?.message || err)
    return {
      nextState: {
        value: previousState?.value,
        loading: false,
        error: message,
        groupRows: undefined,
        timing: {
          totalMs,
          connectMs,
          queryMs,
        },
      },
    }
  }
}

export const useRuntimeCalc = ({
  mode,
  calcItems,
  pgEnabled,
  rows,
  pgSize,
  runValues,
  currentId,
  userConnId,
  getNow,
  pagination,
  computeCalc = computeCalcSql,
}: UseRuntimeCalcArgs) => {
  const [calcResults, setCalcResults] = useState<Record<string, CalcResultState>>({})
  const calcResultsRef = useRef<Record<string, CalcResultState>>({})
  const runtimeCalcItems = useMemo(
    () => createRuntimeCalcItems(mode, pgEnabled, calcItems),
    [mode, pgEnabled, calcItems],
  )
  const runtimeCalcItemsRef = useRef<CalcItemDef[]>(runtimeCalcItems)
  const calcAutoTriggeredRef = useRef<Record<string, boolean>>({})
  const lastExecSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    runtimeCalcItemsRef.current = runtimeCalcItems
  }, [runtimeCalcItems])

  useEffect(() => {
    calcAutoTriggeredRef.current = {}
  }, [runtimeCalcItems])

  useEffect(() => {
    calcAutoTriggeredRef.current = {}
    lastExecSignatureRef.current = null
  }, [currentId])

  const commitCalcResults = useCallback((updater: (prev: Record<string, CalcResultState>) => Record<string, CalcResultState>) => {
    setCalcResults((prev) => {
      const next = updater(prev)
      calcResultsRef.current = next
      return next
    })
  }, [])

  const runCalcItem = useCallback(
    async (item: CalcItemDef, opts?: RunCalcOptions) => {
      if (mode !== 'run') return
      const key = item.name
      const variant = (item.kind ?? 'single') as 'single' | 'group'
      const effectiveRows = opts?.rowsOverride ?? rows
      const pageSizeForCount = opts?.pageSizeOverride ?? pgSize
      const previous = calcResultsRef.current[key]

      commitCalcResults((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          loading: true,
          error: undefined,
          groupRows: variant === 'group' ? undefined : prev[key]?.groupRows,
          timing: undefined,
        },
      }))

      const outcome = await executeRuntimeCalc({
        item,
        currentId,
        userConnId,
        runValues,
        rows: effectiveRows,
        pageSize: pageSizeForCount,
        getNow,
        previousState: previous,
        computeCalc,
      })

      commitCalcResults((prev) => ({
        ...prev,
        [key]: outcome.nextState,
      }))

      if (outcome.totalsUpdate) {
        updateTotals(pagination, outcome.totalsUpdate)
      }
    },
    [mode, rows, pgSize, currentId, userConnId, runValues, getNow, computeCalc, commitCalcResults, pagination],
  )

  const resetCalcResults = useCallback(() => {
    calcResultsRef.current = {}
    setCalcResults({})
  }, [])

  const resetRuntimeFlags = useCallback(() => {
    calcAutoTriggeredRef.current = {}
    lastExecSignatureRef.current = null
  }, [])

  return {
    calcResults,
    runtimeCalcItems,
    runtimeCalcItemsRef,
    calcAutoTriggeredRef,
    lastExecSignatureRef,
    runCalcItem,
    resetCalcResults,
    resetRuntimeFlags,
  }
}

export type UseRuntimeCalcReturn = ReturnType<typeof useRuntimeCalc>

export const __test__ = {
  TOTAL_COUNT_ITEM_NAME,
  TOTAL_COUNT_TEMPLATE,
  updateTotals,
  createRuntimeCalcItems,
  executeRuntimeCalc,
}
