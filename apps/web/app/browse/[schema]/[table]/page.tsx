"use client"

import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Code, Group, NumberInput, Paper, Stack, Text, Title, CloseButton } from '@mantine/core'
import type { MRT_ColumnFiltersState as ColumnFiltersState, MRT_SortingState as SortingState } from 'mantine-react-table'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import SmartGrid from '../../../../components/SmartGrid'
import { useCurrentConnId } from '@/lib/current-conn'

type ColumnMeta = { name: string; dataType: string; nullable?: boolean; isPrimaryKey?: boolean }
type TableMeta = { schema: string; name: string; columns: ColumnMeta[] }

export default function BrowseTablePage() {
  const params = useParams<{ schema: string; table: string }>()
  const schema = params?.schema
  const table = params?.table

  const [userConnId] = useCurrentConnId()
  const [meta, setMeta] = useState<TableMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sql, setSql] = useState<string>("")
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(50)
  const [gridCols, setGridCols] = useState<string[]>([])
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [sorting, setSorting] = useState<SortingState>([])
  // applied filters: 已应用到后端
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  // pending filters: 筛选框中的草稿，只有点击“应用”才会生效
  const [pendingFilters, setPendingFilters] = useState<ColumnFiltersState>([])

  useEffect(() => {
    if (!schema || !table) return
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        // 先尝试轻量的 mock/schema 接口（便于在未配置 APP_DB_URL 时也能展示）
        const basicUrl = userConnId
          ? `/api/schema/tables?userConnId=${encodeURIComponent(userConnId)}`
          : '/api/schema/tables'
        const basic = await fetch(basicUrl).then((r) => r.json()).catch(() => null)
        let found: TableMeta | null = null
        if (basic?.tables) {
          found = (basic.tables as TableMeta[]).find((t) => t.schema === schema && t.name === table) || null
        }
        // 若未命中且具备当前连接，尝试刷新真实元数据
        if (!found && userConnId) {
          try {
            const res = await fetch('/api/schema/refresh', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ userConnId }),
            })
            const json = await res.json()
            if (res.ok) {
              found = (json.tables as TableMeta[]).find((t) => t.schema === schema && t.name === table) || null
            }
          } catch {}
        }
        if (!found) throw new Error('未找到该表的元数据，请先在 /schema 刷新元数据。')
        setMeta(found)
      } catch (e: any) {
        setError(String(e?.message || e))
      } finally {
        setLoading(false)
      }
    }
    load()
    // 仅在 schema/table/userConnId 变化时重新加载元数据
  }, [schema, table, userConnId])

  const buildAst = useMemo(() => {
    function classify(dt: string): 'json' | 'text' | 'number' | 'date' {
      const s = dt.toLowerCase()
      if (s.includes('json')) return 'json'
      if (/(int|numeric|decimal|real|double|money|bigint|smallint)/.test(s)) return 'number'
      if (/(timestamp|date|time)/.test(s)) return 'date'
      return 'text'
    }
    function parseFilters(t: TableMeta, alias: string, filters: ColumnFiltersState) {
      const wh: any[] = []
      for (const f of filters) {
        const id = String((f as any).id)
        const col = t.columns.find((c) => c.name === id)
        if (!col) continue
        const raw = (f as any).value
        const v = String(raw ?? '').trim()
        if (!v) continue
        const kind = classify(col.dataType)
        const left = { kind: 'colref', table: alias, name: id }
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
        const m = v.match(/^([<>]=?|=)\s*(.+)$/)
        const range = v.match(/^(.*)\.\.(.*)$/)
        if (range) {
          const a = (range?.[1] ?? '').trim(), b = (range?.[2] ?? '').trim()
          if (a) wh.push({ kind: 'gte', left, right: { kind: 'param', value: a } })
          if (b) wh.push({ kind: 'lte', left, right: { kind: 'param', value: b } })
          continue
        }
        if (m) {
          const op = String(m[1] ?? '')
          const val = m[2]
          const map: any = { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', '=': 'eq' }
          const k = map[op]
          if (k === 'eq') wh.push({ kind: 'eq', left, right: { kind: 'param', value: val } })
          else wh.push({ kind: k, left, right: { kind: 'param', value: val } })
          continue
        }
        if (kind === 'text') wh.push({ kind: 'ilike', left, right: { kind: 'param', value: `%${v}%` } })
        else wh.push({ kind: 'eq', left, right: { kind: 'param', value: v } })
      }
      return wh
    }
    return (t: TableMeta, pageIndex: number, size: number, sortingState: SortingState, filters: ColumnFiltersState) => {
      const alias = 't'
      const orderPk = t.columns.filter((c) => c.isPrimaryKey)
      const base: any = {
        from: { schema: t.schema, name: t.name, alias },
        columns: t.columns.map((c) => ({ kind: 'column', ref: { kind: 'colref', table: alias, name: c.name } })),
        orderBy: undefined as any,
        where: parseFilters(t, alias, filters),
        limit: size,
        offset: Math.max(0, pageIndex) * size,
      }
      if (sortingState && sortingState.length > 0) {
        base.orderBy = sortingState.map((s) => ({ expr: { kind: 'colref', table: alias, name: s.id }, dir: s.desc ? 'DESC' : 'ASC' as const }))
      } else if (orderPk.length) {
        base.orderBy = orderPk.map((c) => ({ expr: { kind: 'colref', table: alias, name: c.name }, dir: 'ASC' as const }))
      }
      return base
    }
  }, [])

  const runQuery = async (pageIndex: number, size: number) => {
    if (!meta) return
    setLoading(true)
    setError(null)
    try {
      const ast = buildAst(meta, pageIndex, size, sorting, columnFilters)
      let columns: string[] = meta.columns.map((c) => c.name)
      let execOk = false
      if (userConnId) {
        try {
          const res = await fetch('/api/query/execute', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ select: ast, userConnId }),
          })
          const json = await res.json()
          if (res.ok) {
            execOk = true
            setSql(json.sql || '')
            const apiCols: string[] = Array.isArray(json.columns) && json.columns.length > 0 ? json.columns : columns
            setGridCols(apiCols)
            setRows((json.rows as Array<Record<string, unknown>>) || [])
          } else {
            // 失败时优先展示详细 message（如 permission denied），回退到 error 码
            setError(String(json?.message || json?.error || `查询失败（HTTP ${res.status}）`))
            columns = (json.preview?.columns as string[]) || columns
            setSql(json.preview?.text || '')
            setGridCols(columns)
            setRows([])
          }
        } catch (e: any) {
          setError(String(e?.message || e))
        }
      }
      if (!execOk) {
        // 无连接或执行失败时走 SQL 预览，至少展示生成的 SQL
        try {
          const res = await fetch('/api/query/preview', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ select: ast }),
          })
          const json = await res.json()
          setSql(json.sql || json.text || '')
          const apiCols: string[] = Array.isArray(json.columns) && json.columns.length > 0 ? json.columns : columns
          setGridCols(apiCols)
          setRows([])
        } catch {}
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (meta) runQuery(page, pageSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, page, pageSize])
  // 当排序或筛选变化时，自动重置到第 1 页并刷新（即使 page 已为 0 也会刷新）
  useEffect(() => {
    if (!meta) return
    // 保持 page 状态为 0，但无论是否变化都触发一次查询
    setPage(0)
    runQuery(0, pageSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting, columnFilters])

  const onRefresh = () => runQuery(page, pageSize)

  if (!schema || !table) return <Text c="red">非法路径</Text>

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <div>
          <Title order={3}>{schema}.{table}</Title>
          <Text c="dimmed" size="sm">当前连接: {userConnId ?? '未选择（仅预览 SQL）'}</Text>
        </div>
        <Group gap="xs">
          <NumberInput
            label="每页行数"
            value={pageSize}
            min={1}
            max={1000}
            onChange={(v) => setPageSize(Number(v) || 50)}
            allowNegative={false}
            clampBehavior="strict"
            styles={{ root: { width: 140 } }}
          />
          <Button variant="default" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading}>上一页</Button>
          <Button variant="default" onClick={() => setPage((p) => p + 1)} disabled={loading}>下一页</Button>
          <Button onClick={onRefresh} loading={loading}>刷新</Button>
          <Button component={Link} href={`/schema`} variant="light">返回 Schema</Button>
        </Group>
      </Group>

      {error && (
        <Text c="red">{error}</Text>
      )}

      <Paper withBorder p="sm">
        <Text fw={600} mb={6}>SQL</Text>
        <Code block>{sql || '-- 无 SQL（等待生成）'}</Code>
      </Paper>

      {(columnFilters.length > 0 || JSON.stringify(pendingFilters) !== JSON.stringify(columnFilters)) && (
        <Group gap="xs" align="center">
          <Text size="sm" c="dimmed">已筛选:</Text>
          {columnFilters.map((f, idx) => (
            <Badge key={(f as any).id + ':' + idx} variant="light" rightSection={
              <CloseButton size="xs" onClick={() => {
                const id = String((f as any).id)
                setColumnFilters((prev) => prev.filter((x: any) => String(x.id) !== id))
                setPage(0)
              }} />
            }>
              <span style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>
                {String((f as any).id)}: {String((f as any).value ?? '')}
              </span>
            </Badge>
          ))}
          {JSON.stringify(pendingFilters) !== JSON.stringify(columnFilters) && (
            <>
              <Text size="sm" c="dimmed">（有未应用的更改）</Text>
              <Button size="xs" onClick={() => { setColumnFilters(pendingFilters); setPage(0); runQuery(0, pageSize) }}>应用筛选</Button>
              <Button size="xs" variant="subtle" color="gray" onClick={() => setPendingFilters(columnFilters)}>重置草稿</Button>
            </>
          )}
          <Button size="xs" variant="subtle" color="gray" onClick={() => {
            setColumnFilters([])
            setPage(0)
          }}>清除全部</Button>
        </Group>
      )}

      <SmartGrid
        columns={gridCols}
        rows={rows}
        height={420}
        sorting={sorting}
        onSortingChange={(updater) => {
          setSorting((prev) => (typeof updater === 'function' ? updater(prev) : updater))
          setPage(0)
        }}
        columnFilters={pendingFilters}
        onColumnFiltersChange={(updater) => {
          setPendingFilters((prev) => (typeof updater === 'function' ? updater(prev) : updater))
        }}
        onApplyFilters={() => { setColumnFilters(pendingFilters); setPage(0); runQuery(0, pageSize) }}
      />
    </Stack>
  )
}
