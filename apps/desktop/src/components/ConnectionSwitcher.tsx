import { useEffect, useMemo, useState } from 'react'
import { Select, Loader, rem } from '@mantine/core'
import { IconPlugConnected } from '@tabler/icons-react'
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
      size="sm"
      radius="md"
      variant="default"
      leftSection={<IconPlugConnected size={15} stroke={1.6} />}
      leftSectionWidth={34}
      leftSectionPointerEvents="none"
      comboboxProps={{ transitionProps: { transition: 'pop', duration: 120 } }}
      nothingFoundMessage="没有匹配的连接"
      styles={(theme) => {
        const palette = theme.colors[theme.primaryColor] || theme.colors.blue
        const focusBorder = palette?.[5] || theme.colors.blue[5]
        const selectedBg = palette?.[1] || theme.colors.blue[1]
        const selectedText = palette?.[7] || theme.colors.blue[7]

        const paddingX = rem(12)
        const paddingWithIcon = rem(38)

        return {
          root: {
            width: 240,
          },
          input: {
            backgroundColor: theme.white,
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.colors.gray[3]}`,
            paddingInlineEnd: paddingX,
            paddingInlineStart: paddingWithIcon,
            height: rem(36),
            fontWeight: 600,
            color: theme.colors.gray[8],
            transition: 'border-color 120ms ease, box-shadow 120ms ease',
            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
            '&:focus, &:focus-within': {
              borderColor: focusBorder,
              boxShadow: '0 0 0 3px rgba(58, 112, 200, 0.2)',
            },
            '&::placeholder': {
              color: theme.colors.gray[5],
            },
          },
          dropdown: {
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.colors.gray[2]}`,
            padding: rem(6),
            boxShadow: theme.shadows.md,
          },
          option: {
            borderRadius: theme.radius.sm,
            paddingBlock: rem(6),
            paddingInline: rem(10),
            fontWeight: 500,
            color: theme.colors.gray[7],
            '&[data-hovered]': {
              backgroundColor: 'var(--mantine-color-blue-0)',
            },
            '&[data-selected]': {
              backgroundColor: selectedBg,
              color: selectedText,
            },
          },
          clear: {
            color: theme.colors.gray[5],
            transition: 'color 120ms ease',
            '&:hover': {
              color: theme.colors.red[6],
            },
          },
        }
      }}
    />
  )
}
