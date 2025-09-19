import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { IconArchive, IconEdit, IconKey, IconPlus, IconRecycle, IconTrash } from '@tabler/icons-react'
import type { AssistantConversationRecord } from '@/lib/assistant/session-store'
import type { ConversationMetricsSummary } from '@/lib/assistant/conversation-utils'

export type ConversationToolbarProps = {
  activeId: string | null
  conversations: AssistantConversationRecord[]
  archivedConversations: AssistantConversationRecord[]
  metrics: ConversationMetricsSummary | null
  onSelect: (id: string | null) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onOpenSettings: () => void
  apiKeyReady: boolean | null
}

export function ConversationToolbar({
  activeId,
  conversations,
  archivedConversations,
  metrics,
  onSelect,
  onCreate,
  onRename,
  onArchive,
  onDelete,
  onRestore,
  onOpenSettings,
  apiKeyReady,
}: ConversationToolbarProps) {
  const [renameOpened, setRenameOpened] = useState(false)
  const [archivedOpened, setArchivedOpened] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const activeConversation = useMemo(
    () => conversations.find((conv) => conv.id === activeId) ?? null,
    [conversations, activeId],
  )

  const selectData = useMemo(
    () => conversations.map((conv) => ({ value: conv.id, label: conv.title })),
    [conversations],
  )

  const handleRenameConfirm = () => {
    if (activeId) {
      onRename(activeId, renameValue)
      setRenameOpened(false)
    }
  }

  const metricsBadges = metrics
    ? [
        metrics.messageCount > 0 ? `Messages ${metrics.messageCount}` : null,
        metrics.totalInputTokens > 0 ? `Prompt ${metrics.totalInputTokens}` : null,
        metrics.totalOutputTokens > 0 ? `Output ${metrics.totalOutputTokens}` : null,
        metrics.averageLatencyMs > 0 ? `Avg ${Math.round(metrics.averageLatencyMs)} ms` : null,
      ].filter(Boolean)
    : []

  return (
    <Paper withBorder radius="md" p="sm">
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Group gap="sm" align="center" wrap="nowrap">
            <Select
              placeholder="选择对话"
              data={selectData}
              value={activeId}
              onChange={(value) => onSelect(value ?? null)}
              clearable
              searchable
              nothingFoundMessage="没有找到对话"
              style={{ minWidth: 220 }}
            />
            <Button leftSection={<IconPlus size={16} />} onClick={onCreate}>
              新建对话
            </Button>
          </Group>
          <Group gap="xs">
            <Tooltip label="重命名对话" withArrow>
              <ActionIcon
                variant="light"
                onClick={() => {
                  if (!activeConversation) return
                  setRenameValue(activeConversation.title)
                  setRenameOpened(true)
                }}
                disabled={!activeConversation}
                aria-label="重命名对话"
              >
                <IconEdit size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="归档当前对话" withArrow>
              <ActionIcon
                variant="light"
                color="blue"
                onClick={() => activeConversation && onArchive(activeConversation.id)}
                disabled={!activeConversation}
                aria-label="归档对话"
              >
                <IconArchive size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="删除当前对话" withArrow>
              <ActionIcon
                variant="light"
                color="red"
                onClick={() => activeConversation && onDelete(activeConversation.id)}
                disabled={!activeConversation}
                aria-label="删除对话"
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
            <Button variant="default" onClick={() => setArchivedOpened(true)}>
              已归档 ({archivedConversations.length})
            </Button>
            <Tooltip
              label={apiKeyReady ? 'API key 已配置' : '未配置 API key，助手将使用模拟回复'}
              withArrow
            >
              <ActionIcon
                variant={apiKeyReady ? 'light' : 'outline'}
                color={apiKeyReady ? 'teal' : 'yellow'}
                onClick={onOpenSettings}
                aria-label="助手设置"
              >
                <IconKey size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        {metricsBadges.length > 0 ? (
          <Group gap="xs">
            {metricsBadges.map((badge) => (
              <Badge key={badge} variant="light">
                {badge}
              </Badge>
            ))}
          </Group>
        ) : (
          <Text size="xs" c="dimmed">
            对话尚无统计数据，发送消息后会展示耗时与 token 估算。
          </Text>
        )}
      </Stack>

      <Modal opened={renameOpened} onClose={() => setRenameOpened(false)} title="重命名对话" centered>
        <Stack gap="sm">
          <TextInput value={renameValue} onChange={(event) => setRenameValue(event.currentTarget.value)} autoFocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRenameOpened(false)}>
              取消
            </Button>
            <Button onClick={handleRenameConfirm}>保存</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={archivedOpened} onClose={() => setArchivedOpened(false)} title="归档的对话" size="lg">
        {archivedConversations.length === 0 ? (
          <Text size="sm" c="dimmed">
            当前没有归档的对话。
          </Text>
        ) : (
          <Table striped highlightOnHover withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>名称</Table.Th>
                <Table.Th>最后更新</Table.Th>
                <Table.Th>操作</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {archivedConversations.map((conv) => (
                <Table.Tr key={conv.id}>
                  <Table.Td>{conv.title}</Table.Td>
                  <Table.Td>{new Date(conv.updatedAt).toLocaleString()}</Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconRecycle size={14} />}
                        onClick={() => {
                          onRestore(conv.id)
                          setArchivedOpened(false)
                        }}
                      >
                        恢复
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => onDelete(conv.id)}
                      >
                        删除
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Modal>
    </Paper>
  )
}
