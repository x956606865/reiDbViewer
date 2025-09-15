'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Code,
  Group,
  LoadingOverlay,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  TagsInput,
  Tooltip,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconPlus,
  IconTrash,
  IconScan,
  IconChevronRight,
  IconChevronDown,
  IconFolder,
  IconFileText,
  IconPencil,
  IconHelpCircle,
  IconCheck,
  IconX,
  IconRefresh,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import type {
  SavedQueryVariableDef,
  DynamicColumnDef,
  CalcItemDef,
} from '@rei-db-view/types/appdb';
import type { SavedItem, TreeNode } from '../../components/queries/types';
import { DataGrid } from '../../components/DataGrid';
import { LeftDrawer } from '../../components/LeftDrawer';
import { Tree } from '../../components/queries/Tree';
import { SqlEditor } from '../../components/queries/SqlEditor';
import { VariablesEditor } from '../../components/queries/VariablesEditor';
import { DynamicColumnsEditor } from '../../components/queries/DynamicColumnsEditor';
import { CalcItemsEditor } from '../../components/queries/CalcItemsEditor';
import { PaginationSettings } from '../../components/queries/PaginationSettings';
import { RunActionsBar } from '../../components/queries/RunActionsBar';
import { SqlPreviewPanel } from '../../components/queries/SqlPreviewPanel';
import { RuntimeCalcCards } from '../../components/queries/RuntimeCalcCards';
import { PaginationBar } from '../../components/queries/PaginationBar';
import { ResultsPanel } from '../../components/queries/ResultsPanel';
import { RunParamsPanel } from '../../components/queries/RunParamsPanel';
import { useCurrentConnId } from '@/lib/current-conn';
import {
  parseSavedQueriesExport,
  normalizeImportItems,
} from '@/lib/saved-sql-import-export';

// Types moved to components/queries/types

const VAR_TYPES: Array<{
  value: SavedQueryVariableDef['type'];
  label: string;
}> = [
  { value: 'text', label: 'text' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'date', label: 'date' },
  { value: 'timestamp', label: 'timestamp' },
  { value: 'json', label: 'json' },
  { value: 'uuid', label: 'uuid' },
  { value: 'raw', label: 'raw' },
  { value: 'enum', label: 'enum' },
];

