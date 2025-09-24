import { createElement, useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react'
import { IconAlertTriangle, IconCheck, IconX } from '@tabler/icons-react'
import type { SavedQueryVariableDef } from '@rei-db-view/types/appdb'
import {
  executeApiScript,
  cancelApiScriptRun,
  ensureApiScriptRunZip,
  exportApiScriptRunZip,
  readApiScriptRunLog,
  cleanupApiScriptCache,
  deleteApiScriptRun,
  clearApiScriptRuns,
  type ApiScriptRequestLogEntry,
} from '@/services/apiScriptRunner'
import type { ExecuteResult } from '@/services/pgExec'
import type { QueryApiScriptRunRecord, QueryApiScriptSummary } from '@/services/queryApiScripts'
import type { UseQueryApiScriptsResult } from '@/lib/use-query-api-scripts'
import type { UseApiScriptRunsResult } from '@/lib/use-api-script-runs'
import { getDsnForConn } from '@/lib/localStore'
import { compileSql } from '@/lib/sql-template'
import { saveDialog } from '@/lib/tauri-dialog'
import {
  notifySuccess,
  notifyError,
  notifyInfo,
  notifyWarning,
  confirmDanger,
} from '@/lib/notifications'
import { extractRunScriptInfo } from '@/lib/api-script-run-utils'
import type {
  QueryApiScriptTaskDrawerProps,
  RunnerSectionProps,
  StatusSectionProps,
  HistorySectionProps,
} from '@/components/queries/api-scripts/ScriptTaskDrawer'

const ICON_ERROR = createElement(IconX, { size: 16 })
const ICON_SUCCESS = createElement(IconCheck, { size: 16 })
const ICON_WARNING = createElement(IconAlertTriangle, { size: 16 })

export type UseQueryApiScriptTaskArgs = {
  mode: 'run' | 'edit' | 'temp'
  queryId: string | null
  userConnId: string | null
  sql: string
  vars: SavedQueryVariableDef[]
  runValues: Record<string, any>
  hasFreshResultForScript: boolean
  latestRunSignature: string
  lastResultAt: number | null
  lastRunResultRef: MutableRefObject<ExecuteResult | null>
  scripts: UseQueryApiScriptsResult
  runs: UseApiScriptRunsResult
  isExecuting: boolean
}

type LogViewerState = {
  run: QueryApiScriptRunRecord
  entries: ApiScriptRequestLogEntry[]
  loading: boolean
  error: string | null
} | null

type RunScriptDependencies = {
  mode: 'run' | 'edit' | 'temp'
  queryId: string | null
  selectedScriptId: string | null
  hasFreshResultForScript: boolean
  lastRunResultRef: MutableRefObject<ExecuteResult | null>
  userConnId: string | null
  latestRunSignature: string
  lastResultAt: number | null
  sql: string
  vars: SavedQueryVariableDef[]
  runValues: Record<string, any>
  compileSql: typeof compileSql
  getDsnForConn: typeof getDsnForConn
  executeApiScript: typeof executeApiScript
  refreshHistory: () => Promise<void>
  notifyInfo: typeof notifyInfo
  notifyError: typeof notifyError
  notifySuccess: typeof notifySuccess
  notifyWarning: typeof notifyWarning
  setScriptRunning: (value: boolean) => void
  now: () => number
}

type CancelRunDependencies = {
  getCancelingRunId: () => string | null
  setCancelingRunId: (value: string | null) => void
  cancelApiScriptRun: typeof cancelApiScriptRun
  notifyWarning: typeof notifyWarning
  notifyError: typeof notifyError
}

export function createRunScriptAction(deps: RunScriptDependencies) {
  return async function runScript(): Promise<void> {
    const {
      mode,
      queryId,
      selectedScriptId,
      hasFreshResultForScript,
      lastRunResultRef,
      userConnId,
      latestRunSignature,
      lastResultAt,
      sql,
      vars,
      runValues,
      compileSql: compile,
      getDsnForConn: resolveDsn,
      executeApiScript: execute,
      refreshHistory,
      notifyInfo: info,
      notifyError: errorNotify,
      notifySuccess: successNotify,
      notifyWarning: warningNotify,
      setScriptRunning,
      now,
    } = deps

    if (mode !== 'run') {
      info({
        color: 'gray',
        title: '无法执行',
        message: '请先切换到运行模式再执行脚本。',
        icon: ICON_ERROR,
      })
      return
    }
    if (!queryId) {
      errorNotify({
        color: 'red',
        title: '无法执行',
        message: '请先保存查询后再配置脚本执行。',
        icon: ICON_ERROR,
      })
      return
    }
    if (!selectedScriptId) {
      errorNotify({
        color: 'red',
        title: '未选择脚本',
        message: '请选择要执行的脚本。',
        icon: ICON_ERROR,
      })
      return
    }
    const result = lastRunResultRef.current
    if (!hasFreshResultForScript || !result) {
      warningNotify({
        color: 'orange',
        title: '需要最新结果',
        message: '请先执行查询并确保结果最新，再运行脚本。',
        icon: ICON_WARNING,
      })
      return
    }
    if (!userConnId) {
      errorNotify({
        color: 'red',
        title: '缺少连接',
        message: '请先选择数据库连接。',
        icon: ICON_ERROR,
      })
      return
    }

    setScriptRunning(true)
    try {
      const compiled = compile(sql, vars, runValues)
      const connectionDsn = await resolveDsn(userConnId)
      await execute({
        scriptId: selectedScriptId,
        queryId,
        runSignature: latestRunSignature,
        executedSql: result.sql,
        params: result.params ?? [],
        executedAt: lastResultAt ?? now(),
        userConnId,
        connectionDsn,
        baseSql: compiled.text,
        baseParams: compiled.values,
      })
      await refreshHistory()
      successNotify({
        color: 'teal',
        title: '脚本任务已提交',
        message: '任务将在后台执行，执行结果稍后可在任务历史查看。',
        icon: ICON_SUCCESS,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errorNotify({
        color: 'red',
        title: '执行失败',
        message,
        icon: ICON_ERROR,
      })
    } finally {
      setScriptRunning(false)
    }
  }
}

export function createCancelRunAction(deps: CancelRunDependencies) {
  return async function cancelRun(run: QueryApiScriptRunRecord | null): Promise<void> {
    if (!run) return
    if (run.status !== 'running' && run.status !== 'pending') return
    if (deps.getCancelingRunId()) return

    deps.setCancelingRunId(run.id)
    try {
      await deps.cancelApiScriptRun(run.id)
      deps.notifyWarning({
        color: 'orange',
        title: '正在取消任务',
        message: '已通知后台取消该脚本执行。',
        icon: ICON_WARNING,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      deps.notifyError({
        color: 'red',
        title: '取消失败',
        message,
        icon: ICON_ERROR,
      })
    } finally {
      deps.setCancelingRunId(null)
    }
  }
}

export type UseQueryApiScriptTaskResult = {
  drawerProps: QueryApiScriptTaskDrawerProps | null
  logViewer: LogViewerState
  logViewerInfo: ReturnType<typeof extractRunScriptInfo> | null
  handleCloseLogViewer: () => void
  handleCloseScriptEditor: () => void
}

export function useQueryApiScriptTask({
  mode,
  queryId,
  userConnId,
  sql,
  vars,
  runValues,
  hasFreshResultForScript,
  latestRunSignature,
  lastResultAt,
  lastRunResultRef,
  scripts,
  runs,
  isExecuting,
}: UseQueryApiScriptTaskArgs): UseQueryApiScriptTaskResult {
  const {
    scripts: scriptItems,
    loading: scriptsLoading,
    loadError: scriptLoadError,
    selectedId: selectedScriptId,
    setSelectedId,
    openCreate,
    openEdit,
    openDuplicate,
    deleteById,
    editorOpen: scriptEditorOpen,
    saving: scriptSaving,
    deleting: scriptDeleting,
    submitError: scriptSubmitError,
    setSubmitError: setScriptSubmitError,
    closeEditor,
  } = scripts

  const {
    runs: scriptRunRecords,
    loading: scriptRunLoading,
    error: scriptRunError,
    activeRun: activeScriptRun,
    pendingEventCount: scriptRunPendingEvents,
    refresh: refreshScriptRunsHistory,
  } = runs

  const [scriptRunning, setScriptRunning] = useState(false)
  const [cancelingRunId, setCancelingRunId] = useState<string | null>(null)
  const [downloadingRunId, setDownloadingRunId] = useState<string | null>(null)
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null)
  const [clearingRuns, setClearingRuns] = useState(false)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [logViewer, setLogViewer] = useState<LogViewerState>(null)

  useEffect(() => {
    if (mode !== 'run') return
    if (!queryId) return
    if (!selectedScriptId) return
    void refreshScriptRunsHistory()
  }, [mode, queryId, selectedScriptId, refreshScriptRunsHistory])

  const handleSelectScript = useCallback(
    (id: string | null) => {
      setSelectedId(id)
    },
    [setSelectedId],
  )

  const handleCreateScript = useCallback(() => {
    if (!queryId) {
      notifyWarning({
        color: 'orange',
        title: '请先保存查询',
        message: '保存当前查询后才能创建 API 脚本。',
        icon: ICON_WARNING,
      })
      return
    }
    setScriptSubmitError(null)
    openCreate()
  }, [queryId, openCreate, setScriptSubmitError])

  const handleEditScript = useCallback(
    (id: string) => {
      setScriptSubmitError(null)
      void openEdit(id)
    },
    [openEdit, setScriptSubmitError],
  )

  const handleDuplicateScript = useCallback(
    (id: string) => {
      setScriptSubmitError(null)
      void openDuplicate(id)
    },
    [openDuplicate, setScriptSubmitError],
  )

  const handleDeleteScript = useCallback(
    async (script: QueryApiScriptSummary) => {
      const confirmed = await confirmDanger(`确定删除脚本「${script.name}」吗？`)
      if (!confirmed) return
      const ok = await deleteById(script.id)
      if (ok) {
        notifySuccess({
          color: 'teal',
          title: '删除成功',
          message: `已删除脚本「${script.name}」。`,
          icon: ICON_SUCCESS,
        })
      } else {
        notifyError({
          color: 'red',
          title: '删除失败',
          message: '删除失败，请稍后重试。',
          icon: ICON_ERROR,
        })
      }
    },
    [deleteById],
  )

  const handleCloseScriptEditor = useCallback(() => {
    closeEditor()
    setScriptSubmitError(null)
  }, [closeEditor, setScriptSubmitError])

  const runScriptAction = useMemo(
    () =>
      createRunScriptAction({
        mode,
        queryId,
        selectedScriptId,
        hasFreshResultForScript,
        lastRunResultRef,
        userConnId,
        latestRunSignature,
        lastResultAt,
        sql,
        vars,
        runValues,
        compileSql,
        getDsnForConn,
        executeApiScript,
        refreshHistory: refreshScriptRunsHistory,
        notifyInfo,
        notifyError,
        notifySuccess,
        notifyWarning,
        setScriptRunning,
        now: () => Date.now(),
      }),
    [
      mode,
      queryId,
      selectedScriptId,
      hasFreshResultForScript,
      lastRunResultRef,
      userConnId,
      latestRunSignature,
      lastResultAt,
      sql,
      vars,
      runValues,
      refreshScriptRunsHistory,
    ],
  )

  const handleRunScript = useCallback(() => {
    void runScriptAction()
  }, [runScriptAction])

  const cancelRunAction = useMemo(
    () =>
      createCancelRunAction({
        getCancelingRunId: () => cancelingRunId,
        setCancelingRunId,
        cancelApiScriptRun,
        notifyWarning,
        notifyError,
      }),
    [cancelingRunId],
  )

  const handleCancelRunRequest = useCallback(
    async (run: QueryApiScriptRunRecord | null) => {
      await cancelRunAction(run)
    },
    [cancelRunAction],
  )

  const performSaveRunZip = useCallback(
    async (run: QueryApiScriptRunRecord): Promise<boolean> => {
      const info = extractRunScriptInfo(run)
      const base = (info.name ?? `run-${run.id.slice(0, 8)}`).replace(/[^a-zA-Z0-9-_]+/g, '_')
      const suggested = `${base || run.id}.zip`
      try {
        if (!run.zipPath) {
          try {
            await ensureApiScriptRunZip(run.id)
            await refreshScriptRunsHistory()
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            notifyError({
              color: 'red',
              title: '生成 ZIP 失败',
              message,
              icon: ICON_ERROR,
            })
            return false
          }
        }
        const target = await saveDialog({
          title: '保存脚本运行结果',
          defaultPath: suggested,
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
        })
        if (!target) return false
        setDownloadingRunId(run.id)
        await exportApiScriptRunZip(run.id, target)
        notifySuccess({
          color: 'teal',
          title: '导出成功',
          message: `已保存到 ${target}`,
          icon: ICON_SUCCESS,
        })
        await refreshScriptRunsHistory()
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        notifyError({
          color: 'red',
          title: '导出失败',
          message,
          icon: ICON_ERROR,
        })
        return false
      } finally {
        setDownloadingRunId(null)
      }
    },
    [refreshScriptRunsHistory],
  )

  const handleManualExport = useCallback(
    async (run: QueryApiScriptRunRecord) => {
      await performSaveRunZip(run)
    },
    [performSaveRunZip],
  )

  const handleOpenLogViewer = useCallback(async (run: QueryApiScriptRunRecord) => {
    setLogViewer({ run, entries: [], loading: true, error: null })
    try {
      const entries = await readApiScriptRunLog(run.id, 500)
      setLogViewer({ run, entries, loading: false, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setLogViewer({ run, entries: [], loading: false, error: message })
    }
  }, [])

  const handleCleanupCache = useCallback(async () => {
    if (cleanupBusy) return
    const confirmed = await confirmDanger('确认清理超过 24 小时的脚本缓存文件？')
    if (!confirmed) return
    setCleanupBusy(true)
    try {
      const cleaned = await cleanupApiScriptCache()
      notifySuccess({
        color: 'teal',
        title: '清理完成',
        message:
          cleaned > 0 ? `已清理 ${cleaned} 个任务缓存` : '没有需要清理的缓存文件。',
        icon: ICON_SUCCESS,
      })
      if (cleaned > 0) {
        await refreshScriptRunsHistory()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      notifyError({
        color: 'red',
        title: '清理失败',
        message,
        icon: ICON_ERROR,
      })
    } finally {
      setCleanupBusy(false)
    }
  }, [cleanupBusy, refreshScriptRunsHistory])

  const handleDeleteHistoryRun = useCallback(
    async (run: QueryApiScriptRunRecord) => {
      if (!run) return
      if (deletingRunId) return
      if (run.status === 'running' || run.status === 'pending') return
      const info = extractRunScriptInfo(run)
      const label = info?.name ?? `任务 ${run.id.slice(0, 8)}`
      const confirmed = await confirmDanger(`确认删除「${label}」的历史记录？该操作不可撤销。`)
      if (!confirmed) return
      setDeletingRunId(run.id)
      try {
        const deleted = await deleteApiScriptRun(run.id)
        notifySuccess({
          color: deleted ? 'teal' : 'gray',
          title: deleted ? '删除成功' : '记录不存在',
          message: deleted ? '已移除选中的任务记录。' : '任务记录可能已被移除。',
          icon: ICON_SUCCESS,
        })
        await refreshScriptRunsHistory()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        notifyError({
          color: 'red',
          title: '删除失败',
          message,
          icon: ICON_ERROR,
        })
      } finally {
        setDeletingRunId(null)
      }
    },
    [deletingRunId, refreshScriptRunsHistory],
  )

  const handleClearHistory = useCallback(async () => {
    if (clearingRuns) return
    if (!queryId) {
      notifyWarning({
        color: 'orange',
        title: '无法清空历史',
        message: '请先保存查询，才能管理对应的脚本任务历史。',
        icon: ICON_WARNING,
      })
      return
    }
    const confirmed = await confirmDanger('确认清空当前查询的脚本任务历史？正在执行的任务会被保留。')
    if (!confirmed) return
    setClearingRuns(true)
    try {
      const removed = await clearApiScriptRuns({ queryId })
      notifySuccess({
        color: 'teal',
        title: '历史已清空',
        message: removed > 0 ? `已移除 ${removed} 条历史记录。` : '没有可清理的历史记录。',
        icon: ICON_SUCCESS,
      })
      await refreshScriptRunsHistory()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      notifyError({
        color: 'red',
        title: '清空失败',
        message,
        icon: ICON_ERROR,
      })
    } finally {
      setClearingRuns(false)
    }
  }, [clearingRuns, queryId, refreshScriptRunsHistory])

  const handleCloseLogViewer = useCallback(() => {
    setLogViewer(null)
  }, [])

  const statusRun = activeScriptRun ?? null
  const showSpinner = Boolean(
    activeScriptRun || (!statusRun && (scriptRunLoading || scriptRunPendingEvents > 0)),
  )

  const runnerSection = useMemo<RunnerSectionProps>(() => ({
    scripts: scriptItems,
    selectedId: selectedScriptId,
    onSelect: handleSelectScript,
    onCreate: handleCreateScript,
    onEdit: handleEditScript,
    onDuplicate: handleDuplicateScript,
    onDelete: handleDeleteScript,
    onRun: handleRunScript,
    disabled: !queryId || isExecuting,
    running: scriptRunning,
    hasFreshResult: hasFreshResultForScript,
    loading: scriptsLoading,
    busy: scriptSaving || scriptDeleting,
    error: scriptLoadError ?? (scriptEditorOpen ? null : scriptSubmitError),
  }), [
    scriptItems,
    selectedScriptId,
    handleSelectScript,
    handleCreateScript,
    handleEditScript,
    handleDuplicateScript,
    handleDeleteScript,
    handleRunScript,
    queryId,
    isExecuting,
    scriptRunning,
    hasFreshResultForScript,
    scriptsLoading,
    scriptSaving,
    scriptDeleting,
    scriptLoadError,
    scriptEditorOpen,
    scriptSubmitError,
  ])

  const statusSection = useMemo<StatusSectionProps>(() => ({
    run: statusRun,
    loading: showSpinner,
    error: scriptRunError,
    onRefresh: refreshScriptRunsHistory,
    onCancel: statusRun ? () => void handleCancelRunRequest(statusRun) : undefined,
    cancelDisabled: Boolean(
      !statusRun ||
        statusRun.status !== 'running' ||
        (cancelingRunId && cancelingRunId !== statusRun.id),
    ),
    canceling: cancelingRunId === statusRun?.id,
  }), [
    statusRun,
    showSpinner,
    scriptRunError,
    refreshScriptRunsHistory,
    handleCancelRunRequest,
    cancelingRunId,
  ])

  const historySection = useMemo<HistorySectionProps>(() => ({
    runs: scriptRunRecords,
    loading: scriptRunLoading,
    error: scriptRunError,
    onRefresh: refreshScriptRunsHistory,
    onExport: (run) => {
      void handleManualExport(run)
    },
    onViewLog: (run) => {
      void handleOpenLogViewer(run)
    },
    onCleanup: () => {
      void handleCleanupCache()
    },
    cleanupDisabled: cleanupBusy,
    downloadingRunId,
    onDelete: (run) => {
      void handleDeleteHistoryRun(run)
    },
    deleteDisabled: scriptRunLoading || clearingRuns,
    deletingRunId,
    onClear: () => {
      void handleClearHistory()
    },
    clearDisabled: clearingRuns || scriptRunLoading,
  }), [
    scriptRunRecords,
    scriptRunLoading,
    scriptRunError,
    refreshScriptRunsHistory,
    handleManualExport,
    handleOpenLogViewer,
    handleCleanupCache,
    cleanupBusy,
    downloadingRunId,
    handleDeleteHistoryRun,
    clearingRuns,
    deletingRunId,
    handleClearHistory,
  ])

  const drawerProps = useMemo<QueryApiScriptTaskDrawerProps | null>(() => {
    if (mode !== 'run') return null
    return {
      runner: runnerSection,
      status: statusSection,
      history: historySection,
    }
  }, [mode, runnerSection, statusSection, historySection])

  const logViewerInfo = useMemo(
    () => (logViewer ? extractRunScriptInfo(logViewer.run) : null),
    [logViewer],
  )

  return {
    drawerProps,
    logViewer,
    logViewerInfo,
    handleCloseLogViewer,
    handleCloseScriptEditor,
  }
}

export const __test__ = {
  createRunScriptAction,
  createCancelRunAction,
}
