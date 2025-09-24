import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Button,
  Group,
  Loader,
  LoadingOverlay,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconX } from '@tabler/icons-react';
import type {
  SavedQueryVariableDef,
  DynamicColumnDef,
  CalcItemDef,
} from '@rei-db-view/types/appdb';
import { emitQueryExecutingEvent } from '@rei-db-view/types/events';
import { SavedQueriesSidebar } from '@/components/queries/SavedQueriesSidebar';
import { EditQueryPanel } from '@/components/queries/EditQueryPanel';
import { RunQueryPanel } from '@/components/queries/RunQueryPanel';
import { TempQueryPanel } from '@/components/queries/TempQueryPanel';
import type { SavedItem, CalcResultState } from '@/components/queries/types';
import { QueryApiScriptEditorDrawer, QueryApiScriptTaskDrawer } from '@/components/queries/api-scripts';
import type { QueryApiScriptSummary, QueryApiScriptRunRecord } from '@/services/queryApiScripts';
import {
  getSavedSql,
  createSavedSql,
  updateSavedSql,
  archiveSavedSql,
  exportAllSavedSql,
  importSavedSql,
  listSavedSql,
  type SavedSqlSummary,
  getSavedSqlColumnWidths,
  replaceSavedSqlColumnWidths,
} from '@/services/savedSql';
import {
  computeCalcSql,
  QueryError,
  DEFAULT_PAGE_SIZE,
  type ExecuteResult,
} from '@/services/pgExec';
import {
  executeApiScript,
  cancelApiScriptRun,
  exportApiScriptRunZip,
  ensureApiScriptRunZip,
  readApiScriptRunLog,
  cleanupApiScriptCache,
  deleteApiScriptRun,
  clearApiScriptRuns,
  type ApiScriptRequestLogEntry,
} from '@/services/apiScriptRunner';
import { parseSavedQueriesExport } from '@/lib/saved-sql-import-export';
import { getCurrentConnId, subscribeCurrentConnId } from '@/lib/current-conn';
import { listConnections, getDsnForConn } from '@/lib/localStore';
import { normalizeCalcItems, normalizeCalcItem } from '@/lib/calc-item-utils';
import { useQueryApiScripts } from '@/lib/use-query-api-scripts';
import { useApiScriptRuns } from '@/lib/use-api-script-runs';
import { compileSql } from '@/lib/sql-template';
import { extractRunScriptInfo } from '@/lib/api-script-run-utils';
import { saveDialog } from '@/lib/tauri-dialog';
import { usePersistentSet } from '@/lib/use-persistent-set';
import {
  confirmDanger,
  notifyError,
  notifyInfo,
  notifySuccess,
  notifyWarning,
} from '@/lib/notifications';
import { useSavedSqlSelection } from '../hooks/queries/useSavedSqlSelection';
import { usePaginationState } from '../hooks/queries/usePaginationState';
import { useQueryResultState } from '../hooks/queries/useQueryResultState';
import { useSavedSqlColumnWidths } from '../hooks/queries/useSavedSqlColumnWidths';
import { useQueryExecutor, type QueryTimingState } from '../hooks/queries/useQueryExecutor';

const isSameWidthMap = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
};

