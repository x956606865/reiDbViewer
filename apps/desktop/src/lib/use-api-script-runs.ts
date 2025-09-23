import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listRecentScriptRuns,
  type QueryApiScriptRunRecord,
} from '../services/queryApiScripts'
import {
  applyPendingEventsToRuns,
  mergeRunEvent,
  normalizeRunStatus,
  type ApiScriptRunEventPayload,
} from './api-script-run-utils'

const EVENT_NAME = 'rdv://api-script/run-updated'
const DEFAULT_LIMIT = 30
const TERMINAL_STATUS_SET = new Set(['succeeded', 'completed_with_errors', 'failed', 'cancelled'])

const describeError = (err: unknown): string => {
  if (!err) return '加载失败'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message || '加载失败'
  const code = (err as any)?.code
  if (typeof code === 'string') return code
  return '加载失败'
}

export type UseApiScriptRunsResult = {
  runs: QueryApiScriptRunRecord[]
  loading: boolean
  error: string | null
  activeRun: QueryApiScriptRunRecord | null
  latestRun: QueryApiScriptRunRecord | null
  pendingEventCount: number
  refresh: () => Promise<void>
}

export function useApiScriptRuns(
  queryId: string | null | undefined,
  options?: { limit?: number; scriptId?: string | null },
): UseApiScriptRunsResult {
  const mountedRef = useRef(true)
  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  const limit = options?.limit ?? DEFAULT_LIMIT

  const [runs, setRuns] = useState<QueryApiScriptRunRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingEvents, setPendingEvents] = useState<Record<string, ApiScriptRunEventPayload>>({})

  const pendingEventsRef = useRef(pendingEvents)
  useEffect(() => {
    pendingEventsRef.current = pendingEvents
  }, [pendingEvents])

  const queryIdRef = useRef<string | null | undefined>(queryId)
  useEffect(() => {
    queryIdRef.current = queryId
  }, [queryId])

  const scriptIdRef = useRef<string | null | undefined>(options?.scriptId)
  useEffect(() => {
    scriptIdRef.current = options?.scriptId
  }, [options?.scriptId])

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return
    if (!queryId) {
      setRuns([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await listRecentScriptRuns({ queryId, limit })
      if (!mountedRef.current) return
      const { runs: mergedRuns, resolved } = applyPendingEventsToRuns(
        list,
        pendingEventsRef.current,
        Date.now(),
      )
      if (resolved.length > 0) {
        setPendingEvents((prev) => {
          const next = { ...prev }
          for (const id of resolved) delete next[id]
          return next
        })
      }
      setRuns(mergedRuns)
    } catch (err) {
      if (!mountedRef.current) return
      setError(describeError(err))
    } finally {
      if (!mountedRef.current) return
      setLoading(false)
    }
  }, [limit, queryId])

  const refreshRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    setRuns([])
    setPendingEvents({})
    setError(null)
    if (!queryId) {
      setLoading(false)
      return
    }
    void refresh()
  }, [queryId, refresh])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let unlisten: UnlistenFn | undefined
    let disposed = false

    listen<ApiScriptRunEventPayload>(EVENT_NAME, (event) => {
      const payload = event.payload
      if (!payload || !payload.run_id) return
      const now = Date.now()
      const normalizedStatus = normalizeRunStatus(payload.status, 'pending')
      let matched = false
      setRuns((prev) => {
        const idx = prev.findIndex((run) => run.id === payload.run_id)
        if (idx === -1) return prev
        matched = true
        const next = [...prev]
        next[idx] = mergeRunEvent(next[idx]!, payload, now)
        return next
      })
      if (matched) {
        setPendingEvents((prev) => {
          if (!prev[payload.run_id]) return prev
          const next = { ...prev }
          delete next[payload.run_id]
          return next
        })
        if (TERMINAL_STATUS_SET.has(normalizedStatus)) {
          void refreshRef.current()
        }
        return
      }
      const currentQuery = queryIdRef.current
      if (!currentQuery) return
      setPendingEvents((prev) => {
        if (prev[payload.run_id]) return prev
        return { ...prev, [payload.run_id]: payload }
      })

      setRuns((prev) => {
        if (prev.some((run) => run.id === payload.run_id)) return prev
        const stub: QueryApiScriptRunRecord = {
          id: payload.run_id,
          scriptId: scriptIdRef.current ?? '',
          queryId: currentQuery,
          status: normalizeRunStatus(payload.status, 'pending'),
          scriptSnapshot: {},
          progressSnapshot: {},
          errorMessage: payload.message ?? null,
          outputDir: null,
          manifestPath: null,
          zipPath: null,
          totalBatches: null,
          processedBatches: null,
          successRows: null,
          errorRows: null,
          startedAt: null,
          finishedAt: null,
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
        }
        const merged = mergeRunEvent(stub, payload, now)
        return [merged, ...prev]
      })
      void refreshRef.current()
    })
      .then((fn) => {
        if (disposed) {
          fn()
        } else {
          unlisten = fn
        }
      })
      .catch((err) => {
        console.warn('无法订阅 API 脚本运行事件', err)
      })

    return () => {
      disposed = true
      if (unlisten) {
        void unlisten()
      }
    }
  }, [])

  const activeRun = useMemo(() => {
    for (const run of runs) {
      if (run.status === 'running' || run.status === 'pending') {
        return run
      }
    }
    return null
  }, [runs])

  const latestRun = useMemo(() => (runs.length > 0 ? runs[0] ?? null : null), [runs])

  const pendingEventCount = useMemo(
    () => Object.keys(pendingEvents).length,
    [pendingEvents],
  )

  return {
    runs,
    loading,
    error,
    activeRun,
    latestRun,
    pendingEventCount,
    refresh,
  }
}
