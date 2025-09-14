"use client"

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { ActionIcon, Code, Drawer, Group, ScrollArea, Tooltip } from '@mantine/core'
import { CopyButton } from '@mantine/core'
import { IconCopy, IconEye } from '@tabler/icons-react'

// Dynamically load a tree JSON viewer to keep bundle slim and avoid SSR issues
const ReactJson = dynamic(() => import('react-json-view').then((m) => m.default), { ssr: false })

type JsonCellProps = {
  value: unknown
  // number of chars to show in cell preview
  previewMax?: number
}

function safeStringify(v: unknown, space?: number) {
  try {
    return JSON.stringify(v, null, space)
  } catch {
    // handle circular structures by best-effort
    const cache = new WeakSet()
    const str = JSON.stringify(
      v,
      (key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (cache.has(val as any)) return '[Circular]'
          cache.add(val as any)
        }
        return val
      },
      space
    )
    return str
  }
}

export default function JsonCell({ value, previewMax = 20 }: JsonCellProps) {
  const [opened, setOpened] = useState(false)
  const pretty = useMemo(() => safeStringify(value, 2), [value])
  const parsed = useMemo(() => {
    if (typeof value === 'string') {
      try { return JSON.parse(value) } catch { /* fallthrough */ }
    }
    return value
  }, [value])
  const preview = useMemo(() => {
    const s = safeStringify(value)
    if (s.length <= previewMax) return s
    return s.slice(0, previewMax) + '…'
  }, [value, previewMax])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          onClick={() => setOpened(true)}
          title="查看 JSON"
          style={{
            cursor: 'pointer',
            maxWidth: '100%',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          }}
        >
          {preview}
        </div>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="查看">
            <ActionIcon size="sm" variant="light" onClick={() => setOpened(true)}>
              <IconEye size={14} />
            </ActionIcon>
          </Tooltip>
          <CopyButton value={pretty}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? '已复制' : '复制'}>
                <ActionIcon size="sm" variant="light" color={copied ? 'teal' : 'gray'} onClick={copy}>
                  <IconCopy size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
      </div>
      <Drawer opened={opened} onClose={() => setOpened(false)} title="JSON 详情" size="lg" position="right">
        <ScrollArea h={520} type="auto">
          {/* Prefer tree view when value is object/array; otherwise fallback to pretty text */}
          {parsed && typeof parsed === 'object' ? (
            // @ts-ignore react-json-view types are loose
            <ReactJson
              name={null}
              src={parsed as any}
              collapsed={1}
              enableClipboard={false}
              displayDataTypes={false}
              displayObjectSize={false}
              style={{ background: 'transparent', fontFamily: 'var(--mantine-font-family-monospace)' }}
            />
          ) : (
            <Code block>{pretty}</Code>
          )}
        </ScrollArea>
      </Drawer>
    </>
  )
}
