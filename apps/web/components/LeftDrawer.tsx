"use client"

import React from 'react'
import { ActionIcon, Group, ScrollArea, Text } from '@mantine/core'
import { IconPin, IconChevronRight } from '@tabler/icons-react'

type LeftDrawerProps = {
  title?: string
  children: React.ReactNode
  widthExpanded?: number
  widthCollapsed?: number
  storageKey?: string
}

export function LeftDrawer({
  title = 'Menu',
  children,
  widthExpanded = 280,
  widthCollapsed = 16, // 收起时仅保留把手
  storageKey = 'rdv.leftDrawer.queries.pin',
}: LeftDrawerProps) {
  const [pinned, setPinned] = React.useState<boolean>(false)
  const [handleHover, setHandleHover] = React.useState<boolean>(false)
  const [contentHover, setContentHover] = React.useState<boolean>(false)

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setPinned(JSON.parse(raw))
    } catch {}
  }, [storageKey])

  React.useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(pinned)) } catch {}
  }, [pinned, storageKey])

  const isOpen = pinned || handleHover || contentHover
  const w = isOpen ? widthExpanded : widthCollapsed

  return (
    <div
      style={{
        width: w,
        transition: 'width 150ms ease',
        height: '100vh',
        position: 'sticky',
        top: 0,
        borderRight: isOpen ? '1px solid var(--mantine-color-default-border)' : 'none',
        background: 'var(--mantine-color-body)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseLeave={() => {
        if (!pinned) {
          setContentHover(false)
          setHandleHover(false)
        }
      }}
    >
      {isOpen ? (
        <div
          onMouseEnter={() => setContentHover(true)}
          onMouseLeave={() => setContentHover(false)}
          style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
        >
          <Group
            justify="space-between"
            align="center"
            gap="xs"
            style={{ padding: 8, borderBottom: '1px solid var(--mantine-color-default-border)' }}
          >
            <Text size="sm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</Text>
            <ActionIcon
              aria-pressed={pinned}
              variant="transparent"
              onClick={() => {
                setPinned((prev) => {
                  const next = !prev
                  // 若取消固定且当前既不在把手也不在内容区，则立即允许收起
                  if (!next && !handleHover && !contentHover) {
                    // ensure close if not hovered
                  }
                  return next
                })
              }}
              title={pinned ? '取消固定' : '固定抽屉'}
            >
              <IconPin size={16} color={pinned ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-dimmed)'} />
            </ActionIcon>
          </Group>
          <ScrollArea style={{ flex: 1 }}>
            <div style={{ padding: 8 }}>
              {children}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <div
          style={{
            width: widthCollapsed,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'default',
          }}
          aria-label="展开抽屉"
          onMouseEnter={() => setHandleHover(true)}
          onMouseLeave={() => setHandleHover(false)}
        >
          <IconChevronRight size={16} />
        </div>
      )}
    </div>
  )
}