function toSavedItem(summary: SavedSqlSummary): SavedItem {
  return {
    id: summary.id,
    name: summary.name,
    description: summary.description,
    variables: summary.variables,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

function useCurrentConnIdState() {
  const [id, setId] = useState<string | null>(() => getCurrentConnId());
  useEffect(() => {
    return subscribeCurrentConnId((v) => setId(v));
  }, []);
  return id;
}

const defaultSql = 'SELECT * FROM users LIMIT 10';
const defaultTempSql = 'SELECT 1;';
const PAGE_SIZE_STORAGE_KEY = 'rdv.desktop.queries.pageSize';

export default function QueriesPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const {
    mode,
    setMode,
    currentId,
    setCurrentId,
    name,
    setName,
    description,
    setDescription,
    sql,
    setSql,
    tempSql,
    setTempSql,
    vars,
    setVars,
    runValues,
    setRunValues,
    dynCols,
    setDynCols,
    calcItems,
    setCalcItems,
    startNew: startNewSelection,
    switchToTemp: switchToTempSelection,
    loadSaved: loadSavedSelection,
  } = useSavedSqlSelection({
    defaultSql,
    defaultTempSql,
    loadSavedSql: getSavedSql,
  });
  const pagination = usePaginationState({
    storageKey: PAGE_SIZE_STORAGE_KEY,
    defaultPageSize: DEFAULT_PAGE_SIZE,
  });
  const {
    enabled: pgEnabled,
    setEnabled: setPgEnabled,
    page: pgPage,
    setPage: setPgPage,
    pageSize: pgSize,
    setPageSize: setPgSize,
    totalRows: pgTotalRows,
    setTotalRows: setPgTotalRows,
    totalPages: pgTotalPages,
    setTotalPages: setPgTotalPages,
    countLoaded: pgCountLoaded,
    setCountLoaded: setPgCountLoaded,
    reset: resetPagination,
  } = pagination;
  const {
    previewSQL,
    setPreviewSQL,
    rows,
    setRows,
    gridCols,
    setGridCols,
    textResult,
    setTextResult,
    isPreviewing,
    setIsPreviewing,
    reset: resetResultState,
  } = useQueryResultState();
  const { widths: savedColumnWidths, setWidths: setSavedColumnWidths } =
    useSavedSqlColumnWidths(currentId, getSavedSqlColumnWidths);
  const savedColumnWidthsRef = useRef<Record<string, number>>({});
  const sqlPreviewRef = useRef<HTMLDivElement | null>(null);
  const scrollSqlPreview = useCallback(() => {
    requestAnimationFrame(() => {
      sqlPreviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);
  const [isExecuting, setIsExecuting] = useState(false);
  useEffect(() => {
    emitQueryExecutingEvent(isExecuting, 'desktop/queries');
    return () => {
      if (isExecuting) emitQueryExecutingEvent(false, 'desktop/queries');
    };
  }, [isExecuting]);
  const [calcResults, setCalcResults] = useState<Record<string, CalcResultState>>({});
  const [queryTiming, setQueryTiming] = useState<QueryTimingState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const calcAutoTriggeredRef = useRef<Record<string, boolean>>({});
  const lastExecSignatureRef = useRef<string | null>(null);
  const lastRunResultRef = useRef<ExecuteResult | null>(null);
  const [lastResultAt, setLastResultAt] = useState<number | null>(null);
  const [scriptRunning, setScriptRunning] = useState(false);
  const [cancelingRunId, setCancelingRunId] = useState<string | null>(null);
  const [downloadingRunId, setDownloadingRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [clearingRuns, setClearingRuns] = useState(false);
  const [logViewer, setLogViewer] = useState<{
    run: QueryApiScriptRunRecord;
    entries: ApiScriptRequestLogEntry[];
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const runtimeCalcItemsRef = useRef<CalcItemDef[]>([]);
  const [explainFormat, setExplainFormat] = useState<'text' | 'json'>('text');
  const [explainAnalyze, setExplainAnalyze] = useState(false);
  const getNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const userConnId = useCurrentConnIdState();
  const [connItems, setConnItems] = useState<
    Array<{ id: string; alias: string; host?: string | null }>
  >([]);
  const [extraFolders, setExtraFolders] = usePersistentSet<string>(
    'rdv.savedSql.extraFolders',
    () => new Set<string>(),
  );
  const [expanded, setExpanded] = usePersistentSet<string>(
    'rdv.savedSql.expanded',
    () => new Set<string>(['/']),
  );

  const canSave = useMemo(
    () => name.trim().length > 0 && sql.trim().length > 0,
    [name, sql]
  );

  const activeColumnWidths = useMemo(() => {
    if (!currentId || gridCols.length === 0) return undefined;
    const map: Record<string, number> = {};
    for (const col of gridCols) {
      const width = savedColumnWidths[col];
      if (typeof width === 'number' && width > 0) {
        map[col] = width;
      }
    }
    return Object.keys(map).length > 0 ? map : undefined;
  }, [currentId, gridCols, savedColumnWidths]);

  useEffect(() => {
    listSavedSql()
      .then((list) => setItems(list.map(toSavedItem)))
      .catch((e: any) => setError(String(e?.message || e)));
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await listSavedSql();
      setItems(list.map(toSavedItem));
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, []);

  useEffect(() => {
    listConnections()
      .then((res) => setConnItems(res))
      .catch(() => {});
  }, []);

  useEffect(() => {
    savedColumnWidthsRef.current = savedColumnWidths;
  }, [savedColumnWidths]);

  useEffect(() => {
    calcAutoTriggeredRef.current = {};
    lastExecSignatureRef.current = null;
  }, [currentId]);

  useEffect(() => {
    calcAutoTriggeredRef.current = {};
  }, [calcItems]);

  useEffect(() => {
    lastRunResultRef.current = null;
    setLastResultAt(null);
  }, [runValues]);

  const currentConn = useMemo(() => {
    if (!userConnId) return null;
    return connItems.find((x) => x.id === userConnId) || null;
  }, [connItems, userConnId]);

  const {
    scripts: apiScripts,
    loading: scriptsLoading,
    loadError: scriptLoadError,
    selectedId: selectedScriptId,
    setSelectedId: setSelectedScriptId,
    refresh: refreshScripts,
    openCreate: openCreateScript,
    openEdit: openEditScript,
    openDuplicate: openDuplicateScript,
    editorOpen: scriptEditorOpen,
    editorMode: scriptEditorMode,
    editorForm: scriptEditorForm,
    setEditorForm: setScriptEditorForm,
    closeEditor: closeScriptEditor,
    saveEditor: saveScriptEditor,
    deleteById: deleteScriptById,
    saving: scriptSaving,
    deleting: scriptDeleting,
    submitError: scriptSubmitError,
    setSubmitError: setScriptSubmitError,
  } = useQueryApiScripts(mode === 'temp' ? null : currentId);

  const {
    runs: scriptRunRecords,
    loading: scriptRunLoading,
    error: scriptRunError,
    activeRun: activeScriptRun,
    pendingEventCount: scriptRunPendingEvents,
    refresh: refreshScriptRunsHistory,
  } = useApiScriptRuns(mode === 'temp' ? null : currentId, {
    limit: 30,
    scriptId: mode === 'run' ? selectedScriptId : null,
  });

  useEffect(() => {
    if (mode !== 'run') return;
    if (!currentId) return;
    if (!selectedScriptId) return;
    void refreshScriptRunsHistory();
  }, [mode, currentId, selectedScriptId, refreshScriptRunsHistory]);

  const latestRunSignature = useMemo(
    () => JSON.stringify({ id: currentId ?? '', values: runValues }),
    [currentId, runValues],
  );

  const hasFreshResultForScript = useMemo(
    () =>
      Boolean(
        lastResultAt &&
          lastExecSignatureRef.current === latestRunSignature &&
          lastRunResultRef.current,
      ),
    [lastResultAt, latestRunSignature],
  );

  const onDetectVars = () => {
    try {
      const found = new Set<string>();
      const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql))) {
        if (m[1]) found.add(m[1]!);
      }
      const newVars: SavedQueryVariableDef[] = [...found].map((name) => {
        const exists = vars.find((v) => v.name === name);
        return exists || { name, type: 'text', required: false };
      });
      setVars(newVars);
      setRunValues((rv) => {
        const next: Record<string, any> = {};
        for (const v of newVars) next[v.name] = rv[v.name] ?? v.default ?? '';
        return next;
      });
      setInfo('已根据 SQL 提取变量（默认类型为 text，可修改）');
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const onAddVar = () => {
    setVars((vs) => [...vs, { name: `var_${vs.length + 1}`, type: 'text' }]);
    setRunValues((rv) => ({ ...rv }));
  };

  const onRemoveVar = (varName: string) => {
    setVars((vs) => vs.filter((v) => v.name !== varName));
    setRunValues((rv) => {
      const { [varName]: _, ...rest } = rv;
      return rest;
    });
  };

  const handleColumnWidthsChange = useCallback(
    (next: Record<string, number>) => {
      if (!currentId) return;
      if (isSameWidthMap(savedColumnWidthsRef.current, next)) return;
      const normalized = { ...next };
      setSavedColumnWidths(normalized);
      replaceSavedSqlColumnWidths(currentId, normalized).catch((err) => {
        console.warn('Failed to persist column widths', err);
      });
    },
    [currentId]
  );

  const handleSelectScript = useCallback(
    (id: string | null) => {
      setSelectedScriptId(id);
    },
    [setSelectedScriptId],
  );

  const handleCreateScript = useCallback(() => {
    if (!currentId) {
      notifyWarning({
        color: 'orange',
        title: '请先保存查询',
        message: '保存当前查询后才能创建 API 脚本。',
        icon: <IconX size={16} />,
      });
      return;
    }
    setScriptSubmitError(null);
    openCreateScript();
  }, [currentId, openCreateScript, setScriptSubmitError]);

  const handleEditScript = useCallback(
    (id: string) => {
      setScriptSubmitError(null);
      void openEditScript(id);
    },
    [openEditScript, setScriptSubmitError],
  );

  const handleDuplicateScript = useCallback(
    (id: string) => {
      setScriptSubmitError(null);
      void openDuplicateScript(id);
    },
    [openDuplicateScript, setScriptSubmitError],
  );

  const handleDeleteScript = useCallback(
    async (script: QueryApiScriptSummary) => {
      const confirmed = await confirmDanger(`确定删除脚本「${script.name}」吗？`);
      if (!confirmed) return;
      const ok = await deleteScriptById(script.id);
      if (ok) {
        notifySuccess({
          color: 'teal',
          title: '删除成功',
          message: `已删除脚本「${script.name}」。`,
          icon: <IconCheck size={16} />,
        });
      } else {
        notifyError({
          color: 'red',
          title: '删除失败',
          message: '删除失败，请稍后重试。',
          icon: <IconX size={16} />,
        });
      }
    },
    [deleteScriptById],
  );

  const handleCloseScriptEditor = useCallback(() => {
    closeScriptEditor();
    setScriptSubmitError(null);
  }, [closeScriptEditor, setScriptSubmitError]);

  const handleRunScript = useCallback(async () => {
    if (mode !== 'run') {
      notifyInfo({
        color: 'gray',
        title: '无法执行',
        message: '请先切换到运行模式再执行脚本。',
        icon: <IconX size={16} />,
      });
      return;
    }
    if (!currentId) {
      notifyError({
        color: 'red',
        title: '无法执行',
        message: '请先保存查询后再配置脚本执行。',
        icon: <IconX size={16} />,
      });
      return;
    }
    if (!selectedScriptId) {
      notifyError({
        color: 'red',
        title: '未选择脚本',
        message: '请选择要执行的脚本。',
        icon: <IconX size={16} />,
      });
      return;
    }
    if (!hasFreshResultForScript || !lastRunResultRef.current) {
      notifyWarning({
        color: 'orange',
        title: '需要最新结果',
        message: '请先执行查询并确保结果最新，再运行脚本。',
        icon: <IconX size={16} />,
      });
      return;
    }
    if (!userConnId) {
      notifyError({
        color: 'red',
        title: '缺少连接',
        message: '请先选择数据库连接。',
        icon: <IconX size={16} />,
      });
      return;
    }
    setScriptRunning(true);
    try {
      const compiled = compileSql(sql, vars, runValues);
      const connectionDsn = await getDsnForConn(userConnId);
      await executeApiScript({
        scriptId: selectedScriptId,
        queryId: currentId,
        runSignature: latestRunSignature,
        executedSql: lastRunResultRef.current.sql,
        params: lastRunResultRef.current.params ?? [],
        executedAt: lastResultAt ?? Date.now(),
        userConnId,
        connectionDsn,
        baseSql: compiled.text,
        baseParams: compiled.values,
      });
      await refreshScriptRunsHistory();
      notifySuccess({
        color: 'teal',
        title: '脚本任务已提交',
        message: '任务将在后台执行，执行结果稍后可在任务历史查看。',
        icon: <IconCheck size={16} />,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notifyError({
        color: 'red',
        title: '执行失败',
        message,
        icon: <IconX size={16} />,
      });
    } finally {
      setScriptRunning(false);
    }
  }, [
    mode,
    currentId,
    selectedScriptId,
    hasFreshResultForScript,
    latestRunSignature,
    lastResultAt,
    userConnId,
    sql,
    vars,
    runValues,
    refreshScriptRunsHistory,
  ]);

  const handleCancelRunRequest = useCallback(
    async (run: QueryApiScriptRunRecord | null) => {
      if (!run) return;
      if (run.status !== 'running' && run.status !== 'pending') return;
      if (cancelingRunId) return;
      setCancelingRunId(run.id);
      try {
        await cancelApiScriptRun(run.id);
        notifyWarning({
          color: 'orange',
          title: '正在取消任务',
          message: '已通知后台取消该脚本执行。',
          icon: <IconAlertTriangle size={16} />,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        notifyError({
          color: 'red',
          title: '取消失败',
          message,
          icon: <IconX size={16} />,
        });
      } finally {
        setCancelingRunId(null);
      }
    },
    [cancelingRunId],
  );

  const performSaveRunZip = useCallback(
    async (run: QueryApiScriptRunRecord) => {
      const info = extractRunScriptInfo(run);
      const base = (info.name ?? `run-${run.id.slice(0, 8)}`).replace(/[^a-zA-Z0-9-_]+/g, '_');
      const suggested = `${base || run.id}.zip`;
      try {
        if (!run.zipPath) {
          try {
            await ensureApiScriptRunZip(run.id);
            await refreshScriptRunsHistory();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            notifyError({
              color: 'red',
              title: '生成 ZIP 失败',
              message,
              icon: <IconX size={16} />,
            });
            return false;
          }
        }
        const target = await saveDialog({
          title: '保存脚本运行结果',
          defaultPath: suggested,
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
        });
        if (!target) return false;
        setDownloadingRunId(run.id);
        await exportApiScriptRunZip(run.id, target);
        notifySuccess({
          color: 'teal',
          title: '导出成功',
          message: `已保存到 ${target}`,
          icon: <IconCheck size={16} />,
        });
        await refreshScriptRunsHistory();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        notifyError({
          color: 'red',
          title: '导出失败',
          message,
          icon: <IconX size={16} />,
        });
        return false;
      } finally {
        setDownloadingRunId(null);
      }
    },
    [refreshScriptRunsHistory],
  );

  const handleManualExport = useCallback(
    async (run: QueryApiScriptRunRecord) => {
      await performSaveRunZip(run);
    },
    [performSaveRunZip],
  );

  const handleOpenLogViewer = useCallback(
    async (run: QueryApiScriptRunRecord) => {
      setLogViewer({ run, entries: [], loading: true, error: null });
      try {
        const entries = await readApiScriptRunLog(run.id, 500);
        setLogViewer({ run, entries, loading: false, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLogViewer({ run, entries: [], loading: false, error: message });
      }
    },
    [],
  );

  const handleCleanupCache = useCallback(async () => {
    if (cleanupBusy) return;
    const confirmed = await confirmDanger('确认清理超过 24 小时的脚本缓存文件？');
    if (!confirmed) return;
    setCleanupBusy(true);
    try {
      const cleaned = await cleanupApiScriptCache();
      notifySuccess({
        color: 'teal',
        title: '清理完成',
        message:
          cleaned > 0
            ? `已清理 ${cleaned} 个任务缓存`
            : '没有需要清理的缓存文件。',
        icon: <IconCheck size={16} />,
      });
      if (cleaned > 0) {
        await refreshScriptRunsHistory();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notifyError({
        color: 'red',
        title: '清理失败',
        message,
        icon: <IconX size={16} />,
      });
    } finally {
      setCleanupBusy(false);
    }
  }, [cleanupBusy, refreshScriptRunsHistory]);

  const handleDeleteHistoryRun = useCallback(
    async (run: QueryApiScriptRunRecord) => {
      if (!run) return;
      if (deletingRunId) return;
      if (run.status === 'running' || run.status === 'pending') return;
      const info = extractRunScriptInfo(run);
      const label = info?.name ?? `任务 ${run.id.slice(0, 8)}`;
      const confirmed = await confirmDanger(
        `确认删除「${label}」的历史记录？该操作不可撤销。`,
      );
      if (!confirmed) return;
      setDeletingRunId(run.id);
      try {
        const deleted = await deleteApiScriptRun(run.id);
        notifySuccess({
          color: deleted ? 'teal' : 'gray',
          title: deleted ? '删除成功' : '记录不存在',
          message: deleted ? '已移除选中的任务记录。' : '任务记录可能已被移除。',
          icon: <IconCheck size={16} />,
        });
        await refreshScriptRunsHistory();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        notifyError({
          color: 'red',
          title: '删除失败',
          message,
          icon: <IconX size={16} />,
        });
      } finally {
        setDeletingRunId(null);
      }
    },
    [deletingRunId, refreshScriptRunsHistory],
  );

  const handleClearHistory = useCallback(async () => {
    if (clearingRuns) return;
    if (!currentId) {
      notifyWarning({
        color: 'orange',
        title: '无法清空历史',
        message: '请先保存查询，才能管理对应的脚本任务历史。',
        icon: <IconAlertTriangle size={16} />,
      });
      return;
    }
    const confirmed = await confirmDanger(
      '确认清空当前查询的脚本任务历史？正在执行的任务会被保留。',
    );
    if (!confirmed) return;
    setClearingRuns(true);
    try {
      const removed = await clearApiScriptRuns({ queryId: currentId });
      notifySuccess({
        color: 'teal',
        title: '历史已清空',
        message:
          removed > 0
            ? `已移除 ${removed} 条历史记录。`
            : '没有可清理的历史记录。',
        icon: <IconCheck size={16} />,
      });
      await refreshScriptRunsHistory();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notifyError({
        color: 'red',
        title: '清空失败',
        message,
        icon: <IconX size={16} />,
      });
    } finally {
      setClearingRuns(false);
    }
  }, [clearingRuns, currentId, refreshScriptRunsHistory]);

  const handleCloseLogViewer = useCallback(() => setLogViewer(null), []);

  const statusRun = activeScriptRun ?? null;
  const showSpinner = Boolean(
    activeScriptRun || (!statusRun && (scriptRunLoading || scriptRunPendingEvents > 0)),
  );
  const logViewerInfo = useMemo(
    () => (logViewer ? extractRunScriptInfo(logViewer.run) : null),
    [logViewer],
  );

  const scriptTaskDrawer =
    mode === 'run'
      ? (
          <QueryApiScriptTaskDrawer
            runner={{
              scripts: apiScripts,
              selectedId: selectedScriptId,
              onSelect: handleSelectScript,
              onCreate: handleCreateScript,
              onEdit: handleEditScript,
              onDuplicate: handleDuplicateScript,
              onDelete: handleDeleteScript,
              onRun: handleRunScript,
              disabled: !currentId || isExecuting,
              running: scriptRunning,
              hasFreshResult: hasFreshResultForScript,
              loading: scriptsLoading,
              busy: scriptSaving || scriptDeleting,
              error: scriptLoadError ?? (scriptEditorOpen ? null : scriptSubmitError),
            }}
            status={{
              run: statusRun,
              loading: showSpinner,
              error: scriptRunError,
              onRefresh: refreshScriptRunsHistory,
              onCancel: statusRun ? () => handleCancelRunRequest(statusRun) : undefined,
              cancelDisabled: Boolean(
                !statusRun ||
                  statusRun.status !== 'running' ||
                  (cancelingRunId && cancelingRunId !== statusRun.id),
              ),
              canceling: cancelingRunId === statusRun?.id,
            }}
            history={{
              runs: scriptRunRecords,
              loading: scriptRunLoading,
              error: scriptRunError,
              onRefresh: refreshScriptRunsHistory,
              onExport: handleManualExport,
              onViewLog: handleOpenLogViewer,
              onCleanup: handleCleanupCache,
              cleanupDisabled: cleanupBusy,
              downloadingRunId,
              onDelete: handleDeleteHistoryRun,
              deleteDisabled: scriptRunLoading || clearingRuns,
              deletingRunId,
              onClear: handleClearHistory,
              clearDisabled: clearingRuns || scriptRunLoading,
            }}
          />
        )
      : null;

  const openDeleteDialog = useCallback((item: SavedItem) => {
    setDeleteBusy(false);
    setDeleteTarget(item);
  }, []);

  const onNew = () => {
    startNewSelection();
    resetResultState();
    setSavedColumnWidths({});
    setCalcResults({});
    setInfo('已切换为新建模式。');
    setQueryTiming(null);
    calcAutoTriggeredRef.current = {};
    lastExecSignatureRef.current = null;
    lastRunResultRef.current = null;
    setLastResultAt(null);
  };

  const onTempQueryMode = () => {
    switchToTempSelection();
    setError(null);
    setInfo('已切换为临时查询模式。');
    resetResultState();
    setSavedColumnWidths({});
    setCalcResults({});
    setQueryTiming(null);
    resetPagination();
    calcAutoTriggeredRef.current = {};
    lastExecSignatureRef.current = null;
    lastRunResultRef.current = null;
    setLastResultAt(null);
  };

  const loadAndOpen = useCallback(
    async (id: string, focusMode: 'run' | 'edit') => {
      setError(null);
      setInfo(null);
      try {
        await loadSavedSelection(id, focusMode);
        setCalcItems((items) => normalizeCalcItems(items));
        setSavedColumnWidths({});
        resetResultState();
        resetPagination();
        setCalcResults({});
        setQueryTiming(null);
        calcAutoTriggeredRef.current = {};
        lastExecSignatureRef.current = null;
        lastRunResultRef.current = null;
        setLastResultAt(null);
      } catch (e: any) {
        setError(String(e?.message || e));
      }
    },
    [loadSavedSelection, normalizeCalcItems, resetPagination, resetResultState]
  );

  const onSave = async (asNew?: boolean) => {
    setError(null);
    setInfo(null);
    try {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('名称不能为空');
      const payload = {
        name: trimmed,
        description: description.trim() || null,
        sql,
        variables: vars,
        dynamicColumns: dynCols,
        calcItems,
      };
      if (!currentId || asNew) {
        const res = await createSavedSql(payload);
        setCurrentId(res.id);
        notifySuccess({
          color: 'teal',
          title: '保存成功',
          message: '已创建 Saved SQL',
          icon: <IconCheck size={16} />,
        });
      } else {
        await updateSavedSql(currentId, payload);
        notifySuccess({
          color: 'teal',
          title: '保存成功',
          message: '已更新 Saved SQL',
          icon: <IconCheck size={16} />,
        });
      }
      refresh();
    } catch (e: any) {
      const msg = e instanceof QueryError ? e.message : String(e?.message || e);
      notifyError({
        color: 'red',
        title: '保存失败',
        message: msg,
        icon: <IconX size={16} />,
      });
      setError(msg);
    }
  };

  const onDelete = () => {
    if (!currentId) return;
    const existing =
      items.find((it) => it.id === currentId) ?? {
        id: currentId,
        name: name.trim() || currentId,
        description: description.trim() || null,
        variables: vars,
        createdAt: null,
        updatedAt: null,
      };
    openDeleteDialog(existing);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    const target = deleteTarget;
    try {
      await archiveSavedSql(target.id);
      if (currentId === target.id) {
        onNew();
      }
      await refresh();
      setInfo(`已归档 ${target.name}`);
      setDeleteTarget(null);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const onExportAll = useCallback(async () => {
    setBusy('导出中...');
    try {
      const payload = await exportAllSavedSql();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const ts = new Date()
        .toISOString()
        .replace(/[:T]/g, '-')
        .replace(/\..+$/, '');
      const name = `saved-queries-${ts}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setInfo(`已导出 ${payload.items.length} 条到 ${name}`);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }, []);

  const onImportFile = useCallback(
    async (file: File) => {
      setBusy('导入中...');
      setError(null);
      setInfo(null);
      try {
        const text = await file.text();
        const parsed = parseSavedQueriesExport(text);
        if (!parsed.ok) throw new Error(parsed.error);
        const overwrite = await confirmDanger(
          '导入：遇到同名查询是否覆盖？确定=覆盖，取消=跳过'
        );
        const stats = await importSavedSql(parsed.data, { overwrite });
        setInfo(
          `导入完成：新增 ${stats.added}，覆盖 ${stats.overwritten}，跳过 ${stats.skipped}`
        );
        refresh();
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onUpdateTotals = useCallback(
    (totalRows: number | null, totalPages: number | null) => {
      setPgTotalRows(totalRows);
      setPgTotalPages(totalPages);
      setPgCountLoaded(totalRows != null);
    },
    []
  );

  const runtimeCalcItems = useMemo(() => {
    if (mode !== 'run') return [];
    const base: CalcItemDef[] = [];
    if (pgEnabled) {
      base.push(
        normalizeCalcItem({
          name: '__total_count__',
          type: 'sql',
          code: 'select count(*)::bigint as total from ({{_sql}}) t',
          runMode: 'manual',
          kind: 'single',
        }),
      );
    }
    return [
      ...base,
      ...calcItems.map((ci) => normalizeCalcItem(ci)),
    ];
  }, [calcItems, pgEnabled, mode]);

  useEffect(() => {
    runtimeCalcItemsRef.current = runtimeCalcItems;
  }, [runtimeCalcItems]);

  const runCalcItem = useCallback(
    async (
      ci: CalcItemDef,
      opts?: {
        source?: 'auto' | 'manual';
        rowsOverride?: Array<Record<string, unknown>>;
        pageSizeOverride?: number;
      }
    ) => {
      if (mode !== 'run') return;
      const key = ci.name;
      const variant = (ci.kind ?? 'single') as 'single' | 'group';
      const effectiveRows = opts?.rowsOverride ?? rows;
      const pageSizeForCount = opts?.pageSizeOverride ?? pgSize;
      const start = getNow();
      let connectMs: number | undefined;
      let queryMs: number | undefined;
      setCalcResults((s) => ({
        ...s,
        [key]: {
          ...s[key],
          loading: true,
          error: undefined,
          groupRows: variant === 'group' ? undefined : s[key]?.groupRows,
          timing: undefined,
        },
      }));
      try {
        if (ci.type === 'sql') {
          if (!currentId) throw new Error('请先保存/选择查询');
          if (!userConnId) throw new Error('未设置当前连接');
          const res = await computeCalcSql({
            savedId: currentId,
            values: runValues,
            userConnId,
            calcSql: ci.code,
          });
          const rowsRes = Array.isArray(res.rows) ? res.rows : [];
          connectMs = res.timing?.connectMs ?? undefined;
          queryMs = res.timing?.queryMs ?? undefined;
          if (ci.name === '__total_count__') {
            let num: number | null = null;
            if (rowsRes[0]) {
              const v =
                (rowsRes[0] as any).total ??
                (rowsRes[0] as any).count ??
                Object.values(rowsRes[0])[0];
              const n =
                typeof v === 'string'
                  ? Number(v)
                  : typeof v === 'number'
                  ? v
                  : null;
              num = Number.isFinite(n as number) ? (n as number) : null;
            }
            if (num === null)
              throw new Error('返回格式不符合预期，应包含 total/count');
            const normalizedPageSize = Math.max(
              1,
              Number.isFinite(pageSizeForCount)
                ? Number(pageSizeForCount)
                : pgSize
            );
            const totalPages =
              num != null && normalizedPageSize > 0
                ? Math.max(1, Math.ceil(num / normalizedPageSize))
                : null;
            onUpdateTotals(num, totalPages);
            setCalcResults((s) => {
              const totalMs = Math.round(getNow() - start);
              return {
                ...s,
                [key]: {
                  value: num,
                  loading: false,
                  timing: {
                    totalMs,
                    connectMs,
                    queryMs,
                  },
                },
              };
            });
          } else if (variant === 'group') {
            const columns = res.columns?.length
              ? res.columns
              : Object.keys(rowsRes[0] || {});
            if (columns.length < 2) {
              throw new Error('计算数据组 SQL 需要至少两列（name, value）');
            }
            const [nameCol, valueCol] = columns;
            const groupRows = rowsRes.map((row) => {
              const rawName = (row as any)[nameCol as any];
              if (rawName === undefined || rawName === null) {
                throw new Error('name 列不能为空');
              }
              return {
                name: String(rawName),
                value: (row as any)[valueCol as any],
              };
            });
            setCalcResults((s) => {
              const totalMs = Math.round(getNow() - start);
              return {
                ...s,
                [key]: {
                  value: groupRows,
                  groupRows,
                  loading: false,
                  timing: {
                    totalMs,
                    connectMs,
                    queryMs,
                  },
                },
              };
            });
          } else {
            let display: any = null;
            if (rowsRes.length === 0) display = null;
            else if (rowsRes.length === 1) {
              const cols = res.columns?.length
                ? res.columns
                : Object.keys(rowsRes[0] || {});
              display = cols.length === 1 ? (rowsRes[0] as any)[cols[0] as any] : rowsRes[0];
            } else display = rowsRes;
            setCalcResults((s) => {
              const totalMs = Math.round(getNow() - start);
              return {
                ...s,
                [key]: {
                  value: display,
                  loading: false,
                  groupRows: undefined,
                  timing: {
                    totalMs,
                    connectMs,
                    queryMs,
                  },
                },
              };
            });
          }
        } else {
          const helpers = {
            fmtDate: (v: any) => (v ? new Date(v).toISOString() : ''),
            json: (v: any) => JSON.stringify(v),
            sumBy: (arr: any[], sel: (r: any) => number) =>
              arr.reduce((sum, row) => sum + (Number(sel(row)) || 0), 0),
            avgBy: (arr: any[], sel: (r: any) => number) => {
              const values = arr
                .map(sel)
                .map(Number)
                .filter((n) => Number.isFinite(n));
              return values.length
                ? values.reduce((sum, n) => sum + n, 0) / values.length
                : 0;
            },
          };
          // eslint-disable-next-line no-new-func
          const fn = new Function(
            'vars',
            'rows',
            'helpers',
            `"use strict"; return ( ${ci.code} )(vars, rows, helpers)`
          ) as any;
          const val = fn(runValues, effectiveRows, helpers);
          setCalcResults((s) => {
            const totalMs = Math.round(getNow() - start);
            return {
              ...s,
              [key]: {
                value: val,
                loading: false,
                groupRows: undefined,
                timing: {
                  totalMs,
                },
              },
            };
          });
        }
      } catch (e: any) {
        const msg = e instanceof QueryError ? e.message : String(e?.message || e);
        setCalcResults((s) => {
          const totalMs = Math.round(getNow() - start);
          return {
            ...s,
            [key]: {
              ...s[key],
              error: msg,
              loading: false,
              groupRows: undefined,
              timing: {
                totalMs,
                connectMs: connectMs,
                queryMs: queryMs,
              },
            },
          };
        });
      }
    },
    [mode, currentId, userConnId, runValues, rows, pgSize, onUpdateTotals]
  );

  const { preview: onPreview, execute: onExecute, explain: onExplain } = useQueryExecutor({
    mode,
    currentId,
    userConnId,
    tempSql,
    runValues,
    pagination: {
      enabled: pgEnabled,
      page: pgPage,
      pageSize: pgSize,
      countLoaded: pgCountLoaded,
      setPage: setPgPage,
      setPageSize: setPgSize,
      setTotalRows: setPgTotalRows,
      setTotalPages: setPgTotalPages,
      setCountLoaded: setPgCountLoaded,
    },
    result: {
      setPreviewSQL,
      setRows,
      setGridCols,
      setTextResult,
      setIsPreviewing,
    },
    status: {
      setError,
      setInfo,
      setIsExecuting,
      setQueryTiming,
      setLastResultAt,
    },
    refs: { lastRunResultRef },
    runtime: {
      calcAutoTriggeredRef,
      lastExecSignatureRef,
      runtimeCalcItemsRef,
      runCalcItem,
    },
    getNow,
    confirmDanger,
    explainFormat,
    explainAnalyze,
    onPreviewApplied: scrollSqlPreview,
  });

  return (
    <Stack gap="md" style={{ position: 'relative', height: '100%' }}>
      <LoadingOverlay
        visible={!!busy}
        zIndex={999}
        overlayProps={{ blur: 2 }}
        loaderProps={{ children: busy || '处理中...' }}
      />
      <Modal
        opened={!!deleteTarget}
        onClose={() => {
          if (!deleteBusy) setDeleteTarget(null);
        }}
        title="确认归档"
        centered
        closeOnClickOutside={!deleteBusy}
        closeOnEscape={!deleteBusy}
      >
        <Text size="sm">
          确认归档「{deleteTarget?.name ?? ''}」？归档后可在导出文件中手动恢复。
        </Text>
        <Group justify="flex-end" mt="md">
          <Button
            variant="default"
            onClick={() => setDeleteTarget(null)}
            disabled={deleteBusy}
          >
            取消
          </Button>
          <Button color="red" onClick={confirmDelete} loading={deleteBusy}>
            归档
          </Button>
        </Group>
      </Modal>
      <Modal
        opened={!!logViewer}
        onClose={handleCloseLogViewer}
        title={`执行日志${logViewerInfo?.name ? ` - ${logViewerInfo.name}` : ''}`}
        size="70%"
        centered
      >
        {logViewer?.loading ? (
          <Group justify="center" py="md">
            <Loader size="sm" />
          </Group>
        ) : logViewer?.error ? (
          <Text size="sm" c="red">
            {logViewer.error}
          </Text>
        ) : logViewer ? (
          logViewer.entries.length > 0 ? (
            <ScrollArea h={360} type="auto">
              <Stack gap="xs">
                {logViewer.entries.map((entry, idx) => {
                  const timestampLabel = new Date(entry.timestamp).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  });
                  return (
                    <Paper key={`${entry.timestamp}-${entry.request_index}-${idx}`} withBorder p="xs" radius="sm">
                      <Stack gap={4}>
                        <Group gap="md" wrap="wrap">
                          <Text size="xs" c="dimmed">
                            时间：{timestampLabel}
                          </Text>
                          <Text size="xs">批次 {entry.fetch_index + 1}</Text>
                          <Text size="xs">请求 #{entry.request_index}</Text>
                          <Text size="xs">行 {entry.start_row} - {entry.end_row}</Text>
                          <Text size="xs">条数 {entry.request_size}</Text>
                          <Text size="xs">
                            状态：{entry.status != null ? entry.status : '无返回'}
                          </Text>
                          <Text size="xs">耗时：{entry.duration_ms} ms</Text>
                        </Group>
                        {entry.error ? (
                          <Text size="xs" c="red">
                            错误：{entry.error}
                          </Text>
                        ) : (
                          <Text size="xs" c="teal">
                            请求成功
                          </Text>
                        )}
                        {entry.response_excerpt ? (
                          <Text size="xs" c="dimmed">
                            响应摘要：{entry.response_excerpt}
                          </Text>
                        ) : null}
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            </ScrollArea>
          ) : (
            <Text size="sm" c="dimmed">
              暂无日志记录。
            </Text>
          )
        ) : null}
      </Modal>
      <Group align="flex-start" style={{ height: '100%' }}>
        <SavedQueriesSidebar
          items={items}
          expanded={expanded}
          onToggleFolder={toggleFolder}
          extraFolders={extraFolders}
          onCreateFolder={(path) => {
            const segments = path.split('/').filter(Boolean);
            setExpanded((prev) => {
              const next = new Set(prev);
              let acc = '';
              for (const seg of segments) {
                acc = acc ? `${acc}/${seg}` : seg;
                next.add(acc);
              }
              return next;
            });
            setExtraFolders((prev) => {
              const next = new Set(prev);
              next.add(path);
              return next;
            });
            setMode('edit');
            setName(path ? `${path}/` : '');
            setInfo(`已创建文件夹：${path}`);
          }}
          onNewQuery={() => onNew()}
          onTempQuery={onTempQueryMode}
          onExportAll={onExportAll}
          onImportFile={onImportFile}
          busy={busy}
          onOpenItemRun={(it) => loadAndOpen(it.id, 'run')}
          onOpenItemEdit={(it) => loadAndOpen(it.id, 'edit')}
          onDeleteItem={(it) => openDeleteDialog(it)}
        />
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap="md" maw={1800}>
            <Paper withBorder p="md">
              <Title order={3}>Saved SQL</Title>
              <Text c="dimmed" size="sm">
                桌面版 M4 迭代：复用 Web 端 Saved SQL
                能力，支持模板变量、分页与动态列。
              </Text>
              {error ? (
                <Text c="red" mt="sm">
                  {error}
                </Text>
              ) : null}
              {info ? (
                <Text c="teal" mt="sm">
                  {info}
                </Text>
              ) : null}
            </Paper>

            {mode === 'edit' ? (
              <EditQueryPanel
                name={name}
                setName={setName}
                description={description}
                setDescription={setDescription}
                canSave={canSave}
                onSave={() => onSave(false)}
                onSaveAs={() => onSave(true)}
                onNew={onNew}
                onDelete={onDelete}
                currentId={currentId}
                sql={sql}
                setSql={setSql}
                onDetectVars={onDetectVars}
                onAddVar={onAddVar}
                vars={vars}
                setVars={setVars}
                runValues={runValues}
                setRunValues={setRunValues}
                onRemoveVar={onRemoveVar}
                userConnId={userConnId}
                dynCols={dynCols}
                setDynCols={setDynCols}
                calcItems={calcItems}
                setCalcItems={setCalcItems}
              />
            ) : mode === 'temp' ? (
              <TempQueryPanel
                userConnId={userConnId}
                currentConn={currentConn}
                sql={tempSql}
                setSql={setTempSql}
                pgEnabled={pgEnabled}
                setPgEnabled={(v) => {
                  setPgEnabled(v);
                  if (!v) {
                    setPgTotalRows(null);
                    setPgTotalPages(null);
                  }
                }}
                pgSize={pgSize}
                setPgSize={(n) => setPgSize(n)}
                pgPage={pgPage}
                setPgPage={(n) => setPgPage(n)}
                pgTotalRows={pgTotalRows}
                pgTotalPages={pgTotalPages}
                onResetCounters={() => {
                  setPgTotalRows(null);
                  setPgTotalPages(null);
                  setPgCountLoaded(false);
                }}
                onPreview={() => onPreview()}
                onExecute={(opts) => onExecute(opts)}
                onExplain={onExplain}
                isExecuting={isExecuting}
                sqlPreviewRef={sqlPreviewRef}
                isPreviewing={isPreviewing}
                previewSQL={previewSQL}
                textResult={textResult}
                gridCols={gridCols}
                rows={rows}
                queryTiming={queryTiming}
                explainFormat={explainFormat}
                setExplainFormat={setExplainFormat}
                explainAnalyze={explainAnalyze}
                setExplainAnalyze={setExplainAnalyze}
              />
            ) : (
              <RunQueryPanel
                userConnId={userConnId}
                currentConn={currentConn}
                currentQueryName={name}
                vars={vars}
                runValues={runValues}
                setRunValues={setRunValues}
                pgEnabled={pgEnabled}
                setPgEnabled={(v) => {
                  setPgEnabled(v);
                  if (!v) {
                    setPgTotalRows(null);
                    setPgTotalPages(null);
                  }
                }}
                pgSize={pgSize}
                setPgSize={(n) => setPgSize(n)}
                pgPage={pgPage}
                setPgPage={(n) => setPgPage(n)}
                pgTotalRows={pgTotalRows}
                pgTotalPages={pgTotalPages}
                onResetCounters={() => {
                  setPgTotalRows(null);
                  setPgTotalPages(null);
                  setPgCountLoaded(false);
                }}
                onPreview={() => onPreview()}
                onExecute={(opts) => onExecute(opts)}
                onExplain={onExplain}
                isExecuting={isExecuting}
                explainFormat={explainFormat}
                setExplainFormat={setExplainFormat}
                explainAnalyze={explainAnalyze}
                setExplainAnalyze={setExplainAnalyze}
                sqlPreviewRef={sqlPreviewRef}
                isPreviewing={isPreviewing}
                previewSQL={previewSQL}
                textResult={textResult}
                gridCols={gridCols}
                rows={rows}
                columnWidths={mode === 'run' ? activeColumnWidths : undefined}
                onColumnWidthsChange={
                  mode === 'run' && currentId ? handleColumnWidthsChange : undefined
                }
                queryTiming={queryTiming}
                runtimeCalcItems={runtimeCalcItems}
                calcResults={calcResults}
                onRunCalc={(ci) => runCalcItem(ci)}
                onUpdateTotal={onUpdateTotals}
              />
            )}
          </Stack>
        </ScrollArea>
        {scriptTaskDrawer}
      </Group>
      {scriptEditorOpen && scriptEditorForm ? (
        <QueryApiScriptEditorDrawer
          opened={scriptEditorOpen}
          mode={scriptEditorMode ?? 'create'}
          form={scriptEditorForm}
          setForm={setScriptEditorForm}
          saving={scriptSaving}
          deleting={scriptDeleting}
          submitError={scriptSubmitError}
          onSubmit={saveScriptEditor}
          onDelete={scriptEditorForm.id ? () => deleteScriptById(scriptEditorForm.id!) : undefined}
          onClose={handleCloseScriptEditor}
        />
      ) : null}
    </Stack>
  );
}
