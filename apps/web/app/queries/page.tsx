"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Code,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core'
import { IconPlus, IconTrash, IconScan, IconChevronRight, IconChevronDown, IconFolder, IconFileText } from '@tabler/icons-react'
import type { SavedQueryVariableDef, DynamicColumnDef } from '@rei-db-view/types'
import { DataGrid } from '../../components/DataGrid'
import { useCurrentConnId } from '@/lib/current-conn'

type SavedItem = { id: string; name: string; description?: string | null; variables: SavedQueryVariableDef[]; createdAt?: string | null; updatedAt?: string | null }

type TreeNode = {
  type: 'folder' | 'item'
  name: string
  path: string // for folder: folder path; for item: its full name (may include folder path)
  children?: TreeNode[]
  item?: SavedItem
}


const VAR_TYPES: Array<{ value: SavedQueryVariableDef['type']; label: string }> = [
  { value: 'text', label: 'text' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'date', label: 'date' },
  { value: 'timestamp', label: 'timestamp' },
  { value: 'json', label: 'json' },
  { value: 'uuid', label: 'uuid' },
]

export default function SavedQueriesPage() {
  const [items, setItems] = useState<SavedItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [suggestedSQL, setSuggestedSQL] = useState<string | null>(null)

  const [currentId, setCurrentId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sql, setSql] = useState('SELECT * FROM users WHERE id = {{user_id}} LIMIT 10')
  const [vars, setVars] = useState<SavedQueryVariableDef[]>([
    { name: 'user_id', type: 'number', label: '用户ID', required: true, default: 1 },
  ])

  const [runValues, setRunValues] = useState<Record<string, any>>({ user_id: 1 })
  const [userConnId] = useCurrentConnId()

  const [previewSQL, setPreviewSQL] = useState('')
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [gridCols, setGridCols] = useState<string[]>([])
  const [dynCols, setDynCols] = useState<DynamicColumnDef[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('rdv.savedSql.expanded')
      if (!raw) return new Set<string>(['/'])
      return new Set<string>(JSON.parse(raw))
    } catch {
      return new Set<string>(['/'])
    }
  })

  const canSave = useMemo(() => name.trim().length > 0 && sql.trim().length > 0, [name, sql])

  const refresh = useCallback(() => {
    setError(null)
    setInfo(null)
    setSuggestedSQL(null)
    fetch('/api/user/saved-sql', { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (r.status === 501 && j?.suggestedSQL) {
          setSuggestedSQL(j.suggestedSQL)
          throw new Error('功能未初始化：请在 APP_DB 执行建表 SQL 后重试。')
        }
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
        setItems(j.items || [])
      })
      .catch((e) => setError(String(e?.message || e)))
  }, [])

  useEffect(() => { refresh() }, [refresh])
  // 连接切换后，清空预览与结果，避免误会
  useEffect(() => { setPreviewSQL(''); setRows([]); setGridCols([]) }, [userConnId])

  useEffect(() => {
    try { localStorage.setItem('rdv.savedSql.expanded', JSON.stringify(Array.from(expanded))) } catch {}
  }, [expanded])

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const buildTree = (list: SavedItem[]): TreeNode => {
    const root: TreeNode = { type: 'folder', name: '', path: '/', children: [] }
    const ensureFolder = (segments: string[]): TreeNode => {
      let node = root
      let p = ''
      for (const seg of segments) {
        p = p ? `${p}/${seg}` : seg
        let child = node.children!.find((c) => c.type === 'folder' && c.name === seg)
        if (!child) {
          child = { type: 'folder', name: seg, path: p, children: [] }
          node.children!.push(child)
        }
        node = child
      }
      return node
    }
    for (const it of list) {
      const parts = it.name.split('/').filter(Boolean)
      if (parts.length <= 1) {
        root.children!.push({ type: 'item', name: it.name, path: it.name, item: it })
      } else {
        const leaf = parts[parts.length - 1]
        const folder = ensureFolder(parts.slice(0, -1))
        folder.children!.push({ type: 'item', name: leaf, path: it.name, item: it })
      }
    }
    const sortNodes = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      for (const n of nodes) if (n.children) sortNodes(n.children)
    }
    sortNodes(root.children!)
    return root
  }

  const tree = buildTree(items)

  const onDetectVars = () => {
    try {
      const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g
      const found = new Set<string>()
      let m: RegExpExecArray | null
      while ((m = re.exec(sql))) found.add(m[1])
      const newVars: SavedQueryVariableDef[] = [...found].map((name) => {
        const exists = vars.find((v) => v.name === name)
        return exists || { name, type: 'text', required: false }
      })
      setVars(newVars)
      // 同步运行值（新变量用其默认值或空，丢弃已删除变量）
      setRunValues((rv) => {
        const next: Record<string, any> = {}
        for (const v of newVars) next[v.name] = rv[v.name] ?? v.default ?? ''
        return next
      })
      setInfo('已根据 SQL 提取变量（默认类型为 text，可修改）')
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  const onAddVar = () => {
    setVars((vs) => [...vs, { name: `var_${vs.length + 1}`, type: 'text' }])
    setRunValues((rv) => ({ ...rv }))
  }
  const onRemoveVar = (name: string) => {
    setVars((vs) => vs.filter((v) => v.name !== name))
    setRunValues((rv) => {
      const { [name]: _, ...rest } = rv
      return rest
    })
  }

  const onNew = () => {
    setCurrentId(null)
    setName('')
    setDescription('')
    setSql('')
    setVars([])
    setRunValues({})
    setPreviewSQL('')
    setRows([])
    setGridCols([])
    setInfo('已切换为新建模式。')
  }

  const onSave = async () => {
    setError(null)
    setInfo(null)
    try {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('名称不能为空')
      const body = { name: trimmed, description: description.trim() || undefined, sql, variables: vars, dynamicColumns: dynCols }

      // 选择目标：优先当前编辑项；若与其他同名则提示“覆盖”并以对方 id 作为目标
      const same = items.find((it) => it.name === trimmed && it.id !== currentId)
      let targetId: string | null = currentId || null
      if (!targetId && same) {
        const ok = window.confirm(`已存在同名查询“${trimmed}”。继续将覆盖该查询的内容，是否确认？`)
        if (!ok) return
        targetId = same.id
      }

      let res: Response
      if (targetId) {
        // 更新
        res = await fetch(`/api/user/saved-sql/${targetId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        // 新建
        res = await fetch('/api/user/saved-sql', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      const j = await res.json().catch(() => ({}))
      if (res.status === 501 && j?.suggestedSQL) {
        setSuggestedSQL(j.suggestedSQL)
        throw new Error('功能未初始化：请先在 APP_DB 执行建表 SQL。')
      }
      if (res.status === 409 && j?.error === 'name_exists' && j?.existingId) {
        const ok2 = window.confirm('同名查询已存在。是否覆盖该查询？')
        if (!ok2) return
        // 覆盖到 existingId
        const res2 = await fetch(`/api/user/saved-sql/${j.existingId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j2 = await res2.json().catch(() => ({}))
        if (!res2.ok) throw new Error(j2?.error || `保存失败（HTTP ${res2.status}）`)
        // 若本次原本在编辑另一条（targetId）且与 existingId 不同，则将原条目标记为归档，避免重名重复
        if (targetId && targetId !== j.existingId) {
          await fetch(`/api/user/saved-sql/${targetId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ isArchived: true }),
          }).catch(() => {})
        }
        setInfo('已覆盖保存。')
        setCurrentId(j.existingId)
        refresh()
        onSelectSaved(j.existingId)
        return
      }
      if (!res.ok) throw new Error(j?.error || `保存失败（HTTP ${res.status}）`)

      if (j?.id) {
        setCurrentId(j.id)
        setInfo('已保存。')
        refresh()
        onSelectSaved(j.id)
      } else {
        setInfo('已保存。')
        refresh()
      }
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  const onSaveAs = async () => {
    // 忽略 currentId，强制按“新建”流程保存（同名仍会触发覆盖确认）
    const prevId = currentId
    setCurrentId(null)
    await onSave()
    // 若保存失败，可考虑恢复 prevId（此处省略，错误时不会更改 currentId）
    if (prevId) {
      // no-op
    }
  }

  const clearEditor = () => {
    setCurrentId(null)
    setName('')
    setDescription('')
    setSql('')
    setVars([])
    setRunValues({})
    setPreviewSQL('')
    setRows([])
    setGridCols([])
  }

  const onDelete = async () => {
    if (!currentId) return
    const ok = window.confirm('删除后不可恢复，是否确认删除当前查询？')
    if (!ok) return
    try {
      const id = currentId
      const res = await fetch(`/api/user/saved-sql/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isArchived: true }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || `删除失败（HTTP ${res.status}）`)
      // 乐观刷新：本地先移除，再触发远端拉取
      setItems((prev) => prev.filter((x) => x.id !== id))
      clearEditor()
      setInfo('已删除。')
      refresh()
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  const onDeleteById = async (id: string, nameHint?: string) => {
    const ok = window.confirm(`确认删除「${nameHint || id}」？删除后不可恢复。`)
    if (!ok) return
    try {
      const res = await fetch(`/api/user/saved-sql/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isArchived: true }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || `删除失败（HTTP ${res.status}）`)
      setItems((prev) => prev.filter((x) => x.id !== id))
      if (currentId === id) clearEditor()
      setInfo('已删除。')
      refresh()
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  const onPreview = async () => {
    setError(null)
    setInfo(null)
    try {
      if (!currentId) throw new Error('请先从列表选择一条或保存新查询后再预览/执行。')
      const res = await fetch('/api/saved-sql/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ savedQueryId: currentId, values: runValues, userConnId: userConnId || '', previewOnly: true }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || `预览失败（HTTP ${res.status}）`)
      setPreviewSQL(j?.preview?.text || '')
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  const onExecute = async () => {
    setError(null)
    setInfo(null)
    try {
      if (!currentId) throw new Error('请先从列表选择一条或保存新查询后再执行。')
      if (!userConnId) throw new Error('未设置当前连接，请先到 Connections 选择。')
      const res = await fetch('/api/saved-sql/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ savedQueryId: currentId, values: runValues, userConnId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.error || `执行失败（HTTP ${res.status}）`)
      setPreviewSQL(j.sql || '')
      let cols: string[] = Array.isArray(j.columns) ? j.columns : Object.keys((j.rows?.[0] ?? {}))
      let data: Array<Record<string, unknown>> = j.rows || []

      // apply dynamic columns on client
      if (dynCols.length > 0 && Array.isArray(data)) {
        const helpers = {
          fmtDate: (v: any) => (v ? new Date(v).toISOString() : ''),
          json: (v: any) => JSON.stringify(v),
        }
        const usedNames = new Set(cols)
        const nameMap = new Map<string, string>() // original->unique
        for (const dc of dynCols) {
          let nm = dc.name
          let k = 1
          while (usedNames.has(nm)) { nm = `${dc.name}_${++k}` }
          usedNames.add(nm)
          nameMap.set(dc.name, nm)
        }
        cols = Array.from(usedNames)
        data = data.map((row: any) => {
          const out = { ...row }
          for (const dc of dynCols) {
            const unique = nameMap.get(dc.name) || dc.name
            try {
              // eslint-disable-next-line no-new-func
              const fn = new Function('row', 'vars', 'helpers', `"use strict"; return ( ${dc.code} )(row, vars, helpers)`) as any
              out[unique] = fn(row, runValues, helpers)
            } catch (e: any) {
              out[unique] = `#ERR: ${String(e?.message || e)}`
            }
          }
          return out
        })
      }

      setGridCols(cols)
      setRows(data)
    } catch (e: any) {
      setError(String(e?.message || e))
    }
  }

  const onSelectSaved = (id: string) => {
    setCurrentId(id)
    // fetch details
    setError(null)
    fetch(`/api/user/saved-sql/${id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.error) throw new Error(j.error)
        setName(j.name || '')
        setDescription(j.description || '')
        setSql(j.sql || '')
        setVars(Array.isArray(j.variables) ? j.variables : [])
        setDynCols(Array.isArray(j.dynamicColumns) ? j.dynamicColumns : [])
        const initVals: Record<string, any> = {}
        for (const v of j.variables || []) initVals[v.name] = v.default ?? ''
        setRunValues(initVals) // 载入时用默认值初始化运行值
      })
      .catch((e) => setError(String(e?.message || e)))
  }

  return (
    <Stack gap="md">
      <div>
        <Title order={3}>常用 SQL</Title>
        <Text c="dimmed">保存含变量的只读查询；运行前按表单填参。</Text>
        {error && <Text c="red" mt="xs">{error}</Text>}
        {info && <Text c="green" mt="xs">{info}</Text>}
      </div>

      {suggestedSQL && (
        <Paper withBorder p="md">
          <Title order={4}>初始化建表 SQL</Title>
          <Text c="dimmed" size="sm">请复制到 APP_DB 执行完成后刷新本页。</Text>
          <ScrollArea h={220} mt="xs"><Code block>{suggestedSQL}</Code></ScrollArea>
        </Paper>
      )}

      <Group align="start" justify="space-between" wrap="nowrap">
        <Paper withBorder p="md" w={420}>
          <Title order={4}>我的查询</Title>
          <Group mt="xs" gap="xs">
            <Button size="xs" variant="light" onClick={() => { const p = prompt('新建文件夹路径（用/分隔，如 reports/daily）'); if (p) { setExpanded((s) => new Set([...Array.from(s), p])); setName(`${p}/`) } }}>新建文件夹</Button>
          </Group>
          {items.length === 0 ? (
            <Text c="dimmed" mt="xs">暂无</Text>
          ) : (
            <div style={{ marginTop: 8 }}>
              {tree.children && tree.children.length > 0 ? (
                <Tree
                  nodes={tree.children}
                  expanded={expanded}
                  onToggle={toggleFolder}
                  onOpenItem={(it) => onSelectSaved(it.id)}
                  onDeleteItem={(it) => onDeleteById(it.id, it.name)}
                />
              ) : (
                <Text c="dimmed">（空）</Text>
              )}
            </div>
          )}
        </Paper>

        <Stack gap="md" style={{ flex: 1 }}>
          <Paper withBorder p="md">
            <Title order={4}>编辑 / 新增</Title>
            <Group mt="sm" align="end">
              <TextInput label="名称" value={name} onChange={(e) => setName(e.currentTarget.value)} w={320} />
              <TextInput label="描述" value={description} onChange={(e) => setDescription(e.currentTarget.value)} w={420} />
              <Button onClick={onSave} disabled={!canSave}>{currentId ? '更新' : '保存'}</Button>
              <Button variant="light" onClick={onSaveAs} disabled={!canSave}>另存为</Button>
              <Button variant="default" onClick={onNew}>新建</Button>
              <ActionIcon color="red" variant="light" onClick={onDelete} disabled={!currentId} title="删除当前">
                <IconTrash size={18} />
              </ActionIcon>
            </Group>
            <Textarea
              label="SQL（使用 {{var}} 占位符；仅支持 SELECT/WITH）"
              mt="sm"
              value={sql}
              onChange={(e) => setSql(e.currentTarget.value)}
              autosize minRows={6}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
            />
            <Group gap="xs" mt="xs">
              <Button size="xs" leftSection={<IconScan size={14} />} variant="light" onClick={onDetectVars}>提取变量</Button>
              <Button size="xs" leftSection={<IconPlus size={14} />} variant="light" onClick={onAddVar}>新增变量</Button>
            </Group>
            <Table mt="sm" withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>名称</Table.Th>
                  <Table.Th>类型</Table.Th>
                  <Table.Th>必填</Table.Th>
                  <Table.Th>默认值</Table.Th>
                  <Table.Th w={60}>操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {vars.map((v, i) => (
                  <Table.Tr key={v.name + i}>
                    <Table.Td>
                      <TextInput
                        value={v.name}
                        onChange={(e) => {
                          const nextName = e.currentTarget.value
                          setVars((vs) => vs.map((x, idx) => (idx === i ? { ...x, name: nextName } : x)))
                          // 同步重命名运行值键
                          setRunValues((rv) => {
                            const copy = { ...rv }
                            const oldName = v.name
                            if (oldName !== nextName && Object.prototype.hasOwnProperty.call(copy, oldName)) {
                              copy[nextName] = copy[oldName]
                              delete copy[oldName]
                            }
                            return copy
                          })
                        }}
                        w={220}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Select data={VAR_TYPES} value={v.type} onChange={(val) => setVars((vs) => vs.map((x, idx) => idx === i ? { ...x, type: (val as any) || 'text' } : x))} w={140} />
                    </Table.Td>
                    <Table.Td>
                      <Switch
                        checked={!!v.required}
                        onChange={(e) => {
                          const checked = e.currentTarget.checked
                          setVars((vs) => vs.map((x, idx) => (idx === i ? { ...x, required: checked } : x)))
                        }}
                      />
                    </Table.Td>
                    <Table.Td>
                      {v.type === 'number' ? (
                        <NumberInput value={(v.default as any) ?? undefined} onChange={(val) => setVars((vs) => vs.map((x, idx) => idx === i ? { ...x, default: val as any } : x))} w={180} />
                      ) : v.type === 'boolean' ? (
                        <Switch
                          checked={!!v.default}
                          onChange={(e) => {
                            const checked = e.currentTarget.checked
                            setVars((vs) => vs.map((x, idx) => (idx === i ? { ...x, default: checked } : x)))
                          }}
                        />
                      ) : (
                        <TextInput
                          value={String(v.default ?? '')}
                          onChange={(e) => {
                            const val = e.currentTarget.value
                            setVars((vs) => vs.map((x, idx) => (idx === i ? { ...x, default: val } : x)))
                          }}
                          w={240}
                        />
                      )}
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon color="red" variant="light" onClick={() => onRemoveVar(v.name)}><IconTrash size={14} /></ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>

            <Title order={4} mt="md">动态列</Title>
            <Text c="dimmed" size="sm">每个动态列包含“名称”和一个 JS 函数。函数签名：<Code>(row, vars, helpers) =&gt; any</Code>，在客户端执行。</Text>
            <Table mt="sm" withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={220}>名称</Table.Th>
                  <Table.Th>JS 函数</Table.Th>
                  <Table.Th w={60}>操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {dynCols.length === 0 && (
                  <Table.Tr><Table.Td colSpan={3}><Text c="dimmed">暂无动态列</Text></Table.Td></Table.Tr>
                )}
                {dynCols.map((dc, i) => (
                  <Table.Tr key={dc.name + i}>
                    <Table.Td>
                      <TextInput value={dc.name} onChange={(e) => {
                        const val = e.currentTarget.value
                        setDynCols((arr) => arr.map((x, idx) => idx === i ? { ...x, name: val } : x))
                      }} />
                    </Table.Td>
                    <Table.Td>
                      <Textarea
                        value={dc.code}
                        onChange={(e) => {
                          const val = e.currentTarget.value
                          setDynCols((arr) => arr.map((x, idx) => idx === i ? { ...x, code: val } : x))
                        }}
                        autosize minRows={3}
                        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
                        placeholder="(row, vars, helpers) => row.amount * 1.1"
                      />
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon color="red" variant="light" onClick={() => setDynCols((arr) => arr.filter((_, idx) => idx !== i))}><IconTrash size={14} /></ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Group gap="xs" mt="xs">
              <Button size="xs" leftSection={<IconPlus size={14} />} variant="light" onClick={() => setDynCols((arr) => [...arr, { name: `dyn_${arr.length + 1}`, code: '(row, vars) => null' }])}>新增动态列</Button>
            </Group>
          </Paper>

          <Paper withBorder p="md">
            <Title order={4}>运行</Title>
            <Group mt="xs" gap="sm" align="center">
              <Text size="sm" c="dimmed">当前连接：</Text>
              {userConnId ? <Badge color="green"><Code>{userConnId}</Code></Badge> : <Badge color="gray">未选择</Badge>}
            </Group>
            <Title order={5} mt="md">运行参数</Title>
            <Table mt="xs" withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>变量</Table.Th>
                  <Table.Th>运行值</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {vars.length === 0 && (
                  <Table.Tr><Table.Td colSpan={2}><Text c="dimmed">无变量</Text></Table.Td></Table.Tr>
                )}
                {vars.map((v) => (
                  <Table.Tr key={`run_${v.name}`}>
                    <Table.Td><Code>{v.name}</Code></Table.Td>
                    <Table.Td>
                      {v.type === 'number' ? (
                        <NumberInput value={(runValues[v.name] as any) ?? (v.default as any) ?? undefined} onChange={(val) => setRunValues((rv) => ({ ...rv, [v.name]: val }))} w={260} />
                      ) : v.type === 'boolean' ? (
                        <Switch
                          checked={!!runValues[v.name]}
                          onChange={(e) => {
                            const checked = e.currentTarget.checked
                            setRunValues((rv) => ({ ...rv, [v.name]: checked }))
                          }}
                        />
                      ) : (
                        <TextInput
                          value={String(runValues[v.name] ?? (v.default ?? ''))}
                          onChange={(e) => {
                            const val = e.currentTarget.value
                            setRunValues((rv) => ({ ...rv, [v.name]: val }))
                          }}
                          w={360}
                        />
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Group mt="xs">
              <Button size="xs" variant="light" onClick={() => setRunValues(Object.fromEntries(vars.map((v) => [v.name, v.default ?? ''])))}>重置为默认值</Button>
            </Group>
            <Group mt="sm">
              <Button onClick={onPreview} variant="light">预览 SQL</Button>
              <Button onClick={onExecute}>执行</Button>
            </Group>
            <Title order={5} mt="md">SQL</Title>
            <Paper withBorder p="sm" mt="xs"><ScrollArea h={180}><Code block>{previewSQL || '（点击“预览 SQL”或“执行”）'}</Code></ScrollArea></Paper>
          </Paper>

          <Paper withBorder p="xs">
            <Title order={4}>结果</Title>
            <div style={{ marginTop: 8 }}>
              <DataGrid columns={gridCols} rows={rows} />
            </div>
          </Paper>
        </Stack>
      </Group>
    </Stack>
  )
}

function Tree({ nodes, expanded, onToggle, onOpenItem, onDeleteItem }: {
  nodes: TreeNode[]
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpenItem: (it: SavedItem) => void
  onDeleteItem: (it: SavedItem) => void
}) {
  return (
    <div>
      {nodes.map((n) => (
        <TreeRow key={n.type + ':' + n.path} node={n} depth={0} expanded={expanded} onToggle={onToggle} onOpenItem={onOpenItem} onDeleteItem={onDeleteItem} />
      ))}
    </div>
  )
}

function TreeRow({ node, depth, expanded, onToggle, onOpenItem, onDeleteItem }: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpenItem: (it: SavedItem) => void
  onDeleteItem: (it: SavedItem) => void
}) {
  const pad = 8 + depth * 14
  if (node.type === 'folder') {
    const isOpen = expanded.has(node.path)
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', cursor: 'pointer' }} onClick={() => onToggle(node.path)}>
          <span style={{ width: pad }} />
          {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <IconFolder size={14} />
          <Text>{node.name}</Text>
        </div>
        {isOpen && node.children && node.children.map((c) => (
          <TreeRow key={c.type + ':' + c.path} node={c} depth={depth + 1} expanded={expanded} onToggle={onToggle} onOpenItem={onOpenItem} onDeleteItem={onDeleteItem} />
        ))}
      </div>
    )
  }
  // item
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
      <span style={{ width: pad }} />
      <IconFileText size={14} />
      <a onClick={() => node.item && onOpenItem(node.item)} style={{ cursor: 'pointer', flex: 1 }}>{node.name}</a>
      {node.item && (
        <ActionIcon color="red" variant="light" onClick={() => onDeleteItem(node.item!)}>
          <IconTrash size={14} />
        </ActionIcon>
      )}
    </div>
  )
}
