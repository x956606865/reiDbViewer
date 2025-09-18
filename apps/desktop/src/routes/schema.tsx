import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Button, Code, Group, Loader, Modal, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import { IconX, IconEyeOff } from '@tabler/icons-react'
import { getCurrent } from '@/lib/localStore'
import { subscribeCurrentConnId, getCurrentConnId } from '@/lib/current-conn'
import { getDsnForConn } from '@/lib/localStore'
import { readSchemaCache, writeSchemaCache } from '@/lib/schema-cache'
import { applySchemaMetadataPayload } from '@/lib/schema-metadata-store'
import { introspectPostgres } from '@/lib/introspect'
import { loadIndexes, type IndexInfo } from '@/lib/indexes'
import { useSchemaHide } from '@/lib/schema-hide'

type ColumnMeta = { name: string; dataType: string; nullable?: boolean; isPrimaryKey?: boolean }
type TableMeta = { schema: string; name: string; columns: ColumnMeta[] }

function asSchemaCachePayload(res: Awaited<ReturnType<typeof introspectPostgres>>) {
  return {
    databases: res.databases,
    schemas: res.schemas,
    tables: res.tables.map((table) => ({
      schema: table.schema,
      name: table.name,
      columns: table.columns.map((col) => ({
        name: col.name,
        dataType: col.dataType,
        nullable: col.nullable,
        isPrimaryKey: col.isPrimaryKey,
        ...(col.isForeignKey ? { isForeignKey: true as const, references: col.references } : {}),
      })),
    })),
    ddls: res.ddls,
  }
}

