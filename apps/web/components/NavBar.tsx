'use client'

import { useEffect, useState } from 'react'

type Sess = { user?: { id: string; email?: string } } | null

export function NavBar() {
  const [session, setSession] = useState<Sess>(null)
  useEffect(() => {
    fetch('/api/auth/get-session')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSession(j))
      .catch(() => setSession(null))
  }, [])
  const email = session?.user?.email
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #e5e7eb' }}>
      <a href="/" style={{ fontWeight: 700 }}>reiDbView</a>
      <nav style={{ display: 'flex', gap: 10 }}>
        <a href="/schema">Schema</a>
        <a href="/preview">Preview</a>
        <a href="/connections">Connections</a>
      </nav>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
        {!email ? (
          <>
            <a href="/sign-in">登录</a>
            <a href="/sign-up">注册</a>
          </>
        ) : (
          <>
            <span style={{ color: '#64748b' }}>{email}</span>
            <a href="/sign-out">退出</a>
          </>
        )}
      </div>
    </header>
  )
}

