"use client"

import { useEffect, useMemo, useState } from 'react'
import { Select, Loader } from '@mantine/core'
import { useCurrentConnId } from '@/lib/current-conn'
import {
  QUERY_EXECUTING_EVENT,
  type QueryExecutingEventDetail,
} from '@rei-db-view/types/events'

type Item = { id: string; alias: string }

export default function ConnectionSwitcher() {
  const [userConnId, setUserConnId] = useCurrentConnId()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [disabled, setDisabled] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch('/api/user/connections', { cache: 'no-store' })
      .then(async (r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => setItems((j.items as Item[]) || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const data = useMemo(() => items.map((it) => ({ value: it.id, label: it.alias })), [items])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<QueryExecutingEventDetail>).detail
      setDisabled(Boolean(detail?.executing))
    }
    window.addEventListener(QUERY_EXECUTING_EVENT, handler)
    return () => window.removeEventListener(QUERY_EXECUTING_EVENT, handler)
  }, [])

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
      disabled={disabled}
      styles={{ root: { width: 220 } }}
    />
  )
}
