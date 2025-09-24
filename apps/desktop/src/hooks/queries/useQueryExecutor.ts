import { useCallback } from 'react'
import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from 'react'
import type { CalcItemDef } from '@rei-db-view/types/appdb'
import type { QueryTimingState } from '../../components/queries/types'
import {
  QueryError,
  previewTempSql,
  previewSavedSql,
  executeTempSql,
  executeSavedSql,
  explainTempSql,
  explainSavedSql,
  type ExecuteResult,
} from '../../services/pgExec'
import { updateTotals } from './useRuntimeCalc'

export type { QueryTimingState } from '../../components/queries/types'

export type ExecuteOverride = {
  page?: number
  pageSize?: number
  forceCount?: boolean
  countOnly?: boolean
}

type PaginationState = {
  enabled: boolean
  page: number
  pageSize: number
  countLoaded: boolean
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  setTotalRows: (value: number | null) => void
  setTotalPages: (value: number | null) => void
  setCountLoaded: (value: boolean) => void
}

type ResultState = {
  setPreviewSQL: Dispatch<SetStateAction<string>>
  setRows: Dispatch<SetStateAction<Array<Record<string, unknown>>>>
  setGridCols: Dispatch<SetStateAction<string[]>>
  setTextResult: Dispatch<SetStateAction<string | null>>
  setIsPreviewing: Dispatch<SetStateAction<boolean>>
}

type StatusState = {
  setError: Dispatch<SetStateAction<string | null>>
  setInfo: Dispatch<SetStateAction<string | null>>
  setIsExecuting: Dispatch<SetStateAction<boolean>>
  setQueryTiming: Dispatch<SetStateAction<QueryTimingState | null>>
  setLastResultAt: Dispatch<SetStateAction<number | null>>
}

type RuntimeState = {
  calcAutoTriggeredRef: MutableRefObject<Record<string, boolean>>
  lastExecSignatureRef: MutableRefObject<string | null>
  runtimeCalcItemsRef: MutableRefObject<CalcItemDef[]>
  runCalcItem: (
    ci: CalcItemDef,
    opts?: {
      source?: 'auto' | 'manual'
      rowsOverride?: Array<Record<string, unknown>>
      pageSizeOverride?: number
    },
  ) => Promise<void>
}

type QueryExecutorRefs = {
  lastRunResultRef: MutableRefObject<ExecuteResult | null>
}

type UseQueryExecutorArgs = {
  mode: 'run' | 'edit' | 'temp'
  currentId: string | null
  userConnId: string | null
  tempSql: string
  runValues: Record<string, any>
  pagination: PaginationState
  result: ResultState
  status: StatusState
  refs: QueryExecutorRefs
  runtime: RuntimeState
  getNow: () => number
  confirmDanger: (message: string) => Promise<boolean>
  explainFormat: 'text' | 'json'
  explainAnalyze: boolean
  onPreviewApplied?: () => void
}

type ApplyExecuteOptions = {
  override?: ExecuteOverride
  target: 'temp' | 'saved'
}

const formatVarsMissingMessage = (err: QueryError): string => {
  const missing = Array.isArray(err.missing) ? err.missing.filter(Boolean) : []
  if (missing.length === 0) return err.message || '变量缺失'
  return `${err.message || '变量缺失'}：${missing.join(', ')}`
}

export const handleVarsMissing = (
  err: QueryError,
  onError: (msg: string) => void,
): boolean => {
  if (err.code !== 'vars_missing') return false
  onError(formatVarsMissingMessage(err))
  return true
}

const formatUnknownError = (err: unknown): string => {
  if (err instanceof QueryError) return err.message || '执行失败'
  if (err && typeof err === 'object') {
    const maybeMessage = (err as any).message
    const maybeStatus = (err as any).status
    if (typeof maybeMessage === 'string') {
      if (typeof maybeStatus === 'number') {
        return `${maybeMessage} (status ${maybeStatus})`
      }
      return maybeMessage
    }
  }
  return String(err ?? '执行失败')
}

const buildPaginationInput = (
  args: UseQueryExecutorArgs,
  override?: ExecuteOverride,
) => {
  const { pagination } = args
  return {
    enabled: pagination.enabled,
    page: override?.page ?? pagination.page,
    pageSize: override?.pageSize ?? pagination.pageSize,
    withCount:
      override?.forceCount ||
      override?.countOnly ||
      (!pagination.countLoaded && pagination.enabled) ||
      false,
    countOnly: Boolean(override?.countOnly),
  }
}

const updateCountResult = (
  ctx: UseQueryExecutorArgs,
  res: ExecuteResult,
  elapsedMs: number,
) => {
  const { pagination, status } = ctx
  const hasTotals = res.totalRows != null
  if (hasTotals) {
    updateTotals(pagination, {
      totalRows: res.totalRows ?? null,
      totalPages: res.totalPages ?? null,
      countLoaded: true,
    })
  } else if (res.countSkipped) {
    updateTotals(pagination, {
      totalRows: null,
      totalPages: null,
      countLoaded: false,
    })
  }
  status.setQueryTiming((prev) => ({
    totalMs: elapsedMs,
    connectMs: res.timing?.connectMs ?? null,
    queryMs: prev?.queryMs ?? null,
    countMs: res.timing?.countMs ?? null,
  }))
  return hasTotals
}

