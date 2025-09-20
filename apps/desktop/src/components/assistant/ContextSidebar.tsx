import { useMemo, useState } from 'react'
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  UnstyledButton,
  useMantineTheme,
} from '@mantine/core'
import { IconPlus, IconSearch } from '@tabler/icons-react'
import type { AssistantContextChunk, AssistantContextSection } from '@/lib/assistant/context-chunks'
import type { AssistantConversationRecord } from '@/lib/assistant/session-store'
import type { ConversationMetricsSummary } from '@/lib/assistant/conversation-utils'
import { PromptLibrary } from './PromptLibrary'

export type ContextSidebarProps = {
  sections: AssistantContextSection[]
  selectedIds: Set<string>
  onToggle: (chunk: AssistantContextChunk, checked: boolean) => void
  selectedCount: number
  maxContextChunks: number
  contextChunks: AssistantContextChunk[]
  onPromptInsert: (body: string) => void
  conversations: AssistantConversationRecord[]
  activeConversationId: string | null
  onSelectConversation: (id: string) => void
  onCreateConversation: () => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  archivedConversations: AssistantConversationRecord[]
  metrics: ConversationMetricsSummary | null
}

export function ContextSidebar(props: ContextSidebarProps) {
  const sections = props.sections
  const { selectedCount, maxContextChunks } = props
  const theme = useMantineTheme()
  const [activeTab, setActiveTab] = useState('conversations')
  const [searchTerm, setSearchTerm] = useState('')
  const [renameOpened, setRenameOpened] = useState(false)
  const [archivedOpened, setArchivedOpened] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const displaySections = useMemo<AssistantContextSection[]>(() => {
    const normalized = searchTerm.trim().toLowerCase()
    if (!normalized) return sections

    const filtered: AssistantContextSection[] = []
    for (const section of sections) {
      const items = section.items.filter((item) => {
        const label = item.label.toLowerCase()
        const description = item.description?.toLowerCase() ?? ''
        const title = item.chunk.title.toLowerCase()
        const summary = item.chunk.summary.toLowerCase()
        return (
          label.includes(normalized) ||
          description.includes(normalized) ||
          title.includes(normalized) ||
          summary.includes(normalized)
        )
      })
      if (items.length > 0) {
        filtered.push({ ...section, items })
      }
    }
    return filtered
  }, [sections, searchTerm])

  const trimmedSearch = searchTerm.trim()
  const effectiveSections = trimmedSearch ? displaySections : sections
  const activeConversation = useMemo(
    () => props.conversations.find((conversation) => conversation.id === props.activeConversationId) ?? null,
    [props.conversations, props.activeConversationId],
  )

  const metricsBadges = useMemo(() => {
    if (!props.metrics) return []
    const summary = props.metrics
    return [
      summary.messageCount > 0 ? `Messages ${summary.messageCount}` : null,
      summary.totalInputTokens > 0 ? `Prompt ${summary.totalInputTokens}` : null,
      summary.totalOutputTokens > 0 ? `Output ${summary.totalOutputTokens}` : null,
      summary.averageLatencyMs > 0 ? `Avg ${Math.round(summary.averageLatencyMs)} ms` : null,
    ].filter(Boolean) as string[]
  }, [props.metrics])

  const handleRenameConfirm = () => {
    if (!activeConversation) return
    const normalized = renameValue.trim()
    if (!normalized) return
    props.onRename(activeConversation.id, normalized)
    setRenameOpened(false)
  }

  return (
    <>
      <Tabs
        value={activeTab}
        onChange={(value) => setActiveTab(value ?? 'context')}
        keepMounted
        style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      >
        <Tabs.List grow>
          <Tabs.Tab value="conversations">对话</Tabs.Tab>
          <Tabs.Tab value="context">Context</Tabs.Tab>
          <Tabs.Tab value="prompts">Prompts</Tabs.Tab>
          <Tabs.Tab value="preview">Preview</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel
          value="conversations"
          style={{ flex: 1, minHeight: 0, display: activeTab === 'conversations' ? 'flex' : 'none', paddingTop: 12 }}
        >
          <Stack gap="md" style={{ flex: 1, minHeight: 0 }}>
            <Group justify="space-between" align="center">
              <Title order={4}>对话</Title>
              <Button size="xs" leftSection={<IconPlus size={14} />} onClick={props.onCreateConversation}>
                新建对话
              </Button>
            </Group>
            <Stack gap="xs">
              <Group gap="xs" align="center" wrap="wrap">
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => {
                    if (!activeConversation) return
                    setRenameValue(activeConversation.title)
                    setRenameOpened(true)
                  }}
                  disabled={!activeConversation}
                >
                  重命名
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => activeConversation && props.onArchive(activeConversation.id)}
                  disabled={!activeConversation}
                >
                  归档
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  onClick={() => activeConversation && props.onDelete(activeConversation.id)}
                  disabled={!activeConversation}
                >
                  删除
                </Button>
                <Button size="xs" variant="default" onClick={() => setArchivedOpened(true)}>
                  已归档 ({props.archivedConversations.length})
                </Button>
              </Group>
              {activeConversation ? (
                metricsBadges.length > 0 ? (
                  <Group gap="xs" wrap="wrap">
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
                )
              ) : (
                <Text size="xs" c="dimmed">
                  选择一个对话以查看统计与操作。
                </Text>
              )}
            </Stack>
            <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars scrollbarSize={6}>
              <Stack gap="xs">
                {props.conversations.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    暂无对话，点击“新建对话”开始一条新的会话。
                  </Text>
                ) : null}
                {props.conversations.map((conversation) => {
                  const isActive = conversation.id === props.activeConversationId
                  const baseTextColor = theme.colorScheme === 'dark' ? theme.colors.gray[0] : theme.colors.dark[7]
                  const activeBackground = theme.colorScheme === 'dark' ? theme.colors.dark[5] : theme.colors.gray[1]
                  const activeBorder = theme.colorScheme === 'dark' ? theme.colors.dark[4] : theme.colors.gray[3]
                  const hoverBackground = theme.colorScheme === 'dark' ? theme.colors.dark[6] : theme.colors.gray[0]
                  return (
                    <Box
                      key={conversation.id}
                      component={UnstyledButton}
                      onClick={() => props.onSelectConversation(conversation.id)}
                      sx={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: theme.radius.md,
                        border: `1px solid ${isActive ? activeBorder : 'transparent'}`,
                        backgroundColor: isActive ? activeBackground : 'transparent',
                        color: baseTextColor,
                        transition: 'background-color 150ms ease, border-color 150ms ease',
                        cursor: 'pointer',
                        '&:hover': {
                          backgroundColor: isActive ? activeBackground : hoverBackground,
                        },
                      }}
                    >
                      <Stack gap={4} style={{ width: '100%' }} align="flex-start">
                        <Group gap="xs" align="center">
                          <Text size="sm" fw={isActive ? 600 : 500} lineClamp={1} c={baseTextColor}>
                            {conversation.title}
                          </Text>
                          {isActive ? <Badge size="sm">当前</Badge> : null}
                        </Group>
                        <Text size="xs" c="dimmed">
                          更新于 {new Date(conversation.updatedAt).toLocaleString()}
                        </Text>
                      </Stack>
                    </Box>
                  )
                })}
              </Stack>
            </ScrollArea>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel
          value="context"
          style={{
            flex: 1,
            minHeight: 0,
            display: activeTab === 'context' ? 'flex' : 'none',
            flexDirection: 'column',
            paddingTop: 12,
          }}
        >
          <Stack gap="md" style={{ flex: 1, minHeight: 0 }}>
            <Title order={4}>Context</Title>
            <TextInput
              placeholder="Search schemas, saved SQL, or recent queries"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.currentTarget.value)}
              leftSection={<IconSearch size={14} />}
              size="xs"
              spellCheck={false}
              autoComplete="off"
            />
            <Text size="xs" c="dimmed">
              {selectedCount > maxContextChunks
                ? `已选择 ${selectedCount} 个上下文，发送请求时仅使用前 ${maxContextChunks} 个。`
                : `最多可选择 ${maxContextChunks} 个上下文参与请求，超出部分会被忽略。`}
            </Text>
            <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars scrollbarSize={6}>
              <Stack gap="md">
                {trimmedSearch && displaySections.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    No entries matched the search keyword.
                  </Text>
                ) : null}
                {effectiveSections.map((section) => {
                  const items = section.items
                  return (
                    <Stack key={section.id} gap="xs">
                      <Box>
                        <Text fw={600} size="sm" c="dimmed">
                          {section.title}
                        </Text>
                        {items.length === 0 ? (
                          <Text size="xs" c="dimmed" mt={2}>
                            {section.emptyHint || 'No entries available.'}
                          </Text>
                        ) : null}
                      </Box>
                      {items.map((item) => {
                        const checked = props.selectedIds.has(item.id)
                        return (
                          <Checkbox
                            key={item.id}
                            label={
                              <Stack gap={2}>
                                <Group gap="xs">
                                  <Text size="sm" fw={500}>
                                    {item.label}
                                  </Text>
                                  {item.chunk.kind === 'saved-sql' ? <Badge size="sm">Saved SQL</Badge> : null}
                                  {item.chunk.kind === 'schema-table' ? <Badge size="sm" color="gray">Schema</Badge> : null}
                                  {item.chunk.kind === 'recent-query' ? <Badge size="sm" color="blue">Recent</Badge> : null}
                                </Group>
                                {item.description ? (
                                  <Text size="xs" c="dimmed">
                                    {item.description}
                                  </Text>
                                ) : null}
                              </Stack>
                            }
                            checked={checked}
                            onChange={(event) => props.onToggle(item.chunk, event.currentTarget.checked)}
                          />
                        )
                      })}
                    </Stack>
                  )
                })}
              </Stack>
            </ScrollArea>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel
          value="prompts"
          style={{ flex: 1, minHeight: 0, display: activeTab === 'prompts' ? 'flex' : 'none', paddingTop: 12 }}
        >
          <Box style={{ flex: 1, minHeight: 0 }}>
            <PromptLibrary onInsert={props.onPromptInsert} />
          </Box>
        </Tabs.Panel>
        <Tabs.Panel
          value="preview"
          style={{ flex: 1, minHeight: 0, display: activeTab === 'preview' ? 'flex' : 'none', paddingTop: 12 }}
        >
          <Stack gap="md" style={{ flex: 1, minHeight: 0 }}>
            <Title order={4}>Context preview</Title>
            <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars scrollbarSize={6}>
              <Stack gap="xs">
                {props.contextChunks.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    Select schema tables, saved SQL, or recent queries to inspect context summaries.
                  </Text>
                ) : null}
                {props.contextChunks.map((chunk) => (
                  <Box key={chunk.id}>
                    <Text size="sm" fw={600}>
                      {chunk.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {chunk.summary}
                    </Text>
                  </Box>
                ))}
              </Stack>
            </ScrollArea>
          </Stack>
        </Tabs.Panel>
      </Tabs>
      <Modal opened={renameOpened} onClose={() => setRenameOpened(false)} title="重命名对话" centered>
        <Stack gap="sm">
          <TextInput value={renameValue} onChange={(event) => setRenameValue(event.currentTarget.value)} autoFocus />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRenameOpened(false)}>
              取消
            </Button>
            <Button onClick={handleRenameConfirm} disabled={!renameValue.trim()}>
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={archivedOpened} onClose={() => setArchivedOpened(false)} title="归档的对话" size="lg">
        {props.archivedConversations.length === 0 ? (
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
              {props.archivedConversations.map((conversation) => (
                <Table.Tr key={conversation.id}>
                  <Table.Td>{conversation.title}</Table.Td>
                  <Table.Td>{new Date(conversation.updatedAt).toLocaleString()}</Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => {
                          props.onRestore(conversation.id)
                          setArchivedOpened(false)
                        }}
                      >
                        恢复
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        onClick={() => props.onDelete(conversation.id)}
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
    </>
  )
}