export default function SchemaPage() {
  const [userConnId, setUserConnId] = useState<string | null>(getCurrent())
  const [tables, setTables] = useState<TableMeta[]>([])
  const [databases, setDatabases] = useState<string[]>([])
  const [schemas, setSchemas] = useState<string[]>([])
  const [ddls, setDdls] = useState<Record<string, string>>({})
  const [cachedAt, setCachedAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSchema, setSelectedSchema] = useState<string>('')
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const { rules, addPrefix, removePrefix, addTable, removeTable, clear } = useSchemaHide(userConnId)

  // load cache on mount/conn change
  useEffect(() => {
    // keep in sync with global current-conn changes
    const unsub = subscribeCurrentConnId((id) => setUserConnId(id))
    setUserConnId(getCurrentConnId())
    return unsub
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    if (!userConnId) {
      // no connection → empty view, nudge to choose connection
      setTables([]); setSchemas([]); setDatabases([]); setDdls({}); setCachedAt(null)
      setLoading(false)
      return
    }
    readSchemaCache(userConnId)
      .then((res) => {
        if (res) {
          setTables((res.payload as any).tables || [])
          setSchemas((res.payload as any).schemas || [])
          setDatabases((res.payload as any).databases || [])
          const map: Record<string, string> = {}
          for (const d of ((res.payload as any).ddls || [])) map[`${d.schema}.${d.name}`] = d.ddl
          setDdls(map)
          setCachedAt(res.updatedAt || null)
          if (userConnId) {
            applySchemaMetadataPayload(userConnId, res.payload, res.updatedAt || undefined)
          }
        } else {
          setTables([]); setSchemas([]); setDatabases([]); setDdls({}); setCachedAt(null)
        }
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [userConnId])

  // keyboard shortcuts: '/' focus, Esc clear
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      const isTyping = tag === 'input' || tag === 'textarea'
      if (e.key === '/' && !isTyping) { e.preventDefault(); searchRef.current?.focus() }
      else if (e.key === 'Escape' && document.activeElement === searchRef.current) setSearch('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onRefresh = async () => {
    if (!userConnId) { setError('请先选择当前连接（右上角）。'); return }
    setLoading(true)
    setError(null)
    try {
      const dsn = await getDsnForConn(userConnId)
      const res = await introspectPostgres(dsn)
      const payload = asSchemaCachePayload(res)
      await writeSchemaCache(userConnId, payload)
      setTables(payload.tables || [])
      setDatabases(payload.databases || [])
      setSchemas(payload.schemas || [])
      const map: Record<string, string> = {}
      for (const d of payload.ddls || []) map[`${d.schema}.${d.name}`] = d.ddl
      setDdls(map)
      const nowSec = Math.floor(Date.now() / 1000)
      setCachedAt(nowSec)
      if (userConnId) {
        applySchemaMetadataPayload(userConnId, payload, nowSec)
      }
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (/secure storage|keyring|No matching entry/i.test(msg)) {
        setError('未找到当前连接的凭据。请到“Connections”页面重新保存该连接，或重新选择连接后再试。')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const searchLower = search.trim().toLowerCase()
  const filteredTables = useMemo(() => (
    (selectedSchema ? tables.filter((t) => t.schema === selectedSchema) : tables)
      .filter((t) => !searchLower
        ? true
        : t.name.toLowerCase().includes(searchLower) || `${t.schema}.${t.name}`.toLowerCase().includes(searchLower))
      .filter((t) => {
        const fq = `${t.schema}.${t.name}`
        if (rules.tables.includes(fq)) return false
        if (rules.prefixes.some((p) => t.name.startsWith(p))) return false
        return true
      })
  ), [tables, selectedSchema, searchLower, rules])

  // indexes modal
  const [idxOpen, setIdxOpen] = useState(false)
  const [idxLoading, setIdxLoading] = useState(false)
  const [idxError, setIdxError] = useState<string | null>(null)
  const [indexes, setIndexes] = useState<IndexInfo[]>([])
  const [idxTarget, setIdxTarget] = useState<{ schema: string; table: string } | null>(null)
  const openIndexes = async (schema: string, table: string) => {
    if (!userConnId) return
    setIdxTarget({ schema, table }); setIdxOpen(true); setIdxLoading(true); setIdxError(null)
    try {
      const dsn = await getDsnForConn(userConnId)
      const rows = await loadIndexes(dsn, schema, table)
      setIndexes(rows)
    } catch (e: any) {
      setIdxError(String(e?.message || e))
    } finally {
      setIdxLoading(false)
    }
  }

  return (
    <>
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
            <Text c="dimmed" size="sm">数据库：{databases.length} 个；Schema：{schemas.length} 个；表：{tables.length} 张（可见 {filteredTables.length}）</Text>
            <Text c="dimmed" size="sm">{cachedAt ? `缓存时间：${new Date((cachedAt || 0) * 1000).toLocaleString()}` : '无缓存（请刷新）'}</Text>
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
                  <TextInput label="按前缀隐藏" placeholder="如 tmp_ 或 _shadow" onKeyDown={(e) => {
                    if (e.key === 'Enter') addPrefix((e.target as HTMLInputElement).value)
                  }} style={{ width: 260 }} />
                  <Button size="xs" color="gray" variant="subtle" onClick={clear}>清除全部</Button>
                </Group>
                {rules.prefixes.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <Text size="sm" c="dimmed">已隐藏的前缀：</Text>
                    <Group gap={6} mt={4}>
                      {rules.prefixes.map((p) => (
                        <Badge key={p} variant="light" rightSection={<ActionIcon size="xs" variant="subtle" onClick={() => removePrefix(p)} aria-label="remove"><IconX size={12} /></ActionIcon>}>{p}</Badge>
                      ))}
                    </Group>
                  </div>
                )}
                {rules.tables.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <Text size="sm" c="dimmed">已隐藏的表：</Text>
                    <Group gap={6} mt={4}>
                      {rules.tables.map((fq) => (
                        <Badge key={fq} variant="light" rightSection={<ActionIcon size="xs" variant="subtle" onClick={() => removeTable(fq)} aria-label="remove"><IconX size={12} /></ActionIcon>}>{fq}</Badge>
                      ))}
                    </Group>
                  </div>
                )}
              </div>
            </details>
          </Group>
        </div>

        {!loading && error && (
          <Text c="red">加载失败：{error}</Text>
        )}
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
              <Group gap="xs">
                <Button size="xs" variant="subtle" leftSection={<IconEyeOff size={14} />} onClick={() => addTable(`${t.schema}.${t.name}`)}>
                  隐藏此表
                </Button>
                <Button size="xs" variant="light" onClick={() => openIndexes(t.schema, t.name)}>查看索引</Button>
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => {
                    try { localStorage.setItem('rdv.lastBrowseTarget', JSON.stringify({ schema: t.schema, table: t.name })) } catch {}
                    location.hash = 'browse'
                  }}
                >
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
