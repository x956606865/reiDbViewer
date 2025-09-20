import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Group, Paper, Stack, Text } from '@mantine/core'
import { shallow } from 'zustand/shallow'
import type { UIMessage } from 'ai'
import { ConversationToolbar } from '@/components/assistant/ConversationToolbar'
import { ContextSidebar } from '@/components/assistant/ContextSidebar'
import { PromptLibrary } from '@/components/assistant/PromptLibrary'
import { ChatPanel, INITIAL_MESSAGES } from '@/components/assistant/ChatPanel'
import { AssistantSettingsModal } from '@/components/assistant/AssistantSettingsModal'
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
import { useAssistantSessions } from '@/lib/assistant/session-store'
import type { AssistantConversationMessage, AssistantMessageMetrics } from '@/lib/assistant/conversation-utils'
import { getCurrentConnId, subscribeCurrentConnId } from '@/lib/current-conn'
import {
  loadAssistantProviderProfiles,
  loadAssistantProfileSelection,
  resolveAssistantRuntimeSettings,
  saveAssistantProfileSelection,
  type AssistantProviderProfile,
  type AssistantProfileSelection,
} from '@/lib/assistant/provider-settings'
import { hasAssistantApiKey } from '@/lib/assistant/api-key-store'

const MAX_CONTEXT_CHUNKS = 6

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

function useCurrentConnectionId(): string | null {
  const [connId, setConnId] = useState<string | null>(() => getCurrentConnId())
  useEffect(() => {
    return subscribeCurrentConnId((value) => setConnId(value))
  }, [])
  return connId
}

function toUiMessages(messages: AssistantConversationMessage[] | undefined): UIMessage[] {
  if (!messages || messages.length === 0) return INITIAL_MESSAGES
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [
      {
        type: 'text',
        text: message.text ?? '',
      },
    ],
    createdAt: new Date(message.createdAt || Date.now()),
  }))
}

