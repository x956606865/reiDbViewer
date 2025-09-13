"use client"

import { useEffect, useState } from 'react'
import { Button, Group, NumberInput, Paper, Stack, Text, Title, Code, Select, ActionIcon, Tooltip } from '@mantine/core'
import { IconPlayerPause, IconPlayerStop } from '@tabler/icons-react'
import { DataGrid } from '../../components/DataGrid'

type Row = Record<string, unknown>

export default function OpsPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [cols, setCols] = useState<string[]>([])
  const [sql, setSql] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [minMinutes, setMinMinutes] = useState<number | ''>(5)
  const [limit, setLimit] = useState<number | ''>(200)
  const [userConnId, setUserConnId] = useState<string | null>(null)
  const [userConns, setUserConns] = useState<Array<{ value: string; label: string }>>([])

  useEffect(() => {
    fetch('/api/user/connections', { cache: 'no-store' })
      .then(async (r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => {
        const items: Array<{ id: string; alias: string }> = j.items || []
        setUserConns(items.map((it) => ({ value: it.id, label: it.alias })))
      })
      .catch(() => {})
    try {
      const id = localStorage.getItem('rdv.currentUserConnId')
      setUserConnId(id)
    } catch {
      setUserConnId(null)
    }
  }, [])

  const runLongRunning = async () => {
    setErr(null)
    setRows([])
    setCols([])
    try {
      const body = {
        actionId: 'long_running_activity',
        params: { minMinutes: (minMinutes || 5), limit: (limit || 200), notIdle: true },
        userConnId: userConnId || '',
      }
      const res = await fetch('/api/ops/queries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) {
        if (json?.preview?.text) setSql(json.preview.text)
        throw new Error(json?.message || json?.error || `请求失败（HTTP ${res.status}）`)
      }
      const baseCols: string[] = json.columns || []
      const hasPid = baseCols.includes('pid')
      const rows: Row[] = (json.rows || [])
      const cols = hasPid ? [...baseCols, 'actions'] : baseCols
      const withActions = hasPid
        ? rows.map((r: any) => ({
            ...r,
            actions: (
              <Group gap="xs">
                <Tooltip label="温和取消（pg_cancel_backend）">
                  <ActionIcon size="sm" variant="subtle" color="orange" onClick={() => signal('cancel', r.pid)}>
                    <IconPlayerPause size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="强制终止（pg_terminate_backend）">
                  <ActionIcon size="sm" variant="subtle" color="red" onClick={() => signal('terminate', r.pid)}>
                    <IconPlayerStop size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ),
          }))
        : rows
      setSql(json.sql)
      setCols(cols)
      setRows(withActions)
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
  }

  const callApi = async (actionId: string, params: Record<string, unknown>) => {
    setErr(null)
    setRows([])
    setCols([])
    try {
      const body = { actionId, params, userConnId: userConnId || '' }
      const res = await fetch('/api/ops/queries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        if (json?.preview?.text) setSql(json.preview.text)
        throw new Error(json?.message || json?.error || `请求失败（HTTP ${res.status}）`)
      }
      const baseCols: string[] = json.columns || []
      const hasPid = baseCols.includes('pid')
      const rows: Row[] = (json.rows || [])
      const cols = hasPid ? [...baseCols, 'actions'] : baseCols
      const withActions = hasPid
        ? rows.map((r: any) => ({
            ...r,
            actions: (
              <Group gap="xs">
                <Tooltip label="温和取消（pg_cancel_backend）">
                  <ActionIcon size="sm" variant="subtle" color="orange" onClick={() => signal('cancel', r.pid)}>
                    <IconPlayerPause size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="强制终止（pg_terminate_backend）">
                  <ActionIcon size="sm" variant="subtle" color="red" onClick={() => signal('terminate', r.pid)}>
                    <IconPlayerStop size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ),
          }))
        : rows
      setSql(json.sql)
      setCols(cols)
      setRows(withActions)
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
  }

  const signal = async (mode: 'cancel' | 'terminate', pid: number) => {
    if (!userConnId) return
    const tip = mode === 'cancel' ? '取消当前查询' : '强制终止会话'
    if (mode === 'terminate' && !confirm(`确定要${tip}（PID=${pid}）吗？可能导致该会话内事务回滚。`)) return
    try {
      setErr(null)
      setInfo(null)
      const res = await fetch('/api/ops/signal', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userConnId, pid, mode, confirm: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.message || json?.error || '操作失败')
      setInfo(`${tip}请求已发送：${json.ok ? '成功' : '未生效（可能是权限不足或目标状态已变化）'}`)
    } catch (e: any) {
      setErr(String(e?.message || e))
    }
  }

  return (
    <Stack gap="md">
      <Title order={2}>运维快速按钮（只读）</Title>
      <Text c="dimmed">预设只读脚本，便于排障（例如查看长时间运行中的查询）。</Text>
      <Group>
        <Select label="连接" placeholder="未选择" data={userConns} value={userConnId} onChange={setUserConnId} searchable clearable />
        <NumberInput label=">= 运行分钟数" value={minMinutes} onChange={setMinMinutes} min={1} max={7 * 24 * 60} step={1} style={{ width: 200 }} />
        <NumberInput label="返回上限" value={limit} onChange={setLimit} min={1} max={1000} step={50} style={{ width: 180 }} />
        <Button onClick={runLongRunning} disabled={!userConnId}>长跑查询（pg_stat_activity）</Button>
        <Button variant="light" onClick={() => callApi('blocking_activity', { minMinutes: (minMinutes || 5), limit: (limit || 200) })} disabled={!userConnId}>
          阻塞链（blocking）
        </Button>
        <Button variant="light" onClick={() => callApi('long_transactions', { minMinutes: (minMinutes || 5), limit: (limit || 200) })} disabled={!userConnId}>
          长事务
        </Button>
        <Button variant="light" onClick={() => callApi('waiting_locks', { limit: (limit || 200) })} disabled={!userConnId}>
          等待锁
        </Button>
        <Button variant="light" onClick={() => callApi('connections_overview', { limit: (limit || 200) })} disabled={!userConnId}>
          连接概览
        </Button>
      </Group>

      {err && <Text c="red">{err}</Text>}
      {info && <Text c="green">{info}</Text>}

      <div>
        <Title order={4}>SQL</Title>
        <Paper withBorder p="sm" mt="xs">
          <Code block>{sql || '点击上方按钮以生成并执行 SQL（只读）'}</Code>
        </Paper>
      </div>

      <div>
        <Title order={4}>结果</Title>
        <Paper withBorder p="xs" mt="xs">
          <DataGrid columns={cols} rows={rows} />
        </Paper>
      </div>

      <Text c="dimmed" size="sm">
        注：若当前数据库角色缺少读取其他会话 <code>query</code> 文本的权限，部分列可能为空；可以仅查看自身会话。
      </Text>
    </Stack>
  )
}
