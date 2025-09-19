import { Badge, Box, Button, Checkbox, Group, ScrollArea, Stack, Text, Title } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import type { AssistantContextChunk, AssistantContextSection } from '@/lib/assistant/context-chunks'

export type ContextSidebarProps = {
  sections: AssistantContextSection[]
  selectedIds: Set<string>
  onToggle: (chunk: AssistantContextChunk, checked: boolean) => void
  onRefreshSavedSql: () => void
  onRefreshRecentQueries: () => void
  selectedCount: number
  maxContextChunks: number
}

export function ContextSidebar(props: ContextSidebarProps) {
  const sections = props.sections
  const { selectedCount, maxContextChunks } = props

  return (
    <Stack gap="md" h="100%" style={{ minHeight: 0 }}>
      <Group justify="space-between">
        <Title order={4}>Context</Title>
        <Group gap="xs">
          <Button variant="subtle" size="xs" onClick={props.onRefreshSavedSql} leftSection={<IconRefresh size={12} />}>
            Saved SQL
          </Button>
          <Button variant="subtle" size="xs" onClick={props.onRefreshRecentQueries} leftSection={<IconRefresh size={12} />}>
            Recent
          </Button>
        </Group>
      </Group>
      <Text size="xs" c="dimmed">
        {selectedCount > maxContextChunks
          ? `已选择 ${selectedCount} 个上下文，发送请求时仅使用前 ${maxContextChunks} 个。`
          : `最多可选择 ${maxContextChunks} 个上下文参与请求，超出部分会被忽略。`}
      </Text>
      <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars scrollbarSize={6}>
        <Stack gap="md">
          {sections.map((section) => {
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
  )
}
