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
  LoadingOverlay,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import type {
  SavedQueryVariableDef,
  DynamicColumnDef,
  CalcItemDef,
} from '@rei-db-view/types/appdb';
import { SavedQueriesSidebar } from '@/components/queries/SavedQueriesSidebar';
import { EditQueryPanel } from '@/components/queries/EditQueryPanel';
import { RunQueryPanel } from '@/components/queries/RunQueryPanel';
import type { SavedItem } from '@/components/queries/types';
import {
  getSavedSql,
  createSavedSql,
  updateSavedSql,
  archiveSavedSql,
  exportAllSavedSql,
  importSavedSql,
  listSavedSql,
  type SavedSqlSummary,
} from '@/services/savedSql';
import {
  previewSavedSql,
  executeSavedSql,
  explainSavedSql,
  computeCalcSql,
  QueryError,
} from '@/services/pgExec';
import { parseSavedQueriesExport } from '@/lib/saved-sql-import-export';
import { getCurrentConnId, subscribeCurrentConnId } from '@/lib/current-conn';
import { listConnections } from '@/lib/localStore';

type CalcResultState = {
  loading?: boolean;
  value?: any;
  error?: string;
  groupRows?: Array<{ name: string; value: any }>;
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

export default function QueriesPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'run'>('run');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sql, setSql] = useState(defaultSql);
  const [vars, setVars] = useState<SavedQueryVariableDef[]>([]);
  const [runValues, setRunValues] = useState<Record<string, any>>({});
  const [dynCols, setDynCols] = useState<DynamicColumnDef[]>([]);
  const [calcItems, setCalcItems] = useState<CalcItemDef[]>([]);
  const [previewSQL, setPreviewSQL] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [gridCols, setGridCols] = useState<string[]>([]);
  const [textResult, setTextResult] = useState<string | null>(null);
  const sqlPreviewRef = useRef<HTMLDivElement | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [pgEnabled, setPgEnabled] = useState(true);
  const [pgSize, setPgSize] = useState(20);
  const [pgPage, setPgPage] = useState(1);
  const [pgTotalRows, setPgTotalRows] = useState<number | null>(null);
  const [pgTotalPages, setPgTotalPages] = useState<number | null>(null);
  const [pgCountLoaded, setPgCountLoaded] = useState(false);
  const [calcResults, setCalcResults] = useState<Record<string, CalcResultState>>({});
  const calcAutoTriggeredRef = useRef<Record<string, boolean>>({});
  const lastExecSignatureRef = useRef<string | null>(null);
  const runtimeCalcItemsRef = useRef<CalcItemDef[]>([]);
  const [explainFormat, setExplainFormat] = useState<'text' | 'json'>('text');
  const [explainAnalyze, setExplainAnalyze] = useState(false);
  const userConnId = useCurrentConnIdState();
  const [connItems, setConnItems] = useState<
    Array<{ id: string; alias: string; host?: string | null }>
  >([]);
  const [extraFolders, setExtraFolders] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('rdv.savedSql.extraFolders');
      if (!raw) return new Set<string>();
      const arr = JSON.parse(raw);
      return new Set<string>(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set<string>();
    }
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('rdv.savedSql.expanded');
      if (!raw) return new Set<string>(['/']);
      return new Set<string>(JSON.parse(raw));
    } catch {
      return new Set<string>(['/']);
    }
  });

  const canSave = useMemo(
    () => name.trim().length > 0 && sql.trim().length > 0,
    [name, sql]
  );

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
    try {
      localStorage.setItem(
        'rdv.savedSql.expanded',
        JSON.stringify(Array.from(expanded))
      );
    } catch {}
  }, [expanded]);

  useEffect(() => {
    try {
      localStorage.setItem(
        'rdv.savedSql.extraFolders',
        JSON.stringify(Array.from(extraFolders))
      );
    } catch {}
  }, [extraFolders]);

  useEffect(() => {
    calcAutoTriggeredRef.current = {};
    lastExecSignatureRef.current = null;
  }, [currentId]);

  useEffect(() => {
    calcAutoTriggeredRef.current = {};
  }, [calcItems]);

  const currentConn = useMemo(() => {
    if (!userConnId) return null;
    return connItems.find((x) => x.id === userConnId) || null;
  }, [connItems, userConnId]);

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

  const onNew = () => {
    setMode('edit');
    setCurrentId(null);
    setName('');
    setDescription('');
    setSql('');
    setVars([]);
    setRunValues({});
    setDynCols([]);
    setCalcItems([]);
    setPreviewSQL('');
    setRows([]);
    setGridCols([]);
    setCalcResults({});
    setTextResult(null);
    setInfo('已切换为新建模式。');
    calcAutoTriggeredRef.current = {};
    lastExecSignatureRef.current = null;
  };

  const loadAndOpen = useCallback(
    async (id: string, focusMode: 'run' | 'edit') => {
      setError(null);
      setInfo(null);
      try {
        const res = await getSavedSql(id);
        if (!res) throw new Error('未找到 Saved SQL');
        setCurrentId(res.id);
        setName(res.name);
        setDescription(res.description ?? '');
        setSql(res.sql);
        const varDefs = res.variables || [];
        setVars(varDefs);
        const defaults: Record<string, any> = {};
        for (const v of varDefs) defaults[v.name] = v.default ?? '';
        setRunValues(defaults);
        setDynCols(res.dynamicColumns || []);
        const normalizedCalcItems = (res.calcItems || []).map((item) => ({
          ...item,
          runMode: item.runMode ?? 'manual',
          kind: item.kind ?? 'single',
        }));
        setCalcItems(normalizedCalcItems);
        setPreviewSQL('');
        setRows([]);
        setGridCols([]);
        setTextResult(null);
        setPgPage(1);
        setPgTotalRows(null);
        setPgTotalPages(null);
        setPgCountLoaded(false);
        setCalcResults({});
        setMode(focusMode);
        calcAutoTriggeredRef.current = {};
        lastExecSignatureRef.current = null;
      } catch (e: any) {
        setError(String(e?.message || e));
      }
    },
    []
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
        notifications.show({
          color: 'teal',
          title: '保存成功',
          message: '已创建 Saved SQL',
          icon: <IconCheck size={16} />,
        });
      } else {
        await updateSavedSql(currentId, payload);
        notifications.show({
          color: 'teal',
          title: '保存成功',
          message: '已更新 Saved SQL',
          icon: <IconCheck size={16} />,
        });
      }
      refresh();
    } catch (e: any) {
      const msg = e instanceof QueryError ? e.message : String(e?.message || e);
      notifications.show({
        color: 'red',
        title: '保存失败',
        message: msg,
        icon: <IconX size={16} />,
      });
      setError(msg);
    }
  };

  const onDelete = async () => {
    if (!currentId) return;
    const ok = window.confirm('确定要归档当前查询吗？');
    if (!ok) return;
    try {
      await archiveSavedSql(currentId);
      setInfo('已归档当前查询');
      refresh();
      onNew();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const onPreview = async (override?: { page?: number; pageSize?: number }) => {
    if (!currentId) {
      setError('请先选择或保存查询再预览。');
      return;
    }
    setIsPreviewing(true);
    setError(null);
    try {
      const res = await previewSavedSql({
        savedId: currentId,
        values: runValues,
      });
      setPreviewSQL(res.previewInline || res.previewText);
      requestAnimationFrame(() => {
        sqlPreviewRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
      setInfo('已生成 SQL 预览');
      if (override?.pageSize) setPgSize(override.pageSize);
      if (override?.page) setPgPage(override.page);
    } catch (e: any) {
      const msg = e instanceof QueryError ? e.message : String(e?.message || e);
      setError(msg);
    } finally {
      setIsPreviewing(false);
    }
  };

  const onExecute = async (override?: {
    page?: number;
    pageSize?: number;
    forceCount?: boolean;
    countOnly?: boolean;
  }) => {
    if (!currentId) {
      setError('请先选择或保存查询后再执行。');
      return;
    }
    if (!userConnId) {
      setError('未设置当前连接，请先在 Connections 选择。');
      return;
    }
    setIsExecuting(true);
    setError(null);
    setInfo(null);
    try {
      const pagination = {
        enabled: pgEnabled,
        page: override?.page ?? pgPage,
        pageSize: override?.pageSize ?? pgSize,
        withCount:
          override?.forceCount || (!pgCountLoaded && pgEnabled) || false,
        countOnly: !!override?.countOnly,
      };
      let res = await executeSavedSql({
        savedId: currentId,
        values: runValues,
        userConnId,
        pagination,
        allowWrite: false,
      });
      if (override?.countOnly) {
        if (res.totalRows != null) {
          setPgTotalRows(res.totalRows);
          setPgTotalPages(res.totalPages ?? null);
          setPgCountLoaded(true);
          setInfo('已刷新计数');
        }
        return;
      }
      setPreviewSQL(res.sql);
      setRows(res.rows);
      setGridCols(res.columns);
      setTextResult(null);
      if (res.page) setPgPage(res.page);
      if (res.pageSize) setPgSize(res.pageSize);
      if (res.totalRows != null) {
        setPgTotalRows(res.totalRows);
        setPgTotalPages(res.totalPages ?? null);
        setPgCountLoaded(true);
      } else if (res.countSkipped) {
        setPgTotalRows(null);
        setPgTotalPages(null);
        setPgCountLoaded(false);
      }

      const resultRows = res.rows;
      const pageSizeForAuto = res.pageSize ?? pagination.pageSize;
      const isPagination = typeof override?.page === 'number';
      if (!isPagination && override?.pageSize === undefined) {
        const signature = JSON.stringify({
          id: currentId ?? '',
          values: runValues,
        });
        if (lastExecSignatureRef.current !== signature) {
          calcAutoTriggeredRef.current = {};
        }
        lastExecSignatureRef.current = signature;
      }

      const autoItems: CalcItemDef[] = [];
      for (const ci of runtimeCalcItemsRef.current) {
        const mode = ci.runMode ?? 'manual';
        if (mode === 'manual') continue;
        if (mode === 'initial') {
          if (isPagination) continue;
          if (calcAutoTriggeredRef.current[ci.name]) continue;
          calcAutoTriggeredRef.current[ci.name] = true;
          autoItems.push(ci);
        } else if (mode === 'always') {
          autoItems.push(ci);
        }
      }
      for (const ci of autoItems) {
        await runCalcItem(ci, {
          source: 'auto',
          rowsOverride: ci.type === 'js' ? resultRows : undefined,
          pageSizeOverride: pageSizeForAuto,
        });
      }
    } catch (e: any) {
      if (e instanceof QueryError && e.code === 'write_requires_confirmation') {
        setPreviewSQL(e.previewInline || '');
        const ok = window.confirm('该 SQL 可能修改数据，是否继续执行？');
        if (!ok) {
          setError('已取消执行。');
        } else {
          try {
            const res2 = await executeSavedSql({
              savedId: currentId,
              values: runValues,
              userConnId,
              pagination: {
                enabled: pgEnabled,
                page: pgPage,
                pageSize: pgSize,
              },
              allowWrite: true,
            });
            setPreviewSQL(res2.sql);
            setRows(res2.rows);
            setGridCols(res2.columns);
            setTextResult(null);
          } catch (ex: any) {
            const msg2 =
              ex instanceof QueryError ? ex.message : String(ex?.message || ex);
            setError(msg2);
          }
        }
      } else {
        const msg =
          e instanceof QueryError ? e.message : String(e?.message || e);
        setError(msg);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const onExplain = async () => {
    if (!currentId) {
      setError('请先选择查询再 Explain。');
      return;
    }
    if (!userConnId) {
      setError('未设置当前连接，请先在 Connections 选择。');
      return;
    }
    setIsExecuting(true);
    setError(null);
    try {
      const res = await explainSavedSql({
        savedId: currentId,
        values: runValues,
        userConnId,
        format: explainFormat,
        analyze: explainAnalyze,
      });
      setPreviewSQL(res.previewInline);
      if (explainFormat === 'json') {
        setTextResult(JSON.stringify(res.rows ?? [], null, 2));
        setRows([]);
        setGridCols([]);
      } else {
        setTextResult(res.text ?? '');
        setRows([]);
        setGridCols([]);
      }
      setInfo('Explain 完成');
    } catch (e: any) {
      const msg = e instanceof QueryError ? e.message : String(e?.message || e);
      setError(msg);
    } finally {
      setIsExecuting(false);
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
        const overwrite = window.confirm(
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
    const base: CalcItemDef[] = [];
    if (pgEnabled) {
      base.push({
        name: '__total_count__',
        type: 'sql',
        code: 'select count(*)::bigint as total from ({{_sql}}) t',
        runMode: 'manual',
        kind: 'single',
      });
    }
    return [
      ...base,
      ...calcItems.map((ci) => ({
        ...ci,
        runMode: ci.runMode ?? 'manual',
        kind: ci.kind ?? 'single',
      })),
    ];
  }, [calcItems, pgEnabled]);

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
      const key = ci.name;
      const variant = (ci.kind ?? 'single') as 'single' | 'group';
      const effectiveRows = opts?.rowsOverride ?? rows;
      const pageSizeForCount = opts?.pageSizeOverride ?? pgSize;
      setCalcResults((s) => ({
        ...s,
        [key]: {
          ...s[key],
          loading: true,
          error: undefined,
          groupRows: variant === 'group' ? undefined : s[key]?.groupRows,
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
            setCalcResults((s) => ({
              ...s,
              [key]: { value: num, loading: false },
            }));
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
            setCalcResults((s) => ({
              ...s,
              [key]: {
                value: groupRows,
                groupRows,
                loading: false,
              },
            }));
          } else {
            let display: any = null;
            if (rowsRes.length === 0) display = null;
            else if (rowsRes.length === 1) {
              const cols = res.columns?.length
                ? res.columns
                : Object.keys(rowsRes[0] || {});
              display = cols.length === 1 ? (rowsRes[0] as any)[cols[0] as any] : rowsRes[0];
            } else display = rowsRes;
            setCalcResults((s) => ({
              ...s,
              [key]: { value: display, loading: false, groupRows: undefined },
            }));
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
          setCalcResults((s) => ({
            ...s,
            [key]: { value: val, loading: false, groupRows: undefined },
          }));
        }
      } catch (e: any) {
        const msg = e instanceof QueryError ? e.message : String(e?.message || e);
        setCalcResults((s) => ({
          ...s,
          [key]: { ...s[key], error: msg, loading: false, groupRows: undefined },
        }));
      }
    },
    [currentId, userConnId, runValues, rows, pgSize, onUpdateTotals]
  );

  return (
    <Stack gap="md" style={{ position: 'relative', height: '100%' }}>
      <LoadingOverlay
        visible={!!busy}
        zIndex={999}
        overlayProps={{ blur: 2 }}
        loaderProps={{ children: busy || '处理中...' }}
      />
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
          onExportAll={onExportAll}
          onImportFile={onImportFile}
          busy={busy}
          onOpenItemRun={(it) => loadAndOpen(it.id, 'run')}
          onOpenItemEdit={(it) => loadAndOpen(it.id, 'edit')}
          onDeleteItem={async (it) => {
            const ok = window.confirm(`确认归档“${it.name}”？`);
            if (!ok) return;
            try {
              await archiveSavedSql(it.id);
              setInfo(`已归档 ${it.name}`);
              refresh();
            } catch (e: any) {
              setError(String(e?.message || e));
            }
          }}
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
            ) : (
              <RunQueryPanel
                userConnId={userConnId}
                currentConn={currentConn}
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
                runtimeCalcItems={runtimeCalcItems}
                calcResults={calcResults}
                onRunCalc={(ci) => runCalcItem(ci)}
                onUpdateTotal={onUpdateTotals}
              />
            )}
          </Stack>
        </ScrollArea>
      </Group>
    </Stack>
  );
}
