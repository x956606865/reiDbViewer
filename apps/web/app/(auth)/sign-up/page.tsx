'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Anchor, Button, Checkbox, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agree, setAgree] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const validEmail = useMemo(() => /.+@.+\..+/.test(email), [email])
  const validPwd = useMemo(() => password.length >= 8, [password])
  const match = useMemo(() => confirm === password && confirm.length > 0, [confirm, password])
  const canSubmit = validEmail && validPwd && match && agree && !submitting

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || '注册失败')
      notifications.show({ color: 'teal', title: '注册成功', message: '请使用账号登录' })
      window.location.href = '/sign-in'
    } catch (e: any) {
      notifications.show({ color: 'red', title: '注册失败', message: String(e.message || e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Stack align="center" mt="xl">
      <Paper withBorder p="lg" radius="md" maw={420} w="100%">
        <Title order={3}>注册</Title>
        <Text c="dimmed" size="sm" mt={4}>
          创建你的 reiDbView 账户。
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
              placeholder="至少 8 位"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              error={password.length > 0 && !validPwd ? '密码至少 8 位' : undefined}
            />
            <PasswordInput
              label="确认密码"
              placeholder="再次输入密码"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.currentTarget.value)}
              error={confirm.length > 0 && !match ? '两次输入不一致' : undefined}
            />
            <Checkbox
              checked={agree}
              onChange={(e) => setAgree(e.currentTarget.checked)}
              label={
                <Text size="sm">
                  我已阅读并同意
                  <Anchor component={Link} href="#" ml={4}>
                    服务条款
                  </Anchor>
                </Text>
              }
            />
            <Button type="submit" loading={submitting} disabled={!canSubmit} fullWidth>
              注册
            </Button>
          </Stack>
        </form>
        <Text size="sm" mt="md">
          已有账号？
          <Anchor component={Link} href="/sign-in" ml={6}>
            去登录
          </Anchor>
        </Text>
      </Paper>
    </Stack>
  )
}