const applyExecuteResult = async (
  ctx: UseQueryExecutorArgs,
  res: ExecuteResult,
  elapsedMs: number,
  options: ApplyExecuteOptions,
) => {
  const { pagination, result, status, refs, runtime, runValues, currentId } = ctx
  result.setPreviewSQL(res.sql)
  result.setRows(res.rows)
  result.setGridCols(res.columns)
  result.setTextResult(null)
  status.setQueryTiming({
    totalMs: elapsedMs,
    connectMs: res.timing?.connectMs ?? null,
    queryMs: res.timing?.queryMs ?? null,
    countMs: res.timing?.countMs ?? null,
  })
  refs.lastRunResultRef.current = res
  status.setLastResultAt(Date.now())
  if (res.page) pagination.setPage(res.page)
  if (res.pageSize) pagination.setPageSize(res.pageSize)
  if (res.totalRows != null) {
    updateTotals(pagination, {
      totalRows: res.totalRows ?? null,
      totalPages: res.totalPages ?? null,
      countLoaded: true,
    })
  } else if (res.countSkipped) {
    updateTotals(pagination, {
      totalRows: null,
      totalPages: null,
      countLoaded: false,
    })
  }
  if (options.target === 'saved') {
    const isPagination = typeof options.override?.page === 'number'
    const shouldResetSignature = !isPagination && options.override?.pageSize === undefined
    if (shouldResetSignature) {
      const signature = JSON.stringify({ id: currentId ?? '', values: runValues })
      if (runtime.lastExecSignatureRef.current !== signature) {
        runtime.calcAutoTriggeredRef.current = {}
      }
      runtime.lastExecSignatureRef.current = signature
    }
    const autoItems: CalcItemDef[] = []
    for (const ci of runtime.runtimeCalcItemsRef.current) {
      const runMode = ci.runMode ?? 'manual'
      if (runMode === 'manual') continue
      if (runMode === 'initial') {
        if (isPagination) continue
        if (runtime.calcAutoTriggeredRef.current[ci.name]) continue
        runtime.calcAutoTriggeredRef.current[ci.name] = true
        autoItems.push(ci)
      } else if (runMode === 'always') {
        autoItems.push(ci)
      }
    }
    if (autoItems.length > 0) {
      const pageSizeForAuto = res.pageSize ?? pagination.pageSize
      for (const ci of autoItems) {
        await runtime.runCalcItem(ci, {
          source: 'auto',
          rowsOverride: ci.type === 'js' ? res.rows : undefined,
          pageSizeOverride: pageSizeForAuto,
        })
      }
    }
  }
}

const ensureExecutable = (ctx: UseQueryExecutorArgs, target: 'temp' | 'saved'): string | null => {
  if (!ctx.userConnId) {
    return '未设置当前连接，请先在 Connections 选择。'
  }
  if (target === 'temp') {
    if (!ctx.tempSql.trim()) return '请先输入 SQL。'
    return null
  }
  if (!ctx.currentId) {
    return '请先选择或保存查询后再执行。'
  }
  return null
}

const scrollPreviewIfNeeded = (ctx: UseQueryExecutorArgs) => {
  if (typeof ctx.onPreviewApplied === 'function') {
    try {
      ctx.onPreviewApplied()
    } catch (err) {
      console.warn('preview callback failed', err)
    }
  }
}

export type UseQueryExecutorReturn = {
  preview: (override?: ExecuteOverride) => Promise<void>
  execute: (override?: ExecuteOverride) => Promise<void>
  explain: () => Promise<void>
}

