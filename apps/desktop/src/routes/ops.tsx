import { useEffect, useState } from 'react'
import { ActionIcon, Button, Group, LoadingOverlay, NumberInput, Paper, Select, Stack, Text, Title, Code, Tooltip } from '@mantine/core'
import { IconPlayerPause, IconPlayerStop } from '@tabler/icons-react'
import { DataGrid } from '@/components/DataGrid'
import { listConnections, getCurrent, setCurrent, CONNS_CHANGED_EVENT } from '@/lib/localStore'
import { subscribeCurrentConnId, getCurrentConnId } from '@/lib/current-conn'
import { runOpsQuery, sendOpsSignal, OpsError } from '@/services/ops'
import type { OpsSignalMode } from '@/services/ops'

export default function OpsPage() {
  const [userConnId, setUserConnIdState] = useState<string | null>(getCurrent())
  const [userConns, setUserConns] = useState<Array<{ value: string; label: string }>>([])
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [columns, setColumns] = useState<string[]>([])
  const [sql, setSql] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [minMinutes, setMinMinutes] = useState<number | ''>(5)
  const [limit, setLimit] = useState<number | ''>(200)
  const [loading, setLoading] = useState(false)

  const refreshConnections = () => {
    listConnections()
      .then((rows) => rows.map((r) => ({ value: r.id, label: r.alias })))
      .then(setUserConns)
      .catch(() => setUserConns([]))
  }

  useEffect(() => {
    refreshConnections()
    const unsub = subscribeCurrentConnId((id) => setUserConnIdState(id))
    const onChanged = () => refreshConnections()
    window.addEventListener(CONNS_CHANGED_EVENT, onChanged as any)
    setUserConnIdState(getCurrentConnId())
    return () => {
      unsub?.()
      window.removeEventListener(CONNS_CHANGED_EVENT, onChanged as any)
    }
  }, [])

  const setUserConnId = (id: string | null) => {
    setUserConnIdState(id)
    setCurrent(id)
  }

  useEffect(() => {
    setRows([])
    setColumns([])
    setSql('')
    setError(null)
    setInfo(null)
    setLoading(false)
  }, [userConnId])

  const effectiveMin = typeof minMinutes === 'number' ? minMinutes : 5
  const effectiveLimit = typeof limit === 'number' ? limit : 200

  const handleSignal = async (mode: OpsSignalMode, pid?: number) => {
    if (!userConnId || typeof pid !== 'number' || Number.isNaN(pid)) return
    const actionTip = mode === 'cancel' ? '取消当前查询' : '强制终止会话'
    if (mode === 'terminate' && !confirm(`确定要${actionTip}（PID=${pid}）吗？可能导致该会话内事务回滚。`)) return
    try {
      setError(null)
      setInfo(null)
      const res = await sendOpsSignal({ mode, pid, userConnId })
      setInfo(`${actionTip}请求已发送：${res.ok ? '成功' : '未生效（可能是目标状态已变化或权限不足）'}`)
    } catch (err: any) {
      setError(String(err?.message || err))
    }
  }

  const runAction = async (actionId: Parameters<typeof runOpsQuery>[0]['actionId'], params: Record<string, unknown>) => {
    if (!userConnId) return
    setLoading(true)
    setError(null)
    setInfo(null)
    setRows([])
    setColumns([])
    try {
      const result = await runOpsQuery({ actionId, params, userConnId })
      const hasPid = result.columns.includes('pid')
      const enhancedRows = hasPid
        ? result.rows.map((row) => ({
            ...row,
            actions: (
              <Group gap="xs">
                <Tooltip label="温和取消（pg_cancel_backend）">
                  <ActionIcon size="sm" variant="subtle" color="orange" onClick={() => handleSignal('cancel', Number(row.pid))}>
                    <IconPlayerPause size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="强制终止（pg_terminate_backend）">
                  <ActionIcon size="sm" variant="subtle" color="red" onClick={() => handleSignal('terminate', Number(row.pid))}>
                    <IconPlayerStop size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ),
          }))
        : result.rows
      const cols = hasPid ? [...result.columns, 'actions'] : result.columns
      setRows(enhancedRows)
      setColumns(cols)
      setSql(result.sql)
    } catch (err: any) {
      if (err instanceof OpsError && err.preview?.text) setSql(err.preview.text)
      setError(String(err?.message || err))
    } finally {
      setLoading(false)
    }
  }

  const runLongRunning = () =>
    runAction('long_running_activity', {
      minMinutes: effectiveMin,
      limit: effectiveLimit,
      notIdle: true,
    })

  const runBlocking = () =>
    runAction('blocking_activity', {
      minMinutes: effectiveMin,
      limit: effectiveLimit,
    })

  const runLongTransactions = () =>
    runAction('long_transactions', {
      minMinutes: effectiveMin,
      limit: effectiveLimit,
    })

  const runWaitingLocks = () =>
    runAction('waiting_locks', { limit: effectiveLimit })

  const runConnections = () =>
    runAction('connections_overview', { limit: effectiveLimit })

  return (
    <Stack gap="md" style={{ minWidth: 0 }}>
      <Title order={2}>运维快速按钮（只读）</Title>
      <Text c="dimmed">复用 Web 版预设脚本，配合只读会话与 LIMIT 保护数据库安全。</Text>
      <Group wrap="wrap" gap="md">
        <Select
          label="连接"
          placeholder="未选择"
          data={userConns}
          value={userConnId}
          onChange={setUserConnId}
          searchable
          clearable
          allowDeselect
          style={{ width: 220 }}
        />
        <NumberInput
          label=">= 运行分钟数"
          value={minMinutes}
          onChange={(v) => setMinMinutes(typeof v === 'number' ? v : v === '' ? '' : Number(v))}
          min={1}
          max={7 * 24 * 60}
          step={1}
          style={{ width: 180 }}
        />
        <NumberInput
          label="返回上限"
          value={limit}
          onChange={(v) => setLimit(typeof v === 'number' ? v : v === '' ? '' : Number(v))}
          min={1}
          max={1000}
          step={50}
          style={{ width: 160 }}
        />
        <Button onClick={runLongRunning} disabled={!userConnId || loading}>
          长跑查询（pg_stat_activity）
        </Button>
        <Button variant="light" onClick={runBlocking} disabled={!userConnId || loading}>
          阻塞链（blocking）
        </Button>
        <Button variant="light" onClick={runLongTransactions} disabled={!userConnId || loading}>
          长事务
        </Button>
        <Button variant="light" onClick={runWaitingLocks} disabled={!userConnId || loading}>
          等待锁
        </Button>
        <Button variant="light" onClick={runConnections} disabled={!userConnId || loading}>
          连接概览
        </Button>
      </Group>

      {error ? <Text c="red">{error}</Text> : null}
      {info ? <Text c="green">{info}</Text> : null}

      <div>
        <Title order={4}>SQL</Title>
        <Paper withBorder p="sm" mt="xs">
          <Code block>{sql || '点击上方按钮以生成并执行 SQL（只读）'}</Code>
        </Paper>
      </div>

      <div>
        <Title order={4}>结果</Title>
        <Paper withBorder p="xs" mt="xs" pos="relative">
          <LoadingOverlay visible={loading} zIndex={10} />
          <DataGrid columns={columns} rows={rows} />
        </Paper>
      </div>

      <Text c="dimmed" size="sm">
        注：如果当前数据库角色无权读取其他会话的 <code>query</code> 文本，相关列可能为空；可尝试仅查看自身会话。
      </Text>
    </Stack>
  )
}
