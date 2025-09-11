'use client';

import { useEffect, useState } from 'react';
import { DataGrid } from '../../components/DataGrid';

const defaultAst = {
  from: { name: 'orders', alias: 'o' },
  columns: [
    { kind: 'column', ref: { kind: 'colref', table: 'o', name: 'id' } },
    {
      kind: 'computed',
      alias: 'user_email',
      expr: { kind: 'colref', table: 'lc_1', name: 'email' },
      viaJoinId: 'lc_1',
    },
  ],
  joins: [
    {
      type: 'LATERAL',
      to: { name: 'users', alias: 'lc_1' },
      alias: 'lc_1',
      on: {
        kind: 'eq',
        left: { kind: 'colref', table: 'o', name: 'user_id' },
        right: { kind: 'colref', table: 'lc_1', name: 'id' },
      },
    },
  ],
  orderBy: [{ expr: { kind: 'colref', table: 'o', name: 'id' }, dir: 'ASC' }],
  limit: 10,
};

export default function PreviewPage() {
  const [astText, setAstText] = useState(JSON.stringify(defaultAst, null, 2));
  const [sql, setSql] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [gridCols, setGridCols] = useState<string[]>([]);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [connId, setConnId] = useState<string | null>(null);
  const [serverIds, setServerIds] = useState<string[]>([]);

  // 读取当前选择的连接别名（本地保存的是别名，需要解析到 connId）
  useEffect(() => {
    // 列出服务器允许的 ID
    fetch('/api/connections')
      .then((r) => r.json())
      .then((j) => setServerIds(j.ids || []))
      .catch(() => {});
    try {
      const currentAlias = localStorage.getItem('rdv.currentConnId'); // 实际保存的是 alias
      const saved = JSON.parse(
        localStorage.getItem('rdv.savedConns') || '[]'
      ) as Array<{ alias: string; id: string }>;
      const found = saved.find((s) => s.alias === currentAlias);
      if (found) setConnId(found.id);
      else setConnId(null);
    } catch {
      setConnId(null);
    }
  }, []);

  const onPreview = async () => {
    try {
      setErr(null);
      const ast = JSON.parse(astText);
      const body = { select: ast, connId: connId || undefined };
      const res = await fetch('/api/query/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || '请求失败');
      setSql(json.sql);
      // 基于 AST 推导列并生成演示数据
      const cols: string[] = [];
      for (const c of ast.columns ?? []) {
        if (c.kind === 'computed') cols.push(c.alias);
        else if (c.kind === 'column') cols.push(c.alias ?? c.ref.name);
      }
      setGridCols(cols);
      const demo = Array.from({ length: ast.limit ?? 10 }, (_, i) => {
        const r: Record<string, unknown> = {};
        for (const key of cols) {
          if (/id$/i.test(key)) r[key] = 1000 + i;
          else if (/email/i.test(key)) r[key] = `user${i + 1}@example.com`;
          else r[key] = `v_${i + 1}`;
        }
        return r;
      });
      setRows(demo);
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  };

  const onExecute = async () => {
    try {
      setErr(null);
      const ast = JSON.parse(astText);
      const body = { select: ast, connId: connId || undefined };
      const res = await fetch('/api/query/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 仍然展示可用的 SQL 预览（若返回了 preview）
        if (json?.preview?.text) setSql(json.preview.text);
        throw new Error(json?.error || `执行失败（HTTP ${res.status}）`);
      }
      // 未来真实执行：使用 json.rows / json.data
      if (Array.isArray(json.rows)) {
        const cols = Object.keys(json.rows[0] ?? {});
        setGridCols(cols);
        setRows(json.rows);
      } else {
        // 兼容：若无返回数据，则沿用预览逻辑生成演示数据
        await onPreview();
      }
    } catch (e: any) {
      setErr(String(e.message || e));
    }
  };

  return (
    <main
      style={{
        padding: 24,
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: 16,
      }}
    >
      <section>
        <h2>AST（可编辑）</h2>
        <textarea
          value={astText}
          onChange={(e) => setAstText(e.target.value)}
          style={{
            width: '100%',
            height: 280,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          }}
        />
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button onClick={onPreview} style={{ padding: '6px 12px' }}>
            预览 SQL
          </button>
          <button onClick={onExecute} style={{ padding: '6px 12px' }}>
            执行
          </button>
        </div>
        {err && <p style={{ color: 'red' }}>错误：{err}</p>}
      </section>
      <section>
        <h2>SQL</h2>
        <pre
          style={{
            background: '#fafafa',
            padding: 12,
            border: '1px solid #eee',
            minHeight: 200,
          }}
        >
          {sql || '（点击“预览 SQL”或“执行”查看 SQL）'}
        </pre>
      </section>
      <section>
        <h2>DataGrid（Mock 数据）</h2>
        <DataGrid columns={gridCols} rows={rows} />
      </section>
    </main>
  );
}
