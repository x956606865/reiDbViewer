"use client"

import { useState, useMemo, Suspense, lazy } from 'react'
import { Button, Drawer, Group, ScrollArea, Tooltip } from '@mantine/core'
import { CopyButton, ActionIcon } from '@mantine/core'
import { IconEye, IconCopy } from '@tabler/icons-react'
const ReactJson = lazy(() => import('react-json-view').then((m) => ({ default: m.default })))

type Props = {
  record: Record<string, unknown>
}

function safeStringify(v: unknown, space?: number) {
  try { return JSON.stringify(v, null, space) } catch { return String(v) }
}

export default function RowViewButton({ record }: Props) {
  const [open, setOpen] = useState(false)
  const pretty = useMemo(() => safeStringify(record, 2), [record])

  return (
    <>
      <Group gap={6} justify="flex-start">
        <Button size="xs" variant="light" leftSection={<IconEye size={14} />} onClick={() => setOpen(true)}>
          查看
        </Button>
      </Group>
      <Drawer opened={open} onClose={() => setOpen(false)} title="行数据" size="lg" position="right">
        <Group justify="space-between" align="center" mb="xs">
          <div />
          <CopyButton value={pretty}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? '已复制' : '复制 JSON'}>
                <ActionIcon size="sm" variant="light" color={copied ? 'teal' : 'gray'} onClick={copy}>
                  <IconCopy size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
        <ScrollArea h={520} type="auto">
          <Suspense fallback={null}>
            {/* @ts-ignore (library typings allow this usage) */}
            <ReactJson
              name={null}
              src={record as any}
              collapsed={1}
              enableClipboard={false}
              displayDataTypes={false}
              displayObjectSize={false}
              style={{ background: 'transparent' }}
            />
          </Suspense>
        </ScrollArea>
      </Drawer>
    </>
  )
}
