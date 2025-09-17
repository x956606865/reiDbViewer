'use client';

import React, {
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Button,
  Code,
  LoadingOverlay,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import type {
  SavedQueryVariableDef,
  DynamicColumnDef,
  CalcItemDef,
} from '@rei-db-view/types/appdb';
import type { SavedItem, TreeNode } from '../../components/queries/types';
import { EditQueryPanel } from '../../components/queries/EditQueryPanel';
import { RunQueryPanel } from '../../components/queries/RunQueryPanel';
import { useCurrentConnId } from '@/lib/current-conn';
import { SavedQueriesSidebar } from '../../components/queries/SavedQueriesSidebar';
import { buildSavedTree } from '../../components/queries/tree-utils';
import {
  parseSavedQueriesExport,
  normalizeImportItems,
} from '@/lib/saved-sql-import-export';
import { emitQueryExecutingEvent } from '@rei-db-view/types/events';

type CalcResultState = {
  loading?: boolean;
  value?: any;
  error?: string;
  groupRows?: Array<{ name: string; value: any }>;
};

export default function SavedQueriesPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [suggestedSQL, setSuggestedSQL] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // file import handled in SavedQueriesSidebar

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sql, setSql] = useState(
    'SELECT * FROM users WHERE id = {{user_id}} LIMIT 10'
  );
  const [vars, setVars] = useState<SavedQueryVariableDef[]>([
    {
      name: 'user_id',
      type: 'number',
      label: '用户ID',
      required: true,
      default: 1,
    },
  ]);

  const [runValues, setRunValues] = useState<Record<string, any>>({
    user_id: 1,
  });
  const [userConnId] = useCurrentConnId();

  const [previewSQL, setPreviewSQL] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [gridCols, setGridCols] = useState<string[]>([]);
  const [textResult, setTextResult] = useState<string | null>(null);
  const [dynCols, setDynCols] = useState<DynamicColumnDef[]>([]);
  const [calcItems, setCalcItems] = useState<CalcItemDef[]>([]);
  const [mode, setMode] = useState<'edit' | 'run'>('run');
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  useEffect(() => {
    emitQueryExecutingEvent(isExecuting, 'web/queries');
    return () => {
      if (isExecuting) emitQueryExecutingEvent(false, 'web/queries');
    };
  }, [isExecuting]);
  const [calcResults, setCalcResults] = useState<Record<string, CalcResultState>>({});
  // explain options
  const [explainFormat, setExplainFormat] = useState<'text' | 'json'>('text');
  const [explainAnalyze, setExplainAnalyze] = useState<boolean>(false);
  // pagination state (runtime only; not saved into query definition)
  const [pgEnabled, setPgEnabled] = useState(true);
  const [pgCountLoaded, setPgCountLoaded] = useState(false);
  const [pgPage, setPgPage] = useState(1);
  const [pgSize, setPgSize] = useState(20);
  const [pgTotalRows, setPgTotalRows] = useState<number | null>(null);
  const [pgTotalPages, setPgTotalPages] = useState<number | null>(null);
  const runtimeCalcItems = useMemo(() => {
    const base: CalcItemDef[] = [];
    if (pgEnabled)
      base.push({
        name: '__total_count__',
        type: 'sql',
        code: 'select count(*)::bigint as total from ({{_sql}}) t',
        runMode: 'manual',
        kind: 'single',
      });
    return [
      ...base,
      ...calcItems.map((ci) => ({
        ...ci,
        runMode: ci.runMode ?? 'manual',
        kind: ci.kind ?? 'single',
      })),
    ];
  }, [calcItems, pgEnabled]);
  const sqlPreviewRef = React.useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    fetch('/api/user/connections', { cache: 'no-store' })
      .then(async (r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => setConnItems(Array.isArray(j.items) ? j.items : []))
      .catch(() => {});
  }, []);

  const currentConnLabel = useMemo(() => {
    if (!userConnId) return '';
    const it = connItems.find((x) => x.id === userConnId);
    if (!it) return userConnId;
    return it.host ? `${it.alias} (${it.host})` : it.alias;
  }, [connItems, userConnId]);
  const currentConn = useMemo(() => {
    if (!userConnId)
      return null as null | { id: string; alias: string; host?: string | null };
    return connItems.find((x) => x.id === userConnId) || null;
  }, [connItems, userConnId]);
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

  const refresh = useCallback(() => {
    setError(null);
    setInfo(null);
    setSuggestedSQL(null);
    fetch('/api/user/saved-sql', { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.status === 501 && j?.suggestedSQL) {
          setSuggestedSQL(j.suggestedSQL);
          throw new Error('功能未初始化：请在 APP_DB 执行建表 SQL 后重试。');
        }
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        setItems(j.items || []);
      })
      .catch((e) => setError(String(e?.message || e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  // 连接切换后，清空预览与结果，避免误会
  useEffect(() => {
    setPreviewSQL('');
    setRows([]);
    setGridCols([]);
    setTextResult(null);
  }, [userConnId]);

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

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onExplain = async () => {
    setError(null);
    setInfo(null);
    setIsExecuting(true);
    try {
      if (!currentId)
        throw new Error('请先从列表选择一条或保存新查询后再执行。');
      if (!userConnId)
        throw new Error('未设置当前连接，请先到 Connections 选择。');
      const res = await fetch('/api/saved-sql/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          savedQueryId: currentId,
          values: runValues,
          userConnId,
          format: explainFormat,
          analyze: !!explainAnalyze,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j?.error === 'analyze_requires_readonly') {
          throw new Error('ANALYZE 需要只读 SQL。当前 SQL 可能包含写操作。');
        }
        if (j?.error === 'vars_missing' && Array.isArray(j?.missing)) {
          throw new Error(
            `SQL 中存在未定义的变量：${j.missing.join(
              ', '
            )}。请在“编辑”页删除对应占位符，或点击“提取变量”重新加入变量定义后再试。`
          );
        }
        throw new Error(j?.error || `Explain 失败（HTTP ${res.status}）`);
      }
      setPreviewSQL(j?.previewInline || '');
      if (explainFormat === 'json')
        setTextResult(JSON.stringify(j?.rows ?? j, null, 2));
      else setTextResult(typeof j?.text === 'string' ? j.text : '');
      setRows([]);
      setGridCols([]);
      setPgTotalRows(null);
      setPgTotalPages(null);
      setPgCountLoaded(false);
      setInfo('Explain 完成');
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setIsExecuting(false);
    }
  };

  // ---------- 导出 / 导入 ----------
  const onExportAll = useCallback(async () => {
    try {
      if (items.length === 0) {
        setInfo('暂无可导出的查询。');
        return;
      }
      setBusy('导出中...');
      const details: Array<{
        name: string;
        description?: string | null;
        sql: string;
        variables: any[];
        dynamicColumns?: any[];
        calcItems?: any[];
      }> = [];
      for (const it of items) {
        const r = await fetch(`/api/user/saved-sql/${it.id}`, {
          cache: 'no-store',
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.error)
          throw new Error(j?.error || `导出失败：读取 ${it.name} 失败`);
        details.push({
          name: j.name,
          description: j.description ?? null,
          sql: j.sql,
          variables: Array.isArray(j.variables) ? j.variables : [],
          dynamicColumns: Array.isArray(j.dynamicColumns)
            ? j.dynamicColumns
            : [],
          calcItems: Array.isArray(j.calcItems) ? j.calcItems : [],
        });
      }
      const payload = {
        version: 'rdv.saved-sql.v1',
        exportedAt: new Date().toISOString(),
        items: details,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const ts = new Date()
        .toISOString()
        .replace(/[:T]/g, '-')
        .replace(/\..+$/, '');
      const fname = `saved-queries-${ts}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setInfo(`已导出 ${details.length} 条到 ${fname}`);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }, [items]);

  // import click handled in SavedQueriesSidebar

  const onImportFile = useCallback(
    async (file: File) => {
      setError(null);
      setInfo(null);
      setBusy('导入中...');
      try {
        const text = await file.text();
        const parsed = parseSavedQueriesExport(text);
        if (!parsed.ok) throw new Error(`文件格式不正确：${parsed.error}`);
        const itemsToImport = normalizeImportItems(parsed.data);
        if (itemsToImport.length === 0) {
          setInfo('文件为空，无需导入。');
          return;
        }
        const overwrite = window.confirm(
          '导入：若遇到同名查询，是否覆盖？\n确定=覆盖，取消=跳过重名'
        );
        let okCount = 0,
          skipCount = 0,
          overwriteCount = 0;
        for (const it of itemsToImport) {
          const res = await fetch('/api/user/saved-sql', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: it.name,
              description: it.description ?? undefined,
              sql: it.sql,
              variables: it.variables,
              dynamicColumns: it.dynamicColumns || [],
              calcItems: it.calcItems || [],
            }),
          });
          const j = await res.json().catch(() => ({}));
          if (res.status === 501 && j?.suggestedSQL) {
            setSuggestedSQL(j.suggestedSQL);
            throw new Error(
              '功能未初始化：请先在 APP_DB 执行建表/ALTER SQL 后重试。'
            );
          }
          if (
            res.status === 409 &&
            j?.error === 'name_exists' &&
            j?.existingId
          ) {
            if (overwrite) {
              const res2 = await fetch(`/api/user/saved-sql/${j.existingId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  name: it.name,
                  description: it.description ?? null,
                  sql: it.sql,
                  variables: it.variables,
                  dynamicColumns: it.dynamicColumns || [],
                  calcItems: it.calcItems || [],
                }),
              });
              if (!res2.ok) throw new Error(`覆盖失败：${it.name}`);
              overwriteCount++;
            } else {
              skipCount++;
            }
          } else if (!res.ok) {
            throw new Error(
              j?.error || `导入失败（HTTP ${res.status}）：${it.name}`
            );
          } else {
            okCount++;
          }
        }
        setInfo(
          `导入完成：新增 ${okCount}，覆盖 ${overwriteCount}，跳过 ${skipCount}`
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

  const tree = useMemo(
    () => buildSavedTree(items, extraFolders),
    [items, extraFolders]
  );

  const onDetectVars = () => {
    try {
      const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
      const found = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql))) {
        if (m[1]) found.add(m[1]!);
      }
      const newVars: SavedQueryVariableDef[] = [...found].map((name) => {
        const exists = vars.find((v) => v.name === name);
        return exists || { name, type: 'text', required: false };
      });
      setVars(newVars);
      // 同步运行值（新变量用其默认值或空，丢弃已删除变量）
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
  const onRemoveVar = (name: string) => {
    setVars((vs) => vs.filter((v) => v.name !== name));
    setRunValues((rv) => {
      const { [name]: _, ...rest } = rv;
      return rest;
    });
  };

  const onNew = () => {
    setCurrentId(null);
    setName('');
    setDescription('');
    setSql('');
    setVars([]);
    setDynCols([]);
    setCalcItems([]);
    setRunValues({});
    setPreviewSQL('');
    setRows([]);
    setGridCols([]);
    setInfo('已切换为新建模式。');
    setMode('edit');
  };

  const onSave = async () => {
    setError(null);
    setInfo(null);
    try {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('名称不能为空');
      const body = {
        name: trimmed,
        description: description.trim() || undefined,
        sql,
        variables: vars,
        dynamicColumns: dynCols,
        calcItems,
      };

      // 选择目标：优先当前编辑项；若与其他同名则提示“覆盖”并以对方 id 作为目标
      const same = items.find(
        (it) => it.name === trimmed && it.id !== currentId
      );
      let targetId: string | null = currentId || null;
      if (!targetId && same) {
        const ok = window.confirm(
          `已存在同名查询“${trimmed}”。继续将覆盖该查询的内容，是否确认？`
        );
        if (!ok) return;
        targetId = same.id;
      }

      let res: Response;
      if (targetId) {
        // 更新
        res = await fetch(`/api/user/saved-sql/${targetId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        // 新建
        res = await fetch('/api/user/saved-sql', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      const j = await res.json().catch(() => ({}));
      if (res.status === 501 && j?.suggestedSQL) {
        setSuggestedSQL(j.suggestedSQL);
        const msg = '功能未初始化：请先在 APP_DB 执行建表 SQL。';
        notifications.show({
          color: 'red',
          title: '保存失败',
          message: msg,
          icon: <IconX size={16} />,
        });
        throw new Error(msg);
      }
      if (res.status === 409 && j?.error === 'name_exists' && j?.existingId) {
        const ok2 = window.confirm('同名查询已存在。是否覆盖该查询？');
        if (!ok2) return;
        // 覆盖到 existingId
        const res2 = await fetch(`/api/user/saved-sql/${j.existingId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j2 = await res2.json().catch(() => ({}));
        if (!res2.ok) {
          const em = j2?.error || `保存失败（HTTP ${res2.status}）`;
          notifications.show({
            color: 'red',
            title: '保存失败',
            message: em,
            icon: <IconX size={16} />,
          });
          throw new Error(em);
        }
        // 若本次原本在编辑另一条（targetId）且与 existingId 不同，则将原条目标记为归档，避免重名重复
        if (targetId && targetId !== j.existingId) {
          await fetch(`/api/user/saved-sql/${targetId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ isArchived: true }),
          }).catch(() => {});
        }
        setInfo('已覆盖保存。');
        notifications.show({
          color: 'teal',
          title: '保存成功',
          message: '已覆盖保存。',
          icon: <IconCheck size={16} />,
        });
        setCurrentId(j.existingId);
        refresh();
        onSelectSaved(j.existingId);
        return;
      }
      if (!res.ok) {
        const em = j?.error || `保存失败（HTTP ${res.status}）`;
        notifications.show({
          color: 'red',
          title: '保存失败',
          message: em,
          icon: <IconX size={16} />,
        });
        throw new Error(em);
      }

      if (j?.id) {
        setCurrentId(j.id);
        setInfo('已保存。');
        notifications.show({
          color: 'teal',
          title: '保存成功',
          message: `已创建：${trimmed}`,
          icon: <IconCheck size={16} />,
        });
        refresh();
        onSelectSaved(j.id);
      } else {
        setInfo('已保存。');
        notifications.show({
          color: 'teal',
          title: '保存成功',
          message: `已更新：${trimmed}`,
          icon: <IconCheck size={16} />,
        });
        refresh();
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      setError(msg);
      if (!/保存失败/.test(msg) && !/功能未初始化/.test(msg)) {
        // 若上面分支尚未弹过，则这里兜底弹一次
        notifications.show({
          color: 'red',
          title: '保存失败',
          message: msg,
          icon: <IconX size={16} />,
        });
      }
    }
  };

  const onSaveAs = async () => {
    // 忽略 currentId，强制按“新建”流程保存（同名仍会触发覆盖确认）
    const prevId = currentId;
    setCurrentId(null);
    await onSave();
    // 若保存失败，可考虑恢复 prevId（此处省略，错误时不会更改 currentId）
    if (prevId) {
      // no-op
    }
  };

  const clearEditor = () => {
    setCurrentId(null);
    setName('');
    setDescription('');
    setSql('');
    setVars([]);
    setDynCols([]);
    setCalcItems([]);
    setRunValues({});
    setPreviewSQL('');
    setRows([]);
    setGridCols([]);
  };

  const onDelete = async () => {
    if (!currentId) return;
    const ok = window.confirm('删除后不可恢复，是否确认删除当前查询？');
    if (!ok) return;
    try {
      const id = currentId;
      const res = await fetch(`/api/user/saved-sql/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isArchived: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(j?.error || `删除失败（HTTP ${res.status}）`);
      // 乐观刷新：本地先移除，再触发远端拉取
      setItems((prev) => prev.filter((x) => x.id !== id));
      clearEditor();
      setInfo('已删除。');
      refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const onDeleteById = async (id: string, nameHint?: string) => {
    const ok = window.confirm(
      `确认删除「${nameHint || id}」？删除后不可恢复。`
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/user/saved-sql/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isArchived: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(j?.error || `删除失败（HTTP ${res.status}）`);
      setItems((prev) => prev.filter((x) => x.id !== id));
      if (currentId === id) clearEditor();
      setInfo('已删除。');
      refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const onPreview = async (override?: { page?: number; pageSize?: number }) => {
    setError(null);
    setInfo(null);
    if (!currentId) {
      setError('请先从列表选择一条或保存新查询后再预览/执行。');
      return;
    }
    setIsPreviewing(true);
    try {
      const res = await fetch('/api/saved-sql/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 预览无需连接
        body: JSON.stringify({
          savedQueryId: currentId,
          values: runValues,
          previewOnly: true,
          pagination: {
            enabled: pgEnabled,
            page: override?.page ?? pgPage,
            pageSize: override?.pageSize ?? pgSize,
          },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j?.error === 'vars_missing' && Array.isArray(j?.missing)) {
          throw new Error(
            `SQL 中存在未定义的变量：${j.missing.join(
              ', '
            )}。请在“编辑”页删除对应占位符，或点击“提取变量”重新加入变量定义后再试。`
          );
        }
        throw new Error(j?.error || `预览失败（HTTP ${res.status}）`);
      }
      setPreviewSQL(j?.previewInline || j?.preview?.text || '');
      setInfo('已生成 SQL 预览');
      // 平滑滚动到 SQL 预览区域
      requestAnimationFrame(() => {
        sqlPreviewRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    } catch (e: any) {
      setError(String(e?.message || e));
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
    setError(null);
    setInfo(null);
    setIsExecuting(true);
    try {
      if (!currentId)
        throw new Error('请先从列表选择一条或保存新查询后再执行。');
      if (!userConnId)
        throw new Error('未设置当前连接，请先到 Connections 选择。');
      const res = await fetch('/api/saved-sql/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          savedQueryId: currentId,
          values: runValues,
          userConnId,
          pagination: {
            enabled: pgEnabled,
            page: override?.page ?? pgPage,
            pageSize: override?.pageSize ?? pgSize,
            withCount:
              override?.forceCount || (pgEnabled && !pgCountLoaded) || false,
            countOnly: !!override?.countOnly,
          },
        }),
      });
      let j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j?.error === 'write_requires_confirmation') {
          if (j?.previewInline) setPreviewSQL(j.previewInline);
          const ok = window.confirm(
            '该 SQL 可能会修改数据库中的数据。\n是否确认继续执行？'
          );
          if (!ok) throw new Error('已取消执行。');
          const res2 = await fetch('/api/saved-sql/execute', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              savedQueryId: currentId,
              values: runValues,
              userConnId,
              allowWrite: true,
              pagination: {
                enabled: pgEnabled,
                page: override?.page ?? pgPage,
                pageSize: override?.pageSize ?? pgSize,
                withCount: false,
                countOnly: false,
              },
            }),
          });
          j = await res2.json().catch(() => ({}));
          if (!res2.ok)
            throw new Error(j?.error || `执行失败（HTTP ${res2.status}）`);
        } else if (j?.error === 'vars_missing' && Array.isArray(j?.missing)) {
          throw new Error(
            `SQL 中存在未定义的变量：${j.missing.join(
              ', '
            )}。请在“编辑”页删除对应占位符，或点击“提取变量”重新加入变量定义后再试。`
          );
        } else {
          throw new Error(j?.error || `执行失败（HTTP ${res.status}）`);
        }
      }
      if (!override?.countOnly) setPreviewSQL(j.sql || '');
      // 默认清空文本结果；若随后判定为文本，将再设置
      setTextResult(null);
      let cols: string[] = Array.isArray(j.columns)
        ? j.columns
        : Object.keys(j.rows?.[0] ?? {});
      let data: Array<Record<string, unknown>> = j.rows || [];

      // apply dynamic columns on client (supports manual trigger)
      if (dynCols.length > 0 && Array.isArray(data)) {
        const helpers = {
          fmtDate: (v: any) => (v ? new Date(v).toISOString() : ''),
          json: (v: any) => JSON.stringify(v),
        };
        const usedNames = new Set(cols);
        const nameMap = new Map<string, string>(); // original->unique
        const compiledAutoFns = new Map<string, Function>();
        for (const dc of dynCols) {
          let nm = dc.name;
          let k = 1;
          while (usedNames.has(nm)) {
            nm = `${dc.name}_${++k}`;
          }
          usedNames.add(nm);
          nameMap.set(dc.name, nm);
          if (!dc.manualTrigger) {
            try {
              // eslint-disable-next-line no-new-func
              const fn = new Function(
                'row',
                'vars',
                'helpers',
                `"use strict"; return ( ${dc.code} )(row, vars, helpers)`
              ) as any;
              compiledAutoFns.set(dc.name, fn);
            } catch (e) {
              compiledAutoFns.set(
                dc.name,
                () => `#ERR: ${String((e as any)?.message || e)}`
              );
            }
          }
        }
        cols = Array.from(usedNames);
        data = data.map((row: any, rowIdx: number) => {
          const out: Record<string, any> = { ...row };
          for (const dc of dynCols) {
            const unique = nameMap.get(dc.name) || dc.name;
            if (dc.manualTrigger) {
              out[unique] = (
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => {
                    setRows((prev) => {
                      const next = [...prev];
                      const curr = { ...(next[rowIdx] || {}) } as any;
                      try {
                        // eslint-disable-next-line no-new-func
                        const fn = new Function(
                          'row',
                          'vars',
                          'helpers',
                          `"use strict"; return ( ${dc.code} )(row, vars, helpers)`
                        ) as any;
                        curr[unique] = fn(curr, runValues, helpers);
                      } catch (e: any) {
                        curr[unique] = `#ERR: ${String(e?.message || e)}`;
                      }
                      next[rowIdx] = curr;
                      return next;
                    });
                  }}
                >
                  计算
                </Button>
              );
            } else {
              try {
                const fn = compiledAutoFns.get(dc.name);
                out[unique] = fn ? fn(row, runValues, helpers) : undefined;
              } catch (e: any) {
                out[unique] = `#ERR: ${String(e?.message || e)}`;
              }
            }
          }
          return out;
        });
      }

      // 若仅刷新总数，避免触碰数据表格
      if (!override?.countOnly) {
        if (Array.isArray(data) && data.length > 0) {
          setGridCols(cols);
          setRows(data);
          setTextResult(null);
        } else {
          const msg =
            typeof j?.message === 'string'
              ? j.message
              : j?.command
              ? `${j.command}${
                  typeof j?.rowCount === 'number' ? ' ' + j.rowCount : ''
                }`
              : '';
          if (msg) {
            setTextResult(msg);
            setGridCols([]);
            setRows([]);
          } else {
            setGridCols(cols);
            setRows(data);
          }
        }
      }
      if (pgEnabled) {
        const newPage = j.page || 1;
        const newSize = j.pageSize || pgSize;
        const newTotalRows =
          typeof j.totalRows === 'number' ? j.totalRows : pgTotalRows;
        const newTotalPages =
          typeof j.totalPages === 'number'
            ? j.totalPages
            : typeof newTotalRows === 'number'
            ? Math.max(1, Math.ceil(newTotalRows / newSize))
            : null;
        setPgPage(newPage);
        setPgSize(newSize);
        setPgTotalRows(
          typeof j.totalRows === 'number' ? j.totalRows : pgTotalRows
        );
        setPgTotalPages(newTotalPages);
        if (typeof j.totalRows === 'number' || j?.countSkipped)
          setPgCountLoaded(true);
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setIsExecuting(false);
    }
  };

  const onSelectSaved = (id: string) => {
    setCurrentId(id);
    setPgPage(1);
    setPgTotalRows(null);
    setPgTotalPages(null);
    setTextResult(null);
    setCalcResults({});
    // fetch details
    setError(null);
    fetch(`/api/user/saved-sql/${id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.error) throw new Error(j.error);
        setName(j.name || '');
        setDescription(j.description || '');
        setSql(j.sql || '');
        setVars(Array.isArray(j.variables) ? j.variables : []);
        setDynCols(Array.isArray(j.dynamicColumns) ? j.dynamicColumns : []);
        setCalcItems(
          Array.isArray(j.calcItems)
            ? j.calcItems.map((item: CalcItemDef) => ({
                ...item,
                runMode: item.runMode ?? 'manual',
                kind: item.kind ?? 'single',
              }))
            : []
        );
        const initVals: Record<string, any> = {};
        for (const v of j.variables || []) initVals[v.name] = v.default ?? '';
        setRunValues(initVals); // 载入时用默认值初始化运行值
      })
      .catch((e) => setError(String(e?.message || e)));
  };
  const onOpenItemRun = (it: SavedItem) => {
    onSelectSaved(it.id);
    setMode('run');
  };
  const onOpenItemEdit = (it: SavedItem) => {
    onSelectSaved(it.id);
    setMode('edit');
  };

  return (
    <Stack gap="md">
      <div>
        <Title order={3}>常用 SQL</Title>
        <Text c="dimmed">保存含变量的只读查询；运行前按表单填参。</Text>
        {error && (
          <Text c="red" mt="xs">
            {error}
          </Text>
        )}
        {info && (
          <Text c="green" mt="xs">
            {info}
          </Text>
        )}
      </div>

      {suggestedSQL && (
        <Paper withBorder p="md">
          <Title order={4}>初始化建表 SQL</Title>
          <Text c="dimmed" size="sm">
            请复制到 APP_DB 执行完成后刷新本页。
          </Text>
          <ScrollArea h={220} mt="xs">
            <Code block>{suggestedSQL}</Code>
          </ScrollArea>
        </Paper>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <SavedQueriesSidebar
          items={items}
          expanded={expanded}
          onToggleFolder={toggleFolder}
          extraFolders={extraFolders}
          onCreateFolder={(norm) => {
            setExpanded((s) => new Set([...Array.from(s), norm]));
            setExtraFolders((prev) => new Set([...Array.from(prev), norm]));
            setInfo(`已创建文件夹：${norm}（本地）`);
            setMode('edit');
            setName(`${norm}/`);
          }}
          onNewQuery={() => {
            setMode('edit');
            onNew();
          }}
          onExportAll={onExportAll}
          onImportFile={onImportFile}
          busy={busy}
          onOpenItemRun={onOpenItemRun}
          onOpenItemEdit={onOpenItemEdit}
          onDeleteItem={(it) => onDeleteById(it.id, it.name)}
        />

        {/* 关键：在 Flex 布局下为可伸缩列设置 minWidth: 0，
            避免内容（如表格/代码块）撑破父容器导致整页出现横向滚动。*/}
        <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
          <LoadingOverlay
            visible={!!busy}
            zIndex={1000}
            overlayProps={{ blur: 1 }}
          />
          {mode === 'edit' ? (
            <EditQueryPanel
              name={name}
              setName={setName}
              description={description}
              setDescription={setDescription}
              canSave={canSave}
              onSave={onSave}
              onSaveAs={onSaveAs}
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
              setPgEnabled={setPgEnabled}
              pgSize={pgSize}
              setPgSize={setPgSize}
              pgPage={pgPage}
              setPgPage={setPgPage}
              pgTotalRows={pgTotalRows}
              pgTotalPages={pgTotalPages}
              onResetCounters={() => {
                setPgTotalRows(null);
                setPgTotalPages(null);
                setPgCountLoaded(false);
              }}
              onPreview={() => onPreview()}
              onExecute={(override) => onExecute(override)}
              onExplain={() => onExplain()}
              isExecuting={isExecuting}
              explainFormat={explainFormat}
              setExplainFormat={setExplainFormat}
              explainAnalyze={explainAnalyze}
              setExplainAnalyze={setExplainAnalyze}
              sqlPreviewRef={sqlPreviewRef as RefObject<HTMLDivElement>}
              isPreviewing={isPreviewing}
              previewSQL={previewSQL}
              textResult={textResult}
              gridCols={gridCols}
              rows={rows}
              runtimeCalcItems={runtimeCalcItems}
              calcResults={calcResults}
              setCalcResults={setCalcResults}
              currentId={currentId}
              onUpdateTotal={(totalRows, totalPages) => {
                setPgTotalRows(totalRows);
                setPgTotalPages(totalPages);
                setPgCountLoaded(true);
              }}
            />
          )}
        </Stack>
      </div>
    </Stack>
  );
}

// Tree moved to components/queries/Tree