export default function AssistantPage() {
  const schemaSnapshot = useSchemaMetadata()
  const currentConnId = useCurrentConnectionId()
  const [savedSql, setSavedSql] = useState<SavedSqlSummary[]>([])
  const [recentQueries, setRecentQueries] = useState<RecentQueryEntry[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)
  const [transportNotice, setTransportNotice] = useState<string | null>(null)
  const [settingsOpened, setSettingsOpened] = useState(false)
  const [profiles, setProfiles] = useState<AssistantProviderProfile[]>([])
  const [profileSelection, setProfileSelection] = useState<AssistantProfileSelection | null>(null)
  const runtime = useMemo(
    () => resolveAssistantRuntimeSettings(profiles, profileSelection),
    [profiles, profileSelection],
  )
  const [apiKeyReady, setApiKeyReady] = useState<boolean | null>(null)

  const handleApiKeyChange = useCallback(
    (ready: boolean) => {
      setApiKeyReady(ready)
    },
    [setApiKeyReady],
  )

  const {
    ready,
    initialize,
    createConversation,
    ensureConversation,
    selectConversation,
    conversations,
    archivedConversations,
    activeId,
    persistMessages,
    renameConversation,
    archiveConversation,
    deleteConversation,
    restoreConversation,
    recordAssistantMetrics,
  } = useAssistantSessions(
    (state) => ({
      ready: state.ready,
      initialize: state.initialize,
      createConversation: state.createConversation,
      ensureConversation: state.ensureConversation,
      selectConversation: state.selectConversation,
      conversations: state.conversations,
      archivedConversations: state.archivedConversations,
      activeId: state.activeId,
      persistMessages: state.persistMessages,
      renameConversation: state.renameConversation,
      archiveConversation: state.archiveConversation,
      deleteConversation: state.deleteConversation,
      restoreConversation: state.restoreConversation,
      recordAssistantMetrics: state.recordAssistantMetrics,
    }),
    shallow,
  )

  useEffect(() => {
    void initialize()
  }, [initialize])

  useEffect(() => {
    if (!ready) return
    void ensureConversation({ connectionId: currentConnId ?? null })
  }, [ready, ensureConversation, currentConnId])

  const activeConversation = useMemo(
    () => conversations.find((conv) => conv.id === activeId) ?? null,
    [conversations, activeId],
  )

  const initialMessages = useMemo(() => toUiMessages(activeConversation?.messages), [activeConversation?.messages])

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

  const selectedCount = selectedIds.size
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
    const selectedChunks: AssistantContextChunk[] = []
    for (const section of sections) {
      for (const item of section.items) {
        if (selectedIds.has(item.id)) {
          selectedChunks.push(item.chunk)
        }
      }
    }
    return selectedChunks.slice(0, MAX_CONTEXT_CHUNKS)
  }, [sections, selectedIds])

  const transport = useMemo(
    () =>
      new DesktopChatTransport({
        onFallback: (error) => {
          const reason = error instanceof Error ? error.message : String(error ?? '')
          setTransportNotice(
            reason
              ? `无法连接到桌面后端，已使用本地模拟回答：${reason}`
              : '无法连接到桌面后端，已使用本地模拟回答。',
          )
        },
        onSuccess: () => {
          setTransportNotice(null)
        },
      }),
    [],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loadedProfiles = await loadAssistantProviderProfiles()
        if (cancelled) return
        setProfiles(loadedProfiles)
        const loadedSelection = await loadAssistantProfileSelection(loadedProfiles)
        if (cancelled) return
        setProfileSelection(loadedSelection)
      } catch (error) {
        console.warn('failed to load assistant provider profiles', error)
        if (!cancelled) {
          setProfiles([])
          setProfileSelection(null)
          setApiKeyReady(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const runtimeSettings = runtime.settings

  useEffect(() => {
    transport.setProviderSettings(runtimeSettings)
  }, [
    transport,
    runtimeSettings.provider,
    runtimeSettings.model,
    runtimeSettings.baseUrl,
    runtimeSettings.temperature,
    runtimeSettings.maxTokens,
  ])

  useEffect(() => {
    let ignore = false
    void (async () => {
      try {
        const provider = runtime.profile.provider
        if (provider === 'lmstudio' || provider === 'ollama') {
          if (!ignore) setApiKeyReady(true)
          return
        }
        const keyPresent = await hasAssistantApiKey(provider)
        if (!ignore) setApiKeyReady(Boolean(keyPresent))
      } catch (error) {
        console.warn('failed to verify assistant api key', error)
        if (!ignore) setApiKeyReady(false)
      }
    })()
    return () => {
      ignore = true
    }
  }, [runtime.profile.provider])

  useEffect(() => {
    transport.setContextChunks(contextChunks)
  }, [transport, contextChunks])

  const handlePromptInsert = useCallback((body: string) => {
    setPendingPrompt(body)
  }, [])

  const handlePromptConsumed = useCallback(() => {
    setPendingPrompt(null)
  }, [])

  const handleSelectConversation = useCallback(
    (id: string | null) => {
      if (id) {
        selectConversation(id)
      } else {
        void createConversation({ connectionId: currentConnId ?? null })
      }
    },
    [selectConversation, createConversation, currentConnId],
  )

  const handlePersistMessages = useCallback(
    async (messages: UIMessage[], opts?: { updatedAt?: number }) => {
      if (!activeId) return
      await persistMessages({
        conversationId: activeId,
        messages,
        contextChunks,
        connectionId: currentConnId ?? null,
        updatedAt: opts?.updatedAt,
      })
    },
    [activeId, persistMessages, contextChunks, currentConnId],
  )

  const handleRecordAssistantMetrics = useCallback(
    async (messageId: string, metrics: AssistantMessageMetrics) => {
      if (!activeId) return
      await recordAssistantMetrics(activeId, messageId, metrics)
    },
    [activeId, recordAssistantMetrics],
  )

  const handleProfilesSaved = useCallback(
    (nextProfiles: AssistantProviderProfile[], nextSelection?: AssistantProfileSelection) => {
      setProfiles(nextProfiles)
      const resolution = resolveAssistantRuntimeSettings(nextProfiles, nextSelection ?? profileSelection)
      setProfileSelection(resolution.selection)
      void saveAssistantProfileSelection(resolution.selection)
    },
    [profileSelection, saveAssistantProfileSelection],
  )

  const handleSelectProfileOption = useCallback(
    (profileId: string) => {
      const targetProfile = profiles.find((profile) => profile.id === profileId)
      const desiredSelection: AssistantProfileSelection = {
        profileId,
        modelId:
          targetProfile?.defaultModelId ??
          targetProfile?.models[0]?.id ??
          runtime.selection.modelId,
      }
      const resolution = resolveAssistantRuntimeSettings(profiles, desiredSelection)
      setProfileSelection(resolution.selection)
      void saveAssistantProfileSelection(resolution.selection)
    },
    [profiles, runtime.selection.modelId, saveAssistantProfileSelection],
  )

  const handleSelectModelOption = useCallback(
    (modelId: string) => {
      const desiredSelection: AssistantProfileSelection = {
        profileId: runtime.selection.profileId,
        modelId,
      }
      const resolution = resolveAssistantRuntimeSettings(profiles, desiredSelection)
      setProfileSelection(resolution.selection)
      void saveAssistantProfileSelection(resolution.selection)
    },
    [profiles, runtime.selection.profileId, saveAssistantProfileSelection],
  )

  const handleCreateConversation = useCallback(() => {
    void createConversation({ connectionId: currentConnId ?? null })
  }, [createConversation, currentConnId])

  const handleArchiveConversation = useCallback(
    (id: string) => {
      void archiveConversation(id)
    },
    [archiveConversation],
  )

  const handleDeleteConversation = useCallback(
    (id: string) => {
      void deleteConversation(id)
    },
    [deleteConversation],
  )

  const handleRestoreConversation = useCallback(
    (id: string) => {
      void restoreConversation(id)
    },
    [restoreConversation],
  )

  const handleRenameConversation = useCallback(
    (id: string, title: string) => {
      void renameConversation(id, title)
    },
    [renameConversation],
  )

  const metrics = activeConversation?.metrics ?? null

  const profileOptions = useMemo(
    () => profiles.map((profile) => ({ value: profile.id, label: profile.name || '未命名配置' })),
    [profiles],
  )

  const modelOptions = useMemo(
    () => runtime.profile.models.map((model) => ({ value: model.id, label: model.label || model.value })),
    [runtime.profile.models],
  )

  return (
    <Stack gap="md" h="100%" style={{ minHeight: 0 }}>
      <ConversationToolbar
        activeId={activeId}
        conversations={conversations}
        archivedConversations={archivedConversations}
        metrics={metrics}
        onSelect={handleSelectConversation}
        onCreate={handleCreateConversation}
        onRename={handleRenameConversation}
        onArchive={handleArchiveConversation}
        onDelete={handleDeleteConversation}
        onRestore={handleRestoreConversation}
        onOpenSettings={() => setSettingsOpened(true)}
        apiKeyReady={apiKeyReady ?? false}
      />
      <Group
        align="flex-start"
        gap="md"
        wrap="nowrap"
        style={{ flex: 1, width: '100%', height: '100%', minHeight: 0 }}
      >
        <Box style={{ width: 280, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <ContextSidebar
            sections={sections}
            selectedIds={selectedIds}
            onToggle={handleToggleContext}
            onRefreshSavedSql={refreshSavedSql}
            onRefreshRecentQueries={refreshRecentQueries}
            selectedCount={selectedCount}
            maxContextChunks={MAX_CONTEXT_CHUNKS}
          />
        </Box>
        <Box
          style={{
            flex: 1,
            height: '100%',
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
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
              conversationId={activeConversation?.id ?? null}
              transport={transport}
              contextChunks={contextChunks}
              pendingPrompt={pendingPrompt}
              onPromptConsumed={handlePromptConsumed}
              initialMessages={initialMessages}
              onPersistMessages={handlePersistMessages}
              onAssistantMetrics={handleRecordAssistantMetrics}
              transportNotice={transportNotice}
              onDismissTransportNotice={() => setTransportNotice(null)}
              profileOptions={profileOptions}
              modelOptions={modelOptions}
              selectedProfileId={runtime.selection.profileId}
              selectedModelId={runtime.selection.modelId}
              onSelectProfile={handleSelectProfileOption}
              onSelectModel={handleSelectModelOption}
            />
          </Box>
        </Box>
        <Box style={{ width: 320, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <PromptLibrary onInsert={handlePromptInsert} />
        </Box>
      </Group>
      <AssistantSettingsModal
        opened={settingsOpened}
        profiles={profiles}
        selection={profileSelection}
        onClose={() => setSettingsOpened(false)}
        onProfilesSaved={handleProfilesSaved}
        onApiKeyChange={handleApiKeyChange}
      />
    </Stack>
  )
}
