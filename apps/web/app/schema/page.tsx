'use client'

import { useEffect, useState } from 'react'

type TableMeta = { schema: string; name: string; columns: { name: string; dataType: string }[] }

export default function SchemaPage() {
  const [tables, setTables] = useState<TableMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/schema/tables')
      .then((r) => r.json())
      .then((json) => setTables(json.tables || []))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <main style={{ padding: 24 }}>加载中…</main>
  if (error) return <main style={{ padding: 24, color: 'red' }}>加载失败：{error}</main>

  return (
    <main style={{ padding: 24 }}>
      <h2>Schema Explorer（Mock）</h2>
      <p>来自 /api/schema/tables 的 mock 数据。</p>
      <ul>
        {tables.map((t) => (
          <li key={`${t.schema}.${t.name}`}>
            <strong>{t.schema}.{t.name}</strong>
            <ul>
              {t.columns.map((c) => (
                <li key={c.name}>
                  {c.name} <em style={{ color: '#666' }}>({c.dataType})</em>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </main>
  )
}

