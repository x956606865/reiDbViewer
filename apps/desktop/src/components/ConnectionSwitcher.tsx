import { useEffect, useMemo, useState } from 'react'
import { Select, Loader } from '@mantine/core'
import { listConnections, getCurrent, setCurrent, CONNS_CHANGED_EVENT } from '@/lib/localStore'
import { subscribeCurrentConnId, getCurrentConnId } from '@/lib/current-conn'

type Item = { id: string; alias: string }

export default function ConnectionSwitcher() {
  const [userConnId, setUserConnId] = useState<string | null>(getCurrent())
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = () => {
    setLoading(true)
    listConnections()
      .then((rows) => setItems(rows.map((r) => ({ id: r.id, alias: r.alias }))))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    // keep value in sync if other views change current connection
    const unsub = subscribeCurrentConnId((id) => setUserConnId(id))
    setUserConnId(getCurrentConnId())
    // when connections table changes (create/delete), reload items
    const onChanged = () => refresh()
    window.addEventListener(CONNS_CHANGED_EVENT, onChanged as any)
    return () => {
      unsub?.()
      window.removeEventListener(CONNS_CHANGED_EVENT, onChanged as any)
    }
  }, [])

  useEffect(() => { setCurrent(userConnId) }, [userConnId])

  const data = useMemo(() => items.map((it) => ({ value: it.id, label: it.alias })), [items])

  if (loading) return <Loader size="xs" />
  if (data.length === 0) return null

  return (
    <Select
      placeholder="切换连接"
      data={data}
      value={userConnId}
      onChange={setUserConnId}
      searchable
      clearable
      allowDeselect
      checkIconPosition="right"
      size="xs"
      variant="default"
      styles={{
        root: { width: 220 },
        input: {
          backgroundColor: 'var(--mantine-color-gray-1)',
        },
      }}
    />
  )
}
