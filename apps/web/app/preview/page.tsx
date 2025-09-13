"use client"

import { useEffect, useState } from 'react'
import { Button, Code, Group, Paper, ScrollArea, Stack, Text, Textarea, Title } from '@mantine/core'
import { DataGrid } from '../../components/DataGrid'

const defaultAst = {
  from: { name: 'orders', alias: 'o' },
  columns: [
    { kind: 'column', ref: { kind: 'colref', table: 'o', name: 'id' } },
    {
      kind: 'computed',
      alias: 'user_email',
      expr: { kind: 'colref', table: 'lc_1', name: 'email' },
      viaJoinId: 'lc_1',
    },
  ],
  joins: [
    {
      type: 'LATERAL',
      to: { name: 'users', alias: 'lc_1' },
      alias: 'lc_1',
      on: {
        kind: 'eq',
        left: { kind: 'colref', table: 'o', name: 'user_id' },
        right: { kind: 'colref', table: 'lc_1', name: 'id' },
      },
    },
  ],
  orderBy: [{ expr: { kind: 'colref', table: 'o', name: 'id' }, dir: 'ASC' }],
  limit: 10,
}

export default function PreviewPage() {
  const [astText, setAstText] = useState(JSON.stringify(defaultAst, null, 2))
  const [sql, setSql] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)
  const [gridCols, setGridCols] = useState<string[]>([])
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [userConnId, setUserConnId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const id = localStorage.getItem('rdv.currentUserConnId')
      setUserConnId(id)
    } catch {
      setUserConnId(null)
    }
  }, [])

  const onPreview = async () => {
    try {
      setErr(null)
      const ast = JSON.parse(astText)
      const body = { select: ast }
      const res = await fetch('/api/query/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || '请求失败')
      setSql(json.sql)
      const cols: string[] = []
      for (const c of ast.columns ?? []) {
        if (c.kind === 'computed') cols.push(c.alias)
        else if (c.kind === 'column') cols.push(c.alias ?? c.ref.name)
      }
      setGridCols(cols)
      const demo = Array.from({ length: ast.limit ?? 10 }, (_, i) => {
        const r: Record<string, unknown> = {}
        for (const key of cols) {
          if (/id$/i.test(key)) r[key] = 1000 + i
          else if (/email/i.test(key)) r[key] = `user${i + 1}@example.com`
          else r[key] = `v_${i + 1}`
        }
        return r
      })
      setRows(demo)
    } catch (e: any) {
      setErr(String(e.message || e))
    }
  }

  const onExecute = async () => {
    try {
      setErr(null)
      const ast = JSON.parse(astText)
      const body = { select: ast, userConnId: userConnId || '' }
      const res = await fetch('/api/query/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json?.preview?.text) setSql(json.preview.text)
        throw new Error(json?.error || `执行失败（HTTP ${res.status}）`)
      }
      if (Array.isArray(json.rows)) {
        const cols = Object.keys(json.rows[0] ?? {})
        setGridCols(cols)
        setRows(json.rows)
      } else {
        await onPreview()
      }
    } catch (e: any) {
      setErr(String(e.message || e))
    }
  }

  return (
    <Stack gap="md">
      <div>
        <Title order={3}>AST（可编辑）</Title>
        <Textarea
          value={astText}
          onChange={(e) => setAstText(e.currentTarget.value)}
          autosize
          minRows={10}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
        />
        <Group mt="xs">
          <Button onClick={onPreview}>预览 SQL</Button>
          <Button variant="light" onClick={onExecute}>
            执行
          </Button>
          <Text c="dimmed" size="sm">当前连接: {userConnId ? userConnId : '未选择'}</Text>
        </Group>
        {err && (
          <Text c="red" mt="xs">
            错误：{err}
          </Text>
        )}
      </div>

      <div>
        <Title order={3}>SQL</Title>
        <Paper withBorder p="sm" mt="xs">
          <ScrollArea h={220} type="auto">
            <Code block>{sql || '（点击“预览 SQL”或“执行”查看 SQL）'}</Code>
          </ScrollArea>
        </Paper>
      </div>

      <div>
        <Title order={3}>DataGrid（Mock 数据）</Title>
        <Paper withBorder p="xs" mt="xs">
          <DataGrid columns={gridCols} rows={rows} />
        </Paper>
      </div>
    </Stack>
  )
}
