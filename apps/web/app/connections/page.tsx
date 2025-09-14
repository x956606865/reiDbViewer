"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Code, Group, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { useCurrentConnId } from '@/lib/current-conn'

type UserConn = { id: string; alias: string; createdAt?: string | null; lastUsedAt?: string | null }

export default function ConnectionsPage() {
  const [items, setItems] = useState<UserConn[]>([])
  const [alias, setAlias] = useState('')
  const [dsn, setDsn] = useState('')
  const [currentId, setCurrentId] = useCurrentConnId()
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    setError(null)
    fetch('/api/user/connections', { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 501) throw new Error('应用数据库未配置或未初始化，请先到 /install 按提示完成初始化。')
        if (r.status === 401) throw new Error('未登录，请先登录。')
        const j = await r.json()
        setItems(j.items || [])
      })
      .catch((e) => setError(String(e?.message || e)))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const canAdd = useMemo(() => alias.trim().length > 0 && dsn.trim().length > 0, [alias, dsn])

  const onAdd = async () => {
    if (!canAdd) return
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      const res = await fetch('/api/user/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alias: alias.trim(), dsn: dsn.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json?.error === 'invalid_dsn') throw new Error(`无效的 DSN：${json?.reason || 'unknown'}`)
        if (json?.error === 'alias_exists') throw new Error('别名已存在，请更换别名。')
        if (json?.error === 'app_db_not_configured') throw new Error('应用数据库未配置，请先到 /install 初始化。')
        if (json?.error === 'unauthorized') throw new Error('未登录，请先登录。')
        throw new Error(json?.error || `保存失败（HTTP ${res.status}）`)
      }
      setAlias('')
      setDsn('')
      setInfo('已保存。凭据已加密存储，列表不展示明文。')
      refresh()
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const onUse = (id: string) => setCurrentId(id)

  return (
    <Stack gap="md" maw={840}>
      <div>
        <Title order={3}>用户连接管理</Title>
        <Text c="dimmed">连接凭据加密存储于应用数据库；仅显示别名等非敏感信息。</Text>
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

      <Paper withBorder p="md">
        <Title order={4}>新增连接</Title>
        <Group mt="sm" gap="sm" align="end">
          <TextInput label="别名" placeholder="如：生产库" value={alias} onChange={(e) => setAlias(e.currentTarget.value)} w={220} />
          <TextInput
            label="Postgres DSN"
            placeholder="postgres://user:pass@host:5432/db?sslmode=require"
            value={dsn}
            onChange={(e) => setDsn(e.currentTarget.value)}
            w={480}
          />
          <Button disabled={!canAdd || loading} onClick={onAdd} loading={loading}>
            保存
          </Button>
        </Group>
        <Text c="dimmed" size="sm" mt="xs">
          安全提示：允许私网/本机；建议启用 TLS（sslmode=require），也支持禁用 TLS（仅限内网/开发环境）。
        </Text>
      </Paper>

      <Paper withBorder p="md">
        <Title order={4}>我的连接</Title>
        {items.length === 0 ? (
          <Text c="dimmed" mt="xs">
            暂无连接
          </Text>
        ) : (
          <Table mt="sm" striped withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>当前</Table.Th>
                <Table.Th>别名</Table.Th>
                <Table.Th>记录ID</Table.Th>
                <Table.Th>创建时间</Table.Th>
                <Table.Th w={180}>操作</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map((s) => (
                <Table.Tr key={s.id}>
                  <Table.Td>
                    {currentId === s.id ? (
                      <Badge color="green">当前</Badge>
                    ) : (
                      <Badge color="gray" variant="light">
                        否
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{s.alias}</Table.Td>
                  <Table.Td>
                    <Code>{s.id}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {s.createdAt ? new Date(s.createdAt).toLocaleString() : '-'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button size="xs" onClick={() => onUse(s.id)} disabled={currentId === s.id}>
                        设为当前
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <Paper withBorder p="md">
        <Title order={4}>当前连接</Title>
        <Text mt="xs">{currentId ? <Code>{currentId}</Code> : '未选择'}</Text>
        <Text c="dimmed" size="sm">提示：右上角可快速切换当前连接。</Text>
      </Paper>
    </Stack>
  )
}