export const useQueryExecutor = (args: UseQueryExecutorArgs): UseQueryExecutorReturn => {
  const preview = useCallback(
    async (override?: ExecuteOverride) => {
      const { mode, currentId, tempSql, userConnId, result, status, pagination } = args
      const target: 'temp' | 'saved' = mode === 'temp' ? 'temp' : 'saved'
      if (target === 'temp') {
        if (!userConnId) {
          status.setError('未设置当前连接，请先在 Connections 选择。')
          return
        }
        if (!tempSql.trim()) {
          status.setError('请先输入 SQL。')
          return
        }
      } else if (!currentId) {
        status.setError('请先选择或保存查询再预览。')
        return
      }
      result.setIsPreviewing(true)
      status.setError(null)
      try {
        const res =
          target === 'temp'
            ? await previewTempSql(tempSql)
            : await previewSavedSql({ savedId: currentId!, values: args.runValues })
        const previewText = res.previewInline || res.previewText
        result.setPreviewSQL(previewText)
        scrollPreviewIfNeeded(args)
        status.setInfo('已生成 SQL 预览')
        if (override?.pageSize) pagination.setPageSize(override.pageSize)
        if (override?.page) pagination.setPage(override.page)
      } catch (err) {
        if (err instanceof QueryError && handleVarsMissing(err, status.setError)) {
          return
        }
        status.setError(formatUnknownError(err))
      } finally {
        result.setIsPreviewing(false)
      }
    },
    [args],
  )

  const execute = useCallback(
    async (override?: ExecuteOverride) => {
      const target: 'temp' | 'saved' = args.mode === 'temp' ? 'temp' : 'saved'
      if (!override?.countOnly) {
        args.refs.lastRunResultRef.current = null
        args.status.setLastResultAt(null)
      }
      const validationMessage = ensureExecutable(args, target)
      if (validationMessage) {
        args.status.setError(validationMessage)
        return
      }
      args.status.setIsExecuting(true)
      args.status.setError(null)
      args.status.setInfo(null)
      args.status.setQueryTiming(null)
      const start = args.getNow()
      const paginationInput = buildPaginationInput(args, override)
      const baseExecute = async (allowWrite: boolean) =>
        target === 'temp'
          ? executeTempSql({
              sql: args.tempSql,
              userConnId: args.userConnId!,
              pagination: paginationInput,
              allowWrite,
            })
          : executeSavedSql({
              savedId: args.currentId!,
              values: args.runValues,
              userConnId: args.userConnId!,
              pagination: paginationInput,
              allowWrite,
            })
      try {
        const res = await baseExecute(false)
        const elapsedMs = Math.round(args.getNow() - start)
        if (paginationInput.countOnly) {
          const totalsUpdated = updateCountResult(args, res, elapsedMs)
          if (totalsUpdated) {
            args.status.setInfo('已刷新计数')
          }
          return
        }
        await applyExecuteResult(args, res, elapsedMs, { override, target })
      } catch (err) {
        if (err instanceof QueryError) {
          if (handleVarsMissing(err, args.status.setError)) return
          if (err.code === 'write_requires_confirmation') {
            args.result.setPreviewSQL(err.previewInline || '')
            const ok = await args.confirmDanger('该 SQL 可能修改数据，是否继续执行？')
            if (!ok) {
              args.status.setError('已取消执行。')
              args.status.setQueryTiming(null)
              return
            }
            const retryStart = args.getNow()
            try {
              const confirmed = await baseExecute(true)
              const elapsedMs = Math.round(args.getNow() - retryStart)
              await applyExecuteResult(args, confirmed, elapsedMs, {
                override,
                target,
              })
            } catch (retryErr) {
              if (
                retryErr instanceof QueryError &&
                handleVarsMissing(retryErr, args.status.setError)
              )
                return
              args.status.setError(formatUnknownError(retryErr))
              args.status.setQueryTiming(null)
            }
            return
          }
        }
        args.status.setError(formatUnknownError(err))
        args.status.setQueryTiming(null)
      } finally {
        args.status.setIsExecuting(false)
      }
    },
    [args],
  )

  const explain = useCallback(async () => {
    const { mode, currentId, userConnId, tempSql } = args
    const isTemp = mode === 'temp'
    if (isTemp) {
      if (!userConnId) {
        args.status.setError('未设置当前连接，请先在 Connections 选择。')
        return
      }
      if (!tempSql.trim()) {
        args.status.setError('请先输入 SQL。')
        return
      }
    } else {
      if (!currentId) {
        args.status.setError('请先选择查询再 Explain。')
        return
      }
      if (!userConnId) {
        args.status.setError('未设置当前连接，请先在 Connections 选择。')
        return
      }
    }
    args.status.setIsExecuting(true)
    args.status.setError(null)
    args.status.setQueryTiming(null)
    try {
      const res = isTemp
        ? await explainTempSql({
            sql: args.tempSql,
            userConnId: args.userConnId!,
            format: args.explainFormat,
            analyze: args.explainAnalyze,
          })
        : await explainSavedSql({
            savedId: args.currentId!,
            values: args.runValues,
            userConnId: args.userConnId!,
            format: args.explainFormat,
            analyze: args.explainAnalyze,
          })
      args.result.setPreviewSQL(res.previewInline)
      if (args.explainFormat === 'json') {
        args.result.setTextResult(JSON.stringify(res.rows ?? [], null, 2))
        args.result.setRows([])
        args.result.setGridCols([])
      } else {
        args.result.setTextResult(res.text ?? '')
        args.result.setRows([])
        args.result.setGridCols([])
      }
      args.status.setInfo('Explain 完成')
    } catch (err) {
      if (err instanceof QueryError && handleVarsMissing(err, args.status.setError)) return
      args.status.setError(formatUnknownError(err))
    } finally {
      args.status.setIsExecuting(false)
    }
  }, [args])

  return { preview, execute, explain }
}

export const __test__ = {
  formatUnknownError,
  buildPaginationInput,
  updateCountResult,
  applyExecuteResult,
}
