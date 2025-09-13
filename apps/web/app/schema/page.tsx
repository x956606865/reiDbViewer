"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button, Group, Loader, Paper, Select, Stack, Table, Text, Title, Code } from '@mantine/core'

type ColumnMeta = { name: string; dataType: string; nullable?: boolean; isPrimaryKey?: boolean }
type TableMeta = { schema: string; name: string; columns: ColumnMeta[] }

export default function SchemaPage() {
  const [tables, setTables] = useState<TableMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [databases, setDatabases] = useState<string[]>([])
  const [schemas, setSchemas] = useState<string[]>([])
  const [ddls, setDdls] = useState<Record<string, string>>({})
  const [userConnId, setUserConnId] = useState<string | null>(null)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [selectedSchema, setSelectedSchema] = useState<string>('')

  useEffect(() => {
    try {
      const id = localStorage.getItem('rdv.currentUserConnId')
      setUserConnId(id)
    } catch {}
  }, [])

  useEffect(() => {
    const url = userConnId ? `/api/schema/tables?userConnId=${encodeURIComponent(userConnId)}` : '/api/schema/tables'
    setLoading(true)
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        setTables(json.tables || [])
        setSchemas(json.schemas || [])
        setDatabases(json.databases || [])
        setCachedAt(json.cachedAt ?? null)
        if (!selectedSchema && (json.schemas?.length ?? 0) > 0) setSelectedSchema('')
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [userConnId])

  const onRefresh = async () => {
    if (!userConnId) {
      setError('请先在“连接”中选择当前连接（localStorage: rdv.currentUserConnId）。')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/schema/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userConnId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || '刷新失败')
      setTables(json.tables || [])
      setDatabases(json.databases || [])
      setSchemas(json.schemas || [])
      setCachedAt(new Date().toISOString())
      const map: Record<string, string> = {}
      for (const d of json.ddls || []) map[`${d.schema}.${d.name}`] = d.ddl
      setDdls(map)
    } catch (e: any) {
      setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  if (loading)
    return (
      <Stack gap="md">
        <Loader />
        <Text c="dimmed">加载中…</Text>
      </Stack>
    )
  if (error)
    return (
      <Text c="red">加载失败：{error}</Text>
    )

  const filteredTables = useMemo(() => {
    return selectedSchema ? tables.filter((t) => t.schema === selectedSchema) : tables
  }, [tables, selectedSchema])

  return (
    <Stack gap="md">
      <div>
        <Group justify="space-between">
          <div>
            <Title order={3}>Schema Explorer</Title>
            <Text c="dimmed">点击“刷新元数据”从当前连接拉取最新信息。</Text>
          </div>
          <Group>
            <Text c="dimmed" size="sm">当前连接: {userConnId ? userConnId : '未选择'}</Text>
            <Button variant="light" onClick={onRefresh} loading={loading}>刷新元数据</Button>
          </Group>
        </Group>
        <Group mt="xs" gap="sm">
          <Text c="dimmed" size="sm">数据库：{databases.length} 个；Schema：{schemas.length} 个；表：{tables.length} 张</Text>
          <Text c="dimmed" size="sm">{cachedAt ? `缓存时间：${new Date(cachedAt).toLocaleString()}` : '无缓存（请刷新）'}</Text>
          <Select
            label="筛选 Schema"
            placeholder="全部"
            value={selectedSchema}
            onChange={(v) => setSelectedSchema(v || '')}
            data={[{ value: '', label: '全部 Schema' }, ...schemas.map((s) => ({ value: s, label: s }))]}
            styles={{ root: { width: 240 } }}
          />
        </Group>
      </div>
      {userConnId && !cachedAt && filteredTables.length === 0 && (
        <Paper withBorder p="md">
          <Text>当前连接尚无元数据缓存，请点击右上角“刷新元数据”。</Text>
        </Paper>
      )}
      {filteredTables.map((t) => (
        <Paper withBorder p="sm" key={`${t.schema}.${t.name}`}>
          <Group justify="space-between" align="center">
            <Title order={5}>
              {t.schema}.{t.name}
            </Title>
            <Button component={Link} href={`/browse/${t.schema}/${t.name}`} size="xs" variant="light">
              浏览数据
            </Button>
          </Group>
          {ddls[`${t.schema}.${t.name}`] && (
            <details style={{ marginTop: 6 }}>
              <summary>查看 DDL</summary>
              <Code block mt="xs">{ddls[`${t.schema}.${t.name}`]}</Code>
            </details>
          )}
          <Table mt="xs" striped withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>列名</Table.Th>
                <Table.Th>数据类型</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {t.columns.map((c) => (
                <Table.Tr key={c.name}>
                  <Table.Td>{c.name}</Table.Td>
                  <Table.Td>
                    <Text c="dimmed">{c.dataType}{c.nullable === false ? ' NOT NULL' : ''}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      ))}
    </Stack>
  )
}
