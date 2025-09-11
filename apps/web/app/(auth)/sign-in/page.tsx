'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Anchor, Button, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'

export default function SignInPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const validEmail = useMemo(() => /.+@.+\..+/.test(email), [email])
  const validPwd = useMemo(() => password.length >= 6, [password])
  const canSubmit = validEmail && validPwd && !submitting

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || '登录失败')
      notifications.show({ color: 'teal', title: '登录成功', message: '正在跳转…' })
      window.location.href = '/'
    } catch (e: any) {
      notifications.show({ color: 'red', title: '登录失败', message: String(e.message || e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Stack align="center" mt="xl">
      <Paper withBorder p="lg" radius="md" maw={420} w="100%">
        <Title order={3}>登录</Title>
        <Text c="dimmed" size="sm" mt={4}>
          使用邮箱与密码登录账户。
        </Text>
        <form onSubmit={submit}>
          <Stack gap="sm" mt="md">
            <TextInput
              label="邮箱"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              error={email.length > 0 && !validEmail ? '邮箱格式不正确' : undefined}
            />
            <PasswordInput
              label="密码"
              placeholder="至少 6 位"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              error={password.length > 0 && !validPwd ? '密码至少 6 位' : undefined}
            />
            <Button type="submit" loading={submitting} disabled={!canSubmit} fullWidth>
              登录
            </Button>
          </Stack>
        </form>
        <Text size="sm" mt="md">
          还没有账号？
          <Anchor component={Link} href="/sign-up" ml={6}>
            去注册
          </Anchor>
        </Text>
      </Paper>
    </Stack>
  )
}
