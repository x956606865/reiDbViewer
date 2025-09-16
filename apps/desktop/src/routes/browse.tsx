import { useEffect, useMemo, useState } from 'react'
import { ActionIcon, Badge, Button, Code, Group, Loader, Paper, Select, Stack, Text, Title } from '@mantine/core'
import { IconPlayerTrackNext, IconPlayerTrackPrev, IconReload } from '@tabler/icons-react'
import SmartGrid from '@/components/SmartGrid'
import { getCurrent } from '@/lib/localStore'
import { getDsnForConn } from '@/lib/localStore'
import { readSchemaCache } from '@/lib/schema-cache'
import { ReadonlyDb } from '@/lib/dbClient'
import { buildSelectSql } from '@rei-db-view/query-engine'
import type { ColumnRef, ColumnSelect, OrderByItem, Select as SelectAst, WhereOp } from '@rei-db-view/types/ast'

type TableMeta = { schema: string; name: string; columns: Array<{ name: string; dataType: string; nullable?: boolean; isPrimaryKey?: boolean }> }

const pageSizeDefault = 100

export default function BrowsePage() {
  const [userConnId] = useState<string | null>(getCurrent())
  const [tables, setTables] = useState<TableMeta[]>([])
  const [schemas, setSchemas] = useState<string[]>([])
  const [schema, setSchema] = useState<string>('')
  const [table, setTable] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<any[]>([])
  const [cols, setCols] = useState<string[]>([])
  const [sqlPreview, setSqlPreview] = useState<string>('')
  const [paramsPreview, setParamsPreview] = useState<any[]>([])
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(pageSizeDefault)
  const [sorting, setSorting] = useState<any>([])
  const [filters, setFilters] = useState<any>([])

  useEffect(() => {
    if (!userConnId) return
    readSchemaCache(userConnId)
      .then((res) => {
        const tbs = (res?.payload?.tables || []) as TableMeta[]
        setTables(tbs)
        const schs = Array.from(new Set(tbs.map((t) => t.schema))).sort()
        setSchemas(schs)
        // prefer last target from Schema page if available
        let target: { schema?: string; table?: string } = {}
        try { target = JSON.parse(localStorage.getItem('rdv.lastBrowseTarget') || '{}') } catch {}
        const hasTarget = target.schema && target.table && tbs.some((t) => t.schema === target.schema && t.name === target.table)
        if (hasTarget) {
          setSchema(String(target.schema))
          setTable(String(target.table))
        } else {
          if (schs.length && !schema) setSchema(schs[0])
          const t0 = tbs.find((t) => t.schema === (schs[0] || '') )
          if (t0 && !table) setTable(t0.name)
        }
      })
      .catch((e) => setError(String(e?.message || e)))
  }, [userConnId])

  const currentTableMeta = useMemo(() => tables.find((t) => t.schema === schema && t.name === table) || null, [tables, schema, table])
  useEffect(() => {
    if (currentTableMeta) setCols(currentTableMeta.columns.map((c) => c.name))
    else setCols([])
  }, [currentTableMeta])

  function classify(dt: string): 'json' | 'text' | 'number' | 'date' {
    const s = dt?.toLowerCase?.() || ''
    if (s.includes('json')) return 'json'
    if (/(int|numeric|decimal|real|double|money|bigint|smallint)/.test(s)) return 'number'
    if (/(timestamp|date|time)/.test(s)) return 'date'
    return 'text'
  }

  function parseFilters(t: TableMeta, alias: string, list: any[]): WhereOp[] {
    const wh: WhereOp[] = []
    for (const f of list || []) {
      const id = String(f?.id || '')
      if (!id) continue
      const col = t.columns.find((c) => c.name === id)
      if (!col) continue
      const raw = f?.value
      const v = String(raw ?? '').trim()
      if (!v) continue
      const kind = classify(col.dataType)
      const left: ColumnRef = { kind: 'colref', table: alias, name: id }
      if (kind === 'json') {
        if (v.startsWith('@>')) {
          const jsonText = v.replace(/^@>\s*/, '')
          try { JSON.parse(jsonText) } catch { continue }
          wh.push({ kind: 'json_contains', left, right: { kind: 'param', value: jsonText } })
          continue
        }
        if (v.toLowerCase().startsWith('path:')) {
          const path = v.slice(5).trim()
          if (path) wh.push({ kind: 'json_path_exists', left, right: { kind: 'param', value: path } })
          continue
        }
        wh.push({ kind: 'ilike', left, right: { kind: 'param', value: `%${v}%` }, castText: true })
        continue
      }
      if (kind === 'text') wh.push({ kind: 'ilike', left, right: { kind: 'param', value: `%${v}%` } })
      else wh.push({ kind: 'eq', left, right: { kind: 'param', value: v } })
    }
    return wh
  }

  const run = async () => {
    if (!userConnId || !currentTableMeta) return
    setLoading(true)
    setError(null)
    try {
      const dsn = await getDsnForConn(userConnId)
      // build AST
      const alias = 't'
      const from = { schema: currentTableMeta.schema, name: currentTableMeta.name, alias }
      const columns: ColumnSelect[] = currentTableMeta.columns.map((c) => ({ kind: 'column', ref: { kind: 'colref', table: alias, name: c.name } }))
      const where: WhereOp[] = parseFilters(currentTableMeta, alias, filters)
      let orderBy: OrderByItem[] | undefined = undefined
      if (Array.isArray(sorting) && sorting.length > 0) {
        orderBy = sorting.map((s: any) => ({ expr: { kind: 'colref', table: alias, name: String(s.id) }, dir: s.desc ? 'DESC' : 'ASC' }))
      } else {
        const pks = currentTableMeta.columns.filter((c) => c.isPrimaryKey)
        if (pks.length > 0) orderBy = pks.map((c) => ({ expr: { kind: 'colref', table: alias, name: c.name }, dir: 'ASC' as const }))
      }
      const ast: SelectAst = { columns, from, where, orderBy, limit: pageSize, offset: page * pageSize }
      const built = buildSelectSql(ast)
      setSqlPreview(built.text)
      setParamsPreview(built.values)
      const db = await ReadonlyDb.openPostgres(dsn)
      const result = await db.select<any>(built.text, built.values)
      setRows(result)
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (/secure storage|keyring|No matching entry/i.test(msg)) {
        setError('未找到当前连接的凭据。请到“Connections”页面重新保存该连接，或重新选择连接后再试。')
      } else {
        setError(msg)
      }
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { setPage(0) }, [schema, table])
  useEffect(() => { if (currentTableMeta) run() }, [currentTableMeta, page, pageSize])
  useEffect(() => { if (currentTableMeta) run() }, [sorting])

  const canPrev = page > 0
  const canNext = rows.length >= pageSize // 乐观判定：等于 pageSize 可能还有下一页

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Title order={3}>表数据浏览</Title>
          <Text c="dimmed">M3 MVP：排序/筛选/分页与 SQL 预览；Keyset 跳页后续增强。</Text>
        </div>
        <Group>
          <ActionIcon variant="subtle" color="gray" onClick={() => run()} aria-label="刷新" title="刷新">
            <IconReload size={18} />
          </ActionIcon>
        </Group>
      </Group>

      <Group gap="sm" wrap="wrap">
        <Select label="Schema" data={schemas.map((s) => ({ value: s, label: s }))} value={schema} onChange={(v) => setSchema(v || '')} styles={{ root: { width: 220 } }} />
        <Select
          label="Table"
          data={tables.filter((t) => t.schema === schema).map((t) => ({ value: t.name, label: t.name }))}
          value={table}
          onChange={(v) => setTable(v || '')}
          styles={{ root: { width: 280 } }}
        />
        <Select
          label="每页"
          data={[50, 100, 200, 500].map((n) => ({ value: String(n), label: String(n) }))}
          value={String(pageSize)}
          onChange={(v) => setPageSize(Number(v || pageSizeDefault))}
          styles={{ root: { width: 120 } }}
        />
        <Group gap={6} align="end">
          <Button size="xs" variant="default" leftSection={<IconPlayerTrackPrev size={16} />} disabled={!canPrev} onClick={() => setPage((p) => Math.max(0, p - 1))}>上一页</Button>
          <Button size="xs" variant="default" rightSection={<IconPlayerTrackNext size={16} />} disabled={!canNext} onClick={() => setPage((p) => p + 1)}>下一页</Button>
          <Badge variant="light">第 {page + 1} 页</Badge>
        </Group>
      </Group>

      {loading && (
        <Group gap="xs"><Loader size="sm" /><Text c="dimmed">加载中…</Text></Group>
      )}
      {error && (
        <Text c="red">{error}</Text>
      )}

      <div style={{ minWidth: 0 }}>
        <SmartGrid
          columns={cols}
          rows={rows}
          sorting={sorting}
          onSortingChange={setSorting}
          columnFilters={filters}
          onColumnFiltersChange={setFilters}
          onApplyFilters={() => { setPage(0); run() }}
          jsonColumns={currentTableMeta ? currentTableMeta.columns.filter(c => /json/i.test(c.dataType)).map(c => c.name) : []}
          height={480}
        />
      </div>

      <Paper withBorder p="sm">
        <Text fw={600} size="sm">SQL 预览</Text>
        <Code block mt={6}>{sqlPreview || '--'}</Code>
        {paramsPreview.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <Text size="sm" c="dimmed">参数：{JSON.stringify(paramsPreview)}</Text>
          </div>
        )}
      </Paper>
    </Stack>
  )
}
