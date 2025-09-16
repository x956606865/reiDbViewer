"use client"

import { useState } from 'react'
import { Tooltip, CopyButton, ActionIcon } from '@mantine/core'
import { IconCopy } from '@tabler/icons-react'

export default function TextCell({ value }: { value: string }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Tooltip label={value} withArrow withinPortal multiline maw={640} position="top-start">
        <span
          title={value}
          style={{
            display: 'inline-block',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {value}
        </span>
      </Tooltip>
      <CopyButton value={value} timeout={1200}>
        {({ copied, copy }) => (
          <ActionIcon
            size="sm"
            variant="subtle"
            color={copied ? 'teal' : 'gray'}
            onClick={copy}
            title={copied ? '已复制' : '复制'}
            style={{ opacity: hover ? 1 : 0.2 }}
          >
            <IconCopy size={14} />
          </ActionIcon>
        )}
      </CopyButton>
    </div>
  )
}

