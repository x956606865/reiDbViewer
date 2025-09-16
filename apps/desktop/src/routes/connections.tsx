import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Code, Group, Paper, Stack, Table, Text, TextInput, Title, Modal } from '@mantine/core'
import { listConnections, createConnection, setCurrent, getCurrent, testConnectionDsn, deleteConnectionById, updateConnectionDsn } from '@/lib/localStore'
import { validatePostgresDsn } from '@/lib/validate-dsn'

type ConnRow = { id: string; alias: string; created_at?: number | null }

export default function ConnectionsPage() {
  const [items, setItems] = useState<ConnRow[]>([])
  const [alias, setAlias] = useState('')
  const [dsn, setDsn] = useState('')
  const [currentId, setCurrentId] = useState<string | null>(getCurrent())
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAlias, setEditAlias] = useState('')
  const [editDsn, setEditDsn] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const refresh = () => {
    setError(null)
    listConnections()
      .then((rows) => setItems(rows))
      .catch((e) => setError(String(e?.message || e)))
  }

  useEffect(() => {
    refresh()
  }, [])

  const canAdd = useMemo(() => alias.trim().length > 0 && dsn.trim().length > 0, [alias, dsn])

  const onAdd = async () => {
    if (!canAdd) return
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      const chk = validatePostgresDsn(dsn.trim())
      if (!chk.ok) throw new Error(`无效的 DSN：${chk.reason || 'unknown'}`)
      const res = await createConnection(alias.trim(), dsn.trim())
      setAlias('')
      setDsn('')
      setInfo(res.storage === 'keyring' ? '已保存。凭据已保存到系统钥匙串。' : '已保存。凭据已加密存储在本地 SQLite。')
      refresh()
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const onUse = (id: string) => {
    setCurrentId(id)
    setCurrent(id)
  }

  const onEdit = (id: string, alias: string) => {
    setEditingId(id)
    setEditAlias(alias)
    setEditDsn('')
  }

  const onSaveEdit = async () => {
    if (!editingId) return
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      await updateConnectionDsn(editingId, editAlias.trim() || null, editDsn.trim())
      setEditingId(null)
      setEditAlias('')
      setEditDsn('')
      setInfo('已更新。凭据已加密存储到本地（同时尝试写入钥匙串）。')
      refresh()
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const onDelete = async () => {
    if (!deletingId) return
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      await deleteConnectionById(deletingId)
      if (currentId === deletingId) onUse('')
      setDeletingId(null)
      refresh()
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const onTest = async () => {
    setTesting(true)
    setError(null)
    setInfo(null)
    try {
      const ok = await testConnectionDsn(dsn.trim())
      setInfo(ok ? '连接成功（SELECT 1 返回）。' : '连接失败。')
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
    <Stack gap="md" maw={840}>
      <div>
        <Title order={3}>用户连接管理</Title>
        <Text c="dimmed">凭据优先加密存储在本地 SQLite；若可用也会写入系统钥匙串。仅显示别名等非敏感信息。</Text>
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
          <Button variant="default" disabled={!canAdd || testing} onClick={onTest} loading={testing}>
            测试连接
          </Button>
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
                <Table.Th w={260}>操作</Table.Th>
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
                    <Text size="sm" c="dimmed">{s.created_at ? new Date((s.created_at || 0) * 1000).toLocaleString() : '-'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button size="xs" onClick={() => onUse(s.id)} disabled={currentId === s.id}>设为当前</Button>
                      <Button size="xs" variant="default" onClick={() => onEdit(s.id, s.alias)}>编辑</Button>
                      <Button size="xs" color="red" variant="light" onClick={() => setDeletingId(s.id)}>删除</Button>
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
    <Modal opened={!!editingId} onClose={() => setEditingId(null)} title="编辑连接" centered>
      <Stack gap="sm">
        <TextInput label="别名" value={editAlias} onChange={(e) => setEditAlias(e.currentTarget.value)} />
        <TextInput label="Postgres DSN（将更新本地加密副本）" placeholder="postgres://user:pass@host:5432/db?sslmode=require" value={editDsn} onChange={(e) => setEditDsn(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setEditingId(null)}>取消</Button>
          <Button onClick={onSaveEdit} disabled={!editDsn.trim()}>保存</Button>
        </Group>
      </Stack>
    </Modal>
    <Modal opened={!!deletingId} onClose={() => setDeletingId(null)} title="删除连接" centered>
      <Stack gap="sm">
        <Text>确定删除此连接吗？这不会影响目标数据库，仅删除本地配置与密文。</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeletingId(null)}>取消</Button>
          <Button color="red" onClick={onDelete}>删除</Button>
        </Group>
      </Stack>
    </Modal>
    </>
  )
}
