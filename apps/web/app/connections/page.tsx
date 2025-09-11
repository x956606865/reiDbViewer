'use client'

import { useEffect, useMemo, useState } from 'react'

type SavedConn = { id: string; alias: string }
const STORAGE_KEY = 'rdv.savedConns'
const CURRENT_KEY = 'rdv.currentConnId'

function loadSaved(): SavedConn[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function saveSaved(conns: SavedConn[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conns))
}

export default function ConnectionsPage() {
  const [serverIds, setServerIds] = useState<string[]>([])
  const [saved, setSaved] = useState<SavedConn[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [alias, setAlias] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSaved(loadSaved())
    setCurrent(localStorage.getItem(CURRENT_KEY))
    fetch('/api/connections').then((r) => r.json()).then((j) => setServerIds(j.ids || [])).catch((e) => setError(String(e)))
  }, [])

  const canAdd = useMemo(() => alias.trim().length > 0 && serverIds.includes(selectedId), [alias, selectedId, serverIds])

  const onAdd = () => {
    if (!canAdd) return
    const next = [...saved, { id: selectedId, alias: alias.trim() }]
    setSaved(next)
    saveSaved(next)
    setAlias('')
    setSelectedId('')
  }

  const onRemove = (aliasToRemove: string) => {
    const next = saved.filter((s) => s.alias !== aliasToRemove)
    setSaved(next)
    saveSaved(next)
    if (current && !next.find((s) => s.alias === current)) {
      setCurrent(null)
      localStorage.removeItem(CURRENT_KEY)
    }
  }

  const onUse = (aliasToUse: string) => {
    setCurrent(aliasToUse)
    localStorage.setItem(CURRENT_KEY, aliasToUse)
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h2>连接管理（客户端书签，不含凭据）</h2>
      <p style={{ color: '#64748b' }}>仅保存服务器允许的连接ID的“别名”，不保存连接串。服务器端通过白名单映射管理真实连接。</p>
      {error && <p style={{ color: 'red' }}>加载失败：{error}</p>}

      <section style={{ marginTop: 16 }}>
        <h3>新增别名</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input placeholder="别名（如：生产库）" value={alias} onChange={(e) => setAlias(e.target.value)} />
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">选择连接ID</option>
            {serverIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          <button disabled={!canAdd} onClick={onAdd}>添加</button>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3>已保存</h3>
        <ul>
          {saved.map((s) => (
            <li key={s.alias} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
              <span style={{ minWidth: 160 }}><strong>{s.alias}</strong></span>
              <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>{s.id}</code>
              <button onClick={() => onUse(s.alias)} disabled={current === s.alias}>设为当前</button>
              <button onClick={() => onRemove(s.alias)} style={{ color: '#ef4444' }}>删除</button>
            </li>
          ))}
          {saved.length === 0 && <li style={{ color: '#64748b' }}>暂无别名</li>}
        </ul>
      </section>

      <section style={{ marginTop: 24 }}>
        <h3>当前连接</h3>
        <p>{current ? current : '未选择（默认：default，如已配置）'}</p>
      </section>
    </main>
  )
}