export default function SavedQueriesPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [suggestedSQL, setSuggestedSQL] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
  const [calcResults, setCalcResults] = useState<
    Record<string, { loading?: boolean; value?: any; error?: string }>
  >({});
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
    const items: CalcItemDef[] = []
    if (pgEnabled) items.push({ name: '__total_count__', type: 'sql', code: 'select count(*)::bigint as total from ({{_sql}}) t' })
    return [...items, ...calcItems]
  }, [calcItems, pgEnabled])
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

  const onImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

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
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [refresh]
  );

  const buildTree = (list: SavedItem[]): TreeNode => {
    const root: TreeNode = {
      type: 'folder',
      name: '',
      path: '/',
      children: [],
    };
    const ensureFolder = (segments: string[]): TreeNode => {
      let node = root;
      let p = '';
      for (const seg of segments) {
        p = p ? `${p}/${seg}` : seg;
        let child = node.children!.find(
          (c) => c.type === 'folder' && c.name === seg
        );
        if (!child) {
          child = { type: 'folder', name: seg, path: p, children: [] };
          node.children!.push(child);
        }
        node = child;
      }
      return node;
    };
    for (const it of list) {
      const parts = it.name.split('/').filter(Boolean);
      if (parts.length <= 1) {
        root.children!.push({
          type: 'item',
          name: it.name,
          path: it.name,
          item: it,
        });
      } else {
        const leaf = parts[parts.length - 1]!;
        const folder = ensureFolder(parts.slice(0, -1));
        folder.children!.push({
          type: 'item',
          name: leaf,
          path: it.name,
          item: it,
        });
      }
    }
    // inject extra (virtual) folders so they appear even when empty
    for (const f of Array.from(extraFolders)) {
      const segs = f.split('/').filter(Boolean);
      if (segs.length > 0) ensureFolder(segs);
    }
    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const n of nodes) if (n.children) sortNodes(n.children);
    };
    sortNodes(root.children!);
    return root;
  };

  const tree = useMemo(() => buildTree(items), [items]);

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
        const msg = '功能未初始化：请先在 APP_DB 执行建表 SQL。'
        notifications.show({ color: 'red', title: '保存失败', message: msg, icon: <IconX size={16} /> })
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
          const em = j2?.error || `保存失败（HTTP ${res2.status}）`
          notifications.show({ color: 'red', title: '保存失败', message: em, icon: <IconX size={16} /> })
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
        notifications.show({ color: 'teal', title: '保存成功', message: '已覆盖保存。', icon: <IconCheck size={16} /> })
        setCurrentId(j.existingId);
        refresh();
        onSelectSaved(j.existingId);
        return;
      }
      if (!res.ok) {
        const em = j?.error || `保存失败（HTTP ${res.status}）`
        notifications.show({ color: 'red', title: '保存失败', message: em, icon: <IconX size={16} /> })
        throw new Error(em);
      }

      if (j?.id) {
        setCurrentId(j.id);
        setInfo('已保存。');
        notifications.show({ color: 'teal', title: '保存成功', message: `已创建：${trimmed}`, icon: <IconCheck size={16} /> })
        refresh();
        onSelectSaved(j.id);
      } else {
        setInfo('已保存。');
        notifications.show({ color: 'teal', title: '保存成功', message: `已更新：${trimmed}`, icon: <IconCheck size={16} /> })
        refresh();
      }
    } catch (e: any) {
      const msg = String(e?.message || e)
      setError(msg);
      if (!/保存失败/.test(msg) && !/功能未初始化/.test(msg)) {
        // 若上面分支尚未弹过，则这里兜底弹一次
        notifications.show({ color: 'red', title: '保存失败', message: msg, icon: <IconX size={16} /> })
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
        setCalcItems(Array.isArray(j.calcItems) ? j.calcItems : []);
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
        <LeftDrawer title="我的查询">
          <Group mt="xs" gap="xs">
            <Button
              size="xs"
              variant="light"
              onClick={() => {
                const p = prompt('新建文件夹路径（用/分隔，如 reports/daily）');
                if (p) {
                  const norm = p.split('/').filter(Boolean).join('/');
                  if (!norm) return;
                  setExpanded((s) => new Set([...Array.from(s), norm]));
                  setExtraFolders(
                    (prev) => new Set([...Array.from(prev), norm])
                  );
                  setInfo(`已创建文件夹：${norm}（本地）`);
                  setMode('edit');
                  setName(`${norm}/`);
                }
              }}
            >
              新建文件夹
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={() => {
                setMode('edit');
                onNew();
              }}
            >
              新建查询
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={onExportAll}
              disabled={!!busy}
            >
              {busy === '导出中...' ? '导出中...' : '导出全部'}
            </Button>
            <Button
              size="xs"
              variant="light"
              onClick={onImportClick}
              disabled={!!busy}
            >
              导入
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) onImportFile(f);
              }}
            />
          </Group>
          {items.length === 0 ? (
            <Text c="dimmed" mt="xs">
              暂无
            </Text>
          ) : (
            <div style={{ marginTop: 8 }}>
              {tree.children && tree.children.length > 0 ? (
                <Tree
                  nodes={tree.children}
                  expanded={expanded}
                  onToggle={toggleFolder}
                  onOpenItem={onOpenItemRun}
                  onEditItem={onOpenItemEdit}
                  onDeleteItem={(it) => onDeleteById(it.id, it.name)}
                />
              ) : (
                <Text c="dimmed">（空）</Text>
              )}
            </div>
          )}
        </LeftDrawer>

        <Stack gap="md" style={{ flex: 1 }}>
          <LoadingOverlay
            visible={!!busy}
            zIndex={1000}
            overlayProps={{ blur: 1 }}
          />
          {mode === 'edit' ? (
            <>
              <Paper withBorder p="md">
                <Title order={4}>基本信息</Title>
                <Group mt="sm" align="end">
                  <TextInput
                    label="名称"
                    value={name}
                    onChange={(e) => setName(e.currentTarget.value)}
                    w={320}
                  />
                  <TextInput
                    label="描述"
                    value={description}
                    onChange={(e) => setDescription(e.currentTarget.value)}
                    w={420}
                  />
                  <Button onClick={onSave} disabled={!canSave}>
                    {currentId ? '更新' : '保存'}
                  </Button>
                  <Button
                    variant="light"
                    onClick={onSaveAs}
                    disabled={!canSave}
                  >
                    另存为
                  </Button>
                  <Button variant="default" onClick={onNew}>
                    新建
                  </Button>
                  <ActionIcon
                    color="red"
                    variant="light"
                    onClick={onDelete}
                    disabled={!currentId}
                    title="删除当前"
                  >
                    <IconTrash size={18} />
                  </ActionIcon>
                </Group>
              </Paper>

              <SqlEditor
                sql={sql}
                onChange={setSql}
                onDetectVars={onDetectVars}
                onAddVar={onAddVar}
              />

              {/* Extracted editors */}
              <VariablesEditor
                vars={vars}
                setVars={setVars}
                runValues={runValues}
                setRunValues={setRunValues}
                onRemoveVar={onRemoveVar}
                userConnId={userConnId}
              />

              <DynamicColumnsEditor dynCols={dynCols} setDynCols={setDynCols} />

              <CalcItemsEditor
                calcItems={calcItems}
                setCalcItems={setCalcItems}
                vars={vars}
                setRunValues={setRunValues}
              />

              {/** 编辑模式不显示分页与执行工具条 */}

              {false && (
              <Paper withBorder p="md">
                <Title order={4}>变量定义</Title>
                {/** 当存在 enum 类型变量时，增加“枚举选项”列 */}
                {/** 计算开关用于渲染列 */}
                {/** 注意：保持服务端 schema 校验，保存时会验证 options 非空与默认值合法 */}

                <Table mt="sm" withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>名称</Table.Th>
                      <Table.Th>类型</Table.Th>
                      {vars.some((v) => v.type === 'enum') && (
                        <Table.Th>枚举选项</Table.Th>
                      )}
                      <Table.Th>必填</Table.Th>
                      <Table.Th>默认值</Table.Th>
                      <Table.Th w={60}>操作</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {vars.length === 0 && (
                      <Table.Tr>
                        <Table.Td colSpan={vars.some((v) => v.type === 'enum') ? 6 : 5}>
                          <Text c="dimmed">无变量</Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                    {vars.map((v, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>
                          <TextInput
                            value={v.name}
                            onChange={(e) => {
                              const nextName = e.currentTarget.value;
                              setVars((vs) =>
                                vs.map((x, idx) =>
                                  idx === i ? { ...x, name: nextName } : x
                                )
                              );
                              setRunValues((rv) => {
                                const copy = { ...rv };
                                const oldName = v.name;
                                if (
                                  oldName !== nextName &&
                                  Object.prototype.hasOwnProperty.call(
                                    copy,
                                    oldName
                                  )
                                ) {
                                  copy[nextName] = copy[oldName];
                                  delete copy[oldName];
                                }
                                return copy;
                              });
                            }}
                            w={220}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Select
                            data={VAR_TYPES}
                            value={v.type}
                            onChange={(val) =>
                              setVars((vs) =>
                                vs.map((x, idx) =>
                                  idx === i
                                    ? {
                                        ...x,
                                        type: (val as any) || 'text',
                                        // 切换到 enum 时，初始化空数组；切走时清空 options
                                        options:
                                          (val as any) === 'enum'
                                            ? (Array.isArray(x.options)
                                                ? x.options
                                                : [])
                                            : undefined,
                                      }
                                    : x
                                )
                              )
                            }
                            w={140}
                          />
                        </Table.Td>
                        {vars.some((vv) => vv.type === 'enum') && (
                          <Table.Td>
                            {v.type === 'enum' ? (
                              <Stack gap={6}>
                                <TagsInput
                                  value={(v.options as string[] | undefined) || []}
                                  onChange={(vals) =>
                                    setVars((vs) =>
                                      vs.map((x, idx) =>
                                        idx === i
                                          ? {
                                              ...x,
                                              options: vals,
                                              // 若默认值不在新集合中，清空默认值
                                              default:
                                                x.default !== undefined &&
                                                x.default !== null &&
                                                !vals.includes(String(x.default))
                                                  ? undefined
                                                  : x.default,
                                            }
                                          : x
                                      )
                                    )
                                  }
                                  placeholder="输入后回车添加选项"
                                  w={260}
                                />
                                <Textarea
                                  placeholder="可选：输入 SQL 拉取选项（只读 SELECT/WITH，取第一列）"
                                  value={String(v.optionsSql ?? '')}
                                  onChange={(e) => {
                                    const val = e.currentTarget.value
                                    setVars((vs) =>
                                      vs.map((x, idx) =>
                                        idx === i ? { ...x, optionsSql: val } : x
                                      )
                                    )
                                  }}
                                  autosize
                                  minRows={2}
                                  w={360}
                                  styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
                                />
                                <Group gap="xs">
                                  <Button
                                    size="xs"
                                    variant="light"
                                    leftSection={<IconRefresh size={14} />}
                                    onClick={async () => {
                                      const sqlText = (v.optionsSql || '').trim()
                                      if (!sqlText) {
                                        notifications.show({ color: 'gray', title: '缺少 SQL', message: '请先填写用于拉取的 SQL', icon: <IconX size={14} /> })
                                        return
                                      }
                                      if (!userConnId) {
                                        notifications.show({ color: 'gray', title: '未选择连接', message: '请先选择当前连接后再拉取', icon: <IconX size={14} /> })
                                        return
                                      }
                                      try {
                                        const res = await fetch('/api/saved-sql/enum-options', {
                                          method: 'POST',
                                          headers: { 'content-type': 'application/json' },
                                          body: JSON.stringify({ userConnId, sql: sqlText }),
                                        })
                                        const j = await res.json().catch(() => ({}))
                                        if (!res.ok) throw new Error(j?.message || j?.error || `HTTP ${res.status}`)
                                        const opts: string[] = Array.isArray(j.options) ? j.options : []
                                        setVars((vs) =>
                                          vs.map((x, idx) =>
                                            idx === i
                                              ? {
                                                  ...x,
                                                  options: opts,
                                                  default:
                                                    x.default !== undefined &&
                                                    x.default !== null &&
                                                    !opts.includes(String(x.default))
                                                      ? undefined
                                                      : x.default,
                                                }
                                              : x
                                          )
                                        )
                                        notifications.show({ color: 'teal', title: '拉取成功', message: `获得 ${opts.length} 项`, icon: <IconCheck size={14} /> })
                                      } catch (e: any) {
                                        notifications.show({ color: 'red', title: '拉取失败', message: String(e?.message || e), icon: <IconX size={14} /> })
                                      }
                                    }}
                                  >
                                    拉取
                                  </Button>
                                </Group>
                              </Stack>
                            ) : (
                              <Text c="dimmed">—</Text>
                            )}
                          </Table.Td>
                        )}
                        <Table.Td>
                          <Switch
                            checked={!!v.required}
                            onChange={(e) => {
                              const checked = e.currentTarget.checked;
                              setVars((vs) =>
                                vs.map((x, idx) =>
                                  idx === i ? { ...x, required: checked } : x
                                )
                              );
                            }}
                          />
                        </Table.Td>
                        <Table.Td>
                          {v.type === 'number' ? (
                            <NumberInput
                              value={(v.default as any) ?? undefined}
                              onChange={(val) =>
                                setVars((vs) =>
                                  vs.map((x, idx) =>
                                    idx === i
                                      ? { ...x, default: val as any }
                                      : x
                                  )
                                )
                              }
                              w={180}
                            />
                          ) : v.type === 'boolean' ? (
                            <Switch
                              checked={!!v.default}
                              onChange={(e) => {
                                const checked = e.currentTarget.checked;
                                setVars((vs) =>
                                  vs.map((x, idx) =>
                                    idx === i ? { ...x, default: checked } : x
                                  )
                                );
                              }}
                            />
                          ) : v.type === 'enum' ? (
                            <Select
                              data={(v.options || []).map((o) => ({
                                value: o,
                                label: o,
                              }))}
                              value={
                                typeof v.default === 'string'
                                  ? (v.default as string)
                                  : undefined
                              }
                              onChange={(val) =>
                                setVars((vs) =>
                                  vs.map((x, idx) =>
                                    idx === i
                                      ? { ...x, default: (val as any) ?? undefined }
                                      : x
                                  )
                                )
                              }
                              w={220}
                              placeholder={
                                (v.options || []).length > 0
                                  ? '选择默认值'
                                  : '先填写枚举选项'
                              }
                            />
                          ) : (
                            <TextInput
                              value={String(v.default ?? '')}
                              onChange={(e) => {
                                const val = e.currentTarget.value;
                                setVars((vs) =>
                                  vs.map((x, idx) =>
                                    idx === i ? { ...x, default: val } : x
                                  )
                                );
                              }}
                              w={240}
                            />
                          )}
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="light"
                            onClick={() => onRemoveVar(v.name)}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>

                <Title order={4} mt="md">
                  动态列
                </Title>
                <Text c="dimmed" size="sm">
                  每个动态列包含“名称”和一个 JS 函数。函数签名：
                  <Code>(row, vars, helpers) =&gt; any</Code>
                </Text>
                <Table mt="sm" withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={220}>名称</Table.Th>
                      <Table.Th>JS 函数</Table.Th>
                      <Table.Th w={120}>手动触发</Table.Th>
                      <Table.Th w={60}>操作</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {dynCols.length === 0 && (
                      <Table.Tr>
                        <Table.Td colSpan={4}>
                          <Text c="dimmed">暂无动态列</Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                    {dynCols.map((dc, i) => (
                      <Table.Tr key={dc.name + i}>
                        <Table.Td>
                          <TextInput
                            value={dc.name}
                            onChange={(e) => {
                              const val = e.currentTarget.value;
                              setDynCols((arr) =>
                                arr.map((x, idx) =>
                                  idx === i ? { ...x, name: val } : x
                                )
                              );
                            }}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Textarea
                            value={dc.code}
                            onChange={(e) => {
                              const val = e.currentTarget.value;
                              setDynCols((arr) =>
                                arr.map((x, idx) =>
                                  idx === i ? { ...x, code: val } : x
                                )
                              );
                            }}
                            autosize
                            minRows={3}
                            styles={{
                              input: {
                                fontFamily:
                                  'var(--mantine-font-family-monospace)',
                              },
                            }}
                            placeholder="(row, vars, helpers) => row.amount * 1.1"
                          />
                        </Table.Td>
                        <Table.Td>
                          <Switch
                            checked={!!dc.manualTrigger}
                            onChange={(e) => {
                              const checked = e.currentTarget.checked;
                              setDynCols((arr) =>
                                arr.map((x, idx) =>
                                  idx === i
                                    ? { ...x, manualTrigger: checked }
                                    : x
                                )
                              );
                            }}
                            label={
                              dc.manualTrigger ? '点击按钮计算' : '自动计算'
                            }
                          />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="light"
                            onClick={() =>
                              setDynCols((arr) =>
                                arr.filter((_, idx) => idx !== i)
                              )
                            }
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                <Group gap="xs" mt="xs">
                  <Button
                    size="xs"
                    leftSection={<IconPlus size={14} />}
                    variant="light"
                    onClick={() =>
                      setDynCols((arr) => [
                        ...arr,
                        {
                          name: `dyn_${arr.length + 1}`,
                          code: '(row, vars) => null',
                          manualTrigger: false,
                        },
                      ])
                    }
                  >
                    新增动态列
                  </Button>
                </Group>
              </Paper>
              )}

              <Paper withBorder p="md">
                <Title order={4}>计算数据</Title>
                <Text c="dimmed" size="sm">
                  配置在“运行”时可点击手动计算的指标。支持两种方式：
                </Text>
                <Text c="dimmed" size="sm">
                  1) SQL：可使用所有变量，另提供{' '}
                  <Code>
                    {`{{`}_sql{`}}`}
                  </Code>{' '}
                  为当前查询未包裹分页的原始 SQL（将被作为 CTE 注入）。
                </Text>
                <Text c="dimmed" size="sm">
                  2) JS：函数签名 <Code>(vars, rows, helpers) =&gt; any</Code>
                  ，其中 rows 为当前页数据。
                </Text>
                <Table mt="sm" withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={220}>名称</Table.Th>
                      <Table.Th w={120}>类型</Table.Th>
                      <Table.Th>代码</Table.Th>
                      <Table.Th w={60}>操作</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {calcItems.length === 0 && (
                      <Table.Tr>
                        <Table.Td colSpan={4}>
                          <Text c="dimmed">暂无计算数据</Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                    {calcItems.map((ci, i) => (
                      <Table.Tr key={ci.name + i}>
                        <Table.Td>
                          <TextInput
                            value={ci.name}
                            onChange={(e) => {
                              const val = e.currentTarget.value;
                              setCalcItems((arr) =>
                                arr.map((x, idx) =>
                                  idx === i ? { ...x, name: val } : x
                                )
                              );
                            }}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Select
                            data={[
                              { value: 'sql', label: 'SQL' },
                              { value: 'js', label: 'JS' },
                            ]}
                            value={ci.type}
                            onChange={(v) =>
                              setCalcItems((arr) =>
                                arr.map((x, idx) =>
                                  idx === i
                                    ? { ...x, type: (v as any) || 'sql' }
                                    : x
                                )
                              )
                            }
                          />
                        </Table.Td>
                        <Table.Td>
                          <Textarea
                            value={ci.code}
                            onChange={(e) => {
                              const val = e.currentTarget.value;
                              setCalcItems((arr) =>
                                arr.map((x, idx) =>
                                  idx === i ? { ...x, code: val } : x
                                )
                              );
                            }}
                            autosize
                            minRows={3}
                            styles={{
                              input: {
                                fontFamily:
                                  'var(--mantine-font-family-monospace)',
                              },
                            }}
                            placeholder={
                              ci.type === 'sql'
                                ? 'select count(*) from ({{_sql}}) t'
                                : '(vars, rows) => rows.length'
                            }
                          />
                        </Table.Td>
                        <Table.Td>
                          <ActionIcon
                            color="red"
                            variant="light"
                            onClick={() =>
                              setCalcItems((arr) =>
                                arr.filter((_, idx) => idx !== i)
                              )
                            }
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                <Group gap="xs" mt="xs">
                  <Button
                    size="xs"
                    leftSection={<IconPlus size={14} />}
                    variant="light"
                    onClick={() =>
                      setCalcItems((arr) => [
                        ...arr,
                        {
                          name: `calc_${arr.length + 1}`,
                          type: 'sql',
                          code: 'select count(*) as total from ({{_sql}}) t',
                        },
                      ])
                    }
                  >
                    新增计算
                  </Button>
                </Group>
              </Paper>
            </>
          ) : (
            <>
              <RunParamsPanel
                userConnId={userConnId}
                currentConn={currentConn}
                vars={vars}
                runValues={runValues}
                setRunValues={setRunValues}
              />
              <PaginationSettings
                pgEnabled={pgEnabled}
                setPgEnabled={setPgEnabled}
                pgSize={pgSize}
                setPgSize={(n) => setPgSize(n)}
                pgPage={pgPage}
                setPgPage={(n) => setPgPage(n)}
                resetCounters={() => {
                  setPgTotalRows(null);
                  setPgTotalPages(null);
                  setPgCountLoaded(false);
                }}
              />
              <RunActionsBar
                onPreview={() => onPreview()}
                onExecute={() => onExecute()}
                onExplain={() => onExplain()}
                isExecuting={isExecuting}
                explainFormat={explainFormat}
                setExplainFormat={setExplainFormat}
                explainAnalyze={explainAnalyze}
                setExplainAnalyze={setExplainAnalyze}
              />

              <SqlPreviewPanel ref={sqlPreviewRef} isPreviewing={isPreviewing} previewSQL={previewSQL} />

              <ResultsPanel
                isExecuting={isExecuting}
                top={
                  <RuntimeCalcCards
                    items={runtimeCalcItems}
                    calcResults={calcResults}
                    setCalcResults={setCalcResults}
                    currentId={currentId}
                    userConnId={userConnId}
                    runValues={runValues}
                    rows={rows}
                    onUpdateCount={(total) => {
                      setPgTotalRows(total);
                      setPgTotalPages(Math.max(1, Math.ceil(total / pgSize)));
                      setPgCountLoaded(true);
                    }}
                  />
                }
                textResult={textResult}
                gridCols={gridCols}
                rows={rows}
                footer={
                  <PaginationBar
                    visible={pgEnabled && !textResult}
                    page={pgPage}
                    totalPages={pgTotalPages}
                    totalRows={pgTotalRows}
                    onFirst={() => { setPgPage(1); onExecute({ page: 1 }); }}
                    onPrev={() => { const next = Math.max(1, pgPage - 1); setPgPage(next); onExecute({ page: next }); }}
                    onNext={() => { const next = pgPage + 1; setPgPage(next); onExecute({ page: next }); }}
                    onLast={() => { if (pgTotalPages) { setPgPage(pgTotalPages); onExecute({ page: pgTotalPages }); } }}
                  />
                }
              />
            </>
          )}
        </Stack>
      </div>
    </Stack>
  );
}

// Tree moved to components/queries/Tree
