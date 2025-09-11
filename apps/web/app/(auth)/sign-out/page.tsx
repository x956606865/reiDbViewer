'use client'

import { useEffect, useState } from 'react'
import { Loader, Paper, Stack, Text, Title } from '@mantine/core'

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
    <Stack align="center" mt="xl">
      <Paper withBorder p="lg" radius="md" maw={420} w="100%">
        <Title order={3}>退出登录</Title>
        <Stack gap="xs" mt="sm">
          <Loader size="sm" />
          <Text c="dimmed">{msg}</Text>
        </Stack>
      </Paper>
    </Stack>
  )
}
