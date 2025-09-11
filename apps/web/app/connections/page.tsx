'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Code,
  Group,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSaved(loadSaved())
    setCurrent(localStorage.getItem(CURRENT_KEY))
    fetch('/api/connections')
      .then((r) => r.json())
      .then((j) => setServerIds(j.ids || []))
      .catch((e) => setError(String(e)))
  }, [])

  const canAdd = useMemo(() => alias.trim().length > 0 && !!selectedId && serverIds.includes(selectedId), [alias, selectedId, serverIds])

  const onAdd = () => {
    if (!canAdd || !selectedId) return
    const next = [...saved, { id: selectedId, alias: alias.trim() }]
    setSaved(next)
    saveSaved(next)
    setAlias('')
    setSelectedId(null)
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
    <Stack gap="md" maw={840}>
      <div>
        <Title order={3}>连接管理（客户端书签，不含凭据）</Title>
        <Text c="dimmed">仅保存服务器允许的连接ID的“别名”，不保存连接串。服务器端通过白名单映射管理真实连接。</Text>
        {error && (
          <Text c="red" mt="xs">
            加载失败：{error}
          </Text>
        )}
      </div>

      <Paper withBorder p="md">
        <Title order={4}>新增别名</Title>
        <Group mt="sm" gap="sm" align="end">
          <TextInput label="别名" placeholder="如：生产库" value={alias} onChange={(e) => setAlias(e.currentTarget.value)} w={220} />
          <Select
            label="连接ID"
            placeholder="选择连接ID"
            data={serverIds}
            value={selectedId}
            onChange={setSelectedId}
            searchable
            w={260}
          />
          <Button disabled={!canAdd} onClick={onAdd}>
            添加
          </Button>
        </Group>
      </Paper>

      <Paper withBorder p="md">
        <Title order={4}>已保存</Title>
        {saved.length === 0 ? (
          <Text c="dimmed" mt="xs">
            暂无别名
          </Text>
        ) : (
          <Table mt="sm" striped withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>别名</Table.Th>
                <Table.Th>连接ID</Table.Th>
                <Table.Th w={200}>操作</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {saved.map((s) => (
                <Table.Tr key={s.alias}>
                  <Table.Td>
                    <Badge variant={current === s.alias ? 'filled' : 'light'} color={current === s.alias ? 'green' : 'gray'}>
                      {s.alias}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Code>{s.id}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button size="xs" onClick={() => onUse(s.alias)} disabled={current === s.alias}>
                        设为当前
                      </Button>
                      <Button size="xs" color="red" variant="light" onClick={() => onRemove(s.alias)}>
                        删除
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
        <Text mt="xs">{current ? current : '未选择（默认：default，如已配置）'}</Text>
      </Paper>
    </Stack>
  )
}
