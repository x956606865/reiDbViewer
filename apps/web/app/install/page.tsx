'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

type Status = {
  configured: boolean
  schema: string
  schemaExists: boolean
  initialized: boolean
  existingTables: string[]
  expectedTables: string[]
  warnings: string[]
  suggestedSQL: string
  error?: string
  reason?: string
  message?: string
}

export default function InstallPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const [schema, setSchema] = useState(sp.get('schema') || 'public')
  const [prefix, setPrefix] = useState(sp.get('prefix') || 'rdv_')
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = async (sch: string, pfx: string = prefix) => {
    setLoading(true)
    setErr(null)
    try {
      const params = new URLSearchParams({ schema: sch, prefix: pfx })
      const res = await fetch(`/api/appdb/init/status?${params.toString()}`, { cache: 'no-store' })
      const json = (await res.json()) as any
      if (!res.ok) {
        // 后端返回错误时，展示错误并清空状态，避免 undefined 字段
        setStatus(null)
        const msg = json?.message || json?.error || '初始化检测失败'
        setErr(String(msg))
        return
      }
      setStatus(json as Status)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(schema, prefix) }, [])

  const nonAppTables = useMemo(() => {
    if (!status) return [] as string[]
    const set = new Set(status.expectedTables)
    return (status.existingTables || []).filter((t) => !set.has(t))
  }, [status])

  const copySql = async () => {
    if (status?.suggestedSQL) await navigator.clipboard.writeText(status.suggestedSQL)
  }

  const recheck = async () => {
    await load(schema)
    if (status?.initialized) router.push('/')
  }

  return (
    <main style={{ padding: 24, maxWidth: 960 }}>
      <h1>应用数据库初始化</h1>
      <p style={{ color: '#64748b' }}>本页面仅展示需要执行的 SQL 与检测结果，不会代表你执行任何数据库变更。</p>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <label>目标 schema：</label>
        <input value={schema} onChange={(e) => setSchema(e.target.value)} placeholder="public" style={{ width: 200 }} />
        <label style={{ marginLeft: 12 }}>表前缀：</label>
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="rdv_" style={{ width: 160 }} />
        <button onClick={() => load(schema, prefix)}>重新检测</button>
        <button onClick={() => { navigator.clipboard.writeText(location.href) }}>复制当前链接</button>
      </div>

      {loading && <p>检测中…</p>}
      {err && <p style={{ color: 'red' }}>错误：{err}</p>}

      {status && (
        <section style={{ marginTop: 16 }}>
          {!status.configured && (
            <p style={{ color: 'red' }}>未配置 APP_DB_URL，请先在环境变量中设置，再刷新本页。</p>
          )}
          {status.configured && (
            <>
              <p>
                Schema 存在：<strong>{String(status.schemaExists)}</strong>；
                已初始化：<strong>{String(status.initialized)}</strong>
              </p>
              {nonAppTables.length > 0 && (
                <div style={{ background: '#fff7ed', border: '1px solid #fdba74', padding: 12, borderRadius: 6 }}>
                  <p>注意：目标 schema 非空，以下对象可能与初始化无关：</p>
                  <code>{nonAppTables.join(', ')}</code>
                  <p>影响：初始化不会覆盖现有对象；如同名表结构不匹配，后续业务可能异常，请自行调整。</p>
                </div>
              )}
              {!status.initialized && (
                <>
                  <h3 style={{ marginTop: 16 }}>建议执行的 SQL（请在数据库中手工执行）</h3>
                  <pre style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', border: '1px solid #e2e8f0', padding: 12 }}>{status.suggestedSQL || '(后端未返回 SQL，可能连接失败或权限不足)'}</pre>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={copySql}>复制 SQL</button>
                    <button onClick={recheck}>我已执行，重新检测</button>
                  </div>
                </>
              )}
              {status.initialized && (
                <div style={{ background: '#ecfdf5', border: '1px solid #34d399', padding: 12, borderRadius: 6 }}>
                  <p>检测到应用数据库已就绪。你可以返回首页继续使用。</p>
                  <div style={{ marginTop: 8 }}>
                    <button onClick={() => router.push('/')}>返回首页</button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {!status && !loading && err && (
        <section style={{ marginTop: 16 }}>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: 12, borderRadius: 6 }}>
            <p style={{ color: '#b91c1c' }}>后端返回错误：{err}</p>
            <p style={{ color: '#64748b' }}>请检查 APP_DB_URL、网络连通性以及 sslmode/password 的配置。也可直接打开 <code>/api/appdb/init/status?schema={schema}&prefix={prefix}</code> 查看原始返回。</p>
          </div>
        </section>
      )}
    </main>
  )
}
