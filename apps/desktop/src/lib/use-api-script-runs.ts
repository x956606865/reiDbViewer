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
  options?: { limit?: number; scriptId?: string | null; includeAllQueries?: boolean },
): UseApiScriptRunsResult {
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const limit = options?.limit ?? DEFAULT_LIMIT
  const includeAll = options?.includeAllQueries === true
  const normalizedScriptId = useMemo(() => {
    const value = options?.scriptId
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }, [options?.scriptId])
  const [runs, setRuns] = useState<QueryApiScriptRunRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingEvents, setPendingEvents] = useState<
    Record<string, { payload: ApiScriptRunEventPayload; receivedAt: number }>
  >({})

  const pendingEventsRef = useRef(pendingEvents)
  useEffect(() => {
    pendingEventsRef.current = pendingEvents
  }, [pendingEvents])

  const queryIdRef = useRef<string | null | undefined>(queryId)
  useEffect(() => {
    queryIdRef.current = queryId
    if (includeAll) {
      void refreshRef.current()
      return
    }
    if (queryId) {
      void refreshRef.current()
    }
  }, [includeAll, queryId])

  const scriptIdRef = useRef<string | null>(normalizedScriptId)
  useEffect(() => {
    scriptIdRef.current = normalizedScriptId
    if (normalizedScriptId) {
      void refreshRef.current()
    }
  }, [normalizedScriptId])

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return
    const currentQueryId = queryIdRef.current
    const currentScriptId = scriptIdRef.current
    if (!includeAll && !currentQueryId) {
      setRuns([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const fetchOpts: { limit: number; scriptId?: string; queryId?: string } = { limit }
      if (currentScriptId) {
        fetchOpts.scriptId = currentScriptId
      }
      if (!includeAll && currentQueryId) {
        fetchOpts.queryId = currentQueryId
      }
      const list = await listRecentScriptRuns(fetchOpts)
      if (!mountedRef.current) return
      const pendingPayloads = Object.fromEntries(
        Object.entries(pendingEventsRef.current).map(([id, entry]) => [id, entry.payload]),
      )
      const now = Date.now()
      const { runs: mergedRuns, resolved } = applyPendingEventsToRuns(
        list,
        pendingPayloads,
        now,
      )
      if (resolved.length > 0) {
        setPendingEvents((prev) => {
          const next = { ...prev }
          for (const id of resolved) delete next[id]
          return next
        })
      }
      setRuns(mergedRuns)
      if (includeAll && !queryId && mergedRuns.length === 0) {
        setPendingEvents(() => ({}))
      }
    } catch (err) {
      if (!mountedRef.current) return
      setError(describeError(err))
      console.error('useApiScriptRuns.refresh error', err)
    } finally {
      if (!mountedRef.current) return
      setLoading(false)
    }
  }, [includeAll, limit])

  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    setRuns([])
    setPendingEvents({})
    setError(null)
    if (!includeAll && !queryId) {
      setLoading(false)
      return
    }
  }, [includeAll, queryId, normalizedScriptId])

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
      if (!includeAll && !currentQuery) return
      setPendingEvents((prev) => {
        if (prev[payload.run_id]) return prev
        return {
          ...prev,
          [payload.run_id]: { payload, receivedAt: now },
        }
      })

      setRuns((prev) => {
        if (prev.some((run) => run.id === payload.run_id)) return prev
        const stub: QueryApiScriptRunRecord = {
          id: payload.run_id,
          scriptId: scriptIdRef.current ?? '',
          queryId: includeAll ? '' : currentQuery ?? '',
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

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (Object.keys(pendingEvents).length === 0) return undefined
    const timer = window.setTimeout(() => {
      const now = Date.now()
      setPendingEvents((prev) => {
        const entries = Object.entries(prev)
        if (entries.length === 0) return prev
        const filtered = entries.filter(([, value]) => now - value.receivedAt < 5000)
        if (filtered.length === entries.length) return prev
        return Object.fromEntries(filtered)
      })
    }, 5200)
    return () => {
      window.clearTimeout(timer)
    }
  }, [pendingEvents])

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
