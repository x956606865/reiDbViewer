import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Group, Paper, Stack, Text } from '@mantine/core'
import { ContextSidebar } from '@/components/assistant/ContextSidebar'
import { PromptLibrary } from '@/components/assistant/PromptLibrary'
import { ChatPanel } from '@/components/assistant/ChatPanel'
import {
  getSchemaMetadataSnapshot,
  subscribeSchemaMetadata,
  type SchemaMetadataSnapshot,
} from '@/lib/schema-metadata-store'
import type { SavedSqlSummary } from '@/services/savedSql'
import { listSavedSql } from '@/services/savedSql'
import {
  loadRecentQueries,
  type RecentQueryEntry,
} from '@/lib/assistant/recent-queries-store'
import {
  buildContextSections,
  type AssistantContextChunk,
  type AssistantContextSection,
} from '@/lib/assistant/context-chunks'
import { DesktopChatTransport } from '@/lib/assistant/desktop-transport'

function useSchemaMetadata(): SchemaMetadataSnapshot | null {
  const [snapshot, setSnapshot] = useState<SchemaMetadataSnapshot | null>(() => getSchemaMetadataSnapshot())
  useEffect(() => {
    const unsubscribe = subscribeSchemaMetadata((value) => setSnapshot(value))
    return () => {
      unsubscribe()
    }
  }, [])
  return snapshot
}

export default function AssistantPage() {
  const schemaSnapshot = useSchemaMetadata()
  const [savedSql, setSavedSql] = useState<SavedSqlSummary[]>([])
  const [recentQueries, setRecentQueries] = useState<RecentQueryEntry[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)

  const refreshSavedSql = useCallback(async () => {
    try {
      const list = await listSavedSql()
      setSavedSql(list)
    } catch (err) {
      console.warn('failed to load saved sql', err)
    }
  }, [])

  const refreshRecentQueries = useCallback(async () => {
    try {
      const items = await loadRecentQueries(20)
      setRecentQueries(items)
    } catch (err) {
      console.warn('failed to load recent queries', err)
    }
  }, [])

  useEffect(() => {
    void refreshSavedSql()
  }, [refreshSavedSql])

  useEffect(() => {
    void refreshRecentQueries()
  }, [refreshRecentQueries])

  const sections = useMemo<AssistantContextSection[]>(
    () =>
      buildContextSections({
        schema: schemaSnapshot,
        savedSql,
        recentQueries,
      }),
    [schemaSnapshot, savedSql, recentQueries],
  )

  const handleToggleContext = useCallback((chunk: AssistantContextChunk, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(chunk.id)
      else next.delete(chunk.id)
      return next
    })
  }, [])

  const contextChunks = useMemo(() => {
    const chunks: AssistantContextChunk[] = []
    const selected = selectedIds
    for (const section of sections) {
      for (const item of section.items) {
        if (selected.has(item.id)) {
          chunks.push(item.chunk)
        }
      }
    }
    return chunks
  }, [sections, selectedIds])
  const transport = useMemo(() => new DesktopChatTransport(), [])

  useEffect(() => {
    transport.setContextChunks(contextChunks)
  }, [transport, contextChunks])

  const handlePromptInsert = useCallback((body: string) => {
    setPendingPrompt(body)
  }, [])

  const handlePromptConsumed = useCallback(() => {
    setPendingPrompt(null)
  }, [])

  return (
    <Stack gap="md" h="100%">
      <Group align="flex-start" gap="md" wrap="nowrap" style={{ flex: 1, width: '100%', height: '100%' }}>
        <Box style={{ width: 280, height: '100%' }}>
          <ContextSidebar
            sections={sections}
            selectedIds={selectedIds}
            onToggle={handleToggleContext}
            onRefreshSavedSql={refreshSavedSql}
            onRefreshRecentQueries={refreshRecentQueries}
          />
        </Box>
        <Box style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {contextChunks.length > 0 ? (
            <Paper withBorder p="sm" radius="md">
              <Stack gap={4}>
                <Text size="sm" fw={600}>
                  Context preview
                </Text>
                {contextChunks.slice(0, 6).map((chunk) => (
                  <Text key={chunk.id} size="xs" c="dimmed">
                    {chunk.title} — {chunk.summary}
                  </Text>
                ))}
                {contextChunks.length > 6 ? (
                  <Text size="xs" c="dimmed">
                    + {contextChunks.length - 6} more
                  </Text>
                ) : null}
              </Stack>
            </Paper>
          ) : (
            <Paper withBorder p="sm" radius="md">
              <Text size="xs" c="dimmed">
                Select schema tables, saved SQL, or recent queries to include additional context.
              </Text>
            </Paper>
          )}
          <Box style={{ flex: 1, minHeight: 0 }}>
            <ChatPanel
              transport={transport}
              contextChunks={contextChunks}
              pendingPrompt={pendingPrompt}
              onPromptConsumed={handlePromptConsumed}
            />
          </Box>
        </Box>
        <Box style={{ width: 320, height: '100%' }}>
          <PromptLibrary onInsert={handlePromptInsert} />
        </Box>
      </Group>
    </Stack>
  )
}
