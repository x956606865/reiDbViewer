"use client"

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { Button, Group, Loader, Paper, Select, Stack, Table, Text, Title, Code, Modal, Badge, TextInput, CloseButton, ActionIcon } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useCurrentConnId } from '@/lib/current-conn'
import { useSchemaHide } from '@/lib/schema-hide'
import { IconEyeOff, IconX } from '@tabler/icons-react'

type ColumnMeta = { name: string; dataType: string; nullable?: boolean; isPrimaryKey?: boolean }
type TableMeta = { schema: string; name: string; columns: ColumnMeta[] }
type IndexInfo = {
  name: string
  definition: string
  method: string | null
  isUnique: boolean
  isPrimary: boolean
  isValid: boolean
  isPartial: boolean
  idxScan: number
  idxTupRead: number
  idxTupFetch: number
  sizeBytes: number
  sizePretty: string
}

export default function SchemaPage() {
  const [tables, setTables] = useState<TableMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [databases, setDatabases] = useState<string[]>([])
  const [schemas, setSchemas] = useState<string[]>([])
  const [ddls, setDdls] = useState<Record<string, string>>({})
  const [indexCache, setIndexCache] = useState<Record<string, IndexInfo[]>>({})
  const [userConnId] = useCurrentConnId()
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [selectedSchema, setSelectedSchema] = useState<string>('')
  const [idxOpen, setIdxOpen] = useState(false)
  const [idxTarget, setIdxTarget] = useState<{ schema: string; table: string } | null>(null)
  const [idxLoading, setIdxLoading] = useState(false)
  const [idxError, setIdxError] = useState<string | null>(null)
  const [indexes, setIndexes] = useState<IndexInfo[]>([])
  const { rules, addPrefix, removePrefix, addTable, removeTable, clear } = useSchemaHide(userConnId)
  const [prefixInput, setPrefixInput] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch] = useDebouncedValue(search, 300)
  const lastFetchId = useRef(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const indexCacheRef = useRef<Record<string, IndexInfo[]>>({})

  useEffect(() => {
    indexCacheRef.current = {}
    setIndexCache({})
  }, [userConnId])

  const applySchemaPayload = useCallback((json: any, fetchId: number) => {
    if (fetchId !== lastFetchId.current) return
    const tableList: TableMeta[] = Array.isArray(json.tables) ? json.tables : []
    const schemaList: string[] = Array.isArray(json.schemas) ? json.schemas : []
    const databaseList: string[] = Array.isArray(json.databases) ? json.databases : []
    setTables(tableList)
    setSchemas(schemaList)
    setDatabases(databaseList)
    setCachedAt(json.cachedAt ?? null)
    const ddlMap: Record<string, string> = {}
    if (Array.isArray(json.ddls)) {
      for (const d of json.ddls) {
        if (d && typeof d.schema === 'string' && typeof d.name === 'string' && typeof d.ddl === 'string') {
          ddlMap[`${d.schema}.${d.name}`] = d.ddl
        }
      }
    }
    setDdls(ddlMap)
    if (Array.isArray(json.indexes)) {
      const ixMap: Record<string, IndexInfo[]> = {}
      for (const entry of json.indexes) {
        if (entry && typeof entry.schema === 'string' && typeof entry.name === 'string' && Array.isArray(entry.indexes)) {
          ixMap[`${entry.schema}.${entry.name}`] = entry.indexes as IndexInfo[]
        }
      }
      // Prefetched payload only lists tables that have indexes; fill others with [] to skip extra fetches.
      for (const table of tableList) {
        const fq = `${table.schema}.${table.name}`
        if (!(fq in ixMap)) ixMap[fq] = []
      }
      indexCacheRef.current = ixMap
      setIndexCache(ixMap)
    } else {
      indexCacheRef.current = {}
      setIndexCache({})
    }
    setSelectedSchema((prev) => (prev && schemaList.includes(prev) ? prev : ''))
  }, [])

  // Shortcut: '/' 聚焦搜索，Esc 清空
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      const isTyping = tag === 'input' || tag === 'textarea'
      if (e.key === '/' && !isTyping) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setSearch('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const fetchSchema = async () => {
      const url = userConnId ? `/api/schema/tables?userConnId=${encodeURIComponent(userConnId)}` : '/api/schema/tables'
      const fetchId = ++lastFetchId.current
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(url)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error || json?.message || '加载元数据失败')
        applySchemaPayload(json, fetchId)
      } catch (e: any) {
        if (fetchId === lastFetchId.current) setError(String(e?.message || e))
      } finally {
        if (fetchId === lastFetchId.current) setLoading(false)
      }
    }
    fetchSchema()
  }, [userConnId, applySchemaPayload])

  const onRefresh = async () => {
    if (!userConnId) {
      setError('请先在“连接”中选择当前连接（localStorage: rdv.currentUserConnId）。')
      return
    }
    const fetchId = ++lastFetchId.current
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
      applySchemaPayload({ ...json, cachedAt: new Date().toISOString() }, fetchId)
    } catch (e: any) {
      if (fetchId === lastFetchId.current) setError(String(e.message || e))
    } finally {
      if (fetchId === lastFetchId.current) setLoading(false)
    }
  }

  const filteredTables = useMemo(() => (
    selectedSchema ? tables.filter((t) => t.schema === selectedSchema) : tables
  ), [tables, selectedSchema])
  const searchLower = debouncedSearch.trim().toLowerCase()
  const filteredAndSearched = useMemo(() => (
    !searchLower
      ? filteredTables
      : filteredTables.filter((t) => {
          const fq = `${t.schema}.${t.name}`.toLowerCase()
          return t.name.toLowerCase().includes(searchLower) || fq.includes(searchLower)
        })
  ), [filteredTables, searchLower])
  const visibleTables = useMemo(() => (
    filteredAndSearched.filter((t) => {
      const fq = `${t.schema}.${t.name}`
      if (rules.tables.includes(fq)) return false
      if (rules.prefixes.some((p) => t.name.startsWith(p))) return false
      return true
    })
  ), [filteredAndSearched, rules])

  const openIndexes = async (schema: string, table: string) => {
    const fq = `${schema}.${table}`
    setIdxTarget({ schema, table })
    setIdxError(null)
    setIdxOpen(true)
    const cached = indexCacheRef.current[fq] ?? indexCache[fq]
    if (cached) {
      setIdxLoading(false)
      setIndexes(cached)
      return
    }
    setIdxLoading(true)
    try {
      const url = userConnId
        ? `/api/schema/indexes?schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}&userConnId=${encodeURIComponent(userConnId)}`
        : `/api/schema/indexes?schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(table)}`
      const res = await fetch(url)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.message || json?.error || '加载索引失败')
      const list: IndexInfo[] = json.indexes || []
      setIndexes(list)
      indexCacheRef.current = { ...indexCacheRef.current, [fq]: list }
      setIndexCache((prev) => ({ ...prev, [fq]: list }))
    } catch (e: any) {
      setIdxError(String(e?.message || e))
    } finally {
      setIdxLoading(false)
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

  return (
    <>
    {/* 防止内部表格/代码块导致整页横向滚动 */}
    <Stack gap="md" style={{ minWidth: 0 }}>
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
          <Text c="dimmed" size="sm">数据库：{databases.length} 个；Schema：{schemas.length} 个；表：{tables.length} 张（可见 {visibleTables.length}）</Text>
          <Text c="dimmed" size="sm">{cachedAt ? `缓存时间：${new Date(cachedAt).toLocaleString()}` : '无缓存（请刷新）'}</Text>
          <Select
            label="筛选 Schema"
            placeholder="全部"
            value={selectedSchema}
            onChange={(v) => setSelectedSchema(v || '')}
            data={[{ value: '', label: '全部 Schema' }, ...schemas.map((s) => ({ value: s, label: s }))]}
            styles={{ root: { width: 240 } }}
          />
          <TextInput
            label="搜索表"
            placeholder="输入表名或 schema.table"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            ref={searchRef}
            rightSection={search ? (
              <ActionIcon size="sm" variant="subtle" onClick={() => setSearch('')} aria-label="清空搜索">
                <IconX size={14} />
              </ActionIcon>
            ) : null}
            rightSectionPointerEvents={search ? 'auto' : 'none'}
            style={{ width: 320 }}
          />
          <details>
            <summary>隐藏规则（{rules.prefixes.length + rules.tables.length}）</summary>
            <div style={{ marginTop: 8 }}>
              <Group gap="xs">
                <TextInput label="按前缀隐藏" placeholder="如 tmp_ 或 _shadow" value={prefixInput} onChange={(e) => setPrefixInput(e.currentTarget.value)} style={{ width: 260 }} />
                <Button size="xs" variant="light" onClick={() => { addPrefix(prefixInput); setPrefixInput('') }}>添加前缀</Button>
                <Button size="xs" color="gray" variant="subtle" onClick={clear}>清除全部</Button>
              </Group>
              {rules.prefixes.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <Text size="sm" c="dimmed">已隐藏的前缀：</Text>
                  <Group gap={6} mt={4}>
                    {rules.prefixes.map((p) => (
                      <Badge key={p} variant="light" rightSection={<CloseButton size="xs" onClick={() => removePrefix(p)} aria-label="remove" />}>{p}</Badge>
                    ))}
                  </Group>
                </div>
              )}
              {rules.tables.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <Text size="sm" c="dimmed">已隐藏的表：</Text>
                  <Group gap={6} mt={4}>
                    {rules.tables.map((fq) => (
                      <Badge key={fq} variant="light" rightSection={<CloseButton size="xs" onClick={() => removeTable(fq)} aria-label="remove" />}>{fq}</Badge>
                    ))}
                  </Group>
                </div>
              )}
            </div>
          </details>
        </Group>
      </div>
      {userConnId && !cachedAt && visibleTables.length === 0 && (
        <Paper withBorder p="md">
          <Text>当前连接尚无元数据缓存，请点击右上角“刷新元数据”。</Text>
        </Paper>
      )}
      {visibleTables.map((t) => (
        <Paper withBorder p="sm" key={`${t.schema}.${t.name}`}>
          <Group justify="space-between" align="center">
            <Title order={5}>
              {t.schema}.{t.name}
            </Title>
            <Group gap="xs">
              <Button size="xs" variant="subtle" leftSection={<IconEyeOff size={14} />} onClick={() => addTable(`${t.schema}.${t.name}`)}>
                隐藏此表
              </Button>
              <Button size="xs" variant="light" onClick={() => openIndexes(t.schema, t.name)}>查看索引</Button>
              <Button component={Link} href={`/browse/${t.schema}/${t.name}` as any} size="xs" variant="light">
                浏览数据
              </Button>
            </Group>
          </Group>
          {ddls[`${t.schema}.${t.name}`] && (
            <details style={{ marginTop: 6 }}>
              <summary>查看 DDL</summary>
              <Code block mt="xs">{ddls[`${t.schema}.${t.name}`]}</Code>
            </details>
          )}
          <details style={{ marginTop: 6 }}>
            <summary>查看列（{t.columns.length}）</summary>
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
          </details>
        </Paper>
      ))}
    </Stack>

      <Modal opened={idxOpen} onClose={() => setIdxOpen(false)} title={`索引：${idxTarget ? idxTarget.schema + '.' + idxTarget.table : ''}`} size="lg">
        {idxLoading && (
          <Stack gap="xs"><Loader size="sm" /><Text c="dimmed">加载索引…</Text></Stack>
        )}
        {idxError && <Text c="red">{idxError}</Text>}
        {!idxLoading && !idxError && indexes.length === 0 && <Text c="dimmed">无索引</Text>}
        {!idxLoading && !idxError && indexes.length > 0 && (
          <Table striped withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>名称</Table.Th>
                <Table.Th>方法</Table.Th>
                <Table.Th>属性</Table.Th>
                <Table.Th>扫描</Table.Th>
                <Table.Th>读取/返回</Table.Th>
                <Table.Th>大小</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {indexes.map((ix) => (
                <Table.Tr key={ix.name}>
                  <Table.Td>{ix.name}</Table.Td>
                  <Table.Td>{ix.method || '-'}</Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="wrap">
                      {ix.isPrimary && <Badge color="blue" variant="light">PK</Badge>}
                      {ix.isUnique && <Badge color="grape" variant="light">UNIQUE</Badge>}
                      {!ix.isValid && <Badge color="red">INVALID</Badge>}
                      {ix.isPartial && <Badge color="orange" variant="light">PARTIAL</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{ix.idxScan}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{ix.idxTupRead} / {ix.idxTupFetch}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" title={`${ix.sizeBytes} bytes`}>{ix.sizePretty}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {!idxLoading && !idxError && indexes.length > 0 && (
          <Paper withBorder p="sm" mt="sm">
            <Text fw={600} mb={6}>定义</Text>
            {indexes.map((ix) => (
              <div key={'def-' + ix.name} style={{ marginBottom: 8 }}>
                <Text fw={500}>{ix.name}</Text>
                <Code block>{ix.definition}</Code>
              </div>
            ))}
          </Paper>
        )}
      </Modal>
    </>
  )
}
