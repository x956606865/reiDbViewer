'use client'

import { useEffect, useState } from 'react'

export default function SignOutPage() {
  const [msg, setMsg] = useState('正在退出…')
  useEffect(() => {
    const run = async () => {
      try {
        await fetch('/api/auth/sign-out', { method: 'POST' })
        setMsg('已退出，正在跳转…')
        setTimeout(() => (window.location.href = '/'), 600)
      } catch {
        setMsg('退出失败，请稍后重试')
      }
    }
    run()
  }, [])
  return (
    <main style={{ padding: 24 }}>
      <p>{msg}</p>
    </main>
  )
}

