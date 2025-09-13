"use client"

import { useEffect, useMemo, useState } from 'react'
import { Button, Code, Group, NumberInput, Paper, Stack, Text, Title } from '@mantine/core'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import SmartGrid from '../../../../components/SmartGrid'

type ColumnMeta = { name: string; dataType: string; nullable?: boolean; isPrimaryKey?: boolean }
type TableMeta = { schema: string; name: string; columns: ColumnMeta[] }

export default function BrowseTablePage() {
  const params = useParams<{ schema: string; table: string }>()
  const schema = params?.schema
  const table = params?.table

  const [userConnId, setUserConnId] = useState<string | null>(null)
  const [meta, setMeta] = useState<TableMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sql, setSql] = useState<string>("")
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(50)
  const [gridCols, setGridCols] = useState<string[]>([])
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])

  useEffect(() => {
    try {
      const id = localStorage.getItem('rdv.currentUserConnId')
      setUserConnId(id)
    } catch {}
  }, [])

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
    return (t: TableMeta, pageIndex: number, size: number) => {
      const alias = 't'
      const orderPk = t.columns.filter((c) => c.isPrimaryKey)
      return {
        from: { schema: t.schema, name: t.name, alias },
        columns: t.columns.map((c) => ({ kind: 'column', ref: { kind: 'colref', table: alias, name: c.name } })),
        orderBy: orderPk.length
          ? orderPk.map((c) => ({ expr: { kind: 'colref', table: alias, name: c.name }, dir: 'ASC' as const }))
          : undefined,
        limit: size,
        offset: Math.max(0, pageIndex) * size,
      }
    }
  }, [])

  const runQuery = async (pageIndex: number, size: number) => {
    if (!meta) return
    setLoading(true)
    setError(null)
    try {
      const ast = buildAst(meta, pageIndex, size)
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
            setGridCols((json.columns as string[]) || columns)
            setRows((json.rows as Array<Record<string, unknown>>) || [])
          } else {
            // 失败时保留错误信息，稍后做预览降级
            setError(String(json?.error || json?.message || '查询失败'))
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
          setGridCols(columns)
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

      <SmartGrid columns={gridCols} rows={rows} height={420} />
    </Stack>
  )
}
