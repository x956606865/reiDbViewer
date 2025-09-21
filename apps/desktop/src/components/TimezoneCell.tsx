import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  CopyButton,
  Drawer,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tooltip,
} from '@mantine/core'
import { IconClockHour3, IconCopy, IconWorld } from '@tabler/icons-react'
import { normalizeTimestampWithOffset } from '../lib/timezone-detect'

type TimezoneCellProps = {
  value: string
}

type TimezoneTarget = {
  label: string
  timeZone: string
  note?: string
}

const COMMON_TIME_ZONES: TimezoneTarget[] = [
  { label: 'UTC', timeZone: 'UTC', note: '协调世界时' },
  { label: '中国（北京时间）', timeZone: 'Asia/Shanghai' },
  { label: '纽约（美国东部）', timeZone: 'America/New_York' },
  { label: '旧金山（美国西部）', timeZone: 'America/Los_Angeles' },
  { label: '伦敦（英国）', timeZone: 'Europe/London' },
  { label: '柏林（德国）', timeZone: 'Europe/Berlin' },
  { label: '新德里（印度）', timeZone: 'Asia/Kolkata' },
  { label: '新加坡', timeZone: 'Asia/Singapore' },
  { label: '东京（日本）', timeZone: 'Asia/Tokyo' },
  { label: '悉尼（澳大利亚）', timeZone: 'Australia/Sydney' },
]

function formatDateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const lookup = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${lookup('year')}-${lookup('month')}-${lookup('day')} ${lookup('hour')}:${lookup('minute')}:${lookup('second')}`
}

function getOffsetLabel(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'shortOffset',
    hourCycle: 'h23',
  })
  const tzPart = formatter
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value
  if (!tzPart) return ''
  const match = tzPart.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/)
  if (!match) return tzPart.replace('GMT', 'UTC')
  const hourPart = match[1]
  if (!hourPart) return tzPart.replace('GMT', 'UTC')
  const minutePart = match[2]
  const hours = Number.parseInt(hourPart, 10)
  const minutes = minutePart ? Number(minutePart) : 0
  const sign = hours < 0 || hourPart.startsWith('-') ? '-' : '+'
  const absHours = Math.abs(hours)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `UTC${sign}${pad(absHours)}:${pad(minutes)}`
}

export default function TimezoneCell({ value }: TimezoneCellProps) {
  const [opened, setOpened] = useState(false)
  const normalized = useMemo(() => normalizeTimestampWithOffset(value) ?? undefined, [value])
  const parsed = useMemo(() => (normalized ? new Date(normalized) : null), [normalized])
  const preview = useMemo(() => (value.length > 32 ? `${value.slice(0, 32)}…` : value), [value])
  const localZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const rows = useMemo(() => {
    if (!parsed) return []
    const seen = new Map<string, string>()
    const list: TimezoneTarget[] = []
    const push = (item: TimezoneTarget) => {
      const existingLabel = seen.get(item.timeZone)
      if (existingLabel && existingLabel === item.label) return
      seen.set(item.timeZone, item.label)
      list.push(item)
    }
    if (localZone) {
      push({ label: '当前系统时区', timeZone: localZone })
    }
    for (const zone of COMMON_TIME_ZONES) push(zone)
    return list.map((zone) => ({
      ...zone,
      formatted: formatDateInZone(parsed, zone.timeZone),
      offset: getOffsetLabel(parsed, zone.timeZone),
    }))
  }, [parsed, localZone])

  if (!normalized || !parsed) {
    return <span>{value}</span>
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Tooltip label="查看时区详情" withinPortal>
          <Group
            gap={6}
            onClick={() => setOpened(true)}
            style={{
              cursor: 'pointer',
              maxWidth: '100%',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              flexWrap: 'nowrap',
            }}
          >
            <IconClockHour3 size={14} stroke={1.75} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview}</span>
          </Group>
        </Tooltip>
        <CopyButton value={value} timeout={1200}>
          {({ copied, copy }) => (
            <ActionIcon
              size="sm"
              variant="subtle"
              color={copied ? 'teal' : 'gray'}
              onClick={copy}
              title={copied ? '已复制原始值' : '复制原始值'}
            >
              <IconCopy size={14} />
            </ActionIcon>
          )}
        </CopyButton>
      </div>
      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        title="时区详情"
        size="lg"
        position="right"
      >
        <Stack gap="md">
          <Stack gap={4}>
            <Text fw={600}>原始值</Text>
            <Group justify="space-between" wrap="nowrap">
              <Text style={{ wordBreak: 'break-all' }}>{value}</Text>
              <CopyButton value={value} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? '已复制' : '复制原始值'}>
                    <ActionIcon
                      variant="subtle"
                      color={copied ? 'teal' : 'gray'}
                      onClick={copy}
                      aria-label="复制原始值"
                    >
                      <IconCopy size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
          </Stack>

          <Stack gap={4}>
            <Text fw={600}>标准化</Text>
            <Group justify="space-between" wrap="nowrap">
              <Text style={{ wordBreak: 'break-all' }}>{normalized}</Text>
              <CopyButton value={normalized} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? '已复制' : '复制 ISO'}>
                    <ActionIcon
                      variant="subtle"
                      color={copied ? 'teal' : 'gray'}
                      onClick={copy}
                      aria-label="复制标准化时间"
                    >
                      <IconCopy size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
          </Stack>

          <Stack gap={4}>
            <Text fw={600}>UTC 时间</Text>
            <Group justify="space-between" wrap="nowrap">
              <Text style={{ wordBreak: 'break-all' }}>{parsed.toISOString()}</Text>
              <CopyButton value={parsed.toISOString()} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? '已复制' : '复制 UTC'}>
                    <ActionIcon
                      variant="subtle"
                      color={copied ? 'teal' : 'gray'}
                      onClick={copy}
                      aria-label="复制 UTC"
                    >
                      <IconCopy size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
          </Stack>

          <Stack gap={8}>
            <Group gap={6}>
              <IconWorld size={16} />
              <Text fw={600}>常见地点时间</Text>
            </Group>
            <ScrollArea h={360} type="auto">
              <Table
                stickyHeader
                verticalSpacing="xs"
                style={{ tableLayout: 'auto', minWidth: 520 }}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>地点</Table.Th>
                    <Table.Th>当地时间</Table.Th>
                    <Table.Th style={{ width: 132 }}>相对 UTC</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((row) => (
                    <Table.Tr key={`${row.timeZone}-${row.label}`}>
                      <Table.Td>
                        <Stack gap={0}>
                          <Text fw={500}>{row.label}</Text>
                          {row.note && (
                            <Text size="xs" c="dimmed">
                              {row.note}
                            </Text>
                          )}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Text
                          style={{
                            fontFamily: 'var(--mantine-font-family-monospace)',
                            fontVariantNumeric: 'tabular-nums',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.formatted}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          variant="light"
                          color="blue"
                          style={{
                            whiteSpace: 'nowrap',
                            fontVariantNumeric: 'tabular-nums',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: 96,
                          }}
                        >
                          {row.offset || '—'}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Stack>
        </Stack>
      </Drawer>
    </>
  )
}
